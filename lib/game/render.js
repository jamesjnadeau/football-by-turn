/**
 * Everything the game paints, as strings — same discipline as the vendored
 * renderer, so `node --test` can assert on markup without a DOM. app/main.js
 * writes these into the layer groups; per-frame animation only rewrites the
 * `transform` of each player group.
 */
import { VIEWBOX_WIDTH, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT, UNITS_PER_YARD_X, y as yardToY } from '../field/geometry.js';
import { renderField } from '../field/field.js';
import { STYLE, DEFS } from '../field/style.js';
import { num } from '../field/geometry.js';
import { escapeText } from '../field/escape.js';
import { gameView, GOAL_YARD, fieldPos } from './view.js';
import { tackleReach, headingOf } from './modes.js';
import { getPlayer } from './state.js';
import { sub, len } from './vec.js';
import { ballScale } from './lob.js';
import { passLanding } from './pass.js';
import {
  MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS, STANCE_CONE_HALF_ANGLE, DEBUG_VELOCITY_SECONDS,
  DEBUG_VELOCITY_TRIANGLE_SCALE, COVER_HALO_UNITS, ON_LINE_YARDS, CUT_BLOCK_DRIVE_REACH,
} from './constants.js';

/**
 * The message plate. SVG does not wrap text, so the wrap is done here by
 * character count against a budget sized for the sidelines: at 9px (before
 * the plate's font was halved) the plate is sized by an approximate advance
 * width, which is why MESSAGE_CHAR_WIDTH is a measured-ish constant rather
 * than derived from anything, and is left at its original value so halving
 * the font doesn't also shrink the plate's width. The number of lines that
 * wrap to is unbounded, and copy is not shortened to fit — a message longer
 * than the window overflows its bottom edge instead.
 */
const MESSAGE_MAX_CHARS = 34;
const MESSAGE_LINE_HEIGHT = 5.5;
const MESSAGE_CHAR_WIDTH = 5;
const MESSAGE_PAD_X = 6;
const MESSAGE_PAD_Y = 3;

export const STYLE_GAME = [
  '.gp-o{fill:#222;stroke:#000;stroke-width:.6}',
  '.gp-d{fill:#fff;stroke:#000;stroke-width:.8}',
  '.gp-role{font:3px sans-serif;text-anchor:middle;fill:#fff;pointer-events:none}',
  '.gp-d + .gp-role, .gp-role.on-d{fill:#000}',
  '.stance{fill:none;stroke:#000;stroke-width:.7;stroke-dasharray:1.5 1}',
  // The cut block's friction zone: the same radius physics.js's
  // driveReachBonus actually grabs at, so the ring on the board is the
  // radius that grabs, not a decoration guessing at it. It doubles as the
  // move's on/off indicator — see driveAura, below.
  '.drive-aura{fill:none;stroke:#000;stroke-width:.5;stroke-dasharray:1 1.5;opacity:.5}',
  // The assist mark: green, the same colour a plan arrow already uses for
  // "this is working in the coach's favour" (.plan-mv, below).
  '.cb-assist{fill:none;stroke:#1a7f37;stroke-width:.6;opacity:.7}',
  '.fb{fill:#7b4a12;stroke:#000;stroke-width:.4}',
  // The plan arrow overrides nothing: it uses its own class rather than the
  // shared `.mv`, so there is no cascade to lose. Green, and half the weight
  // `.mv` draws at (1.7 -> .85) — which halves the arrowhead with it, because
  // markers are sized in stroke-widths by default. The dash gap is halved to
  // match, so the dotted line keeps its proportions at the lighter weight.
  // Opacity lives here rather than on the `.plan-arrow` wrapper `<g>` because
  // app/main.js's live drag preview writes a bare arrowMark() into the
  // `game-preview` layer with no such wrapper — putting it on the path keeps
  // the dragged and committed arrows the same opacity by construction, same
  // as their geometry.
  '.plan-mv{stroke:#1a7f37;stroke-width:.85;fill:none;stroke-dasharray:.1 2.2;stroke-linecap:round;opacity:.85}',
  '.arh-g{fill:#1a7f37}',
  // The destination circle: where this player will actually be standing at the
  // whistle. Drawn at his own radius so it reads as his body moved there rather
  // than as a marker, and translucent so the yard lines under it stay legible.
  // It goes in the `game-arrows` layer, which is beneath `game-players`, so a
  // short plan tucks under the player instead of covering him up.
  '.plan-dest{fill:#1a7f37;fill-opacity:.35;stroke:#1a7f37;stroke-width:.6;pointer-events:none}',
  // The cover halo: a green disc under the man a blocker has taken on. It lives
  // in the `game-arrows` layer, which renderBoardShell puts BENEATH
  // `game-players`, so the player's own body covers all of it but the rim — the
  // spec's "edge just visible from under the player". More opaque than
  // .plan-dest precisely because so little of it shows.
  '.cover-halo{fill:#1a7f37;fill-opacity:.55;stroke:#1a7f37;stroke-width:.5;pointer-events:none}',
  // The on-the-line band, shown only while repositioning. Faint enough that
  // the yard lines and hash marks under it stay readable — it is a guide to
  // drop things into, not a feature of the field.
  '.line-zone{fill:#1a7f37;fill-opacity:.12;stroke:#1a7f37;stroke-width:.5;stroke-opacity:.5;pointer-events:none}',
  // The debug velocity triangle. Filled, not stroked: it is an instrument,
  // drawn over the player, not part of the play.
  '.vel{fill:#1668dc;pointer-events:none}',
  // The throw arrow, deliberately unlike the run arrow: a throw is a different
  // verb and has to be tellable at a glance. Red, solid-dashed and heavier than
  // `.plan-mv`. Its opacity lives on the path for the same reason `.plan-mv`'s
  // does — app/main.js previews a bare passArrowMark() with no wrapper `<g>`.
  '.pass{fill:none;stroke:#b3261e;stroke-width:1.2;stroke-dasharray:3 2;opacity:.85}',
  '.arh-r{fill:#b3261e}',
  // The landing circle: where a lob is aimed, and how big a guess that is.
  // Dashed and barely filled on purpose — the ball comes down SOMEWHERE in
  // here, and a solid disc would claim to know more than the game does. It
  // goes in the `game-arrows` layer, under the players, so a circle drawn over
  // a crowd does not hide the crowd.
  '.pass-land{fill:#b3261e;fill-opacity:.1;stroke:#b3261e;stroke-width:.6;stroke-dasharray:2 2;pointer-events:none}',
  // The lock-on halo: the same shadow a cover order puts under a man, in the
  // throw's own red. "I am throwing to him" and "I am covering him" are the
  // same shape of order — the colour is what keeps them apart.
  '.pass-halo{fill:#b3261e;fill-opacity:.55;stroke:#b3261e;stroke-width:.5;pointer-events:none}',
  // The plate sits on the hatched end zone, so it needs a ground of its own.
  // Both parts are click-through: the board underneath still takes drags.
  '.msg-plate{fill:#ffffff;fill-opacity:.92;stroke:#000;stroke-width:.6;pointer-events:none}',
  '.msg{font:bold 4.5px system-ui,sans-serif;text-anchor:middle;fill:#000;pointer-events:none}',
  // The line to gain: a solid line distinct from both the dashed scrimmage
  // line (black) and the dashed plan/pass arrows (green/red), since it is
  // reporting a fact about the field, not an order. Gold reads as "the
  // broadcast yellow line" without needing actual broadcast graphics.
  '.ftg{stroke:#c9962c;stroke-width:1.5;fill:none}',
  // The tutorial's coach card, pinned to the bottom of the window. Dark, so it
  // reads as somebody talking to you rather than as another field marking, and
  // so the referee's white plate at the top of the window stays the referee's.
  '.tut-plate{fill:#0b3d20;fill-opacity:.95;stroke:#1a7f37;stroke-width:.6;pointer-events:none}',
  '.tut-title{font:bold 3.4px system-ui,sans-serif;fill:#8fd6a8;text-anchor:middle;pointer-events:none}',
  '.tut-text{font:4px system-ui,sans-serif;fill:#fff;text-anchor:middle;pointer-events:none}',
  '.tut-foot{font:3px system-ui,sans-serif;fill:#8fd6a8;text-anchor:middle;pointer-events:none}',
  '.tut-next{fill:#fff;fill-opacity:.14;stroke:#8fd6a8;stroke-width:.5;pointer-events:all;cursor:pointer}',
  '.tut-next-label{font:3.2px system-ui,sans-serif;fill:#fff;text-anchor:middle;dominant-baseline:central;pointer-events:none}',
  // The ring around whatever must be pressed next. Gold, because green is
  // already the colour of an order and white is the referee's.
  '.tut-ring{fill:none;stroke:#ffd23f;stroke-width:1;pointer-events:none;animation:tut-pulse 1.3s ease-in-out infinite}',
  '@keyframes tut-pulse{0%,100%{opacity:1;stroke-width:1}50%{opacity:.45;stroke-width:1.8}}',
].join('');

/**
 * The game's own arrowhead. `lib/field/style.js` ships a black `#ar` for the
 * standalone diagrams and is shared with them, so the green one lives here
 * instead of being a fork of that file. Same geometry as `#ar` — it is the
 * lighter stroke that makes it draw at half the size.
 */
export const DEFS_GAME =
  '<defs>' +
  '<marker id="ar-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
  '<path d="M0,1 L9,5 L0,9 z" class="arh-g"/>' +
  '</marker>' +
  '<marker id="ar-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
  '<path d="M0,1 L9,5 L0,9 z" class="arh-r"/>' +
  '</marker>' +
  '</defs>';

/**
 * Just the viewBox string, for the animation loop.
 *
 * animate() writes this on every frame to scroll the board. It rebuilds
 * nothing: the field under it was drawn once, across every yard of it, so
 * moving the crop is the whole of the camera work.
 */
export function cameraViewBox(losYard, cameraYard) {
  const view = gameView(losYard, cameraYard);
  return `0 ${num(view.windowTopY)} ${VIEWBOX_WIDTH} ${num(view.height)}`;
}

/**
 * The controls used to live on the board, as a second column of plates ten
 * units wide off the right of the frame — which is why the game used to crop
 * wider than the field's own VIEWBOX_WIDTH. They are real HTML buttons now,
 * painted by app/controls.js outside this SVG entirely, so that column is not
 * needed any more and the crop goes back to the field's own width.
 */
export function renderBoardShell(losYard, toGoYard, cameraYard = losYard) {
  const view = gameView(losYard, cameraYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 ${num(view.windowTopY)} ${VIEWBOX_WIDTH} ${num(height)}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}${DEFS_GAME}` +
      `<g id="game-field">${svg}${lineToGainMark(view, toGoYard)}</g>` +
      // Order is z-order. Arrows and the live drag preview go under the
      // players; the overlay stays on top, because that is where the animated
      // loose ball is drawn.
      `<g id="game-arrows"></g><g id="game-preview"></g>` +
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-message"></g>` +
      // Last, so it is above everything: a lesson's card and its ring have to
      // be readable over the men they are talking about.
      `<g id="game-tutorial"></g>`,
  };
}

/**
 * A player who has committed to a special move (tucked, prepared, holding)
 * has an axis frozen into `facing` and is stuck with it until he drops back
 * to normal, so that is what he is pointed at no matter where his next arrow
 * goes. Everyone else is pointed wherever headingOf says.
 */
export function facingAngle(player) {
  const f = player.facing || headingOf(player);
  return Math.atan2(f.y, f.x);
}

/**
 * The stance wedge, drawn from the same half-angle and the same reach the
 * tackle check uses — so for a broken-down defender this arc is not a decoration
 * but the actual strike zone, and a runner can read off the board whether he is
 * about to run into it.
 */
function stanceArc(player) {
  const a = facingAngle(player);
  const r = tackleReach(player, { x: Math.cos(a), y: Math.sin(a) }) + 1;
  const a0 = a - STANCE_CONE_HALF_ANGLE;
  const a1 = a + STANCE_CONE_HALF_ANGLE;
  const p0 = { x: r * Math.cos(a0), y: r * Math.sin(a0) };
  const p1 = { x: r * Math.cos(a1), y: r * Math.sin(a1) };
  return `<path class="stance" d="M ${num(p0.x)} ${num(p0.y)} A ${num(r)} ${num(r)} 0 0 1 ${num(p1.x)} ${num(p1.y)}"/>`;
}

/** The football, drawn about (cx, cy) in the player group's local space. */
function football(cx, cy, angle) {
  return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="1.6" ry="0.9" class="fb" transform="rotate(${num((angle * 180) / Math.PI)} ${num(cx)} ${num(cy)})"/>`;
}

/**
 * The debug read-out of a player's motion, in the player group's local space:
 * an equilateral triangle whose BASE sits on the player's own circle (at
 * `player.radius`) and whose apex points outward along his velocity, like an
 * arrowhead just past his rim. A triangle centred on his centre — the earlier
 * construction — is hidden behind his own icon at any speed below the very
 * top, since its circumradius only clears his 2.5-unit body near max speed;
 * pinning the base to the rim keeps it visible at any speed at all. The
 * height beyond the rim is `speed × DEBUG_VELOCITY_SECONDS ×
 * DEBUG_VELOCITY_TRIANGLE_SCALE` — no `player.radius` term here, since the
 * radius now positions the shape rather than inflating it — so the height
 * alone carries the speed read-out and stays strictly proportional to it. An
 * equilateral triangle of height h has base half-width h/√3. The `speed ===
 * 0` guard exists only to dodge dividing by zero when computing the heading
 * (which would draw NaN), not to catch "slow": standing still there is no
 * direction to point, so a stopped player gets nothing.
 */
function velocityTriangle(player) {
  const { x, y } = player.vel;
  const speed = Math.hypot(x, y);
  if (speed === 0) return '';
  const h = speed * DEBUG_VELOCITY_SECONDS * DEBUG_VELOCITY_TRIANGLE_SCALE;
  const halfWidth = h / Math.sqrt(3);
  const theta = Math.atan2(y, x);
  const perp = theta + Math.PI / 2;
  const thetaX = Math.cos(theta);
  const thetaY = Math.sin(theta);
  const perpX = Math.cos(perp);
  const perpY = Math.sin(perp);
  const apex = [(player.radius + h) * thetaX, (player.radius + h) * thetaY];
  const baseX = player.radius * thetaX;
  const baseY = player.radius * thetaY;
  const points = [
    apex,
    [baseX + halfWidth * perpX, baseY + halfWidth * perpY],
    [baseX - halfWidth * perpX, baseY - halfWidth * perpY],
  ]
    .map(([px, py]) => `${num(px)},${num(py)}`)
    .join(' ');
  return `<polygon points="${points}" class="vel"/>`;
}

/**
 * The cut block's friction zone: a dashed ring at
 * player.radius + CUT_BLOCK_DRIVE_REACH — the same extra distance
 * physics.js's driveReachBonus adds to every collision he is a party to, so
 * the ring on the board is literally the radius that grabs.
 *
 * Drawn from the moment the move is enabled (mode 'cutBlock', during
 * planning) and not only once he is driving, because this ring is the only
 * thing on the board that says the cut block is on at all — a stance arc is
 * what every other special move gets, and this one had nothing but a line of
 * message text. On the lunge turn it is a promise about the turn after rather
 * than a live hitbox; that is the honest shape for an "enabled" mark, and it
 * is the same ring either way so there is only one thing to learn.
 */
function driveAura(player) {
  const r = player.radius + CUT_BLOCK_DRIVE_REACH;
  return `<circle cx="0" cy="0" r="${num(r)}" class="drive-aura"/>`;
}

/**
 * A thin ring on any player currently drawing the cut-block assist — the
 * spec's "speed boost ... and turn quicker" for standing near a driving
 * blocker, made visible the same way the drive aura makes its cause
 * visible.
 */
function assistMark(player) {
  return `<circle cx="0" cy="0" r="${num(player.radius + 1)}" class="cb-assist"/>`;
}

function playerMark(player, isCarrier, tucked, showVelocity) {
  const cls = player.team === 'offense' ? 'gp-o' : 'gp-d';
  const parts = [`<circle cx="0" cy="0" r="${num(player.radius)}" class="${cls}"/>`];
  parts.push(`<text x="0" y="1" class="gp-role${player.team === 'defense' ? ' on-d' : ''}">${player.role}</text>`);
  if (player.mode === 'prepared' || player.mode === 'holding') parts.push(stanceArc(player));
  if (player.mode === 'cutBlock' || player.mode === 'cutBlockDrive') parts.push(driveAura(player));
  if (player.cutBlockAssist) parts.push(assistMark(player));
  // Over the body but under the ball: the ball is the thing the player most
  // needs to find on the board, and an instrument overlay must never hide it.
  if (showVelocity) parts.push(velocityTriangle(player));
  if (isCarrier) {
    const angle = facingAngle(player);
    if (tucked) parts.push(football(0, 0, angle));
    else parts.push(football(player.radius * Math.cos(angle), player.radius * Math.sin(angle), angle));
  }
  return (
    `<g class="gp" data-id="${player.id}" transform="translate(${num(player.pos.x)}, ${num(player.pos.y)})">` +
    parts.join('') +
    `</g>`
  );
}

/**
 * `showVelocity` turns on the debug read-out. It is an argument rather than a
 * flag on the state because it is a property of the view, not of the game —
 * New Game replaces the state and must not silently switch it off.
 */
export function renderPlayers(state, { showVelocity = false } = {}) {
  return state.players
    .map((p) => playerMark(p, state.ball.carrierId === p.id, p.mode === 'tucked', showVelocity))
    .join('');
}

/**
 * The football on its own, wrapped in a positioned group so a caller can move
 * it per animation frame with a `transform` — exactly like a player group.
 * `renderLooseBall` (the static, between-turns case) and app/main.js's
 * per-frame animation both go through here, so the ball is one piece of
 * markup with one shape.
 *
 * `scale` is how high it is: this board has no z axis, so a lob at the top of
 * its arc says so by being drawn bigger. The transform is left off entirely at
 * ordinary size, so the common case is exactly the markup it always was.
 */
export function looseBallMark(pos, scale = 1) {
  const size = scale === 1 ? '' : ` scale(${num(scale)})`;
  return (
    `<g class="loose" data-loose-ball="1" transform="translate(${num(pos.x)}, ${num(pos.y)})${size}">` +
    football(0, 0, 0) +
    `</g>`
  );
}

export function renderLooseBall(state) {
  if (state.ball.carrierId !== null || !state.ball.pos) return '';
  return looseBallMark(state.ball.pos, ballScale(state.ball));
}

/**
 * One movement arrow. The committed plan arrows and app/main.js's live drag
 * preview both come through here, so the arrow a player is dragging and the
 * arrow he ends up with are the same picture by construction.
 */
export function arrowMark(from, to) {
  return `<path d="M ${num(from.x)} ${num(from.y)} L ${num(to.x)} ${num(to.y)}" class="plan-mv" marker-end="url(#ar-g)"/>`;
}

/**
 * Greedy word wrap to a character budget. A word longer than the budget gets
 * a line to itself rather than being broken: hyphenating "TOUCHDOWN!" would
 * read worse than letting it run a little wide.
 */
export function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The status message, drawn on a plate pinned to the top of the currently
 * drawn window, which is on `game-message`, the topmost layer. The plate is
 * click-through, so a player standing underneath it is cosmetic, not a
 * hit-testing problem. app/main.js writes this into `game-message`.
 */
export function renderMessage(text, losYard, cameraYard = losYard) {
  const lines = wrapWords(text, MESSAGE_MAX_CHARS);
  if (lines.length === 0) return '';

  const view = gameView(losYard, cameraYard);
  const blockHeight = lines.length * MESSAGE_LINE_HEIGHT;

  const widest = Math.max(...lines.map((l) => l.length));
  const plateW = Math.min(
    widest * MESSAGE_CHAR_WIDTH + MESSAGE_PAD_X * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateH = blockHeight + MESSAGE_PAD_Y * 2;

  // Pinned to the top of the currently drawn window — view.windowTopY, not
  // the fixed 0 the single-window game used, so the plate always lands
  // somewhere inside the viewBox actually being shown rather than the window
  // some other losYard would have framed. Messages are not shortened to fit:
  // the renderer is the thing that has to cope, so an essay-length message
  // simply overflows the bottom edge rather than being truncated silently.
  const plateY = view.windowTopY + MESSAGE_PAD_Y / 2;

  // Baselines sit three quarters down each line box, which reads as centred.
  const firstBaseline = plateY + MESSAGE_PAD_Y + MESSAGE_LINE_HEIGHT * 0.75;
  const tspans = lines
    .map((l, i) => `<tspan x="${num(CENTRE_X)}" y="${num(firstBaseline + i * MESSAGE_LINE_HEIGHT)}">${escapeText(l)}</tspan>`)
    .join('');

  return (
    `<rect class="msg-plate" x="${num(CENTRE_X - plateW / 2)}" y="${num(plateY)}"` +
    ` width="${num(plateW)}" height="${num(plateH)}" rx="2"/>` +
    `<text class="msg">${tspans}</text>`
  );
}

/**
 * The spot a plan lands on. Like arrowMark, this is a bare mark with no
 * wrapper: app/main.js writes it straight into the `game-preview` layer while
 * the drag is live, and renderPlans wraps the identical string once the drag is
 * committed — so what is dragged and what is kept are the same picture.
 */
export function destinationMark(pos, radius) {
  return `<circle cx="${num(pos.x)}" cy="${num(pos.y)}" r="${num(radius)}" class="plan-dest"/>`;
}

/**
 * The band a man has to be standing in to count as ON the line.
 *
 * Drawn only while the coach is repositioning, and drawn because the rule is
 * a yard and the formation stands at a yard: without it the boundary he is
 * working against is invisible, and a drop a fraction too deep quietly turns
 * a receiver into a back. With it, "on the line" is somewhere you can see.
 *
 * The offense lines up behind the ball, so the band runs back from the line
 * of scrimmage rather than straddling it.
 */
/**
 * The line to gain. Composited after renderField's own output rather than
 * taught to the vendored field.js — that file draws exactly one kind of
 * "rule line" (the dashed scrimmage line, via view.scrimmage) and is never
 * edited. Omitted when the sticks are at or past the goal line the window
 * already marks (goal-to-go), or off the top/bottom of the current camera.
 */
export function lineToGainMark(view, toGoYard) {
  if (toGoYard >= GOAL_YARD) return '';
  const topYard = (view.fieldTopY - view.anchorY) / view.scaleY;
  if (toGoYard < topYard || toGoYard > view.bottomYard) return '';
  const ly = yardToY(view, toGoYard);
  return `<line x1="${num(SIDELINE_LEFT)}" y1="${num(ly)}" x2="${num(SIDELINE_RIGHT)}" y2="${num(ly)}" class="ftg"/>`;
}

export function lineZoneMark(state) {
  const losY = fieldPos(0, state.losYard).y;
  const height = ON_LINE_YARDS * UNITS_PER_YARD_X;
  return (
    `<rect x="${num(SIDELINE_LEFT)}" y="${num(losY - height)}"` +
    ` width="${num(SIDELINE_RIGHT - SIDELINE_LEFT)}" height="${num(height)}"` +
    ' class="line-zone"/>'
  );
}

/** The disc under a covered player. Only its rim is ever visible; see the style. */
export function coverHaloMark(target) {
  return (
    `<circle cx="${num(target.pos.x)}" cy="${num(target.pos.y)}"` +
    ` r="${num(target.radius + COVER_HALO_UNITS)}" class="cover-halo"/>`
  );
}

/**
 * A cover order: the halo under the covered man, and the ordinary green dotted
 * plan line running to him. The line is the SAME mark a movement arrow uses —
 * this is still a plan, and drawing it in a second visual language would say it
 * was something else. It stops at the target's edge rather than his centre so
 * the arrowhead lands on him instead of inside him.
 *
 * Halo first: the line has to read on top of it.
 */
export function coverMark(player, target) {
  const to = sub(target.pos, player.pos);
  const l = len(to);
  const reach = Math.max(0, l - target.radius);
  const tip = l === 0
    ? { ...target.pos }
    : { x: player.pos.x + (to.x / l) * reach, y: player.pos.y + (to.y / l) * reach };
  return coverHaloMark(target) + arrowMark(player.pos, tip);
}

/**
 * One run plan, drawn. Two marks that answer two different questions, and a
 * plan shows whichever of them it can answer:
 *
 * - the circle, on the spot he will be standing at the whistle. Every planned
 *   drag knows this, so every planned drag draws it.
 * - the arrow, when the plan is `short` — the user pointed past what half a
 *   second buys, so the man is still running that way when the turn ends. It
 *   says the direction he was sent, which the circle alone cannot: a circle
 *   seven yards out looks the same whether that was the whole order or the
 *   first tenth of it.
 *
 * A plan with no target at all — the computer's, a playbook's, a test's — has
 * no prediction to draw and keeps the bare arrow, as it always did.
 *
 * The circle goes first so the arrow reads on top of it, the same stacking
 * coverMark uses for the halo and its line.
 *
 * This is the one place the picture is decided: app/main.js's live drag preview
 * calls it too, so a drag never changes shape at the moment it is released.
 */
export function planMark(player, plan) {
  const dest = plan.target ? destinationMark(plan.target, player.radius) : '';
  const arrow = plan.short || !plan.target
    ? arrowMark(player.pos, {
      x: player.pos.x + plan.dir.x * plan.throttle * MAX_ARROW_UNITS,
      y: player.pos.y + plan.dir.y * plan.throttle * MAX_ARROW_UNITS,
    })
    : '';
  return dest + arrow;
}

/**
 * The human's plans, each in its own group.
 *
 * The team the computer coaches is skipped: turn.js already guarantees those
 * plans never exist during a planning phase, and this is the second lock on the
 * same door — the requirement is "don't show the defense's planned movements",
 * and this is the file that would show them.
 */
export function renderPlans(state) {
  return state.players
    .filter((p) => p.plan && p.team !== state.aiTeam)
    .map((p) => {
      const mark = p.cover
        ? coverMark(p, getPlayer(state, p.cover))
        : planMark(p, p.plan);
      return `<g class="plan-arrow" data-for="${p.id}">${mark}</g>`;
    })
    .join('');
}

/**
 * One throw arrow. The committed throw and app/main.js's live drag preview both
 * come through here, so the arrow a player is dragging and the arrow he ends up
 * with are the same picture by construction — the same guarantee arrowMark
 * gives the run arrow, and the reason the drawn length lives here rather than
 * being recomputed at each call site.
 */
export function passArrowMark(from, to) {
  return `<path d="M ${num(from.x)} ${num(from.y)} L ${num(to.x)} ${num(to.y)}" class="pass" marker-end="url(#ar-r)"/>`;
}

/** Where a throw arrow of this power, from this spot, reaches to. */
export function passArrowTip(from, dir, power) {
  return {
    x: from.x + dir.x * power * MAX_PASS_ARROW_UNITS,
    y: from.y + dir.y * power * MAX_PASS_ARROW_UNITS,
  };
}

/**
 * Where a lob is coming down, and how big the guess is. A bare mark with no
 * wrapper, like arrowMark and destinationMark: app/main.js writes it straight
 * into the `game-preview` layer while the drag is live, and renderPassArrow
 * wraps the identical string once it is committed.
 */
export function passLandingMark(pos, radius) {
  return `<circle cx="${num(pos.x)}" cy="${num(pos.y)}" r="${num(radius)}" class="pass-land"/>`;
}

/**
 * The same landing circle, redrawn every turn the ball is still in the air.
 * renderPassArrow only has something to say while the planner still holds the
 * ball (state.plannedPass, cleared at the end of the very turn it is thrown)
 * — but a lob can hang for several turns after that (planLob's substeps), and
 * the coach still needs to see where it might come down. `aim` and `radius`
 * are rolled once, at release, and ride along on state.ball.lob for exactly
 * this: nothing here is a live guess, it is the same circle the coach threw
 * at, still standing. Empty once the ball is no longer a lob at all — caught,
 * ruled incomplete, or intercepted all replace state.ball outright.
 */
export function liveLobMark(state) {
  const lob = state.ball.lob;
  return lob ? passLandingMark(lob.aim, lob.radius) : '';
}

/**
 * A throw locked onto a man: the halo under him and the throw arrow running to
 * his edge rather than to his centre, so the arrowhead lands on him instead of
 * inside him. The same two-part picture coverMark draws, in the throw's red —
 * halo first, because the line has to read on top of it.
 */
export function passLockMark(passer, receiver) {
  const to = sub(receiver.pos, passer.pos);
  const l = len(to);
  const reach = Math.max(0, l - receiver.radius);
  const tip = l === 0
    ? { ...receiver.pos }
    : { x: passer.pos.x + (to.x / l) * reach, y: passer.pos.y + (to.y / l) * reach };
  return (
    `<circle cx="${num(receiver.pos.x)}" cy="${num(receiver.pos.y)}"` +
    ` r="${num(receiver.radius + COVER_HALO_UNITS)}" class="pass-halo"/>` +
    passArrowMark(passer.pos, tip)
  );
}

/**
 * The planned throw, in one of its three shapes: locked onto a man, arcing to
 * a landing circle, or the plain arrow it has always been. Nothing is drawn
 * once the planner no longer has the ball; the throw will not happen either
 * (releasePass cancels it), so drawing it would be a lie.
 *
 * The snap is not a fourth shape any more. It used to be special-cased ahead
 * of everything else, because its power is solved from a gap of a few yards
 * and comes out clamped at the minimum -- scaling an arrow by that power would
 * draw one of exactly nothing. But aimSnap puts a `target` on the snap now,
 * the same as any other lock-on, and the lock branch below never scales by
 * power in the first place: passLockMark runs its arrow to the receiver's
 * edge regardless of how hard the ball is thrown. So the snap simply falls
 * into the `locked` case like anyone else's lock-on does.
 *
 * A lock on a man who is no longer on the field falls back to the arrow rather
 * than drawing nothing: a play loaded onto a different formation is the case,
 * and the throw itself still goes exactly where `dir` and `power` say.
 */
export function renderPassArrow(state) {
  const planned = state.plannedPass;
  if (!planned || state.ball.carrierId !== planned.from) return '';
  const from = getPlayer(state, planned.from);
  const locked = planned.target ? state.players.find((p) => p.id === planned.target) : null;
  let mark;
  if (locked) {
    mark = passLockMark(from, locked);
  } else {
    const land = passLanding(from, planned.dir, planned.power);
    mark = (land ? passLandingMark(land.pos, land.radius) : '')
      + passArrowMark(from.pos, passArrowTip(from.pos, planned.dir, planned.power));
  }
  return `<g class="plan-arrow" data-pass="${planned.from}">${mark}</g>`;
}
