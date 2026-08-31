import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  learnedOffenseSpots, applyLearnedOffenseFormation, maybeApplyLearnedFormations,
} from '../../../lib/game/learned/formation.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { OFFENSE_GENOME } from '../../../lib/game/learned/offense-genome.js';
import { makeGenome, mutateGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { spotFault, formationFoul } from '../../../lib/game/formation.js';
import { fieldPos } from '../../../lib/game/view.js';
import { hashCentresX } from '../../../lib/field/geometry.js';
import { mulberry32 } from '../../../lib/game/rng.js';

test('a genome offset moves the man to that spot', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'pos:o-rb:across': 8, 'pos:o-rb:down': -6 };
  assert.equal(applyLearnedOffenseFormation(s, g), true);
  assert.deepEqual(getPlayer(s, 'o-rb').pos, fieldPos(8, s.losYard - 6));
});

test('whatever training produces is legal: no fault, no formation flag', () => {
  // Applied first, THEN judged: a candidate spot may legitimately overlap a
  // teammate's OLD spot when that teammate is about to move too, so legality
  // is a fact about the landed formation, not about spots one at a time.
  const rand = mulberry32(13);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(OFFENSE_SPEC, makeGenome(OFFENSE_SPEC), rand, 0.5);
    applyLearnedOffenseFormation(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'offense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
    assert.equal(formationFoul(s), null, `mutation ${i} keeps 5 on the line`);
  }
});

test('the snapper is pinned between the hashes, wherever the genome sends him', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(OFFENSE_SPEC), 'pos:o-c:across': 24 };
  applyLearnedOffenseFormation(s, g);
  const [hashLeft, hashRight] = hashCentresX();
  const c = getPlayer(s, 'o-c');
  assert.ok(c.pos.x >= hashLeft && c.pos.x <= hashRight);
});

test('it refuses once the down is running', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  assert.equal(applyLearnedOffenseFormation(s, makeGenome(OFFENSE_SPEC)), false);
});

test('createGame applies the shipped genome for a learned-level computer offense', () => {
  const saved = OFFENSE_GENOME.values['pos:o-rb:down'];
  OFFENSE_GENOME.values['pos:o-rb:down'] = -9;
  try {
    const s = createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(s, 'o-rb').pos, fieldPos(0, s.losYard - 9));
    assert.ok(s.plannedPass, 'the snap is still aimed, after the move');
    // A learned DEFENSE game leaves the offense alone.
    const d = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    assert.deepEqual(getPlayer(d, 'o-rb').pos, fieldPos(0, d.losYard - 7));
  } finally {
    OFFENSE_GENOME.values['pos:o-rb:down'] = saved;
  }
});
