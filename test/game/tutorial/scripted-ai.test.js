import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getPlayer } from '../../../lib/game/state.js';
import { coachAi, applyScriptedOrders } from '../../../lib/game/ai.js';
import { fieldPos } from '../../../lib/game/view.js';

function drill(scriptedOrders) {
  return createGame({
    seed: 1, variant: 'tutorial-2v2', losYard: 50,
    ai: 'defense', aiLevel: 'scripted', scriptedOrders,
  });
}

test('the turn index picks the orders, and an aim becomes a full-throttle plan', () => {
  const s = drill([
    [{ id: 'd-nt', aim: fieldPos(0, 46) }],
    [{ id: 'd-nt', aim: fieldPos(-10, 46) }],
  ]);
  coachAi(s);
  assert.deepEqual(getPlayer(s, 'd-nt').plan.dir, { x: 0, y: -1 }, 'turn nought: straight upfield');
  assert.equal(getPlayer(s, 'd-nt').plan.throttle, 1);

  s.turnIndex = 1;
  coachAi(s);
  assert.ok(getPlayer(s, 'd-nt').plan.dir.x < 0, 'turn one: he has been sent left');
});

test('past the end of the script the last turn is played again', () => {
  const s = drill([[{ id: 'd-lb', cover: 'o-qb' }]]);
  s.turnIndex = 7;
  coachAi(s);
  assert.equal(getPlayer(s, 'd-lb').cover, 'o-qb', 'a blocker told to block keeps blocking');
});

test('a cover order is a cover order, not an arrow at where he was standing', () => {
  const s = drill([[{ id: 'd-lb', cover: 'o-qb' }]]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-lb').cover, 'o-qb');
});

test('an authored stance survives: the generic break-down rule never runs', () => {
  const s = drill([[{ id: 'd-nt', aim: fieldPos(0, 46), mode: 'prepared' }]]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').mode, 'prepared');
  assert.ok(getPlayer(s, 'd-nt').facing, 'committing froze an axis');
});

test('a mode already set is not set again, so the charge bonus is not re-armed', () => {
  const s = drill([[{ id: 'd-nt', mode: 'prepared' }], [{ id: 'd-nt', mode: 'prepared' }]]);
  coachAi(s);
  getPlayer(s, 'd-nt').charge = 0; // the whistle clears it, as turn.js does
  s.turnIndex = 1;
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').charge, 0, 'standing in the same stance earns nothing');
});

test('an empty script coaches nobody rather than throwing', () => {
  const s = drill([]);
  coachAi(s);
  assert.equal(getPlayer(s, 'd-nt').plan, null);
  applyScriptedOrders(createGame({ seed: 1, ai: 'defense', aiLevel: 'scripted' }));
});
