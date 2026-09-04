import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAY_SLOTS, PLAYBOOK_VERSION, BOOK_SIDES, LIBRARY_VARIANTS, emptyPlaybook, emptyLibrary,
  firstEmptySlot, putPlay, bookFor, putBook, playbookSide, playbookHeading,
  serializeLibrary, parseLibrary,
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

test('a new library is an empty book for each side, for each variant', () => {
  const lib = emptyLibrary();
  assert.deepEqual(BOOK_SIDES, ['offense', 'defense']);
  assert.deepEqual(LIBRARY_VARIANTS, ['7', '11']);
  for (const id of LIBRARY_VARIANTS) {
    for (const side of BOOK_SIDES) assert.deepEqual(lib[id][side], emptyPlaybook());
  }
});

test('none of the four books in a fresh library are the same array', () => {
  const lib = emptyLibrary();
  const books = LIBRARY_VARIANTS.flatMap((id) => BOOK_SIDES.map((side) => lib[id][side]));
  assert.equal(new Set(books).size, books.length);
});

test('bookFor reads one side of one variant, and an unknown side is an empty book', () => {
  const lib = putBook(emptyLibrary(), '7', 'defense', putPlay(emptyPlaybook(), 0, play('Cover 2')));
  assert.equal(bookFor(lib, '7', 'defense')[0].name, 'Cover 2');
  assert.equal(bookFor(lib, '7', 'offense')[0], null);
  assert.deepEqual(bookFor(lib, '7', 'special-teams'), emptyPlaybook());
});

test('bookFor reads an unknown variant as an empty book, not a crash', () => {
  assert.deepEqual(bookFor(emptyLibrary(), '9', 'offense'), emptyPlaybook());
});

test('bookFor reads a library with no book for a known variant/side as an empty book, not undefined', () => {
  assert.deepEqual(bookFor({}, '7', 'offense'), emptyPlaybook());
});

test('a play saved in the 7-man library never turns up in the 11-man one', () => {
  const lib = putBook(emptyLibrary(), '7', 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  assert.equal(bookFor(lib, '7', 'offense')[0].name, 'Sweep');
  assert.equal(bookFor(lib, '11', 'offense')[0], null);
});

test('putBook copies rather than mutating, and leaves every other book alone', () => {
  const lib = emptyLibrary();
  const next = putBook(lib, '7', 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  assert.equal(lib['7'].offense[0], null);
  assert.equal(next['7'].offense[0].name, 'Sweep');
  assert.deepEqual(next['7'].defense, emptyPlaybook());
  assert.deepEqual(next['11'], emptyLibrary()['11']);
});

test('putBook ignores a side there is no book for', () => {
  const lib = emptyLibrary();
  assert.equal(putBook(lib, '7', 'kicking', emptyPlaybook()), lib);
});

test('putBook ignores a variant there is no library for', () => {
  const lib = emptyLibrary();
  assert.equal(putBook(lib, '9', 'offense', emptyPlaybook()), lib);
});

test('the book on screen is the side the coach is coaching', () => {
  assert.equal(playbookSide({ aiTeam: 'defense' }), 'offense');
  assert.equal(playbookSide({ aiTeam: 'offense' }), 'defense');
});

test('hot-seat reads the offense book', () => {
  assert.equal(playbookSide({ aiTeam: null }), 'offense');
});

test('the heading says which book is on screen', () => {
  assert.equal(playbookHeading({ aiTeam: 'defense' }), 'Plays — Offense');
  assert.equal(playbookHeading({ aiTeam: 'offense' }), 'Plays — Defense');
  assert.equal(playbookHeading({ aiTeam: null }), 'Plays — Offense');
});

test('a library round-trips through storage', () => {
  let lib = emptyLibrary();
  lib = putBook(lib, '7', 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  lib = putBook(lib, '7', 'defense', putPlay(emptyPlaybook(), 3, play('Cover 2')));
  lib = putBook(lib, '11', 'offense', putPlay(emptyPlaybook(), 1, play('I-Form Dive')));
  assert.deepEqual(parseLibrary(serializeLibrary(lib)), lib);
});

test('an offensive play never turns up in the defense book', () => {
  const lib = putBook(emptyLibrary(), '7', 'offense', putPlay(emptyPlaybook(), 0, play('Sweep')));
  const back = parseLibrary(serializeLibrary(lib));
  assert.equal(back['7'].offense[0].name, 'Sweep');
  assert.ok(back['7'].defense.every((slot) => slot === null));
});

test('the stored form carries a version, and today it is 4', () => {
  assert.equal(PLAYBOOK_VERSION, 4);
  assert.equal(JSON.parse(serializeLibrary(emptyLibrary())).v, PLAYBOOK_VERSION);
});

test('nothing usable in storage reads as an empty library', () => {
  for (const raw of [null, undefined, '', 'not json', '[]', '{"v":4}', '{"variants":{}}']) {
    assert.deepEqual(parseLibrary(raw), emptyLibrary(), String(raw));
  }
});

test('a library from a version this build does not know is dropped', () => {
  const text = JSON.stringify({
    v: PLAYBOOK_VERSION + 1,
    variants: { 7: { offense: [play('Sweep')], defense: [] } },
  });
  assert.deepEqual(parseLibrary(text), emptyLibrary());
});

test('a version-3 library — two books, no variant — loads as the 7-man library, because that is whose it was', () => {
  const old = JSON.stringify({
    v: 3,
    books: { offense: [play('Sweep')], defense: [play('Cover 2')] },
  });
  const lib = parseLibrary(old);
  assert.equal(lib['7'].offense[0].name, 'Sweep');
  assert.equal(lib['7'].defense[0].name, 'Cover 2');
  assert.ok(lib['11'].offense.every((slot) => slot === null));
  assert.ok(lib['11'].defense.every((slot) => slot === null));
});

test('a version-2 book loads as the 7-man offense book, because that is whose it was', () => {
  const old = JSON.stringify({ v: 2, slots: [play('Sweep'), null, null, null, null] });
  const lib = parseLibrary(old);
  assert.equal(lib['7'].offense[0].name, 'Sweep');
  assert.ok(lib['7'].defense.every((slot) => slot === null));
  assert.ok(lib['11'].offense.every((slot) => slot === null));
});

test('a version-1 book still loads, as 7-man offense plays with no formation in them', () => {
  const old = JSON.stringify({
    v: 1,
    slots: [{ name: 'Sweep', plans: {}, stances: {}, pass: null }, null, null, null, null],
  });
  const lib = parseLibrary(old);
  assert.equal(lib['7'].offense[0].name, 'Sweep');
  assert.deepEqual(lib['7'].offense[0].spots, {});
  assert.ok(lib['7'].defense.every((slot) => slot === null));
});

test('one corrupt play empties its slot and leaves the others alone', () => {
  const bad = play('Broken');
  bad.plans['o-qb'].throttle = 'fast';
  const text = JSON.stringify({
    v: PLAYBOOK_VERSION,
    variants: { 7: { offense: [play('Good'), bad, null, null, null], defense: [] } },
  });
  const lib = parseLibrary(text);
  assert.equal(lib['7'].offense[0].name, 'Good');
  assert.equal(lib['7'].offense[1], null);
  assert.equal(lib['7'].offense.length, PLAY_SLOTS);
});

test('a stored book longer than five slots is cut to five', () => {
  const slots = Array.from({ length: 9 }, (_, i) => play(`P${i}`));
  const lib = parseLibrary(JSON.stringify({
    v: PLAYBOOK_VERSION,
    variants: { 7: { offense: slots, defense: slots } },
  }));
  assert.equal(lib['7'].offense.length, PLAY_SLOTS);
  assert.equal(lib['7'].offense[4].name, 'P4');
  assert.equal(lib['7'].defense.length, PLAY_SLOTS);
});

test('a book stored as something other than an array reads as empty slots, and leaves the other book alone', () => {
  const lib = parseLibrary(JSON.stringify({
    v: PLAYBOOK_VERSION,
    variants: { 7: { offense: [play('Sweep')], defense: 'Sweep' } },
  }));
  assert.equal(lib['7'].offense[0].name, 'Sweep');
  assert.ok(lib['7'].defense.every((slot) => slot === null));
});

test('a library missing a variant reads that variant as empty, and leaves the other alone', () => {
  const lib = parseLibrary(JSON.stringify({
    v: PLAYBOOK_VERSION,
    variants: { 7: { offense: [play('Sweep')], defense: [] } },
  }));
  assert.equal(lib['7'].offense[0].name, 'Sweep');
  assert.ok(lib['11'].offense.every((slot) => slot === null));
  assert.ok(lib['11'].defense.every((slot) => slot === null));
});
