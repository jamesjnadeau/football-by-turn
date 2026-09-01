import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRILL_ROSTERS, ROSTERS, getRoster, minOnLine, offenseSize, defenseSize,
} from '../../../lib/game/rosters.js';
import { createGame, SNAPPER_ID, SNAP_TARGET_ID } from '../../../lib/game/state.js';
import { formationFoul, spotFault } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { isPlayable } from '../../../lib/game/variants.js';

test('every drill fields what it claims, with unique ids and a snap to take', () => {
  for (const roster of Object.values(DRILL_ROSTERS)) {
    assert.equal(roster.offense.length, offenseSize(roster), `${roster.id} offense`);
    assert.equal(roster.defense.length, defenseSize(roster), `${roster.id} defense`);
    const ids = [...roster.offense, ...roster.defense].map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${roster.id} ids are unique`);
    for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
      assert.ok(roster.offense.some((s) => s.id === id), `${roster.id} has ${id}`);
    }
  }
});

test('a drill has no formation rule, so a two-man line never draws a flag', () => {
  for (const id of Object.keys(DRILL_ROSTERS)) {
    const s = createGame({ seed: 1, variant: id, losYard: 50 });
    assert.equal(minOnLine(s), 0, `${id}: no line requirement`);
    assert.equal(formationFoul(s), null, `${id}: legal formation`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${id}: ${p.id} at a legal spot`);
    }
  }
});

test('the two-man drill stands four men on one vertical line at the fifty', () => {
  const s = createGame({ seed: 1, variant: 'tutorial-2v2', losYard: 50 });
  assert.equal(s.players.length, 4);
  const at = (id) => s.players.find((p) => p.id === id).pos;
  assert.deepEqual(at('o-c'), fieldPos(0, 49));
  assert.deepEqual(at('o-qb'), fieldPos(0, 46));
  assert.deepEqual(at('d-nt'), fieldPos(0, 51));
  assert.deepEqual(at('d-lb'), fieldPos(0, 54));
});

test('the passing drill adds a back off the line, three against two', () => {
  const s = createGame({ seed: 1, variant: 'tutorial-pass', losYard: 50 });
  assert.equal(s.players.filter((p) => p.team === 'offense').length, 3);
  assert.equal(s.players.filter((p) => p.team === 'defense').length, 2);
  const rb = s.players.find((p) => p.id === 'o-rb');
  assert.deepEqual(rb.pos, fieldPos(6, 45), 'offset, so a throw to him is not a lateral down the line');
});

test('a drill is not a game: the home screen can neither list nor start one', () => {
  for (const id of Object.keys(DRILL_ROSTERS)) {
    assert.equal(ROSTERS[id], undefined, `${id} is not a variant`);
    assert.equal(isPlayable(id), false, `${id} cannot be started off the home screen`);
    assert.equal(getRoster(id).id, id, '...but it can still be looked up');
  }
});
