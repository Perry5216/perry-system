#!/usr/bin/env node
// A/B harness: same scene prompt + seed + model, different boilerplate.
// Sends OLD (pre-compression) and NEW (current) prompts to the writer LoRA
// and dumps both outputs side-by-side for human eyeball + objective leak count.
//
// Run via:  docker exec perry node /app/workspace/ab-prompt-test.cjs
// Output:   /app/workspace/ab-result-{timestamp}.json (mounted to host)

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const MODEL  = 'perry-a-perry:v7';
const SEED   = 42;
const TEMPERATURE = 0.82;
const NUM_PREDICT = 500;

// ─── The boilerplate we changed ───────────────────────────────────────
// Both halves contain IDENTICAL semantic instructions; only verbosity differs.

const OLD_BOILERPLATE = `[ANTI-LAZINESS PROTOCOL: You must output FULL, exhaustive detail. NEVER use placeholders (e.g. "profiles will be similarly detailed"). NEVER summarize. Complete the ENTIRE requested structure no matter how long it takes. If you are running out of memory, stop cleanly when you reach the limit.]

[ANTI-PATTERNS (FORBIDDEN NAMES & PHRASES): The following are overused AI defaults and are strictly banned. Do NOT use them:
  - Names: Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo.
  - AI-isms/Clichés: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth", "dance of blades".
  - Melodrama: "a shiver ran down his spine", "his blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding".]

[PROSE STYLE CONTROLS — ALL RULES ARE HARD CONSTRAINTS, NOT SUGGESTIONS]
1. EM DASH DISCIPLINE: You are PROHIBITED from using more than 1 em dash (—) per 500 words. Em dashes are reserved for sharp interruptions only. In all other cases, use commas, semicolons, colons, periods, or parentheses. NEVER place two em-dash clauses in the same sentence.
2. WORD REPETITION BAN: No single common noun, verb, or adjective may appear more than 4 times per 500 words. This includes environment-specific words like "node", "lattice", "static", "pulse", "core". If you reach the limit, use a synonym or restructure the sentence. Count as you write.
3. PHRASE REPETITION BAN: Do NOT repeat the same phrase, metaphor, or motif more than ONCE per segment. If you have used a phrase (e.g., "the lattice shuddered"), it is now retired for this segment.
4. DIALOGUE REQUIREMENT: Every segment MUST contain at least one exchange of direct speech or italicised internal voice. Pure narration with no voice is FORBIDDEN.
5. SENTENCE VARIETY: Vary sentence length and structure. Do NOT start 3 consecutive sentences with the same word or pattern.

INSTRUCTIONS: Complete the ENTIRE task in full. Do not skip sections, do not summarize, do not use placeholders, and never cite processing limits. Generate the complete requested output.

PUNCTUATION: End sentences with periods. Use em-dashes sparingly (max 2 per 400 words). Commas, semicolons, and periods are preferred.

## PROSE RHYTHM (CRITICAL)
Vary sentence length aggressively. Follow a 15-word sentence with a 3-word fragment. Then a 30-word compound sentence. Use one-word paragraphs for emphasis. Never write 3+ consecutive sentences of similar length. Include at least one intentional sentence fragment per page of prose.

## ANTI-AI CLICHES (CRITICAL)
- DO NOT use the "Rule of Three" (e.g., "He was a ghost. He was a glitch. He was a variable."). Stop structuring lists or descriptions in threes.
- AVOID explicit, repetitive dialogue tags ("X said", "Y replied" every line). Use action beats instead.
- MINIMIZE nominalization and abstract nouns (e.g., use "fluid" instead of "fluidness", "synchronize" instead of "synchronization"). Use strong, active verbs.
- AVOID formulaic fragments (e.g., "He gasped. A wet sound.", "She smiled. A sad expression."). Describe the action naturally.
- BAN cliché similes (e.g., "heart hammering like a trapped bird", "eyes like pools").
- DO NOT use the word "transcend".`;

const NEW_BOILERPLATE = `[ANTI-LAZINESS: Output full detail. No placeholders. No summaries. Finish the requested structure completely. Stop cleanly if you hit the memory limit.]

[BANNED (overused AI defaults — do not use):
  Names: Chen, Sarah Chen, Elara, Lyra, Jasper, Lena, Zara, Zane, Niko, Lila, Mira, Leo.
  Clichés: "a testament to", "tapestry", "symphony", "palpable", "delve", "echoed", "cacophony", "labyrinth", "dance of blades".
  Melodrama: "a shiver ran down his spine", "blood ran cold", "heart hammered in his chest", "let out a breath he didn't know he was holding".]

[PROSE STYLE CONTROLS — ALL RULES ARE HARD CONSTRAINTS, NOT SUGGESTIONS]
1. EM DASH DISCIPLINE: You are PROHIBITED from using more than 1 em dash (—) per 500 words. Em dashes are reserved for sharp interruptions only. In all other cases, use commas, semicolons, colons, periods, or parentheses. NEVER place two em-dash clauses in the same sentence.
2. WORD REPETITION BAN: No single common noun, verb, or adjective may appear more than 4 times per 500 words. This includes environment-specific words like "node", "lattice", "static", "pulse", "core". If you reach the limit, use a synonym or restructure the sentence. Count as you write.
3. PHRASE REPETITION BAN: Do NOT repeat the same phrase, metaphor, or motif more than ONCE per segment. If you have used a phrase (e.g., "the lattice shuddered"), it is now retired for this segment.
4. DIALOGUE REQUIREMENT: Every segment MUST contain at least one exchange of direct speech or italicised internal voice. Pure narration with no voice is FORBIDDEN.
5. SENTENCE VARIETY: Vary sentence length and structure. Do NOT start 3 consecutive sentences with the same word or pattern.

## PROSE RHYTHM
Mix sentence lengths aggressively: a 15-word sentence, then a 3-word fragment, then a 30-word compound. Never 3+ consecutive sentences at similar length. ≥1 intentional fragment per page. One-word paragraphs for emphasis.

## ANTI-AI CLICHES
- No "Rule of Three" lists ("He was a ghost. He was a glitch. He was a variable.")
- No repetitive dialogue tags ("said", "replied") — use action beats
- No nominalisations: "fluid" not "fluidness"; "synchronize" not "synchronization"
- No formulaic fragments ("He gasped. A wet sound."; "She smiled. A sad expression.")
- No cliché similes ("heart hammering like a trapped bird", "eyes like pools")
- Never use "transcend"`;

const WRITER_PREAMBLE = `You are the P.E.R.R.Y. System (Predictive Engine for Rapid Revision & Yield), an expert fiction writing AI assistant.

CRITICAL FORMATTING INSTRUCTION: Output ONLY the raw story prose. Do NOT output any conversational filler, introductory remarks, or revision notes. Do NOT explain what you changed. Just output the story.`;

const SCENE_PROMPT = `Write a 350–500 word scene. Mia, a 34-year-old fusion plant engineer, has nine minutes to manually vent superheated coolant before reactor pressure peaks. The override panel is in the wall behind a sealed hatch — the override valve sticks. Her shift-mate Tomas is on radio from the control room, watching pressure climb. Make it tight, physical, and POV-locked to Mia. Action and one short dialogue exchange.`;

// ─── Helpers ──────────────────────────────────────────────────────────

function buildPrompt(boilerplate) {
  return `${WRITER_PREAMBLE}\n\n${boilerplate}\n\n${SCENE_PROMPT}`;
}

// Same scanLeaks rule families perry uses post-generation. Inline minimal
// patterns so this script has no @perry/projects dependency.
const LEAK_PATTERNS = [
  { tag: 'filter_word',   regex: /\b(suddenly|just|really|very|that)\b/gi },
  { tag: 'ai_cliche',     regex: /\b(testament to|tapestry|symphony|palpable|delve|echoed|cacophony|labyrinth|transcend)\b/gi },
  { tag: 'melodrama',     regex: /(shiver ran down|blood ran cold|heart hammer\w*|breath (he|she) didn'?t know)/gi },
  { tag: 'cliche_simile', regex: /(like a trapped bird|like pools|like a knife)/gi },
  { tag: 'rule_of_three', regex: /(\w+)\.\s+(\w+)\.\s+(\w+)\.\s/g },
];

function countLeaks(text) {
  const out = {};
  let total = 0;
  for (const p of LEAK_PATTERNS) {
    const matches = (text.match(p.regex) || []);
    if (matches.length) {
      out[p.tag] = matches.length;
      total += matches.length;
    }
  }
  return { total, byTag: out };
}

function wc(text) {
  return text.trim().split(/\s+/).length;
}

// Rough token estimate: chars/4 — matches what perry's prompt-builder uses.
function tk(text) {
  return Math.ceil(text.length / 4);
}

async function generate(prompt) {
  const body = JSON.stringify({
    model: MODEL,
    prompt,
    stream: false,
    options: {
      seed: SEED,
      temperature: TEMPERATURE,
      num_predict: NUM_PREDICT,
      top_p: 0.95,
    },
  });
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return { response: json.response || '', elapsedMs: elapsed, evalCount: json.eval_count, promptEvalCount: json.prompt_eval_count };
}

// ─── Run ──────────────────────────────────────────────────────────────

(async () => {
  const oldPrompt = buildPrompt(OLD_BOILERPLATE);
  const newPrompt = buildPrompt(NEW_BOILERPLATE);

  console.log(`OLD prompt: ${oldPrompt.length} chars (~${tk(oldPrompt)} tokens)`);
  console.log(`NEW prompt: ${newPrompt.length} chars (~${tk(newPrompt)} tokens)`);
  console.log(`Δ chars: ${oldPrompt.length - newPrompt.length} (~${tk(oldPrompt) - tk(newPrompt)} tokens saved per call)`);
  console.log(`\nModel: ${MODEL}, seed: ${SEED}, temp: ${TEMPERATURE}, num_predict: ${NUM_PREDICT}`);
  console.log(`\nGenerating A (OLD prompts)...`);
  const A = await generate(oldPrompt);
  console.log(`  ${A.evalCount} tokens generated in ${A.elapsedMs}ms (prompt eval: ${A.promptEvalCount} tokens)`);

  console.log(`Generating B (NEW prompts)...`);
  const B = await generate(newPrompt);
  console.log(`  ${B.evalCount} tokens generated in ${B.elapsedMs}ms (prompt eval: ${B.promptEvalCount} tokens)`);

  const leaksA = countLeaks(A.response);
  const leaksB = countLeaks(B.response);

  const out = {
    timestamp: new Date().toISOString(),
    model: MODEL,
    seed: SEED,
    temperature: TEMPERATURE,
    prompt_lengths: {
      old_chars: oldPrompt.length,
      new_chars: newPrompt.length,
      delta_chars: oldPrompt.length - newPrompt.length,
      old_tokens_est: tk(oldPrompt),
      new_tokens_est: tk(newPrompt),
      delta_tokens_est: tk(oldPrompt) - tk(newPrompt),
    },
    prompt_eval: {
      old: A.promptEvalCount,
      new: B.promptEvalCount,
      delta: (A.promptEvalCount || 0) - (B.promptEvalCount || 0),
    },
    A_old: {
      response: A.response,
      word_count: wc(A.response),
      eval_count: A.evalCount,
      elapsed_ms: A.elapsedMs,
      leaks: leaksA,
    },
    B_new: {
      response: B.response,
      word_count: wc(B.response),
      eval_count: B.evalCount,
      elapsed_ms: B.elapsedMs,
      leaks: leaksB,
    },
  };

  const fs = require('fs');
  const stamp = Date.now();
  const path = `/app/workspace/ab-result-${stamp}.json`;
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\n=== Result ===`);
  console.log(`A (OLD)  words=${out.A_old.word_count}  leaks_total=${leaksA.total}  prompt_tok=${A.promptEvalCount}  gen_tok=${A.evalCount}  ${A.elapsedMs}ms`);
  console.log(`B (NEW)  words=${out.B_new.word_count}  leaks_total=${leaksB.total}  prompt_tok=${B.promptEvalCount}  gen_tok=${B.evalCount}  ${B.elapsedMs}ms`);
  console.log(`Prompt token delta (actual): ${out.prompt_eval.delta}`);
  console.log(`Leak delta (B - A): ${leaksB.total - leaksA.total}  (negative = NEW is cleaner)`);
  console.log(`\nFull output: ${path}`);
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
