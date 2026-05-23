/**
 * @perry/dashboard-api — Operator (user model) routes
 *
 *   GET    /api/operator           → profile + preferences + observation count
 *   PUT    /api/operator           → hand-edit profile/preferences
 *   POST   /api/operator/observe   → manual observation injection
 *   POST   /api/operator/distill   → trigger distillation pass
 */

import { Router } from 'express';
import type { Logger } from '@perry/core';
import type { OperatorProfileService } from '../services/operator-profile-service.js';
import type { AIRouter } from '@perry/ai';

export function setupOperatorRoutes(operatorProfile: OperatorProfileService, aiRouter: AIRouter, log: Logger) {
  const router = Router();

  router.get('/', (_req, res) => {
    try { res.json(operatorProfile.getProfile()); }
    catch (err: any) { log.error('GET /operator failed', { error: err.message }); res.status(500).json({ error: err.message }); }
  });

  router.put('/', (req, res) => {
    try {
      const { profile, preferences } = req.body || {};
      operatorProfile.setProfile(profile, preferences);
      res.json(operatorProfile.getProfile());
    } catch (err: any) {
      log.error('PUT /operator failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/observe', (req, res) => {
    try {
      const { detail } = req.body || {};
      if (typeof detail !== 'string' || detail.length === 0) {
        return res.status(400).json({ error: 'detail (string) required' });
      }
      operatorProfile.recordManual(detail);
      res.status(201).json({ recorded: true });
    } catch (err: any) {
      log.error('POST /operator/observe failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/distill', async (_req, res) => {
    try {
      const result = await operatorProfile.distill(async (prompt: string) => {
        // Use the librarian model for compression — same model as ChatMemoryService.
        const compressor = (aiRouter as any).compressor;
        if (!compressor) throw new Error('AIRouter has no compressor configured');
        try {
          const r = await compressor.compress({ text: prompt, mode: 'context_briefing' });
          return r?.compressed || '';
        } catch { return ''; }
      });
      res.json(result);
    } catch (err: any) {
      log.error('POST /operator/distill failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/persona', (req, res) => {
    try {
      const { persona } = req.body || {};
      const ALLOWED = ['writer', 'coder', 'gm', 'security'];
      if (!ALLOWED.includes(persona)) {
        return res.status(400).json({ error: `persona must be one of: ${ALLOWED.join(', ')}` });
      }
      operatorProfile.initializePersona(persona as any);
      res.json({ success: true, profile: operatorProfile.getProfile() });
    } catch (err: any) {
      log.error('POST /operator/persona failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/setup', async (req, res) => {
    try {
      const { name, persona, interests, style, tone } = req.body || {};
      
      const prompt = [
        `You are the Meta-AI Onboarding Coordinator. Based on the user's answers to the onboarding wizard, generate a personalized PROFILE.md and PREFERENCES.md for their workspace.`,
        ``,
        `User Onboarding Answers:`,
        `- Name/Identity: ${name || 'Operator'}`,
        `- Focus Role/Persona: ${persona || 'General'}`,
        `- Core Interests: ${interests || 'General AI assistance'}`,
        `- Working Style: ${style || 'Normal'}`,
        `- Preferred Tone: ${tone || 'Professional'}`,
        ``,
        `Generate:`,
        `1. PROFILE.md: Write a markdown document describing the user's identity, background, and specific working style based on their answers.`,
        `2. PREFERENCES.md: Write a markdown document listing 3-5 approved behavioral patterns (how Perry should interact and structure outputs) and 3-5 rejected patterns (what Perry must avoid) based on their working style and tone.`,
        ``,
        `Format your output EXACTLY as:`,
        `---PROFILE.MD---`,
        `[content of PROFILE.md]`,
        `---PREFERENCES.MD---`,
        `[content of PREFERENCES.md]`,
      ].join('\n');

      let profileText = '';
      let preferencesText = '';

      try {
        const compressor = (aiRouter as any).compressor;
        const librarian = compressor?.librarian;
        if (!librarian) throw new Error('Librarian provider not available');
        
        const r = await librarian.complete({
          provider: 'librarian',
          system: 'You are the Meta-AI Onboarding Coordinator.',
          messages: [{ role: 'user', content: prompt }],
        });

        const text = r.text || '';
        const profileMatch = text.match(/---PROFILE\.MD---([\s\S]*?)(---PREFERENCES\.MD---|$$)/i);
        const preferencesMatch = text.match(/---PREFERENCES\.MD---([\s\S]*?)$/i);
        
        if (profileMatch) profileText = profileMatch[1].trim();
        if (preferencesMatch) preferencesText = preferencesMatch[1].trim();
      } catch (err: any) {
        log.warn('LLM onboarding generation failed, falling back to templates', { error: err.message });
      }

      // Fallback if LLM fail or empty
      if (!profileText || !preferencesText) {
        profileText = [
          `# Operator Profile`,
          ``,
          `## Identity`,
          `- Name: ${name || 'Operator'}`,
          `- Role: ${persona || 'General Operator'}`,
          `- Interests: ${interests || 'General AI exploration'}`,
        ].join('\n');
        preferencesText = [
          `# Operator Preferences`,
          ``,
          `## Approved patterns`,
          `- Tone matched to ${tone || 'Professional'}`,
          `- Follows working style: ${style || 'Direct and modular'}`,
          ``,
          `## Rejected patterns`,
          `- Avoid over-verbosity`,
        ].join('\n');
      }

      operatorProfile.setProfile(profileText, preferencesText);
      res.json({ success: true, profile: operatorProfile.getProfile() });
    } catch (err: any) {
      log.error('POST /operator/setup failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
