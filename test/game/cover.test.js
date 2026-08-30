import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opponentAt, setCover, clearCover, coverAim, updateCoverPlans, grabBonus,
} from '../../lib/game/cover.js';
import { createGame, getPlayer, setPlan, clearAllPlans } from '../../lib/game/state.js';
import { runTurn } from '../../lib/game/turn.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { effectiveMass } from '../../lib/game/modes.js';
import {
  COVER_LEAD_MAX_SECONDS, PICK_SLOP_UNITS, COVER_MASS_MULT, COVER_GRAB_REACH,
  HOLD_MASS_MULT,
} from '../../lib/game/constants.js';
import { len, sub, dist } from '../../lib/game/vec.js';

test('every player starts covering nobody', () => {
  const s = createGame({ seed: 1 });
  assert.ok(s.players.every((p) => p.cover === null));
});

test('opponentAt finds only the other team, and only within pick range', () => {
  const s = createGame({ seed: 1 });
  const nt = getPlayer(s, 'd-nt');
  assert.equal(opponentAt(s, nt.pos, 'offense'), 'd-nt');
  assert.equal(opponentAt(s, nt.pos, 'defense'), null, 'his own team is not a target');
  // Probed along y, not x: the linemen stand 2.5 yards (9.375 units) apart and
  // a lineman's pick circle is 5.5 units, so the circles of adjacent linemen
  // overlap and a point just outside the nose tackle's is inside a tackle's.
  // In front of him there is nothing else on his team for 10 units.
  const justOutside = { x: nt.pos.x, y: nt.pos.y - (nt.radius + PICK_SLOP_UNITS + 0.1) };
  assert.equal(opponentAt(s, justOutside, 'offense'), null);
  const justInside = { x: nt.pos.x, y: nt.pos.y - (nt.radius + PICK_SLOP_UNITS - 0.1) };
  assert.equal(opponentAt(s, justInside, 'offense'), 'd-nt', 'and inside it, he is picked');
});

test('covering an opponent records him and aims a full-throttle plan at him', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setCover(s, 'o-c', 'd-nt'), true);
  const c = getPlayer(s, 'o-c');
  assert.equal(c.cover, 'd-nt');
  assert.equal(c.plan.throttle, 1);
  assert.equal(c.plan.target, null, 'a cover order has no landing spot to draw');
  assert.ok(c.plan.dir.y > 0, 'pointed at the man across from him');
});

test('you cannot cover your own team, and covering fails cleanly', () => {
  const s = createGame({ seed: 1 });
  assert.equal(setCover(s, 'o-c', 'o-lg'), false);
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('a later drag replaces the cover order', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  setPlan(s, 'o-c', { x: 1, y: 0 }, 1);
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('clearing plans clears cover orders too', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  clearAllPlans(s);
  assert.equal(getPlayer(s, 'o-c').cover, null);
  assert.equal(getPlayer(s, 'o-c').plan, null);
});

test('clearCover leaves the man standing where he was told to be', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  clearCover(s, 'o-c');
  assert.equal(getPlayer(s, 'o-c').cover, null);
});

test('with no carrier of his own the blocker shadows the target, led', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: null, pos: null, vel: null };
  setCover(s, 'o-c', 'd-nt');
  const nt = getPlayer(s, 'd-nt');
  nt.vel = { x: 20, y: 0 };
  const aim = coverAim(s, getPlayer(s, 'o-c'));
  assert.ok(aim.x > nt.pos.x, 'ahead of him, not at him');
  assert.ok(aim.x - nt.pos.x <= 20 * COVER_LEAD_MAX_SECONDS + 1e-9, 'the lead is capped');
});

test('with the ball on his own team the blocker interposes', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  const qb = getPlayer(s, 'o-qb'); // the carrier, behind the line
  const aim = coverAim(s, c);
  // The QB is upfield of the nose tackle in board coordinates (smaller y), so
  // getting between them means aiming short of the target.
  assert.ok(aim.y < nt.pos.y, 'on the carrier side of the man he is blocking');
  assert.ok(dist(aim, qb.pos) < dist(nt.pos, qb.pos), 'closer to the ball than the target is');
});

test('the assist re-aims the plan as the covered man moves', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const before = { ...getPlayer(s, 'o-c').plan.dir };
  const nt = getPlayer(s, 'd-nt');
  nt.pos = { x: nt.pos.x + 40, y: nt.pos.y };
  updateCoverPlans(s);
  const after = getPlayer(s, 'o-c').plan.dir;
  assert.ok(after.x > before.x + 0.3, 'swung toward where he went');
  assert.ok(Math.abs(len(after) - 1) < 1e-9, 'still a unit direction');
});

test('a covering blocker chases a target he could never have been pointed at', () => {
  // The order is drawn once, at the top of the turn, but the aim is refreshed
  // every sub-step — so a target who cuts sideways is still followed.
  const s = createGame({ seed: 1, ai: null });
  s.players = s.players.filter((p) => ['o-c', 'd-nt', 'o-qb'].includes(p.id));
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  nt.pos = { x: c.pos.x, y: c.pos.y + 30 };
  setCover(s, 'o-c', 'd-nt');
  setPlan(s, 'd-nt', { x: 1, y: 0 }, 1);   // the target breaks hard to his right
  const startGap = dist(c.pos, nt.pos);
  runTurn(s, mulberry32(1));
  assert.ok(c.vel.x > 0, 'the blocker turned after him rather than running straight');
  assert.ok(dist(c.pos, nt.pos) < startGap, 'and closed the gap');
});

test('a player covering nobody is untouched by the assist', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.5, { x: 1, y: 2 });
  updateCoverPlans(s);
  assert.equal(getPlayer(s, 'o-rb').plan.throttle, 0.5);
  assert.deepEqual(getPlayer(s, 'o-rb').plan.target, { x: 1, y: 2 });
});

test('covering a man makes him heavier to shove, slightly', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const plain = effectiveMass(c);
  setCover(s, 'o-c', 'd-nt');
  assert.ok(Math.abs(effectiveMass(c) - plain * COVER_MASS_MULT) < 1e-9);
  assert.ok(COVER_MASS_MULT < HOLD_MASS_MULT, 'a nudge, not the holding stance');
});

test('the boost is only worth having while the order stands', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const plain = effectiveMass(c);
  setCover(s, 'o-c', 'd-nt');
  clearCover(s, 'o-c');
  assert.equal(effectiveMass(c), plain);
});

test('grab reach is granted between the coverer and his man, and nobody else', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  const dt = getPlayer(s, 'd-dt1');
  const lg = getPlayer(s, 'o-lg');
  assert.equal(grabBonus(c, nt), COVER_GRAB_REACH);
  assert.equal(grabBonus(nt, c), COVER_GRAB_REACH, 'symmetric: order of the pair is irrelevant');
  assert.equal(grabBonus(c, dt), 0, 'not against the man he did not take');
  assert.equal(grabBonus(lg, nt), 0, 'and not for the man who gave no order');
});
