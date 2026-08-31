import { SVG } from './vendor/svg.esm.js';
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass, ballPos,
} from '../lib/game/state.js';
import {
  canReposition, placePlayer, spotFault, alignDefense, lineCount, setPersonnel,
} from '../lib/game/formation.js';
import { clearAiPlans, AI_MODES, aiModeIndex, nextAiMode, defaultModeForSide } from '../lib/game/ai.js';
import { runTurn, unplannedPlayers } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import {
  renderBoardShell, renderPlayers, renderPlans, renderPassArrow, renderLooseBall, looseBallMark,
  planMark, coverMark, passArrowMark, passArrowTip, renderMessage, destinationMark,
  lineZoneMark, renderFieldButtons, passLandingMark, passLockMark, cameraViewBox,
  menuButtonMark, liveLobMark,
} from '../lib/game/render.js';
import { classifyGesture } from '../lib/game/gesture.js';
import { downDistanceText, gameOverMessage, kickoffMessage, humanSide } from '../lib/game/hud.js';
import { planForDrag } from '../lib/game/predict.js';
import { opponentAt, setCover } from '../lib/game/cover.js';
import { mulberry32 } from '../lib/game/rng.js';
import { receiverAt, lockOnPass, passLanding } from '../lib/game/pass.js';
import { lobLanded } from '../lib/game/lob.js';
import {
  TURN_SECONDS, PENALTY_YARDS, PICK_SLOP_UNITS, DEAD_BALL_PAUSE_SECONDS,
} from '../lib/game/constants.js';
import {
  minOnLine, DEFAULT_VARIANT, OFFENSIVE_LINE_ROLES, PERSONNEL_PACKAGES, personnelId,
} from '../lib/game/rosters.js';
import { followYard, yardsOfY } from '../lib/game/view.js';
import { attachInput } from './input.js';
import { canUsePlays, capturePlay, applyPlay, isEmptyPlay } from '../lib/game/play.js';
import {
  PLAY_SLOTS, firstEmptySlot, putPlay, bookFor, putBook, playbookSide, playbookHeading,
} from '../lib/game/playbook.js';
import { loadLibrary, saveLibrary } from './playbook-store.js';
import {
  captureSnapshot, appendSnapshot, emptyCoachLog, serializeCoachLog,
} from '../lib/game/coach-log.js';
import {
  observationFromSnapshot, observePlay, emptyTendencies,
} from '../lib/game/tendencies.js';
import {
  loadCoachLog, saveCoachLog, clearCoachLog,
  loadTendencies, saveTendencies, clearTendencies,
} from './coach-store.js';
import { autoplanOffense } from '../lib/game/offense.js';
import { realignLearnedDefense } from '../lib/game/learned/formation.js';

// SVG(el) adopts the existing <svg id="board"> node rather than creating a
// nested one — every read/write below goes through this wrapper.
const board = SVG(document.getElementById('board'));
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const closeMenuBtn = document.getElementById('close-menu');
const playsHeading = document.getElementById('plays-heading');
const savePlayBtn = document.getElementById('save-play');
const playSlotsEl = document.getElementById('play-slots');
const runBtn = document.getElementById('run');
const clearBtn = document.getElementById('clear');
const autoplanBtn = document.getElementById('autoplan-offense');
const aiBtn = document.getElementById('ai');
const repositionBtn = document.getElementById('reposition');
const personnelBtn = document.getElementById('personnel');
const debugBtn = document.getElementById('debug');
const nextBtn = document.getElementById('next');
const newBtn = document.getElementById('new');
const homeBtn = document.getElementById('home-btn');
const copyLogBtn = document.getElementById('copy-log');
const clearLogBtn = document.getElementById('clear-log');

let state = createGame({ seed: (Math.random() * 2 ** 31) | 0, ai: 'defense', aiLevel: 'smart' });
// Which game this drive is: the id of the home-screen button that started it.
// startGame() sets it and New Game re-reads it, so New Game deals the same game
// again — switching is what Back to Home is for.
let variantId = DEFAULT_VARIANT;
// How the human chose to play this visit — 'offense', 'defense' or
// 'training', held exactly the way variantId is: New Game re-deals it,
// Back to Home is how you change it.
let sideId = 'training';
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
// Not game state: the playbooks outlive New Game, and live in the browser
// rather than in `state`, which is replaced wholesale. Two books, one per
// side of the ball — a defensive coach is never offered arrows drawn for men
// he does not have.
let library = loadLibrary();
// What the computer has learned about this coach. Not game state, for the
// same reason the playbook is not: New Game replaces `state` wholesale, and
// a habit is something you carry between drives, not something a fresh down
// forgets. The log is the raw record (exportable, and what tools/ghost.js
// replays); the counts are what the learned defense actually reads.
let coachLog = loadCoachLog();
let tendencies = loadTendencies();

/**
 * The five slots for the side being coached right now. Asked fresh every time
 * rather than kept in a variable: the Defense button can hand the human the
 * other team mid-drive, and the menu has to follow it.
 */
function myBook() {
  return bookFor(library, playbookSide(state));
}
// Whether drags are moving players around the line rather than giving them
// orders. A coaching input mode, like `showVelocity` — the game does not care
// which one the coach is in, only where his players ended up standing. It is
// switched off by anything that ends the huddle: the snap, the next down, a
// new game.
let repositioning = false;

function layer(id) {
  return board.findOne(`#${id}`);
}

/**
 * Where the camera is looking, worked out from the state rather than kept in a
 * variable of its own. followYard is anchored to the line of scrimmage, so the
 * answer depends only on the down and where the ball is -- there is no camera
 * position to reset at the snap and none that can drift out of step with the
 * board. animate() calls the same function per frame with the ball of that
 * frame; everything else asks about the ball as it stands.
 */
function cameraYard(ballYard = null) {
  if (ballYard !== null) return followYard(state.losYard, ballYard);
  const bp = ballPos(state);
  return bp ? followYard(state.losYard, yardsOfY(bp.y)) : state.losYard;
}

function rebuildBoard() {
  const cam = cameraYard();
  const { viewBox, markup } = renderBoardShell(state.losYard, state.toGoYard, cam);
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
/**
 * Point the board at `cam`: the crop, and everything pinned to the screen
 * rather than to the field.
 *
 * The menu plate is repainted here with its two neighbours rather than left in
 * the board shell where it used to live: the three are one column, and a
 * scrolling run moves the window out from under anything placed once at the
 * snap. animate() calls this every frame for the same reason -- the column
 * and the message would otherwise slide off with the field for half a second
 * and snap back at the whistle.
 */
function aimCamera(cam) {
  board.attr('viewBox', cameraViewBox(state.losYard, cam));
  layer('game-menu').clear().svg(menuButtonMark(state.losYard, cam));
  layer('game-buttons').clear().svg(
    renderFieldButtons(state, { repositioning, animating, cameraYard: cam }),
  );
  layer('game-message').clear().svg(renderMessage(messageText, state.losYard, cam));
}

function paint() {
  layer('game-players').clear().svg(renderPlayers(state, { showVelocity }) + renderLooseBall(state));
  // The band goes in `game-arrows`, beneath the players, so a man standing in
  // it still reads as a man rather than as a man behind glass. While
  // repositioning there are no arrows to draw anyway — that is the mode.
  layer('game-arrows').clear().svg(
    // The landing circle outlives the plan that drew it — state.plannedPass is
    // gone by the end of the very turn a lob is thrown, but the throw itself
    // can still be hanging turns later, and the coach still needs to see
    // where it might come down. Drawn in every mode below, since a lob in the
    // air is a fact about the board, not an order still being given.
    liveLobMark(state) + (
      // Repositioning draws no ORDERS — that is the mode, and moving a man drops
      // his anyway. The snap is not one of his orders though, and it is aimed
      // between the two men most likely to be moved, so it stays on the board:
      // it is the one arrow that answers "what did that just do?".
      repositioning ? lineZoneMark(state) + (state.plannedPass?.auto ? renderPassArrow(state) : '')
      : state.phase === 'planning' ? renderPlans(state) + renderPassArrow(state)
      : ''
    ),
  );
  hud.textContent = `${downDistanceText(state)} — ${state.phase}`;
  aiBtn.textContent = AI_MODES[aiModeIndex(state)].label;
  aiBtn.disabled = animating || state.phase !== 'planning';
  repositionBtn.textContent = `Reposition: ${repositioning ? 'on' : 'off'}`;
  repositionBtn.disabled = animating || !canReposition(state);
  personnelBtn.textContent = `Personnel: ${personnelId(state.variantId)}`;
  personnelBtn.disabled = animating || !canReposition(state);
  debugBtn.textContent = `Velocity: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
  copyLogBtn.textContent = `Copy coaching log (${coachLog.length})`;
  copyLogBtn.disabled = animating || coachLog.length === 0;
  clearLogBtn.disabled = animating || (coachLog.length === 0 && tendencies.plays === 0);
  runBtn.disabled = animating || state.phase !== 'planning';
  autoplanBtn.disabled = animating || state.phase !== 'planning' || state.aiTeam === 'offense';
  clearBtn.disabled = animating;
  nextBtn.disabled = animating;
  newBtn.disabled = animating;
  homeBtn.disabled = animating;
  nextBtn.hidden = state.phase !== 'playOver';
  // The board's own two buttons are redrawn every paint rather than built with
  // the board, which is what lets the shuffle disappear at the snap and the
  // run button grey out — the menu hit rect beside them never changes, so it
  // stays in the shell.
  // The crop is re-asserted on every paint, not just on a rebuild: a play that
  // scrolled downfield ends with the camera well past the line of scrimmage,
  // and the board has to stay there until the next down re-spots the ball.
  aimCamera(cameraYard());
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
  layer('game-message').clear().svg(renderMessage(messageText, state.losYard, cameraYard()));
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
 * What a run drag should draw, given where the pointer is. Dragging onto one of
 * their players is a cover order; anything else is a destination, plus an arrow
 * when the drag went further than the turn reaches.
 * The live preview and the committed plan both ask this, so the picture never
 * changes shape at the moment the finger comes up.
 */
function runOrCoverMark(player, travel, point) {
  const opp = opponentAt(state, point, player.team);
  return opp
    ? coverMark(player, getPlayer(state, opp))
    : planMark(player, planForDrag(player, travel));
}

/**
 * What a throw drag should draw, given where the pointer is: the lock-on mark
 * when it has landed on one of your own inside the lock zone, otherwise the
 * arrow — plus the landing circle when the throw is long enough to arc. The
 * live preview and the committed throw draw from the same marks, so the
 * picture never changes shape at the moment the finger comes up.
 */
function throwMark(player, g, point) {
  const lock = receiverAt(state, point, player.id);
  if (lock) return passLockMark(player, getPlayer(state, lock));
  const land = passLanding(player, g.dir, g.throttle);
  return (land ? passLandingMark(land.pos, land.radius) : '')
    + passArrowMark(player.pos, passArrowTip(player.pos, g.dir, g.throttle));
}

/** What the referee announces, per foul. */
const FOUL_WORDS = {
  'second-forward-pass': 'two forward passes',
  'illegal-forward-pass': 'forward pass from beyond the line',
  'illegal-formation': 'illegal formation',
};

/** Why a spot was refused, in words the coach can act on. */
const FAULT_WORDS = {
  'past-line': (p) => `${p.role} can't line up past the line.`,
  'out-of-bounds': (p) => `${p.role} would be out of bounds there.`,
  occupied: (p) => `No room for ${p.role} there.`,
  'outside-hashes': (p) => `${p.role} has the ball — he has to snap it from between the hashes.`,
};

/**
 * How the formation reads right now. Shown after every move, because the
 * counting rule is the one thing a coach cannot see by looking at the board —
 * and an illegal formation is allowed to happen, so it has to be said out loud
 * before the snap rather than discovered by the flag afterwards.
 */
function formationNote() {
  const n = lineCount(state, 'offense');
  const need = minOnLine(state);
  return n < need
    ? `${n} on the line — ILLEGAL FORMATION (needs ${need}).`
    : `${n} on the line.`;
}

/**
 * Answer the offense's new look. Only when the computer is coaching the
 * defense: in hot-seat the coach is placing both teams by hand, and aligning
 * over the top of him would throw away the spots he just set. A learned
 * defense doesn't actually answer the look — its genome spots are fixed —
 * so it just holds its ground instead; only the rule-based fallback reads
 * the offense's current positions.
 */
function realignDefense() {
  if (state.aiTeam !== 'defense') return;
  if (realignLearnedDefense(state)) return;
  for (const { id, pos } of alignDefense(state)) getPlayer(state, id).pos = pos;
}

/**
 * A drag while repositioning moves the man rather than ordering him about. The
 * drop point is where he goes — not the drag vector, which is a force, and a
 * force is exactly the thing this mode is not for.
 */
function reposition(playerId, point) {
  const p = getPlayer(state, playerId);
  const fault = spotFault(state, playerId, point);
  if (fault) {
    say(FAULT_WORDS[fault](p));
    return;
  }
  if (!placePlayer(state, playerId, point)) return;
  realignDefense();
  pendingWarning = false;
  say(formationNote());
}

function onGesture(playerId, gesture, point) {
  if (animating) return; // mid-animation pointer input is not for this turn
  layer('game-preview').clear();
  if (state.phase !== 'planning') return;
  const p = getPlayer(state, playerId);
  if (repositioning) {
    // Every verb but the drag is off in this mode: no arrows, no cover orders,
    // no stances, and a tap-then-drag is a move like any other drag rather than
    // a throw. You are setting a formation, which is one thing.
    if (gesture.kind === 'drag' || gesture.kind === 'passdrag') reposition(playerId, point);
    paint();
    return;
  }
  if (gesture.kind === 'passdrag') {
    // Tap-then-drag is a throw only from the man with the ball. From anyone
    // else it is an ordinary run arrow — which is what the drag preview showed
    // him, so committing anything less would break that promise.
    //
    // Dropping it on one of your own inside the lock zone aims the throw at
    // HIM: direction and power both come from where he is standing, and the
    // drag's own length stops mattering. That is the same bargain a run drag
    // onto an opponent already makes when it becomes a cover order.
    const lock = state.ball.carrierId === playerId ? receiverAt(state, point, playerId) : null;
    const rec = lock ? getPlayer(state, lock) : null;
    const aim = rec ? lockOnPass(p, rec) : { dir: gesture.dir, power: gesture.throttle };
    if (setPass(state, playerId, aim.dir, aim.power, lock)) {
      say(rec ? `${p.role} will throw to ${rec.role}.`
        : passLanding(p, aim.dir, aim.power) ? `${p.role} will lob it deep.`
        : `${p.role} will throw.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target, run.short);
      say(`${p.role} doesn't have the ball — running instead.`);
    }
    pendingWarning = false;
  } else if (gesture.kind === 'drag') {
    const opp = opponentAt(state, point, p.team);
    if (opp && setCover(state, playerId, opp)) {
      say(`${p.role} will cover ${getPlayer(state, opp).role}.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target, run.short);
      say('');
    }
    pendingWarning = false;
  } else if (gesture.kind === 'longpress') {
    const target =
      p.mode !== 'normal' ? 'normal'
      // An offensive lineman can never tuck (setMode refuses it outright), so
      // this has to be checked before the carrier-tucked branch below —
      // otherwise a long press on the centre pre-snap (he's the placeholder
      // ball carrier before the snap) would offer 'tucked' and setMode would
      // silently refuse it. On the snap itself he gets the cut block instead;
      // any other turn he falls through to holding like any other lineman.
      : p.team === 'offense' && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0 ? 'cutBlock'
      : state.ball.carrierId === playerId && !OFFENSIVE_LINE_ROLES.has(p.role) ? 'tucked'
      : p.team === 'defense' ? 'prepared'
      : 'holding';
    if (!setMode(state, playerId, target)) say(`${p.role} can't do that.`);
    else say(target === 'normal' ? `${p.role} back to normal.` : `${p.role}: ${target === 'cutBlock' ? 'cut block' : target}.`);
  }
  // gesture.kind === 'click': a tap on a player does nothing. Moving him is a
  // drag, and only in reposition mode — a tap is how you arm a throw, and it
  // cannot also be how you move somebody.
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
  if (repositioning) {
    // The same filled circle a destination gets, for the same reason: it is
    // where this player ends up. Drawn only on spots he may actually take, so
    // the mark under the finger is a promise and not a suggestion.
    const point = log[log.length - 1];
    layer('game-preview').clear().svg(
      spotFault(state, playerId, point) ? '' : destinationMark(point, p.radius),
    );
    return;
  }
  // A throw only previews as a throw from the man actually holding the ball;
  // from anyone else a tap-then-drag is an ordinary run. Both marks come from
  // render.js, so the arrow being dragged and the arrow committed are the same
  // picture either way.
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  const mark = throwing
    ? throwMark(p, g, log[log.length - 1])
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
    // Scroll with the ball -- the BALL, not the carrier, so a fumble bouncing
    // downfield stays on screen instead of leaving the window with nobody
    // holding it. Only the viewBox is written: the field underneath was drawn
    // across every yard of the hundred and twenty when the board was built, so
    // there is nothing to redraw as the crop moves.
    if (frame.ball) aimCamera(cameraYard(yardsOfY(frame.ball.y)));
    for (const fp of frame.players) {
      const g = playersLayer.findOne(`[data-id="${fp.id}"]`);
      if (g) g.transform({ translate: [fp.x, fp.y] });
    }
    if (ballNode && frame.ball) {
      // Size as well as position: a lob is over everyone's heads in the middle
      // of its flight, and on a board with no z axis that is said by drawing it
      // bigger. A ball that is not lobbing reports a scale of 1 every frame.
      const size = frame.looseBall ? frame.looseBall.scale : 1;
      ballNode.setAttribute('transform', `translate(${frame.ball.x}, ${frame.ball.y}) scale(${size})`);
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
 *
 * Which five plays these are follows the side the human is coaching, and the
 * heading says which — a coach who hands the computer the other team is
 * looking at a different book a moment later, and five relabelled buttons with
 * nothing to explain them read as five lost plays.
 */
function paintPlays() {
  const usable = !animating && canUsePlays(state);
  const book = myBook();
  playsHeading.textContent = playbookHeading(state);
  savePlayBtn.disabled = !usable;
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const play = book[i];
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
  if (isEmptyPlay(capturePlay(state, ''), state.variantId)) {
    closeMenu();
    say('Nothing to save yet. Move someone or draw some arrows first.');
    return;
  }
  const name = (window.prompt('Name this play:', '') ?? '').trim();
  if (!name) return; // cancelled, or named nothing
  const play = capturePlay(state, name); // capturePlay is what cuts the name to length
  const side = playbookSide(state);
  const book = bookFor(library, side);
  let slot = firstEmptySlot(book);
  if (slot === -1) {
    const answer = window.prompt(
      `All ${PLAY_SLOTS} slots are full. Replace which one (1-${PLAY_SLOTS})?`,
      '1',
    );
    const n = Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > PLAY_SLOTS) return;
    slot = n - 1;
  }
  // Into this side's book only. putBook copies, so the other side's five are
  // the same five they were.
  library = putBook(library, side, putPlay(book, slot, play));
  const kept = saveLibrary(library);
  closeMenu();
  say(kept
    ? `Saved "${play.name}" to slot ${slot + 1}.`
    : `Saved "${play.name}" to slot ${slot + 1} for this session only.`);
  paint();
}

/**
 * Calling a play replaces whatever is drawn, and whoever is standing where —
 * it is a huddle, not an edit. Any of it that could not be given (a defender
 * in a play saved in hot-seat, a spot this down has no room for, a tuck by a
 * man who does not have the ball this time) is counted out loud rather than
 * passed over in silence. The defense answers the formation this leaves,
 * exactly as it answers a drag.
 */
function callPlay(i) {
  if (animating || !canUsePlays(state)) return;
  const play = myBook()[i];
  if (!play) return;
  const { applied, skipped } = applyPlay(state, play);
  // A called play sets a formation, and a formation is a question the defense
  // has to answer — the same answer a drag gets. Without this the corners stay
  // lined up over the last play's receivers.
  realignDefense();
  pendingWarning = false; // a new plan gets a fresh warning, like any drag does
  closeMenu();
  const note = formationNote();
  say(skipped.length === 0
    ? `"${play.name}" called. ${applied.length} player(s) set. ${note}`
    : `"${play.name}" called. ${applied.length} set, ${skipped.length} skipped. ${note}`);
  paint();
}

function openMenu() {
  if (!menu.open) menu.showModal();
}

function closeMenu() {
  if (menu.open) menu.close();
}

/**
 * What a press on the board itself does: open the menu, or work one of the two
 * quick-press buttons. Every one of these nodes is re-created — the menu rect
 * by rebuildBoard(), the buttons by every paint() — so the listener goes on
 * the board and matches on the way up rather than on the nodes themselves.
 *
 * The two buttons are shortcuts and nothing more: they call the same functions
 * the menu's own Reposition and Run Turn do, so there is no second copy of
 * either rule to keep in step.
 */
function pressBoardButton(target) {
  if (!target.closest) return false;
  if (target.closest('[data-menu-button]')) openMenu();
  else if (target.closest('[data-reposition-button]')) toggleReposition();
  else if (target.closest('[data-run-button]')) pressRun();
  else if (target.closest('[data-autoplan-button]')) pressAutoplanOffense();
  else return false;
  return true;
}

board.on('click', (e) => {
  pressBoardButton(e.target);
});

// These rects are the only controls on the board, and everything the menu
// holds lives in a closed <dialog> — out of the tab order until it is open.
// Without this, a keyboard user who tabbed to one could never actually press
// it. Space is also prevented from scrolling the page, as a native button does.
board.on('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (pressBoardButton(e.target)) e.preventDefault();
});

// Content is inside .menu-body, so a click whose target IS the dialog landed
// on the backdrop. Esc is handled natively by showModal().
menu.addEventListener('click', (e) => {
  if (e.target === menu) closeMenu();
});

closeMenuBtn.addEventListener('click', closeMenu);
savePlayBtn.addEventListener('click', savePlay);

/**
 * Write down what the coach just called. Runs at the moment Run Turn is
 * pressed, which is the only moment the whole huddle is on the board at once:
 * every arrow drawn, every man moved, the throw set — and, on a turn the
 * computer coaches, none of ITS intentions, because those are written inside
 * runTurn and wiped at the whistle.
 *
 * Only the human's own side is recorded, and only when there IS one: in
 * hot-seat both teams are his, and a log that could not say whose call a
 * snapshot was would teach the ghost to play both sides at once.
 *
 * The tendency counts take the first turn of a down only — that is the play
 * call; turns two and three are what happened to it. They are counted only
 * when the human is the OFFENSE, because it is an offense's habits the
 * learned defense knows what to do with (design decision 3).
 */
function recordPlanning() {
  const team = humanSide(state);
  if (!team) return;
  const snap = captureSnapshot(state, team);
  coachLog = appendSnapshot(coachLog, snap);
  saveCoachLog(coachLog);
  if (team === 'offense' && snap.situation.turnIndex === 0) {
    tendencies = observePlay(tendencies, observationFromSnapshot(snap));
    saveTendencies(tendencies);
    state.tendencyCounts = tendencies;
  }
}

/**
 * Run the turn. The menu's Run Turn and the board's quick press both come
 * here, so the shortcut is the same press and not a second, subtly different
 * way to snap the ball — same warning when someone has no direction set, same
 * second press to run anyway.
 */
function pressRun() {
  if (animating || state.phase !== 'planning') return;
  const missing = unplannedPlayers(state);
  if (missing.length > 0 && !pendingWarning) {
    // Spec: warn when not every player has a direction. Second press runs anyway.
    pendingWarning = true;
    say(`${missing.length} player(s) have no direction set. Press Run Turn again to run anyway.`);
    return;
  }
  pendingWarning = false;
  stopRepositioning();
  say('');
  // Recorded before the turn runs, while the huddle is still on the board.
  recordPlanning();
  // runTurn mutates state to the end-of-turn position and returns the
  // per-sub-step frames; the player groups are still painted at their
  // pre-turn spots, so animating the frames walks them to where state says.
  const { frames, events } = runTurn(state, random);
  layer('game-arrows').clear();
  // Only ever one throw a turn, so its own event -- if any -- says everything
  // there is to say about what got thrown and by whom.
  const passEvent = events.find((e) => e.type === 'pass');
  const finish = () => {
    animating = false;
    paint();
    for (const e of events) {
      if (e.type === 'tackled') say('Tackled!');
      if (e.type === 'fumble') say('FUMBLE! The ball is loose!');
      if (e.type === 'touchdown') say('TOUCHDOWN!');
      if (e.type === 'out-of-bounds') say('Out of bounds.');
      if (e.type === 'pickup') {
        if (!passEvent) {
          say(`Recovered by ${e.team}.`);
        } else if (passEvent.auto) {
          // The snap is never news -- it is how a down starts, not a play the
          // coach called, so the offense catching its own snap gets silence
          // rather than "Caught!". But a snap is a backward pass, so a MUFFED
          // one is still a live ball: if the defense comes up with it, that is
          // a real turnover and has to be announced like any other one.
          if (e.team === 'defense') say(`Recovered by ${e.team}.`);
        } else {
          say(e.team === 'defense' ? 'INTERCEPTED!' : 'Caught!');
        }
      }
      if (e.type === 'incomplete') say('Incomplete.');
    }
    // A ball still in the air when the whistle goes is the newest fact on the
    // board, so it gets the last word over whatever the events said. The
    // coach's next job is to get somebody under it.
    if (state.phase === 'planning' && state.ball.lob && !lobLanded(state.ball.lob)) {
      say('The ball is in the air — get someone under it.');
    }
    // The flag is called after the down, not when it was committed — the spec
    // is explicit that an illegal throw is allowed to play out first, and an
    // illegal formation is the same bargain: the snap is when it is noticed,
    // the whistle is when it costs you.
    if (state.phase === 'playOver' && state.penalty) {
      say(`FLAG: ${FOUL_WORDS[state.penalty.foul]}.`
        + ` ${PENALTY_YARDS} yards from the previous spot, loss of down.`);
    }
    // A tackle or a touchdown moves the game on by itself after a beat; every
    // other way a play can die (out of bounds, incomplete, a fumble the
    // defense fell on) still waits for the button. A touchdown restarts the
    // game because scoring is how this one is won — unless a flag is being
    // enforced, which wipes the score and makes it an ordinary next down.
    if (state.phase === 'playOver'
      && (state.deadReason === 'tackled' || state.deadReason === 'touchdown')) {
      scheduleAutoAdvance(
        state.deadReason === 'touchdown' && !state.penalty ? startNewGame : goToNextDown,
      );
    }
  };
  if (frames.length > 0) {
    // Lock the controls now, not at the next paint() — paint() does not run
    // again until finish(), and until then every button is still live.
    animating = true;
    runBtn.disabled = true;
    autoplanBtn.disabled = true;
    clearBtn.disabled = true;
    nextBtn.disabled = true;
    newBtn.disabled = true;
    homeBtn.disabled = true;
    aiBtn.disabled = true;
    repositionBtn.disabled = true;
    personnelBtn.disabled = true;
    debugBtn.disabled = true;
    copyLogBtn.disabled = true;
    clearLogBtn.disabled = true;
    animate(frames, finish);
  } else finish();
}

runBtn.addEventListener('click', () => {
  closeMenu();
  pressRun();
});

/**
 * Draw up the QB run option for the human's own offense: the menu's Autoplan
 * offense button and the board's quick-press icon both come here, same as
 * pressRun's own shortcut discipline.
 */
function pressAutoplanOffense() {
  if (animating || state.phase !== 'planning') return;
  const note = autoplanOffense(state);
  if (note === null) return; // declined silently -- the computer is coaching this team
  pendingWarning = false;
  say(note);
  paint();
}

autoplanBtn.addEventListener('click', () => {
  closeMenu();
  pressAutoplanOffense();
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
  const next = nextAiMode(state);
  state.aiTeam = next.ai;
  state.aiLevel = next.level;
  // Handing the defense back to the computer — or to a different brain — drops
  // whatever arrows and coverage were already on it. They are not that
  // coach's any more.
  if (state.aiTeam) clearAiPlans(state);
  pendingWarning = false;
  say(next.note);
  paint();
});

personnelBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || !canReposition(state)) return;
  const order = PERSONNEL_PACKAGES;
  const next = order[(order.indexOf(personnelId(state.variantId)) + 1) % order.length];
  if (!setPersonnel(state, next)) return;
  // A new package means new bodies on the field — realign them the same way
  // a drag during reposition mode does, and for the same reason: only when
  // the computer is coaching the defense, so a human coach's own drags are
  // never overwritten.
  realignDefense();
  pendingWarning = false;
  say(`Personnel: ${next}.`);
  paint();
});

/**
 * A formation is what you come to the line with, so the mode switches itself
 * off at every point the huddle is over — the snap, the next down, a new
 * game — rather than lingering into a turn where a drag has to mean an arrow
 * again.
 */
function stopRepositioning() {
  repositioning = false;
}

/**
 * The Reposition toggle, from the menu or from the board's shuffle button.
 * One function so the two cannot drift: whichever is pressed, the mode says
 * the same thing and reads the same formation back.
 */
function toggleReposition() {
  if (animating || !canReposition(state)) return;
  repositioning = !repositioning;
  layer('game-preview').clear();
  say(repositioning
    ? `Drag your players to move them. ${formationNote()}`
    : 'Back to drawing arrows.');
  paint();
}

repositionBtn.addEventListener('click', () => {
  closeMenu();
  toggleReposition();
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

/**
 * Hand the coaching log over as JSON — the file tools/train-vs-ghost.js
 * trains against. The clipboard is asked first and a prompt is the fallback,
 * because a browser may refuse clipboard access outright and a log the coach
 * cannot get at is a log that never leaves the browser.
 */
copyLogBtn.addEventListener('click', async () => {
  closeMenu();
  if (animating || coachLog.length === 0) return;
  const text = serializeCoachLog(coachLog);
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied ${coachLog.length} planning snapshot(s). Save them as JSON and train against them.`);
  } catch {
    window.prompt('Copy this coaching log:', text);
    say('The browser refused the clipboard — the log is in the prompt instead.');
  }
});

/** Forget everything: the raw log and the counts read off it. Both, always —
 *  a coach who asks to be forgotten does not mean half of him. */
clearLogBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  coachLog = emptyCoachLog();
  tendencies = emptyTendencies();
  clearCoachLog();
  clearTendencies();
  state.tendencyCounts = tendencies;
  say('Forgotten. The computer starts reading you from scratch.');
  paint();
});

/**
 * A finished play moves the game on by itself after DEAD_BALL_PAUSE_SECONDS —
 * the coach reads the call, sees where everyone stopped, and the next down
 * comes up without a button press. The timer id is kept so that a coach who
 * doesn't want to wait can press Next Down or New Game and have the pending
 * one thrown away rather than fire a second advance on top of his.
 */
let autoAdvanceTimer = null;

function cancelAutoAdvance() {
  if (autoAdvanceTimer !== null) clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = null;
}

function scheduleAutoAdvance(advance) {
  cancelAutoAdvance();
  autoAdvanceTimer = setTimeout(() => {
    autoAdvanceTimer = null;
    advance();
  }, DEAD_BALL_PAUSE_SECONDS * 1000);
}

function goToNextDown() {
  cancelAutoAdvance();
  stopRepositioning();
  nextDown(state);
  if (state.phase === 'gameOver') {
    say(gameOverMessage(state));
  } else {
    say(`${['1st', '2nd', '3rd', '4th'][state.down - 1]} down.`);
    rebuildBoard();
  }
  paint();
}

function startNewGame() {
  cancelAutoAdvance();
  stopRepositioning();
  const mode = defaultModeForSide(sideId);
  state = createGame({
    seed: (Math.random() * 2 ** 31) | 0, ai: mode.ai, aiLevel: mode.level, variant: variantId,
  });
  // The new drive inherits what the old ones taught the computer.
  state.tendencyCounts = tendencies;
  random = mulberry32(state.seed);
  pendingWarning = false;
  // The board is built before anything is said into it. Every other caller
  // arrives with a board already up, but startGame() comes here with a cold
  // one — and the message layer say() writes into does not exist until
  // rebuildBoard() has made it.
  rebuildBoard();
  say(kickoffMessage(state));
  paint();
}

nextBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  goToNextDown();
});

newBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  startNewGame();
});

/**
 * Leave the drive and go back to the home screen. Everything that could still
 * fire after we are gone is stopped first: a pending auto-advance would bring
 * up the next down behind a hidden board, and the menu would still be open on
 * the next visit. The board itself is left as it is — startGame() rebuilds it
 * from scratch, so clearing it here would only be a flicker on the way out.
 *
 * Dead while a turn is being drawn, exactly like Next Down and New Game: the
 * animate() loop is still walking the frames, and its finish() would paint over
 * a drive nobody is watching.
 */
function goHome() {
  cancelAutoAdvance();
  stopRepositioning();
  exitToHome();
}

homeBtn.addEventListener('click', () => {
  closeMenu();
  if (animating) return;
  goHome();
});

/**
 * Start a drive. app/home.js calls this when a coach picks a game off the home
 * screen — the first press imports this module and lands here, and every press
 * after a trip home lands here again. That is why the pointer plumbing is
 * attached once and the state is built fresh every time: the listeners on the
 * board (and on the menu's buttons, registered above at module scope) belong to
 * the module, and a second set of them would run every gesture twice.
 *
 * startNewGame() is the whole of a fresh drive — it cancels any pending
 * advance, drops reposition mode, builds the state, rebuilds the board and
 * paints. The only thing said differently here is the opening line, which is
 * an instruction rather than a score report.
 *
 * `variant` is the id of the button that was pressed — see lib/game/variants.js
 * and lib/game/rosters.js. It is held for the whole visit, so New Game deals
 * the same game again and a coach who wants the other one goes back home for
 * it.
 */
let inputAttached = false;
// How the Back to Home button gets back to the screen that started us. It is
// handed in rather than imported so the dependency runs one way only: home.js
// knows about the game, and the game knows nothing about home.
let exitToHome = () => {};

export function startGame({ variant = DEFAULT_VARIANT, side = 'training', onExit = () => {} } = {}) {
  exitToHome = onExit;
  variantId = variant;
  sideId = side;
  if (!inputAttached) {
    attachInput(board, { hitTest, onGesture, onDragPreview });
    inputAttached = true;
  }
  startNewGame();
  say('Drag your players, then open the Coaches Menu to run the turn.');
}
