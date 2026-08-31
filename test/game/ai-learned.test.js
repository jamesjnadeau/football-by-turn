import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coachAi, coachLearnedDefense, applyOrders, aiPlayers, applyAiModes, clearAiPlans,
} from '../../lib/game/ai.js';
import { createGame, getPlayer, setPlan } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { fieldPos } from '../../lib/game/view.js';
import { DEFENSE_GENOME } from '../../lib/game/learned/defense-genome.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('applyOrders writes plans and covers exactly as coachSmartDefense did', () => {
  const s = afterSnap(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }));
  applyOrders(s, [
    { id: 'd-nt', aim: fieldPos(0, s.losYard - 2), cover: null },
    { id: 'd-cb1', aim: null, cover: 'o-wr1' },
  ]);
  assert.ok(getPlayer(s, 'd-nt').plan);
  assert.equal(getPlayer(s, 'd-nt').cover, null);
  assert.equal(getPlayer(s, 'd-cb1').cover, 'o-wr1');
});

test('aiPlayers and applyAiModes take an explicit team for hot-seat harnesses', () => {
  const s = afterSnap(createGame({ seed: 1 })); // hot-seat: aiTeam null
  assert.equal(aiPlayers(s).length, 0);
  assert.equal(aiPlayers(s, 'defense').length, 7);
  // Park the nose tackle on the carrier: an explicit-team call breaks him down.
  getPlayer(s, 'd-nt').pos = fieldPos(0, s.losYard - 3);
  applyAiModes(s, 'defense');
  assert.equal(getPlayer(s, 'd-nt').mode, 'prepared');
});

test('coachAi dispatches the learned brain', () => {
  // The shipped genome's own scheme call is a trained number that can favor
  // either man or zone by situation — this test is about the WIRING (coachAi
  // reaches the learned brain and writes its orders), not about the shipped
  // genome's specific scheme weights, so the gate is forced firmly to man for
  // the duration of the call and restored after.
  const savedBias = DEFENSE_GENOME.values['scheme:bias'];
  DEFENSE_GENOME.values['scheme:bias'] = -4;
  try {
    const s = afterSnap(createGame({ seed: 3, ai: 'defense', aiLevel: 'learned' }));
    coachAi(s);
    assert.ok(getPlayer(s, 'd-nt').plan, 'the front rushes');
    const covering = s.players.filter((p) => p.team === 'defense' && p.cover).length;
    assert.ok(covering >= 1, 'a man-gated genome plays man');
    clearAiPlans(s);
  } finally {
    DEFENSE_GENOME.values['scheme:bias'] = savedBias;
  }
});

test('a learned-level game runs whole turns without incident', () => {
  const s = createGame({ seed: 7, ai: 'defense', aiLevel: 'learned' });
  const random = mulberry32(7);
  const before = new Map(
    s.players.filter((p) => p.team === 'defense').map((p) => [p.id, { ...p.pos }]),
  );
  // Give the offense something to do so the play is a play.
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  runTurn(s, random);
  assert.ok(['planning', 'playOver'].includes(s.phase));
  const moved = s.players.filter((p) => p.team === 'defense'
    && (p.pos.x !== before.get(p.id).x || p.pos.y !== before.get(p.id).y));
  assert.ok(moved.length > 0, 'the coached defense actually plays');
});
