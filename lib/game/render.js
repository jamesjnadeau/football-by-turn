/**
 * Everything the game paints, as strings — same discipline as the vendored
 * renderer, so `node --test` can assert on markup without a DOM. app/main.js
 * writes these into the layer groups; per-frame animation only rewrites the
 * `transform` of each player group.
 */
import { VIEWBOX_WIDTH } from '../field/geometry.js';
import { renderField } from '../field/field.js';
import { STYLE, DEFS } from '../field/style.js';
import { num } from '../field/geometry.js';
import { gameView } from './view.js';
import { tackleReach, headingOf } from './modes.js';
import { MAX_ARROW_UNITS, STANCE_CONE_HALF_ANGLE } from './constants.js';

export const STYLE_GAME = [
  '.gp-o{fill:#222;stroke:#000;stroke-width:.6}',
  '.gp-d{fill:#fff;stroke:#000;stroke-width:.8}',
  '.gp-role{font:3px sans-serif;text-anchor:middle;fill:#fff;pointer-events:none}',
  '.gp-d + .gp-role, .gp-role.on-d{fill:#000}',
  '.stance{fill:none;stroke:#000;stroke-width:.7;stroke-dasharray:1.5 1}',
  '.fb{fill:#7b4a12;stroke:#000;stroke-width:.4}',
  '.plan-arrow{opacity:.85}',
].join('');

export function renderBoardShell(losYard) {
  const view = gameView(losYard);
  const { svg, height } = renderField(view);
  return {
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${height}`,
    markup:
      `<style>${STYLE}${STYLE_GAME}</style>${DEFS}` +
      `<g id="game-field">${svg}</g>` +
      `<g id="game-arrows"></g><g id="game-players"></g><g id="game-overlay"></g>`,
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

function playerMark(player, isCarrier, tucked) {
  const cls = player.team === 'offense' ? 'gp-o' : 'gp-d';
  const parts = [`<circle cx="0" cy="0" r="${num(player.radius)}" class="${cls}"/>`];
  parts.push(`<text x="0" y="1" class="gp-role${player.team === 'defense' ? ' on-d' : ''}">${player.role}</text>`);
  if (player.mode === 'prepared' || player.mode === 'holding') parts.push(stanceArc(player));
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

export function renderPlayers(state) {
  return state.players
    .map((p) => playerMark(p, state.ball.carrierId === p.id, p.mode === 'tucked'))
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
 * The human's plans, drawn as arrows. The team the computer coaches is skipped:
 * turn.js already guarantees those plans never exist during a planning phase,
 * and this is the second lock on the same door — the requirement is "don't show
 * the defense's planned movements", and this is the file that would show them.
 */
export function renderArrows(state) {
  return state.players
    .filter((p) => p.plan && p.team !== state.aiTeam)
    .map((p) => {
      const tip = {
        x: p.pos.x + p.plan.dir.x * p.plan.throttle * MAX_ARROW_UNITS,
        y: p.pos.y + p.plan.dir.y * p.plan.throttle * MAX_ARROW_UNITS,
      };
      return `<g class="plan-arrow" data-for="${p.id}"><path d="M ${num(p.pos.x)} ${num(p.pos.y)} L ${num(tip.x)} ${num(tip.y)}" class="mv" marker-end="url(#ar)"/></g>`;
    })
    .join('');
}
