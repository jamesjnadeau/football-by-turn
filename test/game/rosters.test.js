import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROSTERS, DEFAULT_VARIANT, getRoster, teamSize, minOnLine,
} from '../../lib/game/rosters.js';
import {
  createGame, SNAPPER_ID, SNAP_TARGET_ID, getPlayer, setPlan,
} from '../../lib/game/state.js';
import { nextDown } from '../../lib/game/rules.js';
import {
  backerLane, orderedMates, containRank, coverAssignments, deepMan,
} from '../../lib/game/defense.js';
import { BACKER_LANE_UNITS } from '../../lib/game/constants.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import {
  lineCount, formationFoul, alignDefense, spotFault,
} from '../../lib/game/formation.js';

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
  const s = createGame({ seed: 1, variant: '11' });
  assert.equal(s.variantId, '11');
  assert.equal(teamSize(s), 11);
  assert.equal(minOnLine(s), 7);
  assert.equal(s.players.length, 22);

  s.phase = 'playOver';
  s.deadReason = 'tackle';
  nextDown(s);
  assert.equal(s.variantId, '11', 'the next down is played with the same teams');
  assert.equal(s.players.length, 22);
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

test('every roster comes to the line legally, with nobody the rulebook would refuse', () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    assert.equal(lineCount(s, 'offense'), minOnLine(s), `${id}: exactly enough on the line`);
    assert.equal(formationFoul(s), null, `${id}: legal formation`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${id}: ${p.id} at a legal spot`);
    }
  }
});

test('every roster is balanced across the field, so the free man aligns over the middle', () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    const offense = s.players.filter((p) => p.team === 'offense');
    const mean = offense.reduce((sum, p) => sum + p.pos.x, 0) / offense.length;
    assert.equal(mean, 135, `${id}: the middle of the field`);
  }
});

test("aligning against a drive-start formation reproduces that variant's own defense", () => {
  for (const id of Object.keys(ROSTERS)) {
    const s = createGame({ seed: 1, variant: id });
    for (const { id: who, pos } of alignDefense(s)) {
      assert.deepEqual(pos, getPlayer(s, who).pos, `${id}: ${who} was already where he belongs`);
    }
  }
});

test('eleven a side: every coverage threat has a man on him and the safety is free', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual([...coverAssignments(s, 'defense').entries()].sort(), [
    ['d-cb1', 'o-wr1'], ['d-cb2', 'o-wr2'], ['d-fs', 'o-rb'],
  ]);
  assert.equal(deepMan(s, 'defense').id, 'd-s', 'and he is the last man back');
});

test('eleven a side: the five-man front ranks itself out from the middle', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual(
    ['d-de1', 'd-dt1', 'd-nt', 'd-dt2', 'd-de2']
      .map((id) => containRank(s, getPlayer(s, id))),
    [-2, -1, 0, 1, 2],
  );
});

test('eleven a side: the two backers split the box rather than stacking on the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  assert.deepEqual(orderedMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb', 'd-lb2']);
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), -BACKER_LANE_UNITS / 2);
  assert.equal(backerLane(s, getPlayer(s, 'd-lb2')), BACKER_LANE_UNITS / 2);
});

test('the lane is read off the field, so backers who cross over swap lanes', () => {
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  getPlayer(s, 'd-lb').pos = { x: 200, y: 100 };
  assert.equal(backerLane(s, getPlayer(s, 'd-lb')), BACKER_LANE_UNITS / 2,
    'he is the right-hand backer now');
});

test('a computer-coached eleven-a-side down runs to a whistle and re-forms both teams', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart', variant: '11' });
  const random = mulberry32(1);
  for (const p of s.players) {
    if (p.team === 'offense') setPlan(s, p.id, { x: 0, y: 1 }, 1);
  }
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 40) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.phase, 'playOver', `the play ended (in ${turns} turns)`);
  assert.ok(s.players.every((p) => p.team !== 'defense' || (p.plan === null && p.cover === null)),
    'the computer left nothing behind for the coach to read');

  nextDown(s);
  if (s.phase === 'planning') {
    assert.equal(s.players.length, 22, 'both teams re-formed eleven a side');
    assert.equal(s.variantId, '11');
  }
});
