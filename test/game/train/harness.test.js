import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePair, evaluateDefense, evaluateOffense, evaluateMatch,
  defenseCoach, learnedOffenseCoach, scriptedOffenseCoach, smartDefenseCoach,
  scenario, playOnePlay, countPasses, pairAirYards, summarizePlays,
  varyOffensiveLook, dealtTruth,
} from '../../../lib/game/train/harness.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { makeGenome } from '../../../lib/game/learned/genome.js';
import { DEFENSE_SPEC } from '../../../lib/game/learned/defense-spec.js';
import { OFFENSE_SPEC } from '../../../lib/game/learned/offense-spec.js';
import { createGame, getPlayer, setPass } from '../../../lib/game/state.js';
import { TURN_SECONDS, ON_LINE_YARDS } from '../../../lib/game/constants.js';
import {
  formationFoul, spotFault, lineCount,
} from '../../../lib/game/formation.js';
import {
  applyLearnedOffenseFormation, learnedOffenseSpots,
} from '../../../lib/game/learned/formation.js';
import { xToYards } from '../../../lib/field/geometry.js';
import { yardsOfY } from '../../../lib/game/view.js';

const DEF = makeGenome(DEFENSE_SPEC);
const OFF = makeGenome(OFFENSE_SPEC);
const OPTS = { plays: 4, seed: 12 };

test('evaluatePair reproduces evaluateDefense exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({ offense: scriptedOffenseCoach, defense: defenseCoach(DEF), ...OPTS }),
    evaluateDefense(DEF, OPTS),
  );
});

test('evaluatePair reproduces evaluateMatch exactly, dice for dice', () => {
  assert.deepEqual(
    evaluatePair({
      offense: learnedOffenseCoach(OFF, mulberry32(OPTS.seed)),
      defense: defenseCoach(DEF),
      ...OPTS,
    }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});

test('smartDefenseCoach gives the assignment defense its orders', () => {
  const s = scenario(mulberry32(21));
  smartDefenseCoach(s);
  const defenders = s.players.filter((p) => p.team === 'defense');
  assert.ok(defenders.some((p) => p.plan || p.cover), 'somebody was told something');
});

test('evaluateOffense scores an offense genome against the smart defense', () => {
  const a = evaluateOffense(OFF, OPTS);
  const b = evaluateOffense(OFF, OPTS);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.yardsPerPlay));
  assert.ok(a.touchdownRate >= 0 && a.touchdownRate <= 1);
  assert.ok(a.turnoverRate >= 0 && a.turnoverRate <= 1);
});

test('evaluateOffense takes any defense coach, including a learned one', () => {
  assert.deepEqual(
    evaluateOffense(OFF, { ...OPTS, defenseCoach: defenseCoach(DEF) }),
    evaluateMatch(OFF, DEF, OPTS),
  );
});

test('evaluateDefense reports the richer aggregates the new fitness needs', () => {
  const a = evaluateDefense(DEF, OPTS);
  assert.ok(Number.isFinite(a.gainYardsPerPlay) && a.gainYardsPerPlay >= 0);
  assert.ok(Number.isFinite(a.lossYardsPerPlay) && a.lossYardsPerPlay >= 0);
  assert.ok(Number.isFinite(a.tdYardsPerPlay));
  assert.ok(Number.isFinite(a.secondsPerPlay) && a.secondsPerPlay >= 0);
  assert.ok(Number.isFinite(a.passesPerPlay) && a.passesPerPlay >= 0);
  assert.ok(Number.isFinite(a.airYardsPerPlay) && a.airYardsPerPlay >= 0);
});

test('countPasses ignores the automatic snap, forward or not, and counts only real forward throws', () => {
  assert.equal(countPasses([{ type: 'pass', by: 'o-c', forward: false, auto: true }]), 0);
  assert.equal(
    countPasses([{ type: 'pass', by: 'o-c', forward: true, auto: true }]), 0,
    'auto excludes it even on the rare snap that happens to point forward',
  );
  assert.equal(countPasses([{ type: 'pass', by: 'o-qb', forward: true, auto: false }]), 1);
  assert.equal(
    countPasses([{ type: 'pass', by: 'o-qb', forward: false, auto: false }]), 0,
    'a lateral is not a forward pass',
  );
});

test('pairAirYards credits a completion the distance from release to the catch', () => {
  const events = [
    { type: 'pass', by: 'o-qb', forward: true, auto: false, fromYard: 20 },
    { type: 'pickup', by: 'o-wr1', team: 'offense', atYard: 35 },
  ];
  assert.equal(pairAirYards(events), 15);
});

test('pairAirYards contributes nothing for an incomplete pass', () => {
  const events = [
    { type: 'pass', by: 'o-qb', forward: true, auto: false, fromYard: 20 },
    { type: 'incomplete' },
  ];
  assert.equal(pairAirYards(events), 0);
});

test('pairAirYards floors at zero for a throw caught behind the line of scrimmage', () => {
  const events = [
    { type: 'pass', by: 'o-qb', forward: true, auto: false, fromYard: 20 },
    { type: 'pickup', by: 'o-wr1', team: 'offense', atYard: 12 },
  ];
  assert.equal(pairAirYards(events), 0);
});

test('pairAirYards does not credit an interception', () => {
  const events = [
    { type: 'pass', by: 'o-qb', forward: true, auto: false, fromYard: 20 },
    { type: 'pickup', by: 'd-cb1', team: 'defense', atYard: 35 },
  ];
  assert.equal(pairAirYards(events), 0);
});

test('playOnePlay wires a real completed throw through to passes and airYards', () => {
  // Mirrors turn.test.js's "a teammate downfield catches the throw": a flat
  // throw (not a lob) that lands inside the first turn, so the whole
  // fromYard -> atYard pairing runs through the real event stream rather
  // than a hand-built one.
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  s.players = s.players.filter((p) => p.id === 'o-qb' || p.id === 'o-wr1');
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 40 };
  const offenseCoach = (state) => {
    if (state.turnIndex === 0) setPass(state, 'o-qb', { x: 0, y: 1 }, 0.4);
  };
  const r = playOnePlay(s, offenseCoach, () => {}, mulberry32(1));
  assert.equal(r.passes, 1);
  const passEvent = r.events.find((e) => e.type === 'pass' && !e.auto);
  const pickupEvent = r.events.find((e) => e.type === 'pickup' && e.team === 'offense');
  assert.ok(passEvent && typeof passEvent.fromYard === 'number');
  assert.ok(pickupEvent && typeof pickupEvent.atYard === 'number');
  assert.ok(r.airYards > 0, `expected positive air yards, got ${r.airYards}`);
  assert.ok(
    Math.abs(r.airYards - Math.max(0, pickupEvent.atYard - passEvent.fromYard)) < 1e-9,
  );
});

test('summarizePlays: a touchdown play is scored on yards alone — time, passes and air yards from that play never leak into the aggregate', () => {
  const quick = {
    yards: 40, touchdown: true, turnover: false, turns: 2, passes: 1, airYards: 30,
  };
  const slow = {
    yards: 40, touchdown: true, turnover: false, turns: 20, passes: 4, airYards: 30,
  };
  const a = summarizePlays([quick]);
  const b = summarizePlays([slow]);
  assert.equal(a.tdYardsPerPlay, 40);
  assert.equal(a.touchdownRate, 1);
  assert.equal(a.secondsPerPlay, 0, 'a touchdown play\'s seconds are excluded, not summed');
  assert.equal(a.passesPerPlay, 0);
  assert.equal(a.airYardsPerPlay, 0);
  assert.deepEqual(a, b, 'a fast and a slow touchdown of equal yards aggregate identically');
});

test('summarizePlays splits a non-touchdown play\'s yards into gain or loss, and folds in its seconds/passes/airYards', () => {
  const gain = {
    yards: 5, touchdown: false, turnover: false, turns: 3, passes: 1, airYards: 4,
  };
  const loss = {
    yards: -3, touchdown: false, turnover: true, turns: 1, passes: 0, airYards: 0,
  };
  const a = summarizePlays([gain, loss]);
  assert.equal(a.gainYardsPerPlay, 5 / 2);
  assert.equal(a.lossYardsPerPlay, 3 / 2);
  assert.equal(a.tdYardsPerPlay, 0);
  assert.equal(a.turnoverRate, 0.5);
  assert.equal(a.secondsPerPlay, (3 * TURN_SECONDS + 1 * TURN_SECONDS) / 2);
  assert.equal(a.passesPerPlay, 1 / 2);
  assert.equal(a.airYardsPerPlay, 4 / 2);
  assert.equal(a.yardsPerPlay, (5 + -3) / 2);
});

// -----------------------------------------------------------------------
// dealtTruth / summarizePlays.readAccuracy — the read-accuracy signal that
// prices the per-defender play read directly (see fitness.js's
// READ_ACCURACY_YARDS for why yards allowed cannot see it on their own).
// -----------------------------------------------------------------------

test('dealtTruth: a dealt run or pass is its own truth every turn, whatever forwardPasses says', () => {
  assert.equal(dealtTruth('run', 0), 'run');
  assert.equal(dealtTruth('run', 1), 'run', 'a dealt run never turns into a pass truth');
  assert.equal(dealtTruth('pass', 0), 'pass');
  assert.equal(dealtTruth('pass', 1), 'pass');
});

test('dealtTruth: play-action reads as a run while the fake sells, and flips to a pass the instant the throw is up', () => {
  assert.equal(dealtTruth('play-action', 0), 'run', 'no throw yet -- still the fake');
  assert.equal(dealtTruth('play-action', 1), 'pass', 'a forward pass has gone up');
  assert.equal(dealtTruth('play-action', 2), 'pass', 'stays pass once the ball is up');
});

test('summarizePlays: readAccuracy is null when nothing was ever scored, and does not disturb the other fields', () => {
  const untouched = {
    yards: 5, touchdown: false, turnover: false, turns: 3, passes: 0, airYards: 0,
  };
  // A result with no readsRight/readsTotal at all -- what every hand-built
  // play object in this suite already looks like, and what scriptedOffenseCoach
  // and co-evolution's learned offense actually produce.
  const a = summarizePlays([untouched]);
  assert.equal(a.readAccuracy, null);
  assert.equal(a.yardsPerPlay, 5);

  // A result that explicitly scored zero reads (an arm was dealt, but the
  // down never got to a covered turn) lands in the same place.
  const b = summarizePlays([{ ...untouched, readsRight: 0, readsTotal: 0 }]);
  assert.equal(b.readAccuracy, null);
});

test('summarizePlays: readAccuracy sums right and total across every play before dividing, not a mean of per-play ratios', () => {
  const base = {
    yards: 0, touchdown: false, turnover: false, turns: 1, passes: 0, airYards: 0,
  };
  const a = { ...base, readsRight: 3, readsTotal: 4 }; // 0.75
  const b = { ...base, readsRight: 1, readsTotal: 2 }; // 0.5
  // The mean of the ratios is 0.625; the ratio of the sums is 4/6 = 0.6˙ --
  // proving which one summarizePlays actually computes.
  assert.equal(summarizePlays([a, b]).readAccuracy, (3 + 1) / (4 + 2));
});

// -----------------------------------------------------------------------
// varyOffensiveLook — the perturbation that lands on top of the learned
// offense's own formation so the co-evolution path (learnedOffenseCoach)
// shows the defense a varied, but still recognisably the genome's own, look.
// -----------------------------------------------------------------------

test('every look the co-evolution path produces is legal', () => {
  // Drive learnedOffenseCoach itself (formation + vary + play-call) exactly
  // the way evaluateMatch does, over enough plays that a rare illegal corner
  // would show up. A training look the rulebook would refuse is a down
  // nobody could play, so this may never be loosened if it fails.
  const off = makeGenome(OFFENSE_SPEC);
  const coach = learnedOffenseCoach(off, mulberry32(41));
  for (let i = 0; i < 120; i++) {
    const s = scenario(mulberry32(1 + i));
    coach(s);
    assert.equal(formationFoul(s), null, `foul on look ${i}`);
    for (const p of s.players) {
      assert.equal(spotFault(s, p.id, p.pos), null, `${p.id} on look ${i}`);
    }
  }
});

test('varyOffensiveLook preserves on-the-line status for every offensive player', () => {
  const rand = mulberry32(43);
  for (let i = 0; i < 100; i++) {
    const s = scenario(mulberry32(2 + i));
    applyLearnedOffenseFormation(s, OFF);
    const before = new Map(
      s.players.filter((p) => p.team === 'offense').map((p) => [p.id, (
        Math.abs(yardsOfY(p.pos.y) - s.losYard) <= ON_LINE_YARDS
      )]),
    );
    const lineBefore = lineCount(s, 'offense');
    varyOffensiveLook(s, rand);
    assert.equal(lineCount(s, 'offense'), lineBefore, `lineCount changed on look ${i}`);
    for (const p of s.players) {
      if (p.team !== 'offense') continue;
      const isOn = Math.abs(yardsOfY(p.pos.y) - s.losYard) <= ON_LINE_YARDS;
      assert.equal(isOn, before.get(p.id), `${p.id} flipped on-the-line status on look ${i}`);
    }
  }
});

test('varyOffensiveLook actually varies the look', () => {
  const rand = mulberry32(47);
  const looks = new Set();
  const spreads = [];
  for (let i = 0; i < 50; i++) {
    const s = scenario(mulberry32(1));
    applyLearnedOffenseFormation(s, OFF);
    varyOffensiveLook(s, rand);
    const wr = s.players.filter((p) => p.id === 'o-wr1' || p.id === 'o-wr2');
    looks.add(wr.map((p) => `${p.pos.x.toFixed(2)},${p.pos.y.toFixed(2)}`).join('|'));
    const xs = s.players.filter((p) => p.team === 'offense').map((p) => xToYards(p.pos.x));
    spreads.push(Math.max(...xs) - Math.min(...xs));
  }
  assert.ok(looks.size > 40, `only ${looks.size} distinct looks in 50 calls`);
  assert.ok(Math.max(...spreads) - Math.min(...spreads) > 1, 'spread barely moved');
});

test('the same seed produces the same sequence of varied looks', () => {
  const run = () => {
    const rand = mulberry32(53);
    const out = [];
    for (let i = 0; i < 20; i++) {
      const s = scenario(mulberry32(1));
      applyLearnedOffenseFormation(s, OFF);
      varyOffensiveLook(s, rand);
      out.push(s.players.map((p) => `${p.id}:${p.pos.x},${p.pos.y}`).join());
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('varyOffensiveLook nudges the genome\'s own spots rather than replacing them', () => {
  const rand = mulberry32(59);
  for (let i = 0; i < 30; i++) {
    const s = scenario(mulberry32(3 + i));
    applyLearnedOffenseFormation(s, OFF);
    const spots = new Map(learnedOffenseSpots(s, OFF).map(({ id, pos }) => [id, pos]));
    varyOffensiveLook(s, rand);
    for (const id of ['o-wr1', 'o-wr2']) {
      const p = s.players.find((pl) => pl.id === id);
      const orig = spots.get(id);
      const dAcross = Math.abs(xToYards(p.pos.x) - xToYards(orig.x));
      const dDepth = Math.abs(yardsOfY(p.pos.y) - yardsOfY(orig.y));
      assert.ok(dAcross <= 6 + 1e-6, `${id} across drifted ${dAcross} on look ${i}`);
      assert.ok(dDepth <= 0.75 + 1e-6, `${id} depth drifted ${dDepth} on look ${i}`);
    }
    for (const id of ['o-qb', 'o-rb']) {
      const p = s.players.find((pl) => pl.id === id);
      const orig = spots.get(id);
      const dAcross = Math.abs(xToYards(p.pos.x) - xToYards(orig.x));
      assert.ok(dAcross <= 4 + 1e-6, `${id} across drifted ${dAcross} on look ${i}`);
      assert.equal(p.pos.y, orig.y, `${id} depth should be untouched on look ${i}`);
    }
  }
});
