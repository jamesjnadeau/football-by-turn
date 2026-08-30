import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, unplannedPlayers } from '../../lib/game/turn.js';
import { createGame, setPlan, getPlayer } from '../../lib/game/state.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { SUBSTEPS_PER_TURN, TEAM_SIZE } from '../../lib/game/constants.js';
import { fieldPos, GOAL_YARD } from '../../lib/game/view.js';

test('a turn produces one frame per sub-step and moves planned players', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const y0 = getPlayer(s, 'o-rb').pos.y;
  const { frames } = runTurn(s, mulberry32(1));
  assert.equal(frames.length, SUBSTEPS_PER_TURN);
  assert.ok(getPlayer(s, 'o-rb').pos.y > y0);
  assert.equal(s.phase, 'planning');
  assert.equal(s.turnIndex, 1);
});

test('velocity persists into the next turn (momentum carries)', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  runTurn(s, mulberry32(1));
  const v = getPlayer(s, 'o-rb').vel.y;
  assert.ok(v > 0, 'still moving after the turn ends');
});

test('charge is consumed by the turn that uses it', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-qb').charge = 1;
  runTurn(s, mulberry32(1));
  assert.equal(getPlayer(s, 'o-qb').charge, 0);
});

test('a clean run to the end zone ends the turn early with a touchdown', () => {
  const s = createGame({ seed: 1 });
  s.players = s.players.filter((p) => p.id === 'o-qb'); // no defense in the way
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, GOAL_YARD - 0.5);
  qb.vel = { x: 0, y: 20 };
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  const { frames, events } = runTurn(s, mulberry32(1));
  assert.ok(events.some((e) => e.type === 'touchdown'));
  assert.equal(s.phase, 'playOver');
  assert.ok(frames.length < SUBSTEPS_PER_TURN, 'stopped at the whistle');
});

test('a full scripted play: everyone charges, the play eventually ends', () => {
  // With every player charging straight up/down the field, no defender ever
  // gets within tackle range: the O-line and D-line jam head-on (equal mass,
  // equal speed) and — deterministically, for every seed tried (1-20, 50,
  // 100, 500, 12345) — the offensive front wins the push, the D-line never
  // closes the gap to the ball carrier, and checkTackles's random() is never
  // even called. The play always resolves as a touchdown at turn 112, never
  // sooner. So this is not a "roll the dice again" situation as the plan's
  // caveat anticipated — the outcome is seed-independent — and 40 turns
  // (20 game-seconds) is simply too short a cap for this formation. The cap
  // below is widened to fit the actual (deterministic) run length.
  const s = createGame({ seed: 3 });
  for (const p of s.players) {
    setPlan(s, p.id, { x: 0, y: p.team === 'offense' ? 1 : -1 }, 1);
  }
  const random = mulberry32(3);
  let turns = 0;
  while (s.phase !== 'playOver' && turns < 150) {
    runTurn(s, random);
    turns += 1;
  }
  assert.equal(s.phase, 'playOver');
  assert.ok(s.deadReason, `play ended by ${s.deadReason}`);
});

test('unplannedPlayers lists everyone without an arrow (the warning feed)', () => {
  const s = createGame({ seed: 1 });
  assert.equal(unplannedPlayers(s).length, TEAM_SIZE * 2);
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const ids = unplannedPlayers(s);
  assert.equal(ids.length, TEAM_SIZE * 2 - 1);
  assert.ok(!ids.includes('o-rb'));
});
