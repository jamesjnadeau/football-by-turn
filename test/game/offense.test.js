import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoplanOffense, playSide, playSideEdgeX, readDefender, daylightDirection,
} from '../../lib/game/offense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { sub, len, norm, dist } from '../../lib/game/vec.js';
import { BLOCK_ENGAGE_UNITS } from '../../lib/game/constants.js';

test('playSide follows the tight end, or defaults right without one', () => {
  const seven = createGame({ ai: 'defense' }).players.filter((p) => p.team === 'offense');
  assert.equal(playSide(seven), 1, 'no TE on the seven-man roster: defaults right');

  const eleven = createGame({ ai: 'defense', variant: '11' });
  const offense11 = eleven.players.filter((p) => p.team === 'offense');
  assert.equal(playSide(offense11), 1, 'the TE lines up to the right by default');

  // pos.x is an absolute SVG coordinate (the field spans 35 to 235), never
  // one centred at zero -- playSide compares against the field's own centre
  // (fieldPos(0, 0).x) rather than zero, so a repositioned TE reads correctly
  // even though his pos.x by itself is always positive.
  const centerX = fieldPos(0, 0).x;
  assert.equal(playSide([{ role: 'TE', pos: { x: centerX - 20 } }]), -1, 'TE left of centre');
  assert.equal(playSide([{ role: 'TE', pos: { x: centerX + 20 } }]), 1, 'TE right of centre');
});

test('playSideEdgeX picks the widest lineman on the play side, falling back off it', () => {
  const line = [{ pos: { x: -5 } }, { pos: { x: -2 } }, { pos: { x: 2 } }, { pos: { x: 5 } }];
  assert.equal(playSideEdgeX(1, line), 5);
  assert.equal(playSideEdgeX(-1, line), -5);
  // Nobody lines up on the requested side at all: falls back to the whole line.
  const oneSided = [{ pos: { x: 3 } }, { pos: { x: 8 } }];
  assert.equal(playSideEdgeX(-1, oneSided), 3);
});

test('readDefender is the widest defensive lineman on the play side, or null with no front', () => {
  const state = {
    players: [
      { team: 'defense', role: 'DT', pos: { x: -5 } },
      { team: 'defense', role: 'NT', pos: { x: 0 } },
      { team: 'defense', role: 'DE', pos: { x: 6 } },
      { team: 'defense', role: 'LB', pos: { x: 10 } }, // not a lineman -- ignored
    ],
  };
  assert.equal(readDefender(state, 1).role, 'DE');
  assert.equal(readDefender(state, -1).role, 'DT');
  assert.equal(readDefender({ players: [] }, 1), null);
});

test('the option read calls a keep when the edge defender sits even with the box', () => {
  const s = createGame({ ai: 'defense' }); // 7-man roster, no TE: the play runs right
  // Default alignment: d-dt2 stands even with o-rg, the widest lineman on the
  // play side -- well inside OPTION_READ_UNITS, so this reads as a crash.
  autoplanOffense(s);
  assert.equal(s.plannedPass.target, 'o-qb', 'the untouched automatic snap: the keep');
});

test('the option read calls a give once the edge defender widens past the box', () => {
  const s = createGame({ ai: 'defense' });
  getPlayer(s, 'd-dt2').pos = fieldPos(6, s.losYard + 1); // well outside the tackle box
  autoplanOffense(s);
  assert.equal(s.plannedPass.target, 'o-rb', 'a direct snap to the RB: the give');
});

test('the o-line commits to a cut block with a plan, but only on turn 0', () => {
  const s = createGame({ ai: 'defense' });
  autoplanOffense(s);
  for (const id of ['o-c', 'o-lg', 'o-rg']) {
    const p = getPlayer(s, id);
    assert.equal(p.mode, 'cutBlock');
    assert.ok(p.plan);
  }

  const s2 = createGame({ ai: 'defense' });
  s2.turnIndex = 1;
  s2.ball = { carrierId: 'o-rb', pos: null, vel: null };
  s2.plannedPass = null;
  autoplanOffense(s2);
  for (const id of ['o-c', 'o-lg', 'o-rg']) {
    assert.notEqual(getPlayer(s2, id).mode, 'cutBlock');
  }
});

test('autoplanOffense declines, and changes nothing, when the computer coaches the offense', () => {
  const s = createGame({ ai: 'offense' });
  const before = JSON.stringify(s);
  assert.equal(autoplanOffense(s), null);
  assert.equal(JSON.stringify(s), before);
});

test('autoplanOffense declines, and changes nothing, outside the planning phase', () => {
  const s = createGame({ ai: 'defense' });
  s.phase = 'playOver';
  const before = JSON.stringify(s);
  assert.equal(autoplanOffense(s), null);
  assert.equal(JSON.stringify(s), before);
});

/**
 * The same greedy nearest-pair pass offense.js's own (module-private)
 * assignBlocks runs -- reproduced here, rather than imported, because the
 * spec keeps it internal. Used only to work out which defender each blocker
 * is EXPECTED to end up pointed at, so the test can check the real output
 * against it without guessing from directions alone (several defenders in
 * this formation share an x, so two different blockers can perfectly well
 * both aim a {0,1} arrow at two different men).
 */
function expectedBlocks(blockers, defenders) {
  const pairs = [];
  for (const b of blockers) for (const d of defenders) pairs.push({ b: b.id, d: d.id, gap: dist(b.pos, d.pos) });
  pairs.sort((a, b) => a.gap - b.gap || a.b.localeCompare(b.b) || a.d.localeCompare(b.d));
  const map = new Map();
  const claimed = new Set();
  for (const { b, d } of pairs) {
    if (map.has(b) || claimed.has(d)) continue;
    map.set(b, d);
    claimed.add(d);
  }
  return map;
}

test('turn 1+: the carrier finds daylight and every other player blocks a distinct defender', () => {
  const s = createGame({ ai: 'defense' });
  s.turnIndex = 1;
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  s.plannedPass = null;
  const note = autoplanOffense(s);
  assert.equal(note, 'RB finds the alley -- everybody else blocks.');

  const rb = getPlayer(s, 'o-rb');
  assert.deepEqual(rb.plan, { ...rb.plan, dir: daylightDirection(s, rb), throttle: 1 });

  const blockers = s.players.filter((p) => p.team === 'offense' && p.id !== 'o-rb');
  const defenders = s.players.filter((p) => p.team === 'defense');
  const map = expectedBlocks(blockers, defenders);
  // Seven defenders for six blockers: nobody is left without a man to pick up,
  // and the map's own values are already a set -- no defender is claimed twice.
  assert.equal(map.size, blockers.length);

  for (const b of blockers) {
    const target = getPlayer(s, map.get(b.id));
    assert.ok(b.plan, `${b.id} has a plan`);
    assert.deepEqual(b.plan.dir, norm(sub(target.pos, b.pos)), `${b.id} runs at ${target.id}`);
    if (len(sub(target.pos, b.pos)) <= b.radius + target.radius + BLOCK_ENGAGE_UNITS) {
      assert.equal(b.mode, 'holding', `${b.id} is close enough to commit to holding`);
    } else {
      assert.equal(b.mode, 'normal', `${b.id} is still closing the gap`);
    }
  }
});

test('daylightDirection cuts away from a defender planted in the straight lane', () => {
  const carrier = { pos: { x: 0, y: 0 } };
  const state = { players: [{ team: 'defense', pos: { x: 0, y: 15 } }] };
  assert.notDeepEqual(daylightDirection(state, carrier), { x: 0, y: 1 });
});

test('daylightDirection runs straight upfield against a symmetric defense', () => {
  const carrier = { pos: { x: 0, y: 0 } };
  const state = {
    players: [
      { team: 'defense', pos: { x: -15, y: 15 } },
      { team: 'defense', pos: { x: 15, y: 15 } },
    ],
  };
  assert.deepEqual(daylightDirection(state, carrier), { x: 0, y: 1 });
});

test('a loose ball sends every offense player after it', () => {
  const s = createGame({ ai: 'defense' });
  s.turnIndex = 1;
  s.ball = { carrierId: null, pos: { x: 135, y: 400 }, vel: { x: 0, y: 0 } };
  s.plannedPass = null;
  const note = autoplanOffense(s);
  assert.equal(note, 'Scrambling for the ball.');
  for (const p of s.players.filter((pl) => pl.team === 'offense')) {
    assert.deepEqual(p.plan.dir, norm(sub(s.ball.pos, p.pos)), p.id);
    assert.equal(p.plan.throttle, 1);
  }
});
