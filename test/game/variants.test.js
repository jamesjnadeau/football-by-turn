import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, getVariant, isPlayable } from '../../lib/game/variants.js';
import { ROSTERS } from '../../lib/game/rosters.js';

test('two games are offered: seven a side to play, eleven not yet', () => {
  assert.deepEqual(VARIANTS.map((v) => v.id), ['7', '11']);
  assert.equal(isPlayable('7'), true);
  assert.equal(isPlayable('11'), false);
});

test('every variant carries what the screen needs to draw it', () => {
  for (const v of VARIANTS) {
    assert.equal(typeof v.label, 'string', `${v.id} label`);
    assert.ok(v.label.length > 0, `${v.id} label is not empty`);
    assert.equal(typeof v.note, 'string', `${v.id} note`);
    assert.ok(v.note.length > 0, `${v.id} note is not empty`);
    assert.equal(typeof v.available, 'boolean', `${v.id} available`);
  }
});

test('every playable variant fields the team the game actually builds', () => {
  for (const v of VARIANTS) {
    if (!v.available) continue;
    const roster = ROSTERS[v.id];
    assert.ok(roster, `${v.id} has a roster to build from`);
    assert.equal(v.teamSize, roster.teamSize, `${v.id} team size`);
  }
});

test('an id nobody offers is neither found nor playable', () => {
  assert.equal(getVariant('9'), null);
  assert.equal(isPlayable('9'), false);
});
