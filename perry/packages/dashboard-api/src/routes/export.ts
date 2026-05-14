/**
 * @perry/dashboard-api — Export Routes
 */

import { Router } from 'express';
import { exportBlurb, generateDocxBuffer, generateEpubBuffer } from '@perry/export';
import { Logger } from '@perry/core';
import multer from 'multer';

const upload = multer();

export function setupExportRoutes(log: Logger) {
  const router = Router();

  router.post('/blurb', (req, res) => {
    try {
      const { content } = req.body;
      if (!content) return res.status(400).json({ error: 'Content required' });

      const result = exportBlurb(content);
      res.json(result);
    } catch (err: any) {
      log.error('Blurb export failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });


  router.post('/docx', (req, res) => {
    try {
      generateDocxBuffer(req.body).then((buffer: any) => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${req.body.title || 'export'}.docx"`);
        res.send(buffer);
      }).catch((err: any) => {
        log.error('DOCX export failed', { error: err.message });
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      log.error('DOCX export failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });


  // Handle multipart/form-data for epub because it might include a cover image
  router.post('/epub', upload.single('coverImage'), (req, res) => {
    try {
      const options = { ...req.body };
      if (req.file) {
        options.coverImageBuffer = req.file.buffer;
      }

      generateEpubBuffer(options).then((buffer: any) => {
        res.setHeader('Content-Type', 'application/epub+zip');
        res.setHeader('Content-Disposition', `attachment; filename="${req.body.title || 'export'}.epub"`);
        res.send(buffer);
      }).catch((err: any) => {
        log.error('EPUB export failed', { error: err.message });
        res.status(500).json({ error: err.message });
      });
    } catch (err: any) {
      log.error('EPUB export failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
