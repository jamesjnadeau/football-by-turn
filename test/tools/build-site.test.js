import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.js';

function build(opts) {
  const out = join(mkdtempSync(join(tmpdir(), 'site-')), 'site');
  buildSite({ ...opts, out });
  return out;
}

test('the site is what the browser loads, and nothing else', () => {
  const out = build();
  for (const f of ['index.html', 'app/home.js', 'lib/game/home.js']) {
    assert.ok(existsSync(join(out, f)), `${f} is missing`);
  }
  // The repository is not the site: what is published is the page, not the
  // plans, the training tools, or the tests.
  for (const f of ['docs', 'tools', 'test', 'PLAN.md']) {
    assert.ok(!existsSync(join(out, f)), `${f} should not be published`);
  }
  rmSync(out, { recursive: true, force: true });
});

test('the default build keeps multiplayer', () => {
  const out = build();
  assert.match(readFileSync(join(out, 'app/build-config.js'), 'utf8'),
    /MULTIPLAYER = true/);
  rmSync(out, { recursive: true, force: true });
});

test('--no-multiplayer publishes a site whose home screen has no lobby', () => {
  const out = build({ multiplayer: false });
  assert.match(readFileSync(join(out, 'app/build-config.js'), 'utf8'),
    /MULTIPLAYER = false/);
  rmSync(out, { recursive: true, force: true });
});

test('a build never edits the source tree', () => {
  const source = new URL('../../app/build-config.js', import.meta.url).pathname;
  const before = readFileSync(source, 'utf8');
  rmSync(build({ multiplayer: false }), { recursive: true, force: true });
  assert.equal(readFileSync(source, 'utf8'), before);
});
