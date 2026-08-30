import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_SLOTS, PLAYBOOK_VERSION, emptyPlaybook, firstEmptySlot, putPlay,
  serializePlaybook, parsePlaybook,
} from '../../lib/game/playbook.js';

const play = (name) => ({
  name,
  plans: { 'o-qb': { dir: { x: 0, y: -1 }, throttle: 1 } },
  stances: {},
  pass: null,
  spots: {},
});

test('a new playbook is five empty slots', () => {
  const pb = emptyPlaybook();
  assert.equal(PLAY_SLOTS, 5);
  assert.equal(pb.length, PLAY_SLOTS);
  assert.ok(pb.every((slot) => slot === null));
});

test('the first empty slot is the lowest one, and -1 when the book is full', () => {
  let pb = emptyPlaybook();
  assert.equal(firstEmptySlot(pb), 0);
  pb = putPlay(pb, 0, play('A'));
  assert.equal(firstEmptySlot(pb), 1);
  for (let i = 1; i < PLAY_SLOTS; i++) pb = putPlay(pb, i, play(`P${i}`));
  assert.equal(firstEmptySlot(pb), -1);
});

test('putPlay copies rather than mutating', () => {
  const pb = emptyPlaybook();
  const next = putPlay(pb, 2, play('A'));
  assert.equal(pb[2], null);
  assert.equal(next[2].name, 'A');
});

test('putPlay ignores a slot outside the five', () => {
  const pb = emptyPlaybook();
  for (const slot of [-1, PLAY_SLOTS, 1.5, '0', NaN]) {
    assert.equal(putPlay(pb, slot, play('A')), pb, String(slot));
  }
});

test('a playbook round-trips through storage', () => {
  let pb = emptyPlaybook();
  pb = putPlay(pb, 0, play('Sweep'));
  pb = putPlay(pb, 3, play('Post'));
  assert.deepEqual(parsePlaybook(serializePlaybook(pb)), pb);
});

test('the stored form carries a version', () => {
  assert.equal(JSON.parse(serializePlaybook(emptyPlaybook())).v, PLAYBOOK_VERSION);
});

test('nothing usable in storage reads as an empty playbook', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '{"v":1}', '{"slots":[]}']) {
    assert.deepEqual(parsePlaybook(raw), emptyPlaybook(), String(raw));
  }
});

test('a playbook from a version this build does not know is dropped', () => {
  const text = JSON.stringify({ v: PLAYBOOK_VERSION + 1, slots: [play('Sweep')] });
  assert.deepEqual(parsePlaybook(text), emptyPlaybook());
});

test('one corrupt play empties its slot and leaves the others alone', () => {
  const bad = play('Broken');
  bad.plans['o-qb'].throttle = 'fast';
  const text = JSON.stringify({
    v: PLAYBOOK_VERSION,
    slots: [play('Good'), bad, null, null, null],
  });
  const pb = parsePlaybook(text);
  assert.equal(pb[0].name, 'Good');
  assert.equal(pb[1], null);
  assert.equal(pb.length, PLAY_SLOTS);
});

test('a stored playbook longer than five slots is cut to five', () => {
  const slots = Array.from({ length: 9 }, (_, i) => play(`P${i}`));
  const pb = parsePlaybook(JSON.stringify({ v: PLAYBOOK_VERSION, slots }));
  assert.equal(pb.length, PLAY_SLOTS);
  assert.equal(pb[4].name, 'P4');
});
