import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// These are ordinary CLI children, not Node test-runner workers.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

test('shared wire contracts accept actual payloads and reject incompatible variants', () => {
  const result = spawnSync(process.execPath,
    ['packages/contracts/node_modules/typescript/bin/tsc', '-p', 'tests/tsconfig.json'],
    { cwd: root, encoding: 'utf8', timeout: 15000, env: childEnv });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
});

test('smoke check refuses to mutate a stack without explicit disposable opt-in', () => {
  const result = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...childEnv, SMOKE_DISPOSABLE: '0' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to place orders/);
});
