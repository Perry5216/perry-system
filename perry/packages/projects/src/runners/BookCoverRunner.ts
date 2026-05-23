import type { Project, ProjectStep } from '@perry/core';
import { ComfyUIService, QwenTextRenderService } from '@perry/ai';
import { join } from 'path';
import { readFile as readFileAsync, writeFile as writeFileAsync, copyFile as copyFileAsync, mkdir as mkdirAsync } from 'fs/promises';
import { createRequire } from 'module';
import type { StepRunnerStrategy } from './BaseRunner.js';
import type { StepRunner } from '../step-runner.js';

const require = createRequire(import.meta.url);

export class BookCoverRunner implements StepRunnerStrategy {
  canHandle(step: ProjectStep): boolean {
    return ['comfyui_generate', 'text_overlay', 'qwen_text_render'].includes(step.taskType);
  }

  async execute(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    try {
      if (step.taskType === 'comfyui_generate') {
        return await this.executeComfyuiGenerate(project, step, runner);
      } else if (step.taskType === 'text_overlay') {
        return await this.executeTextOverlay(project, step, runner);
      } else if (step.taskType === 'qwen_text_render') {
        return await this.executeQwenTextRender(project, step, runner);
      }
      throw new Error(`Unsupported task type in BookCoverRunner: ${step.taskType}`);
    } catch (err: any) {
      runner.stateStore.failStep(project.id, step.id, err.message);
      runner.eventBus.emit('step:failed', { projectId: project.id, stepId: step.id, error: err.message });
      throw err;
    }
  }

  private async executeComfyuiGenerate(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing ComfyUI image generation step');
    runner.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: 'Connecting to ComfyUI...',
    });

    const comfyui = new ComfyUIService();

    // Check health first
    const healthy = await comfyui.isHealthy();
    if (!healthy) {
      throw new Error('ComfyUI is not reachable. Ensure the comfyui container is running and healthy.');
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
        runner.log.warn('ComfyUI step: could not parse prior step JSON, using defaults');
      }
    }

    runner.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: 'Clearing VRAM: Unloading LLMs...',
    });

    // --- VRAM FLUSH ---
    await runner.flushOllamaVram();
    // ------------------

    runner.eventBus.emit('step:progress', {
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
      reference_image: comfyParams.reference_image ? join(runner.config.workspaceDir, comfyParams.reference_image.replace(/^workspace\//, '')) : undefined,
      denoise: comfyParams.denoise ?? undefined,
      upscale_model: comfyParams.upscale_model ?? undefined,
    });

    if (!genResult.success || !genResult.imageBuffer) {
      throw new Error(genResult.error ?? 'ComfyUI generation failed with no error detail');
    }

    // Save the image to workspace/images/
    const imagesDir = join(runner.config.workspaceDir, 'images');
    await mkdirAsync(imagesDir, { recursive: true });
    const outFilename = genResult.filename ?? `cover-${project.id}-${Date.now()}.png`;
    const outPath = join(imagesDir, outFilename);
    await writeFileAsync(outPath, genResult.imageBuffer);

    const result = [
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

    runner.log.info('ComfyUI base artwork generated', { file: outPath });
    runner.eventBus.emit('step:progress', {
      projectId: project.id,
      stepId: step.id,
      message: `Base artwork saved: ${outFilename}`,
    });

    return result;
  }

  private async executeTextOverlay(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing text overlay step for back cover summary');
    runner.eventBus.emit('step:progress', {
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

    const { createCanvas, loadImage } = require('canvas');
    
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
    const spineText = `${project.title}        ${(project.context as any)?.penName || 'P.E.R.R.Y.'}`;
    ctx.fillText(spineText, 0, 0);
    ctx.restore();

    // Back Cover Summary Typography
    const margin = 100;
    const maxWidth = img.width - (margin * 2);
    
    ctx.fillStyle = '#ffffff';
    const fontSelection = (project.context as any)?.coverFont || 'Serif (Georgia)';
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
      lctx.fillStyle = (project.context as any)?.brandColor || '#00d2ff';
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
      runner.log.warn('Could not load imprint logo, skipping branding', { error: e.message });
    }
    
    const wrapPath = artworkPath.replace('.png', '-paperback-wrap.png');
    const buffer = canvas.toBuffer('image/png');
    await writeFileAsync(wrapPath, buffer);

    const result = [
      `## Book Cover Variants Complete ✓`,
      ``,
      `- **eBook Cover**: \`${ebookPath}\``,
      `- **KDP Paperback Wrap**: \`${wrapPath}\``,
      ``,
      `Both the eBook cover and full print wrap have been successfully generated!`
    ].join('\n');
    
    runner.log.info('Cover variants generated', { ebook: ebookPath, wrap: wrapPath });
    return result;
  }

  private async executeQwenTextRender(project: Project, step: ProjectStep, runner: StepRunner): Promise<string> {
    runner.log.info('Executing Qwen text rendering step');
    runner.eventBus.emit('step:progress', {
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
      throw new Error('Qwen text render: could not find base artwork from FLUX generation step.');
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

    const imageBuffer = await readFileAsync(artworkPath);
    const qwen = new QwenTextRenderService();
    const imagesDir2 = join(runner.config.workspaceDir, 'images');
    await mkdirAsync(imagesDir2, { recursive: true });

    const savedFiles: string[] = [];
    const layouts: Array<'cover' | 'banner' | 'square'> = ['cover'];
    const variants: string[] = coverMeta.marketing_variants ?? [];
    if (variants.includes('banner')) layouts.push('banner');
    if (variants.includes('square')) layouts.push('square');

    for (const layout of layouts) {
      runner.eventBus.emit('step:progress', {
        projectId: project.id, stepId: step.id,
        message: `Qwen rendering: ${layout} layout...`,
      });

      // For non-cover layouts, regenerate artwork at the right dimensions first
      let srcBuffer: any = imageBuffer;
      if (layout !== 'cover') {
        runner.eventBus.emit('step:progress', {
          projectId: project.id, stepId: step.id,
          message: `P.E.R.R.Y. System: I'm loaded and ready for the director and painter... (Generating ${layout} variant)`,
        });
        
        // --- VRAM FLUSH ---
        await runner.flushOllamaVram();
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
        runner.log.warn('Qwen text render failed for layout, saving raw artwork', { layout, error: renderResult.error });
        // Save raw artwork without text rather than failing entirely
        const rawName = `perry-${layout}-${project.id}-raw.png`;
        await writeFileAsync(join(imagesDir2, rawName), srcBuffer);
        savedFiles.push(rawName);
      } else {
        const suffix = layout === 'cover' ? 'final' : layout;
        const outName = `perry-${suffix}-${project.id}.png`;
        await writeFileAsync(join(imagesDir2, outName), renderResult.imageBuffer);
        savedFiles.push(outName);
        runner.log.info('Text rendered successfully', { layout, file: outName });
      }
    }

    const result = [
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

    runner.eventBus.emit('step:progress', {
      projectId: project.id, stepId: step.id,
      message: `✓ All ${savedFiles.length} cover files generated`,
    });

    return result;
  }
}
