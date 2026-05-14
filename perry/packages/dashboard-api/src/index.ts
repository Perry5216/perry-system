/**
 * @perry/dashboard-api — Entry Point
 */

import { ConfigService, EventBus, Logger, Vault } from '@perry/core';
import { AIRouter } from '@perry/ai';
import { MemoryStore, ContextEngine, EntityIndexer } from '@perry/rag';
import { ProjectEngine, StateStore } from '@perry/projects';
import { createServer } from './server.js';
import { join } from 'path';

async function bootstrap() {
  const log = new Logger('system', 'debug');
  log.info('Starting P.E.R.R.Y. System...');

  // Paths
  const WORKSPACE = process.env.PERRY_WORKSPACE || join(process.cwd(), 'workspace');
  const CONFIG_DIR = process.env.PERRY_CONFIG || join(process.cwd(), 'config');

  // 1. Core Services
  const config = new ConfigService(CONFIG_DIR);
  config.load();

  const vault = new Vault(join(CONFIG_DIR, '.vault'));
  vault.load();

  const eventBus = new EventBus();

  // 2. AI Router
  const aiRouter = new AIRouter(config, vault, log.child('ai'));
  await aiRouter.initialize();

  // 3. RAG
  const memoryStore = new MemoryStore(WORKSPACE, log.child('memory'));
  await memoryStore.initialize();

  const contextEngine = new ContextEngine(WORKSPACE, memoryStore, log.child('context'));
  contextEngine.registerEvents(eventBus);

  // 3b. Entity Indexer — auto-extracts entities using the Librarian GPU
  const entityIndexer = new EntityIndexer(aiRouter.compressor, contextEngine, log.child('entity-indexer'));
  entityIndexer.registerEvents(eventBus);

  // 4. Projects
  const stateStore = new StateStore(WORKSPACE, log.child('state'));
  await stateStore.initialize();

  const projectEngine = new ProjectEngine(
    stateStore,
    aiRouter,
    contextEngine,
    eventBus,
    log.child('engine'),
    {
      workspaceDir: WORKSPACE,
      maxRetries: 3,
      minResponseLength: 100,
      config: config,
    },
  );

  // 5. Server
  const app = createServer(projectEngine, aiRouter, eventBus, log.child('api'), WORKSPACE);

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    log.info(`Dashboard API running on http://localhost:${PORT}`);
    log.info(`Workspace: ${WORKSPACE}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutdown requested — waiting for in-flight steps (max 60s)...');

    // Wait up to 60 seconds for any active steps to complete
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const activeProjects = projectEngine.listProjects('active');
      if (activeProjects.length === 0) break;
      log.info(`Waiting for ${activeProjects.length} active project(s)...`);
      await new Promise(r => setTimeout(r, 3000));
    }

    log.info('Closing databases...');
    stateStore.close();
    memoryStore.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
