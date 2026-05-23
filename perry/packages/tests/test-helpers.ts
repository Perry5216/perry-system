import { rmSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const mockLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLog,
} as any;

export function createTempWorkspace(): string {
  const systemTemp = tmpdir();
  const dir = mkdtempSync(join(systemTemp, 'perry-smoke-test-'));
  mkdirSync(join(dir, 'abilities-installed'), { recursive: true });
  return dir;
}

export const mockEventBus = {
  emit: () => {},
  on: () => {},
} as any;

export const mockMcpClient = {
  getTools: () => [],
  executeTool: () => ({}),
} as any;

export function mockStateStoreDb(store: any, getCallback: (sql: string) => any) {
  const runStub = () => ({ changes: 1, lastInsertRowid: 1 });
  const allStub = () => [];
  store.db = {
    prepare: (sql: string) => {
      if (sql.includes('task_pool') || sql.includes('SELECT status, result')) {
        return {
          get: getCallback,
          run: runStub,
          all: allStub,
        };
      }
      return {
        run: runStub,
        all: allStub,
        get: () => null,
      };
    },
    transaction: (fn: Function) => {
      const runTx = () => fn();
      runTx.immediate = () => fn();
      runTx.deferred = () => fn();
      runTx.exclusive = () => fn();
      return runTx;
    },
  } as any;
}
