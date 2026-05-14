/**
 * @perry/projects — DNA Trainer
 *
 * Autonomously runs a self-play loop where the Writer GPU generates
 * a prologue, the Librarian GPU critiques it for AI-isms, and the
 * Style DNA Service permanently bans any new crutches it finds.
 */

import { ConfigService, EventBus, Logger, Vault, Project } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { MemoryStore, ContextEngine } from '@perry/rag';
import { StateStore } from './src/state-store.js';
import { StyleDnaService } from './src/services/style-dna-service.js';
import { PromptBuilder } from './src/prompt-builder.js';
import { PovQualityGate } from './src/quality-gates/pov-gate.js';
import { join } from 'path';

async function runTrainer() {
  const log = new Logger('dna-trainer', 'debug');
  log.info('Starting Style DNA Trainer...');

  const WORKSPACE = process.env.PERRY_WORKSPACE || '/app/workspace';
  const CONFIG_DIR = process.env.PERRY_CONFIG || '/app/config';

  // Boot Core Services
  process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
  process.env.OLLAMA_LIBRARIAN_BASE_URL = process.env.OLLAMA_LIBRARIAN_BASE_URL || 'http://ollama-embeddings:11434';
  const config = new ConfigService(CONFIG_DIR);
  config.load();
  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();
  const eventBus = new EventBus();

  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  const memoryStore = new MemoryStore(WORKSPACE, log.child('memory'));
  await memoryStore.initialize();

  const contextEngine = new ContextEngine(WORKSPACE, memoryStore, log.child('context'));
  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const styleDna = new StyleDnaService(stateStore, log.child('dna'), WORKSPACE);
  const promptBuilder = new PromptBuilder(WORKSPACE, contextEngine, stateStore, aiRouter.compressor, log.child('prompt'));
  const povGate = new PovQualityGate(log.child('gate'), eventBus, stateStore, styleDna);

  const PROJECT_ID = 'project-4';
  const project = stateStore.get(PROJECT_ID);
  if (!project) {
    log.error(`Project ${PROJECT_ID} not found. Ensure the project exists.`);
    process.exit(1);
  }

  // Find or create a Prologue step
  let prologueStep = project.steps.find(s => s.taskType === 'creative_writing' && s.chapterNumber === 0);
  if (!prologueStep) {
    log.info('No Prologue step found. Creating an ephemeral one for training...');
    prologueStep = {
      id: 'ephemeral-prologue',
      label: 'Prologue',
      phase: 'writing',
      taskType: 'creative_writing',
      status: 'pending',
      chapterNumber: 0,
      wordCountTarget: 1200,
      prompt: 'Write the Prologue for this story based on the worldbuilding and context provided. Set the tone and establish the central conflict.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const ITERATIONS = 100; // Running 100 times for the test
  log.info(`Starting Adversarial Loop: ${ITERATIONS} iterations`);

  for (let i = 1; i <= ITERATIONS; i++) {
    log.info(`\n=== ITERATION ${i}/${ITERATIONS} ===`);
    log.info('=== INITIALIZING GEMINI STYLE DNA LOOP ===');
    
    // We are running this on project-4 to test Gemini's response to the Digital Drift universe
    const projectId = 'project-4';
    const baseSystemPrompt = "You are an award-winning science fiction author writing a prologue. Follow instructions carefully.\n" +
      "## PROSE RHYTHM (CRITICAL)\n" +
      "Vary sentence length aggressively.\n" +
      "## ANTI-AI CLICHES (CRITICAL)\n" +
      "- DO NOT use the \"Rule of Three\" (e.g., \"He was a ghost. He was a glitch. He was a variable.\"). Stop structuring lists or descriptions in threes.\n" +
      "- AVOID explicit, repetitive dialogue tags (\"X said\", \"Y replied\" every line). Use action beats instead.\n" +
      "- MINIMIZE nominalization and abstract nouns (e.g., use \"fluid\" instead of \"fluidness\", \"synchronize\" instead of \"synchronization\"). Use strong, active verbs.\n" +
      "- AVOID formulaic fragments (e.g., \"He gasped. A wet sound.\", \"She smiled. A sad expression.\"). Describe the action naturally.\n" +
      "- BAN cliché similes (e.g., \"heart hammering like a trapped bird\", \"eyes like pools\").\n" +
      "- DO NOT use the word \"transcend\".\n";

    // Extract seed from Style DNA V2
    const seed = styleDna.compileSeed(project.id, 0, 'unknown');
    const systemWithSeed = seed ? `${baseSystemPrompt}\n${seed}` : baseSystemPrompt;

    // We pass the prompt to the primary provider (Gemini)
    const providerConfig = { id: 'gemini', model: 'gemini-2.5-flash', tier: 'free' };
    const { message: finalSystemPrompt } = await promptBuilder.build(project, prologueStep, providerConfig as any, systemWithSeed, 1.0);
    
    let generatedText = '';
    try {
      const response = await aiRouter.complete({
        provider: 'gemini', // Gemini API
        system: finalSystemPrompt,
        messages: [{ role: 'user', content: prologueStep.prompt }],
        temperature: 0.85,
        maxTokens: 4000,
      });
      generatedText = response.text;
      log.info(`Generated ${generatedText.split(/\s+/).length} words.`);
    } catch (e: any) {
      log.error(`Generation failed: ${e.message}`);
      return;
    }

    // 2. Critique Prologue
    log.info(`2. Critiquing Output (Gemini API Deep-Scan)...`);
    
    const checkPrompt = `Perform a comprehensive narrative quality analysis of the Prologue of "${project.title}".\n\n` +
      `## 1. POV Analysis\n` +
      `- Which character's POV was actually used in this chapter?\n` +
      `- Is the Deep POV consistent?\n\n` +
      `## 2. Pacing & Plot Advancement\n` +
      `- Does the chapter spend its word count wisely?\n\n` +
      `## 3. Prose Quality\n` +
      `- List any filter words found. Quote the exact sentence for each.\n` +
      `- Identify any "Show vs Tell" violations.\n\n` +
      `## 4. Trope Execution\n` +
      `- Are any tropes being executed too literally (cliché)?\n\n` +
      `## 5. AI-Ism Check\n` +
      `- Identify any "Rule of Three" (Tricolon) patterns (e.g., "He was X. He was Y. He was Z.").\n` +
      `- Identify repetitive dialogue attribution ("X said", "Y replied" on every line).\n` +
      `- Identify formulaic fragments for effect ("He gasped. A wet sound.").\n` +
      `- Identify cliché similes ("heart hammering like a trapped bird").\n\n` +
      `OUTPUT FORMAT (you MUST follow this exactly):\n` +
      `- **POV Character**: [name]\n` +
      `- **Outline Match**: YES/NO\n` +
      `- **Deep POV Score**: [1-10]\n` +
      `- **Pacing Score**: [1-10]\n` +
      `- **Hook Score**: [1-10]\n` +
      `- **Trope Warnings**: [flag any tropes executed as cliché without a fresh angle, or "None"]\n` +
      `- **Filter Words Found**: [list exact sentences containing filter words, or "None"]\n` +
      `- **Show vs Tell Violations**: [list passages that tell emotions, or "None"]\n` +
      `- **AI-Isms Found**: [list any Rule of Three, repetitive dialogue tags, formulaic fragments, or cliché similes, or "None"]\n` +
      `- **Issues**: [list any POV breaks or other problems]`;

    let critiqueText = '';
    try {
      const response = await aiRouter.complete({
        provider: 'gemini', // Gemini API
        system: 'You are an expert fiction editor analyzing prose for AI-isms, clichés, and deep POV violations.',
        messages: [{ role: 'user', content: `${checkPrompt}\n\n### CHAPTER TEXT:\n\n${generatedText}` }],
        temperature: 0.1,
        maxTokens: 2000,
      });
      critiqueText = response.text;
    } catch (err: any) {
      log.error('Critique failed', { error: err.message });
      continue;
    }

    // 3. Extract & Learn
    log.info('3. Extracting AI-Isms and Updating Style DNA...');
    
    const filterMatch = critiqueText.match(/filter\s+words?\s+found[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const filterWords = filterMatch ? filterMatch[1].trim() : '';
    const showTellMatch = critiqueText.match(/show\s+vs\s+tell[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const showTellViolations = showTellMatch ? showTellMatch[1].trim() : '';
    const tropeWarnMatch = critiqueText.match(/trope\s+warnings?[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const tropeWarnings = tropeWarnMatch ? tropeWarnMatch[1].trim() : '';
    const aiIsmsMatch = critiqueText.match(/ai-isms?\s+found[:\s]*([^\n]+(?:\n(?!\s*-\s*\*\*)[^\n]+)*)/i);
    const aiIsmsFound = aiIsmsMatch ? aiIsmsMatch[1].trim() : '';

    let newlyLearned = styleDna.learnFromFailure(
      project.id,
      `DNA-Trainer-Iter-${i}`,
      filterWords,
      showTellViolations,
      tropeWarnings + (aiIsmsFound && aiIsmsFound.toLowerCase() !== 'none' ? `\n- AI-Isms: ${aiIsmsFound}` : '')
    );

    if (newlyLearned) {
      log.info(`Learned new patterns! Style DNA updated.`);
      log.info(`AI-Isms Report: ${aiIsmsFound || 'None'}`);
    } else {
      log.info('No new patterns learned in this iteration.');
    }
  }

  log.info('\nTraining complete!');
  const finalDna = styleDna.getRaw();
  log.info(`Total Banned Words: ${finalDna.globalRules.bannedFilterWords.length}`);
  log.info(`Total Trope Warnings: ${finalDna.globalRules.tropeWarnings.length}`);
  
  process.exit(0);
}

runTrainer().catch(err => {
  console.error('Fatal error in trainer:', err);
  process.exit(1);
});
