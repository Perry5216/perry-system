import { ConfigService, Logger, Vault } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { StateStore } from './src/state-store.js';
import { StyleDnaService } from './src/services/style-dna-service.js';
import { join } from 'path';

async function runTest() {
  const log = new Logger('dna-test', 'info');
  const WORKSPACE = process.env.PERRY_WORKSPACE || '/app/workspace';
  const CONFIG_DIR  = process.env.PERRY_CONFIG   || '/app/config';

  const config = new ConfigService(CONFIG_DIR);
  config.load();
  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  const aiRouter   = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const styleDna = new StyleDnaService(stateStore, log.child('dna'), WORKSPACE);

  // ── Build a COMPACT constraint prompt instead of the full compileSeed ──
  // Full seed is ~19k tokens. This targets the 10 most critical rules.
  const dna = (styleDna as any)['dna'];
  const global = dna?.globalRules;

  const bannedWords = (global?.bannedFilterWords as string[] || []).join(', ');

  // Pick top 20 banned phrases (highest priority structural patterns)
  const criticalPhrases = [
    'it was not a', 'not because', 'not quite', 'rather than a',
    'his eyes drifted', 'her gaze fell', 'his hands found',
    'a moment passed', 'silence followed', 'something shifted',
    'her breath caught', 'his throat tightened', 'a question formed',
    'nothing would ever be the same', 'there was no going back',
    'and that was that', 'the equipment registered', 'the monitor detected',
    'because nobody needed to', 'in his experience',
  ].join(' / ');

  // Pick 3 positive examples randomly
  const examples = (global?.positiveExamples as string[] || [])
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const compactConstraints = [
    `TARGET PROSE QUALITY — study these sentences for tone and style:`,
    ...examples.map((e, i) => `${i + 1}. "${e}"`),
    ``,
    `CRITICAL INSTRUCTION: Write the 300-word scene now.`,
    `Do NOT output any reasoning, chain of thought, or meta-commentary.`,
    `Begin immediately with the first sentence of the story.`
  ].join('\n');

  const writerSystemPrompt = [
    `You are an expert science fiction author.`,
    `A character named Vasquez is undergoing a consciousness upload into a digital afterlife called The Drift.`,
    `Write 300 words showing the physical sensation of the upload.`,
    ``,
    compactConstraints,
  ].join('\n');

  // ── Estimate tokens for logging ──
  const estTokens = Math.ceil(writerSystemPrompt.length / 3.0);
  log.info('Compact prompt built', { chars: writerSystemPrompt.length, estTokens });

  console.log('\n========================================');
  console.log('WRITER GPU TEST — gemma4:31b (RTX 5090)');
  console.log(`Prompt: ~${estTokens} tokens`);
  console.log('========================================\n');

  let generatedText = '';
  try {
    const response = await aiRouter.complete({
      provider: 'ollama',
      system: writerSystemPrompt,
      messages: [{ role: 'user', content: 'Write the scene now.' }],
      temperature: 0.85,
      maxTokens: 32768,
    });
    generatedText = response.text;
    console.log('--- GENERATED OUTPUT ---\n');
    console.log(generatedText);
    console.log('\n------------------------');
  } catch (err) {
    log.error('Writer generation failed', { error: (err as Error).message });
    process.exit(1);
  }

  // ── LIBRARIAN AUDIT ─────────────────────────────────────────────
  console.log('\n========================================');
  console.log('LIBRARIAN AUDIT — gemma3:12b (RTX 5070 Ti)');
  console.log('========================================\n');

  const auditPrompt = `You are a brutal fiction editor. Audit this prose for AI-isms. Check for:
- Filter words: felt, saw, noticed, realized, seemed, heard, knew, thought, understood, concluded, registered
- Rule of Three / Tricolon
- Definitional Negation: "it was not X", "not because", "not quite", "rather than a", "[noun], not [noun]"
- Floating body parts: "his eyes drifted", "her gaze fell", "his hands found"
- Temporal fillers: "a moment passed", "silence followed", "time stretched"
- Reflexive body language: "her breath caught", "his throat tightened", "stomach dropped"
- Reified thought: "a question formed", "doubt crept in", "a realization bloomed"
- Banned adverbs: suddenly, slowly, silently, finally, inevitably, gently, carefully
- Coda sentences: "nothing would ever be the same", "there was no going back"
- Equipment-proxy filter verbs: "the equipment registered", "the monitor detected"
- Character philosophy: "in his experience", "he had learned that"
- Inline negation: "[noun], not [noun]"
- Sensory monotony (visual only — no smell, sound, temperature, texture)
- Unearned profundity: "nothing mattered", "only silence remained"

SKEPTICISM CLAUSE: Always find at least one issue. Re-read if you find none.

Quote the exact violating sentence. Name the violation.
End with: GRADE: CLEAN / NEAR-CLEAN / FAIL
Then one line: what to fix next.

PROSE:
${generatedText}`;

  try {
    const audit = await aiRouter.complete({
      provider: 'librarian',
      system: 'You are a brutal, precise fiction editor. Be specific. Quote sentences exactly.',
      messages: [{ role: 'user', content: auditPrompt }],
      temperature: 0.3,
      maxTokens: 1500,
    });
    console.log('--- LIBRARIAN AUDIT ---\n');
    console.log(audit.text);
    console.log('\n-----------------------');
  } catch (err) {
    log.error('Librarian audit failed', { error: (err as Error).message });
  }

  process.exit(0);
}

runTest();
