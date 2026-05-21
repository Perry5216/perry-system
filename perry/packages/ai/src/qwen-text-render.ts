/**
 * P.E.R.R.Y. — Qwen Text Rendering Service
 *
 * Uses Qwen2.5-VL (running locally via Ollama) to:
 *   1. Analyse the ComfyUI-generated artwork and identify clear regions for text
 *   2. Generate an SVG/CSS text overlay spec describing exact positions, fonts, and colors
 *   3. Render that spec onto the PNG using Node.js Canvas (no external services)
 *
 * This solves FLUX.1-dev's fundamental weakness: it cannot reliably render
 * legible text. Qwen2.5-VL sees the image, finds good placement zones
 * (sky, dark areas, gradients), and we composite the text programmatically.
 *
 * The final output is a single merged PNG: artwork + title + author name.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextRenderParams {
  /** PNG image buffer from ComfyUI */
  imageBuffer: Buffer;
  /** Book title */
  title: string;
  /** Author name */
  author: string;
  /** Optional series line (e.g. "Book 1 of The Digital Drift Series") */
  series?: string;
  /** Optional subtitle / tagline */
  tagline?: string;
  /** Layout variant — affects text placement zones */
  layout?: 'cover' | 'banner' | 'square';
  /**
   * Qwen2.5-VL model name in Ollama.
   * Defaults to QWEN_IMAGE_MODEL env var → 'qwen2.5vl:latest'
   */
  qwenModel?: string;
  /** Ollama base URL — defaults to OLLAMA_BASE_URL env var → http://ollama:11434 */
  ollamaUrl?: string;
}

export interface TextRenderResult {
  success: boolean;
  /** Final composite PNG buffer */
  imageBuffer?: Buffer;
  /** Placement analysis from Qwen */
  placementAnalysis?: string;
  error?: string;
}

/** Qwen's analysis of the image — where to put text */
interface PlacementSpec {
  /** 'top' | 'bottom' | 'center' — primary placement zone */
  titleZone: 'top' | 'bottom' | 'center';
  /** Whether to add a semi-transparent overlay behind text */
  needsOverlay: boolean;
  /** Dominant background color in the title zone (hex) */
  zoneDominantColor: string;
  /** Best text color for contrast (hex) */
  textColor: string;
  /** Optional second color for glow/shadow effect */
  accentColor: string;
  /** Whether the zone is light or dark background */
  zoneTone: 'light' | 'dark';
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class QwenTextRenderService {
  private readonly ollamaUrl: string;
  private readonly qwenModel: string;

  constructor(ollamaUrl?: string, qwenModel?: string) {
    this.ollamaUrl = (ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434').replace(/\/$/, '');
    this.qwenModel = qwenModel ?? process.env.QWEN_IMAGE_MODEL ?? 'qwen2.5vl:latest';
  }

  /** Quick check — confirms the Qwen model is available in Ollama. */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { models: Array<{ name: string }> };
      return data.models.some(m => m.name.startsWith(this.qwenModel.split(':')[0]));
    } catch {
      return false;
    }
  }

  /**
   * Composite title text onto an artwork image using Qwen2.5-VL for placement analysis.
   * Falls back to rule-based placement if Qwen is unavailable.
   */
  async renderText(params: TextRenderParams): Promise<TextRenderResult> {
    let placement: PlacementSpec;

    // 1. Try Qwen analysis first
    const qwenAvailable = await this.isAvailable();
    if (qwenAvailable) {
      try {
        placement = await this.analyseWithQwen(params);
      } catch (err) {
        console.warn('[QwenTextRender] Qwen analysis failed, using rule-based fallback:', err);
        placement = this.defaultPlacement(params.layout ?? 'cover');
      }
    } else {
      console.warn('[QwenTextRender] Qwen model not available in Ollama, using rule-based placement');
      placement = this.defaultPlacement(params.layout ?? 'cover');
    }

    // 2. Composite the text onto the image using Node Canvas
    try {
      const finalBuffer = await this.compositeText(params, placement);
      return {
        success: true,
        imageBuffer: finalBuffer,
        placementAnalysis: placement.titleZone,
      };
    } catch (err) {
      return {
        success: false,
        error: `Text compositing failed: ${String(err)}`,
      };
    }
  }

  /**
   * Send the image to Qwen2.5-VL via Ollama and ask it where to place text.
   * Returns a structured placement spec.
   */
  private async analyseWithQwen(params: TextRenderParams): Promise<PlacementSpec> {
    const base64Image = params.imageBuffer.toString('base64');

    const prompt = [
      `You are a professional book cover designer analyzing an image to determine optimal text placement.`,
      ``,
      `Book: "${params.title}" by ${params.author}`,
      `Layout: ${params.layout ?? 'portrait cover'}`,
      ``,
      `Analyze this image and respond with ONLY a JSON object (no markdown, no explanation) with these exact fields:`,
      `{`,
      `  "titleZone": "top" or "bottom" or "center",`,
      `  "needsOverlay": true or false,`,
      `  "zoneDominantColor": "#rrggbb",`,
      `  "textColor": "#rrggbb",`,
      `  "accentColor": "#rrggbb",`,
      `  "zoneTone": "light" or "dark"`,
      `}`,
      ``,
      `Rules:`,
      `- titleZone: where there is the most uncluttered space for text`,
      `- needsOverlay: true if the background is busy/complex and text will be hard to read`,
      `- textColor: highest contrast color for readability against the zone`,
      `- accentColor: a complementary color from the image for glow or drop shadow`,
      `- ONLY output the JSON object, nothing else`,
    ].join('\n');

    const res = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.qwenModel,
        prompt,
        images: [base64Image],
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json() as { response: string };

    // Strip any markdown code fences the model might add
    const cleaned = data.response
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    return JSON.parse(cleaned) as PlacementSpec;
  }

  /**
   * Fallback placement rules when Qwen is not available.
   */
  private defaultPlacement(layout: string): PlacementSpec {
    return {
      titleZone: layout === 'banner' ? 'center' : 'bottom',
      needsOverlay: true,
      zoneDominantColor: '#000000',
      textColor: '#ffffff',
      accentColor: '#c8a96e', // warm gold — works on most dark backgrounds
      zoneTone: 'dark',
    };
  }

  /**
   * Render title + author text onto the image using Node.js canvas.
   * Applies a gradient overlay behind text when needed for readability.
   */
  private async compositeText(params: TextRenderParams, spec: PlacementSpec): Promise<Buffer> {
    const { createCanvas, loadImage } = require('canvas');
    const img = await loadImage(params.imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d') as any;

    // Draw base artwork
    ctx.drawImage(img, 0, 0);

    const W = img.width;
    const H = img.height;
    const layout = params.layout ?? 'cover';

    // Zone heights for text placement
    const zoneHeight = Math.round(H * (layout === 'banner' ? 0.9 : 0.28));

    // ── Gradient overlay ────────────────────────────────────────────────────
    if (spec.needsOverlay) {
      const overlayColor = spec.zoneTone === 'dark' ? '0,0,0' : '255,255,255';

      if (spec.titleZone === 'bottom') {
        const grad = ctx.createLinearGradient(0, H - zoneHeight, 0, H);
        grad.addColorStop(0, `rgba(${overlayColor}, 0)`);
        grad.addColorStop(0.5, `rgba(${overlayColor}, 0.6)`);
        grad.addColorStop(1, `rgba(${overlayColor}, 0.88)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, H - zoneHeight, W, zoneHeight);

      } else if (spec.titleZone === 'top') {
        const grad = ctx.createLinearGradient(0, 0, 0, zoneHeight);
        grad.addColorStop(0, `rgba(${overlayColor}, 0.88)`);
        grad.addColorStop(0.5, `rgba(${overlayColor}, 0.6)`);
        grad.addColorStop(1, `rgba(${overlayColor}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, zoneHeight);

      } else {
        // Center band
        const midY = H / 2 - zoneHeight / 2;
        ctx.fillStyle = `rgba(${overlayColor}, 0.65)`;
        ctx.fillRect(0, midY, W, zoneHeight);
      }
    }

    // ── Text layout helpers ─────────────────────────────────────────────────
    const textColor = spec.textColor ?? '#ffffff';
    const accentColor = spec.accentColor ?? '#c8a96e';
    const padding = Math.round(W * 0.06);

    // Calculate Y positions based on zone
    let baseY: number;
    if (spec.titleZone === 'top') {
      baseY = padding * 1.5;
    } else if (spec.titleZone === 'center') {
      baseY = H * 0.4;
    } else {
      baseY = H - zoneHeight + padding;
    }

    // ── Series line (small, top of text block) ──────────────────────────────
    let currentY = baseY;
    if (params.series) {
      const seriesFontSize = Math.round(W * 0.028);
      ctx.font = `italic ${seriesFontSize}px Georgia, serif`;
      ctx.fillStyle = accentColor;
      ctx.textAlign = 'center';
      ctx.shadowColor = spec.zoneTone === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(params.series, W / 2, currentY + seriesFontSize);
      currentY += seriesFontSize * 2;
    }

    // ── Title (large, bold, centered) ────────────────────────────────────────
    const titleWords = params.title.toUpperCase().split(' ');
    const titleFontSize = Math.round(W * (layout === 'banner' ? 0.07 : 0.09));
    ctx.font = `bold ${titleFontSize}px Impact, Arial Black, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = spec.zoneTone === 'dark' ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Word-wrap title to 80% width
    const maxWidth = W * 0.86;
    const lines = this.wrapText(ctx, params.title.toUpperCase(), maxWidth);
    for (const line of lines) {
      // Draw accent glow
      ctx.fillStyle = accentColor;
      ctx.shadowBlur = 18;
      ctx.fillText(line, W / 2, currentY + titleFontSize);
      // Draw main text over it
      ctx.fillStyle = textColor;
      ctx.shadowBlur = 8;
      ctx.fillText(line, W / 2, currentY + titleFontSize);
      currentY += titleFontSize * 1.15;
    }

    // ── Tagline (italic, medium) ─────────────────────────────────────────────
    if (params.tagline) {
      currentY += titleFontSize * 0.3;
      const taglineFontSize = Math.round(W * 0.033);
      ctx.font = `italic ${taglineFontSize}px Georgia, Times New Roman, serif`;
      ctx.fillStyle = accentColor;
      ctx.shadowBlur = 6;
      const taglineLines = this.wrapText(ctx, params.tagline, maxWidth * 0.85);
      for (const line of taglineLines) {
        ctx.fillText(line, W / 2, currentY + taglineFontSize);
        currentY += taglineFontSize * 1.4;
      }
    }

    // ── Author name (smaller, distinct from title) ───────────────────────────
    // Always placed at the bottom of the cover for 'cover' layout, or near title for others
    const authorFontSize = Math.round(W * (layout === 'cover' ? 0.048 : 0.04));
    const authorY = layout === 'cover'
      ? H - padding * 1.2
      : currentY + authorFontSize * 1.5;

    ctx.font = `${authorFontSize}px 'Georgia', serif`;
    ctx.fillStyle = accentColor;
    ctx.shadowColor = spec.zoneTone === 'dark' ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = 'center';
    ctx.fillText(params.author, W / 2, authorY);

    // ── Decorative rule between title and author (cover only) ─────────────────
    if (layout === 'cover') {
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      const ruleY = authorY - authorFontSize * 1.5;
      const ruleW = W * 0.45;
      ctx.beginPath();
      ctx.moveTo((W - ruleW) / 2, ruleY);
      ctx.lineTo((W + ruleW) / 2, ruleY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Return PNG buffer
    return canvas.toBuffer('image/png');
  }

  /** Simple word-wrap: returns array of lines that fit within maxWidth. */
  private wrapText(ctx: any, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}
