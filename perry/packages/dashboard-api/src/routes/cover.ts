/**
 * @perry/dashboard-api — Cover Generation Route
 *
 * POST /api/cover/generate
 *   Accepts a ComfyUI params payload and triggers image generation
 *   directly — without going through a full project/step pipeline.
 *   Useful for quick testing or UI-triggered "generate now" actions.
 *
 * GET /api/cover/status
 *   Returns ComfyUI connection health and available checkpoint list.
 *
 * GET /api/cover/images
 *   Lists all generated cover images in the workspace/images directory.
 */

import { Router } from 'express';
import { ComfyUIService, QwenTextRenderService } from '@perry/ai';
import type { ComfyUIBookCoverParams } from '@perry/ai';
import { Logger } from '@perry/core';
import type { RagService } from '@perry/rag';
import { mkdir, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export function setupCoverRoutes(workspaceDir: string, log: Logger, rag?: RagService) {
  const router = Router();
  const comfyui = new ComfyUIService();
  const qwen = new QwenTextRenderService();
  const imagesDir = join(workspaceDir, 'images');

  /**
   * GET /api/cover/status
   * Returns ComfyUI health, available models, and Qwen availability.
   */
  router.get('/status', async (_req, res) => {
    try {
      const [comfyHealthy, qwenAvailable] = await Promise.all([
        comfyui.isHealthy(),
        qwen.isAvailable(),
      ]);

      let models = { checkpoints: [] as string[], unets: [] as string[], vaes: [] as string[], clips: [] as string[] };
      if (comfyHealthy) {
        models = await comfyui.listModels();
      }

      return res.json({
        comfyui: {
          healthy: comfyHealthy,
          url: process.env.COMFYUI_BASE_URL ?? 'http://comfyui:8188',
          models,
        },
        qwen: {
          available: qwenAvailable,
          model: process.env.QWEN_IMAGE_MODEL ?? 'qwen2.5vl:latest',
          ollamaUrl: process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434',
          role: 'Text placement analysis + typography compositing',
        },
        pipeline: {
          artwork: comfyHealthy ? 'FLUX.1-dev (ComfyUI)' : 'unavailable',
          textRendering: qwenAvailable ? 'Qwen2.5-VL (Ollama) + Node canvas' : 'Rule-based fallback + Node canvas',
          layouts: ['cover (832×1216)', 'banner (1216×512)', 'square (1024×1024)'],
        },
      });
    } catch (err: any) {
      log.error('Cover status check failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/cover/generate
   * Body: ComfyUIBookCoverParams JSON
   * Returns: { success, filename, file, width, height }
   */
  router.post('/generate', async (req, res) => {
    const params = req.body as ComfyUIBookCoverParams;

    if (!params.positive_prompt) {
      return res.status(400).json({ error: 'positive_prompt is required' });
    }

    log.info('Cover generation requested', {
      promptLength: params.positive_prompt.length,
      checkpoint: params.checkpoint ?? 'default',
    });

    try {
      // Health check
      const healthy = await comfyui.isHealthy();
      if (!healthy) {
        return res.status(503).json({
          error: 'ComfyUI is not reachable. Ensure the comfyui container is running.',
        });
      }

      const genResult = await comfyui.generateBookCover(params);

      if (!genResult.success || !genResult.imageBuffer) {
        return res.status(500).json({ error: genResult.error ?? 'Generation failed' });
      }

      // Save image
      await mkdir(imagesDir, { recursive: true });
      const outFilename = genResult.filename ?? `cover-adhoc-${Date.now()}.png`;
      const outPath = join(imagesDir, outFilename);
      await writeFile(outPath, genResult.imageBuffer);

      log.info('Cover image saved', { file: outPath });

      // Verified-success learning: a cover that made it through ComfyUI
      // without erroring AND produced a non-empty image buffer is a
      // working prompt — index it so the next cover request can pull
      // nearest-neighbour proven prompts. The verification bar is weak
      // (success != aesthetically good — user might still reject it),
      // so future work could upgrade the gate to require a "cover_kept"
      // signal once the dashboard tracks that. For now, "generation
      // didn't error" is the floor — at minimum it filters out broken
      // prompts that failed schema/workflow validation.
      if (rag && params.positive_prompt) {
        try {
          await rag.indexIfVerified({
            projectId: 'cover-gen',
            sourceRef: `cover-prompt-${genResult.promptId ?? Date.now()}`,
            kind: 'cover_prompt',
            text: params.positive_prompt,
            replace: false,
            metadata: {
              filename: outFilename,
              width: params.width ?? 832,
              height: params.height ?? 1216,
              negative_prompt: params.negative_prompt ?? null,
              checkpoint: (params as any).checkpoint ?? null,
            },
            gate: () => ({
              verified: !!genResult.imageBuffer && genResult.imageBuffer.length > 0,
              reason: `comfyui produced ${genResult.imageBuffer?.length ?? 0}-byte image`,
            }),
          });
        } catch (err: any) {
          log.warn('learning_cover_prompt index failed (non-fatal)', { error: err.message });
        }
      }

      return res.json({
        success: true,
        filename: outFilename,
        file: outPath,
        width: params.width ?? 832,
        height: params.height ?? 1216,
        promptId: genResult.promptId,
      });
    } catch (err: any) {
      log.error('Cover generation failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/cover/images
   * Lists all PNG files in the workspace images directory.
   */
  router.get('/images', async (_req, res) => {
    try {
      if (!existsSync(imagesDir)) {
        return res.json({ images: [] });
      }
      const files = await readdir(imagesDir);
      const images = files
        .filter(f => f.endsWith('.png'))
        .map(f => ({
          filename: f,
          path: join(imagesDir, f),
          url: `/api/cover/images/${encodeURIComponent(f)}`,
        }));
      return res.json({ images });
    } catch (err: any) {
      log.error('Failed to list cover images', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/cover/images/:filename
   * Serves a generated image file directly.
   */
  router.get('/images/:filename', async (req, res) => {
    const filename = req.params.filename;
    // Guard against path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = join(imagesDir, filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  });

  return router;
}
