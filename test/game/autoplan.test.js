import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoplanLearned, autoplanLearnedOffense, clearTeamOrders } from '../../lib/game/autoplan.js';
import { createGame, getPlayer, setPlan, setMode, aimSnap } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';
import { setCover } from '../../lib/game/cover.js';
import { coachLearnedOffense } from '../../lib/game/learned/offense-policy.js';
import { activeGenome } from '../../lib/game/learned/active.js';
import { makeGenome } from '../../lib/game/learned/genome.js';
import { OFFENSE_SPEC } from '../../lib/game/learned/offense-spec.js';

/** What a team's board actually says, for a byte-for-byte comparison. */
const board = (s, team) => s.players
  .filter((p) => p.team === team)
  .map((p) => ({ id: p.id, plan: p.plan, cover: p.cover, mode: p.mode }));

/** A genome that is the seed spec with a few keys pushed. */
const offenseGenome = (over) => ({ ...makeGenome(OFFENSE_SPEC), ...over });

test('the 🎁 draws exactly what the learned offense would have played', () => {
  const pressed = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  const computer = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });

  autoplanLearned(pressed);
  coachLearnedOffense(computer, activeGenome(computer, 'offense'));
  aimSnap(computer);

  assert.deepEqual(board(pressed, 'offense'), board(computer, 'offense'));
  assert.deepEqual(pressed.plannedPass, computer.plannedPass);
  assert.deepEqual(pressed.aiPlay, computer.aiPlay);
});

test('the 🎁 plays the genome the coach has trained, not the shipped one', () => {
  const run = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  run.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  const runNote = autoplanLearned(run);

  const pass = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  pass.genomeOverrides = { offense: offenseGenome({ 'call:bias': 4 }), defense: null };
  const passNote = autoplanLearned(pass);

  assert.match(runNote, /^Learned call: run/);
  assert.match(passNote, /^Learned call: pass/);
  // The run is the option: the line commits to the cut block. The pass is
  // protection -- the same guard takes a man on instead.
  assert.equal(getPlayer(run, 'o-lg').mode, 'cutBlock');
  assert.equal(getPlayer(pass, 'o-lg').mode, 'holding');
});

test('the press wipes the coach\'s stale orders before it draws', () => {
  // A board the learned offense declines to draw on at all -- the defense has
  // the ball -- so what is left on it afterwards is the wipe and nothing else.
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.turnIndex = 2;
  s.ball = { carrierId: 'd-nt', pos: null, vel: null };
  setPlan(s, 'o-wr1', { x: 0, y: 1 }, 1);
  setCover(s, 'o-wr2', 'd-cb1');
  setMode(s, 'o-lg', 'holding');

  autoplanLearnedOffense(s);

  assert.deepEqual(
    board(s, 'offense').filter((p) => p.plan || p.cover || p.mode !== 'normal'),
    [],
    'every arrow, assignment and stance of the last play is gone',
  );
});

test('the automatic snap survives the press, and a give replaces it', () => {
  // The read is the widest lineman on the play side against the edge of the
  // blocked box: the seed front stands the tackle right on the guard's own
  // outside shoulder, which reads as a crash and therefore a keep.
  const keep = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  keep.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  autoplanLearned(keep);
  assert.equal(keep.plannedPass.auto, true, 'a keep leaves the ordinary snap to the QB');
  assert.equal(keep.plannedPass.target, 'o-qb');

  // Widen that tackle to 10 yards out and he is playing contain: 7.5 yards
  // (28 units, at 3.75 units to the yard) outside the guard, well past the
  // genome's 6-unit read. The alley inside him is the give.
  const give = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  give.genomeOverrides = { offense: offenseGenome({ 'call:bias': -4 }), defense: null };
  getPlayer(give, 'd-dt2').pos = fieldPos(10, give.losYard + 1);
  autoplanLearned(give);
  assert.equal(give.plannedPass.target, 'o-rb', 'a give is a direct snap to the back');
  assert.ok(!give.plannedPass.auto);
});

test('the 🎁 declines outside the planning phase and changes nothing', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.phase = 'playOver';
  const before = board(s, 'offense');
  assert.equal(autoplanLearned(s), null);
  assert.deepEqual(board(s, 'offense'), before);
});

test('hot-seat draws up the offense, the same side the playbook opens on', () => {
  const s = createGame({ seed: 1 }); // aiTeam null
  const note = autoplanLearned(s);
  assert.match(note, /^Learned call:/);
  assert.ok(getPlayer(s, 'o-qb').plan, 'the quarterback has an arrow');
  assert.equal(getPlayer(s, 'd-nt').plan, null, 'and the defense has none');
});

test('a broken play reads off the ball, not off the called play', () => {
  const s = createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' });
  s.turnIndex = 2;
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  const note = autoplanLearnedOffense(s);
  assert.match(note, /RB/);
  assert.ok(getPlayer(s, 'o-rb').plan, 'the carrier is pointed at daylight');
  assert.ok(getPlayer(s, 'o-lg').plan, 'and everybody else blocks');
});

test('clearTeamOrders wipes one team and leaves the other alone', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-qb', { x: 0, y: 1 }, 1);
  setPlan(s, 'd-nt', { x: 0, y: -1 }, 1);
  clearTeamOrders(s, 'offense', { modes: true });
  assert.equal(getPlayer(s, 'o-qb').plan, null);
  assert.ok(getPlayer(s, 'd-nt').plan, 'the other team is not this button\'s to wipe');
});
