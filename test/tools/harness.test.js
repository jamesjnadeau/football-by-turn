import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TURNS_PER_PLAY, scenario, playOnePlay, defenseCoach,
  scriptedOffenseCoach, evaluateDefense, learnedOffenseCoach, evaluateMatch,
  playActionCoach, dealtOffenseCoach,
} from '../../tools/harness.js';
import { mulberry32 } from '../../lib/game/rng.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';
import { spotFault, formationFoul } from '../../lib/game/formation.js';
import { loadGhostLog } from '../../tools/ghost.js';

test('scenario deals a plannable hot-seat down inside the field', () => {
  const rand = mulberry32(11);
  for (let i = 0; i < 10; i++) {
    const s = scenario(rand);
    assert.equal(s.phase, 'planning');
    assert.equal(s.turnIndex, 0);
    assert.equal(s.aiTeam, null);
    assert.ok(s.down >= 1 && s.down <= 4);
    assert.ok(s.losYard >= 15 && s.losYard <= 80);
    assert.ok(s.toGoYard > s.losYard && s.toGoYard <= 100);
    assert.ok(s.plannedPass, 'the snap is aimed');
  }
});

test('playOnePlay runs to a whistle (or the cap) and reports the yardage', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const s = scenario(mulberry32(2));
  const r = playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(3));
  assert.ok(Number.isFinite(r.yards));
  assert.ok(s.turnIndex <= MAX_TURNS_PER_PLAY);
  assert.ok(s.phase === 'playOver' || s.turnIndex === MAX_TURNS_PER_PLAY);
  assert.equal(typeof r.touchdown, 'boolean');
  assert.equal(typeof r.turnover, 'boolean');
  assert.ok(Array.isArray(r.events));
});

test('a play is deterministic for its seeds', () => {
  const genome = makeGenome(DEFENSE_SPEC);
  const run = () => {
    const s = scenario(mulberry32(4));
    return playOnePlay(s, scriptedOffenseCoach, defenseCoach(genome), mulberry32(5));
  };
  assert.deepEqual(run(), run());
});

test('evaluateDefense aggregates deterministically', () => {
  const g = makeGenome(DEFENSE_SPEC);
  const a = evaluateDefense(g, { plays: 3, seed: 5 });
  const b = evaluateDefense(g, { plays: 3, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('evaluateMatch pits two learned genomes deterministically', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const def = makeGenome(DEFENSE_SPEC);
  const a = evaluateMatch(off, def, { plays: 3, seed: 6 });
  const b = evaluateMatch(off, def, { plays: 3, seed: 6 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
});

test('learnedOffenseCoach stands its formation and coaches the play', () => {
  const off = makeGenome(OFFENSE_SPEC);
  const s = scenario(mulberry32(8));
  learnedOffenseCoach(off, mulberry32(9))(s);
  assert.ok(s.playRead.call.offense, 'a call was made at the snap');
});

test('every look scenario deals is one the rulebook would allow', () => {
  // The formations training sees have to be formations the game would let a
  // coach line up in — otherwise the defense is evolving against downs that
  // could never be played.
  const rand = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const s = scenario(rand);
    assert.equal(formationFoul(s), null, `foul on look ${i}`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} on look ${i}`);
    }
  }
});

test('the offense does not stand in the same place every play', () => {
  // The whole reason this exists: a defense cannot learn to answer a look
  // that never changes.
  const rand = mulberry32(5);
  const looks = new Set();
  const spreads = [];
  for (let i = 0; i < 50; i++) {
    const s = scenario(rand);
    const wr = s.players.filter((p) => p.id === 'o-wr1' || p.id === 'o-wr2');
    looks.add(wr.map((p) => `${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}`).join('|'));
    const xs = s.players.filter((p) => p.team === 'offense').map((p) => p.pos.x);
    spreads.push(Math.max(...xs) - Math.min(...xs));
  }
  assert.ok(looks.size > 40, `only ${looks.size} distinct looks in 50 plays`);
  // And the spread genuinely varies, since that is the feature the scheme gate
  // and the substitution both read.
  assert.ok(Math.max(...spreads) - Math.min(...spreads) > 20, 'spread barely moved');
});

test('both receivers land on one side often enough to teach a strength read', () => {
  const rand = mulberry32(7);
  let strong = 0;
  for (let i = 0; i < 200; i++) {
    const s = scenario(rand);
    const [a, b] = ['o-wr1', 'o-wr2'].map((id) => s.players.find((p) => p.id === id));
    const mid = s.players.filter((p) => p.team === 'offense')
      .reduce((sum, p) => sum + p.pos.x, 0) / 7;
    if ((a.pos.x - mid) * (b.pos.x - mid) > 0) strong++;
  }
  assert.ok(strong > 20, `only ${strong} of 200 looks put both receivers one side`);
});

test('the same seed deals the same looks', () => {
  // Common random numbers: two genomes scored at one seed must face identical
  // downs AND identical formations, or their fitnesses are not comparable.
  const one = [];
  const two = [];
  for (const sink of [one, two]) {
    const rand = mulberry32(11);
    for (let i = 0; i < 20; i++) {
      sink.push(scenario(rand).players.map((p) => `${p.id}:${p.pos.x},${p.pos.y}`).join());
    }
  }
  assert.deepEqual(one, two);
});

test('the play-action script sells a run and then throws', () => {
  const s = scenario(mulberry32(7));
  playActionCoach(s);
  // Turn 0: the line drives downfield — run keys, and no throw of its own.
  const line = s.players.filter((p) => p.team === 'offense' && ['C','LG','RG','LT','RT'].includes(p.role));
  assert.ok(line.every((p) => p.plan && p.plan.dir.y > 0), 'the line is driving');
  assert.ok(!s.plannedPass || s.plannedPass.auto, 'nothing thrown at the snap');

  // Turn 2: the throw goes up.
  s.turnIndex = 2;
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  playActionCoach(s);
  assert.ok(s.plannedPass && !s.plannedPass.auto, 'the fake is over and it is a pass');
});

test('the three-way deal is reproducible and uses all three arms', () => {
  const runLog = loadGhostLog('coaching-logs/default-offense.json');
  const passLog = loadGhostLog('coaching-logs/default-offense2.json');
  const arms = (seed) => {
    const coach = dealtOffenseCoach({ runLog, passLog, rand: mulberry32(seed) });
    const seen = [];
    for (let i = 0; i < 30; i++) {
      const s = scenario(mulberry32(100 + i));
      coach(s);
      seen.push(s.dealtArm);
    }
    return seen;
  };
  const first = arms(1);
  assert.deepEqual(first, arms(1), 'same seed, same downs');
  assert.equal(new Set(first).size, 3, 'all three arms get dealt');
});

test('an arm is chosen once per down, not once per turn', () => {
  const runLog = loadGhostLog('coaching-logs/default-offense.json');
  const passLog = loadGhostLog('coaching-logs/default-offense2.json');
  const coach = dealtOffenseCoach({ runLog, passLog, rand: mulberry32(3) });
  const s = scenario(mulberry32(11));
  coach(s);
  const arm = s.dealtArm;
  for (let t = 1; t < 4; t++) { s.turnIndex = t; coach(s); }
  assert.equal(s.dealtArm, arm);
});

test('the candidate defense genome reaches the down\'s read, not just its orders', () => {
  // advancePlay (turn.js) falls back to the SHIPPED genome unless the state
  // carries an override, so defenseCoach must put the candidate there itself
  // -- both through its own advancePlay call and through genomeOverrides --
  // or a candidate's read:man:* weights never move fitness by a single yard
  // no matter how they are trained. There are no cues at the snap (turn 0),
  // so this has to reach turn 1, where a real cover map exists to key off.
  const distinctive = { ...makeGenome(DEFENSE_SPEC), 'read:man:downfield': 3 };
  const s1 = scenario(mulberry32(21));
  const coach1 = defenseCoach(distinctive);
  coach1(s1); // turn 0: man is the default scheme, so a real cover map is made

  const cover1 = s1.playRead.call.defense.cover;
  assert.ok(cover1 && cover1.size > 0, 'this look must actually be covered for the test to mean anything');
  const [defenderId, receiverId] = [...cover1][0];
  s1.players.find((p) => p.id === receiverId).vel = { x: 0, y: 60 };
  s1.turnIndex = 1;
  coach1(s1); // turn 1: read:man:downfield now applies to what it just saw

  const inert = makeGenome(DEFENSE_SPEC);
  const s2 = scenario(mulberry32(21));
  const coach2 = defenseCoach(inert);
  coach2(s2);
  const cover2 = s2.playRead.call.defense.cover;
  assert.deepEqual([...cover2], [...cover1], 'the same seed must cover the same man');
  s2.players.find((p) => p.id === receiverId).vel = { x: 0, y: 60 };
  s2.turnIndex = 1;
  coach2(s2);

  assert.notEqual(
    s1.playRead.reads[defenderId].pass, 0,
    'the candidate\'s read:man:downfield did not reach the read',
  );
  assert.equal(
    s2.playRead.reads[defenderId].pass, 0,
    'an inert genome should read nothing off the very same motion',
  );
});
