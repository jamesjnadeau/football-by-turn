import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall, renderPassArrow,
  facingAngle, arrowMark, STYLE_GAME, menuButtonMark, wrapWords, renderMessage,
} from '../../lib/game/render.js';
import { createGame, setPlan, setMode, getPlayer, setPass } from '../../lib/game/state.js';
import {
  TEAM_SIZE, MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS, DEBUG_VELOCITY_SECONDS,
  DEBUG_VELOCITY_TRIANGLE_SCALE,
} from '../../lib/game/constants.js';
import { tackleReach } from '../../lib/game/modes.js';
import { num } from '../../lib/field/geometry.js';

test('the board shell has the field and every game layer', () => {
  const { viewBox, markup } = renderBoardShell(0);
  assert.match(viewBox, /^0 0 270 /);
  for (const id of ['game-field', 'game-arrows', 'game-preview', 'game-players', 'game-overlay', 'game-menu', 'game-message']) {
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
  setPass(s, 'o-qb', { x: 0, y: 1 }, 1);
  s.ball = { carrierId: 'o-rb', pos: null, vel: null };
  assert.equal(renderPassArrow(s), '');
});

test('the throw arc style is registered in the game stylesheet', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('.pass{'), 'the pass arrow has a style rule');
});

test('the COACHES MENU label carries a transparent hit target of its own', () => {
  const { markup } = renderBoardShell(0);
  assert.ok(markup.includes('>COACHES MENU</text>'), 'the field says COACHES MENU');
  assert.ok(markup.includes('id="game-menu"'), 'the button gets a layer of its own');
  assert.equal(
    menuButtonMark(),
    '<rect data-menu-button="1" class="menu-hit" tabindex="0" role="button" aria-label="Open the Coaches Menu" x="247" y="37" width="20" height="96"/>',
  );
  assert.ok(STYLE_GAME.includes('.menu-hit{fill:transparent;pointer-events:all;cursor:pointer}'));
  assert.ok(STYLE_GAME.includes('.pb{fill:#1a7f37;cursor:pointer}'), 'the label reads as pressable');
});

test('the menu hit target sits over the label and inside the frame', () => {
  const { viewBox } = renderBoardShell(0);
  const [, , w, h] = viewBox.split(' ').map(Number);
  const m = menuButtonMark().match(/x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const [x, y0, rw, rh] = m.slice(1).map(Number);
  assert.ok(x < 257 && x + rw > 257, 'straddles the label column at x=257');
  assert.ok(x + rw <= w, 'inside the viewBox width');
  assert.ok(y0 > 0 && y0 + rh <= h, 'inside the viewBox height');
  assert.ok(y0 < 85 && y0 + rh > 85, 'straddles the label centre at y=85');
});

test('the menu button is reachable and labelled without a pointer', () => {
  // A closed <dialog> is out of the tab order, so this rect is the only
  // focusable element until the menu is open — it has to carry its own
  // keyboard affordances rather than relying on the controls inside.
  const mark = menuButtonMark();
  assert.ok(mark.includes('tabindex="0"'), 'the rect is a keyboard stop');
  assert.ok(mark.includes('role="button"'), 'the rect reads as a button to assistive tech');
  assert.ok(mark.includes('aria-label="Open the Coaches Menu"'), 'the rect names itself');
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
  assert.equal(renderMessage(''), '');
  assert.equal(renderMessage('   '), '');
});

test('a one-line message is a plate and a tspan centred in the end zone', () => {
  assert.equal(
    renderMessage('TOUCHDOWN!'),
    '<rect class="msg-plate" x="104" y="129.75" width="62" height="23" rx="2"/>' +
    '<text class="msg"><tspan x="135" y="144">TOUCHDOWN!</tspan></text>',
  );
});

test('a two-line message stacks tspans and grows the plate, staying in the end zone', () => {
  const svg = renderMessage('Fumble recovered by the defense. Game over.');
  assert.equal((svg.match(/<tspan /g) || []).length, 2);
  assert.ok(svg.includes('<tspan x="135" y="138.5">Fumble recovered by the defense.</tspan>'));
  assert.ok(svg.includes('<tspan x="135" y="149.5">Game over.</tspan>'));
  const plate = svg.match(/y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  const [py, pw, ph] = plate.slice(1).map(Number);
  assert.ok(py >= 122.5, 'the plate starts at or below the goal line');
  assert.ok(py + ph <= 160, 'and ends at or above the end line');
  assert.ok(pw <= 200, 'and never runs wider than the sidelines');
});

test('a long message grows past the end zone but never off the board', () => {
  // The real penalty message: three lines, taller than the 37.5-unit end zone.
  const flag = 'FLAG: forward pass from beyond the line. 5 yards from the previous spot, loss of down.';
  const svg = renderMessage(flag);
  assert.equal((svg.match(/<tspan /g) || []).length, 3, 'three lines at this budget');
  const [py, ph] = svg.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.ok(py > 0, 'still on the board at the top');
  assert.ok(py + ph <= 170, 'and still on the board at the bottom');
  // 40 short words wrap to six lines at this budget, which is too tall to be
  // centred and still stay on the board; the clamp catches it.
  const huge = renderMessage(new Array(40).fill('word').join(' '));
  const [hy, hh] = huge.match(/y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/).slice(1).map(Number);
  assert.ok(hy >= 0 && hy + hh <= 170, 'clamped inside the viewBox');
});

test('message text is escaped', () => {
  assert.ok(renderMessage("QB can't do that.").includes('can&#39;t'));
  assert.ok(renderMessage('A & B').includes('A &amp; B'));
});

test('the message layer is the topmost layer on the board', () => {
  const { markup } = renderBoardShell(0);
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
