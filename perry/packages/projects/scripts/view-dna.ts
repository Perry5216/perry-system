import { Logger } from '@perry/core';
import { StateStore } from './src/state-store.js';
import { StyleDnaService } from './src/services/style-dna-service.js';

async function viewDna() {
  const log = new Logger('view-dna', 'info');
  const WORKSPACE = process.env.PERRY_WORKSPACE || '/app/workspace';

  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const styleDna = new StyleDnaService(stateStore, log.child('dna'), WORKSPACE);
  const dna = styleDna.getRaw();

  console.log('\n=== CURRENT STYLE DNA V2 STATUS ===');
  console.log(`Global Banned Words: ${dna.globalRules.bannedFilterWords.length}`);
  console.log(`Global Banned Phrases: ${dna.globalRules.bannedPhrases.length}`);
  console.log(`Trope Warnings: ${dna.globalRules.tropeWarnings.length}`);
  console.log(`Learned Candidates: ${dna.candidates.length}`);
  
  console.log('\n--- LEARNED TROPE WARNINGS (Latest 10) ---');
  dna.globalRules.tropeWarnings.slice(-10).forEach(w => console.log(`- ${w}`));

  console.log('\n--- ACTIVE CANDIDATES (Learned from Iterations) ---');
  dna.candidates.slice(-10).forEach(c => {
    console.log(`[${c.type}] (${c.threshold} hits) "${c.text.substring(0, 80)}..."`);
  });

  process.exit(0);
}

viewDna();
