/**
 * Model management routes — pull/remove Ollama models, query state per
 * endpoint, suggest models for new installs.
 *
 * Wraps the Ollama HTTP API directly (no docker exec). Perry already
 * talks to ollama + ollama-embeddings over HTTP; reusing those channels.
 *
 * Endpoints:
 *   GET    /models?endpoint=...      Per-endpoint model list with sizes
 *   POST   /models/pull              Pull a model (streams SSE progress)
 *   DELETE /models                   Delete a model (body: {endpoint, name})
 *   GET    /models/show              Show modelfile for a model
 *   GET    /models/suggestions       Curated list of recommended models
 *
 * Per the shareability goal, this is the path a new user takes to get
 * started — they install Perry, open the Models tab, click "Pull
 * recommended models for my hardware" → Perry does the work.
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { AIRouter } from '@perry/ai';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

interface OllamaEndpoint {
  id: 'writer' | 'librarian';
  label: string;
  url: string;
}

export function setupModelsRoutes(aiRouter: AIRouter, log: Logger) {
  const router = Router();

  // The two Ollama endpoints Perry knows about. Future: pull from config.
  const endpoints = (): OllamaEndpoint[] => {
    const writer = process.env.OLLAMA_BASE_URL
      || aiRouter.config.get<string>('ai.ollama.endpoint', 'http://ollama:11434');
    const librarian = process.env.OLLAMA_LIBRARIAN_BASE_URL
      || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://ollama-embeddings:11434');
    return [
      { id: 'writer', label: 'Writer (5090)', url: writer },
      { id: 'librarian', label: 'Librarian (5070 Ti)', url: librarian },
    ];
  };

  // ── List models per endpoint ───────────────────────────────────────
  router.get('/models', async (req, res) => {
    const filter = (req.query.endpoint as string) || null;
    const eps = endpoints().filter(e => !filter || e.id === filter);
    const out: any[] = [];
    for (const ep of eps) {
      try {
        const r = await fetch(`${ep.url}/api/tags`);
        const data: any = await r.json();
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          digest: (m.digest || '').slice(0, 12),
          parameter_size: m.details?.parameter_size,
          quant: m.details?.quantization_level,
          family: m.details?.family,
        }));
        out.push({ endpoint: ep.id, label: ep.label, url: ep.url, ok: true, models });
      } catch (e: any) {
        out.push({ endpoint: ep.id, label: ep.label, url: ep.url, ok: false, error: e.message, models: [] });
      }
    }
    res.json({ endpoints: out });
  });

  // ── Pull a model (streamed progress via SSE) ───────────────────────
  // POST /models/pull?token=<API_KEY>   body: { endpoint, name }
  // (token in query because EventSource can't send headers, and we want
  // to stream the pull progress back to the dashboard.)
  router.post('/models/pull', async (req, res) => {
    const { endpoint, name } = req.body || {};
    if (!endpoint || !name) {
      return res.status(400).json({ error: 'endpoint and name are required' });
    }
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    log.info('pulling model', { endpoint, name, url: ep.url });

    try {
      const r = await fetch(`${ep.url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!r.ok || !r.body) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: `pull failed: HTTP ${r.status}` })}\n\n`);
        res.end();
        return;
      }
      // Stream Ollama's NDJSON progress lines through to the client.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            res.write(`event: progress\ndata: ${JSON.stringify(parsed)}\n\n`);
            if (parsed.status === 'success') {
              res.write(`event: complete\ndata: ${JSON.stringify({ name, endpoint })}\n\n`);
            }
          } catch { /* skip unparseable line */ }
        }
      }
      res.end();
    } catch (e: any) {
      log.error('pull failed', { name, endpoint, error: e.message });
      try { res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`); } catch { /* ignore */ }
      res.end();
    }
  });

  // ── Delete a model ─────────────────────────────────────────────────
  router.delete('/models', async (req, res) => {
    const { endpoint, name } = req.body || {};
    if (!endpoint || !name) {
      return res.status(400).json({ error: 'endpoint and name are required' });
    }
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    try {
      const r = await fetch(`${ep.url}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ ok: false, error: txt });
      }
      log.info('model deleted', { endpoint, name });
      res.json({ ok: true, endpoint, name });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Show modelfile ─────────────────────────────────────────────────
  router.get('/models/show', async (req, res) => {
    const endpoint = req.query.endpoint as string;
    const name = req.query.name as string;
    if (!endpoint || !name) return res.status(400).json({ error: 'endpoint and name required' });
    const ep = endpoints().find(e => e.id === endpoint);
    if (!ep) return res.status(400).json({ error: `unknown endpoint: ${endpoint}` });

    try {
      const r = await fetch(`${ep.url}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        return res.status(r.status).json({ ok: false, error: await r.text() });
      }
      const data: any = await r.json();
      res.json({ ok: true, ...data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Curated suggestions ────────────────────────────────────────────
  // Hand-picked models that fit Perry's roles. Aimed at the first-run
  // experience — a new user clicks "pull recommended" and gets a working
  // local stack with no decisions required.
  router.get('/models/suggestions', (_req, res) => {
    res.json({
      suggestions: [
        // Researchers — book-planning research synthesis
        { name: 'qwen3.6:27b', role: 'researcher', endpoint: 'librarian',
          size_gb: 17, description: 'Default researcher. Strong markdown synthesis. Fits on 24GB+ GPU.' },
        // Librarians — fast generalist chat / extraction / Director
        { name: 'qwen3:14b', role: 'librarian', endpoint: 'librarian',
          size_gb: 9, description: 'Default librarian + Director backend. Fast, good at tool calling.' },
        { name: 'gemma3:12b', role: 'librarian', endpoint: 'librarian',
          size_gb: 8, description: 'Alternative librarian. Google\'s model; good for English-only.' },
        // Writers — book voice (this is the slot a pen-specific LoRA replaces)
        { name: 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M', role: 'writer', endpoint: 'writer',
          size_gb: 23, description: 'Default writer base. Pen-specific LoRAs train on top.' },
        // Future: vision-capable model for image-input agents
        { name: 'qwen2.5vl:7b', role: 'vision', endpoint: 'librarian',
          size_gb: 6, description: 'For image-input agents (cover review, screenshot reading).' },
        // Future: code-specific model for code domain
        { name: 'qwen2.5-coder:7b', role: 'code', endpoint: 'librarian',
          size_gb: 5, description: 'Local code model. Optional — code agents use Claude/Gemini workers by default.' },
      ],
    });
  });

  // ── Sync required models across Ollama and ComfyUI ──────────────────
  router.get('/models/sync/status', async (req, res) => {
    if (isSyncing) {
      return res.json({ isSyncing, tasks: syncTasks });
    }

    const tasks: any[] = [];

    // 1. Ollama Models
    const writerUrl = process.env.OLLAMA_BASE_URL || aiRouter.config.get<string>('ai.ollama.endpoint', 'http://ollama:11434');
    const librarianUrl = process.env.OLLAMA_LIBRARIAN_BASE_URL || aiRouter.config.get<string>('ai.ollama.librarianEndpoint', 'http://ollama-embeddings:11434');

    let writerInstalled: string[] = [];
    try {
      const r = await fetch(`${writerUrl}/api/tags`);
      if (r.ok) {
        const data: any = await r.json();
        writerInstalled = (data.models || []).map((m: any) => m.name);
      }
    } catch {}

    let librarianInstalled: string[] = [];
    try {
      const r = await fetch(`${librarianUrl}/api/tags`);
      if (r.ok) {
        const data: any = await r.json();
        librarianInstalled = (data.models || []).map((m: any) => m.name);
      }
    } catch {}

    const reqWriterModels = Array.from(new Set([
      aiRouter.config.get<string>('ai.ollama.model', 'hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M'),
      aiRouter.config.get<string>('ai.ollama.researcherModel', 'qwen3.6:27b'),
      aiRouter.config.get<string>('ai.ollama.directorModel', 'qwen3:14b')
    ].filter(Boolean)));

    for (const model of reqWriterModels) {
      const isInstalled = writerInstalled.some(m => m === model || m.startsWith(model.split(':')[0] + ':'));
      tasks.push({
        id: `ollama-writer-${model}`,
        name: model,
        type: 'ollama',
        endpoint: 'writer',
        endpointUrl: writerUrl,
        status: isInstalled ? 'completed' : 'pending',
        progress: isInstalled ? 100 : 0,
        sizeNote: isInstalled ? '✓ Installed' : 'Pending download'
      });
    }

    const reqLibrarianModels = Array.from(new Set([
      aiRouter.config.get<string>('ai.ollama.librarianModel', 'gemma3:12b'),
      aiRouter.config.get<string>('ai.ollama.embedModel', 'nomic-embed-text')
    ].filter(Boolean)));

    for (const model of reqLibrarianModels) {
      const isInstalled = librarianInstalled.some(m => m === model || m.startsWith(model.split(':')[0] + ':'));
      tasks.push({
        id: `ollama-librarian-${model}`,
        name: model,
        type: 'ollama',
        endpoint: 'librarian',
        endpointUrl: librarianUrl,
        status: isInstalled ? 'completed' : 'pending',
        progress: isInstalled ? 100 : 0,
        sizeNote: isInstalled ? '✓ Installed' : 'Pending download'
      });
    }

    // 2. ComfyUI Models
    let comfyCheckpoints: string[] = [];
    let comfyUnets: string[] = [];
    let comfyVaes: string[] = [];
    let comfyClips: string[] = [];
    let comfyLoras: string[] = [];
    let comfyReachable = false;

    const comfyUrl = process.env.COMFYUI_BASE_URL || 'http://comfyui:8188';
    try {
      const comfyRes = await fetch(`${comfyUrl}/object_info`);
      if (comfyRes.ok) {
        comfyReachable = true;
        const data: any = await comfyRes.json();
        comfyCheckpoints = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        comfyUnets = data?.UNETLoader?.input?.required?.unet_name?.[0] || [];
        comfyVaes = data?.VAELoader?.input?.required?.vae_name?.[0] || [];
        comfyClips = data?.DualCLIPLoader?.input?.required?.clip_name1?.[0] || [];
        comfyLoras = data?.LoraLoader?.input?.required?.lora_name?.[0] || data?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
      }
    } catch {}

    const comfyRequired = [
      { name: 'flux1-dev.safetensors', category: 'unet', url: 'https://huggingface.co/lllyasviel/flux_decoders/resolve/main/flux1-dev.safetensors', list: comfyUnets },
      { name: 'ae.safetensors', category: 'vae', url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/ae.safetensors', list: comfyVaes },
      { name: 'clip_l.safetensors', category: 'clip', url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors', list: comfyClips },
      { name: 't5xxl_fp16.safetensors', category: 'clip', url: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors', list: comfyClips },
      { name: 'bookcover-redmond-fluxklein.safetensors', category: 'loras', url: 'https://huggingface.co/artificialguybr/BookCoverRedmond/resolve/main/BookCoverRedmond.safetensors', list: comfyLoras },
      { name: 'v1-5-pruned-emaonly.safetensors', category: 'checkpoints', url: 'https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors', list: comfyCheckpoints }
    ];

    for (const item of comfyRequired) {
      const isInstalled = comfyReachable && item.list.includes(item.name);
      tasks.push({
        id: `comfyui-${item.category}-${item.name}`,
        name: item.name,
        type: 'comfyui',
        endpoint: 'comfyui',
        category: item.category,
        url: item.url,
        status: isInstalled ? 'completed' : comfyReachable ? 'pending' : 'failed',
        progress: isInstalled ? 100 : 0,
        sizeNote: isInstalled ? '✓ Installed' : comfyReachable ? 'Pending download' : '⚠ ComfyUI unreachable'
      });
    }

    syncTasks = tasks;
    res.json({ isSyncing, tasks: syncTasks });
  });

  router.post('/models/sync/start', async (req, res) => {
    if (isSyncing) {
      return res.status(400).json({ error: 'Sync already in progress' });
    }

    const pending = syncTasks.filter(t => t.status === 'pending');
    if (pending.length === 0) {
      return res.json({ message: 'All models are already installed' });
    }

    isSyncing = true;
    res.json({ message: 'Sync started', tasksCount: pending.length });

    (async () => {
      for (const task of pending) {
        try {
          if (task.type === 'ollama') {
            await pullOllamaModel(task.endpointUrl, task.name, task, log);
          } else if (task.type === 'comfyui') {
            const stageFileName = `stage_${task.category}_${task.name}`;
            await downloadComfyUIModel(task.url, stageFileName, task.category, task.name, task, log);
          }
        } catch (err: any) {
          task.status = 'failed';
          task.error = err.message;
          task.sizeNote = `⚠ Error: ${err.message}`;
          log.error('Model sync task failed', { taskId: task.id, error: err.message });
        }
      }
      isSyncing = false;
    })();
  });

  return router;
}

let syncTasks: any[] = [];
let isSyncing = false;

function bytes(n: number): string {
  if (!n) return '?';
  const gb = n / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`;
}

async function downloadComfyUIModel(
  url: string,
  stageFileName: string,
  destCategory: string,
  destFileName: string,
  task: any,
  log: Logger
) {
  const stageDir = '/app/workspace/comfyui-output';
  const stageFilePath = join(stageDir, stageFileName);

  await mkdir(stageDir, { recursive: true });

  log.info(`Starting download for ComfyUI model: ${destFileName} from ${url}`);
  task.status = 'downloading';
  task.progress = 0;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    const fileStream = createWriteStream(stageFilePath);
    
    // Using response.body readable stream reader to download
    const reader = response.body!.getReader();
    let downloadedBytes = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      downloadedBytes += value.length;
      if (totalBytes > 0) {
        task.progress = Math.round((downloadedBytes / totalBytes) * 100);
        task.sizeNote = `${(downloadedBytes / 1e9).toFixed(2)} GB / ${(totalBytes / 1e9).toFixed(2)} GB`;
      } else {
        task.sizeNote = `${(downloadedBytes / 1e9).toFixed(2)} GB`;
      }
    }
    fileStream.end();

    log.info(`Download completed for ${destFileName}, staging moving to ComfyUI`);
    task.progress = 100;
    task.sizeNote = 'Moving model to destination folder…';

    // Ensure destination directory exists in ComfyUI
    await execPromise(`docker exec comfyui mkdir -p /root/ComfyUI/models/${destCategory}/`);

    // Move from output to destination folder
    await execPromise(`docker exec comfyui mv /root/ComfyUI/output/${stageFileName} /root/ComfyUI/models/${destCategory}/${destFileName}`);

    task.status = 'completed';
    task.sizeNote = '✓ Complete';
    log.info(`Successfully moved ComfyUI model ${destFileName} to /root/ComfyUI/models/${destCategory}/`);
  } catch (err: any) {
    log.error(`Failed to download ComfyUI model ${destFileName}`, { error: err.message });
    task.status = 'failed';
    task.error = err.message;
    task.sizeNote = `⚠ Error: ${err.message}`;
  }
}

async function pullOllamaModel(
  endpointUrl: string,
  modelName: string,
  task: any,
  log: Logger
) {
  log.info(`Starting pull for Ollama model: ${modelName} on ${endpointUrl}`);
  task.status = 'downloading';
  task.progress = 0;

  try {
    const r = await fetch(`${endpointUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!r.ok || !r.body) throw new Error(`Ollama pull failed: HTTP ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status === 'downloading' || parsed.status === 'pulling manifest') {
            if (parsed.completed && parsed.total) {
              task.progress = Math.round((parsed.completed / parsed.total) * 100);
              task.sizeNote = `${(parsed.completed / 1e9).toFixed(2)} GB / ${(parsed.total / 1e9).toFixed(2)} GB`;
            } else {
              task.sizeNote = parsed.status;
            }
          }
        } catch { /* skip */ }
      }
    }

    task.status = 'completed';
    task.progress = 100;
    task.sizeNote = '✓ Complete';
    log.info(`Successfully pulled Ollama model: ${modelName}`);
  } catch (err: any) {
    log.error(`Failed to pull Ollama model ${modelName}`, { error: err.message });
    task.status = 'failed';
    task.error = err.message;
    task.sizeNote = `⚠ Error: ${err.message}`;
  }
}
