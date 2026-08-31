import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRAIN = fileURLToPath(new URL('../../../lib/game/train/', import.meta.url));
const LIB = fileURLToPath(new URL('../../../lib/', import.meta.url));

const entries = () => readdirSync(TRAIN)
  .filter((f) => f.endsWith('.js'))
  .map((f) => TRAIN + f);

/** Every file reachable from `roots` by following relative imports. */
function reachable(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      if (m[1].startsWith('.')) queue.push(resolve(dirname(file), m[1]));
    }
  }
  return seen;
}

test('the training core is a real directory with modules in it', () => {
  assert.ok(entries().length >= 5, `found ${entries().length} modules`);
});

test('nothing the training core reaches imports a node: module', () => {
  for (const file of reachable(entries())) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'), /from 'node:/,
      `${file} imports a node: module, so it cannot ship to the browser`,
    );
  }
});

test('nothing the training core reaches lives outside lib/', () => {
  for (const file of reachable(entries())) {
    assert.ok(
      file.startsWith(LIB),
      `${file} is outside lib/, which the deploy workflow does not copy`,
    );
  }
});
