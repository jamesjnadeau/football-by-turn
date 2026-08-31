import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionGroup, defendDir, losY, pastLine, groupMates,
  interceptPoint, leverageAim, containRank, rushLineman, flowLinebacker,
  deepestThreat, deepestOpenThreat, deepMan, deepAim, coverAssignments, coverBack,
  smartOrder, smartOrders,
} from '../../lib/game/defense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { RADIUS_LINE, AI_LEVERAGE_CUSHION, AI_DEEP_CUSHION_UNITS } from '../../lib/game/constants.js';

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
  assert.equal(losY(s), fieldPos(0, s.losYard).y);
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
  const lb = getPlayer(s, 'd-lb');
  const qb = getPlayer(s, 'o-qb');      // 30 units away from the backer
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: qb.pos.y }, qb), { x: 140, y: qb.pos.y + AI_LEVERAGE_CUSHION },
    'aiming level with him would let him run straight past',
  );
  assert.deepEqual(
    leverageAim(lb, { x: 140, y: qb.pos.y + 20 }, qb), { x: 140, y: qb.pos.y + 20 },
    'an aim already goal-side of him is left alone',
  );
});

test('leverage is off once he is close enough to go and get him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const lb = getPlayer(s, 'd-lb');
  const qb = getPlayer(s, 'o-qb');
  lb.pos = { x: 135, y: qb.pos.y + 10 };           // 10 units off him
  assert.deepEqual(leverageAim(lb, { x: 140, y: qb.pos.y }, qb), { x: 140, y: qb.pos.y });
});

test('the front works out its own edges from where it is standing', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  assert.equal(containRank(s, getPlayer(s, 'd-dt1')), -1, 'left edge');
  assert.equal(containRank(s, getPlayer(s, 'd-nt')), 0, 'straight down the middle');
  assert.equal(containRank(s, getPlayer(s, 'd-dt2')), 1, 'right edge');
});

test('a lone lineman contains nothing — he just goes', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.players = s.players.filter((p) => p.id !== 'd-dt1' && p.id !== 'd-dt2');
  assert.equal(containRank(s, getPlayer(s, 'd-nt')), 0);
});

test('an edge rusher keeps his side of the ball', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb'); // standing still; the tackles are well outside attack range
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt2')),
    { aim: { x: 141, y: qb.pos.y + AI_LEVERAGE_CUSHION }, cover: null }, 'stays 6 units to the right of him');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-dt1')),
    { aim: { x: 129, y: qb.pos.y + AI_LEVERAGE_CUSHION }, cover: null }, 'and 6 to the left');
  assert.deepEqual(rushLineman(s, getPlayer(s, 'd-nt')),
    { aim: { x: 135, y: qb.pos.y + AI_LEVERAGE_CUSHION }, cover: null }, 'the middle man goes straight at him');
});

test('contain is given up at contact range — then he attacks the man', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  const dt = getPlayer(s, 'd-dt2');
  const qb = getPlayer(s, 'o-qb');
  dt.pos = { x: 140, y: qb.pos.y + 6 };   // ~7.8 units off the QB, inside AI_ATTACK_UNITS
  assert.deepEqual(rushLineman(s, dt), { aim: { x: 135, y: qb.pos.y }, cover: null });
});

test('a linebacker holds his depth and mirrors the ball across the field', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  // The QB is 4 yards deep — nowhere near the line — so the backer does not
  // chase him into the backfield. He sits AI_BACKER_DEPTH_UNITS on his own
  // side of the line and matches him across it.
  const depth = losY(s) + 8;
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: depth }, cover: null });

  const qbY = getPlayer(s, 'o-qb').pos.y;
  getPlayer(s, 'o-qb').pos = { x: 110, y: qbY }; // rolling out to his left
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 110, y: depth }, cover: null }, 'slides with him, same depth');
});

test('a linebacker fills once the carrier threatens the line', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 135, y: losY(s) - 5 }; // 5 units behind the line
  assert.deepEqual(flowLinebacker(s, getPlayer(s, 'd-lb')),
    { aim: { x: 135, y: qb.pos.y + AI_LEVERAGE_CUSHION }, cover: null }, 'downhill, a cushion goal-side');
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
  // Deeper than the line (o-c), which sits one yard behind the LOS.
  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: losY(s) + 15 };
  assert.equal(deepestThreat(s, 'defense').id, 'o-wr2');
});

test('the deep man plays behind the deepest threat and the ball, splitting them', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // This roster fields three receiver-threats (both WRs and the RB) for only
  // two corners, so the RB is always the odd man out for a dedicated back —
  // see 'the backer covers whoever a bunch left open' below. Neutralised here
  // so this test is about the deepest-threat/ball split alone, not about who
  // is genuinely left open.
  getPlayer(s, 'o-rb').radius = RADIUS_LINE;
  // Deepest opponent is the line, one yard behind the LOS; the ball is the QB,
  // shallower still, so the line sets the depth.
  const lineY = getPlayer(s, 'o-c').pos.y;
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: 135, y: lineY + AI_DEEP_CUSHION_UNITS });

  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: losY(s) + 15 }; // a receiver gets behind him
  const deep = getPlayer(s, 'o-wr2').pos;
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), { x: (135 + deep.x) / 2, y: deep.y + AI_DEEP_CUSHION_UNITS },
    'he goes and gets on top of him');
});

test('the corners take the receivers; the deep man takes nobody', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // Neutralise the RB as a threat — see the comment in the deep-man test
  // above — so this is the plain two-corners-two-WRs case the name describes,
  // with nobody left over for the backer to help with.
  getPlayer(s, 'o-rb').radius = RADIUS_LINE;
  const map = coverAssignments(s, 'defense');
  assert.equal(map.get('d-cb1'), 'o-wr1');
  assert.equal(map.get('d-cb2'), 'o-wr2');
  assert.equal(map.has('d-s'), false, 'the last man back is free');
  assert.equal(map.size, 2);
});

/**
 * Flex the RB out next to WR1 so both corners are drawn to the left side of
 * the field — one takes WR1, the other loses the greedy race for WR2 and
 * settles for the nearer RB instead — leaving WR2, isolated on the right,
 * with no dedicated back anywhere near him. This is the bug: two corners can
 * still burn themselves on one side of a bunch and leave the far side wide
 * open, and nothing used to notice.
 */
function bunchOneSideIsolateWr2(s) {
  // WR1 runs a deep route, so the man who WAS covering him (before he gets
  // reassigned to the isolated WR2 below) also happens to be this defense's
  // deepest, best-covered threat -- which is what makes the free safety's old
  // "just play over whoever is deepest" logic wrong here, not merely
  // untested.
  getPlayer(s, 'o-wr1').pos = { x: 78.75, y: losY(s) + 20 };
  getPlayer(s, 'o-rb').pos = { x: 88.75, y: 118.75 }; // flexed out next to WR1
  getPlayer(s, 'o-wr2').pos = { x: 191.25, y: losY(s) + 5 }; // isolated, alone on the right
  getPlayer(s, 'd-cb2').pos = { x: 100, y: 130 }; // drawn toward the bunch
  return s;
}

test('the backer covers whoever a bunch left open', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  bunchOneSideIsolateWr2(s);

  const map = coverAssignments(s, 'defense');
  assert.equal(map.get('d-cb1'), 'o-wr1', 'the near corner still takes WR1');
  assert.equal(map.get('d-cb2'), 'o-rb', 'the other corner loses the race and settles for the RB');
  assert.equal(map.get('d-lb'), 'o-wr2', 'the backer mops up whoever is left — WR2, alone on the far side');

  assert.deepEqual(coverBack(s, getPlayer(s, 'd-lb')), { aim: null, cover: 'o-wr2' },
    'and coverBack sees it exactly like a back would');
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-lb')), { aim: null, cover: 'o-wr2' },
    'smartOrder actually sends him there, rather than leaving him to mirror the ball');
});

test('the deep man shades toward whoever a bunch left open, not merely whoever is deepest', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  bunchOneSideIsolateWr2(s);

  // WR1 -- deep AND covered by CB1 -- is still the deepest opponent on the
  // field by raw depth alone.
  assert.equal(deepestThreat(s, 'defense').id, 'o-wr1');
  // But he already has a man. WR2 does not, so he is who the free safety
  // actually has to worry about.
  assert.equal(deepestOpenThreat(s, 'defense').id, 'o-wr2');

  const wr2 = getPlayer(s, 'o-wr2').pos;
  const bp = getPlayer(s, 'o-c').pos; // the carrier, pre-snap
  const shaded = {
    x: (wr2.x + bp.x) / 2,
    y: Math.max(wr2.y, bp.y) + AI_DEEP_CUSHION_UNITS,
  };
  assert.deepEqual(deepAim(s, getPlayer(s, 'd-s')), shaded,
    'over WR2, not over the deeper but covered WR1');
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-s')), { aim: shaded, cover: null });

  // The old, coverage-blind anchor -- deepest opponent overall -- would have
  // played over WR1 instead. Confirms the fix actually changes the number,
  // not just which function's name gets called.
  const wr1 = getPlayer(s, 'o-wr1').pos;
  const oldAnchor = {
    x: (wr1.x + bp.x) / 2,
    y: Math.max(wr1.y, bp.y) + AI_DEEP_CUSHION_UNITS,
  };
  assert.notDeepEqual(shaded, oldAnchor);
});

test('a full-strength secondary leaves the backer alone — nobody is left open to begin with', () => {
  // The eleven-a-side roster fields exactly as many dedicated backs (two
  // corners and a free safety... but the FS himself is free, so really the
  // corners and the extra safety, d-fs) as it does receiver-threats (both
  // WRs and the RB), by design -- see rosters.js's own comment on
  // ELEVEN_OFFENSE. At the default alignment nobody is bunched and nobody
  // is short a man, so the fix must be a no-op here: both linebackers keep
  // doing their own job, and coverAssignments hands out no more than the
  // three receivers it always did.
  const s = createGame({ seed: 1, ai: 'defense', variant: '11' });
  const map = coverAssignments(s, 'defense');
  assert.equal(map.size, 3, 'wr1, wr2 and the rb — all dedicated backs, no backer needed');
  assert.equal(map.has('d-lb'), false);
  assert.equal(map.has('d-lb2'), false);
  assert.equal(deepestOpenThreat(s, 'defense'), null, 'nobody is left open');

  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-lb')), flowLinebacker(s, getPlayer(s, 'd-lb')),
    'both backers still just mirror the ball — no assignment pulled them out of it');
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-lb2')), flowLinebacker(s, getPlayer(s, 'd-lb2')));
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
  const lineY = getPlayer(s, 'o-c').pos.y;
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-cb1')), { aim: null, cover: 'o-wr1' });
  assert.deepEqual(coverBack(s, getPlayer(s, 'd-s')),
    { aim: { x: 135, y: lineY + AI_DEEP_CUSHION_UNITS }, cover: null });
});

test('a loose ball is a footrace — nobody keeps an assignment', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  s.ball = { carrierId: null, pos: { x: 135, y: 100 }, vel: { x: 0, y: 0 }, loose: 0 };
  for (const id of ['d-nt', 'd-lb', 'd-cb1', 'd-s']) {
    assert.deepEqual(smartOrder(s, getPlayer(s, id)),
      { aim: { x: 135, y: 100 }, cover: null }, id);
  }
});

test('once the carrier is past the line everybody converges on him', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  afterSnap(s);
  const qb = getPlayer(s, 'o-qb');
  qb.pos = { x: 135, y: losY(s) + 10 }; // 10 units past the line
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-dt2')),
    { aim: { x: 135, y: qb.pos.y }, cover: null }, 'no contain: he is inside attack range');
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-cb1')),
    { aim: { x: 135, y: qb.pos.y + AI_LEVERAGE_CUSHION }, cover: null }, 'the corner leaves his man to make the tackle');
});

test('behind the line, each position does its own job', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  // Neutralise the RB as a threat — see the comment above 'the deep man plays
  // behind the deepest threat...' — so the backer has nobody to help with and
  // plays his own position, which is what this test is about.
  getPlayer(s, 'o-rb').radius = RADIUS_LINE;
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-dt2')), rushLineman(s, getPlayer(s, 'd-dt2')));
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-lb')), flowLinebacker(s, getPlayer(s, 'd-lb')));
  assert.deepEqual(smartOrder(s, getPlayer(s, 'd-cb1')), coverBack(s, getPlayer(s, 'd-cb1')));
});

test('smartOrders covers the whole team and writes nothing into the state', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  const orders = smartOrders(s, 'defense');
  assert.deepEqual(orders.map((o) => o.id),
    ['d-nt', 'd-dt1', 'd-dt2', 'd-cb1', 'd-cb2', 'd-lb', 'd-s']);
  assert.equal(orders.find((o) => o.id === 'd-cb1').cover, 'o-wr1');
  assert.ok(s.players.every((p) => p.plan === null && p.cover === null),
    'pure: nothing was written');
});
