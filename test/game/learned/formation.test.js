import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  learnedDefenseSpots, applyLearnedDefenseFormation, maybeApplyLearnedFormations,
} from '../../../lib/game/learned/formation.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { DEFENSE_GENOME } from '../../../lib/game/learned/defense-genome.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { spotFault } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { SIDELINE_RIGHT } from '../../../lib/field/geometry.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { mutateGenome } from '../../../lib/game/learned/genome.js';

test('a genome offset moves the man to that spot', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'pos:d-s:across': 5, 'pos:d-s:down': 10 };
  assert.equal(applyLearnedDefenseFormation(s, g), true);
  assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(5, s.losYard + 10));
});

test('everything a training run can express lands legal on the board', () => {
  // Twenty heavy mutations of the seed: whatever training produces, the
  // LANDED formation must be one formation.js itself would allow — inbounds,
  // on the defense's side, nobody inside anybody. Checked after applying
  // (not spot-by-spot beforehand), because a candidate spot may legitimately
  // overlap a teammate's OLD spot when that teammate is about to move too.
  const rand = mulberry32(7);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    applyLearnedDefenseFormation(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});

test('an across value past the sideline is pulled inbounds', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'pos:d-cb2:across': 24 };
  applyLearnedDefenseFormation(s, g);
  const cb2 = getPlayer(s, 'd-cb2');
  assert.ok(cb2.pos.x + cb2.radius <= SIDELINE_RIGHT);
});

test('two men aimed at one spot are nudged apart, not stacked', () => {
  const s = createGame({ seed: 1 });
  const g = {
    ...makeGenome(DEFENSE_SPEC),
    'pos:d-lb:across': 0, 'pos:d-lb:down': 5,
    'pos:d-s:across': 0, 'pos:d-s:down': 5,
  };
  applyLearnedDefenseFormation(s, g);
  const lb = getPlayer(s, 'd-lb');
  const safety = getPlayer(s, 'd-s');
  const gap = Math.hypot(lb.pos.x - safety.pos.x, lb.pos.y - safety.pos.y);
  assert.ok(gap >= lb.radius + safety.radius);
});

test('it refuses once the down is running', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(applyLearnedDefenseFormation(s, makeGenome(DEFENSE_SPEC)), false);
});

test('createGame applies the shipped genome for a learned-level defense', () => {
  const saved = DEFENSE_GENOME.values['pos:d-s:down'];
  DEFENSE_GENOME.values['pos:d-s:down'] = 11;
  try {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(0, s.losYard + 11));
    // ...and not for the other brains, or for other teams' coaches.
    const smart = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
    assert.deepEqual(getPlayer(smart, 'd-s').pos, fieldPos(0, smart.losYard + 8));
  } finally {
    DEFENSE_GENOME.values['pos:d-s:down'] = saved;
  }
});

test('maybeApplyLearnedFormations leaves other variants alone', () => {
  const saved = DEFENSE_GENOME.values['pos:d-s:down'];
  DEFENSE_GENOME.values['pos:d-s:down'] = 11;
  try {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned', variant: '11' });
    assert.deepEqual(getPlayer(s, 'd-s').pos, fieldPos(0, s.losYard + 8));
  } finally {
    DEFENSE_GENOME.values['pos:d-s:down'] = saved;
  }
});
