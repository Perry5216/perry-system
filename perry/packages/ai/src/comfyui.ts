/**
 * P.E.R.R.Y. — ComfyUI Service
 *
 * Submits image generation workflows to the local ComfyUI container
 * (http://comfyui:8188) via the ComfyUI REST API.
 *
 * Flow:
 *   1. POST /prompt  → queue the workflow, receive a prompt_id
 *   2. Poll GET /history/{prompt_id} until finished
 *   3. Fetch the output image via GET /view
 *   4. Return the raw image Buffer + metadata
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComfyUIBookCoverParams {
  /** Detailed positive prompt (from Step 3 of the Book Cover template) */
  positive_prompt: string;
  /** Negative prompt — what to exclude */
  negative_prompt: string;
  /** Image width in pixels (default 832 — KDP-friendly portrait) */
  width?: number;
  /** Image height in pixels (default 1216) */
  height?: number;
  /**
   * Image generation backend.
   * - 'flux'  → FLUX.1-dev (separate UNET/DualCLIP/VAE files, best quality)
   * - 'sdxl'  → Single checkpoint (legacy, easier model setup)
   */
  backend?: 'flux' | 'sdxl';
  /** FLUX: UNET model filename (e.g. "flux1-dev.safetensors") */
  flux_unet?: string;
  /** FLUX: CLIP-L filename (e.g. "clip_l.safetensors") */
  flux_clip_l?: string;
  /** FLUX: T5XXL filename (e.g. "t5xxl_fp16.safetensors") */
  flux_clip_t5?: string;
  /** FLUX: VAE filename (e.g. "ae.safetensors") */
  flux_vae?: string;
  /** SDXL: Checkpoint model filename */
  checkpoint?: string;
  /** FLUX: Optional LoRA to apply (e.g. "bookcover-redmond-fluxklein.safetensors") */
  lora_name?: string;
  /** FLUX: Strength of the LoRA (default 1.0) */
  lora_strength?: number;
  /** Image-to-Image reference image filename inside ComfyUI input folder (or uploaded via API) */
  reference_image?: string;
  /** Image-to-Image denoise strength (default 1.0 for txt2img, 0.65 for img2img) */
  denoise?: number;
  /** Upscale model filename (e.g. 4x-UltraSharp.pth) */
  upscale_model?: string;
  /** CFG guidance scale (default 3.5 for FLUX, 7 for SDXL) */
  cfg_scale?: number;
  /** Number of sampling steps (default 28 for FLUX, 30 for SDXL) */
  steps?: number;
  /** Sampler name (default "euler" for FLUX, "dpmpp_2m" for SDXL) */
  sampler?: string;
  /** Scheduler (default "simple" for FLUX, "karras" for SDXL) */
  scheduler?: string;
  /** Output format — portrait cover, marketing banner, or square social */
  layout?: 'cover' | 'banner' | 'square';
}

export interface ComfyUIResult {
  success: boolean;
  /** Raw PNG buffer of the generated image */
  imageBuffer?: Buffer;
  /** Original filename reported by ComfyUI */
  filename?: string;
  /** ComfyUI prompt_id that was queued */
  promptId?: string;
  error?: string;
}

// ─── Workflow templates ───────────────────────────────────────────────────────

/**
 * FLUX.1-dev workflow graph.
 * Requires separate UNET, DualCLIP (CLIP-L + T5XXL), and VAE files.
 * Uses FluxGuidance node for CFG conditioning.
 */
function buildFluxWorkflow(p: Required<ComfyUIBookCoverParams>, clientId: string): object {
  const seed = parseInt(clientId.slice(0, 8), 16);
  const workflow: Record<string, any> = {
    '1': { class_type: 'UNETLoader',      inputs: { unet_name: p.flux_unet, weight_dtype: 'fp8_e4m3fn' } },
    '2': { class_type: 'DualCLIPLoader',  inputs: { clip_name1: p.flux_clip_l, clip_name2: p.flux_clip_t5, type: 'flux' } },
    '3': { class_type: 'VAELoader',        inputs: { vae_name: p.flux_vae } },
    '4': { class_type: 'CLIPTextEncode',   inputs: { text: p.positive_prompt, clip: ['2', 0] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': { class_type: 'FluxGuidance',     inputs: { conditioning: ['4', 0], guidance: p.cfg_scale } },
    '8': { class_type: 'VAEDecode',  inputs: { samples: ['7', 0], vae: ['3', 0] } },
  };

  let finalImageOutput = ['8', 0];

  let unetOutput = ['1', 0];

  if (p.lora_name) {
    workflow['10'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        lora_name: p.lora_name,
        strength_model: p.lora_strength,
        model: ['1', 0]
      }
    };
    unetOutput = ['10', 0];
  }

  let latentInput = ['5', 0];
  if (p.reference_image) {
    // Inject Image-to-Image nodes for Style Matching
    workflow['11'] = { class_type: 'LoadImage', inputs: { image: p.reference_image } };
    workflow['12'] = { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['3', 0] } };
    latentInput = ['12', 0];
  }

  workflow['7'] = {
    class_type: 'KSampler',
    inputs: {
      model: unetOutput,
      positive: ['6', 0],
      negative: ['4', 0], // FLUX uses empty negative effectively
      latent_image: latentInput,
      seed,
      steps: p.steps,
      cfg: 1.0,           // KSampler CFG is 1.0 for FLUX — guidance is via FluxGuidance node
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      denoise: p.denoise ?? 1.0,
    },
  };

  if (p.upscale_model) {
    workflow['13'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: p.upscale_model } };
    workflow['14'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['13', 0], image: finalImageOutput } };
    finalImageOutput = ['14', 0];
  }

  workflow['9'] = { class_type: 'SaveImage', inputs: { images: finalImageOutput, filename_prefix: `perry-cover-${clientId}` } };

  return workflow;
}

/**
 * Legacy SDXL checkpoint workflow.
 * Uses a single CheckpointLoaderSimple — easier to set up.
 */
function buildSdxlWorkflow(p: Required<ComfyUIBookCoverParams>, clientId: string): object {
  const seed = parseInt(clientId.slice(0, 8), 16);
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpoint } },
    '2': { class_type: 'CLIPTextEncode',   inputs: { text: p.positive_prompt,  clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode',   inputs: { text: p.negative_prompt, clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps: p.steps,
        cfg: p.cfg_scale,
        sampler_name: p.sampler,
        scheduler: p.scheduler,
        denoise: 1.0,
      },
    },
    '6': { class_type: 'VAEDecode',  inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage',  inputs: { images: ['6', 0], filename_prefix: `perry-cover-${clientId}` } },
  };
}

/** Resolve output dimensions based on the requested layout. */
function resolveDimensions(params: ComfyUIBookCoverParams): { width: number; height: number } {
  switch (params.layout ?? 'cover') {
    case 'banner':  return { width: 1216, height: 512  }; // Marketing banner 19:8
    case 'square':  return { width: 1024, height: 1024 }; // Social media square
    case 'cover':
    default:        return { width: params.width ?? 832, height: params.height ?? 1216 }; // Portrait KDP 2:3
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ComfyUIService {
  private readonly baseUrl: string;
  /** Polling interval in ms */
  private readonly pollIntervalMs = 3000;
  /** Max wait time in ms (10 minutes for large models) */
  private readonly maxWaitMs = 600_000;

  /**
   * @param baseUrl  ComfyUI server URL — defaults to COMFYUI_BASE_URL env var
   *                 or http://comfyui:8188 (container name on n8n-net).
   */
  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? process.env.COMFYUI_BASE_URL ?? 'http://localhost:8188').replace(/\/$/, '');
  }

  /** Quick health check — resolves true if ComfyUI is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generate a book cover image using ComfyUI.
   * Defaults to FLUX.1-dev backend; falls back to SDXL if FLUX models aren't specified.
   * Queues the workflow, polls for completion, fetches the image buffer.
   */
  async generateBookCover(params: ComfyUIBookCoverParams): Promise<ComfyUIResult> {
    const clientId = randomBytes(8).toString('hex');
    const dims = resolveDimensions(params);
    const backend = params.backend ?? 'flux';

    // Apply backend-specific defaults
    const resolved: Required<ComfyUIBookCoverParams> = {
      positive_prompt: params.positive_prompt,
      negative_prompt: params.negative_prompt ?? 'text, watermark, blurry, low quality, deformed, ugly, bad anatomy',
      width:  dims.width,
      height: dims.height,
      layout: params.layout ?? 'cover',
      backend,
      // FLUX defaults
      flux_unet:    params.flux_unet    ?? 'flux1-dev.safetensors',
      flux_clip_l:  params.flux_clip_l  ?? 'clip_l.safetensors',
      flux_clip_t5: params.flux_clip_t5 ?? 't5xxl_fp16.safetensors',
      flux_vae:     params.flux_vae     ?? 'ae.safetensors',
      lora_name:    params.lora_name    ?? '',
      lora_strength: params.lora_strength ?? 1.0,
      reference_image: params.reference_image ?? '',
      denoise: params.denoise ?? 1.0,
      upscale_model: params.upscale_model ?? '',
      // SDXL fallback defaults
      checkpoint: params.checkpoint ?? 'v1-5-pruned-emaonly.safetensors',
      // Shared — FLUX wants lower CFG and fewer steps
      cfg_scale: params.cfg_scale ?? (backend === 'flux' ? 3.5 : 7),
      steps:     params.steps     ?? (backend === 'flux' ? 28  : 30),
      sampler:   params.sampler   ?? (backend === 'flux' ? 'euler'     : 'dpmpp_2m'),
      scheduler: params.scheduler ?? (backend === 'flux' ? 'simple'    : 'karras'),
    };

    if (resolved.reference_image) {
      const uploadRes = await this.uploadImage(resolved.reference_image);
      if (!uploadRes.success || !uploadRes.filename) {
        return { success: false, error: uploadRes.error ?? 'Failed to upload reference image to ComfyUI' };
      }
      resolved.reference_image = uploadRes.filename; // Use the uploaded filename in the workflow
    }

    const workflow = backend === 'flux'
      ? buildFluxWorkflow(resolved, clientId)
      : buildSdxlWorkflow(resolved, clientId);

    // ── Step 1: Queue the prompt ──────────────────────────────────────────────
    let promptId: string;
    try {
      const queueRes = await fetch(`${this.baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, prompt: workflow }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!queueRes.ok) {
        const text = await queueRes.text();
        return { success: false, error: `ComfyUI queue failed (${queueRes.status}): ${text.slice(0, 300)}` };
      }

      const queueData = await queueRes.json() as { prompt_id: string };
      promptId = queueData.prompt_id;
    } catch (err) {
      return { success: false, error: `ComfyUI unreachable: ${String(err)}` };
    }

    // ── Step 2: Poll history until complete ───────────────────────────────────
    const deadline = Date.now() + this.maxWaitMs;
    let outputFilename: string | undefined;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, this.pollIntervalMs));

      try {
        const histRes = await fetch(`${this.baseUrl}/history/${promptId}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!histRes.ok) continue;

        const history = await histRes.json() as Record<string, any>;
        const entry = history[promptId];
        if (!entry) continue;

        const outputs = entry?.outputs ?? {};
        for (const nodeId of Object.keys(outputs)) {
          const images: Array<{ filename: string; subfolder: string; type: string }> =
            outputs[nodeId]?.images ?? [];
          const img = images.find(i => i.type === 'output');
          if (img) { outputFilename = img.filename; break; }
        }

        if (outputFilename) break;

        const status = entry?.status;
        if (status?.status_str === 'error') {
          const msgs = (status?.messages ?? []).map((m: any) => String(m)).join('; ');
          return { success: false, promptId, error: `ComfyUI generation error: ${msgs}` };
        }
      } catch {
        // Transient poll error — keep waiting
      }
    }

    if (!outputFilename) {
      return { success: false, promptId, error: `ComfyUI timed out after ${this.maxWaitMs / 1000}s` };
    }

    // ── Step 3: Download the image ────────────────────────────────────────────
    try {
      const viewUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(outputFilename)}&type=output`;
      const imgRes = await fetch(viewUrl, { signal: AbortSignal.timeout(30_000) });
      if (!imgRes.ok) {
        return { success: false, promptId, error: `ComfyUI /view failed (${imgRes.status})` };
      }
      const arrayBuf = await imgRes.arrayBuffer();
      return {
        success: true,
        imageBuffer: Buffer.from(arrayBuf),
        filename: outputFilename,
        promptId,
      };
    } catch (err) {
      return { success: false, promptId, error: `Failed to download ComfyUI output: ${String(err)}` };
    }
  }

  /**
   * List available models from ComfyUI.
   * Returns checkpoints (SDXL), UNET models (FLUX), VAE, and CLIP files.
   */
  async listModels(): Promise<{
    checkpoints: string[];
    unets: string[];
    vaes: string[];
    clips: string[];
  }> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { checkpoints: [], unets: [], vaes: [], clips: [] };
      const data = await res.json() as any;
      return {
        checkpoints: data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [],
        unets:       data?.UNETLoader?.input?.required?.unet_name?.[0]             ?? [],
        vaes:        data?.VAELoader?.input?.required?.vae_name?.[0]               ?? [],
        clips:       data?.DualCLIPLoader?.input?.required?.clip_name1?.[0]        ?? [],
      };
    } catch {
      return { checkpoints: [], unets: [], vaes: [], clips: [] };
    }
  }

  /** @deprecated Use listModels() instead */
  async listCheckpoints(): Promise<string[]> {
    return (await this.listModels()).checkpoints;
  }

  /**
   * Upload an image to ComfyUI for Image-to-Image / Style Transfer
   */
  async uploadImage(filePath: string): Promise<{ success: boolean; filename?: string; error?: string }> {
    try {
      const filename = path.basename(filePath);
      const buffer = fs.readFileSync(filePath);
      
      const formData = new FormData();
      const blob = new Blob([buffer], { type: 'image/png' });
      formData.append('image', blob, filename);
      formData.append('overwrite', 'true');

      const res = await fetch(`${this.baseUrl}/upload/image`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        return { success: false, error: `ComfyUI upload failed (${res.status})` };
      }

      const data = await res.json() as { name: string };
      return { success: true, filename: data.name };
    } catch (err) {
      return { success: false, error: `Upload error: ${String(err)}` };
    }
  }
}
