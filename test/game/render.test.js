import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBoardShell, renderPlayers, renderPlans, destinationMark, renderLooseBall, renderPassArrow,
  facingAngle, arrowMark, STYLE_GAME, menuButtonMark, wrapWords, renderMessage,
  coverMark, coverHaloMark, lineZoneMark, renderFieldButtons, lineToGainMark, passLockMark,
  liveLobMark, fieldButtonAnchor, cameraViewBox,
} from '../../lib/game/render.js';
import { createGame, setPlan, setMode, getPlayer, setPass } from '../../lib/game/state.js';
import { setCover } from '../../lib/game/cover.js';
import {
  MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS, DEBUG_VELOCITY_SECONDS,
  DEBUG_VELOCITY_TRIANGLE_SCALE, COVER_HALO_UNITS, ON_LINE_YARDS,
  CUT_BLOCK_DRIVE_REACH,
} from '../../lib/game/constants.js';
import { teamSize } from '../../lib/game/rosters.js';
import { tackleReach } from '../../lib/game/modes.js';
import { num, UNITS_PER_YARD_X } from '../../lib/field/geometry.js';
import { fieldPos, gameView, GOAL_YARD } from '../../lib/game/view.js';
import { passLanding } from '../../lib/game/pass.js';
import { lobPoint } from '../../lib/game/lob.js';

test('the board shell has the field and every game layer', () => {
  const { viewBox, markup } = renderBoardShell(20, 30);
  assert.match(viewBox, /^0 56\.25 280 170$/);
  for (const id of ['game-field', 'game-arrows', 'game-preview', 'game-players', 'game-overlay', 'game-menu', 'game-buttons', 'game-message']) {
    assert.ok(markup.includes(`id="${id}"`), id);
  }
  assert.ok(markup.includes(STYLE_GAME));
});

test('the game crops wider than the field, to make room for the button columns', () => {
  const shell = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  assert.equal(shell, 280, 'the shell leaves room for two columns of plates');
  // animate() writes cameraViewBox on every frame; if the two disagree the
  // board would jump a few units wider or narrower at the snap.
  for (const cam of [20, 35, 80]) {
    const live = Number(cameraViewBox(20, cam).split(' ')[2]);
    assert.equal(live, shell, `cameraViewBox agrees at camera ${cam}`);
  }
});

test('a driving blocker draws his friction aura at radius + CUT_BLOCK_DRIVE_REACH', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-lg').mode = 'cutBlockDrive';
  const svg = renderPlayers(s);
  const group = svg.match(/data-id="o-lg"[\s\S]*?<\/g>/)[0];
  const match = group.match(/<circle cx="0" cy="0" r="([-\d.]+)" class="drive-aura"\/>/);
  assert.ok(match, 'aura drawn');
  const expected = getPlayer(s, 'o-lg').radius + CUT_BLOCK_DRIVE_REACH;
  assert.ok(Math.abs(Number(match[1]) - expected) < 1e-6);
});

test('an armed cut block draws the same ring, a turn before it drives', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-lg').mode = 'cutBlock';
  const group = renderPlayers(s).match(/data-id="o-lg"[\s\S]*?<\/g>/)[0];
  const match = group.match(/<circle cx="0" cy="0" r="([-\d.]+)" class="drive-aura"\/>/);
  assert.ok(match, 'the ring is the indicator that the move is enabled, so it is on now');
  const expected = getPlayer(s, 'o-lg').radius + CUT_BLOCK_DRIVE_REACH;
  assert.ok(Math.abs(Number(match[1]) - expected) < 1e-6, 'and at the radius that will grab');
});

test('nobody else draws the drive aura', () => {
  const s = createGame({ seed: 1 });
  assert.ok(!renderPlayers(s).includes('class="drive-aura"'));
});

test('a player receiving the cut-block assist is marked', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-rb').cutBlockAssist = true;
  assert.ok(renderPlayers(s).includes('class="cb-assist"'));
});

test('nobody else draws the assist mark', () => {
  const s = createGame({ seed: 1 });
  assert.ok(!renderPlayers(s).includes('class="cb-assist"'));
});

test('the scrimmage line draws dashed but unlabelled', () => {
  const { markup } = renderBoardShell(20, 30);
  assert.ok(markup.includes('class="rl"'), 'dashed scrimmage line survives');
  assert.ok(!markup.includes('LOS'), 'no LOS text prints over the yard numbers');
});

test('every player renders as a positioned group with a team-classed circle of its own radius', () => {
  const s = createGame({ seed: 1 });
  const svg = renderPlayers(s);
  assert.equal((svg.match(/data-id="/g) || []).length, teamSize(s) * 2);
  assert.ok(svg.includes('data-id="o-rb"'));
  assert.ok(svg.includes('class="gp-o"'));
  assert.ok(svg.includes('class="gp-d"'));
  assert.ok(svg.includes('r="2.5"'), 'skill radius');
  assert.ok(svg.includes('r="3.5"'), 'line radius');
  assert.ok(/translate\(/.test(svg), 'groups are placed by transform');
});

test('the carrier shows the football; tucking moves it inside the circle', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null }; // after the snap
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

test('a plan with no reachable target still renders as the old arrow', () => {
  const s = createGame({ seed: 1 });
  assert.equal(renderPlans(s), '');
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1);
  const svg = renderPlans(s);
  assert.equal((svg.match(/data-for="/g) || []).length, 1);
  assert.ok(svg.includes('class="plan-mv"'), 'the arrow, not a circle');
  assert.ok(!svg.includes('class="plan-dest"'));
  const rb = getPlayer(s, 'o-rb');
  assert.ok(svg.includes(`L ${num(rb.pos.x)} ${num(rb.pos.y + MAX_ARROW_UNITS)}`));
});

test('a plan that knows where it lands renders as a filled circle there', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  const target = { x: rb.pos.x, y: rb.pos.y + 6 };
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 0.7, target);
  const svg = renderPlans(s);
  assert.ok(svg.includes('class="plan-dest"'), 'the circle');
  assert.ok(!svg.includes('class="plan-mv"'), 'and no arrow');
  assert.ok(svg.includes(`cx="${num(target.x)}" cy="${num(target.y)}"`), 'at the landing spot');
  assert.ok(svg.includes(`r="${num(rb.radius)}"`), 'drawn at his own size');
});

test('a plan he cannot finish draws the direction AND where he does get to', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  const target = { x: rb.pos.x, y: rb.pos.y + 7.75 };
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1, target, true);
  const svg = renderPlans(s);
  assert.ok(svg.includes('class="plan-dest"'), 'the circle he reaches this turn');
  assert.ok(svg.includes(`cx="${num(target.x)}" cy="${num(target.y)}"`), 'at the landing spot');
  assert.ok(svg.includes('class="plan-mv"'), 'and the arrow, still headed on');
  assert.ok(svg.includes(`L ${num(rb.pos.x)} ${num(rb.pos.y + MAX_ARROW_UNITS)}`), 'at full length');
  assert.equal((svg.match(/data-for="/g) || []).length, 1, 'one plan, one group');
});

test('the destination circle is a bare mark, so the preview and the plan match', () => {
  assert.equal(
    destinationMark({ x: 10, y: 20 }, 2.5),
    '<circle cx="10" cy="20" r="2.5" class="plan-dest"/>',
  );
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
  const svg = renderPlans(s);
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
  const svg = renderPlans(s);
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
  const committed = renderPlans(s);
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
  const { markup } = renderBoardShell(20, 30);
  assert.match(markup, /<marker id="ar-g"[^>]*markerWidth="5"/, 'the head halves via stroke-width, not markerWidth');
});

test('arrowMark draws a rounded path between two points', () => {
  assert.equal(
    arrowMark({ x: 1, y: 2 }, { x: 3.456, y: 4 }),
    '<path d="M 1 2 L 3.46 4" class="plan-mv" marker-end="url(#ar-g)"/>',
  );
});

test('arrows and the drag preview are painted beneath the players', () => {
  const { markup } = renderBoardShell(20, 30);
  const at = (id) => markup.indexOf(`id="${id}"`);
  assert.ok(at('game-preview') > -1, 'the preview has a layer of its own');
  assert.ok(at('game-arrows') < at('game-players'), 'committed arrows under the players');
  assert.ok(at('game-preview') < at('game-players'), 'the live preview under them too');
  assert.ok(at('game-players') < at('game-overlay'), 'the overlay stays on top for the loose ball');
});

test('the velocity triangle is off by default and drawn as a three-point marker when on', () => {
  const s = createGame({ seed: 1 });
  getPlayer(s, 'o-rb').vel = { x: 0, y: 20 };
  assert.ok(!renderPlayers(s).includes('class="vel"'), 'off unless asked for');
  const svg = renderPlayers(s, { showVelocity: true });
  assert.equal((svg.match(/class="vel"/g) || []).length, 1, 'only the player who is moving gets one');
  const points = svg.match(/<polygon points="([^"]+)" class="vel"\/>/);
  assert.ok(points, 'the marker is a polygon');
  assert.equal(points[1].trim().split(/\s+/).length, 3, 'three points');
});

// Scopes a regex to o-rb's own <g> so these tests don't depend on the
// invariant (established elsewhere) that o-rb is the only moving player.
const rbGroup = (svg) => svg.match(/data-id="o-rb"[\s\S]*?<\/g>/)[0];

// The apex is emitted first, at angle theta = atan2(vel.y, vel.x) from the
// origin — the first "x,y" pair in the polygon's points list.
const apexOf = (svg) => rbGroup(svg).match(/<polygon points="([-\d.]+),([-\d.]+) /).slice(1, 3).map(Number);

// All three "x,y" pairs from o-rb's polygon, in emitted order.
const allPointsOf = (svg) => rbGroup(svg)
  .match(/<polygon points="([^"]+)" class="vel"\/>/)[1]
  .trim()
  .split(/\s+/)
  .map((pair) => pair.split(',').map(Number));

test('the velocity triangle grows past the player edge in proportion to speed', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb'); // radius 2.5
  rb.vel = { x: 40, y: 0 };
  const [x1] = apexOf(renderPlayers(s, { showVelocity: true }));
  assert.equal(
    x1,
    rb.radius + 40 * DEBUG_VELOCITY_SECONDS * DEBUG_VELOCITY_TRIANGLE_SCALE,
    'the rim (2.5) plus a height of 4.0 beyond it',
  );
  rb.vel = { x: 80, y: 0 };
  const [x2] = apexOf(renderPlayers(s, { showVelocity: true }));
  assert.equal(
    x2,
    rb.radius + 80 * DEBUG_VELOCITY_SECONDS * DEBUG_VELOCITY_TRIANGLE_SCALE,
    'twice the speed, twice the reach',
  );
  // The base sits at the fixed rim distance regardless of speed, so a
  // strictly-larger apex distance alone wouldn't prove the size tracks speed
  // proportionally — an implementation that barely nudged the height would
  // still pass that weaker check. Assert the HEIGHT beyond the rim itself
  // (apex distance minus the fixed radius) exactly doubles: 4.0 -> 8.0.
  assert.equal(2 * (x1 - rb.radius), x2 - rb.radius, 'doubling the speed exactly doubles the height beyond the rim');
});

test('the velocity triangle points along the velocity, not along the plan', () => {
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 0, y: -40 }; // drifting back upfield
  setPlan(s, 'o-rb', { x: 0, y: 1 }, 1); // told to go the other way
  const [apexX, apexY] = apexOf(renderPlayers(s, { showVelocity: true }));
  const EPS = 1e-9;
  assert.ok(Math.abs(apexX) < EPS, 'no sideways drift in the apex');
  assert.ok(
    Math.abs(apexY - -(rb.radius + 40 * DEBUG_VELOCITY_SECONDS * DEBUG_VELOCITY_TRIANGLE_SCALE)) < EPS,
    'apex reaches upfield, along the velocity',
  );
});

test("the velocity triangle's base sits on the player's own rim", () => {
  // The whole point of this change: a shape centred on the player is hidden
  // behind his own icon at ordinary speeds, so the base must sit out at
  // player.radius regardless of speed, with only the apex (checked above)
  // moving further out as he speeds up.
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb'); // radius 2.5
  rb.vel = { x: 40, y: 0 }; // heading is +x, so "along the heading" is just x
  const [, baseA, baseB] = allPointsOf(renderPlayers(s, { showVelocity: true }));
  const halfWidth = (40 * DEBUG_VELOCITY_SECONDS * DEBUG_VELOCITY_TRIANGLE_SCALE) / Math.sqrt(3);
  const EPS = 0.01; // num()'s rounding to 2 decimals is the only slop here
  for (const [x] of [baseA, baseB]) {
    assert.ok(Math.abs(x - rb.radius) < EPS, 'base vertex projects onto the heading at exactly player.radius');
  }
  const ys = [baseA[1], baseB[1]].sort((a, b) => a - b);
  assert.ok(Math.abs(ys[0] - -halfWidth) < EPS, 'one base corner at -h/√3');
  assert.ok(Math.abs(ys[1] - halfWidth) < EPS, 'the other at +h/√3');
});

test('the velocity triangle is equilateral: three equal sides', () => {
  // The apex-only checks above would still pass an implementation that
  // emitted the right apex but two wrong, non-triangular points behind it —
  // e.g. collinear, or bunched together. This test looks at the shape
  // itself: the three pairwise distances between the vertices are all
  // equal, which fails on collinear or wrongly-spaced points just as the
  // old circumradius check did. That old check compared every vertex's
  // distance from the local origin, which relied on the triangle being
  // centred on the origin; now that the base sits out at the rim instead of
  // the centre, the vertices are no longer equidistant from the origin, so
  // this compares the vertices to each other instead.
  const s = createGame({ seed: 1 });
  const rb = getPlayer(s, 'o-rb');
  rb.vel = { x: 30, y: 40 }; // an off-axis heading, so a lopsided triangle can't hide behind a round number
  const points = allPointsOf(renderPlayers(s, { showVelocity: true }));
  assert.equal(points.length, 3);
  const dist = ([x1, y1], [x2, y2]) => Math.hypot(x2 - x1, y2 - y1);
  const sides = [dist(points[0], points[1]), dist(points[1], points[2]), dist(points[2], points[0])];
  // num() rounds each coordinate to 2 decimals, moving it by up to 0.005; a
  // side length is the distance between two such rounded points, so in the
  // worst case (the two points' errors pointing opposite ways) it can shift
  // by up to 2 * sqrt(2) * 0.005 ~= 0.0141. EPS sits just above that bound
  // so it absorbs only the rounding, not the geometry.
  const EPS = 0.02;
  for (const side of sides) assert.ok(Math.abs(side - sides[0]) < EPS, 'all three sides are the same length');
});

test('the velocity triangle is filled in the same blue the line used to be', () => {
  assert.ok(STYLE_GAME.includes('.vel{fill:#1668dc'));
});

test('a moving carrier draws his football on top of his own velocity triangle', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  getPlayer(s, 'o-rb').vel = { x: 40, y: 0 };
  const group = rbGroup(renderPlayers(s, { showVelocity: true }));
  const velIndex = group.indexOf('class="vel"');
  const fbIndex = group.indexOf('class="fb"');
  assert.ok(velIndex > -1, 'the velocity triangle is drawn');
  assert.ok(fbIndex > -1, 'the football is drawn');
  assert.ok(fbIndex > velIndex, 'the ball is emitted after the triangle, so it paints over it');
});

test('the planned throw draws its own arrow, distinct from a run arrow', () => {
  const s = createGame({ seed: 1 });
  // The snap is drawn like any other throw, so clear it to get an empty board
  // and hand the quarterback the ball, which is the throw this is about.
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  assert.equal(renderPassArrow(s), '', 'nothing planned, nothing drawn');
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('data-pass="o-qb"'));
  assert.ok(svg.includes('class="pass"'), 'its own class, not the run arrow\'s');
  assert.ok(!svg.includes('class="plan-mv"'), 'not the run arrow\'s class');
  assert.ok(svg.includes('marker-end="url(#ar-r)"'), 'its own red arrowhead');
  const qb = getPlayer(s, 'o-qb');
  assert.ok(svg.includes(`${qb.pos.y + MAX_PASS_ARROW_UNITS}`), 'full power = full length');
});

test('no throw arrow once the man who planned it no longer has the ball', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  assert.equal(renderPassArrow(s), '');
});

test('the throw arc style is registered in the game stylesheet', () => {
  const { markup } = renderBoardShell(20, 30);
  assert.ok(markup.includes('.pass{'), 'the pass arrow has a style rule');
});

test('the menu is a clipboard button, not a legend spelled down the sideline', () => {
  const { markup } = renderBoardShell(20, 30);
  assert.ok(!markup.includes('COACHES MENU'), 'the words are gone from the field');
  assert.ok(!markup.includes('class="pb"'), 'and so is the legend that carried them');
  assert.ok(markup.includes('id="game-menu"'), 'the button still gets a layer of its own');
  assert.ok(markup.includes('data-menu-button'), 'built into the shell, not repainted');
  assert.ok(menuButtonMark(20).includes('\u{1F4CB}'), 'a clipboard says it instead');
  assert.ok(menuButtonMark(20).includes('class="fbtn-plate"'), 'and wears the same plate as its neighbours');
});

test('the menu button holds the middle of the column, inside the frame', () => {
  const { viewBox } = renderBoardShell(20, 30);
  const [minX, minY, w, h] = viewBox.split(' ').map(Number);
  const menu = rectBox(menuButtonMark(20));
  const others = renderFieldButtons(createGame({ seed: 1 }));
  const shuffle = rectBox(buttonGroup(others, 'data-reposition-button'));
  const autoplan = rectBox(buttonGroup(others, 'data-autoplan-button'));
  const run = rectBox(buttonGroup(others, 'data-run-button'));
  const midY = minY + h / 2;

  assert.equal(menu.x, shuffle.x, 'all four share one column');
  assert.equal(menu.x, autoplan.x);
  assert.equal(menu.x, run.x);
  assert.ok(menu.x + menu.w <= minX + w, 'inside the viewBox width');
  assert.ok(menu.y > minY && menu.y + menu.h <= minY + h, 'inside the viewBox height');
  assert.ok(menu.y < midY && menu.y + menu.h > midY, 'straddles the middle of the current window');
  // Evenly stacked, and never overlapping — four separate presses: shuffle,
  // menu, autoplan, run.
  const gap1 = menu.y - (shuffle.y + shuffle.h);
  const gap2 = autoplan.y - (menu.y + menu.h);
  const gap3 = run.y - (autoplan.y + autoplan.h);
  assert.equal(gap1, gap2, 'even gaps');
  assert.equal(gap2, gap3, 'even gaps');
  assert.ok(gap1 > 0, 'and real ones');
});

test('the menu button is reachable and labelled without a pointer', () => {
  // A closed <dialog> is out of the tab order, so this plate is the only
  // focusable element until the menu is open — it has to carry its own
  // keyboard affordances rather than relying on the controls inside. The icon
  // carries no text, so the aria-label is the only thing that names it.
  const mark = menuButtonMark(20);
  assert.ok(mark.includes('tabindex="0"'), 'the plate is a keyboard stop');
  assert.ok(mark.includes('role="button"'), 'the plate reads as a button to assistive tech');
  assert.ok(mark.includes('aria-label="Open the Coaches Menu"'), 'the plate names itself');
});

test('wrapWords breaks greedily at the character budget', () => {
  assert.deepEqual(wrapWords('', 34), []);
  assert.deepEqual(wrapWords('   ', 34), []);
  assert.deepEqual(wrapWords('TOUCHDOWN!', 34), ['TOUCHDOWN!']);
  assert.deepEqual(
    wrapWords('Fumble recovered by the defense. Game over.', 34),
    ['Fumble recovered by the defense.', 'Game over.'],
  );
  // A word that cannot fit gets a line to itself rather than being broken.
  assert.deepEqual(wrapWords('a supercalifragilistic b', 8), ['a', 'supercalifragilistic', 'b']);
  // Runs of whitespace collapse.
  assert.deepEqual(wrapWords('a   b', 34), ['a b']);
});

test('an empty message draws nothing', () => {
  assert.equal(renderMessage('', 20), '');
  assert.equal(renderMessage('   ', 20), '');
});

test('a one-line message is a plate and a tspan pinned to the top of the board', () => {
  assert.equal(
    renderMessage('TOUCHDOWN!', 20),
    '<rect class="msg-plate" x="104" y="57.75" width="62" height="11.5" rx="2"/>' +
    '<text class="msg"><tspan x="135" y="64.88">TOUCHDOWN!</tspan></text>',
  );
});

test('a two-line message stacks tspans and grows the plate, staying pinned to the top', () => {
  const svg = renderMessage('Fumble recovered by the defense. Game over.', 20);
  assert.equal((svg.match(/<tspan /g) || []).length, 2);
  assert.ok(svg.includes('<tspan x="135" y="64.88">Fumble recovered by the defense.</tspan>'));
  assert.ok(svg.includes('<tspan x="135" y="70.38">Game over.</tspan>'));
  const view = gameView(20);
  const plate = svg.match(/y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const [py, pw, ph] = plate.slice(1).map(Number);
  assert.equal(py, view.windowTopY + 1.5, 'the plate sits at the top of the window');
  assert.ok(pw <= 200, 'and never runs wider than the sidelines');
});

test('a long message grows downward from the top but never off the board', () => {
  const view = gameView(20);
  const windowBottom = view.windowTopY + view.height;
  const flag = 'FLAG: forward pass from beyond the line. 5 yards from the previous spot, loss of down.';
  const svg = renderMessage(flag, 20);
  assert.equal((svg.match(/<tspan /g) || []).length, 3, 'three lines at this budget');
  const [py, ph] = svg.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.equal(py, view.windowTopY + 1.5, 'pinned to the top');
  assert.ok(py + ph <= windowBottom, 'and still on the board at the bottom');
  // 40 short words wrap to six lines at this budget, which is still short
  // enough at the halved line height to stay inside the window.
  const huge = renderMessage(new Array(40).fill('word').join(' '), 20);
  const [hy, hh] = huge.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.ok(hy >= view.windowTopY && hy + hh <= windowBottom, 'still inside the viewBox');
});

test('message text is escaped', () => {
  assert.ok(renderMessage("QB can't do that.", 20).includes('can&#39;t'));
  assert.ok(renderMessage('A & B', 20).includes('A &amp; B'));
});

test('the message layer is the topmost layer on the board', () => {
  const { markup } = renderBoardShell(20, 30);
  const at = (id) => markup.indexOf(`id="${id}"`);
  assert.ok(at('game-message') > -1, 'the message has a layer of its own');
  assert.ok(at('game-message') > at('game-overlay'), 'above the loose-ball overlay');
  assert.ok(at('game-message') > at('game-menu'), 'and above the menu button');
  // Both message rules must be click-through — the plate covers the end zone.
  // Checked per-rule on purpose: `pointer-events:none` is already in STYLE_GAME
  // for .gp-role and .vel, so a bare substring check would pass without them.
  const msgRules = STYLE_GAME.split('}').filter((r) => r.startsWith('.msg'));
  assert.equal(msgRules.length, 2, '.msg-plate and .msg');
  for (const rule of msgRules) assert.ok(rule.includes('pointer-events:none'), rule);
});

test('a cover order draws a halo under the covered man and a dotted line to him', () => {
  const s = createGame({ seed: 1 });
  setCover(s, 'o-c', 'd-nt');
  const svg = renderPlans(s);
  const nt = getPlayer(s, 'd-nt');
  assert.ok(svg.includes('class="cover-halo"'), 'the halo');
  assert.ok(svg.includes('class="plan-mv"'), 'the same dotted green line as a plan arrow');
  assert.ok(!svg.includes('class="plan-dest"'), 'and no destination circle');
  assert.ok(svg.includes(`cx="${num(nt.pos.x)}" cy="${num(nt.pos.y)}"`), 'centred on him');
  assert.ok(svg.includes(`data-for="o-c"`), 'attributed to the blocker, not the target');
});

test('the halo is a little wider than the man it sits under', () => {
  const s = createGame({ seed: 1 });
  const nt = getPlayer(s, 'd-nt');
  const halo = coverHaloMark(nt);
  assert.ok(halo.includes(`r="${num(nt.radius + COVER_HALO_UNITS)}"`));
  assert.ok(COVER_HALO_UNITS > 0 && COVER_HALO_UNITS < nt.radius, 'a rim, not a target ring');
});

test('the cover line stops at the covered man\'s edge, not his centre', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const nt = getPlayer(s, 'd-nt');
  c.pos = { x: 135, y: 100 };
  nt.pos = { x: 135, y: 130 };
  const mark = coverMark(c, nt);
  assert.ok(mark.includes(`L ${num(135)} ${num(130 - nt.radius)}`), mark);
});

test('the halo is drawn before the line, so the line reads on top of it', () => {
  const s = createGame({ seed: 1 });
  const mark = coverMark(getPlayer(s, 'o-c'), getPlayer(s, 'd-nt'));
  assert.ok(mark.indexOf('cover-halo') < mark.indexOf('plan-mv'));
});

test('the line-zone band covers exactly the yard a man has to be inside to be on the line', () => {
  const s = createGame({ seed: 1 });
  const markup = lineZoneMark(s);
  const y = Number(markup.match(/y="([-\d.]+)"/)[1]);
  const height = Number(markup.match(/height="([-\d.]+)"/)[1]);
  const losY = fieldPos(0, s.losYard).y;
  // The offense lines up behind the ball, so the band runs a yard back from
  // the line — the same yard onTheLine tests against.
  assert.equal(height, ON_LINE_YARDS * UNITS_PER_YARD_X);
  assert.equal(y + height, losY);
  assert.ok(markup.includes('line-zone'), 'carries its own class');
});

test('the line-zone band follows the line of scrimmage down the field', () => {
  const s = createGame({ seed: 1 });
  s.losYard = 5;
  const y = Number(lineZoneMark(s).match(/y="([-\d.]+)"/)[1]);
  assert.equal(y + ON_LINE_YARDS * UNITS_PER_YARD_X, fieldPos(0, 5).y);
});

test('the line to gain is drawn at the sticks and omitted once they reach the goal', () => {
  const view = gameView(50);
  assert.match(lineToGainMark(view, 60), /class="ftg"/);
  assert.equal(lineToGainMark(view, GOAL_YARD), '');
});

test('renderBoardShell\'s viewBox scrolls with losYard instead of always starting at 0', () => {
  const near = renderBoardShell(20, 30).viewBox;
  const far = renderBoardShell(80, 90).viewBox;
  assert.notEqual(near, far);
});


/**
 * The x/y/width/height of the one rect in a mark, as numbers. The leading
 * space matters: a bare /x="/ matches inside `tabindex="0"` too.
 */
function rectBox(markup) {
  const at = (name) => Number(new RegExp(`\\s${name}="([-\\d.]+)"`).exec(markup)[1]);
  return { x: at('x'), y: at('y'), w: at('width'), h: at('height') };
}

/** Just the one <g> whose plate carries this data attribute. */
function buttonGroup(markup, attr) {
  for (const g of markup.split('<g ').slice(1)) {
    if (g.includes(attr)) return `<g ${g}`;
  }
  return null;
}

test('the board carries both quick-press buttons before the snap', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }));
  assert.ok(markup.includes('data-reposition-button'), 'the shuffle is offered');
  assert.ok(markup.includes('data-run-button'), 'the run button is offered');
  assert.ok(markup.includes('\u{1F500}'), 'shuffle icon');
  assert.ok(markup.includes('\u{23E9}'), 'run icon');
});

test('the shuffle button goes away once the play has started, but Run stays put', () => {
  const s = createGame({ seed: 1 });
  const before = rectBox(buttonGroup(renderFieldButtons(s), 'data-run-button'));

  s.turnIndex = 1; // the play is under way, so canReposition() is shut
  const running = renderFieldButtons(s);
  assert.ok(!running.includes('data-reposition-button'), 'nobody repositions mid-play');
  assert.ok(running.includes('data-run-button'), 'the turn can still be run');
  assert.deepEqual(rectBox(buttonGroup(running, 'data-run-button')), before,
    'Run does not move up into the space the shuffle left');
});

test('the run button greys rather than vanishing when there is no turn to run', () => {
  const s = createGame({ seed: 1 });
  assert.ok(!buttonGroup(renderFieldButtons(s), 'data-run-button').includes('fbtn-off'));

  s.phase = 'playOver';
  const dead = buttonGroup(renderFieldButtons(s), 'data-run-button');
  assert.ok(dead.includes('fbtn-off'), 'greyed');
  assert.ok(dead.includes('aria-disabled="true"'), 'and says so to a screen reader');

  const drawing = buttonGroup(
    renderFieldButtons(createGame({ seed: 1 }), { animating: true }), 'data-run-button',
  );
  assert.ok(drawing.includes('fbtn-off'), 'dead while the turn is drawn, like every other control');
});

test('the shuffle button shows which way it is set', () => {
  const s = createGame({ seed: 1 });
  const off = buttonGroup(renderFieldButtons(s, { repositioning: false }), 'data-reposition-button');
  assert.ok(off.includes('aria-pressed="false"'));
  assert.ok(!off.includes('fbtn-on'));

  const on = buttonGroup(renderFieldButtons(s, { repositioning: true }), 'data-reposition-button');
  assert.ok(on.includes('aria-pressed="true"'));
  assert.ok(on.includes('fbtn-on'), 'the plate fills in');
});

test('all six quick-press buttons are reachable by keyboard, like the menu rect', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }));
  assert.equal(markup.match(/tabindex="0"/g).length, 6);
  assert.equal(markup.match(/role="button"/g).length, 6);
  assert.equal(markup.match(/aria-label="/g).length, 6);
});

test('the first column carries the three controls that used to be menu-only', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }));
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(markup.includes(attr), `${attr} is on the board`);
  }
});

test('the new controls stack in the column the four old ones are in', () => {
  const pitch = fieldButtonAnchor('run', 20).y - fieldButtonAnchor('autoplan', 20).y;
  for (const name of ['ai', 'personnel', 'clear']) {
    assert.equal(fieldButtonAnchor(name, 20).x, fieldButtonAnchor('menu', 20).x,
      `${name} is in the first column`);
  }
  // Slots -3, -2, 3 against the menu's 0.
  assert.equal(fieldButtonAnchor('ai', 20).y, fieldButtonAnchor('menu', 20).y - 3 * pitch);
  assert.equal(fieldButtonAnchor('personnel', 20).y, fieldButtonAnchor('menu', 20).y - 2 * pitch);
  assert.equal(fieldButtonAnchor('clear', 20).y, fieldButtonAnchor('menu', 20).y + 3 * pitch);
});

test('a lesson fields none of the new controls unless it names them', () => {
  const markup = renderFieldButtons(createGame({ seed: 1 }), { allow: ['run', 'menu'] });
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(!markup.includes(attr), `${attr} stays off a lesson's board`);
  }
});

test('the new controls grey on the same conditions their menu buttons do', () => {
  const s = createGame({ seed: 1 });
  const live = renderFieldButtons(s);
  assert.ok(!buttonGroup(live, 'data-clear-button').includes('fbtn-off'), 'clear is live before the snap');
  assert.ok(!buttonGroup(live, 'data-ai-button').includes('fbtn-off'), 'defense is live before the snap');
  assert.ok(!buttonGroup(live, 'data-personnel-button').includes('fbtn-off'), 'personnel is live before the snap');

  const drawing = renderFieldButtons(s, { animating: true });
  for (const attr of ['data-clear-button', 'data-ai-button', 'data-personnel-button']) {
    assert.ok(buttonGroup(drawing, attr).includes('fbtn-off'),
      `${attr} is dead while the turn is drawn`);
  }

  // The computer's own package to pick: not the human's to press.
  const aiDef = createGame({ seed: 1 });
  aiDef.aiTeam = 'defense';
  assert.ok(buttonGroup(renderFieldButtons(aiDef), 'data-personnel-button').includes('fbtn-off'),
    'personnel is dead when the computer coaches the defense');
});

test('the quick-press buttons sit on the board, above and below the menu plate', () => {
  const [, boardTop, , boardHeight] = renderBoardShell(20, 30).viewBox.split(' ').map(Number);
  const menu = rectBox(menuButtonMark(20));
  const markup = renderFieldButtons(createGame({ seed: 1 }));
  const shuffle = rectBox(buttonGroup(markup, 'data-reposition-button'));
  const run = rectBox(buttonGroup(markup, 'data-run-button'));

  assert.ok(shuffle.y + shuffle.h <= menu.y, 'the shuffle is above the label');
  assert.ok(run.y >= menu.y + menu.h, 'and the run button below it');
  assert.ok(shuffle.y >= boardTop && run.y + run.h <= boardTop + boardHeight, 'both are on the board');
  assert.equal(shuffle.x, run.x, 'they share the label\'s column');
  const frameWidth = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  assert.ok(shuffle.x + shuffle.w <= frameWidth, 'and stay inside the viewBox');
});

test('the board furniture follows the camera, not the line of scrimmage', () => {
  // Everything anchored to the SCREEN rather than to the field has to be
  // placed from the camera's window. Position it from losYard instead and a
  // long run scrolls the message and both quick-press buttons off the board,
  // where they stay until the next down re-spots the ball.
  const s2 = createGame({ seed: 1 });
  const camera = s2.losYard + 30; // a thirty-yard run, camera well downfield
  const [, top, , height] = renderBoardShell(s2.losYard, s2.toGoYard, camera)
    .viewBox.split(' ').map(Number);

  const menu = rectBox(menuButtonMark(s2.losYard, camera));
  assert.ok(menu.y >= top && menu.y + menu.h <= top + height, 'the menu plate is on screen');

  const btns = renderFieldButtons(s2, { cameraYard: camera });
  for (const attr of ['data-reposition-button', 'data-run-button']) {
    const b = rectBox(buttonGroup(btns, attr));
    assert.ok(b.y >= top && b.y + b.h <= top + height, `${attr} is on screen`);
  }

  const plateY = Number(/<rect[^>]*\sy="([-\d.]+)"/.exec(renderMessage('Tackled!', s2.losYard, camera))[1]);
  assert.ok(plateY >= top && plateY <= top + height, 'and so is the message plate');
});

test('all four plates keep one column when the camera has scrolled away', () => {
  // The menu plate used to be built once into the board shell and never
  // repainted, so a scrolling run left it stranded at the top of the field
  // while the quick-press buttons followed the ball. They are one column of
  // four; they have to be placed from one camera.
  const s2 = createGame({ seed: 1 });
  const camera = s2.losYard + 30;
  const menu = rectBox(menuButtonMark(s2.losYard, camera));
  const btns = renderFieldButtons(s2, { cameraYard: camera });
  const shuffle = rectBox(buttonGroup(btns, 'data-reposition-button'));
  const autoplan = rectBox(buttonGroup(btns, 'data-autoplan-button'));
  const run = rectBox(buttonGroup(btns, 'data-run-button'));

  assert.equal(menu.x, shuffle.x, 'one column');
  assert.equal(menu.x, autoplan.x);
  assert.equal(menu.x, run.x);
  assert.ok(shuffle.y + shuffle.h <= menu.y, 'the shuffle sits above the menu plate');
  assert.ok(autoplan.y >= menu.y + menu.h, 'the autoplan icon sits below it');
  assert.ok(run.y >= autoplan.y + autoplan.h, 'and the run button below that');
  // Adjacent, not merely ordered: a plate placed from a different camera would
  // still be above or below, just a long way off.
  assert.ok(menu.y - (shuffle.y + shuffle.h) < menu.h, 'the shuffle is next to it');
  assert.ok(autoplan.y - (menu.y + menu.h) < menu.h, 'and so is the autoplan icon');
  assert.ok(run.y - (autoplan.y + autoplan.h) < menu.h, 'and so is the run button');
});

test('the button column clears the yard numbers and the edge of the frame', () => {
  // The right-hand yard numbers start at YARD_LABEL_RIGHT_X and are a shade
  // over ten units wide (browser-measured), so they end about x 251.2. A
  // button centred on the old legend's baseline came within 1.3 of that —
  // close enough to read as a field marking, which is what moved the column.
  const YARD_NUMBERS_RIGHT = 251.23;
  const boardWidth = Number(renderBoardShell(20, 30).viewBox.split(' ')[2]);
  const marks = [
    menuButtonMark(20),
    ...['data-reposition-button', 'data-run-button']
      .map((a) => buttonGroup(renderFieldButtons(createGame({ seed: 1 })), a)),
  ];

  for (const mark of marks) {
    const box = rectBox(mark);
    assert.ok(box.x - YARD_NUMBERS_RIGHT >= 3,
      `clears the yard numbers by ${(box.x - YARD_NUMBERS_RIGHT).toFixed(2)}`);
    assert.ok(boardWidth - (box.x + box.w) >= 3,
      `clears the edge of the frame by ${(boardWidth - (box.x + box.w)).toFixed(2)}`);
  }
});

test('the autoplan plate is always on the board, and names the side it draws for', () => {
  const mine = renderFieldButtons(createGame({ seed: 1, ai: 'defense', aiLevel: 'smart' }));
  assert.match(buttonGroup(mine, 'data-autoplan-button'), /aria-label="Autoplan offense"/);

  // Coaching the defense used to hide this plate entirely — now it draws up
  // the defense instead.
  const theirs = renderFieldButtons(createGame({ seed: 1, ai: 'offense', aiLevel: 'learned' }));
  assert.match(buttonGroup(theirs, 'data-autoplan-button'), /aria-label="Autoplan defense"/);
});

test('the snap draws exactly like any other lock-on: a halo under the quarterback and an arrow to his edge', () => {
  const s = createGame({ seed: 1 });
  const c = getPlayer(s, 'o-c');
  const qb = getPlayer(s, 'o-qb');
  assert.equal(s.plannedPass.power, 0, 'the snap is the gentlest throw in the game');
  assert.equal(s.plannedPass.target, 'o-qb', 'the snap is a lock, not a bare aim');

  const svg = renderPassArrow(s);
  assert.ok(svg.includes('data-pass="o-c"'), 'drawn from the centre');
  assert.ok(svg.includes('class="pass-halo"'), 'the snap reads like any other lock, halo and all');
  // No special-casing left for the snap: it is the same mark passLockMark
  // draws for a coach's own lock-on, from the same two men.
  assert.equal(svg, `<g class="plan-arrow" data-pass="o-c">${passLockMark(c, qb)}</g>`);
});

test('a throw the coach drew is still drawn at the length he dragged', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const qb = getPlayer(s, 'o-qb');
  assert.ok(renderPassArrow(s).includes(`${num(qb.pos.y + MAX_PASS_ARROW_UNITS)}`),
    'full power still means a full-length arrow');
});

/** The coach's own throw, with the snap out of the way: he has to hold the ball first. */
function coachHasBall(s) {
  s.ball = { carrierId: 'o-qb', pos: null, vel: null };
  s.plannedPass = null;
  return s;
}

test('a lob draws a landing circle as well as its arrow', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass"'), 'the arrow is still drawn');
  assert.ok(svg.includes('class="pass-land"'), 'and the landing circle with it');
  const land = passLanding(getPlayer(s, 'o-qb'), { x: 0, y: 1 }, 1);
  assert.ok(svg.includes(`r="${num(land.radius)}"`), 'as big as the guess is');
  assert.ok(svg.includes(`cy="${num(land.pos.y)}"`), 'centred where it is aimed');
});

test('a throw inside the lock zone draws no landing circle at all', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.4);
  assert.ok(!renderPassArrow(s).includes('pass-land'), 'a flat throw goes where it is pointed');
});

test('a locked-on throw draws a halo under the receiver and an arrow to his edge', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  const qb = getPlayer(s, 'o-qb');
  const wr = getPlayer(s, 'o-wr1');
  wr.pos = { x: qb.pos.x, y: qb.pos.y + 30 };
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-wr1');
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass-halo"'), 'the lock reads like a cover halo, in red');
  assert.ok(svg.includes(`r="${num(wr.radius + COVER_HALO_UNITS)}"`), 'and is sized like one');
  assert.ok(svg.includes('class="pass"'), 'with the throw arrow on top of it');
  assert.ok(svg.includes(`L ${num(qb.pos.x)} ${num(wr.pos.y - wr.radius)}`), 'stopping at his edge');
  assert.ok(!svg.includes('pass-land'), 'a locked throw never lobs, so there is no circle');
  assert.ok(svg.indexOf('pass-halo') < svg.indexOf('class="pass"'), 'halo first, line on top');
});

test('a lock on a man who is no longer on the field falls back to the plain arrow', () => {
  const s = coachHasBall(createGame({ seed: 1 }));
  setPass(s, 'o-qb', { x: 0, y: 1 }, 0.5, 'o-nobody');
  const svg = renderPassArrow(s);
  assert.ok(svg.includes('class="pass"'));
  assert.ok(!svg.includes('pass-halo'));
});

test('the loose ball is drawn bigger while it is over everyone\'s heads', () => {
  const s = createGame({ seed: 1 });
  const lob = { from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, substeps: 40, elapsed: 30 };
  s.ball = { carrierId: null, pos: lobPoint(lob), vel: { x: 0, y: 0 }, loose: 0, forward: true, lob };
  const svg = renderLooseBall(s);
  assert.ok(svg.includes('data-loose-ball="1"'));
  assert.match(svg, /scale\(/, 'swollen at the top of the arc');
  lob.elapsed = 40;
  s.ball.pos = lobPoint(lob);
  assert.ok(!renderLooseBall(s).includes('scale('), 'and its ordinary size on the ground');
});

test('a lob still in the air draws its landing circle, turn after turn', () => {
  const s = createGame({ seed: 1 });
  const lob = {
    from: { x: 135, y: 70 }, to: { x: 135, y: 150 }, aim: { x: 135, y: 152 }, radius: 5,
    substeps: 40, elapsed: 30,
  };
  s.ball = { carrierId: null, pos: lobPoint(lob), vel: { x: 0, y: 0 }, loose: 0, forward: true, lob };
  const svg = liveLobMark(s);
  assert.ok(svg.includes('class="pass-land"'));
  assert.ok(svg.includes(`cx="${num(lob.aim.x)}"`) && svg.includes(`cy="${num(lob.aim.y)}"`),
    'centred on the throw as aimed, not on the scattered landing spot');
  assert.ok(svg.includes(`r="${num(lob.radius)}"`));
});

test('the landing circle is gone once the ball is no longer a lob', () => {
  const s = createGame({ seed: 1 });
  s.ball = { carrierId: 'o-qb', pos: null, vel: null }; // caught, or never thrown at all
  assert.equal(liveLobMark(s), '');
});

test('the lob\'s two marks are styled in the game stylesheet', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('.pass-land{'), 'the landing circle has a style rule');
  assert.ok(markup.includes('.pass-halo{'), 'and so does the lock halo');
});

test('the column can be asked where each of its plates sits', () => {
  const run = fieldButtonAnchor('run', 20);
  const shuffle = fieldButtonAnchor('reposition', 20);
  const gift = fieldButtonAnchor('autoplan', 20);
  assert.equal(run.x, shuffle.x, 'one column');
  assert.equal(run.x, gift.x);
  assert.ok(shuffle.y < gift.y, 'shuffle above the gift');
  assert.ok(gift.y < run.y, 'gift above fast-forward');
  assert.ok(run.r > 0);
  assert.equal(fieldButtonAnchor('nonesuch', 20), null);
});

test('plates in one column share an x and are told apart by their row', () => {
  // Every entry is col 0 until Task 4, so this pins what must NOT change: the
  // refactor threads col and cx through without moving a single plate. The
  // two-column assertion lands in Task 4, with the plates that need it.
  const a = fieldButtonAnchor('run', 20);
  const b = fieldButtonAnchor('menu', 20);
  assert.equal(a.x, b.x, 'two plates in one column share an x');
  assert.notEqual(a.y, b.y, 'and are told apart by their row');
});

test('the anchor still refuses a name there is no button for', () => {
  assert.equal(fieldButtonAnchor('nonesuch', 20), null);
});

test('the clipboard is the middle of the column, and still draws where it always did', () => {
  const menuAnchor = fieldButtonAnchor('menu', 20);
  assert.ok(fieldButtonAnchor('reposition', 20).y < menuAnchor.y);
  assert.ok(menuAnchor.y < fieldButtonAnchor('run', 20).y);
  assert.ok(menuButtonMark(20, 20).includes(`y="${num(menuAnchor.y - menuAnchor.r)}"`),
    'the ring a lesson pins to it lands on the plate a paint draws');
});

test('naming the menu in allow does not conjure a second clipboard', () => {
  const s = createGame({ seed: 1, ai: null });
  const m = renderFieldButtons(s, {
    repositioning: false, animating: false, cameraYard: 20, allow: ['run', 'menu'],
  });
  assert.ok(m.includes('data-run-button'));
  assert.equal((m.match(/data-menu-button/g) ?? []).length, 0,
    'menuButtonMark owns that plate, and only it draws one');
});

test('an anchor lands on the plate the same paint actually draws', () => {
  const s = createGame({ seed: 1, ai: null });
  const markup = renderFieldButtons(s, { repositioning: false, animating: false, cameraYard: 20 });
  const anchor = fieldButtonAnchor('run', s.losYard, 20);
  // fieldButtonMark centres the plate on cy, so its y attribute is cy - size/2.
  assert.ok(markup.includes(`y="${num(anchor.y - anchor.r)}"`),
    'the ring and the plate are worked out from one number, not two');
});

test('a lesson fields only the buttons it names', () => {
  const s = createGame({ seed: 1, ai: null });
  const opts = { repositioning: false, animating: false, cameraYard: 20 };
  const all = renderFieldButtons(s, opts);
  assert.ok(all.includes('data-run-button'));
  assert.ok(all.includes('data-autoplan-button'));

  const only = renderFieldButtons(s, { ...opts, allow: ['run'] });
  assert.ok(only.includes('data-run-button'));
  assert.ok(!only.includes('data-autoplan-button'), 'no gift button in a lesson');
  assert.ok(!only.includes('data-reposition-button'));
});

test('the board can be built without a Coaches Menu, and always has a lesson layer', () => {
  const withMenu = renderBoardShell(20, 30, 20);
  assert.ok(withMenu.markup.includes('data-menu-button'));
  assert.ok(withMenu.markup.includes('id="game-tutorial"'));

  const without = renderBoardShell(20, 30, 20, { menu: false });
  assert.ok(!without.markup.includes('data-menu-button'), 'no way into the menu during a lesson');
  assert.ok(without.markup.includes('id="game-tutorial"'));
});
