import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeFeatures, schemeChoice, learnedCoverAssignments, zoneAnchorsFromGenome,
} from '../../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { coverAssignments } from '../../../lib/game/defense.js';
import { fieldPos } from '../../../lib/game/view.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('schemeFeatures normalizes down, distance and formation spread', () => {
  const s = createGame({ seed: 1 });
  const f = schemeFeatures(s);
  assert.equal(f.down, 0); // 1st down
  assert.equal(f.toGo, 1); // 10 to go
  assert.ok(f.spread > 0 && f.spread <= 1); // receivers split 30 yards
  s.down = 4;
  assert.equal(schemeFeatures(s).down, 1);
});

test('the scheme gate is a thresholded logit over those features', () => {
  const s = createGame({ seed: 1 });
  const man = { ...makeGenome(DEFENSE_SPEC) }; // bias -2, weights 0
  assert.equal(schemeChoice(s, man), 'man');
  const zone = { ...man, 'scheme:bias': 2 };
  assert.equal(schemeChoice(s, zone), 'zone');
  // A distance weight can flip the call between short and long yardage.
  const situational = { ...man, 'scheme:bias': -1, 'scheme:toGo': 4 };
  assert.equal(schemeChoice(s, situational), 'zone'); // 10 to go: toGo = 1
  s.toGoYard = s.losYard + 1; // now short yardage
  assert.equal(schemeChoice(s, situational), 'man');
});

test('with distance-only weights the learned assignment IS the rule-based one', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC); // cov:dist 1, cov:depth 0, cov:width 0
  assert.deepEqual(
    learnedCoverAssignments(s, 'defense', g),
    coverAssignments(s, 'defense'),
  );
});

test('a depth weight re-prioritizes who the corner takes', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Left side of the field, mid-play: the back close but shallow, the
  // receiver a touch further but six yards downfield.
  getPlayer(s, 'o-rb').pos = fieldPos(-14, s.losYard - 1);
  getPlayer(s, 'o-wr1').pos = fieldPos(-15, s.losYard + 6);
  const g = makeGenome(DEFENSE_SPEC);
  const byDist = learnedCoverAssignments(s, 'defense', g);
  assert.equal(byDist.get('d-cb1'), 'o-rb'); // nearest pair wins
  const byDepth = { ...g, 'cov:depth': -2 }; // depth is a discount, not a cost
  assert.equal(learnedCoverAssignments(s, 'defense', byDepth).get('d-cb1'), 'o-wr1');
});

test('zone anchors come off the genome only for men actually on the field', () => {
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  const defense = s.players.filter((p) => p.team === 'defense');
  const anchors = zoneAnchorsFromGenome(defense, g);
  assert.deepEqual(
    anchors.map((a) => a.id).sort(),
    ['d-cb1', 'd-cb2', 'd-lb', 'd-s'],
  );
  const cb1 = anchors.find((a) => a.id === 'd-cb1');
  assert.equal(cb1.across, -12);
  assert.equal(cb1.depth, 4);
  // The offense has no zone keys: no anchors.
  const offense = s.players.filter((p) => p.team === 'offense');
  assert.deepEqual(zoneAnchorsFromGenome(offense, g), []);
});
