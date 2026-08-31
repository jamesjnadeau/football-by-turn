import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTERS, DEFAULT_VARIANT, getRoster, teamSize, minOnLine,
} from '../../lib/game/rosters.js';
import {
  createGame, SNAPPER_ID, SNAP_TARGET_ID, getPlayer,
} from '../../lib/game/state.js';
import { nextDown } from '../../lib/game/rules.js';
import { backerLane, orderedMates, containRank } from '../../lib/game/defense.js';
import { BACKER_LANE_UNITS } from '../../lib/game/constants.js';

test('every roster fields as many a side as it claims, with unique ids and a snap to take', () => {
  for (const roster of Object.values(ROSTERS)) {
    assert.equal(roster.offense.length, roster.teamSize, `${roster.id} offense`);
    assert.equal(roster.defense.length, roster.teamSize, `${roster.id} defense`);
    const ids = [...roster.offense, ...roster.defense].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${roster.id} ids are unique`);
    assert.ok(roster.minOnLine <= roster.teamSize, `${roster.id} can field its line`);
    for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
      assert.ok(roster.offense.some((s) => s.id === id), `${roster.id} has ${id}`);
    }
  }
});

test('an unknown variant falls back to the default rather than throwing', () => {
  assert.equal(getRoster('9').id, DEFAULT_VARIANT);
  assert.equal(getRoster(undefined).id, DEFAULT_VARIANT);
});

test('a game remembers the variant it was dealt, and keeps it across a down', () => {
  const s = createGame({ seed: 1, variant: '7' });
  assert.equal(s.variantId, '7');
  assert.equal(teamSize(s), 7);
  assert.equal(minOnLine(s), 5);
  assert.equal(s.players.length, 14);

  s.phase = 'playOver';
  s.deadReason = 'tackle';
  nextDown(s);
  assert.equal(s.variantId, '7', 'the next down is played with the same teams');
  assert.equal(s.players.length, 14);
});

test('a lone backer keeps no lane — he plays the ball, as he always has', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '7' });
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), 0);
  assert.deepEqual(orderedMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb']);
});

test('a three-man front ranks as it always did: one free, one each side', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '7' });
  assert.deepEqual(
    ['d-dt1', 'd-nt', 'd-dt2'].map((id) => containRank(s, getPlayer(s, id))),
    [-1, 0, 1],
  );
});
