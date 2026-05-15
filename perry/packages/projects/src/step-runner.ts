/**
 * @perry/projects — Step Runner
 *
 * Executes a single project step: builds the prompt, calls the AI,
 * saves the result, emits events. This is the atomic unit of work.
 *
 * The StepRunner doesn't know about templates or project types —
 * it just executes whatever step it's given.
 */

import type {
  Project, ProjectStep, CompletionRequest, CompletionResponse,
  EventBus, Logger, McpClientService
} from '@perry/core';
import type { AIRouter } from '@perry/ai';
import { ComfyUIService, QwenTextRenderService } from '@perry/ai';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import { createCanvas, loadImage } from 'canvas';
import { StateStore } from './state-store.js';
import { PromptBuilder } from './prompt-builder.js';
import { PovQualityGate } from './quality-gates/pov-gate.js';
import { ContinuityGate } from './quality-gates/continuity-gate.js';
import { RevisionGate } from './quality-gates/revision-gate.js';
import { DeduplicationService } from './services/deduplication.js';
import { ProseSanitizer } from './services/prose-sanitizer.js';
import { StyleDnaService } from './services/style-dna-service.js';
import { CostTracker } from './services/cost-tracker.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { generateCalibrationPassSteps } from './templates.js';
import { AutoLearningService } from './services/auto-learning-service.js';

export interface StepRunnerConfig {
  workspaceDir: string;
  maxRetries: number;
  minResponseLength: number;
}

export class StepRunner {
  private router: AIRouter;
  private stateStore: StateStore;
  private promptBuilder: PromptBuilder;
  private eventBus: EventBus;
  private log: Logger;
  private config: StepRunnerConfig;

  private mcpClient: McpClientService;

  // Extracted services
  private povGate: PovQualityGate;
  private continuityGate: ContinuityGate;
  private revisionGate: RevisionGate;
  private dedup: DeduplicationService;
  private sanitizer: ProseSanitizer;
  private styleDna: StyleDnaService;
  private autoLearning: AutoLearningService;
  private costTracker: CostTracker;

  constructor(
    router: AIRouter,
    stateStore: StateStore,
    promptBuilder: PromptBuilder,
    eventBus: EventBus,
    log: Logger,
    config: StepRunnerConfig,
    mcpClient: McpClientService,
  ) {
    this.router = router;
    this.stateStore = stateStore;
    this.promptBuilder = promptBuilder;
    this.eventBus = eventBus;
    this.log = log;
    this.config = config;
    this.mcpClient = mcpClient;

    // Initialize extracted services
    const styleDna = new StyleDnaService(stateStore, log.child('style-dna'), config.workspaceDir);
    this.styleDna = styleDna;
    this.autoLearning = new AutoLearningService(config.workspaceDir, styleDna, log.child('auto-learn'), stateStore);
    this.povGate = new PovQualityGate(log.child('pov-gate'), eventBus, stateStore, styleDna);
    this.continuityGate = new ContinuityGate(log.child('continuity-gate'), eventBus, stateStore, config.workspaceDir);
    this.revisionGate = new RevisionGate(log.child('revision-gate'), eventBus, stateStore);
    this.dedup = new DeduplicationService(log.child('dedup'), eventBus);
    this.sanitizer = new ProseSanitizer();
    this.costTracker = new CostTracker(
      { maxPerProject: 0, maxGlobal: 0 }, // Unlimited by default — configure via config
      log.child('cost'),
      eventBus,
    );
  }

  /**
   * Cleans up any in-memory state for a project (e.g., budget carry-forward).
   */
  clearProjectState(projectId: string): void {
    this.promptBuilder.clearProjectBudget(projectId);
  }

  /**
   * Execute a single step. Returns the completion result.
   *
   * Pipeline:
   * 1. Mark step as active
   * 2. Select AI provider (tier routing)
   * 3. Build prompt (via PromptBuilder + BudgetManager + Librarian)
   * 4. Send to AI with retry logic
   * 5. Validate response (length, format)
   * 6. Save result to state store + disk
   * 7. Emit step:completed event
   */
  async execute(project: Project, step: ProjectStep): Promise<string> {
    this.log.info('Executing step', {
      project: project.title,
      step: step.label,
      taskType: step.taskType,
    });

    // 1. Mark step as active
    this.stateStore.startStep(project.id, step.id);
    this.eventBus.emit('step:started', { projectId: project.id, stepId: step.id });
    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Starting: ${step.label}`,
    });

    let result: string | null = null;
    let lastError: Error | null = null;

    // ── ComfyUI image generation (no LLM needed) ──────────────────────────────
    if (step.taskType === 'comfyui_generate') {
      this.log.info('Executing ComfyUI image generation step');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Connecting to ComfyUI...',
      });

      const comfyui = new ComfyUIService();

      // Check health first
      const healthy = await comfyui.isHealthy();
      if (!healthy) {
        const errMsg = 'ComfyUI is not reachable. Ensure the comfyui container is running and healthy.';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Find the most recently completed step whose result looks like JSON
      const prevStep = [...project.steps]
        .reverse()
        .find(s => s.id !== step.id && s.status === 'completed' && s.result?.trim().startsWith('{'));

      let comfyParams: Record<string, any> = {};
      if (prevStep?.result) {
        try {
          // Strip markdown fences if the LLM wrapped its output
          const cleaned = prevStep.result
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/i, '')
            .trim();
          comfyParams = JSON.parse(cleaned);
        } catch {
          this.log.warn('ComfyUI step: could not parse prior step JSON, using defaults');
        }
      }

      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Clearing VRAM: Unloading LLMs...',
      });

      // --- VRAM FLUSH ---
      // Ollama might be holding a massive model (like Gemma 31B) on the GPU.
      // We must unload it to make room for FLUX.1-dev.
      await this.flushOllamaVram();
      // ------------------

      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'P.E.R.R.Y. System: I\'m loaded and ready for the director and painter... (Generating Artwork)',
      });

      const genResult = await comfyui.generateBookCover({
        positive_prompt: comfyParams.positive_prompt ?? `Professional book cover for "${project.title}", ${project.description?.slice(0, 200)}`,
        negative_prompt: comfyParams.negative_prompt ?? 'text, watermark, title, letters, blurry, low quality, deformed, ugly',
        backend:      comfyParams.backend      ?? 'flux',
        flux_unet:    comfyParams.flux_unet    ?? undefined,
        flux_clip_l:  comfyParams.flux_clip_l  ?? undefined,
        flux_clip_t5: comfyParams.flux_clip_t5 ?? undefined,
        flux_vae:     comfyParams.flux_vae     ?? undefined,
        checkpoint:   comfyParams.checkpoint   ?? undefined,
        layout:       comfyParams.layout       ?? 'cover',
        width:  comfyParams.dimensions?.width  ?? comfyParams.width  ?? 832,
        height: comfyParams.dimensions?.height ?? comfyParams.height ?? 1216,
        cfg_scale: comfyParams.cfg_scale ?? undefined,
        steps:     comfyParams.steps ?? comfyParams.recommended_steps ?? undefined,
        sampler:   comfyParams.sampler   ?? undefined,
        scheduler: comfyParams.scheduler ?? undefined,
        lora_name: comfyParams.lora_name ?? undefined,
        lora_strength: comfyParams.lora_strength ?? undefined,
        reference_image: comfyParams.reference_image ? join(this.config.workspaceDir, comfyParams.reference_image.replace(/^workspace\//, '')) : undefined,
        denoise: comfyParams.denoise ?? undefined,
        upscale_model: comfyParams.upscale_model ?? undefined,
      });

      if (!genResult.success || !genResult.imageBuffer) {
        const errMsg = genResult.error ?? 'ComfyUI generation failed with no error detail';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Save the image to workspace/images/
      const { mkdir: mkdirAsync, writeFile: writeFileAsync } = await import('fs/promises');
      const imagesDir = join(this.config.workspaceDir, 'images');
      await mkdirAsync(imagesDir, { recursive: true });
      const outFilename = genResult.filename ?? `cover-${project.id}-${Date.now()}.png`;
      const outPath = join(imagesDir, outFilename);
      await writeFileAsync(outPath, genResult.imageBuffer);

      result = [
        `## Book Cover Generated ✓`,
        ``,
        `- **File**: \`${outPath}\``,
        `- **Filename**: ${outFilename}`,
        `- **ComfyUI prompt_id**: ${genResult.promptId ?? 'unknown'}`,
        `- **Dimensions**: ${comfyParams.dimensions?.width ?? 832}×${comfyParams.dimensions?.height ?? 1216}`,
        ``,
        `The cover image has been saved to the workspace images directory.`,
        `You can find it at: \`workspace/images/${outFilename}\``,
      ].join('\n');

      this.log.info('ComfyUI base artwork generated', { file: outPath });
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Base artwork saved: ${outFilename}`,
      });
    } else

    // ── Text Overlay (Back Cover Summary via Jimp) ──────────────────────────────────
    if (step.taskType === 'text_overlay') {
      this.log.info('Executing text overlay step for back cover summary');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Compositing summary text onto artwork...',
      });

      // Find the most recent comfyui_generate step
      const artStep = [...project.steps].reverse().find(s => s.taskType === 'comfyui_generate' && s.status === 'completed' && s.result);
      const fileMatch = artStep?.result?.match(/\*\*File\*\*:\s*`([^`]+)`/);
      const artworkPath = fileMatch?.[1];

      if (!artworkPath) {
        throw new Error('Could not find base artwork from FLUX generation step.');
      }

      // Find the back cover summary text
      const summaryStep = [...project.steps].reverse().find(s => s.taskType === 'creative_writing' && s.status === 'completed' && s.result);
      if (!summaryStep?.result) {
        throw new Error('Could not find generated back cover summary.');
      }
      
      const summaryText = summaryStep.result.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

      const { readFile: readFileAsync, writeFile: writeFileAsync, copyFile: copyFileAsync } = await import('fs/promises');
      
      // 1. EBOOK VARIANT (Raw Front Cover)
      const ebookPath = artworkPath.replace('.png', '-ebook-cover.png');
      await copyFileAsync(artworkPath, ebookPath);

      // 2. KDP PAPERBACK WRAP VARIANT
      const imgBuf = await readFileAsync(artworkPath);
      const img = await loadImage(imgBuf);
      
      const spineWidth = 200; // ~300 pages at 6x9
      const wrapWidth = (img.width * 2) + spineWidth;
      const wrapHeight = img.height;

      const canvas = createCanvas(wrapWidth, wrapHeight);
      const ctx = canvas.getContext('2d');
      
      // Front Cover (Right side)
      ctx.drawImage(img, img.width + spineWidth, 0);

      // Back Cover (Left side) - Mirrored, Darkened, Blurred
      ctx.save();
      ctx.translate(img.width, 0);
      ctx.scale(-1, 1);
      // ctx.filter = 'blur(15px) brightness(40%)'; // Unsupported in node-canvas
      ctx.globalAlpha = 0.4; // Simulates brightness darkening
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // Spine (Center)
      ctx.fillStyle = '#151515';
      ctx.fillRect(img.width, 0, spineWidth, wrapHeight);

      // Spine Text
      ctx.save();
      ctx.translate(img.width + (spineWidth / 2), wrapHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const spineText = `${project.title}        ${project.context?.penName || 'P.E.R.R.Y.'}`;
      ctx.fillText(spineText, 0, 0);
      ctx.restore();

      // Back Cover Summary Typography
      const margin = 100;
      const maxWidth = img.width - (margin * 2);
      
      ctx.fillStyle = '#ffffff';
      const fontSelection = project.context?.coverFont || 'Serif (Georgia)';
      const fontFamily = fontSelection.includes('Sans') ? '"Helvetica Neue", Helvetica, Arial, sans-serif' : '"Georgia", serif';
      ctx.font = `36px ${fontFamily}`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.textAlign = 'left';
      
      const paragraphs = summaryText.split('\n').map(p => p.trim()).filter(p => p !== '');
      let y = margin + 80;
      
      for (const p of paragraphs) {
        const cleanP = p.replace(/\*\*/g, ''); // strip markdown bolding for canvas
        const words = cleanP.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && n > 0) {
            ctx.fillText(line, margin, y);
            line = words[n] + ' ';
            y += 50; // line height
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, margin, y);
        y += 80; // paragraph spacing
      }

      // 3. LOGO BRANDING (Neural Weaver)
      try {
        const logoPath = 'd:/n8n/perry/packages/ai/assets/imprint-logo.png';
        const logoBuf = await readFileAsync(logoPath);
        const logoImg = await loadImage(logoBuf);
        
        // Create a temporary canvas to tint the white logo
        const logoCanvas = createCanvas(logoImg.width, logoImg.height);
        const lctx = logoCanvas.getContext('2d');
        lctx.drawImage(logoImg, 0, 0);
        lctx.globalCompositeOperation = 'source-in';
        lctx.fillStyle = project.context?.brandColor || '#00d2ff';
        lctx.fillRect(0, 0, logoImg.width, logoImg.height);
        
        // Stamp on Spine (Bottom)
        const logoSize = 100;
        const logoX = img.width + (spineWidth / 2) - (logoSize / 2);
        const logoY = wrapHeight - logoSize - 80;
        ctx.drawImage(logoCanvas, logoX, logoY, logoSize, logoSize);
        
        // Stamp on Back Cover (Bottom Right)
        const bLogoSize = 80;
        const bLogoX = img.width - bLogoSize - 60;
        const bLogoY = wrapHeight - bLogoSize - 60;
        ctx.drawImage(logoCanvas, bLogoX, bLogoY, bLogoSize, bLogoSize);
        
      } catch (e: any) {
        this.log.warn('Could not load imprint logo, skipping branding', { error: e.message });
      }
      
      const wrapPath = artworkPath.replace('.png', '-paperback-wrap.png');
      const buffer = canvas.toBuffer('image/png');
      await writeFileAsync(wrapPath, buffer);

      result = [
        `## Book Cover Variants Complete ✓`,
        ``,
        `- **eBook Cover**: \`${ebookPath}\``,
        `- **KDP Paperback Wrap**: \`${wrapPath}\``,
        ``,
        `Both the eBook cover and full print wrap have been successfully generated!`
      ].join('\n');
      
      this.log.info('Cover variants generated', { ebook: ebookPath, wrap: wrapPath });
    } else

    // ── Qwen2.5-VL text rendering + marketing layout ───────────────────────────
    if (step.taskType === 'qwen_text_render') {
      this.log.info('Executing Qwen text rendering step');
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: 'Finding base artwork from FLUX generation step...',
      });

      // Find the most recent comfyui_generate step that has a result
      const artStep = [...project.steps]
        .reverse()
        .find(s => s.taskType === 'comfyui_generate' && s.status === 'completed' && s.result);

      // Parse the file path from that step's result markdown
      const fileMatch = artStep?.result?.match(/\*\*File\*\*:\s*`([^`]+)`/);
      const artworkPath = fileMatch?.[1];

      if (!artworkPath) {
        const errMsg = 'Qwen text render: could not find base artwork from FLUX generation step.';
        this.stateStore.failStep(project.id, step.id, errMsg);
        this.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: errMsg });
        throw new Error(errMsg);
      }

      // Also get the params JSON from the prompt engineering step for title/author/tagline
      const paramsStep = [...project.steps]
        .reverse()
        .find(s => s.taskType === 'creative_writing' && s.status === 'completed' && s.result?.trim().startsWith('{'));
      let coverMeta: Record<string, any> = {};
      if (paramsStep?.result) {
        try {
          const cleaned = paramsStep.result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
          coverMeta = JSON.parse(cleaned);
        } catch { /* use defaults */ }
      }

      const { readFile: readFileAsync, writeFile: writeFileAsync2, mkdir: mkdirAsync2 } = await import('fs/promises');
      const imageBuffer = await readFileAsync(artworkPath);

      const qwen = new QwenTextRenderService();
      const imagesDir2 = join(this.config.workspaceDir, 'images');
      await mkdirAsync2(imagesDir2, { recursive: true });

      const savedFiles: string[] = [];
      const layouts: Array<'cover' | 'banner' | 'square'> = ['cover'];
      const variants: string[] = coverMeta.marketing_variants ?? [];
      if (variants.includes('banner')) layouts.push('banner');
      if (variants.includes('square')) layouts.push('square');

      for (const layout of layouts) {
        this.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `Qwen rendering: ${layout} layout...`,
        });

        // For non-cover layouts, regenerate artwork at the right dimensions first
        let srcBuffer: any = imageBuffer;
        if (layout !== 'cover') {
          this.eventBus.emit('step:progress', {
            projectId: project.id, stepId: step.id,
            message: `P.E.R.R.Y. System: I'm loaded and ready for the director and painter... (Generating ${layout} variant)`,
          });
          
          // --- VRAM FLUSH ---
          await this.flushOllamaVram();
          // ------------------

          const comfyui2 = new ComfyUIService();
          const variantGen = await comfyui2.generateBookCover({
            positive_prompt: coverMeta.positive_prompt ?? `Book cover art for "${project.title}"`,
            negative_prompt: coverMeta.negative_prompt ?? 'text, watermark, blurry',
            backend:      coverMeta.backend      ?? 'flux',
            flux_unet:    coverMeta.flux_unet    ?? undefined,
            flux_clip_l:  coverMeta.flux_clip_l  ?? undefined,
            flux_clip_t5: coverMeta.flux_clip_t5 ?? undefined,
            flux_vae:     coverMeta.flux_vae     ?? undefined,
            layout,
          });
          if (variantGen.success && variantGen.imageBuffer) {
            srcBuffer = variantGen.imageBuffer;
          }
        }

        const renderResult = await qwen.renderText({
          imageBuffer: srcBuffer,
          title:  coverMeta.title  ?? project.title,
          author: coverMeta.author ?? 'P.E.R.R.Y.',
          series:  coverMeta.series  ?? undefined,
          tagline: coverMeta.tagline ?? undefined,
          layout,
        });

        if (!renderResult.success || !renderResult.imageBuffer) {
          this.log.warn('Qwen text render failed for layout, saving raw artwork', { layout, error: renderResult.error });
          // Save raw artwork without text rather than failing entirely
          const rawName = `perry-${layout}-${project.id}-raw.png`;
          await writeFileAsync2(join(imagesDir2, rawName), srcBuffer);
          savedFiles.push(rawName);
        } else {
          const suffix = layout === 'cover' ? 'final' : layout;
          const outName = `perry-${suffix}-${project.id}.png`;
          await writeFileAsync2(join(imagesDir2, outName), renderResult.imageBuffer);
          savedFiles.push(outName);
          this.log.info('Text rendered successfully', { layout, file: outName });
        }
      }

      result = [
        `## Book Cover Production Complete ✓`,
        ``,
        `### Generated Files`,
        ...savedFiles.map(f => `- \`workspace/images/${f}\``),
        ``,
        `### Pipeline`,
        `- 🎨 **Artwork**: FLUX.1-dev via ComfyUI`,
        `- ✍️ **Text rendering**: Qwen2.5-VL placement analysis + Node canvas compositing`,
        `- 📐 **Layouts**: ${layouts.join(', ')}`,
        ``,
        `The KDP-ready cover is at \`workspace/images/perry-final-${project.id}.png\``,
      ].join('\n');

      this.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: `✓ All ${savedFiles.length} cover files generated`,
      });
    } else

    // Fast-path mechanical tasks (like compiling the manuscript)
    if (step.taskType === 'export') {
      this.log.info('Executing mechanical export task');
      let manuscript = `# ${project.title}\n\n`;
      
      // Order of chapters: Prologue -> Chapters -> Epilogue
      const exportSteps = project.steps.filter(s => s.taskType === 'creative_writing' && s.status === 'completed');
      
      const prologue = exportSteps.find(s => s.label === 'Prologue');
      if (prologue && prologue.result) {
        manuscript += `${prologue.result}\n\n* * *\n\n`;
      }
      
      const chapters = exportSteps.filter(s => s.chapterNumber !== undefined && s.chapterNumber > 0).sort((a, b) => a.chapterNumber! - b.chapterNumber!);
      // We need to pull the finalized chapters. If a chapter was segmented, its finalized form is in `draft_compile`.
      // Otherwise it's in `creative_writing`.
      const compiledChapters = project.steps.filter(s => s.taskType === 'draft_compile' && s.status === 'completed');

      // To handle both legacy non-segmented and new segmented projects:
      const processedChapters = new Set<number>();

      // Add compiled chapters
      for (const ch of compiledChapters) {
        if (ch.result && ch.chapterNumber) {
          if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
            this.log.warn('Skipping corrupted compiled chapter in export', { stepId: ch.id });
            continue;
          }
          manuscript += `${ch.result}\n\n* * *\n\n`;
          processedChapters.add(ch.chapterNumber);
        }
      }

      // Add any non-segmented creative_writing chapters (legacy or 1-segment chapters)
      for (const ch of chapters) {
        if (ch.result && ch.chapterNumber && !processedChapters.has(ch.chapterNumber) && !ch.segmentIndex) {
          if (ch.result.includes('P.E.R.R.Y. SYSTEM ALERT') || ch.result.includes('P.E.R.R.Y. System Alert') || ch.result.startsWith('BLOCKED')) {
            this.log.warn('Skipping corrupted writing chapter in export', { stepId: ch.id });
            continue;
          }
          manuscript += `${ch.result}\n\n* * *\n\n`;
          processedChapters.add(ch.chapterNumber);
        }
      }
      
      const epilogue = exportSteps.find(s => s.label === 'Epilogue');
      if (epilogue && epilogue.result) {
        manuscript += `${epilogue.result}\n\n* * *\n\n`;
      }
      
      result = manuscript.trim();

      // Run ProseSanitizer on the final assembled manuscript.
      // FIX #15: Individual chapters are sanitized during draft_compile, but the export
      // step assembles them without a final clean pass. Any <think> tags, segment headers,
      // or LLM filler that survived individual sanitization will appear in the final export.
      result = this.sanitizer.sanitize(result);

      // Cross-chapter duplicate passage scan — runs once at compile time.
      // Detects sentences that appear verbatim in more than one chapter
      // and reports them as warnings before the manuscript is stored.
      this.dedup.scanForCrossChapterDuplicates(project, step, exportSteps);
    } else if (step.taskType === 'revision_compile') {
      this.log.info('Executing mechanical revision compile task', { chapter: step.chapterNumber });
      
      let compiledChapter = '';
      const segments = project.steps
        .filter(s => s.taskType === 'revision_execution' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
        .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

      for (const seg of segments) {
        if (!seg.result) continue;
        if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
          this.log.warn('Skipping corrupted segment in revision compile', { stepId: seg.id });
          continue;
        }
        let text = this.sanitizer.stripSegmentHeaders(seg.result);
        text = this.sanitizer.sanitize(text);
        
        if (compiledChapter.length > 0) {
          const trimmedCompiled = compiledChapter.trimEnd();
          if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
            compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
          } else {
            compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
          }
        } else {
          compiledChapter = `${text}\n\n`;
        }
      }
      
      result = compiledChapter.trim();
    } else if (step.taskType === 'draft_compile') {
      this.log.info('Executing mechanical draft compile task', { chapter: step.chapterNumber });
      
      let compiledChapter = '';
      const segments = project.steps
        .filter(s => s.taskType === 'creative_writing' && s.chapterNumber === step.chapterNumber && s.status === 'completed' && s.result)
        .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));

      for (const seg of segments) {
        if (!seg.result) continue;
        if (seg.result.includes('P.E.R.R.Y. SYSTEM ALERT') || seg.result.includes('P.E.R.R.Y. System Alert') || seg.result.startsWith('BLOCKED')) {
          this.log.warn('Skipping corrupted segment in draft compile', { stepId: seg.id });
          continue;
        }
        let text = this.sanitizer.stripSegmentHeaders(seg.result);
        text = this.sanitizer.sanitize(text);

        if (compiledChapter.length > 0) {
          const trimmedCompiled = compiledChapter.trimEnd();
          if (!trimmedCompiled.match(/[.!?:"'”]$/) && !trimmedCompiled.endsWith('⁂')) {
            compiledChapter = trimmedCompiled + ' ' + text + '\n\n';
          } else {
            compiledChapter = trimmedCompiled + '\n\n' + text + '\n\n';
          }
        } else {
          compiledChapter = `${text}\n\n`;
        }
      }
      
      result = compiledChapter.trim();

      // ── Feature 3: POV Continuity Check ──────────────────────────────
      // For calibration compiles (2-segment scenes), detect if POV character
      // switched between Part 1 and Part 2 before the POV check runs.
      // Catches head-hopping BEFORE it wastes a POV check cycle.
      if (project.type === 'style-calibration' && segments.length === 2) {
        const part1 = segments[0]?.result || '';
        const part2 = segments[1]?.result || '';
        const povFracture = this.detectPovFracture(part1, part2);
        if (povFracture) {
          this.log.warn('POV FRACTURE detected at compile — character switched between Part 1 and Part 2', {
            chapter: step.chapterNumber,
            fracture: povFracture,
          });
          // Prepend a warning into the compiled result so the POV Check auditor sees it
          result = `[⚠️ AUTO-DETECTED POV FRACTURE: ${povFracture}. The POV character appears to have changed between Part 1 and Part 2. Grade this harshly on Deep POV.]

${result}`;
        }
      }


    } else {
      // 2. Select provider
      const provider = this.router.selectProvider(
        step.taskType,
        project.preferredProvider,
      );
      this.log.info('Provider selected', {
        provider: provider.id,
        model: provider.model,
      });

      // 3. Build the system prompt
      const systemPrompt = this.buildSystemPrompt(project, step);

      // 4. Build the user message (with budget management + compression)
      this.eventBus.emit('step:progress', {
        projectId: project.id,
        stepId: step.id,
        message: `Building context (provider: ${provider.name})...`,
      });

      // Get GPU pressure multiplier from the Context Watcher
      const compressionMultiplier = this.router.contextWatcher.getCompressionMultiplier();

      const { message, budgetReport } = await this.promptBuilder.build(
        project, step, provider.providerConfig, systemPrompt, compressionMultiplier,
      );

      this.log.info('Budget report', {
        used: budgetReport.used,
        remaining: budgetReport.remaining,
        dropped: budgetReport.droppedSlots,
      });

      // 5. Send to AI with retry/continuation logic
      let currentMessage = message;
      let accumulatedText = '';
      let accumulatedTokens = 0;
      let accumulatedCost = 0;
      
      const maxAttempts = this.config.maxRetries + 2;
      // Absolute iteration cap: prevents infinite loops when continuations and retries interact.
      // A step can accumulate up to maxContinuations (4) + maxAttempts iterations; cap hard at that sum.
      const MAX_TOTAL_ITERATIONS = maxAttempts + 4;
      let attempt = 1;
      let segmentCount = 1;
      let totalIterations = 0;

      while (attempt <= maxAttempts) {
        totalIterations++;
        if (totalIterations > MAX_TOTAL_ITERATIONS) {
          throw new Error(
            `[AUTO_RESET_REQUIRED] Step "${step.label}" exceeded absolute iteration cap (${MAX_TOTAL_ITERATIONS}). ` +
            `Possible infinite continuation loop. Auto-reset required.`
          );
        }
        try {
          this.eventBus.emit('step:progress', {
            projectId: project.id,
            stepId: step.id,
            message: segmentCount > 1 
              ? `Generating segment ${segmentCount}...`
              : `Generating (attempt ${attempt}/${maxAttempts})...`,
          });

          // Log exact prompt to SQLite telemetry before sending, for crash diagnostics
          this.stateStore.recordTelemetry(project.id, step.id, systemPrompt, currentMessage);

          // Reset accumulatedText for each NEW attempt (retry), but NOT during continuation passes.
          // Continuation is tracked by segmentCount > 1 — in that case we preserve accumulated text.
          if (segmentCount === 1) {
            accumulatedText = '';
          }

          const outputBudget = this.router.getOutputBudget(step.taskType);
          const thinking = this.router.getRecommendedThinking(step.taskType);

          const isCreativeStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';

          // ── Temperature Staging ──────────────────────────────────────
          // Vary temperature by scene type instead of uniform 0.85.
          // This creates natural texture variation across chapters.
          let temperature = 0.7; // default for non-creative steps
          if (isCreativeStep) {
            temperature = this.getSceneTemperature(currentMessage, step);
          }

          // ── Context Watcher: Record estimated usage + inject hallucination guard ──
          const estimatedPromptTokens = Math.ceil((systemPrompt.length + currentMessage.length) / 3.0);
          // FIX #14: GPU label is now dynamic based on the selected provider, not hardcoded.
          // If planning/bible steps are ever routed to a different GPU, this tracks them correctly.
          const gpuLabel = provider.name || 'Writer (5090)';
          this.router.contextWatcher.recordPromptTokens(gpuLabel, estimatedPromptTokens);

          // FIX #9: getHallucinationWarning was being called with 2 args but only accepts 1.
          // This caused a silent runtime error (TS2554 was visible in tsc output) and the
          // guard NEVER fired. Now correctly called with 1 arg; creative-step scoping is
          // handled here at the call site instead of inside the method.
          const hallucinationWarning = this.router.contextWatcher.getHallucinationWarning(gpuLabel);
          let effectiveMessage = currentMessage;
          if (hallucinationWarning && isCreativeStep) {
            effectiveMessage = currentMessage + hallucinationWarning;
            this.log.warn('Hallucination guard injected — context near capacity', {
              percentFull: this.router.contextWatcher.getStats().gpus.find(g => g.label === gpuLabel)?.percentFull,
            });
          }

          // ── Dynamic Outline Structure Constraints ──
          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const targetChs = project.context.targetChapters || 25;
            const structureConstraint =
              `\n\nCRITICAL ANTI-HALLUCINATION PROTOCOL:\n` +
              `You MUST strictly follow the exact structure of the project. You are required to generate data for exactly: ` +
              `${project.context.includePrologue ? 'Prologue, ' : ''}Chapters 1 through ${targetChs}${project.context.includeEpilogue ? ', and an Epilogue' : ''}.\n` +
              `Do NOT invent new chapters. Do NOT skip chapters. Do NOT merge the Epilogue into the final chapter.\n\n` +
              `MANDATORY FORMAT — every chapter MUST use this EXACT header (numeric digit, NOT a word):\n` +
              `## Chapter 1: [Title]\n` +
              `**POV:** [Character]\n` +
              `**Key Events:** [events]\n` +
              `...\n\n` +
              `## Chapter 2: [Title]\n...\n\n` +
              `Do NOT use tables, Roman numerals, or word-numbers ("Chapter One"). ` +
              `Use "## Chapter 1:", "## Chapter 2:", etc. exactly. ` +
              `Generate ALL ${targetChs} chapters in one continuous response.`;
            effectiveMessage += structureConstraint;
          }

          let currentMessages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_calls?: any[] }> = [
            { role: 'user', content: effectiveMessage }
          ];

          let response: CompletionResponse | null = null;
          let toolLoopActive = true;
          let safetyCounter = 0;

          const availableTools = this.mcpClient.getTools();
          
          const allowedToolTasks = ['planning', 'book_cover', 'research', 'outline'];
          const useTools = allowedToolTasks.includes(step.taskType);
          
          while (toolLoopActive && safetyCounter < 10) {
            safetyCounter++;
            response = await this.router.complete({
              provider: provider.id,
              system: systemPrompt,
              messages: currentMessages,
              maxTokens: outputBudget,
              temperature,
              thinking,
              repeatPenalty: isCreativeStep ? 1.15 : undefined,
              tools: (useTools && availableTools.length > 0) ? availableTools : undefined,
            });

            if (response.toolCalls && response.toolCalls.length > 0) {
              this.log.info(`AI requested ${response.toolCalls.length} tool calls`);
              
              // Append assistant message with tool calls
              currentMessages.push({
                role: 'assistant',
                content: response.text || '',
                tool_calls: response.toolCalls
              });

              // Execute all tools and append results
              for (const tc of response.toolCalls) {
                try {
                  const result = await this.mcpClient.executeTool(tc.function.name, JSON.parse(tc.function.arguments));
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: JSON.stringify(result)
                  });
                } catch (err: any) {
                  this.log.warn(`Tool execution failed: ${tc.function.name}`, { error: err.message });
                  currentMessages.push({
                    role: 'tool',
                    name: tc.function.name,
                    content: `Error executing tool: ${err.message}`
                  });
                }
              }
            } else {
              // No tool calls, generation is complete
              toolLoopActive = false;
            }
          }

          if (!response) {
            throw new Error('No response generated by the AI router.');
          }

          // Feed actual token usage back to the Context Watcher
          if (response.promptTokens) {
            this.router.contextWatcher.recordActualUsage(
              'Writer (5090)',
              response.promptTokens,
              response.completionTokens || 0,
            );
          }

          // Add to our totals
          accumulatedCost += response.estimatedCost || 0;
          accumulatedTokens += response.tokensUsed || 0;

          // Budget enforcement — halt if cloud spend exceeds limits
          if (response.estimatedCost && response.estimatedCost > 0) {
            const withinBudget = this.costTracker.recordCost(project.id, response.estimatedCost);
            if (!withinBudget) {
              throw new Error(`Budget exceeded for project ${project.id}. Pipeline halted.`);
            }
          }
          
          // Append text with a spacing
          if (accumulatedText.length > 0 && response.text.trim().length > 0) {
            accumulatedText += '\n\n';
          }
          accumulatedText += response.text.trim();

          // FIX #7: Minimum response validation is now task-type aware.
          // A 50-char 'PASS' verdict is a valid pov_check response.
          // A 50-char response from a creative_writing step is a catastrophic failure.
          // For prose steps, enforce a minimum word count (not character count).
          if (isCreativeStep) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const minWords = step.wordCountTarget ? Math.floor(step.wordCountTarget * 0.3) : 300;
            if (wordCount < minWords) {
              throw new Error(
                `Prose response too short (${wordCount} words). ` +
                `Minimum for this step: ${minWords} words. Retrying...`
              );
            }
          } else if (accumulatedText.length < this.config.minResponseLength) {
            throw new Error(
              `Response too short (${accumulatedText.length} chars). ` +
              `Minimum: ${this.config.minResponseLength}. Retrying...`
            );
          }

          // ── Dynamic Segmentation removed to prevent infinite repetition loops ──

          // ── Duplicate Content Safety Check ──
          // Run before storing — detects if the AI re-generated content
          // that already exists in the accumulated text (continuation bug).
          if (isCreativeStep) {
            accumulatedText = this.dedup.deduplicateContent(accumulatedText, step.id, project.id);
          }

          // ── Smart Continuation System ──
          // Ollama stops when num_predict is exhausted (~8k tokens). If the output is
          // shorter than the target, feed the tail back in as an anchor and continue.
          if (isCreativeStep && step.wordCountTarget) {
            const wordCount = accumulatedText.split(/\s+/).filter(Boolean).length;
            const threshold = step.taskType === 'revision_execution' ? 0.70 : 0.90;
            const minWords = Math.floor(step.wordCountTarget * threshold);
            const maxWords = Math.floor(step.wordCountTarget * 1.20);
            const maxContinuations = 4;

            if (wordCount > maxWords) {
              this.log.warn('Chapter exceeded max word count cap — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget, maxAllowed: maxWords,
              });
            } else if (wordCount < minWords && segmentCount <= maxContinuations) {
              // Output was truncated — build a continuation prompt using:
              // 1. A Librarian (5070 Ti) briefing summarising what's been written so far
              // 2. The last 200 words as a prose anchor for seamless continuation
              const words = accumulatedText.split(/\s+/);
              const tailWords = words.slice(-200).join(' ');
              const remaining = step.wordCountTarget - wordCount;

              this.log.info('Output truncated by num_predict — requesting Librarian briefing', {
                currentWords: wordCount, target: step.wordCountTarget, remaining, segmentCount,
              });
              this.eventBus.emit('step:progress', {
                projectId: project.id,
                stepId: step.id,
                message: `Output truncated (${wordCount}/${step.wordCountTarget} words). Librarian briefing continuation... (part ${segmentCount + 1})`,
              });

              // Ask the Librarian (gemma3:12b on 5070 Ti) to summarise the accumulated text
              // as a structured source of truth for the Writer's continuation prompt.
              let librarianBriefing = '';
              try {
                const briefingPrompt =
                  `You are a story continuity analyst. Read the following partial chapter draft and produce a concise structured briefing.\n\n` +
                  `DRAFT SO FAR (${wordCount} words):\n---\n${accumulatedText.slice(-4000)}\n---\n\n` +
                  `Produce ONLY this structured briefing (max 250 words):\n` +
                  `**Scene Location:** [where we are right now]\n` +
                  `**Characters Present:** [who is in the scene and their current state]\n` +
                  `**Events So Far:** [bullet list of what has happened, 3-5 points]\n` +
                  `**Unresolved Tension:** [what conflict or question is still open]\n` +
                  `**What Must Happen Next:** [what the continuation must cover to complete the chapter arc]\n` +
                  `**Prose Tail (last line):** [copy the exact last sentence of the draft above]`;

                // Route to the Librarian (gemma3:12b on 5070 Ti / ollama-embeddings container).
                // Falls back to main ollama if librarian is unavailable.
                const librarianProvider = this.router.getProvider('librarian') ? 'librarian' : 'ollama';
                const briefingResponse = await this.router.complete({
                  provider: librarianProvider,
                  system: 'You are a concise story continuity analyst. Output only the requested structured briefing. No preamble.',
                  messages: [{ role: 'user', content: briefingPrompt }],
                  maxTokens: 512,
                  temperature: 0.3,
                });
                librarianBriefing = briefingResponse.text.trim();
                this.log.info('Librarian continuation briefing received', {
                  briefingLength: librarianBriefing.length, segmentCount,
                });
              } catch (err: any) {
                this.log.warn('Librarian briefing failed — falling back to tail-only continuation', { error: err.message });
              }

              // Build continuation prompt with briefing + prose tail
              const briefingBlock = librarianBriefing
                ? `\n\n[CHAPTER STATE — from Librarian analysis]:\n${librarianBriefing}\n`
                : '';

              currentMessage = message +
                briefingBlock +
                `\n\n[CONTINUATION INSTRUCTION]: The model stopped mid-generation. Continue the story seamlessly.\n` +
                `The prose so far ends with:\n---\n${tailWords}\n---\n` +
                `Continue EXACTLY from where the text ends. Do NOT re-introduce characters or restart the scene. ` +
                `Write approximately ${remaining} more words to complete the segment. ` +
                `Do NOT repeat any text already written.`;

              segmentCount++;
              attempt--; // Don't burn a retry slot on a continuation
              continue; // Re-enter the while loop without incrementing attempt
            } else if (wordCount < minWords) {
              this.log.warn('Segment below target after max continuations — accepting as-is', {
                currentWords: wordCount, target: step.wordCountTarget, segmentCount,
              });
            }
          } else if (step.wordCountTarget) {
            // Non-creative steps: just log if below target
            const wordCount = accumulatedText.split(/\s+/).length;
            const minWords = Math.floor(step.wordCountTarget * 0.70);
            if (wordCount < minWords) {
              this.log.info('Step below word count target — accepting result', {
                currentWords: wordCount, target: step.wordCountTarget,
              });
            }
          }

          // ── Outline Structure Validation ──
          // Standalone block — runs for outline steps regardless of wordCountTarget.
          if (['Chapter Outline', 'Chapter-by-Chapter Outline', 'Tension Blueprint', 'Scene-Level Breakdown'].includes(step.label)) {
            const missingChapters: number[] = [];
            const thinChapters: number[] = [];
            const targetCh = project.context.targetChapters || 25;

            // Word-number fallback for models that ignore the format instruction
            const WORD_NUMS: Record<number, string> = {
              1:'One',2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',
              10:'Ten',11:'Eleven',12:'Twelve',13:'Thirteen',14:'Fourteen',15:'Fifteen',
              16:'Sixteen',17:'Seventeen',18:'Eighteen',19:'Nineteen',20:'Twenty',
              21:'Twenty-?One',22:'Twenty-?Two',23:'Twenty-?Three',24:'Twenty-?Four',
              25:'Twenty-?Five',26:'Twenty-?Six',27:'Twenty-?Seven',28:'Twenty-?Eight',
              29:'Twenty-?Nine',30:'Thirty',31:'Thirty-?One',32:'Thirty-?Two',
              33:'Thirty-?Three',34:'Thirty-?Four',35:'Thirty-?Five',36:'Thirty-?Six',
              37:'Thirty-?Seven',38:'Thirty-?Eight',39:'Thirty-?Nine',40:'Forty',
            };

            for (let i = 1; i <= targetCh; i++) {
              const wordNum = WORD_NUMS[i] || '';
              // Catches: ## Chapter 1, **Chapter 1**, Chapter 1, # Chapter 1,
              //          1. Title / 1: Title (start of line), Chapter One, ## Chapter One
              const chRegex = new RegExp(
                `(?:#+\\s*(?:Chapter\\s+)?0?${i}\\b` +
                `|\\*{1,2}Chapter\\s+0?${i}\\b` +
                `|^Chapter\\s+0?${i}\\b` +
                `|^0?${i}[.:]\\s` +
                (wordNum ? `|Chapter\\s+${wordNum}\\b` : '') +
                `)`,
                'im'
              );
              const chMatch = accumulatedText.match(chRegex);
              if (!chMatch) {
                missingChapters.push(i);
              } else {
                const chStart = accumulatedText.indexOf(chMatch[0]);
                const chSection = accumulatedText.substring(chStart, chStart + 500).replace(/\s+/g, ' ').trim();
                if (chSection.length < 100) {
                  thinChapters.push(i);
                }
              }
            }
            let missingEpi = false;
            if (project.context.includeEpilogue && !accumulatedText.match(/Epilogue/i)) {
              missingEpi = true;
            }

            if (missingChapters.length > 0 || missingEpi) {
              // ── Outline Continuation System ──────────────────────────────────────
              // Distinguish between format failure (all chapters missing = model used wrong format)
              // and genuine truncation (some chapters missing = model ran out of tokens).
              const MAX_OUTLINE_CONTINUATIONS = 4;
              if (segmentCount <= MAX_OUTLINE_CONTINUATIONS) {
                const resumeFrom = missingChapters.length > 0 ? missingChapters[0] : targetCh + 1;
                const epilogueNote = missingEpi ? ` and then the Epilogue` : '';
                const isFormatFailure = resumeFrom === 1;

                this.log.info('Outline continuation triggered', {
                  resumeFrom, missingCount: missingChapters.length, segmentCount, isFormatFailure,
                });
                this.eventBus.emit('step:progress', {
                  projectId: project.id,
                  stepId: step.id,
                  message: isFormatFailure
                    ? `Outline format not recognised — retrying with strict enforcement... (attempt ${segmentCount + 1})`
                    : `Outline truncated at Ch${resumeFrom - 1}. Continuing from Ch${resumeFrom}... (segment ${segmentCount + 1})`,
                });

                const outlineTail = accumulatedText.split(/\n/).slice(-10).join('\n').trim();

                if (isFormatFailure) {
                  // Model used wrong format — restart with amplified instructions
                  currentMessage = message +
                    `\n\n[FORMAT ENFORCEMENT — Attempt ${segmentCount + 1}]:\n` +
                    `Your previous response did not use the required "## Chapter N:" header format. ` +
                    `The automated pipeline could not detect any chapters in your output. ` +
                    `You MUST restart the outline using EXACTLY this format for every chapter:\n` +
                    `## Chapter 1: [Title]\n**POV:** [name]\n**Key Events:** ...\n\n` +
                    `## Chapter 2: [Title]\n...\n\n` +
                    `Use NUMERIC digits (1, 2, 3 — NOT One, Two, Three). ` +
                    `Generate ALL ${targetCh} chapters now.`;
                  accumulatedText = ''; // Clear bad format so it isn't merged
                } else {
                  // Genuine truncation — inject continuation anchor
                  currentMessage = message +
                    `\n\n[OUTLINE CONTINUATION — Segment ${segmentCount + 1}]:\n` +
                    `You have already written the outline up to Chapter ${resumeFrom - 1}. ` +
                    `The text so far ends with:\n---\n${outlineTail}\n---\n\n` +
                    `Continue IMMEDIATELY from **## Chapter ${resumeFrom}** through **Chapter ${targetCh}**${epilogueNote}. ` +
                    `Use the same "## Chapter N: [Title]" format. ` +
                    `Do NOT repeat any chapters already written. Start with "## Chapter ${resumeFrom}:".`;
                }

                segmentCount++;
                attempt--; // Don't burn a retry slot
                continue;
              }

              // All continuation slots exhausted — burn a retry slot
              throw new Error(`Structural hallucination detected: Missing Chapter(s) ${missingChapters.join(', ')} ${missingEpi ? 'and Epilogue' : ''}. Retrying...`);
            }
            if (thinChapters.length > 0) {
              throw new Error(`Thin outline detected: Chapter(s) ${thinChapters.join(', ')} have placeholder content (<100 chars). Retrying...`);
            }
          }

          result = accumulatedText;
          this.log.info('AI response received and finalized', {
            tokens: accumulatedTokens,
            cost: accumulatedCost,
            provider: response.provider,
            length: result.length,
            wordCount: result.split(/\s+/).length,
          });

          // ── Universal Quality Auditor Pass ──
          // Only audit creative output — analytical steps (pov_check, stat_update, etc.)
          // have structured formats the Auditor incorrectly rejects, causing retry loops.
          const AUDITABLE_TASKS = ['creative_writing', 'revision_execution'];
          // Use the Librarian (5070 Ti) for the audit pass as a 'second set of eyes'
          if (provider && AUDITABLE_TASKS.includes(step.taskType)) {
            const auditProviderId = this.router.getProvider('librarian') ? 'librarian' : provider.id;
            const auditProvider = this.router.getProvider(auditProviderId) || provider;
            
            this.eventBus.emit('step:progress', {
              projectId: project.id,
              stepId: step.id,
              message: `Generation complete. Running Quality Auditor Pass (${auditProvider.name})...`,
            });

            // We feed the exact same systemPrompt and currentMessage to the auditor
            // so it has the full project context (Bible, summaries) to accurately grade the output.
            const auditSystem = systemPrompt + `\n\n[ROLE OVERRIDE]: You are now acting as the strict Quality Control Auditor.`;
            const auditMessage = currentMessage + `\n\n==================================================\n` +
              `[WRITER'S GENERATED OUTPUT TO AUDIT]:\n${result}\n\n` +
              `==================================================\n` +
              `[AUDITOR INSTRUCTIONS]:\n` +
              `Does the Writer's Generated Output accurately reflect the context, satisfy the task instructions, and avoid severe hallucinations/formatting errors?\n` +
              `You MUST write a brief 1-2 sentence critique FIRST before giving your verdict.\n` +
              `CRITICAL GUARDRAIL: You must ONLY output VERDICT: FAIL if the text is catastrophically broken (e.g., severe hallucinations, wrong character POV, completely ignored prompt, formatting failure).\n` +
              `DO NOT fail the text for minor stylistic issues (e.g., clichés, "show vs tell", pacing, repetitive dialogue tags). If the text is structurally sound but stylistically imperfect, you MUST output VERDICT: PASS.\n` +
              `At the very end of your response, on a new line, you MUST output exactly one of the following verdicts:\n` +
              `VERDICT: PASS\n` +
              `VERDICT: FAIL`;

            const auditResponse = await auditProvider.complete({
              provider: auditProvider.id,
              system: auditSystem,
              messages: [{ role: 'user', content: auditMessage }],
              maxTokens: 1024,
              temperature: 0.1,
            });

            if (auditResponse.text.includes('VERDICT: FAIL')) {
              let critique = auditResponse.text.replace(/VERDICT:\s*FAIL/i, '').trim();
              // Strip out any <think> tags Qwen3.6 might inject
              critique = critique.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
              if (!critique) critique = "No reason provided by Auditor. Output deemed catastrophically broken.";
              
              this.log.warn('Quality Auditor rejected output', { step: step.label, critique });
              throw new Error(`[AUDITOR REJECTION]: ${critique}`);
            }
          }

          break; // Success! Break out of the loop
        } catch (err: any) {
          lastError = err;
          this.log.warn(`Attempt ${attempt} failed`, { error: err.message });
          
          // If this was an auditor rejection, append the critique to the prompt for the next attempt
          if (err.message.startsWith('[AUDITOR REJECTION]:')) {
            const critique = err.message.replace('[AUDITOR REJECTION]:', '').trim();
            // Replace (not append) any prior rejection block to prevent prompt bloat
            // that pushes the message past the context window, stripping the model's bible/outline.
            currentMessage = currentMessage.replace(
              /\n\n\[SYSTEM ALERT: Your previous attempt was REJECTED[\s\S]*?(?=\n\n\[|$)/,
              ''
            );
            currentMessage += `\n\n[SYSTEM ALERT: Your previous attempt was REJECTED by the Quality Auditor. Reason:\n${critique}\n\nPlease redo the task and fix these issues.]`;
            segmentCount = 1; // Reset segment count for the fresh attempt
          }
          
          // On an actual failure (e.g. timeout), we retry the exact same currentMessage.
          if (attempt < maxAttempts) {
            // Try fallback provider on subsequent attempts
            const fallback = this.router.getFallbackProvider(provider.id);
            if (fallback) {
              this.log.info('Switching to fallback provider', { fallback: fallback.id });
            }
            // Exponential backoff: 2s → 4s → 8s → 16s (capped at 30s)
            // Prevents hammering Ollama when it's recovering from OOM
            const backoffMs = Math.min(30_000, 2000 * Math.pow(2, attempt - 1));
            this.log.info(`Retrying in ${backoffMs / 1000}s...`, { attempt, backoffMs });
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
          attempt++;
        }
      }

      if (!result) {
        const errorMsg = `Step failed after ${maxAttempts} attempts: ${lastError?.message}`;
        this.stateStore.failStep(project.id, step.id, errorMsg);
        this.eventBus.emit('step:failed', {
          projectId: project.id,
          stepId: step.id,
          error: errorMsg,
        });
        throw new Error(errorMsg);
      }
    }

    if (!result) {
      throw new Error('Step failed to produce a result.');
    }

    // ── Mechanical Formatting Overrides ──
    if (step.label === 'Stat System Definition') {
      result = this.forceRelationshipMatrixFormat(result);
    }

    // 6. Save result
    this.stateStore.completeStep(project.id, step.id, result);

    // Save to disk as markdown
    await this.saveStepToDisk(project, step, result);

    // 7. Emit completion event (ContextEngine will auto-index via EventBus)
    this.eventBus.emit('step:completed', {
      projectId: project.id,
      stepId: step.id,
      result,
    });

    this.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Completed: ${step.label}`,
    });

    // 8. Quality Gates — auto-rewrite chapters that fail checks
    if (step.taskType === 'pov_check') {
      result = await this.povGate.apply(project, step, result);
      // Re-save to disk so the user sees the automated prose metrics appended
      await this.saveStepToDisk(project, step, result);
      // ── Feature 1: Score Time-Series Tracking ───────────────────────────
      // Extract scores from the POV check and append to scores.csv
      if (project.type === 'style-calibration') {
        this.autoLearning.recordPovScores(project.id, step.label, result).catch(err =>
          this.log.warn('Score tracking failed (non-fatal)', { error: (err as Error).message })
        );

        // ── Auto-source 3: Full Scene Injection (PASS or high-scoring REVISE) ──
        // Mine scenes with PASS verdict or REVISE + Deep POV ≥ 8 as positive training examples.
        const verdictMatch = result.match(/Verdict(?:[\s:*]+)(PASS|REVISE|REWRITE)/i);
        const deepPovMatch = result.match(/Deep POV(?: Score)?(?:[\s:*]+)(\d+)/i);
        const verdict = verdictMatch?.[1]?.toUpperCase() || 'UNKNOWN';
        const deepPovScore = deepPovMatch ? parseInt(deepPovMatch[1]) : 0;

        if (verdict === 'PASS' || (verdict === 'REVISE' && deepPovScore >= 8)) {
          const sceneTypeMatch = step.label.match(/\b(Action|Dialogue|Introspection|Setting)\b/i);
          const sceneType = sceneTypeMatch ? sceneTypeMatch[1].toLowerCase() : 'scene';
          const compiledStep = project.steps.find(
            s => s.taskType === 'draft_compile' &&
                 s.chapterNumber === step.chapterNumber &&
                 s.status === 'completed' && s.result
          );
          if (compiledStep?.result) {
            this.autoLearning.minePassedScene(project.id, sceneType, compiledStep.result, verdict, deepPovScore).catch(err =>
              this.log.warn('Full scene mining failed (non-fatal)', { error: (err as Error).message })
            );
          }
        }
      }
    }

    if (step.taskType === 'continuity_check') {
      await this.continuityGate.apply(project, step, result);
    }
    if (step.taskType === 'revision_audit') {
      await this.revisionGate.apply(project, step, result);
    }

    // 9. Auto-apply Style Calibration directives
    // Extract style directives from EVERY Calibration Summary pass.
    // This allows the model to self-heal and update its DNA infinitely across
    // multiple passes without waiting for the final pass.
    if (project.type === 'style-calibration' && step.taskType === 'analysis' && step.label.includes('Summary')) {
      let positive: string[] = [];
      let negative: string[] = [];
      
      const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed)) {
            // Legacy format fallback
            negative = parsed;
          } else {
            // New structured format
            positive = parsed.positive || [];
            negative = parsed.negative || [];
          }
        } catch (e) {
          this.log.warn('Failed to parse JSON directives from calibration summary', { error: (e as any).message });
        }
      }
      
      // Fallback to legacy extraction if JSON missing/failed
      if (positive.length === 0 && negative.length === 0) {
        const lines = result.split('\n');
        const directives = lines
          .filter(l => l.match(/^[-*]\s+(?:DO|AVOID)/i))
          .map(l => l.replace(/^[-*]\s*/, '').trim());
        
        positive = directives.filter(d => d.startsWith('DO:'));
        negative = directives.filter(d => d.startsWith('AVOID:'));
      }
      
      if (positive.length > 0 || negative.length > 0) {
        this.styleDna.applyDirectivesToGlobal(positive, negative, true); // OVERWRITE with compressed DNA
        this.log.info('Calibration pass completed — auto-compressed global DNA', { 
          positiveCount: positive.length, 
          negativeCount: negative.length 
        });
      } else {
        this.log.warn('Calibration pass completed but no DO/AVOID directives found in output', { step: step.label });
      }

      // ── Auto-Learning Pipeline ──────────────────────────────────────────
      // After DNA compression: export JSONL training data and (every 5 passes)
      // regenerate the perry-writer Modelfile with the latest learned corrections.
      const passMatch = step.label.match(/^Pass (\d+):/);
      const completedPass = passMatch ? parseInt(passMatch[1]) : 0;
      // Fire-and-forget — non-fatal, runs in background without blocking next step
      this.autoLearning.onPassComplete(completedPass, project.id).catch(err =>
        this.log.warn('Auto-learning background task failed', { error: (err as Error).message })
      );

      // Check if Infinite Calibration is enabled
      if (project.context.isInfiniteCalibration) {
        // Extract the current pass number
        const match = step.label.match(/^Pass (\d+):/);
        if (match) {
          const currentPass = parseInt(match[1]);
          const nextPass = currentPass + 1;
          const nextIdx = project.steps.length + 1; // Avoid duplicate IDs
          
          this.log.info('Infinite Calibration Loop active. Generating next pass...', { nextPass });
          
          // Re-fetch project to ensure we have the most up to date context if it was updated
          const freshProject = this.stateStore.get(project.id) || project;
          
          // Inject the newly compressed DNA into the prompt for the NEXT summary pass
          const currentDna = {
            positive: this.styleDna.getGlobalRules().positiveDirectives || [],
            negative: this.styleDna.getGlobalRules().tropeWarnings || []
          };
          const totalChapters = freshProject.context.targetChapters || 25;
          // Rebuild the shared context block with anti-patterns — same logic as buildSteps.
          // Do NOT pass freshProject.description here — that is just the user's synopsis, not the
          // calibration anti-pattern block that the writer model needs injected every pass.
          const infiniteSharedContext = [
            `## NOVEL CONTEXT`,
            `Title: "${freshProject.title}"`,
            ...(freshProject.description ? [``, `## PROJECT DESCRIPTION`, freshProject.description] : []),
            ``,
            `## WORLD & CHARACTER CONTEXT (from Book Bible)`,
            `MANDATORY: You MUST consult the 'Character Bible', 'Faction Bible', and 'World Building' documents in your context.`,
            `Use the exact character traits, faction allegiances, and sensory rules defined there.`,
            ``,
            `## YOUR TASK`,
            `This is a STYLE CALIBRATION TEST — not a chapter of the final manuscript.`,
            `Your output will be evaluated by a strict POV Quality Gate immediately after generation.`,
            `Choose your own POV character from the cast — pick whoever fits the scene type best.`,
            ``,
            ``,
            `## ANTI-PATTERNS — DO NOT USE THESE`,
            `1. "In the blink of an eye" for action transitions`,
            `2. "The weight of the world" clichés in introspective moments`,
            `3. Overusing "Quantum" as a noun (e.g., "a quantum of dread")`,
            `4. "Ghostly" or "Soulless" to describe digital entities`,
            `5. "Heartbeats of the Drift" as a metaphor`,
            `6. "The storm of emotions" in character reactions`,
            `7. Filter words: felt, noticed, saw, heard, realized, wondered, thought`,
            `8. Repetitive dialogue tags (hissed, growled, snapped, exclaimed, etc.)`,
            `9. "The Drift whispered" as passive agency`,
            `10. "Data streams flowed like rivers" for technical descriptions`,
            `11. AI-isms and cliché words: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth"`,
            `12. Overdramatic physical reactions: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding"`,
            `13. Grandiose metaphorical filler: "a delicate dance", "beacon of hope", "silent guardian", "symphony of destruction"`,
            ``,
            `## STRICT NEGATIVE CONSTRAINTS (MANDATORY)`,
            `1. NEVER use "Negative Telling" — never describe what a character *didn't* do or feel (e.g., "he didn't flinch"). Only describe concrete actions they *did* take.`,
            `2. NO "Analytical Summaries" — DO NOT explain the "meaning" or "purpose" of any action or setting. Only state the raw sensory facts and let the reader infer the stakes.`,
            `3. AVOID "Syntactic Monotony" — DO NOT start consecutive sentences with the same pronoun or noun (e.g., "He", "The"). Vary sentence openings using prepositional phrases, gerunds, or action beats.`,
          ].join('\n');
          const nextSteps = generateCalibrationPassSteps(nextPass, nextIdx, freshProject.title, infiniteSharedContext, false, currentDna, totalChapters);
          
          freshProject.steps.push(...nextSteps);
          this.stateStore.save(freshProject);
        }
      }
    }
    if (step.taskType === 'manuscript_cleanup') {
      await this.continuityGate.applyManuscriptCleanup(project, step, result);
    }
    // Revision Brief (Pass H) — parse verdict and act
    if (step.taskType === 'revision_check' && step.label.includes('Revision Brief')) {
      await this.revisionGate.apply(project, step, result);
    }

    return result;
  }

  /**
   * Execute all pending steps in a project sequentially.
   */
  async executeAll(project: Project): Promise<void> {
    let step = this.stateStore.getNextPendingStep(project.id);
    while (step) {
      // Re-fetch project to get latest state
      const current = this.stateStore.get(project.id);
      if (!current || current.status === 'paused') break;

      // Automatically wait if training is active on the GPU to prevent OOM
      const trainingFlagPath = path.join(process.cwd(), 'workspace', 'training', 'TRAINING_IN_PROGRESS.flag');
      let waitingLogged = false;
      while (fs.existsSync(trainingFlagPath)) {
        if (!waitingLogged) {
          this.log.info('Pipeline paused automatically: LoRA training is in progress on the GPU.', { project: current.title });
          waitingLogged = true;
        }
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds before checking again
      }
      if (waitingLogged) {
        this.log.info('Pipeline resumed: LoRA training complete. Reloading configuration...', { project: current.title });
        // this.config.load();
      }

      try {
        await this.execute(current, step);
      } catch (err: any) {
        // Check for auto-recoverable errors
        if (err.message && err.message.startsWith('[AUTO_RESET_REQUIRED]')) {
          const s = current.steps.find(x => x.id === step!.id);
          if (s) {
            s.autoResetCount = (s.autoResetCount || 0) + 1;
            if (s.autoResetCount <= 3) {
              this.log.warn('Auto-recovering from infinite continuation loop (Resetting Step)', { 
                project: project.title, 
                step: step.label,
                autoResetCount: s.autoResetCount
              });
              s.status = 'pending';
              s.result = undefined;
              s.error = undefined;
              s.startedAt = undefined;
              s.completedAt = undefined;
              this.stateStore.save(current);
              
              // Emit event to update dashboard
              this.eventBus.emit('step:failed', {
                projectId: project.id,
                stepId: step.id,
                error: `Auto-resetting step (Attempt ${s.autoResetCount}/3) due to loop.`,
              });

              // Re-fetch next pending step (which should be the same step we just reset)
              step = this.stateStore.getNextPendingStep(project.id);
              continue;
            } else {
              this.log.error('Step exceeded maximum auto-resets. Halting pipeline.', { project: project.title, step: step.label });
              // Modify error message for final failure
              err.message = 'Step permanently failed after 3 auto-resets due to infinite continuation loops.';
            }
          }
        }

        // Step failed — project is already set to 'paused' by failStep.
        // Emit the pause event so the SSE/dashboard updates immediately.
        this.eventBus.emit('project:paused', { projectId: project.id });
        this.log.warn('Pipeline halted due to step failure', {
          project: project.title,
          step: step.label,
          error: err.message,
        });
        return;
      }
      step = this.stateStore.getNextPendingStep(project.id);
    }
  }

  // Quality gates, Style DNA, dedup, cleanup extracted to:
  //   quality-gates/{pov,continuity,revision}-gate.ts
  //   services/{deduplication,prose-sanitizer}.ts


  /**
   * Detect if the POV character changed between Part 1 and Part 2 of a compiled scene.
   * Uses a name-frequency heuristic. Returns a description of the fracture or null.
   */
  private detectPovFracture(part1: string, part2: string): string | null {
    if (!part1 || !part2) return null;
    const extractDominantName = (text: string): [string, number] | null => {
      const counts = new Map<string, number>();
      // Match capitalised words preceded by a lowercase char (not sentence starters)
      const matches = text.match(/(?<=[a-z,;!?"'] )[A-Z][a-z]{2,15}/g) || [];
      const skip = new Set(['The','His','Her','She','He','They','But','And','For','With','Its']);
      for (const name of matches) {
        if (!skip.has(name)) counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (counts.size === 0) return null;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top[1] > 2 ? top : null;
    };
    const d1 = extractDominantName(part1);
    const d2 = extractDominantName(part2);
    if (!d1 || !d2) return null;
    if (d1[0] !== d2[0]) {
      return `Part 1 centres on "${d1[0]}" (${d1[1]}x), Part 2 shifts to "${d2[0]}" (${d2[1]}x)`;
    }
    return null;
  }

  /** Detect the POV character for a chapter step from the outline */
  private detectPovCharacter(project: Project, step: ProjectStep): string | undefined {
    if (!step.chapterNumber) return undefined;

    let outlineResult: string | undefined;
    if (project.parentId) {
      const parent = this.stateStore.get(project.parentId);
      const outlineStep = parent?.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) {
      const outlineStep = project.steps.find(s => s.label.includes('Outline') && s.phase === 'outline');
      outlineResult = outlineStep?.result;
    }
    if (!outlineResult) return undefined;

    const chapterSection = outlineResult.match(
      new RegExp(`Chapter\\s+${step.chapterNumber}\\b[\\s\\S]*?(?=Chapter\\s+${step.chapterNumber + 1}\\b|$)`, 'i')
    );
    if (!chapterSection) return undefined;

    const povMatch = chapterSection[0].match(/POV(?:\s+Character)?[:\s]+([^\n(]+)/i);
    if (povMatch) return povMatch[1].trim();

    return undefined;
  }

  private buildSystemPrompt(project: Project, step: ProjectStep): string {
    // BUG FIX N2: Analytical steps get a completely different system identity.
    // Previously all steps received writer-mode instructions ("Output ONLY raw story prose",
    // "NEVER summarize", prose rhythm rules) even for pov_check/analysis steps.
    // The model was then asked to grade in the user message — fighting the system prompt.
    //
    // 'research' is also analytical — Market Analysis should not receive prose style instructions.
    const analyticalTypes = ['pov_check', 'stat_update', 'continuity_check', 'revision_audit', 'analysis', 'research'];

    // 'outline' and 'voice_profile' are planning/architect tasks — they need structured data output,
    // NOT the Writer persona ("Output ONLY raw story prose"). Adding them to planningTypes
    // prevents the model from entering creative writing mode for outline and voice steps.
    const planningTypes = ['book_bible', 'outline', 'voice_profile'];

    if (analyticalTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. Analytical Engine — a strict literary critic and quality auditing system.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are NOT a creative writer. You are an auditor and grader.\n`;
      prompt += `OUTPUT FORMAT: Return ONLY the structured evaluation format specified in your task prompt.\n`;
      prompt += `CRITICAL: Do NOT write story content. Do NOT continue the narrative. Do NOT output prose. Grade, analyse, and report only.\n`;
      prompt += `CRITICAL: Do NOT summarise the plot or characters. Evaluate the PROSE TECHNIQUE against the criteria given.\n`;
      return prompt;
    }

    if (planningTypes.includes(step.taskType)) {
      let prompt = `You are the P.E.R.R.Y. System — an expert fiction plotting and world-building architect.\n\n`;
      prompt += `You are working on: "${project.title}"\n`;
      prompt += `Current task: ${step.label}\n\n`;
      prompt += `ROLE: You are an architect of fiction. Your job is to structure, track, and define the narrative elements.\n`;
      prompt += `INSTRUCTIONS: Complete the ENTIRE task in full. Do not skip sections, do not summarize unless explicitly asked, and do not use placeholders.\n`;
      // FIX #11: Replaced negative constraints with positive framing.
      // "Do not write story prose" is a negative constraint — consistent with the positive-framing
      // philosophy applied throughout the pipeline. State what to DO, not what not to do.
      prompt += `FORMATTING: Begin your response immediately with the first section heading. Output structured data only — tables, definitions, and lists. No preamble, no narrative prose.\n`;
      return prompt;
    }

    let prompt = `You are the P.E.R.R.Y. System (Predictive Engine for Rapid Revision & Yield), an expert fiction writing AI assistant.\n\n`;
    prompt += `You are working on: "${project.title}"\n`;
    prompt += `Current task: ${step.label}\n\n`;

    if (step.taskType === 'creative_writing' && step.wordCountTarget) {
      prompt += `TARGET WORD COUNT: ${step.wordCountTarget} words.\n`;
      prompt += `Write the COMPLETE chapter. Do not summarize, truncate, or use placeholders.\n\n`;
    }

    if (project.context.isSeries && project.context.seriesTotalBooks && project.context.seriesCurrentBook) {
      prompt += `SERIES CONTEXT: This is Book ${project.context.seriesCurrentBook} of a ${project.context.seriesTotalBooks}-book series.\n`;
      if (project.context.seriesCurrentBook === 1) {
        prompt += `WARNING: Do NOT resolve the overarching series conflict in this book. Plant hooks, establish mysteries, and build the world for future books. Resolve only the immediate book-level plot.\n\n`;
      } else if (project.context.seriesCurrentBook === project.context.seriesTotalBooks) {
        prompt += `WARNING: This is the final book. Bring all overarching series conflicts and character arcs to a definitive resolution.\n\n`;
      } else {
        prompt += `WARNING: This is a middle book. Advance the overarching series plot while maintaining and resolving its own self-contained narrative arc.\n\n`;
      }
    }

    // Anti-laziness instruction (moved from V4's global injection to here where it belongs)
    prompt += `INSTRUCTIONS: Complete the ENTIRE task in full. Do not skip sections, `;
    prompt += `do not summarize, do not use placeholders, and never cite processing limits. `;
    prompt += `Generate the complete requested output.\n`;
    prompt += `CRITICAL FORMATTING INSTRUCTION: Output ONLY the raw story prose. Do NOT output any conversational filler, introductory remarks, or revision notes (e.g. "Here is the revised chapter..."). Do NOT explain what you changed. Just output the story.\n`;
    // NOTE: The old STRICT FORMATTING BAN was replaced with positive framing.
    // Negative constraints ("NEVER use X") cause fine-tuned models to memorize
    // and regurgitate the constraint list as prose output.
    prompt += `PUNCTUATION: End sentences with periods. Use em-dashes sparingly (max 2 per 400 words). Commas, semicolons, and periods are preferred.\n`;

    // ── Style DNA Seed Injection ──────────────────────────────────────────────
    // Inject the compact DNA seed into the system prompt for creative writing
    // and revision execution steps. This replaces the old approach of dumping
    // the full 4,000+ token DNA blob into the user message.
    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      const povCharacter = this.detectPovCharacter(project, step);
      const seed = this.styleDna.compileSeed(project.id, step.chapterNumber || 0, povCharacter);
      if (seed) {
        prompt += `\n${seed}\n`;
      }

      // ── Golden Examples Injection ───────────────────────────────
      // Concrete before/after pairs are more effective than abstract rules.
      // The model pattern-matches on corrected prose rather than following logic.
      const stepLabel = step.label.toLowerCase();
      const sceneType: 'action' | 'dialogue' | 'introspection' | 'general' =
        stepLabel.includes('action') ? 'action' :
        stepLabel.includes('dialogue') ? 'dialogue' :
        stepLabel.includes('introspection') ? 'introspection' : 'general';
      const goldenExamples = this.styleDna.compileGoldenExamples(sceneType, 5);
      if (goldenExamples) {
        prompt += `\n${goldenExamples}\n`;
      }

      // ── Imperfection Injection ────────────────────────────────────────────
      // Instruct the AI to write through the POV character's cognitive lens,
      // introducing natural human imperfection rather than omniscient narration.
      if (povCharacter) {
        prompt += `\n## COGNITIVE LENS (${povCharacter.toUpperCase()})\n`;
        prompt += `Write ONLY what ${povCharacter} would perceive, notice, and misinterpret.\n`;
        prompt += `- Use vocabulary and metaphors drawn from their background and expertise\n`;
        prompt += `- Have them MISS things outside their knowledge domain\n`;
        prompt += `- Include 1-2 moments where they misjudge, misremember, or have a blind spot\n`;
        prompt += `- Their internal monologue should have imperfect grammar — fragments, trailing thoughts, self-corrections\n`;
        prompt += `- Do NOT make every character equally articulate in dialogue. Match their education and emotional state.\n`;
      }

      // ── Prose Rhythm Instruction ──────────────────────────────────────────
      // Core instruction to break AI sentence monotony
      prompt += `\n## PROSE RHYTHM (CRITICAL)\n`;
      prompt += `Vary sentence length aggressively. Follow a 15-word sentence with a 3-word fragment. `;
      prompt += `Then a 30-word compound sentence. Use one-word paragraphs for emphasis. `;
      prompt += `Never write 3+ consecutive sentences of similar length. `;
      prompt += `Include at least one intentional sentence fragment per page of prose.\n`;

      // ── Anti-AI Cliches Instruction ───────────────────────────────────────
      prompt += `\n## ANTI-AI CLICHES (CRITICAL)\n`;
      prompt += `- DO NOT use the "Rule of Three" (e.g., "He was a ghost. He was a glitch. He was a variable."). Stop structuring lists or descriptions in threes.\n`;
      prompt += `- AVOID explicit, repetitive dialogue tags ("X said", "Y replied" every line). Use action beats instead.\n`;
      prompt += `- MINIMIZE nominalization and abstract nouns (e.g., use "fluid" instead of "fluidness", "synchronize" instead of "synchronization"). Use strong, active verbs.\n`;
      prompt += `- AVOID formulaic fragments (e.g., "He gasped. A wet sound.", "She smiled. A sad expression."). Describe the action naturally.\n`;
      prompt += `- BAN cliché similes (e.g., "heart hammering like a trapped bird", "eyes like pools").\n`;
      prompt += `- DO NOT use the word "transcend".\n`;
    }

    return prompt;
  }

  /**
   * Get the temperature for a creative writing step based on scene type signals.
   * Different scene types benefit from different randomness levels:
   *   - Dialogue: 0.92-0.98 (high creativity for natural speech)
   *   - Emotional/introspective: 0.88-0.92 (rich internal voice)
   *   - Action/combat: 0.72-0.78 (tight, precise prose)
   *   - Exposition/worldbuilding: 0.75-0.80 (factual consistency)
   *   - Default creative: 0.82-0.88 (balanced)
   *
   * A small jitter (±0.03) is added so no two chapters have identical texture.
   */
  private getSceneTemperature(promptContent: string, step: ProjectStep): number {
    const lower = promptContent.toLowerCase();
    const jitter = (Math.random() - 0.5) * 0.06; // ±0.03

    // Prologue/Epilogue tend to be more atmospheric
    if (step.chapterNumber === 0 || step.label.includes('Epilogue')) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }

    // Detect scene type from outline content or prompt keywords
    // Expanded keyword sets to catch natural outline phrasing variations
    const dialogueSignals = ['dialogue', 'conversation', 'argues', 'confronts', 'discusses', 'reveals to',
      'argument', 'debate', 'interrogat', 'negotiate', 'plea', 'confides', 'whispers', 'shouts',
      'phone call', 'meeting', 'interview', 'confront'];
    const actionSignals = ['fight', 'battle', 'chase', 'escape', 'combat', 'explosion', 'attack', 'ambush',
      'pursuit', 'siege', 'shootout', 'brawl', 'duel', 'assault', 'raid', 'standoff', 'flee',
      'infiltrat', 'heist', 'break-in', 'car crash', 'collapse'];
    const emotionalSignals = ['grief', 'loss', 'revelation', 'betrayal', 'confession', 'emotional', 'mourns',
      'heartbreak', 'reunion', 'forgive', 'breakdown', 'crying', 'trauma', 'funeral', 'goodbye',
      'intimate', 'vulnerable', 'regret', 'shame', 'guilt'];
    const expositionSignals = ['discovers', 'explains', 'world-building', 'exposition', 'lore', 'politics',
      'research', 'briefing', 'debrief', 'history', 'backstory', 'flashback', 'investigation',
      'intel', 'data', 'report', 'map', 'archives', 'council'];

    const hasDialogue = dialogueSignals.some(s => lower.includes(s));
    const hasAction = actionSignals.some(s => lower.includes(s));
    const hasEmotion = emotionalSignals.some(s => lower.includes(s));
    const hasExposition = expositionSignals.some(s => lower.includes(s));

    // Priority: action (tight) > dialogue (loose) > emotion (rich) > exposition (precise)
    if (hasAction && !hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.75 + jitter));
    }
    if (hasDialogue) {
      return Math.min(1.0, Math.max(0.7, 0.95 + jitter));
    }
    if (hasEmotion) {
      return Math.min(1.0, Math.max(0.7, 0.90 + jitter));
    }
    if (hasExposition) {
      return Math.min(1.0, Math.max(0.7, 0.78 + jitter));
    }

    // Default creative temperature with jitter
    return Math.min(1.0, Math.max(0.7, 0.85 + jitter));
  }

  /**
   * Unload all Ollama models from GPU VRAM to free memory for
   * image generation (ComfyUI/FLUX) or text rendering (Qwen).
   */
  public async flushOllamaVram(): Promise<void> {
    try {
      const ollamaUrls = [
        process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434',
        process.env.OLLAMA_LIBRARIAN_BASE_URL ?? 'http://ollama-embeddings:11434',
      ];

      for (const url of ollamaUrls) {
        const psRes = await fetch(`${url}/api/ps`).catch(() => null);
        if (psRes && psRes.ok) {
          const psData = await psRes.json() as { models: Array<{ name: string }> };
          for (const m of psData.models) {
            await fetch(`${url}/api/generate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: m.name, keep_alive: 0 }),
            }).catch(() => null);
            this.log.info('Unloaded Ollama model to free VRAM', { url, model: m.name });
          }
        }
      }
    } catch (err) {
      this.log.warn('Failed to clear Ollama VRAM', { error: String(err) });
    }
  }

  /**
   * Forces the Section B "Relationship Dynamics Matrix" to be exactly 6 columns,
   * automatically splitting the "Pair" column if the LLM hallucinated a 5-column layout.
   */
  private forceRelationshipMatrixFormat(markdown: string): string {
    const lines = markdown.split('\n');
    let inSectionB = false;
    let outLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^##\s*B\.\s*Relationship/i) || line.match(/^##\s*\*\*B\.\s*Relationship/i)) {
        inSectionB = true;
        outLines.push(line);
        continue;
      }
      
      // Stop processing Section B when we hit Section C
      if (inSectionB && (line.match(/^##\s*C\./i) || line.match(/^##\s*\*\*C\./i))) {
        inSectionB = false;
        outLines.push(line);
        continue;
      }

      if (inSectionB && line.trim().startsWith('|')) {
        const cells = line.split('|').map(c => c.trim());
        // Remove empty first and last cells from split
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();

        if (cells.length === 5) { // Hallucinated Pair format!
          // Header row
          if (cells[0].toLowerCase().includes('pair')) {
            outLines.push(`| First Character | Second Character | ${cells.slice(1).join(' | ')} |`);
          } 
          // Divider row
          else if (cells[0].includes('---')) {
            outLines.push(`|---|---|${cells.slice(1).map(() => '---').join('|')}|`);
          } 
          // Data row
          else {
            const pairRaw = cells[0];
            // Split by ↔, <->, -, "and", "vs"
            let splitPair = [pairRaw, '?'];
            if (pairRaw.includes('↔')) splitPair = pairRaw.split('↔');
            else if (pairRaw.includes('<->')) splitPair = pairRaw.split('<->');
            else if (pairRaw.includes(' and ')) splitPair = pairRaw.split(' and ');
            else if (pairRaw.includes(' vs ')) splitPair = pairRaw.split(' vs ');
            else if (pairRaw.includes(' - ')) splitPair = pairRaw.split(' - ');
            else if (pairRaw.includes('-')) splitPair = pairRaw.split('-');
            
            // Remove markdown bolding if present
            const charA = (splitPair[0]?.trim() || pairRaw).replace(/\*\*/g, '');
            const charB = (splitPair[1]?.trim() || '?').replace(/\*\*/g, '');

            outLines.push(`| ${charA} | ${charB} | ${cells.slice(1).join(' | ')} |`);
          }
        } else {
          // Already 6 columns (or completely broken), just pass through
          outLines.push(line);
        }
      } else {
        outLines.push(line);
      }
    }

    return outLines.join('\n');
  }

  private async saveStepToDisk(project: Project, step: ProjectStep, result: string): Promise<void> {
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const baseDir = join(this.config.workspaceDir, 'projects', `${project.id}-${slug}`);
    
    // Strict isolation into subdirectories based on phase/taskType
    let subDir = 'analysis';
    if (step.phase === 'writing' || step.taskType === 'creative_writing') subDir = 'manuscript';
    else if (step.taskType === 'export') subDir = 'exports';
    else if (step.phase === 'revision' || step.taskType.includes('revision')) subDir = 'revisions';
    else if (step.phase === 'planning') subDir = 'planning';
    
    const dir = join(baseDir, subDir);
    await mkdir(dir, { recursive: true });

    // Sanitize prose output for creative writing and revision execution steps
    const isProseStep = step.taskType === 'creative_writing' || step.taskType === 'revision_execution';
    const dedupedResult = isProseStep ? this.dedup.deduplicateOutput(result) : result;
    const cleanResult = isProseStep ? this.sanitizer.sanitize(dedupedResult) : dedupedResult;

    const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50)}.md`;

    // Format content based on step type for clear visual distinction
    let content: string;
    const isCalibration = project.type === 'style-calibration';

    if (step.taskType === 'creative_writing' || step.taskType === 'revision_execution') {
      // ── Prose Output ──
      if (isCalibration) {
        // Pure prose only for training data — no headers, no metadata
        content = cleanResult;
      } else {
        content = [
          `# ${step.label}`,
          ``,
          `> **Model:** ${this.config.workspaceDir ? 'perry-writer' : 'unknown'} | **Generated:** ${new Date().toISOString().split('T')[0]}`,
          ``,
          `---`,
          ``,
          `## 📝 Generated Prose`,
          ``,
          cleanResult,
        ].join('\n');
      }
    } else if (step.taskType === 'pov_check') {
      // ── Critic / Analysis Output ──
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** POV Quality Audit | **Evaluated:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 🔍 Critic Analysis`,
        ``,
        cleanResult,
      ].join('\n');
    } else if (step.taskType === 'draft_compile') {
      // ── Compiled Scene ──
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** Compiled Scene | **Assembled:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 📖 Compiled Scene`,
        ``,
        cleanResult,
      ].join('\n');
    } else if (step.taskType === 'analysis' && isCalibration) {
      // ── Calibration Summary ──
      content = [
        `# ${step.label}`,
        ``,
        `> **Type:** Calibration Summary | **Pass:** ${new Date().toISOString().split('T')[0]}`,
        ``,
        `---`,
        ``,
        `## 📊 Improvement Directives`,
        ``,
        cleanResult,
      ].join('\n');
    } else {
      // ── Default ──
      content = `# ${step.label}\n\n${cleanResult}`;
    }

    await writeFile(join(dir, filename), content, 'utf-8');
  }
}

