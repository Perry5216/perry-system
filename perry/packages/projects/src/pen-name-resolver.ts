/**
 * Pen-name aware writer-model resolver.
 *
 * Reads the typed pen_names / lora_versions tables (Phase 2) and returns the
 * Ollama tag currently registered as the writer for the active pen. Lets perry
 * pick up trained LoRAs automatically (`perry-{slug}:v{N}` →
 * `currentlyRegisteredAs`) instead of hardcoding `ai.ollama.model` in user.json.
 *
 * Returns null if no pen has a current LoRA — caller falls back to the
 * configured default model.
 *
 * The state-store has a one-shot bootstrap that projects the legacy
 * meta['pen_name_records'] blob into typed tables when they are empty, so
 * existing deployments upgrade transparently.
 */

import type { Logger } from '@perry/core';
import { StateStore } from './state-store.js';

export function resolvePenAwareWriterModel(
  stateStore: StateStore,
  opts: { preferredSlug?: string; log?: Logger } = {},
): string | null {
  const pens = stateStore.getPenNames().filter(p => p.currentLoraVersion !== null);
  if (!pens.length) return null;

  const chosen = (opts.preferredSlug && pens.find(p => p.slug === opts.preferredSlug)) || pens[0];
  const lv = stateStore.getCurrentLora(chosen.slug);
  // Belt-and-suspenders: prefer currently_registered_as (the active alias),
  // fall back to ollama_tag (the versioned tag the trainer always sets).
  // This keeps the hands-off flow working even on older deployments where the
  // trainer wrote `currently_registered_as = null`.
  const model = lv?.currentlyRegisteredAs ?? lv?.ollamaTag ?? null;
  if (!model) return null;

  opts.log?.info('Resolved pen-aware writer model', {
    pen: chosen.slug,
    loraVersion: chosen.currentLoraVersion,
    model,
  });
  return model;
}
