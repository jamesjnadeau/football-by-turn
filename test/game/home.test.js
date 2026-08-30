import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeMarkup, COMING_SOON } from '../../lib/game/home.js';
import { VARIANTS } from '../../lib/game/variants.js';

test('the screen names the game and offers one button per variant', () => {
  const html = homeMarkup();
  assert.ok(html.includes('Football By Turn'), 'the game is named');
  assert.equal((html.match(/class="home-choice"/g) || []).length, VARIANTS.length);
  for (const v of VARIANTS) {
    assert.ok(html.includes(`data-variant="${v.id}"`), `a button for ${v.id}`);
    assert.ok(html.includes(v.label), `the label for ${v.id}`);
  }
});

test('the playable variant presses; the one that is not is disabled and says so', () => {
  const html = homeMarkup([
    { id: 'a', label: 'Ready', note: 'now', teamSize: 7, available: true },
    { id: 'b', label: 'Later', note: 'not now', teamSize: 11, available: false },
  ]);
  assert.match(html, /data-variant="a"(?![^>]*disabled)/, 'the playable one is pressable');
  assert.match(html, /data-variant="b"[^>]*disabled/, 'the other one is not');
  assert.ok(html.includes(`Later — ${COMING_SOON}`), 'and says why');
  assert.ok(!html.includes(`Ready — ${COMING_SOON}`), 'which the playable one does not');
});

test('text with markup in it is escaped rather than written through', () => {
  const html = homeMarkup([
    { id: 'x', label: '<b>7</b>', note: 'a "note" & more', teamSize: 7, available: true },
  ]);
  assert.ok(!html.includes('<b>'), 'no tag survives');
  assert.ok(html.includes('&lt;b&gt;7&lt;/b&gt;'));
  assert.ok(html.includes('&quot;note&quot; &amp; more'));
});
