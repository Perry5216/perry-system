import { watch, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService, Vault, Logger } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { StateStore } from './src/state-store.js';
import { StyleDnaService } from './src/services/style-dna-service.js';

async function bootstrap() {
  const log = new Logger('antigravity', 'debug');
  log.info('Starting Antigravity Auditor (Gemini API interceptor)...');

  const WORKSPACE = process.env.PERRY_WORKSPACE || join(process.cwd(), 'workspace');
  const CONFIG_DIR = process.env.PERRY_CONFIG || join(process.cwd(), 'config');

  const config = new ConfigService(CONFIG_DIR);
  config.load();

  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  if (!vault.has('gemini_api_key')) {
    log.error('Cannot start Auditor: gemini_api_key not found in .vault');
    process.exit(1);
  }

  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const styleDna = new StyleDnaService(stateStore, log.child('dna'), WORKSPACE);

  const watchFile = join(WORKSPACE, 'latest_generation.txt');
  log.info(`Listening for new generations on ${watchFile}...`);

  let processing = false;

  watch(watchFile, async (eventType) => {
    if (eventType !== 'change' || processing) return;
    
    try {
      processing = true;
      const text = readFileSync(watchFile, 'utf8');
      if (text.length < 100) return; // Ignore empty/cleared file

      log.info('New generation intercepted! Initiating deep-scan via Gemini 2.5...');

      const checkPrompt = `You are Antigravity, an elite fiction editor. Your job is to audit this text for extremely subtle AI-isms that a local LLM might miss.
Analyze the following prose. If you find a subtle structural crutch (e.g., relying on rhetorical questions, excessive use of em-dashes for pacing, overly symmetrical sentence lengths, telling instead of showing, etc.), output exactly one JSON object with NO markdown formatting, NO backticks.

If the prose is perfect, output: {"perfect": true}

Otherwise, output:
{
  "caught": "A very short description of the trope or crutch.",
  "bad": "The exact bad quote from the text.",
  "good": "Your rewritten version of that quote that fixes the issue.",
  "type": "show_tell" or "trope"
}

### TEXT TO AUDIT:
${text}
`;

      const response = await aiRouter.complete({
        provider: 'gemini',
        system: 'You are Antigravity, a strict prose auditor. Output only valid JSON without markdown formatting.',
        messages: [{ role: 'user', content: checkPrompt }],
        temperature: 0.2,
        maxTokens: 1000,
      });

      try {
        const raw = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(raw);

        if (json.perfect) {
          log.info('Antigravity Deep-Scan: Prose passed with no subtle AI-isms found.');
        } else if (json.bad && json.good) {
          log.info(`Antigravity caught an AI-ism! [${json.type}] ${json.caught}`);
          log.info(`BAD: ${json.bad}`);
          log.info(`GOOD: ${json.good}`);

          // Inject directly into the live DNA database
          if (json.type === 'show_tell') {
            styleDna.reportShowVsTell(json.bad, json.good, 'antigravity-auditor');
          } else {
            styleDna.reportTropeViolation(json.caught, 'antigravity-auditor');
          }
        }
      } catch (parseError) {
        log.warn('Failed to parse Gemini response as JSON', { raw: response.text });
      }

    } catch (err: any) {
      log.error('Auditor error', { error: err.message });
    } finally {
      // Small cooldown to prevent double-fires on the same write
      setTimeout(() => { processing = false; }, 2000);
    }
  });
}

bootstrap().catch(err => {
  console.error('Fatal auditor crash:', err);
  process.exit(1);
});
