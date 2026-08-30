import { SVG } from './vendor/svg.esm.js';
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans,
} from '../lib/game/state.js';
import { runTurn, unplannedPlayers } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import {
  renderBoardShell, renderPlayers, renderArrows, renderLooseBall,
} from '../lib/game/render.js';
import { classifyGesture } from '../lib/game/gesture.js';
import { mulberry32 } from '../lib/game/rng.js';
import { TURN_SECONDS, MAX_ARROW_UNITS } from '../lib/game/constants.js';
import { attachInput } from './input.js';

// SVG(el) adopts the existing <svg id="board"> node rather than creating a
// nested one — every read/write below goes through this wrapper.
const board = SVG(document.getElementById('board'));
const hud = document.getElementById('hud');
const message = document.getElementById('message');
const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
const nextBtn = document.getElementById('next');
const newBtn = document.getElementById('new');

let state = createGame({ seed: (Math.random() * 2 ** 31) | 0 });
let random = mulberry32(state.seed);
let pendingWarning = false;

function layer(id) {
  return board.findOne(`#${id}`);
}

function rebuildBoard() {
  const { viewBox, markup } = renderBoardShell(state.losYard);
  board.attr('viewBox', viewBox);
  board.clear();
  board.svg(markup); // parses the markup string from render.js and inserts it as real SVG nodes
}

function paint() {
  layer('game-players').clear().svg(renderPlayers(state) + renderLooseBall(state));
  layer('game-arrows').clear().svg(state.phase === 'planning' ? renderArrows(state) : '');
  hud.textContent = `Down ${state.down} of 4 — ${state.phase}`;
  runBtn.disabled = state.phase !== 'planning';
  nextBtn.hidden = state.phase !== 'playOver';
}

function say(text) {
  message.textContent = text;
}

function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.y - p.y);
    if (d <= pl.radius + 2 && d < bestD) { best = pl.id; bestD = d; }
  }
  return best;
}

function onGesture(playerId, gesture, point) {
  layer('game-overlay').clear();
  if (state.phase !== 'planning') return;
  const p = getPlayer(state, playerId);
  if (gesture.kind === 'drag') {
    setPlan(state, playerId, gesture.dir, gesture.throttle);
    pendingWarning = false;
    say('');
  } else if (gesture.kind === 'longpress') {
    const target =
      p.mode !== 'normal' ? 'normal'
      : state.ball.carrierId === playerId ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      : 'holding';
    if (!setMode(state, playerId, target)) say(`${p.role} can't do that.`);
    else say(target === 'normal' ? `${p.role} back to normal.` : `${p.role}: ${target}.`);
  }
  // gesture.kind === 'click': a tap on a player does nothing (player
  // placement is out of scope for this task — see lib/game/state.js's
  // placePlayer, which is implemented and tested but not wired up here).
  paint();
}

function onDragPreview(playerId, log) {
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-overlay').clear();
    return;
  }
  const g = classifyGesture(log);
  if (g.kind !== 'drag') return;
  const p = getPlayer(state, playerId);
  const tipX = p.pos.x + g.dir.x * g.throttle * MAX_ARROW_UNITS;
  const tipY = p.pos.y + g.dir.y * g.throttle * MAX_ARROW_UNITS;
  layer('game-overlay').clear().svg(
    `<path d="M ${p.pos.x} ${p.pos.y} L ${tipX} ${tipY}" class="mv" marker-end="url(#ar)"/>`,
  );
}

function animate(frames, done) {
  const perFrame = (TURN_SECONDS * 1000) / frames.length;
  let i = 0;
  function tick() {
    const frame = frames[i];
    for (const fp of frame.players) {
      const g = layer('game-players').findOne(`[data-id="${fp.id}"]`);
      if (g) g.transform({ translate: [fp.x, fp.y] });
    }
    i += 1;
    if (i < frames.length) setTimeout(() => requestAnimationFrame(tick), perFrame);
    else done();
  }
  requestAnimationFrame(tick);
}

runBtn.addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  const missing = unplannedPlayers(state);
  if (missing.length > 0 && !pendingWarning) {
    // Spec: warn when not every player has a direction. Second press runs anyway.
    pendingWarning = true;
    say(`${missing.length} player(s) have no direction set. Press Run Turn again to run anyway.`);
    return;
  }
  pendingWarning = false;
  say('');
  // runTurn mutates state to the end-of-turn position and returns the
  // per-sub-step frames; the player groups are still painted at their
  // pre-turn spots, so animating the frames walks them to where state says.
  const { frames, events } = runTurn(state, random);
  layer('game-arrows').clear();
  const finish = () => {
    paint();
    for (const e of events) {
      if (e.type === 'tackled') say('Tackled!');
      if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
      if (e.type === 'touchdown') say('TOUCHDOWN!');
      if (e.type === 'out-of-bounds') say('Out of bounds.');
      if (e.type === 'pickup') say(`Recovered by ${e.team}.`);
    }
  };
  if (frames.length > 0) animate(frames, finish);
  else finish();
});

clearBtn.addEventListener('click', () => {
  if (state.phase !== 'planning') return;
  clearAllPlans(state);
  pendingWarning = false;
  paint();
});

nextBtn.addEventListener('click', () => {
  nextDown(state);
  if (state.phase === 'gameOver') {
    say(state.result === 'touchdown' ? 'TOUCHDOWN — you win!'
      : state.result === 'turnover-on-downs' ? 'Turnover on downs. Game over.'
      : 'Fumble recovered by the defense. Game over.');
  } else {
    say(`${['1st', '2nd', '3rd', '4th'][state.down - 1]} down.`);
    rebuildBoard();
  }
  paint();
});

newBtn.addEventListener('click', () => {
  state = createGame({ seed: (Math.random() * 2 ** 31) | 0 });
  random = mulberry32(state.seed);
  pendingWarning = false;
  say('New game. 1st and goal from the 10.');
  rebuildBoard();
  paint();
});

attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
