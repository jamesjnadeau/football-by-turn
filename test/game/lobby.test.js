import test from 'node:test';
import assert from 'node:assert/strict';
import { lobbyMarkup, matchOverMarkup, matchOverResult, lobbyUnavailableMarkup } from '../../lib/game/lobby.js';

const variant = { id: '7', label: 'Seven-a-side' };

test('the lobby screen names the game, the side queued for, and both queue depths', () => {
  const markup = lobbyMarkup({ variant, side: 'offense', offenseDepth: 3, defenseDepth: 0 });
  assert.match(markup, /Seven-a-side/);
  assert.match(markup, /Waiting to play offense/);
  assert.match(markup, /3 waiting for offense/);
  assert.match(markup, /0 waiting for defense/);
});

test('the lobby screen carries a Switch button and a Back button', () => {
  const markup = lobbyMarkup({ variant, side: 'offense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(markup, /data-lobby-switch/);
  assert.match(markup, /data-lobby-back/);
});

test('the lobby screen says which side you would switch to', () => {
  const offense = lobbyMarkup({ variant, side: 'offense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(offense, /Queue for defense instead/);
  const defense = lobbyMarkup({ variant, side: 'defense', offenseDepth: 1, defenseDepth: 1 });
  assert.match(defense, /Queue for offense instead/);
});

test('a variant label with markup characters is escaped', () => {
  const markup = lobbyMarkup({
    variant: { id: '7', label: '<b>hi</b>' }, side: 'offense', offenseDepth: 0, defenseDepth: 0,
  });
  assert.doesNotMatch(markup, /<b>/);
});

test('the end-of-match screen says the result and offers Play again and Back', () => {
  const markup = matchOverMarkup({ variant, side: 'defense', result: 'Turnover on downs — you win!' });
  assert.match(markup, /Seven-a-side/);
  assert.match(markup, /Turnover on downs — you win!/);
  assert.match(markup, /data-lobby-again/);
  assert.match(markup, /Queue for defense against a new opponent/);
  assert.match(markup, /data-lobby-back/);
  assert.doesNotMatch(matchOverMarkup({ variant, side: 'offense', result: '<b>x</b>' }), /<b>/);
});

test('matchOverResult uses the game\'s own words for a drive that ended, and its own for one that did not', () => {
  assert.equal(matchOverResult('down', 'TOUCHDOWN — you win!'), 'TOUCHDOWN — you win!');
  assert.match(matchOverResult('opponent-left', 'x'), /opponent left/);
  assert.match(matchOverResult('no-opponent', 'x'), /never arrived/);
});

test('a lobby that cannot be reached says so, names the fix, and offers Back', () => {
  const markup = lobbyUnavailableMarkup({ variant });
  assert.match(markup, /could not be reached/);
  assert.match(markup, /serve:worker/);
  assert.match(markup, /data-lobby-back/);
});
