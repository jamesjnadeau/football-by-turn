import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionGroup, defendDir, losY, pastLine, groupMates,
  interceptPoint, leverageAim, containSide, rushLineman, flowLinebacker,
  deepestThreat, deepMan, deepAim, coverAssignments, coverBack,
} from '../../lib/game/defense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { RADIUS_LINE } from '../../lib/game/constants.js';

test('every defensive role lands in one of the three position groups', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(positionGroup(getPlayer(s, 'd-nt')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-dt1')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-dt2')), 'line');
  assert.equal(positionGroup(getPlayer(s, 'd-lb')), 'backer');
  assert.equal(positionGroup(getPlayer(s, 'd-cb1')), 'back');
  assert.equal(positionGroup(getPlayer(s, 'd-cb2')), 'back');
  assert.equal(positionGroup(getPlayer(s, 'd-s')), 'back');
});

test('a role nobody has taught the defense is coached as a linebacker', () => {
  assert.equal(positionGroup({ role: 'ROVER' }), 'backer');
});

test('the defense protects the goal the offense drives at', () => {
  assert.equal(defendDir('defense'), 1);
  assert.equal(defendDir('offense'), -1);
});

test('the line of scrimmage is wherever the down was spotted', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(losY(s), fieldPos(0, 0).y);
  s.losYard = 4;
  assert.equal(losY(s), fieldPos(0, 4).y);
});

test('past the line is measured toward the goal that team is defending', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const backfield = getPlayer(s, 'o-qb').pos;
  const downfield = { x: 135, y: losY(s) + 1 };
  assert.equal(pastLine(s, 'defense', backfield), false, 'still in the backfield');
  assert.equal(pastLine(s, 'defense', downfield), true);
  assert.equal(pastLine(s, 'offense', downfield), false, 'the other way round');
});

test('group mates are the teammates who play the same position', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(
    groupMates(s, getPlayer(s, 'd-nt')).map((p) => p.id),
    ['d-nt', 'd-dt1', 'd-dt2'],
    'himself included, in formation order',
  );
  assert.deepEqual(groupMates(s, getPlayer(s, 'd-lb')).map((p) => p.id), ['d-lb']);
});

test('a standing man is intercepted where he stands', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(
    interceptPoint(getPlayer(s, 'd-lb'), getPlayer(s, 'o-qb')),
    getPlayer(s, 'o-qb').pos,
  );
});

test('a moving man is intercepted where the two of them arrive together', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const cb = getPlayer(s, 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  cb.pos = { x: 135, y: 100 };          // a skill player: 60 units/s
  qb.pos = { x: 135, y: 130 };          // 30 units away, running away at 30
  qb.vel = { x: 0, y: 30 };
  // One second: the carrier reaches y 160 and so does the corner. Solved, not
  // guessed — the old brain would have aimed at a flat one-second lead here
  // and been right only by coincidence.
  assert.deepEqual(interceptPoint(cb, qb), { x: 135, y: 160 });
});

test('a man who cannot be caught is chased on a capped lead instead', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const cb = getPlayer(s, 'd-cb1');
  const qb = getPlayer(s, 'o-qb');
  cb.pos = { x: 135, y: 100 };
  qb.pos = { x: 135, y: 130 };
  qb.vel = { x: 0, y: 200 };            // faster than anybody, straight away
  // No solution exists, so he falls back to the time it takes to cover the gap
  // he can see: 30 / 60 = half a second of the runner's velocity.
  assert.deepEqual(interceptPoint(cb, qb), { x: 135, y: 230 });
});

test('leverage holds an aim point on the goal side of the man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');      // (135, 100)
  const qb = getPlayer(s, 'o-qb');      // (135, 70) — 30 units away
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: 70 }, qb), { x: 140, y: 74 },
    'aiming level with him would let him run straight past',
  );
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: 90 }, qb), { x: 140, y: 90 },
    'an aim already goal-side of him is left alone',
  );
});

test('leverage is off once he is close enough to go and get him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');
  const qb = getPlayer(s, 'o-qb');
  lb.pos = { x: 135, y: 80 };           // 10 units off him
  assert.deepEqual(leverageAim(lb, { x: 140, y: 70 }, qb), { x: 140, y: 70 });
});

test('the front works out its own edges from where it is standing', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(containSide(s, getPlayer(s, 'd-dt1')), -1, 'left edge');
  assert.equal(containSide(s, getPlayer(s, 'd-nt')), 0, 'straight down the middle');
  assert.equal(containSide(s, getPlayer(s, 'd-dt2')), 1, 'right edge');
});

test('a lone lineman contains nothing — he just goes', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.players = s.players.filter((p) => p.id !== 'd-dt1' && p.id !== 'd-dt2');
  assert.equal(containSide(s, getPlayer(s, 'd-nt')), 0);
});

test('an edge rusher keeps his side of the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // QB (135, 70) standing still; the right tackle is at (144.375, 88.75), well
  // outside attack range, so both leverage and contain are live.
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt2')),
    { aim: { x: 141, y: 74 }, cover: null }, 'stays 6 units to the right of him');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt1')),
    { aim: { x: 129, y: 74 }, cover: null }, 'and 6 to the left');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-nt')),
    { aim: { x: 135, y: 74 }, cover: null }, 'the middle man goes straight at him');
});

test('contain is given up at contact range — then he attacks the man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const dt = getPlayer(s, 'd-dt2');
  dt.pos = { x: 140, y: 76 };   // ~7.8 units off the QB, inside AI_ATTACK_UNITS
  assert.deepEqual(rushLineman(s, dt), { aim: { x: 135, y: 70 }, cover: null });
});

test('a linebacker holds his depth and mirrors the ball across the field', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // The QB is 4 yards deep — nowhere near the line — so the backer does not
  // chase him into the backfield. He sits 8 units on his own side of the line
  // and matches him across it. losY is 85, so his depth is 93.
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: 93 }, cover: null });

  getPlayer(s, 'o-qb').pos = { x: 110, y: 70 }; // rolling out to his left
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 110, y: 93 }, cover: null }, 'slides with him, same depth');
});

test('a linebacker fills once the carrier threatens the line', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  getPlayer(s, 'o-qb').pos = { x: 135, y: 80 }; // 5 units behind the line
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: 84 }, cover: null }, 'downhill, a cushion goal-side');
});

test('the deep man is whoever lines up deepest, not whoever is called safety', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(deepMan(s, 'defense').id, 'd-s');
  getPlayer(s, 'd-cb2').pos = { x: 191.25, y: 200 }; // now HE is the last man back
  assert.equal(deepMan(s, 'defense').id, 'd-cb2');
});

test('the deepest threat is the opponent nearest the goal being defended', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(deepestThreat(s, 'defense').id, 'o-c', 'ties go to formation order');
  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: 100 };
  assert.equal(deepestThreat(s, 'defense').id, 'o-wr2');
});

test('the deep man plays behind the deepest threat and the ball, splitting them', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // Deepest opponent is the line at y 81.25; the ball is the QB at y 70.
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: 135, y: 101.25 });

  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: 100 }; // a receiver gets behind him
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: 163.125, y: 120 },
    'he goes and gets on top of him');
});

test('the corners take the receivers; the deep man takes nobody', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const map = coverAssignments(s, 'defense');
  assert.equal(map.get('d-cb1'), 'o-wr1');
  assert.equal(map.get('d-cb2'), 'o-wr2');
  assert.equal(map.has('d-s'), false, 'the last man back is free');
  assert.equal(map.size, 2);
});

test('a defensive back does not cover a man who cannot run with him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  for (const id of ['o-wr1', 'o-wr2', 'o-rb']) getPlayer(s, id).radius = RADIUS_LINE;
  assert.equal(coverAssignments(s, 'defense').size, 0, 'nobody left worth covering');
  const order = coverBack(s, getPlayer(s, 'd-cb1'));
  assert.equal(order.cover, null);
  assert.deepEqual(order.aim, deepAim(s, getPlayer(s, 'd-cb1')),
    'an unassigned back plays help instead');
});

test('coverBack hands out a man to cover and a spot to the free man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-cb1')), { aim: null, cover: 'o-wr1' });
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-s')),
    { aim: { x: 135, y: 101.25 }, cover: null });
});
