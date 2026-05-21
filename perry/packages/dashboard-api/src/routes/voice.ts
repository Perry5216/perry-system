/**
 * @perry/dashboard-api — Voice (TTS + STT) proxy routes.
 *
 * Proxies to the perry-voice Python sidecar at `http://perry-voice:5005`.
 * The sidecar is opt-in — start it via `docker compose up -d perry-voice`.
 * If it's not running, these routes return 503 with a hint.
 *
 *   GET  /api/voice/healthz
 *   GET  /api/voice/voices?language=en
 *   GET  /api/voice/tts?text=...&voice=...     → streams audio/mpeg
 *   POST /api/voice/stt                         → JSON { text, language }
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import multer from 'multer';

const VOICE_URL = process.env.PERRY_VOICE_URL || 'http://perry-voice:5005';

export function setupVoiceRoutes(log: Logger) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  router.get('/healthz', async (_req, res) => {
    try {
      const r = await fetch(`${VOICE_URL}/healthz`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      res.json(await r.json());
    } catch (err: any) {
      res.status(503).json({
        error: 'perry-voice sidecar not reachable',
        hint: 'start it with: docker compose up -d perry-voice',
        underlying: err.message,
      });
    }
  });

  router.get('/voices', async (req, res) => {
    try {
      const lang = String(req.query.language || 'en');
      const r = await fetch(`${VOICE_URL}/voices?language=${encodeURIComponent(lang)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      res.json(await r.json());
    } catch (err: any) {
      res.status(503).json({ error: err.message, hint: 'is perry-voice running?' });
    }
  });

  router.get('/tts', async (req, res) => {
    try {
      const text = String(req.query.text || '');
      const voice = String(req.query.voice || 'en-US-AvaNeural');
      const rate = String(req.query.rate || '+0%');
      const pitch = String(req.query.pitch || '+0Hz');
      if (!text) return res.status(400).json({ error: 'text required' });
      const url = `${VOICE_URL}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}&pitch=${encodeURIComponent(pitch)}`;
      const r = await fetch(url);
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText.slice(0, 500) });
      }
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'inline; filename="speech.mp3"');
      // Pipe the upstream stream straight through. node-fetch v3+ returns a
      // web ReadableStream we have to bridge to an Express response.
      const reader = (r.body as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err: any) {
      log.warn('voice /tts proxy failed', { error: err.message });
      if (!res.headersSent) res.status(503).json({ error: err.message, hint: 'is perry-voice running?' });
      else res.end();
    }
  });

  router.post('/stt', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'audio file required (multipart field name: "audio")' });
      const lang = req.query.language ? `?language=${encodeURIComponent(String(req.query.language))}` : '';
      // Build a multipart payload for the sidecar.
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype || 'audio/wav' });
      formData.append('audio', blob, req.file.originalname || 'audio.wav');
      const r = await fetch(`${VOICE_URL}/stt${lang}`, { method: 'POST', body: formData as any });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText.slice(0, 500) });
      }
      res.json(await r.json());
    } catch (err: any) {
      log.warn('voice /stt proxy failed', { error: err.message });
      res.status(503).json({ error: err.message, hint: 'is perry-voice running?' });
    }
  });

  return router;
}
