import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAnchorPoint, zoneThreats, zoneOrders } from '../../lib/game/zone.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';

/** The snap taken: ball in the quarterback's hands, nothing pending. */
function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

const ANCHORS = [
  { id: 'd-cb1', across: -12, depth: 4 },
  { id: 'd-s', across: 0, depth: 9 },
];

test('zoneAnchorPoint sits across/depth yards off the line, on the defended side', () => {
  const s = createGame({ seed: 1 });
  const p = zoneAnchorPoint(s, 'defense', -12, 4);
  assert.deepEqual(p, fieldPos(-12, s.losYard + 4));
});

test('zoneThreats is every opposing non-carrier', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const ids = zoneThreats(s, 'defense').map((p) => p.id).sort();
  assert.equal(ids.length, 6); // seven on offense, minus the carrier
  assert.ok(!ids.includes('o-qb'));
  assert.ok(ids.includes('o-wr1'));
});

test('an empty zone holds its anchor', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Sweep the whole offense far right: nobody is near cb1's left-side anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.deepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
  assert.equal(order.cover, null);
});

test('a threat in the zone is played with leverage, not covered', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = fieldPos(-12, s.losYard + 3); // inside cb1's zone, past the line
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.equal(order.cover, null);
  // Leverage: the aim stays on the goal side of the threat.
  assert.ok(order.aim.y >= wr.pos.y);
  // And it is no longer the bare anchor.
  assert.notDeepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
});

test('a threat belongs to the NEAREST anchor, not to every zone', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  // Park everyone far right except one deep-middle man: nearest to d-s's anchor.
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  getPlayer(s, 'o-wr1').pos = fieldPos(0, s.losYard + 8);
  const orders = zoneOrders(s, 'defense', ANCHORS);
  const cb1 = orders.find((o) => o.id === 'd-cb1');
  const safety = orders.find((o) => o.id === 'd-s');
  assert.deepEqual(cb1.aim, zoneAnchorPoint(s, 'defense', -12, 4)); // his zone is empty
  assert.notDeepEqual(safety.aim, zoneAnchorPoint(s, 'defense', 0, 9)); // his is not
});

test('a lineman lumbering through a zone is not a threat worth leaving the anchor for', () => {
  const s = afterSnap(createGame({ seed: 1 }));
  for (const p of s.players) {
    if (p.team === 'offense') p.pos = fieldPos(20, s.losYard - 2);
  }
  getPlayer(s, 'o-lg').pos = fieldPos(-12, s.losYard + 3); // a guard, in cb1's zone
  const order = zoneOrders(s, 'defense', ANCHORS).find((o) => o.id === 'd-cb1');
  assert.deepEqual(order.aim, zoneAnchorPoint(s, 'defense', -12, 4));
});
