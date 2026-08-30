import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isForward, passFoul, releasePass,
  passSpeed, passReach, passTravel, powerForTravel, passOrigin, passAim,
  receiverAt, lockOnPass, passLanding,
} from '../../lib/game/pass.js';
import { createGame, getPlayer, setPass, setPlan } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { len } from '../../lib/game/vec.js';
import {
  PASS_SPEED_MIN, PASS_SPEED_MAX, PASS_SPAWN_EPSILON, PASS_GRACE_SUBSTEPS,
  PICKUP_RADIUS_BONUS, DT, BALL_FRICTION, SUBSTEPS_PER_TURN,
} from '../../lib/game/constants.js';
import { PASS_REACH_MAX } from '../../lib/game/flight.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { isLob, lobSubsteps, scatterRadius, LOCK_UNITS } from '../../lib/game/lob.js';
import { dist, norm, sub } from '../../lib/game/vec.js';
import { predictRoute } from '../../lib/game/predict.js';

/**
 * The snap taken: the ball in the quarterback's hands and nothing pending.
 * A down now opens with the ball on the CENTRE and a lateral to the
 * quarterback already planned, which is the state before the one these tests
 * are about -- they start from a backfield carrier, so they say so.
 */
function afterSnap(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('forward means toward the goal the offense attacks; a flat lateral is not', () => {
  assert.equal(isForward({ x: 0, y: 1 }), true);
  assert.equal(isForward({ x: 1, y: 0.001 }), true);
  assert.equal(isForward({ x: 0, y: -1 }), false);
  assert.equal(isForward({ x: 1, y: 0 }), false);
});

test('backward throws are always legal, however many have gone before', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  s.forwardPasses = 5;
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null);
  assert.equal(passFoul(s, qb, { x: 1, y: 0 }), null);
});

test('the first forward pass from behind the line is legal; a second is not', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), null);
  s.forwardPasses = 1;
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'second-forward-pass');
});

test('a forward pass from beyond the line of scrimmage is illegal', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  qb.pos = fieldPos(0, s.losYard + 2); // he crossed the line before throwing
  assert.equal(passFoul(s, qb, { x: 0, y: 1 }), 'illegal-forward-pass');
  assert.equal(passFoul(s, qb, { x: 0, y: -1 }), null, 'he may still throw backwards');
});

test('releasing a throw puts the ball in the air, clear of the passer\'s own reach', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const from = { ...qb.pos };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const events = releasePass(s, mulberry32(1));
  assert.equal(s.ball.carrierId, null);
  assert.equal(s.ball.forward, true);
  assert.equal(s.ball.loose, PASS_GRACE_SUBSTEPS);
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9, 'full power');
  const off = Math.hypot(s.ball.pos.x - from.x, s.ball.pos.y - from.y);
  assert.ok(off > qb.radius + PICKUP_RADIUS_BONUS, 'outside his own scoop range');
  assert.ok(Math.abs(off - (qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON)) < 1e-9);
  assert.deepEqual(events, [{ type: 'pass', by: 'o-qb', forward: true }]);
  assert.equal(s.forwardPasses, 1);
  assert.equal(s.penalty, null);
});

test('a non-unit direction does not secretly change the throw\'s power', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  setPass(s, 'o-qb', { x: 0, y: 3 }, 1); // three times as long as a unit vector
  releasePass(s, mulberry32(1));
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9, 'full power, not triple');
});

test('an illegal throw is allowed to happen, and flagged', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  s.forwardPasses = 1; // he already threw one this down
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5);
  const events = releasePass(s, mulberry32(1));
  assert.equal(s.ball.carrierId, null, 'the throw still happens');
  assert.deepEqual(s.penalty, { foul: 'second-forward-pass', spot: s.losYard });
  assert.deepEqual(events[1], { type: 'flag', foul: 'second-forward-pass' });
  assert.equal(s.forwardPasses, 2, 'an illegal forward pass still counts as one');
});

test('a backward throw touches neither the forward tally nor the flag', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0.3);
  releasePass(s, mulberry32(1));
  assert.equal(s.forwardPasses, 0);
  assert.equal(s.penalty, null);
  assert.equal(s.ball.forward, false);
});

test('power scales the throw from the shortest handoff to the longest bomb', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0);
  releasePass(s, mulberry32(1));
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MIN) < 1e-9, 'zero power is still a handoff');
});

test('a fumble between planning and the whistle cancels the throw', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null }; // somebody else has it now
  assert.deepEqual(releasePass(s, mulberry32(1)), []);
  assert.equal(s.ball.carrierId, 'o-rb', 'the ball stays where it is');
  assert.equal(s.forwardPasses, 0);
});

test('nothing planned, nothing thrown', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  assert.deepEqual(releasePass(s, mulberry32(1)), []);
  assert.equal(s.ball.carrierId, 'o-qb');
});

test('only the first flag of a down is kept', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s, mulberry32(1));                       // legal: the down's one forward pass
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s, mulberry32(1));                       // illegal: second forward pass
  const first = { ...s.penalty };
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s, mulberry32(1));                       // illegal again
  assert.deepEqual(s.penalty, first, 'one flag per down, the first one');
  assert.equal(s.forwardPasses, 3);
});

test('a throw\'s speed and its total reach are one arithmetic, shared with the ball', () => {
  assert.ok(Math.abs(passSpeed(0) - PASS_SPEED_MIN) < 1e-9);
  assert.ok(Math.abs(passSpeed(1) - PASS_SPEED_MAX) < 1e-9);
  // The closed form of physics.js's per-sub-step decay, summed out.
  assert.ok(Math.abs(passReach(1) - (PASS_SPEED_MAX * DT) / (1 - BALL_FRICTION)) < 1e-9);
  assert.ok(Math.abs(passReach(1) - PASS_REACH_MAX) < 1e-9, 'the constant is that same number');
  assert.ok(passReach(1) > 111 && passReach(1) < 111.2, 'the longest throw: 111 units, 29.6 yards');
  assert.ok(passReach(0) > 16.6 && passReach(0) < 16.8, 'the shortest: 4.4 yards, a handoff');
});

test('a throw only gets part of the way inside its own turn', () => {
  const whole = passReach(1);
  const turn = passTravel(1, SUBSTEPS_PER_TURN);
  assert.ok(turn < whole, 'the decay never quite arrives');
  assert.ok(Math.abs(turn / whole - 0.8437) < 1e-3, 'about 84% of it in half a second');
  assert.equal(passTravel(1, 0), 0, 'nothing has been thrown yet');
});

test('powerForTravel is the inverse: the power that gets the ball there this turn', () => {
  const units = passTravel(0.4, SUBSTEPS_PER_TURN);
  assert.ok(Math.abs(powerForTravel(units) - 0.4) < 1e-6);
  assert.equal(powerForTravel(0), 0, 'nothing to cover is the softest throw there is');
  assert.equal(powerForTravel(10000), 1, 'and no drag throws it further than full power');
});

test('a throw starts at the passer\'s leading edge and is aimed a reach beyond it', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const origin = passOrigin(qb, { x: 0, y: 2 }); // non-unit on purpose
  const edge = qb.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
  assert.ok(Math.abs(origin.y - (qb.pos.y + edge)) < 1e-9, 'his leading edge, not his centre');
  assert.ok(Math.abs(origin.x - qb.pos.x) < 1e-9);
  const aim = passAim(qb, { x: 0, y: 2 }, 1);
  assert.ok(Math.abs(aim.y - (origin.y + passReach(1))) < 1e-9, 'a full reach past the hand');
});

test('a throw that reaches past the lock zone is flown, not rolled', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  const qb = getPlayer(s, 'o-qb');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  releasePass(s, mulberry32(5));
  const lob = s.ball.lob;
  assert.ok(lob, 'full power arcs');
  assert.deepEqual(lob.from, s.ball.pos, 'it starts where the ball starts');
  assert.equal(lob.elapsed, 0);
  const aim = passAim(qb, { x: 0, y: 1 }, 1);
  assert.ok(dist(lob.to, aim) <= scatterRadius(passReach(1)) + 1e-9, 'lands inside the circle');
  assert.equal(lob.substeps, lobSubsteps(dist(lob.from, lob.to)));
  assert.ok(Math.abs(len(s.ball.vel) - PASS_SPEED_MAX) < 1e-9,
    'vel is still what it left the hand at — nothing integrates it while it flies');
});

test('a throw that stays inside the lock zone is the ordinary rolling ball it always was', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4); // 14.5 yards: just short of a lob
  releasePass(s, mulberry32(5));
  assert.ok(!isLob(passReach(0.4)), 'the fixture is on the right side of the line');
  assert.equal(s.ball.lob, null);
});

test('a handoff never becomes a lob', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: -1 }, 0);
  releasePass(s, mulberry32(5));
  assert.equal(s.ball.lob, null);
});

test('a locked-on throw is never a lob, however hard it has to be thrown', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1, 'o-wr1');
  releasePass(s, mulberry32(5));
  assert.equal(s.ball.lob, null, 'a ball aimed at a man stays in reach of him');
});

test('the same seed throws the same lob, a different one does not', () => {
  const throwIt = (seed) => {
    const s = createGame({ seed: 1 });
    afterSnap(s); // the centre starts with it now; this is about the throw
    setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
    releasePass(s, mulberry32(seed));
    return s.ball.lob.to;
  };
  assert.deepEqual(throwIt(11), throwIt(11));
  assert.notDeepEqual(throwIt(11), throwIt(12));
});

test('a short throw draws no dice at all, so it cannot shift a seeded game', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s); // the centre starts with it now; this is about the throw
  const random = mulberry32(2);
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.2);
  releasePass(s, random);
  assert.equal(random(), mulberry32(2)(), 'the stream is exactly where it was');
});

test('a throw drag onto one of your own inside the lock zone picks him out', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x + 20, y: qb.pos.y + 20 }; // 28 units: comfortably inside
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), 'o-wr1');
  assert.equal(receiverAt(s, { x: wr.pos.x + 30, y: wr.pos.y }, 'o-qb'), null, 'nobody there');
});

test('nothing locks on but your own men, and never the passer himself', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const cb = getPlayer(s, 'd-cb1');
  cb.pos = { x: qb.pos.x + 20, y: qb.pos.y + 20 };
  assert.equal(receiverAt(s, { ...cb.pos }, 'o-qb'), null, 'you cannot throw it to them');
  assert.equal(receiverAt(s, { ...qb.pos }, 'o-qb'), null, 'nor to yourself');
});

test('a man past the lock zone cannot be locked onto, however close the drag lands', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + LOCK_UNITS - 1 };
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), 'o-wr1', 'a yard inside: fine');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + LOCK_UNITS + 1 };
  assert.equal(receiverAt(s, { ...wr.pos }, 'o-qb'), null, 'a yard outside: throw a lob instead');
});

test('a lock-on is aimed at the man and thrown hard enough to reach him this turn', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  const { dir, power } = lockOnPass(qb, wr);
  assert.ok(Math.abs(dir.x) < 1e-9 && Math.abs(dir.y - 1) < 1e-9, 'straight at him');
  // The promise is a MEETING, not an arrival at the whistle: some sub-step of
  // this turn puts the ball inside his reach. Solving it that way is what lets
  // a short throw find a man moving across it, where a ball timed to land on
  // the whistle would cross the spot before he got there.
  const gap = dist(passOrigin(qb, dir), wr.pos);
  const reach = wr.radius + PICKUP_RADIUS_BONUS;
  let meets = 0;
  for (let n = 1; n <= SUBSTEPS_PER_TURN; n++) {
    if (Math.abs(passTravel(power, n) - gap) <= reach) meets += 1;
  }
  assert.ok(meets > 0, 'the ball is on him inside the turn, not 84% of the way');
  assert.ok(passTravel(power, SUBSTEPS_PER_TURN) >= gap - reach, 'it does get all the way there');
});

test('a throw short of the lock zone has no landing circle; a lob has one that grows', () => {
  const s = createGame({ seed: 1 });
  const qb = getPlayer(s, 'o-qb');
  const dir = { x: 0, y: 1 };
  assert.equal(passLanding(qb, dir, 0.4), null, 'a flat throw lands where it is aimed');
  const land = passLanding(qb, dir, 1);
  assert.deepEqual(land.pos, passAim(qb, dir, 1));
  assert.ok(Math.abs(land.radius - scatterRadius(passReach(1))) < 1e-9);
  assert.ok(land.radius > passLanding(qb, dir, 0.6).radius, 'the longer the throw, the bigger the guess');
});

test('a lock-on aims where the receiver will be, not where he is standing', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x + 20, y: qb.pos.y + 10 };
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1); // he is running downfield
  const led = lockOnPass(qb, wr);
  const flat = norm(sub(wr.pos, qb.pos));
  assert.ok(led.dir.y > flat.y, 'the throw is aimed ahead of him, not at him');
  // And precisely: at one of the spots his own route actually puts him.
  const onRoute = predictRoute(wr).some((spot) => {
    const d = norm(sub(spot, qb.pos));
    return Math.abs(d.x - led.dir.x) < 1e-9 && Math.abs(d.y - led.dir.y) < 1e-9;
  });
  assert.ok(onRoute, 'the ball is thrown at a place he is going to be');
});

test('a receiver standing still is thrown at where he stands', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 30 };
  const led = lockOnPass(qb, wr);
  assert.ok(Math.abs(led.dir.x) < 1e-9 && Math.abs(led.dir.y - 1) < 1e-9, 'straight at him');
});

test('the lock is re-aimed at the whistle, so the route can be drawn after the throw', () => {
  const s = createGame({ seed: 1 });
  afterSnap(s);
  const wr = getPlayer(s, 'o-wr1');
  const qb = getPlayer(s, 'o-qb');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 20 };
  // The coach locks on first, with a direction that means nothing...
  setPass(s, 'o-qb', { x: 1, y: 0 }, 0, 'o-wr1');
  // ...and only then sends the man deep.
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1);
  const solved = lockOnPass(qb, wr);
  releasePass(s, mulberry32(1));
  const flew = norm(s.ball.vel);
  assert.ok(Math.abs(flew.x - solved.dir.x) < 1e-9, 'thrown at the man, not along the drag');
  assert.ok(Math.abs(flew.y - solved.dir.y) < 1e-9);
  assert.ok(Math.abs(len(s.ball.vel) - passSpeed(solved.power)) < 1e-9, 'and at the solved pace');
});
