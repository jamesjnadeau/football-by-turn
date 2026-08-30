import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, facingAngle, arrowMark, STYLE_GAME,
} from '../../lib/game/render.js';
import { createGame, setPlan, setMode, getPlayer } from '../../lib/game/state.js';
import { TEAM_SIZE, MAX_ARROW_UNITS, DEBUG_VELOCITY_SECONDS } from '../../lib/game/constants.js';
import { tackleReach } from '../../lib/game/modes.js';
import { num } from '../../lib/field/geometry.js';

test('the board shell has the field and four empty game layers', () => {
  const { viewBox, markup } = renderBoardShell(0);
  assert.match(viewBox, /^0 0 270 /);
  for (const id of ['game-field', 'game-arrows', 'game-preview', 'game-players', 'game-overlay']) {
    assert.ok(markup.includes(`id="${id}"`), id);
  }
  assert.ok(markup.includes(STYLE_GAME));
});

test('every player renders as a positioned group with a team-classed circle of its own radius', () => {
  const s = createGame({ seed: 1 });
  const svg = renderPlayers(s);
  assert.equal((svg.match(/data-id="/g) || []).length, TEAM_SIZE * 2);
  assert.ok(svg.includes('data-id="o-rb"'));
  assert.ok(svg.includes('class="gp-o"'));
  assert.ok(svg.includes('class="gp-d"'));
  assert.ok(svg.includes('r="2.5"'), 'skill radius');
  assert.ok(svg.includes('r="3.5"'), 'line radius');
  assert.ok(/translate\(/.test(svg), 'groups are placed by transform');
});

test('the carrier shows the football; tucking moves it inside the circle', () => {
  const s = createGame({ seed: 1 });
  const untucked = renderPlayers(s);
  assert.equal((untucked.match(/class="fb"/g) || []).length, 1, 'exactly one ball');
  const qb = getPlayer(s, 'o-qb');
  // untucked: the ball sits at the leading edge, outside-ish
  assert.ok(untucked.includes(`data-id="o-qb"`));
  setMode(s, 'o-qb', 'tucked');
  const tucked = renderPlayers(s);
  // tucked: the ball ellipse is drawn at the group origin (inside the circle)
  assert.ok(tucked.includes('<ellipse cx="0" cy="0"'), 'tucked ball centred in the player');
});

test('prepared and holding players get the quarter-circle stance arc', () => {
  const s = createGame({ seed: 1 });
  assert.ok(!renderPlayers(s).includes('class="stance"'));
  setMode(s, 'd-lb', 'prepared');
  setMode(s, 'o-c', 'holding');
  const svg = renderPlayers(s);
  assert.equal((svg.match(/class="stance"/g) || []).length, 2);
});

test('arrows render only for planned players, scaled by throttle', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderArrows(s), '');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const full = renderArrows(s);
  assert.ok(full.includes('marker-end="url(#ar-g)"'));
  const rb = getPlayer(s, 'o-rb');
  assert.ok(full.includes(`${rb.pos.y + MAX_ARROW_UNITS}`), 'full throttle = full length');
});

test('a loose ball renders on its own; a carried one does not', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderLooseBall(s), '');
  s.ball = { carrierId: null, pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 } };
  assert.ok(renderLooseBall(s).includes('class="fb"'));
});

test('facing: momentum first, then the plan arrow, then a team default', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  assert.equal(facingAngle(rb), Math.PI / 2); // offense default: downfield (+y)
  setPlan(s, 'o-rb', { x: 0, y: -1 }, 1);
  assert.equal(facingAngle(rb), -Math.PI / 2, 'no momentum yet: the arrow');
  // A body cannot pivot instantly, so once he actually has velocity that wins
  // over whatever arrow is currently drawn — the football points where he's
  // really going, not where he's aimed.
  rb.vel = { x: 1, y: 0 };
  assert.equal(facingAngle(rb), 0, 'momentum overrides the arrow');
  const lb = getPlayer(s, 'd-lb');
  assert.equal(facingAngle(lb), -Math.PI / 2); // defense default: upfield (-y)
});

test('the computer\'s arrows are never drawn', () => {
  const s = createGame({ seed: 1, ai: 'defense' });
  setPlan(s, 'd-lb', { x: 0, y: -1 }, 1); // as if one had leaked into a planning phase
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderArrows(s);
  assert.ok(!svg.includes('data-for="d-lb"'), 'the defense keeps its plans to itself');
  assert.ok(svg.includes('data-for="o-rb"'), 'the human still sees his own');
});

test('the stance arc holds the axis the defender locked, not the arrow he draws next', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'd-lb', { x: 1, y: 0 }, 1);
  setMode(s, 'd-lb', 'prepared'); // locks facing due east
  const committed = renderPlayers(s);
  setPlan(s, 'd-lb', { x: -1, y: 0 }, 1); // wave the arrow the other way
  assert.equal(renderPlayers(s), committed, 'the drawn wedge does not follow the new arrow');
});

test('the stance arc is drawn at the reach it actually tackles from', () => {
  const s = createGame({ seed: 1 });
  const lb = getPlayer(s, 'd-lb');
  setMode(s, 'd-lb', 'prepared');
  const ahead = { x: lb.facing.x, y: lb.facing.y };
  const r = tackleReach(lb, ahead) + 1;
  const arc = renderPlayers(s).match(/class="stance" d="M [-\d.]+ [-\d.]+ A ([-\d.]+)/);
  assert.ok(arc, 'a stance arc is drawn');
  assert.equal(Number(arc[1]), Number(num(r)), 'its radius is the wedge reach, not the plain stance reach');
});

test('plan arrows are green, half-weight, and carry the game arrowhead', () => {
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderArrows(s);
  assert.ok(svg.includes('class="plan-mv"'), 'the game arrow class, not the shared .mv');
  assert.ok(svg.includes('marker-end="url(#ar-g)"'));
  assert.ok(!svg.includes('url(#ar)"'), 'not the shared black arrowhead');
  // Half of the shared .mv weight (1.7), which halves the arrowhead with it:
  // markers default to markerUnits="strokeWidth".
  assert.ok(STYLE_GAME.includes('.plan-mv{stroke:#1a7f37;stroke-width:.85;'), 'green at half weight');
  assert.ok(STYLE_GAME.includes('.arh-g{fill:#1a7f37}'), 'the arrowhead is green too');
});

test('the committed arrow and the live drag preview carry the same opacity', () => {
  // app/main.js's drag preview writes a bare arrowMark() into `game-preview`
  // with no `.plan-arrow` wrapper <g>, so the opacity has to live on the path
  // class itself (`.plan-mv`) for the dragged and committed arrows to match.
  const s = createGame({ seed: 1 });
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const rb = getPlayer(s, 'o-rb');
  const committed = renderArrows(s);
  const tip = { x: rb.pos.x, y: rb.pos.y + MAX_ARROW_UNITS };
  const preview = arrowMark(rb.pos, tip); // the same call app/main.js's drag handler makes
  assert.ok(committed.includes('class="plan-mv"'));
  assert.ok(preview.includes('class="plan-mv"'), 'the unwrapped preview still carries the styled class');
  assert.ok(
    STYLE_GAME.includes('.plan-mv{stroke:#1a7f37;stroke-width:.85;fill:none;stroke-dasharray:.1 2.2;stroke-linecap:round;opacity:.85}'),
    'opacity travels with the path itself, not a wrapper <g>',
  );
  assert.ok(!STYLE_GAME.includes('.plan-arrow{'), 'the wrapper rule is gone now that it would be empty');
});

test('the board shell defines the game arrowhead at full marker width', () => {
  const { markup } = renderBoardShell(0);
  assert.match(markup, /<marker id="ar-g"[^>]*markerWidth="5"/, 'the head halves via stroke-width, not markerWidth');
});

test('arrowMark draws a rounded path between two points', () => {
  assert.equal(
    arrowMark({ x: 1, y: 2 }, { x: 3.456, y: 4 }),
    '<path d="M 1 2 L 3.46 4" class="plan-mv" marker-end="url(#ar-g)"/>',
  );
});

test('arrows and the drag preview are painted beneath the players', () => {
  const { markup } = renderBoardShell(0);
  const at = (id) => markup.indexOf(`id="${id}"`);
  assert.ok(at('game-preview') > -1, 'the preview has a layer of its own');
  assert.ok(at('game-arrows') < at('game-players'), 'committed arrows under the players');
  assert.ok(at('game-preview') < at('game-players'), 'the live preview under them too');
  assert.ok(at('game-players') < at('game-overlay'), 'the overlay stays on top for the loose ball');
});

test('velocity lines are off by default and drawn from the player centre when on', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-rb').vel = { x: 0, y: 20 };
  assert.ok(!renderPlayers(s).includes('class="vel"'), 'off unless asked for');
  const svg = renderPlayers(s, { showVelocity: true });
  assert.equal((svg.match(/class="vel"/g) || []).length, 1, 'only the player who is moving gets one');
  assert.ok(svg.includes('<line x1="0" y1="0"'), 'from the centre of the player group');
});

// Scopes a regex to o-rb's own <g> so these tests don't depend on the
// invariant (established elsewhere) that o-rb is the only moving player.
const rbGroup = (svg) => svg.match(/data-id="o-rb"[\s\S]*?<\/g>/)[0];

test('the velocity line pokes past the player edge in proportion to speed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb'); // radius 2.5
  const drawnX = () => Number(
    rbGroup(renderPlayers(s, { showVelocity: true })).match(/<line x1="0" y1="0" x2="([-\d.]+)"/)[1],
  );
  rb.vel = { x: 40, y: 0 };
  assert.equal(drawnX(), rb.radius + 40 * DEBUG_VELOCITY_SECONDS, '2.5 of body + 10 of speed');
  rb.vel = { x: 80, y: 0 };
  assert.equal(drawnX(), rb.radius + 80 * DEBUG_VELOCITY_SECONDS, 'twice the speed, twice the overhang');
});

test('the velocity line points along the velocity, not along the plan', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: -40 }; // drifting back upfield
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1); // told to go the other way
  const line = rbGroup(renderPlayers(s, { showVelocity: true }))
    .match(/<line x1="0" y1="0" x2="([-\d.]+)" y2="([-\d.]+)"/);
  assert.equal(Number(line[1]), 0);
  assert.equal(Number(line[2]), -(rb.radius + 40 * DEBUG_VELOCITY_SECONDS));
});

test('the velocity line is a thin blue hairline', () => {
  assert.ok(STYLE_GAME.includes('.vel{stroke:#1668dc;stroke-width:.4;'));
});
