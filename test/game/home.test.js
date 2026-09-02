import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeMarkup, COMING_SOON, SIDES, sideMarkup, sidesFor, homeAction } from '../../lib/game/home.js';
import { VARIANTS, getVariant } from '../../lib/game/variants.js';

test('the screen names the game and offers one button per variant', () => {
  const html = homeMarkup();
  assert.ok(html.includes('Football By Turn'), 'the game is named');
  assert.equal((html.match(/class="home-choice"/g) || []).length, VARIANTS.length);
  for (const v of VARIANTS) {
    assert.ok(html.includes(`data-variant="${v.id}"`), `a button for ${v.id}`);
    assert.ok(html.includes(v.label), `the label for ${v.id}`);
  }
});

test('the playable variant presses; the one that is not is disabled and says so', () => {
  const html = homeMarkup([
    { id: 'a', label: 'Ready', note: 'now', teamSize: 7, available: true },
    { id: 'b', label: 'Later', note: 'not now', teamSize: 11, available: false },
  ]);
  assert.match(html, /data-variant="a"(?![^>]*disabled)/, 'the playable one is pressable');
  assert.match(html, /data-variant="b"[^>]*disabled/, 'the other one is not');
  assert.ok(html.includes(`Later — ${COMING_SOON}`), 'and says why');
  assert.ok(!html.includes(`Ready — ${COMING_SOON}`), 'which the playable one does not');
});

test('text with markup in it is escaped rather than written through', () => {
  const html = homeMarkup([
    { id: 'x', label: '<b>7</b>', note: 'a "note" & more', teamSize: 7, available: true },
  ]);
  assert.ok(!html.includes('<b>'), 'no tag survives');
  assert.ok(html.includes('&lt;b&gt;7&lt;/b&gt;'));
  assert.ok(html.includes('&quot;note&quot; &amp; more'));
});

test('the side screen offers offense, defense, training, and the way back', () => {
  const html = sideMarkup(getVariant('7'));
  assert.ok(html.includes('7 Player'), 'names the picked game');
  assert.ok(html.includes('data-side="offense"'), 'an offense button');
  assert.ok(html.includes('data-side="defense"'), 'a defense button');
  assert.ok(html.includes('data-side="training"'), 'a training-mode button');
  assert.ok(html.includes('data-home-back'), 'a way back to the game list');
  assert.ok(html.includes('Training Mode'), 'the current mode keeps its name');
  for (const s of SIDES) {
    assert.ok(html.includes(s.label), `the label for ${s.id}`);
    assert.ok(html.includes(s.note), `the note for ${s.id}`);
  }
});

test('the side buttons reuse the home-choice styling', () => {
  const html = sideMarkup(getVariant('11'));
  // Four choices plus Back, all styled like the buttons on the first screen.
  assert.equal((html.match(/class="home-choice"/g) || []).length, 5);
});

test('side-screen text is escaped like every other home string', () => {
  const html = sideMarkup({ id: 'x', label: '<b>7</b>' }, [
    { id: 'offense', label: 'a "label" & more', note: '<i>note</i>' },
  ]);
  assert.ok(!html.includes('<b>'), 'no tag survives');
  assert.ok(html.includes('&lt;b&gt;7&lt;/b&gt;'));
  assert.ok(html.includes('&quot;label&quot; &amp; more'));
  assert.ok(html.includes('&lt;i&gt;note&lt;/i&gt;'));
});

test('the how-to-play button sits below the games, and is pressable', () => {
  const m = homeMarkup();
  assert.ok(m.includes('data-tutorial'));
  assert.ok(m.includes('How to play'));
  assert.ok(m.indexOf('data-variant="11"') < m.indexOf('data-tutorial'),
    'under the game chooser, as the last thing on the screen');
});

test('a coach who has been through it is told so, rather than nagged', () => {
  const fresh = homeMarkup(undefined, { tutorialDone: false });
  const done = homeMarkup(undefined, { tutorialDone: true });
  assert.notEqual(fresh, done);
  assert.match(done, /again/i, 'it is an invitation, not a badge');
});

test('the tutorial is not a variant: it cannot be listed or started as one', () => {
  assert.ok(!homeMarkup().includes('data-variant="tutorial"'));
});

test('the side chooser offers multiplayer, a live drive against another coach', () => {
  const ids = SIDES.map((s) => s.id);
  assert.deepEqual(ids, ['offense', 'defense', 'training', 'multiplayer']);
  const markup = sideMarkup({ id: '7', label: 'Seven-a-side' });
  assert.match(markup, /data-side="multiplayer"/);
  assert.match(markup, /Multiplayer/);
  assert.match(markup, /Play a live drive against another coach\./);
});

test('sidesFor drops multiplayer when the build has no server behind it', () => {
  // The GitHub Pages mirror is the whole reason this exists: it publishes the
  // same files with no Worker underneath, so offering a lobby there would open
  // a socket to an origin that cannot answer it.
  const ids = sidesFor({ multiplayer: false }).map((s) => s.id);
  assert.deepEqual(ids, ['offense', 'defense', 'training']);
  assert.doesNotMatch(sideMarkup(getVariant('7'), sidesFor({ multiplayer: false })),
    /data-side="multiplayer"/);
});

test('sidesFor is every side when the build has a Worker behind it', () => {
  assert.deepEqual(sidesFor({ multiplayer: true }), SIDES);
});

test('sidesFor offers multiplayer when asked nothing at all', () => {
  // The default is the full game: a plain `npm run serve` and `wrangler dev`
  // both want the lobby, and only the Pages build asks for it to be dropped.
  assert.deepEqual(sidesFor().map((s) => s.id).at(-1), 'multiplayer');
});

test('a press is read as the one thing it is', () => {
  assert.deepEqual(homeAction({ tutorial: true }), { kind: 'tutorial' });
  assert.deepEqual(homeAction({ back: true }), { kind: 'back' });
  assert.deepEqual(homeAction({ side: 'defense' }), { kind: 'side', side: 'defense' });
  assert.deepEqual(homeAction({ variant: '7' }), { kind: 'variant', variant: '7' });
  assert.equal(homeAction({}), null);
});

test('a side press is nothing at all when the home screen no longer owns the section', () => {
  // The multiplayer lobby draws its own side chooser into the same section,
  // out of the same sideMarkup, so its buttons carry the same data-side. The
  // home screen's listener is still attached to that section -- so without
  // this, one press both entered the lobby AND started a single-player game
  // against the computer, and whichever startGame landed last is the one the
  // coach ended up looking at.
  assert.equal(homeAction({ side: 'defense' }, { owns: false }), null);
  assert.equal(homeAction({ variant: '7' }, { owns: false }), null);
});
