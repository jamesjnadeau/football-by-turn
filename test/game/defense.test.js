import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionGroup, defendDir, losY, pastLine, groupMates,
} from '../../lib/game/defense.js';
import { createGame, getPlayer } from '../../lib/game/state.js';
import { fieldPos } from '../../lib/game/view.js';

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
  assert.equal(losY(s), fieldPos(0, 0).y);
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
