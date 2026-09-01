import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, TUTORIAL_LOS_YARD } from '../../../lib/game/tutorial/script.js';
import { getRoster } from '../../../lib/game/rosters.js';
import { createGame } from '../../../lib/game/state.js';

const GESTURES = ['drag', 'passdrag', 'doubletap', 'click'];
const VERBS = ['run', 'runout', 'reposition', 'menu', 'drag', 'cover', 'doubletap', 'pass', 'move', 'none'];
const BUTTONS = ['reposition', 'autoplan', 'run', 'menu'];

test('every lesson is played on the fifty, on a roster that exists', () => {
  assert.equal(TUTORIAL_LOS_YARD, 50);
  assert.equal(SCENARIOS.length, 4);
  for (const s of SCENARIOS) {
    assert.equal(getRoster(s.variantId).id, s.variantId, `${s.id}: real roster`);
    assert.ok(s.title && s.outro, `${s.id}: has a title and a sign-off`);
    assert.notEqual(s.coach, s.scripted, `${s.id}: the two sides are different sides`);
    for (const b of s.buttons) assert.ok(BUTTONS.includes(b), `${s.id}: button ${b}`);
  }
});

test('every authored order names a man the scripted side actually fields', () => {
  for (const s of SCENARIOS) {
    const roster = getRoster(s.variantId);
    const mine = new Set(roster[s.scripted].map((p) => p.id));
    const theirs = new Set(roster[s.coach].map((p) => p.id));
    assert.ok(s.orders.length > 0, `${s.id}: the other side has been told something`);
    for (const [turn, orders] of s.orders.entries()) {
      for (const o of orders) {
        assert.ok(mine.has(o.id), `${s.id} turn ${turn}: ${o.id} is on the scripted side`);
        if (o.cover) assert.ok(theirs.has(o.cover), `${s.id} turn ${turn}: covers a real opponent`);
        assert.ok(o.aim || o.cover || o.mode, `${s.id} turn ${turn}: ${o.id} was told something`);
      }
    }
  }
});

test("every opening order is the coach's own man, told to do something real", () => {
  for (const s of SCENARIOS) {
    const roster = getRoster(s.variantId);
    const mine = new Set(roster[s.coach].map((p) => p.id));
    const theirs = new Set(roster[s.scripted].map((p) => p.id));
    for (const o of s.openingOrders ?? []) {
      assert.ok(mine.has(o.id), `${s.id}: ${o.id} is on the side the coach is given`);
      if (o.cover) assert.ok(theirs.has(o.cover), `${s.id}: ${o.id} covers a real opponent`);
      assert.ok(o.aim || o.cover, `${s.id}: ${o.id} was told something`);
    }
  }
});

test('nobody the coach is given comes to the line with nothing to do', () => {
  // The reason openingOrders exists. A man with no plan and no cover trips
  // turn.js's unplannedPlayers, and in a lesson the coach cannot answer that —
  // the gate refuses every gesture but the one the step asked for. The one
  // sanctioned exception is a man whose own step is about to give him orders.
  const TAUGHT = { 'snap-and-run': ['o-qb'], 'block-and-throw': ['o-qb', 'o-rb'], 'playing-defense': ['d-lb'], 'where-they-stand': ['o-qb'] };
  for (const s of SCENARIOS) {
    const ordered = new Set((s.openingOrders ?? []).map((o) => o.id));
    for (const p of getRoster(s.variantId)[s.coach]) {
      // The snapper is covered by the automatic snap on turn 0 whatever else
      // he is doing, but not on any turn after it — so he still needs an order.
      assert.ok(ordered.has(p.id) || TAUGHT[s.id].includes(p.id),
        `${s.id}: ${p.id} has neither an opening order nor a step that gives him one`);
    }
  }
});

test('every step is answerable: a real man, a real verb, and words to nudge with', () => {
  for (const s of SCENARIOS) {
    const roster = getRoster(s.variantId);
    const coached = new Set(roster[s.coach].map((p) => p.id));
    const everyone = new Set([...roster.offense, ...roster.defense].map((p) => p.id));
    assert.ok(s.steps.length > 0, `${s.id}: has steps`);
    for (const step of s.steps) {
      const where = `${s.id}/${step.id}`;
      assert.equal(typeof step.text, 'string', `${where}: says something`);
      assert.equal(typeof step.done, 'function', `${where}: knows when it has landed`);
      assert.equal(typeof step.needsLivePlay, 'boolean', `${where}: says if it needs a live play`);
      assert.ok(Array.isArray(step.demo), `${where}: demo is a list`);
      for (const d of step.demo) assert.ok(VERBS.includes(d.verb), `${where}: verb ${d.verb}`);

      if (step.allow.action === 'gesture') {
        assert.ok(step.nudge, `${where}: a refused gesture has to say what was wanted`);
        for (const id of step.allow.playerIds) {
          assert.ok(coached.has(id), `${where}: ${id} is the coach's own man`);
        }
        for (const k of step.allow.kinds) assert.ok(GESTURES.includes(k), `${where}: kind ${k}`);
      } else {
        assert.ok(['run', 'reposition', 'menu', 'any'].includes(step.allow.action), `${where}: action`);
        if (step.allow.action !== 'any') assert.ok(step.nudge, `${where}: has a nudge`);
      }

      if (step.highlight?.kind === 'player') {
        assert.ok(everyone.has(step.highlight.id), `${where}: highlights a real man`);
      }
      if (step.highlight?.kind === 'button') {
        assert.ok(s.buttons.includes(step.highlight.name),
          `${where}: highlights a button this lesson actually fields`);
      }
    }
    assert.equal(s.steps.at(-1).needsLivePlay, false,
      `${s.id}: the closing beat outlives the whistle`);
  }
});

test('the tutorial ends by teaching the way out, and only at the very end', () => {
  const menuSteps = SCENARIOS.flatMap((s, i) =>
    s.steps.map((step, j) => ({ s, i, step, j })).filter((x) => x.step.allow.action === 'menu'));
  assert.equal(menuSteps.length, 1, 'exactly one lesson teaches the menu');
  const only = menuSteps[0];
  assert.equal(only.i, SCENARIOS.length - 1, 'and it is the last lesson');
  assert.equal(only.j, only.s.steps.length - 1, 'and its last step');
  assert.ok(only.s.buttons.includes('menu'), 'which therefore fields the clipboard');
  assert.deepEqual(only.step.highlight, { kind: 'button', name: 'menu' }, 'with the ring on it');
});

test('a lesson deals the men its steps talk about', () => {
  for (const s of SCENARIOS) {
    const state = createGame({
      seed: s.seed, variant: s.variantId, losYard: TUTORIAL_LOS_YARD,
      ai: s.scripted, aiLevel: 'scripted', scriptedOrders: s.orders,
    });
    assert.equal(state.losYard, 50, `${s.id}: on the fifty`);
    assert.equal(state.aiTeam, s.scripted, `${s.id}: the computer has the other side`);
  }
});
