/**
 * Everything the game paints, as strings — same discipline as the vendored
 * renderer, so `node --test` can assert on markup without a DOM. app/main.js
 * writes these into the layer groups; per-frame animation only rewrites the
 * `transform` of each player group.
 */
import { VIEWBOX_WIDTH, PRESS_BOX_X, CENTRE_X, SIDELINE_LEFT, SIDELINE_RIGHT, y as yardToY } from '../field/geometry.js';
import { renderField } from '../field/field.js';
import { STYLE, DEFS } from '../field/style.js';
import { num } from '../field/geometry.js';
import { escapeText } from '../field/escape.js';
import { gameView, GOAL_YARD, END_YARD } from './view.js';
import { tackleReach, headingOf } from './modes.js';
import { getPlayer } from './state.js';
import { sub, len } from './vec.js';
import {
  MAX_ARROW_UNITS, MAX_PASS_ARROW_UNITS, STANCE_CONE_HALF_ANGLE, DEBUG_VELOCITY_SECONDS,
  DEBUG_VELOCITY_TRIANGLE_SCALE, COVER_HALO_UNITS,
} from './constants.js';

/**
 * The pressable area over the sideline label. `<text>` only hit-tests where
 * its glyphs are, and 8.5px rotated type in the margin is a hard tap — so the
 * button is a transparent rectangle straddling the label's column, wide and
 * tall enough to hit with a thumb. Half-extents, in SVG units.
 */
const MENU_HIT_HALF_W = 10;
const MENU_HIT_HALF_H = 48;

/**
 * The message plate. SVG does not wrap text, so the wrap is done here by
 * character count against a budget that fits the end zone: at 9px the plate
 * is sized by an approximate advance width, which is why MESSAGE_CHAR_WIDTH
 * is a measured-ish constant rather than derived from anything. The number of
 * lines that wrap to is unbounded — the plate below is clamped to the board
 * (good to fourteen lines), and copy is not shortened to fit.
 */
const MESSAGE_MAX_CHARS = 34;
const MESSAGE_LINE_HEIGHT = 11;
const MESSAGE_CHAR_WIDTH = 5;
const MESSAGE_PAD = 6;

export const STYLE_GAME = [
  '.gp-o{fill:#222;stroke:#000;stroke-width:.6}',
  '.gp-d{fill:#fff;stroke:#000;stroke-width:.8}',
  '.gp-role{font:3px sans-serif;text-anchor:middle;fill:#fff;pointer-events:none}',
  '.gp-d + .gp-role, .gp-role.on-d{fill:#000}',
  '.stance{fill:none;stroke:#000;stroke-width:.7;stroke-dasharray:1.5 1}',
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
  // The debug velocity triangle. Filled, not stroked: it is an instrument,
  // drawn over the player, not part of the play.
  '.vel{fill:#1668dc;pointer-events:none}',
  // The throw arrow, deliberately unlike the run arrow: a throw is a different
  // verb and has to be tellable at a glance. Red, solid-dashed and heavier than
  // `.plan-mv`. Its opacity lives on the path for the same reason `.plan-mv`'s
  // does — app/main.js previews a bare passArrowMark() with no wrapper `<g>`.
  '.pass{fill:none;stroke:#b3261e;stroke-width:1.2;stroke-dasharray:3 2;opacity:.85}',
  '.arh-r{fill:#b3261e}',
  // `fill:transparent` still hit-tests under the default `visiblePainted`, but
  // `pointer-events:all` says so outright rather than relying on that.
  '.menu-hit{fill:transparent;pointer-events:all;cursor:pointer}',
  // Overrides `.pb` from the shared stylesheet — same specificity, and
  // STYLE_GAME is emitted after STYLE inside one <style>, so this wins. The
  // legend is a button in the game, so it is green like the plan arrows and
  // takes the pointer cursor; the standalone diagrams keep the grey.
  '.pb{fill:#1a7f37;cursor:pointer}',
  // The plate sits on the hatched end zone, so it needs a ground of its own.
  // Both parts are click-through: the board underneath still takes drags.
  '.msg-plate{fill:#ffffff;fill-opacity:.92;stroke:#000;stroke-width:.6;pointer-events:none}',
  '.msg{font:bold 9px system-ui,sans-serif;text-anchor:middle;fill:#000;pointer-events:none}',
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

export function renderBoardShell(losYard) {
  const view = gameView(losYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${height}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}${DEFS_GAME}` +
      `<g id="game-field">${svg}</g>` +
      // Order is z-order. Arrows and the live drag preview go under the
      // players; the overlay stays on top, because that is where the animated
      // loose ball is drawn.
      `<g id="game-arrows"></g><g id="game-preview"></g>` +
      `<g id="game-players"></g><g id="game-overlay"></g>` +
      `<g id="game-menu">${menuButtonMark()}</g>` +
      `<g id="game-message"></g>`,
  };
}

/**
 * The Coaches Menu button: an invisible rectangle over the sideline label.
 * Marked with `data-menu-button` rather than an id because app/main.js binds
 * the click on the board and matches on the way up — `rebuildBoard()` throws
 * every node under the <svg> away on each new down, and a listener bound to
 * this rect would go with it.
 *
 * This rect is the only opener for the menu, and everything the menu opens is
 * a closed `<dialog>` — out of the tab order until it is open. Without
 * `tabindex`/`role` here, the document would have no focusable element at all
 * until a pointer opened the menu once. `tabindex="0"` and `role="button"`
 * make it a keyboard stop like any other button; SVG shapes accept both in
 * every current browser.
 */
export function menuButtonMark() {
  const view = gameView(0);
  const midY = (view.fieldTopY + yardToY(view, END_YARD)) / 2;
  return (
    `<rect data-menu-button="1" class="menu-hit"` +
    ` tabindex="0" role="button" aria-label="Open the Coaches Menu"` +
    ` x="${num(PRESS_BOX_X - MENU_HIT_HALF_W)}" y="${num(midY - MENU_HIT_HALF_H)}"` +
    ` width="${num(MENU_HIT_HALF_W * 2)}" height="${num(MENU_HIT_HALF_H * 2)}"/>`
  );
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

function playerMark(player, isCarrier, tucked, showVelocity) {
  const cls = player.team === 'offense' ? 'gp-o' : 'gp-d';
  const parts = [`<circle cx="0" cy="0" r="${num(player.radius)}" class="${cls}"/>`];
  parts.push(`<text x="0" y="1" class="gp-role${player.team === 'defense' ? ' on-d' : ''}">${player.role}</text>`);
  if (player.mode === 'prepared' || player.mode === 'holding') parts.push(stanceArc(player));
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
 */
export function looseBallMark(pos) {
  return (
    `<g class="loose" data-loose-ball="1" transform="translate(${num(pos.x)}, ${num(pos.y)})">` +
    football(0, 0, 0) +
    `</g>`
  );
}

export function renderLooseBall(state) {
  if (state.ball.carrierId !== null || !state.ball.pos) return '';
  return looseBallMark(state.ball.pos);
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
 * The status message, drawn on a plate centred in the end zone — the one
 * patch of the board no player stands on while a down is being planned. A
 * touchdown breaks that: the ball carrier ends the play standing in the end
 * zone, right under the plate, which is on `game-message`, the topmost layer.
 * The plate is click-through, so the overlap is cosmetic, not a hit-testing
 * problem — but it is there. app/main.js writes this into `game-message`.
 */
export function renderMessage(text) {
  const lines = wrapWords(text, MESSAGE_MAX_CHARS);
  if (lines.length === 0) return '';

  const view = gameView(0);
  const midY = (yardToY(view, GOAL_YARD) + yardToY(view, END_YARD)) / 2;
  const blockHeight = lines.length * MESSAGE_LINE_HEIGHT;

  const widest = Math.max(...lines.map((l) => l.length));
  const plateW = Math.min(
    widest * MESSAGE_CHAR_WIDTH + MESSAGE_PAD * 2,
    SIDELINE_RIGHT - SIDELINE_LEFT,
  );
  const plateH = blockHeight + MESSAGE_PAD * 2;

  // Centred in the end zone, but clamped to the board. A three-line message —
  // the illegal-pass penalty is one — is taller than the end zone, so it grows
  // up over the goal line rather than sliding off the bottom edge. Messages are
  // not shortened to fit: the renderer is the thing that has to cope.
  //
  // The clamp holds for any message that fits the board at all — up to fourteen
  // lines. Past that the plate is taller than the viewBox itself, so it pins to
  // the top and overflows the bottom; that would be a caller writing an essay
  // into a status line, and truncating it silently would hide the bug rather
  // than show it.
  const plateY = Math.max(
    MESSAGE_PAD / 2,
    Math.min(midY - plateH / 2, view.height - plateH - MESSAGE_PAD / 2),
  );

  // Baselines sit three quarters down each line box, which reads as centred.
  const firstBaseline = plateY + MESSAGE_PAD + MESSAGE_LINE_HEIGHT * 0.75;
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
 * The human's plans. A plan that knows where it lands is drawn as a circle on
 * that spot; one that does not — the user pointed further than half a second
 * buys — keeps the old arrow, which says direction and force without promising
 * a destination it cannot deliver.
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
        : p.plan.target
          ? destinationMark(p.plan.target, p.radius)
          : arrowMark(p.pos, {
            x: p.pos.x + p.plan.dir.x * p.plan.throttle * MAX_ARROW_UNITS,
            y: p.pos.y + p.plan.dir.y * p.plan.throttle * MAX_ARROW_UNITS,
          });
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
 * The planned throw: a dashed red arrow from whoever is holding the ball. It
 * is deliberately unlike a run arrow — a throw is a different verb, and the
 * player has to be able to tell at a glance which one he drew. Nothing is
 * drawn once the planner no longer has the ball; the throw will not happen
 * either (releasePass cancels it), so drawing it would be a lie.
 */
export function renderPassArrow(state) {
  const planned = state.plannedPass;
  if (!planned || state.ball.carrierId !== planned.from) return '';
  const from = getPlayer(state, planned.from);
  const tip = passArrowTip(from.pos, planned.dir, planned.power);
  return `<g class="plan-arrow" data-pass="${planned.from}">${passArrowMark(from.pos, tip)}</g>`;
}
