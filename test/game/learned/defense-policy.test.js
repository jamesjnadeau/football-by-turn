import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schemeFeatures, schemeChoice, learnedCoverAssignments, zoneAnchorsFromGenome,
  learnedOrders,
} from '../../../lib/game/learned/defense-policy.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { coverAssignments } from '../../../lib/game/defense.js';
import { fieldPos } from '../../../lib/game/view.js';
import { zoneAnchorPoint } from '../../../lib/game/zone.js';
import { advancePlay, snapLook } from '../../../lib/game/read.js';

function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('schemeFeatures normalizes down, distance and formation spread', () => {
  const s = createGame({ seed: 1 });
  const look = snapLook(s);
  const f = schemeFeatures(s, look);
  assert.equal(f.down, 0); // 1st down
  assert.equal(f.toGo, 1); // 10 to go
  assert.ok(f.spread > 0 && f.spread <= 1); // receivers split 30 yards
  s.down = 4;
  assert.equal(schemeFeatures(s, look).down, 1);
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

test('a man-genome defense rushes its front and covers with its backs', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = makeGenome(DEFENSE_SPEC); // scheme:bias -2 => man
  const orders = learnedOrders(s, 'defense', g);
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const id of ['d-nt', 'd-dt1', 'd-dt2']) {
    assert.ok(byId.get(id).aim, `${id} rushes`);
    assert.equal(byId.get(id).cover, null);
  }
  const covering = orders.filter((o) => o.cover).length;
  assert.ok(covering >= 2, 'both corners have a man');
  // The free man (deepest back) plays help, not a man.
  assert.equal(byId.get('d-s').cover, null);
  assert.ok(byId.get('d-s').aim);
});

test('a zone-genome defense sends its coverage bodies to anchors, never to men', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': 4 }; // always zone
  const orders = learnedOrders(s, 'defense', g);
  const byId = new Map(orders.map((o) => [o.id, o]));
  for (const id of ['d-cb1', 'd-cb2', 'd-lb', 'd-s']) {
    assert.equal(byId.get(id).cover, null, `${id} zones, never covers`);
    assert.ok(byId.get(id).aim, `${id} has somewhere to be`);
  }
  // An empty zone's order is literally its anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  const again = new Map(learnedOrders(s, 'defense', g).map((o) => [o.id, o]));
  assert.deepEqual(again.get('d-cb1').aim, zoneAnchorPoint(s, 'defense', -12, 4));
});

test('a loose ball turns every assignment into a footrace', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: fieldPos(3, s.losYard + 2), vel: { x: 0, y: 0 } };
  s.plannedPass = null;
  const orders = learnedOrders(s, 'defense', makeGenome(DEFENSE_SPEC));
  assert.equal(orders.length, 7);
  for (const o of orders) {
    assert.equal(o.cover, null);
    assert.deepEqual(o.aim, fieldPos(3, s.losYard + 2));
  }
});

test('a carrier past the line ends the scheme: everyone converges', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  getPlayer(s, 'o-qb').pos = fieldPos(0, s.losYard + 3);
  const orders = learnedOrders(s, 'defense', makeGenome(DEFENSE_SPEC));
  assert.equal(orders.length, 7);
  for (const o of orders) {
    assert.equal(o.cover, null);
    assert.ok(o.aim, `${o.id} converges`);
  }
});

test('the scheme is called once and does not flip when men scatter', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  // A gate that answers purely to spread, tuned so the two pictures land on
  // OPPOSITE sides of it: at the snap spread is 0.5625 and z = -3 + 4(0.5625)
  // = -0.75, which is man; once they scatter spread is 0.975 and z = +0.9,
  // which is zone. A genome that read the same class either way would make
  // this test prove nothing.
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -3, 'scheme:spread': 4 };
  advancePlay(s, g);
  learnedOrders(s, 'defense', g);
  const called = s.playRead.call.defense.scheme;
  assert.equal(called, 'man'); // the class the snap look implies

  // Now sweep the offense to both sidelines — a live gate would flip to zone.
  const half = s.players.filter((p) => p.team === 'offense');
  half.forEach((p, i) => { p.pos = fieldPos(i % 2 ? 26 : -26, s.losYard - 1); });
  // Pin the counterfactual: this is the live answer the old code would have
  // used, which proves the two pictures really do differ.
  assert.equal(schemeChoice(s, g, null, snapLook(s)), 'zone');
  advancePlay(s, g);
  learnedOrders(s, 'defense', g);
  assert.equal(s.playRead.call.defense.scheme, called);
});

test('a defender keeps the man he took, even when somebody nearer appears', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  const g = { ...makeGenome(DEFENSE_SPEC), 'scheme:bias': -4 }; // firmly man
  advancePlay(s, g);
  const first = learnedOrders(s, 'defense', g);
  const covers = (orders) => Object.fromEntries(
    orders.filter((o) => o.cover).map((o) => [o.id, o.cover]),
  );
  const before = covers(first);
  assert.ok(Object.keys(before).length > 0, 'somebody must be covering somebody');

  // Swap the receivers' positions: a greedy re-claim would re-pair them.
  const wr1 = s.players.find((p) => p.id === 'o-wr1');
  const wr2 = s.players.find((p) => p.id === 'o-wr2');
  const held = wr1.pos;
  wr1.pos = wr2.pos;
  wr2.pos = held;

  advancePlay(s, g);
  assert.deepEqual(covers(learnedOrders(s, 'defense', g)), before);
});
