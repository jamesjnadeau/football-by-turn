import { SVG } from './vendor/svg.esm.js';
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass,
} from '../lib/game/state.js';
import { clearAiPlans } from '../lib/game/ai.js';
import { runTurn, unplannedPlayers } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import {
  renderBoardShell, renderPlayers, renderPlans, renderPassArrow, renderLooseBall, looseBallMark,
  arrowMark, destinationMark, coverMark, passArrowMark, passArrowTip, renderMessage,
} from '../lib/game/render.js';
import { classifyGesture } from '../lib/game/gesture.js';
import { planForDrag } from '../lib/game/predict.js';
import { opponentAt, setCover } from '../lib/game/cover.js';
import { mulberry32 } from '../lib/game/rng.js';
import {
  TURN_SECONDS, MAX_ARROW_UNITS, PENALTY_YARDS, PICK_SLOP_UNITS,
} from '../lib/game/constants.js';
import { attachInput } from './input.js';
import { canUsePlays, capturePlay, applyPlay, isEmptyPlay } from '../lib/game/play.js';
import { PLAY_SLOTS, firstEmptySlot, putPlay } from '../lib/game/playbook.js';
import { loadPlaybook, savePlaybook } from './playbook-store.js';

// SVG(el) adopts the existing <svg id="board"> node rather than creating a
// nested one — every read/write below goes through this wrapper.
const board = SVG(document.getElementById('board'));
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const closeMenuBtn = document.getElementById('close-menu');
const savePlayBtn = document.getElementById('save-play');
const playSlotsEl = document.getElementById('play-slots');
const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
const aiBtn = document.getElementById('ai');
const debugBtn = document.getElementById('debug');
const nextBtn = document.getElementById('next');
const newBtn = document.getElementById('new');

let state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense' });
let random = mulberry32(state.seed);
let pendingWarning = false;
let messageText = '';
// runTurn is synchronous — state is already at the end of the turn while the
// animation is still walking the frames. Without this flag every control is
// live during that window and a second click runs a whole extra turn on top
// of the one being drawn. Set when animate() starts, cleared in finish().
let animating = false;
// A debug read-out, not game state: New Game replaces `state` wholesale, and
// the player's choice of whether to see velocities — on by default, but
// including having turned it off — should survive that.
let showVelocity = true;
// Not game state: the playbook outlives New Game, and lives in the browser
// rather than in `state`, which is replaced wholesale.
let playbook = loadPlaybook();

function layer(id) {
  return board.findOne(`#${id}`);
}

function rebuildBoard() {
  const { viewBox, markup } = renderBoardShell(state.losYard);
  board.attr('viewBox', viewBox);
  board.clear();
  board.svg(markup); // parses the markup string from render.js and inserts it as real SVG nodes
}

/**
 * Every button is dead while the turn is being drawn: Run Turn and Clear
 * Arrows would edit a plan for a turn that has already been simulated, and
 * Next Down / New Game would swap the state (and rebuild the board) out from
 * under the in-flight animate() loop. paint() runs again at the end of the
 * animation, which is what re-enables them.
 */
function paint() {
  layer('game-players').clear().svg(renderPlayers(state, { showVelocity }) + renderLooseBall(state));
  layer('game-arrows').clear().svg(
    state.phase === 'planning' ? renderPlans(state) + renderPassArrow(state) : '',
  );
  hud.textContent = `Down ${state.down} of 4 — ${state.phase}`;
  aiBtn.textContent = state.aiTeam ? 'Defense: computer' : 'Defense: you';
  aiBtn.disabled = animating || state.phase !== 'planning';
  debugBtn.textContent = `Velocity: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
  runBtn.disabled = animating || state.phase !== 'planning';
  clearBtn.disabled = animating;
  nextBtn.disabled = animating;
  newBtn.disabled = animating;
  nextBtn.hidden = state.phase !== 'playOver';
  drawMessage();
  paintPlays();
}

/**
 * The message lives on the board now, in the end zone. It is kept in a
 * variable rather than read back out of the DOM because `rebuildBoard()`
 * throws the whole layer away on every new down — `paint()` repaints it from
 * here afterwards.
 */
function drawMessage() {
  layer('game-message').clear().svg(renderMessage(messageText));
}

function say(text) {
  messageText = text;
  drawMessage();
}

function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and long-press — because every one of them
    // starts from a hit test that returns a player id.
    if (!isControllable(state, pl.id)) continue;
    const d = Math.hypot(pl.pos.x - p.x, pl.pos.y - p.y);
    if (d <= pl.radius + PICK_SLOP_UNITS && d < bestD) { best = pl.id; bestD = d; }
  }
  return best;
}

/**
 * The mark for a run drag: the circle when the spot is reachable this turn, the
 * old arrow when it is not. The live preview and the committed plan both come
 * through here so a drag never changes shape at the moment it is released.
 */
function runMark(player, plan) {
  return plan.target
    ? destinationMark(plan.target, player.radius)
    : arrowMark(player.pos, {
      x: player.pos.x + plan.dir.x * plan.throttle * MAX_ARROW_UNITS,
      y: player.pos.y + plan.dir.y * plan.throttle * MAX_ARROW_UNITS,
    });
}

/**
 * What a run drag should draw, given where the pointer is. Dragging onto one of
 * their players is a cover order; anything else is a destination or an arrow.
 * The live preview and the committed plan both ask this, so the picture never
 * changes shape at the moment the finger comes up.
 */
function runOrCoverMark(player, travel, point) {
  const opp = opponentAt(state, point, player.team);
  return opp
    ? coverMark(player, getPlayer(state, opp))
    : runMark(player, planForDrag(player, travel));
}

function onGesture(playerId, gesture, point) {
  if (animating) return; // mid-animation pointer input is not for this turn
  layer('game-preview').clear();
  if (state.phase !== 'planning') return;
  const p = getPlayer(state, playerId);
  if (gesture.kind === 'passdrag') {
    // Tap-then-drag is a throw only from the man with the ball. From anyone
    // else it is an ordinary run arrow — which is what the drag preview showed
    // him, so committing anything less would break that promise.
    if (setPass(state, playerId, gesture.dir, gesture.throttle)) {
      say(`${p.role} will throw.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target);
      say(`${p.role} doesn't have the ball — running instead.`);
    }
    pendingWarning = false;
  } else if (gesture.kind === 'drag') {
    const opp = opponentAt(state, point, p.team);
    if (opp && setCover(state, playerId, opp)) {
      say(`${p.role} will cover ${getPlayer(state, opp).role}.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target);
      say('');
    }
    pendingWarning = false;
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

function onDragPreview(playerId, log, prevTapAt) {
  if (animating) return; // the board belongs to the turn being drawn right now
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-preview').clear();
    return;
  }
  const g = classifyGesture(log, prevTapAt);
  if (g.kind !== 'drag' && g.kind !== 'passdrag') return;
  const p = getPlayer(state, playerId);
  // A throw only previews as a throw from the man actually holding the ball;
  // from anyone else a tap-then-drag is an ordinary run. Both marks come from
  // render.js, so the arrow being dragged and the arrow committed are the same
  // picture either way.
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  const mark = throwing
    ? passArrowMark(p.pos, passArrowTip(p.pos, g.dir, g.throttle))
    : runOrCoverMark(p, g.travel, log[log.length - 1]);
  layer('game-preview').clear().svg(mark);
}

/**
 * Walk the frames runTurn handed back. Player groups move by `transform`.
 *
 * The football is normally drawn INSIDE the carrier's group, so it rides
 * along for free — correct, and it keeps the ball on the carrier's leading
 * edge. But a turn containing a fumble breaks that: the ball is no longer the
 * carrier's, and it has its own per-frame position in `frame.ball`. For those
 * turns only, hide the football inside the player groups and give the ball a
 * node of its own in the overlay, driven from `frame.ball` every frame — so
 * it pops out, rolls, and ends up on whoever recovered it, instead of staying
 * glued to the former carrier until the post-turn paint().
 */
function animate(frames, done) {
  const perFrame = (TURN_SECONDS * 1000) / frames.length;
  const playersLayer = layer('game-players');
  const overlay = layer('game-overlay');
  // Either the ball comes loose during this turn, or it was already loose when
  // the turn started (the last paint drew it as its own node in game-players).
  const ballComesLoose = frames.some((f) => f.looseBall)
    || playersLayer.node.querySelector('[data-loose-ball]') !== null;
  let ballNode = null;
  if (ballComesLoose) {
    for (const fb of playersLayer.node.querySelectorAll('.fb')) fb.style.display = 'none';
    overlay.clear().svg(looseBallMark(frames[0].ball || { x: 0, y: 0 }));
    ballNode = overlay.node.querySelector('[data-loose-ball]');
  }
  let i = 0;
  function tick() {
    const frame = frames[i];
    for (const fp of frame.players) {
      const g = playersLayer.findOne(`[data-id="${fp.id}"]`);
      if (g) g.transform({ translate: [fp.x, fp.y] });
    }
    if (ballNode && frame.ball) {
      ballNode.setAttribute('transform', `translate(${frame.ball.x}, ${frame.ball.y})`);
    }
    i += 1;
    if (i < frames.length) setTimeout(() => requestAnimationFrame(tick), perFrame);
    else {
      if (ballNode) overlay.clear(); // paint() redraws the ball in its resting place
      done();
    }
  }
  requestAnimationFrame(tick);
}

/**
 * The five load buttons are built once and thereafter only relabelled.
 * paint() runs on every gesture — rebuilding the nodes each time would throw
 * away the focus of anyone tabbing the menu with the keyboard.
 */
const slotBtns = [];
for (let i = 0; i < PLAY_SLOTS; i++) {
  const btn = document.createElement('button');
  btn.className = 'play-slot';
  btn.addEventListener('click', () => callPlay(i));
  playSlotsEl.appendChild(btn);
  slotBtns.push(btn);
}

/**
 * A play is what you come to the line with, so both saving and calling one are
 * offered only on the first turn of a down. Off it the buttons go grey rather
 * than disappearing: a grey button explains itself, a vanished one does not.
 */
function paintPlays() {
  const usable = !animating && canUsePlays(state);
  savePlayBtn.disabled = !usable;
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const play = playbook[i];
    slotBtns[i].textContent = play ? `${i + 1}. ${play.name}` : `${i + 1}. (empty)`;
    slotBtns[i].disabled = !usable || !play;
  }
}

/**
 * Saving fills the lowest empty slot, and only asks which slot to replace once
 * all five are taken. The menu stays open if the coach cancels a prompt — he
 * asked for nothing to happen, and closing the menu is something happening.
 */
function savePlay() {
  if (animating || !canUsePlays(state)) return;
  if (isEmptyPlay(capturePlay(state, ''))) {
    closeMenu();
    say('Nothing to save yet. Draw some arrows first.');
    return;
  }
  const name = (window.prompt('Name this play:', '') ?? '').trim();
  if (!name) return; // cancelled, or named nothing
  const play = capturePlay(state, name); // capturePlay is what cuts the name to length
  let slot = firstEmptySlot(playbook);
  if (slot === -1) {
    const answer = window.prompt(
      `All ${PLAY_SLOTS} slots are full. Replace which one (1-${PLAY_SLOTS})?`,
      '1',
    );
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > PLAY_SLOTS) return;
    slot = n - 1;
  }
  playbook = putPlay(playbook, slot, play);
  const kept = savePlaybook(playbook);
  closeMenu();
  say(kept
    ? `Saved "${play.name}" to slot ${slot + 1}.`
    : `Saved "${play.name}" to slot ${slot + 1} for this session only.`);
  paint();
}

/**
 * Calling a play replaces whatever is drawn — it is a huddle, not an edit. Any
 * of it that could not be given (a defender in a play saved in hot-seat, a tuck
 * by a man who does not have the ball this time) is counted out loud rather
 * than passed over in silence.
 */
function callPlay(i) {
  if (animating || !canUsePlays(state)) return;
  const play = playbook[i];
  if (!play) return;
  const { applied, skipped } = applyPlay(state, play);
  pendingWarning = false; // a new plan gets a fresh warning, like any drag does
  closeMenu();
  say(skipped.length === 0
    ? `"${play.name}" called. ${applied.length} player(s) set.`
    : `"${play.name}" called. ${applied.length} set, ${skipped.length} skipped.`);
  paint();
}

function openMenu() {
  if (!menu.open) menu.showModal();
}

function closeMenu() {
  if (menu.open) menu.close();
}

// The hit rect is re-created by every rebuildBoard(), so the listener goes on
// the board and matches on the way up rather than on the rect itself.
board.on('click', (e) => {
  if (e.target.closest && e.target.closest('[data-menu-button]')) openMenu();
});

// The hit rect is the only opener for the menu, and the menu's controls live
// inside a closed <dialog> — out of the tab order until it is open. Without
// this, a keyboard user who tabbed to the rect could never actually press it.
// Space is also prevented from scrolling the page, same as a native button.
board.on('keydown', (e) => {
  if (!e.target.closest || !e.target.closest('[data-menu-button]')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openMenu();
  }
});

// Content is inside .menu-body, so a click whose target IS the dialog landed
// on the backdrop. Esc is handled natively by showModal().
menu.addEventListener('click', (e) => {
  if (e.target === menu) closeMenu();
});

closeMenuBtn.addEventListener('click', closeMenu);
savePlayBtn.addEventListener('click', savePlay);

runBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || state.phase !== 'planning') return;
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
  const thrown = events.some((e) => e.type === 'pass');
  const finish = () => {
    animating = false;
    paint();
    for (const e of events) {
      if (e.type === 'tackled') say('Tackled!');
      if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
      if (e.type === 'touchdown') say('TOUCHDOWN!');
      if (e.type === 'out-of-bounds') say('Out of bounds.');
      if (e.type === 'pickup') {
        if (!thrown) say(`Recovered by ${e.team}.`);
        else say(e.team === 'defense' ? 'INTERCEPTED!' : 'Caught!');
      }
      if (e.type === 'incomplete') say('Incomplete.');
    }
    // The flag is called after the down, not when it was thrown — the spec is
    // explicit that an illegal throw is allowed to play out first.
    if (state.phase === 'playOver' && state.penalty) {
      say(state.penalty.foul === 'second-forward-pass'
        ? `FLAG: two forward passes. ${PENALTY_YARDS} yards from the previous spot, loss of down.`
        : `FLAG: forward pass from beyond the line. ${PENALTY_YARDS} yards from the previous spot, loss of down.`);
    }
  };
  if (frames.length > 0) {
    // Lock the controls now, not at the next paint() — paint() does not run
    // again until finish(), and until then every button is still live.
    animating = true;
    runBtn.disabled = true;
    clearBtn.disabled = true;
    nextBtn.disabled = true;
    newBtn.disabled = true;
    aiBtn.disabled = true;
    debugBtn.disabled = true;
    animate(frames, finish);
  } else finish();
});

clearBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || state.phase !== 'planning') return;
  clearAllPlans(state);
  pendingWarning = false;
  paint();
});

aiBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || state.phase !== 'planning') return;
  state.aiTeam = state.aiTeam === null ? 'defense' : null;
  // Handing the defense back to the computer drops whatever arrows the human
  // had already drawn for it — they are not his to give any more.
  if (state.aiTeam) clearAiPlans(state);
  pendingWarning = false;
  say(state.aiTeam
    ? 'The computer coaches the defense.'
    : 'Hot-seat: you coach both teams.');
  paint();
});

debugBtn.addEventListener('click', () => {
  closeMenu();
  // Dead while a turn is being drawn, like every other control: paint()
  // rewrites the player layer, which would throw away the transforms the
  // animation loop is driving. The lines a running turn shows are the
  // velocities from the last paint — the read-out refreshes when it lands.
  if (animating) return;
  showVelocity = !showVelocity;
  paint();
});

nextBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
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
  closeMenu();
  if (animating) return;
  state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense' });
  random = mulberry32(state.seed);
  pendingWarning = false;
  say('New game. 1st and goal from the 10.');
  rebuildBoard();
  paint();
});

attachInput(board, { hitTest, onGesture, onDragPreview });
rebuildBoard();
paint();
say('Drag your players, then open the Coaches Menu to run the turn.');
