import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../../../lib/game/tutorial/script.js';
import { advance, offScript, stepAt } from '../../../lib/game/tutorial/machine.js';
import { createGame, getPlayer, setPlan, setMode, setPass } from '../../../lib/game/state.js';
import { runTurn } from '../../../lib/game/turn.js';
import { setCover } from '../../../lib/game/cover.js';
import { placePlayer } from '../../../lib/game/formation.js';
import { planForDrag } from '../../../lib/game/predict.js';
import { lockOnPass } from '../../../lib/game/pass.js';
import { mulberry32 } from '../../../lib/game/rng.js';
import { sub } from '../../../lib/game/vec.js';

/** Deal a scenario exactly as app/tutorial.js will. */
function deal(scenario) {
  const state = createGame({
    seed: scenario.seed,
    variant: scenario.variantId,
    losYard: TUTORIAL_LOS_YARD,
    ai: scenario.scripted,
    aiLevel: 'scripted',
    scriptedOrders: scenario.orders,
  });
  const startSpots = {};
  for (const p of state.players) startSpots[p.id] = { x: p.pos.x, y: p.pos.y };
  return {
    state,
    random: mulberry32(scenario.seed),
    ctx: { repositioning: false, menuOpen: false, startSpots },
  };
}

/**
 * Perform one model answer. This is the coach's hands: every verb here is the
 * same call app/main.js makes when a real gesture commits, so a demo that works
 * is a gesture that works.
 */
function perform(run, verb) {
  const { state, ctx } = run;
  if (verb.verb === 'run') { runTurn(state, run.random); return; }
  if (verb.verb === 'runout') {
    // To the whistle, however many turns that takes. The capped loop is a
    // backstop: a play that will not die is a bug in the scenario, and it
    // should fail as an assertion rather than hang the suite.
    for (let i = 0; i < 30 && state.phase === 'planning'; i += 1) runTurn(state, run.random);
    assert.notEqual(state.phase, 'planning', 'the play never ended');
    return;
  }
  if (verb.verb === 'reposition') { ctx.repositioning = !ctx.repositioning; return; }
  // In the browser this is <dialog>.open going true; here it is the same fact,
  // written down by the only hands the test has.
  if (verb.verb === 'menu') { ctx.menuOpen = true; return; }
  if (verb.verb === 'none') return;
  if (verb.verb === 'drag') {
    const p = getPlayer(state, verb.id);
    const plan = planForDrag(p, sub(verb.to, p.pos));
    setPlan(state, verb.id, plan.dir, plan.throttle, plan.target, plan.short);
    return;
  }
  if (verb.verb === 'cover') {
    assert.ok(setCover(state, verb.id, verb.target), `${verb.id} could not cover ${verb.target}`);
    return;
  }
  if (verb.verb === 'doubletap') {
    assert.ok(setMode(state, verb.id, verb.mode), `${verb.id} was refused ${verb.mode}`);
    return;
  }
  if (verb.verb === 'pass') {
    const from = getPlayer(state, verb.from);
    const aim = lockOnPass(from, getPlayer(state, verb.target));
    assert.ok(setPass(state, verb.from, aim.dir, aim.power, verb.target),
      `${verb.from} could not throw`);
    return;
  }
  if (verb.verb === 'move') {
    assert.ok(placePlayer(state, verb.id, verb.to), `${verb.id} could not be moved there`);
    return;
  }
  throw new Error(`unknown demo verb "${verb.verb}"`);
}

for (const scenario of SCENARIOS) {
  test(`${scenario.id}: the seed still produces the beats the script teaches`, () => {
    const run = deal(scenario);
    let index = 0;
    // A generous ceiling: every scenario is a handful of steps, and a runaway
    // loop should fail as a loop rather than hang the suite.
    for (let guard = 0; guard < 40 && index < scenario.steps.length; guard += 1) {
      const step = stepAt(scenario, index);
      for (const verb of step.demo) perform(run, verb);
      const next = advance(scenario, index, run.state, run.ctx);
      assert.notEqual(next, index,
        `${scenario.id}/${step.id}: the model answer did not land the step`);
      index = next;
      assert.equal(offScript(scenario, index, run.state), false,
        `${scenario.id}: went off script after ${step.id}`
        + ` (phase ${run.state.phase}, penalty ${JSON.stringify(run.state.penalty)})`);
    }
    assert.equal(index, scenario.steps.length, `${scenario.id}: every step landed`);
  });
}

test('no lesson can draw an illegal-formation flag, whatever the coach does', () => {
  for (const scenario of SCENARIOS) {
    const { state, random } = deal(scenario);
    runTurn(state, random);
    assert.notEqual(state.penalty?.foul, 'illegal-formation', scenario.id);
  }
});
