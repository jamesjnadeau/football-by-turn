import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  spotFault, onTheLine, lineCount, formationFoul, alignDefense, canReposition, placePlayer,
  placeFormation, setPersonnel, defenseKeys, learnedPersonnel, learnedLook,
  answerOffense, applyLearnedLook,
} from '../../lib/game/formation.js';
import { minOnLine, teamSize, personnelId } from '../../lib/game/rosters.js';
import { createGame, getPlayer, setPlan, setPass } from '../../lib/game/state.js';
import { hashCentresX } from '../../lib/field/geometry.js';
import { setCover } from '../../lib/game/cover.js';
import { fieldPos, yardsOfY } from '../../lib/game/view.js';
import { makeGenome, mutateGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { learnedDefenseSpots } from '../../lib/game/learned/formation.js';
import { DEFENSE_GENOME } from '../../lib/game/learned/defense-genome.js';
import { mulberry32 } from '../../lib/game/rng.js';

test('a spot behind the line, inbounds and clear of everyone, has no fault', () => {
  const s = createGame({ seed: 1 });
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-20, -3)), null);
});

test('the offense may not line up past the line, and the defense may not line up behind it', () => {
  const s = createGame({ seed: 1 });
  assert.equal(spotFault(s, 'o-wr1', fieldPos(-20, s.losYard + 2)), 'past-line');
  assert.equal(spotFault(s, 'd-cb1', fieldPos(-20, s.losYard - 2)), 'past-line');
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
  assert.equal(lineCount(s, 'offense'), minOnLine(s));
  assert.equal(formationFoul(s), null);
});

test('pulling a fifth man off the line is an illegal formation', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-wr1').pos = fieldPos(-20, -6);
  assert.equal(lineCount(s, 'offense'), minOnLine(s) - 1);
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
  assert.equal(spots.length, teamSize(s));
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
  const ok = placePlayer(s, 'o-wr1', fieldPos(-20, s.losYard - 2));
  assert.equal(ok, true);
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, fieldPos(-20, s.losYard - 2));
  // offense may not set up past the LOS
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-20, s.losYard + 2)), false);
  // defense may not set up behind it
  assert.equal(placePlayer(s, 'd-cb1', fieldPos(-20, s.losYard - 2)), false);
  // once the play has run a turn, nobody repositions
  s.turnIndex = 1;
  assert.equal(placePlayer(s, 'o-wr1', fieldPos(-15, s.losYard - 2)), false);
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
    { id: 'o-wr1', pos: fieldPos(-22, s.losYard - 1) },   // fine
    { id: 'o-wr2', pos: fieldPos(0, s.losYard + 5) },     // past the line
    { id: 'nobody', pos: fieldPos(0, s.losYard - 3) },    // no such player
  ]);
  assert.deepEqual(applied, ['o-wr1']);
  assert.deepEqual(skipped.sort(), ['nobody', 'o-wr2']);
  assert.deepEqual(getPlayer(s, 'o-wr2').pos, where);
});

test('a man who could not be moved is still in the way of the men who follow', () => {
  const s = createGame({ seed: 1 });
  const rb = { ...getPlayer(s, 'o-rb').pos };
  const { applied, skipped } = placeFormation(s, [
    { id: 'o-rb', pos: fieldPos(0, s.losYard + 5) },  // refused: past the line, so he stays put
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

test('setPersonnel swaps the defense without disturbing the offense', () => {
  const s = createGame({ seed: 1, variant: '7' });
  const movedWr1 = fieldPos(-20, -3);
  assert.ok(placePlayer(s, 'o-wr1', movedWr1));

  assert.ok(setPersonnel(s, 'nickel'));
  assert.equal(s.variantId, '7-nickel');
  assert.deepEqual(getPlayer(s, 'o-wr1').pos, movedWr1,
    'the offense stayed exactly where the coach put it');

  const ids = s.players.filter((p) => p.team === 'defense').map((p) => p.id).sort();
  assert.deepEqual(ids, ['d-cb1', 'd-cb2', 'd-dt1', 'd-lb', 'd-lb2', 'd-nt', 'd-s']);
  assert.equal(s.players.length, 14, 'still seven a side, both teams');
});

test('setPersonnel is refused once the play is under way', () => {
  const s = createGame({ seed: 1, variant: '7' });
  s.turnIndex = 1;
  const before = s.players.map((p) => p.id);
  assert.equal(setPersonnel(s, 'nickel'), false);
  assert.equal(s.variantId, '7');
  assert.deepEqual(s.players.map((p) => p.id), before);
});

test('setPersonnel cycles through stacked, nickel and dime and back', () => {
  const s = createGame({ seed: 1, variant: '11' });
  assert.ok(setPersonnel(s, 'nickel'));
  assert.equal(s.variantId, '11-nickel');
  assert.ok(setPersonnel(s, 'dime'));
  assert.equal(s.variantId, '11-dime');
  assert.ok(setPersonnel(s, 'stacked'));
  assert.equal(s.variantId, '11');
});

test('an unrecognised personnel package falls back to stacked rather than stranding the game', () => {
  const s = createGame({ seed: 1, variant: '7' });
  assert.ok(setPersonnel(s, 'wishbone'));
  assert.equal(s.variantId, '7');
});

test('defenseKeys pairs the front with the interior and the corners with the widest', () => {
  const s = createGame({ seed: 1 });
  const { keys, middle } = defenseKeys(s);
  // The nose is the first man of the front, so he answers the offensive
  // lineman standing closest to the ball — the centre.
  assert.equal(keys.get('d-nt').group, 'line');
  assert.equal(keys.get('d-nt').mate.id, 'o-c');
  // The corners are backs, and they take the widest men left uncovered.
  assert.equal(keys.get('d-cb1').group, 'back');
  assert.ok(keys.get('d-cb1').mate.id.startsWith('o-'));
  // The safety is the deepest back, so he is the free man and answers nobody
  // in particular — he answers the middle.
  assert.equal(keys.get('d-s').group, 'deep');
  assert.equal(keys.get('d-s').mate, null);
  assert.equal(keys.get('d-lb').group, 'backer');
  // Every defender is keyed, nobody twice.
  assert.equal(keys.size, s.players.filter((p) => p.team === 'defense').length);
  assert.equal(typeof middle, 'number');
});

test('a receiver split wide becomes the man his corner is keyed to', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const { keys } = defenseKeys(s);
  const keyed = [...keys.values()].filter((k) => k.group === 'back')
    .map((k) => k.mate?.id);
  assert.ok(keyed.includes('o-wr1'), `expected a corner keyed to o-wr1, got ${keyed}`);
});

test('an untrained genome never subs, whatever the offense shows', () => {
  const g = makeGenome(DEFENSE_SPEC);
  const s = createGame({ seed: 1 });
  assert.equal(learnedPersonnel(s, g), 'stacked');
  // Empty the backfield and split it wide: still stacked, because both cuts
  // sit at the floor. This pair of assertions IS the compatibility guarantee.
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  assert.equal(learnedPersonnel(s, g), 'stacked');
  s.down = 3;
  s.toGoYard = s.losYard + 10;
  assert.equal(learnedPersonnel(s, g), 'stacked');
});

test('a genome that hates spread subs to nickel, then to dime', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  const base = { ...makeGenome(DEFENSE_SPEC), 'sub:spread': 4 };
  // Spread is near 1 with the receivers on the numbers, so the axis reads
  // about 4 (0.9 for this roster) -- comfortably clear of a cut at -3, and
  // clear of the floor at -4 too, which is why base's own untouched bias
  // (init -4 for both cuts) still reads stacked: raising ONE cut to -3 is
  // what crosses it, not lowering it further.
  assert.equal(learnedPersonnel(s, base), 'stacked');
  assert.equal(learnedPersonnel(s, { ...base, 'sub:nickel:bias': -3 }), 'nickel');
  assert.equal(learnedPersonnel(s, { ...base, 'sub:nickel:bias': -3, 'sub:dime:bias': -3 }), 'dime');
});

test('the empty backfield is a tell of its own, separate from width', () => {
  // Width cannot see this: both looks below are the same number of yards
  // across, and only the count of men off the ball changes.
  const s = createGame({ seed: 1 });
  const backs = (st) => {
    const them = st.players.filter((p) => p.team === 'offense');
    return them.filter((p) => !onTheLine(st, p)).length / them.length;
  };
  const packed = backs(s);
  // Pull a receiver off the line without moving him sideways: the fraction
  // rises, the width does not budge.
  const wr = getPlayer(s, 'o-wr1');
  placePlayer(s, 'o-wr1', { x: wr.pos.x, y: fieldPos(0, s.losYard - 5).y });
  const emptied = backs(s);
  assert.ok(emptied > packed, 'the look did not actually empty out');
  // A cut placed between the two fractions is crossed by one and not the other.
  const cut = -4 * (packed + emptied) / 2;
  const g = { ...makeGenome(DEFENSE_SPEC), 'sub:backs': 4, 'sub:nickel:bias': cut };
  assert.equal(learnedPersonnel(s, g), 'nickel');
  const s2 = createGame({ seed: 1 });
  assert.equal(learnedPersonnel(s2, g), 'stacked');
});

test('a genome that learned a looser dime cut never plays nickel', () => {
  // Not a hypothetical: the shipped genome is ordered this way. The cuts are
  // independent numbers and dime is tested first, so a dime cut below the
  // nickel one collapses the ladder to two packages. Pinned here so the
  // behaviour is a decision on the record rather than a surprise.
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  placePlayer(s, 'o-wr2', fieldPos(24, s.losYard - 1));
  const g = {
    ...makeGenome(DEFENSE_SPEC),
    'sub:spread': 4, 'sub:nickel:bias': -3.5, 'sub:dime:bias': -2,
  };
  assert.equal(learnedPersonnel(s, g), 'dime');
});

test('at zero pull the learned look is the genome look, exactly', () => {
  // The other half of the compatibility guarantee: with no adapt weights, the
  // new path and the old one must not differ by so much as a rounding error.
  const s = createGame({ seed: 1 });
  const g = makeGenome(DEFENSE_SPEC);
  assert.deepEqual(learnedLook(s, g), learnedDefenseSpots(s, g));
});

test('at zero pull a trained genome is still the genome look, exactly', () => {
  // The shipped genome carries real adapt weights now, so this has to SET the
  // pull to zero rather than assume it. What is being guarded is that a
  // trained genome's own spots still round-trip untouched when nothing pulls
  // on them — not that the shipped genome happens to pull on nothing.
  const s = createGame({ seed: 1 });
  const g = { ...DEFENSE_GENOME.values };
  for (const group of ['line', 'backer', 'back', 'deep']) {
    g[`adapt:${group}:width`] = 0;
    g[`adapt:${group}:depth`] = 0;
  }
  assert.deepEqual(learnedLook(s, g), learnedDefenseSpots(s, g));
});

test('the shipped genome answers a receiver split wide', () => {
  // The guard that training actually bought something: with the genome the
  // game ships, moving a receiver has to move somebody. If a future retrain
  // returns every adapt weight to zero, this is what says so out loud.
  const s = createGame({ seed: 1 });
  const before = new Map(learnedLook(s, DEFENSE_GENOME.values).map((sp) => [sp.id, sp.pos]));
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const after = new Map(learnedLook(s, DEFENSE_GENOME.values).map((sp) => [sp.id, sp.pos]));
  const moved = [...before.keys()].filter(
    (id) => Math.hypot(after.get(id).x - before.get(id).x, after.get(id).y - before.get(id).y) > 0.5,
  );
  assert.ok(moved.length > 0, 'nobody on defense moved when the receiver did');
});

test('a full-width pull stands the front and the corners where alignDefense does', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 1));
  const g = { ...makeGenome(DEFENSE_SPEC) };
  for (const group of ['line', 'backer', 'back', 'deep']) {
    g[`adapt:${group}:width`] = 1;
    g[`adapt:${group}:depth`] = 1;
  }
  const learned = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const ruled = new Map(alignDefense(s).map((sp) => [sp.id, sp.pos]));
  // Within a nudge: both run the same clearX scan, but from spots that reached
  // it by different arithmetic, so a man can land one nudge unit apart.
  for (const id of ['d-nt', 'd-dt1', 'd-dt2', 'd-s']) {
    const gap = Math.hypot(
      learned.get(id).x - ruled.get(id).x, learned.get(id).y - ruled.get(id).y,
    );
    assert.ok(gap <= 1.5, `${id} stood ${gap.toFixed(2)} from the rule-based spot`);
  }
  // The corners are the OTHER row answerYards's own comment says reads
  // differently on purpose: a back's depth is a cushion off HIS OWN man,
  // not alignDefense's flat ALIGN_CORNER_YARDS, so covering a receiver at his
  // ordinary split-end depth (both WRs ship a yard off the ball) stands the
  // corner a yard deeper than alignDefense ever would — by design, not by
  // rounding, exactly as the flanker test two cases below relies on. Only the
  // across component — which the two algorithms compute identically, straight
  // off the mate's x — is asserted here.
  for (const id of ['d-cb1', 'd-cb2']) {
    assert.ok(Math.abs(learned.get(id).x - ruled.get(id).x) <= 1.5,
      `${id} stood ${Math.abs(learned.get(id).x - ruled.get(id).x).toFixed(2)} across from the rule-based spot`);
  }
});

test('a receiver split wide drags his corner across', () => {
  // The thing this whole feature exists for.
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 };
  const before = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const after = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const travelled = ['d-cb1', 'd-cb2'].some(
    (id) => Math.abs(after.get(id).x - before.get(id).x) > 5,
  );
  assert.ok(travelled, 'no corner moved with the receiver');
});

test('a flanker off the ball drags his corner deeper', () => {
  const s = createGame({ seed: 1 });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1, 'adapt:back:depth': 1 };
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 1));
  const shallow = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  placePlayer(s, 'o-wr1', fieldPos(-22, s.losYard - 6));
  const deep = new Map(learnedLook(s, g).map((sp) => [sp.id, sp.pos]));
  const backedOff = ['d-cb1', 'd-cb2'].some(
    (id) => yardsOfY(deep.get(id).y) > yardsOfY(shallow.get(id).y),
  );
  assert.ok(backedOff, 'no corner gave ground to the flanker');
});

test('half a pull stands a man between the two looks', () => {
  const s = createGame({ seed: 1 });
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  const none = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 0 })
    .map((sp) => [sp.id, sp.pos]));
  const half = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 0.5 })
    .map((sp) => [sp.id, sp.pos]));
  const full = new Map(learnedLook(s, { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 })
    .map((sp) => [sp.id, sp.pos]));
  const between = ['d-cb1', 'd-cb2'].some((id) => {
    const lo = Math.min(none.get(id).x, full.get(id).x);
    const hi = Math.max(none.get(id).x, full.get(id).x);
    return half.get(id).x > lo + 0.5 && half.get(id).x < hi - 0.5;
  });
  assert.ok(between, 'half a pull landed on one end or the other');
});

test('everything a training run can express still lands legal', () => {
  // learned/formation.js keeps this sweep for the base look; the adapted look
  // needs its own, because the blend is a new way to arrive at a spot.
  const rand = mulberry32(11);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1 });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    for (const { id, pos } of learnedLook(s, g)) getPlayer(s, id).pos = pos;
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});

test('answerOffense subs the package and stands the men, for a learned defense only', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = { ...makeGenome(DEFENSE_SPEC), 'sub:spread': 4, 'sub:nickel:bias': -2 };
  // Assert the setup, don't assume it: placePlayer REFUSES a spot a defender is
  // already standing on, and a genome that lines somebody up on the numbers can
  // silently block the receiver this test needs wide. Without these the test
  // fails as a substitution bug when it is really a placement that never happened.
  assert.ok(placePlayer(s, 'o-wr1', fieldPos(-23, s.losYard - 1)), 'o-wr1 could not be split wide');
  assert.ok(placePlayer(s, 'o-wr2', fieldPos(23, s.losYard - 1)), 'o-wr2 could not be split wide');
  assert.equal(answerOffense(s, g), true);
  assert.equal(personnelId(s.variantId), 'nickel');
  assert.ok(s.players.some((p) => p.id === 'd-lb2'), 'the extra backer never came on');
  assert.equal(s.players.filter((p) => p.team === 'defense').length, teamSize(s.variantId));
});

test('answerOffense declines and touches nobody when the computer is not on defense', () => {
  for (const opts of [
    { seed: 1 },
    { seed: 1, ai: 'defense', aiLevel: 'smart' },
    { seed: 1, ai: 'offense', aiLevel: 'learned' },
  ]) {
    const s = createGame(opts);
    const before = s.players.map((p) => ({ id: p.id, ...p.pos }));
    const variant = s.variantId;
    assert.equal(answerOffense(s, makeGenome(DEFENSE_SPEC)), false);
    assert.equal(s.variantId, variant);
    assert.deepEqual(s.players.map((p) => ({ id: p.id, ...p.pos })), before);
  }
});

test('answerOffense declines once the ball is live', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  s.turnIndex = 1;
  assert.equal(answerOffense(s, makeGenome(DEFENSE_SPEC)), false);
});

test('a man answerOffense moves loses the orders he was given standing elsewhere', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = { ...makeGenome(DEFENSE_SPEC), 'adapt:back:width': 1 };
  placePlayer(s, 'o-wr1', fieldPos(-24, s.losYard - 1));
  setPlan(s, 'd-cb1', { x: 0, y: 1 }, 1);
  answerOffense(s, g);
  assert.equal(getPlayer(s, 'd-cb1').plan, null);
  assert.equal(getPlayer(s, 'd-cb1').cover, null);
});

test('every spot answerOffense writes is one the rulebook would allow', () => {
  const rand = mulberry32(13);
  for (let i = 0; i < 20; i++) {
    const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
    const g = mutateGenome(DEFENSE_SPEC, makeGenome(DEFENSE_SPEC), rand, 0.5);
    answerOffense(s, g);
    for (const p of s.players.filter((pl) => pl.team === 'defense')) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} mutation ${i}`);
    }
  }
});

test('applyLearnedLook works hot-seat, which is how the trainer runs', () => {
  const s = createGame({ seed: 1 });
  assert.equal(s.aiTeam, null);
  assert.equal(applyLearnedLook(s, makeGenome(DEFENSE_SPEC)), true);
});

test('answerOffense puts a dragged-away defender back where the look wants him', () => {
  // Not because learnedLook notices or corrects the drag -- it never sees the
  // dragged position. applyLearnedLook's setPersonnel rebuilds every defense
  // player from the roster before learnedLook runs at all, so whatever a
  // stomp did is discarded regardless of what the look computes. What this
  // pins down is that answerOffense is deterministic even from a stomped
  // state: called again, it reproduces the exact spot it gave the first time.
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = makeGenome(DEFENSE_SPEC);
  answerOffense(s, g);
  const spot = { ...getPlayer(s, 'd-s').pos };
  getPlayer(s, 'd-s').pos = { x: spot.x + 30, y: spot.y + 5 };
  assert.equal(answerOffense(s, g), true);
  assert.deepEqual(getPlayer(s, 'd-s').pos, spot);
});

test('answerOffense puts a defender dragged off his learned spot back on it', () => {
  // The bug this guards: realignDefense() used to always fall through to the
  // rule-based alignDefense after any offense change, stomping a learned
  // defense's formation the instant the human dragged a player, called a play
  // or changed personnel. Simulate that stomp by hand, then confirm the
  // learned answer puts him straight back.
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'learned' });
  const g = DEFENSE_GENOME.values;
  answerOffense(s, g);
  const spot = { ...getPlayer(s, 'd-s').pos };
  getPlayer(s, 'd-s').pos = { x: spot.x + 30, y: spot.y + 5 };
  assert.equal(answerOffense(s, g), true);
  assert.deepEqual(getPlayer(s, 'd-s').pos, spot);
});
