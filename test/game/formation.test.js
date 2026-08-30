import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spotFault, onTheLine, lineCount, formationFoul, alignDefense, canReposition, placePlayer,
  placeFormation,
} from '../../lib/game/formation.js';
import { MIN_ON_LINE, TEAM_SIZE } from '../../lib/game/constants.js';
import { createGame, getPlayer, setPlan, setPass } from '../../lib/game/state.js';
import { hashCentresX } from '../../lib/field/geometry.js';
import { setCover } from '../../lib/game/cover.js';
import { fieldPos, yardsOfY } from '../../lib/game/view.js';

test('a spot behind the line, inbounds and clear of everyone, has no fault', () => {
  const s = createGame({ seed: 1 });
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-20, -3)), null);
});

test('the offense may not line up past the line, and the defense may not line up behind it', () => {
  const s = createGame({ seed: 1 });
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-20, 2)), 'past-line');
  assert.equal(spotFault(s, 'd-cb1', fieldPos(-20, -2)), 'past-line');
});

test('a spot with any part of the body outside a sideline is out of bounds', () => {
  const s = createGame({ seed: 1 });
  // The field is 160/3 yards wide, so the sidelines are ±26.67 from centre.
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-30, -3)), 'out-of-bounds');
  assert.equal(spotFault(s, 'o-wr1', fieldPos(30, -3)), 'out-of-bounds');
  // A skill player's radius is 2.5 units, so his edge crosses before his centre.
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-26.4, -3)), 'out-of-bounds');
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-25, -3)), null);
});

test('a spot whose body overlaps another player is occupied — but his own is not', () => {
  const s = createGame({ seed: 1 });
  assert.equal(spotFault(s, 'o-rb', getPlayer(s, 'o-qb').pos), 'occupied');
  assert.equal(spotFault(s, 'o-qb', getPlayer(s, 'o-qb').pos), null);
});

test('a man inside the line zone is on it; anyone deeper is a back', () => {
  const s = createGame({ seed: 1 });
  assert.equal(onTheLine(s, getPlayer(s, 'o-c')), true);
  assert.equal(onTheLine(s, getPlayer(s, 'o-wr1')), true);
  assert.equal(onTheLine(s, getPlayer(s, 'o-qb')), false);
  assert.equal(onTheLine(s, getPlayer(s, 'o-rb')), false);
});

test('the default formation comes to the line legally: five on it, two backs', () => {
  const s = createGame({ seed: 1 });
  assert.equal(lineCount(s, 'offense'), MIN_ON_LINE);
  assert.equal(formationFoul(s), null);
});

test('pulling a fifth man off the line is an illegal formation', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-wr1').pos = fieldPos(-20, -6);
  assert.equal(lineCount(s, 'offense'), MIN_ON_LINE - 1);
  assert.equal(formationFoul(s), 'illegal-formation');
});

test('only the offense is judged on its formation — the defense lines up as it likes', () => {
  const s = createGame({ seed: 1 });
  for (const p of s.players) if (p.team === 'defense') p.pos = fieldPos(0, 12);
  assert.equal(formationFoul(s), null);
});

test('alignment answers the default formation with a spot for every defender', () => {
  const s = createGame({ seed: 1 });
  const spots = alignDefense(s);
  assert.equal(spots.length, TEAM_SIZE);
  const ids = spots.map((sp) => sp.id).sort();
  assert.deepEqual(ids, s.players.filter((p) => p.team === 'defense').map((p) => p.id).sort());
});

test('the front lines up head-up on the interior of the offensive line', () => {
  const s = createGame({ seed: 1 });
  const spots = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  // The three linemen take the three offensive men nearest the ball across
  // the field — the centre and both guards, not the split receivers.
  const front = ['d-nt', 'd-dt1', 'd-dt2'].map((id) => spots.get(id).x).sort((a, b) => a - b);
  const oline = ['o-lg', 'o-c', 'o-rg'].map((id) => getPlayer(s, id).pos.x).sort((a, b) => a - b);
  assert.deepEqual(front, oline);
});

test('a receiver split to the other side of the formation drags his corner with him', () => {
  const s = createGame({ seed: 1 });
  const before = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  getPlayer(s, 'o-wr1').pos = fieldPos(22, -1); // both receivers now to the right
  const after = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  // The corner who had him follows him all the way across; the other stays on
  // the man he already had, which is the point of covering people rather than
  // covering grass.
  assert.ok(after.get('d-cb1').x > before.get('d-cb1').x, 'the corner crossed with him');
  const corners = ['d-cb1', 'd-cb2'].map((id) => after.get(id).x).sort((a, b) => a - b);
  const wrs = ['o-wr1', 'o-wr2'].map((id) => getPlayer(s, id).pos.x).sort((a, b) => a - b);
  assert.deepEqual(corners, wrs);
});

test('aligning against the drive-start offense reproduces the drive-start defense', () => {
  const s = createGame({ seed: 1 });
  for (const { id, pos } of alignDefense(s)) {
    assert.deepEqual(pos, getPlayer(s, id).pos, `${id} was already where he belongs`);
  }
});

test('the last man back aligns deepest of all, over the middle of the formation', () => {
  const s = createGame({ seed: 1 });
  const spots = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  const deep = spots.get('d-s');
  for (const [id, pos] of spots) {
    if (id !== 'd-s') assert.ok(deep.y > pos.y, `the safety is deeper than ${id}`);
  }
});

test('alignment never produces a spot the rulebook would refuse', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-wr1').pos = fieldPos(-26, -1); // pinned to the sideline
  getPlayer(s, 'o-wr2').pos = fieldPos(-24, -1); // and stacked beside him
  for (const { id, pos } of alignDefense(s)) getPlayer(s, id).pos = pos;
  for (const p of s.players) {
    if (p.team !== 'defense') continue;
    assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} at a legal spot`);
  }
});

test('alignment is pure: asking where the defense should stand does not move it', () => {
  const s = createGame({ seed: 1 });
  const before = s.players.map((p) => ({ ...p.pos }));
  alignDefense(s);
  assert.deepEqual(s.players.map((p) => ({ ...p.pos })), before);
});

test('repositioning is offered on the first turn of a down and nowhere else', () => {
  const s = createGame({ seed: 1 });
  assert.equal(canReposition(s), true);
  s.turnIndex = 1;
  assert.equal(canReposition(s), false);
  s.turnIndex = 0;
  s.phase = 'playOver';
  assert.equal(canReposition(s), false);
});

test('repositioning: allowed only at turn 0 planning, and only on your own side of the LOS', () => {
  const s = createGame({ seed: 1 });
  const ok = placePlayer(s, 'o-wr1', fieldPos(-20, -2));
  assert.equal(ok, true);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, fieldPos(-20, -2));
  // offense may not set up past the LOS
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-20, 2)), false);
  // defense may not set up behind it
  assert.equal(placePlayer(s, 'd-cb1', fieldPos(-20, -2)), false);
  // once the play has run a turn, nobody repositions
  s.turnIndex = 1;
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-15, -2)), false);
});

test('repositioning refuses a spot the formation rulebook faults', () => {
  const s = createGame({ seed: 1 });
  // Out of bounds and on top of a team-mate are both refusals now, not just
  // the wrong side of the line.
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-30, -3)), false);
  assert.equal(placePlayer(s, 'o-rb', getPlayer(s, 'o-qb').pos), false);
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-20, -3)), true);
});

test('moving a player drops the orders he was given from his old spot', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1, fieldPos(-15, 3), false);
  setCover(s, 'o-rb', 'd-lb');
  assert.ok(placePlayer(s, 'o-wr1', fieldPos(-20, -3)));
  assert.equal(getPlayer(s, 'o-wr1').plan, null, 'the stale destination is gone');
  assert.ok(placePlayer(s, 'o-rb', fieldPos(5, -7)));
  assert.equal(getPlayer(s, 'o-rb').cover, null, 'and so is the stale cover order');
  // Nobody else is disturbed by one man moving.
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  assert.ok(placePlayer(s, 'o-wr2', fieldPos(20, -3)));
  assert.notEqual(getPlayer(s, 'o-qb').plan, null);
});

test('on the line means within two yards of the line of scrimmage, and not a step more', () => {
  const s = createGame({ seed: 1 });
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = fieldPos(-15, s.losYard - 2);
  assert.equal(onTheLine(s, wr), true, 'two yards off the ball is on the line');
  wr.pos = fieldPos(-15, s.losYard - 2.2);
  assert.equal(onTheLine(s, wr), false, 'a step deeper than two yards is not');
  wr.pos = fieldPos(-15, s.losYard - 0.25);
  assert.equal(onTheLine(s, wr), true, 'right up on the ball is on the line');
});

test('the drive-start line stands clear of the zone edges, so a nudge cannot knock a man off it', () => {
  const s = createGame({ seed: 1 });
  // The formation stands a yard off the ball inside a two-yard zone, so there
  // is room on BOTH sides of where the players actually are. Nudge a man a
  // half-yard either way and he is still lining up with his team-mates.
  const line = yardsOfY(getPlayer(s, 'o-c').pos.y);
  for (const nudge of [-0.5, 0.5]) {
    getPlayer(s, 'o-wr1').pos = fieldPos(-15, line + nudge);
    assert.equal(onTheLine(s, getPlayer(s, 'o-wr1')), true, `nudged ${nudge} yd`);
    assert.equal(formationFoul(s), null, `still legal at ${nudge} yd`);
  }
});

test('the man with the ball must line up between the hash marks', () => {
  const s = createGame({ seed: 1 });
  const [hashLeft, hashRight] = hashCentresX();
  const backfield = fieldPos(0, -1).y;
  const at = (x) => ({ x, y: backfield });

  // The centre starts every down holding it, so the rule falls on him.
  assert.equal(s.ball.carrierId, 'o-c');
  assert.equal(spotFault(s, 'o-c', at(hashLeft + 1)), null, 'just inside the left hash');
  assert.equal(spotFault(s, 'o-c', at(hashRight - 1)), null, 'just inside the right hash');
  assert.equal(spotFault(s, 'o-c', at(hashLeft - 1)), 'outside-hashes');
  assert.equal(spotFault(s, 'o-c', at(hashRight + 1)), 'outside-hashes');

  // It is a rule about the BALL, so it follows the ball rather than the role:
  // nobody else is held to it, and the centre is not held to it once he has
  // given the ball up.
  assert.equal(spotFault(s, 'o-wr1', at(hashLeft - 20)), null, 'a receiver splits out freely');
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  assert.equal(spotFault(s, 'o-c', at(hashLeft - 1)), null, 'no longer his to spot');
});

test('the hash rule is judged on the ball, not on the whole body', () => {
  // Out-of-bounds takes the player's radius off each edge because a body
  // cannot be over the sideline. This one does not: the ball rides at his
  // middle, so a centre whose shoulder overhangs a hash is still legal.
  const s = createGame({ seed: 1 });
  const [hashLeft] = hashCentresX();
  const c = getPlayer(s, 'o-c');
  const spot = { x: hashLeft + c.radius / 2, y: fieldPos(0, -1).y };
  assert.ok(spot.x - c.radius < hashLeft, 'his body really does overhang the hash');
  assert.equal(spotFault(s, 'o-c', spot), null);
});

test('moving either man re-aims the snap between them', () => {
  const s = createGame({ seed: 1 });
  assert.deepEqual(s.plannedPass.dir, { x: 0, y: -1 }, 'straight back to begin with');

  // Move the quarterback out to one side and the throw follows him...
  assert.equal(placePlayer(s, 'o-qb', fieldPos(-6, -4)), true);
  assert.ok(s.plannedPass.dir.x < 0, 'the snap leans his way');
  assert.ok(s.plannedPass.dir.y < 0, 'and is still a lateral');
  assert.equal(s.plannedPass.auto, true);

  // ...and so does moving the centre, which is the other half of the aim.
  // Straight back rather than sideways: his guards stand two and a half yards
  // off him and the two bodies are seven units wide between them, so there is
  // barely a yard of lateral room before spotFault calls it occupied.
  const before = { ...s.plannedPass.dir };
  assert.equal(placePlayer(s, 'o-c', fieldPos(0, -2)), true);
  assert.notDeepEqual(s.plannedPass.dir, before, 're-aimed from his new spot');
});

test('a move never overwrites a throw the coach called himself', () => {
  const s = createGame({ seed: 1 });
  setPass(s, 'o-c', { x: 1, y: -1 }, 0.7);
  const his = { ...s.plannedPass };
  assert.equal(placePlayer(s, 'o-qb', fieldPos(6, -4)), true);
  assert.deepEqual(s.plannedPass, his, 'his call survives the shuffle');
});

test('a whole formation is seated in one call', () => {
  const s = createGame({ seed: 1 });
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-wr1', pos: fieldPos(-22, -1) },
    { id: 'o-wr2', pos: fieldPos(22, -1) },
  ]);
  assert.deepEqual(applied.sort(), ['o-wr1', 'o-wr2']);
  assert.deepEqual(skipped, []);
  assert.equal(Math.round(yardsOfY(getPlayer(s, 'o-wr1').pos.y)), -1);
});

test('two men may swap spots, which one-at-a-time placement cannot do', () => {
  const s = createGame({ seed: 1 });
  const rb = { ...getPlayer(s, 'o-rb').pos };
  const qb = { ...getPlayer(s, 'o-qb').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-rb', pos: qb },
    { id: 'o-qb', pos: rb },
  ]);
  assert.deepEqual(applied.sort(), ['o-qb', 'o-rb']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(getPlayer(s, 'o-rb').pos, qb);
  assert.deepEqual(getPlayer(s, 'o-qb').pos, rb);
});

test('an impossible spot is skipped and the rest of the formation still seats', () => {
  const s = createGame({ seed: 1 });
  const where = { ...getPlayer(s, 'o-wr2').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-wr1', pos: fieldPos(-22, -1) },   // fine
    { id: 'o-wr2', pos: fieldPos(0, 5) },      // past the line
    { id: 'nobody', pos: fieldPos(0, -3) },    // no such player
  ]);
  assert.deepEqual(applied, ['o-wr1']);
  assert.deepEqual(skipped.sort(), ['nobody', 'o-wr2']);
  assert.deepEqual(getPlayer(s, 'o-wr2').pos, where);
});

test('a man who could not be moved is still in the way of the men who follow', () => {
  const s = createGame({ seed: 1 });
  const rb = { ...getPlayer(s, 'o-rb').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-rb', pos: fieldPos(0, 5) },  // refused: past the line, so he stays put
    { id: 'o-wr1', pos: rb },             // and his old spot is therefore occupied
  ]);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped.sort(), ['o-rb', 'o-wr1']);
});

test('seating a formation drops the orders the old spots were drawn from', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-wr1', { x: 1, y: 0 }, 1);
  placeFormation(s, [{ id: 'o-wr1', pos: fieldPos(-22, -1) }]);
  assert.equal(getPlayer(s, 'o-wr1').plan, null);
});

test('nobody is seated once the ball is in the air', () => {
  const s = createGame({ seed: 1 });
  s.turnIndex = 1;
  const where = { ...getPlayer(s, 'o-wr1').pos };
  const { applied, skipped } = placeFormation(s, [{ id: 'o-wr1', pos: fieldPos(-22, -1) }]);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped, ['o-wr1']);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, where);
});
