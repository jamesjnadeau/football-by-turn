import { SVG } from './vendor/svg.esm.js';
import {
  createGame, setPlan, setMode, getPlayer, clearAllPlans, isControllable, setPass, ballPos,
  aimSnap, clearPass,
} from '../lib/game/state.js';
import {
  canReposition, placePlayer, spotFault, alignDefense, lineCount, setPersonnel, answerOffense,
} from '../lib/game/formation.js';
import { clearAiPlans, AI_MODES, aiModeIndex, nextAiMode, defaultModeForSide } from '../lib/game/ai.js';
import { runTurn, unplannedPlayers } from '../lib/game/turn.js';
import { nextDown } from '../lib/game/rules.js';
import {
  renderBoardShell, renderPlayers, renderPlans, renderPassArrow, renderLooseBall, looseBallMark,
  planMark, coverMark, passArrowMark, passArrowTip, renderMessage, destinationMark,
  lineZoneMark, renderFieldButtons, passLandingMark, passLockMark, cameraViewBox,
  menuButtonMark, liveLobMark, fieldButtonAnchor, FIELD_BUTTON_ICONS,
} from '../lib/game/render.js';
import { classifyGesture } from '../lib/game/gesture.js';
import { downDistanceText, gameOverMessage, kickoffMessage, humanSide, coachedSide } from '../lib/game/hud.js';
import { planForDrag } from '../lib/game/predict.js';
import { opponentAt, setCover } from '../lib/game/cover.js';
import { mulberry32 } from '../lib/game/rng.js';
import { receiverAt, lockOnPass, passLanding, backOnPasser } from '../lib/game/pass.js';
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
import { ghostReadiness, BROWSER_TRAINING_RUN } from '../lib/game/train/vs-ghost.js';
import { serializeBundle } from '../lib/game/train/bundle.js';
import {
  loadGenomeBundles, saveGenomeBundle, clearGenomeBundles, overrideValues,
} from './genome-store.js';
import { autoplanLearned } from '../lib/game/autoplan.js';
import { maybeApplyLearnedFormations } from '../lib/game/learned/formation.js';
import { activeGenome } from '../lib/game/learned/active.js';
import { createLesson } from './tutorial.js';
import { coachCardMark, highlightMark } from '../lib/game/tutorial/render.js';

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
const trainBtn = document.getElementById('train');
const copyGenomeBtn = document.getElementById('copy-genome');
const discardGenomeBtn = document.getElementById('discard-genome');

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
// What this coach has trained in his own browser: one bundle per side, or
// null. Not game state, for the same reason the playbook and the coaching log
// are not — New Game replaces `state` wholesale and a trained genome outlives
// a drive. `trainedSide` is which one the Copy button hands over; only one is
// ever trained in practice, and defense is the normal one.
let genomeBundles = loadGenomeBundles();
let trainedSide = genomeBundles.defense ? 'defense'
  : genomeBundles.offense ? 'offense' : null;
// The live training worker, or null. One at a time: a second run started on
// top of the first would race it for the same override.
let trainer = null;

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
// The lesson being taught, or null in an ordinary drive. Everything the
// tutorial changes about the game is asked of this one object, so a normal
// game is exactly the game it always was: `lesson` is null and every check
// below falls straight through.
let lesson = null;

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
  // aimCamera repaints this plate on every frame, so the shell only has to
  // agree with it — but it has to agree, or the clipboard flashes on for one
  // paint at the start of every lesson.
  const { viewBox, markup } = renderBoardShell(state.losYard, state.toGoYard, cam, {
    menu: !lesson || lesson.showsMenu(),
  });
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
  // The clipboard is hidden for the whole tutorial except its last beat, which
  // teaches it — and leaving through it is how the tutorial ends.
  layer('game-menu').clear().svg(
    !lesson || lesson.showsMenu() ? menuButtonMark(state.losYard, cam) : '',
  );
  layer('game-buttons').clear().svg(
    renderFieldButtons(state, {
      repositioning, animating, cameraYard: cam, allow: lesson ? lesson.buttons() : null,
      book: myBook(),
    }),
  );
  layer('game-message').clear().svg(renderMessage(messageText, state.losYard, cam));
  layer('game-tutorial').clear().svg(lessonMark(cam));
}

/**
 * The lesson's card and the ring round whatever it wants pressed. Repainted
 * with the camera rather than once at the snap, for the same reason the button
 * column is: a play that scrolls downfield would otherwise slide the card off
 * the bottom of the window and snap it back at the whistle.
 */
function lessonMark(cam) {
  if (!lesson) return '';
  const card = lesson.card();
  return coachCardMark(card, state.losYard, cam) + highlightMark(anchorFor(card.highlight, cam));
}

/** Where the ring goes: a plate in the button column, or a man on the field. */
function anchorFor(highlight, cam) {
  if (!highlight) return null;
  if (highlight.kind === 'button') return fieldButtonAnchor(highlight.name, state.losYard, cam);
  const p = state.players.find((pl) => pl.id === highlight.id);
  return p ? { x: p.pos.x, y: p.pos.y, r: p.radius } : null;
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
  aiBtn.textContent = `${FIELD_BUTTON_ICONS.ai} ${AI_MODES[aiModeIndex(state)].label}`;
  aiBtn.disabled = animating || state.phase !== 'planning';
  repositionBtn.textContent = `${FIELD_BUTTON_ICONS.reposition} Reposition: ${repositioning ? 'on' : 'off'}`;
  repositionBtn.disabled = animating || !canReposition(state);
  personnelBtn.textContent = `${FIELD_BUTTON_ICONS.personnel} Personnel: ${personnelId(state.variantId)}`;
  // Not the human's to press when the computer is coaching the defense: it
  // picks its own package now, and the two would fight on every press.
  personnelBtn.disabled = animating || !canReposition(state) || state.aiTeam === 'defense';
  debugBtn.textContent = `Velocity: ${showVelocity ? 'on' : 'off'}`;
  debugBtn.disabled = animating;
  copyLogBtn.textContent = `Copy coaching log (${coachLog.length})`;
  copyLogBtn.disabled = animating || coachLog.length === 0;
  clearLogBtn.disabled = animating || (coachLog.length === 0 && tendencies.plays === 0);
  trainBtn.disabled = animating || trainer !== null || coachLog.length === 0;
  copyGenomeBtn.textContent = trainedSide
    ? `Copy trained ${trainedSide} genome`
    : 'Copy trained genome';
  copyGenomeBtn.disabled = animating || trainedSide === null;
  discardGenomeBtn.disabled = animating || trainedSide === null;
  runBtn.disabled = animating || state.phase !== 'planning';
  autoplanBtn.textContent = `${FIELD_BUTTON_ICONS.autoplan} Autoplan ${coachedSide(state)}`;
  autoplanBtn.disabled = animating || state.phase !== 'planning';
  clearBtn.disabled = animating || state.phase !== 'planning';
  nextBtn.disabled = animating;
  newBtn.disabled = animating;
  homeBtn.disabled = animating;
  nextBtn.hidden = state.phase !== 'playOver';
  // The board's own quick-press buttons are redrawn every paint rather than
  // built with the board, which is what lets the shuffle disappear at the
  // snap and the run button grey out — the menu hit rect beside them never
  // changes, so it stays in the shell.
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

/**
 * Whether the lesson permits this, and the nudge if it does not. A refusal is
 * said and the action dropped BEFORE anything is applied — a half-committed
 * order taken back afterwards would be a worse lie than the refusal.
 */
function refused(action) {
  if (!lesson) return false;
  const nudge = lesson.allows(action);
  if (nudge === null) return false;
  say(nudge);
  paint();
  return true;
}

/** Words for how the play just died, when there is something to name — a
 *  penalty first, since that is the more specific fact and, on the lesson
 *  that teaches a foul on purpose, the whole point of the replay. */
const DEAD_REASON_WORDS = {
  incomplete: 'Incomplete',
  'out-of-bounds': 'Out of bounds',
  recovered: 'Recovered by the defense',
  tackled: 'Tackled',
  touchdown: 'Touchdown',
};

function replayReason(s) {
  if (s.penalty) return FOUL_WORDS[s.penalty.foul].replace(/^./, (c) => c.toUpperCase());
  return DEAD_REASON_WORDS[s.deadReason] ?? null;
}

/**
 * Tell the lesson what just happened: re-deal the down if it went off script,
 * and end the tutorial if that was the last beat of the last lesson.
 *
 * `menu.open` is read off the dialog rather than tracked in a flag of our own —
 * the menu being open IS what the closing step waits for, and <dialog> already
 * knows.
 */
function lessonSaw() {
  if (!lesson) return;
  const seen = lesson.saw(state, { repositioning, menuOpen: menu.open });
  if (seen.replay) {
    // Passed through to dealLesson rather than said here: say() followed by a
    // dealLesson() that wipes messageText and rebuilds is two synchronous
    // steps with no frame painted between them, so the coach never actually
    // sees the line — only the silent reset. dealLesson says it AFTER the
    // rebuild instead, so the fresh down and the reason both land in one
    // paint.
    //
    // The reason is read off `state` before dealLesson rebuilds it out from
    // under us — a coach who draws exactly the flag a lesson teaches (lesson
    // 2's forward pass from past the line) has to see that flag named, not
    // just "not quite".
    const reason = replayReason(state);
    dealLesson(reason ? `${reason}. Let us run that one again.` : 'Not quite — let us run that one again.');
    return;
  }
  if (seen.finished) {
    finishLesson();
    return;
  }
  paint();
}

/**
 * The tutorial is over. The lesson is dropped BEFORE anything else happens —
 * `variantId` still naming a two-man drill, or `state` still being the
 * drill's own scripted state, would make everything behind the menu lie:
 * Next Down would deal another drill down, recordPlanning()'s `if (lesson)
 * return` guard would no longer fire and would feed a two-man-drill snapshot
 * into the coaching log and the learned tendencies, and the AI/personnel
 * controls would read a `'scripted'` aiLevel and a `'tutorial-2v2'` variant
 * that mean nothing to them. So the board behind the menu is not left as the
 * drill's last down — it is a real drive, dealt the same way startGame()
 * deals one, so every button the coach is looking at means what it says.
 */
function finishLesson() {
  lesson = null;
  variantId = DEFAULT_VARIANT;
  sideId = 'training';
  startNewGame();
}

/**
 * A press on the clipboard. In a lesson this is the closing step: the menu goes
 * up, and lessonSaw sees it open and ends the tutorial — in that order, so what
 * the coach is looking at when the card disappears is the real menu.
 */
function pressMenu() {
  if (refused({ kind: 'menu' })) return;
  openMenu();
  lessonSaw();
}

function hitTest(p) {
  let best = null;
  let bestD = Infinity;
  for (const pl of state.players) {
    // The computer's players take no orders. Gating here covers all three ways
    // in — drag, drag preview, and double tap — because every one of them
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
 * defense no longer just holds its ground — it subs its personnel package and
 * slides its men by however far its genome has learned to answer the look —
 * and the rule-based alignDefense below is what every other brain still gets.
 */
function realignDefense() {
  // A lesson's men stand where the script stood them. Answering the coach's
  // new look would break the vertical line the fourth lesson is built on.
  if (lesson) return;
  if (state.aiTeam !== 'defense') return;
  if (answerOffense(state, activeGenome(state, 'defense'))) return;
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
  if (refused({ kind: 'gesture', playerId, gestureKind: gesture.kind })) return;
  const p = getPlayer(state, playerId);
  if (repositioning) {
    // Every verb but the drag is off in this mode: no arrows, no cover orders,
    // no stances, and a tap-then-drag is a move like any other drag rather than
    // a throw. You are setting a formation, which is one thing.
    if (gesture.kind === 'drag' || gesture.kind === 'passdrag') reposition(playerId, point);
    paint();
    lessonSaw();
    return;
  }
  // A throw drag dropped back on the man throwing it is not a throw at all: it
  // is the double tap that started it, with the pass called off. Decided here
  // rather than in classifyGesture because it is a fact about how big the
  // player is, not about the pointer — the classifier only ever sees
  // coordinates. Everything downstream then reads one verb, so the cancel
  // needs no branch of its own.
  const cancelled = gesture.kind === 'passdrag' && backOnPasser(p, point);
  if (cancelled && state.plannedPass && state.plannedPass.from === playerId) {
    // "Cancel the pass" means the throw already on the board too, not only the
    // one this drag was drawing — which is what makes the gesture reversible.
    // Re-aiming the snap afterwards is what clearAllPlans does for the same
    // reason: taking back the coach's throw must leave a down that can still
    // start, not a centre standing on the ball.
    clearPass(state);
    aimSnap(state);
  }
  const kind = cancelled ? 'doubletap' : gesture.kind;
  if (kind === 'passdrag') {
    // Double-tap-then-drag is a throw only from the man with the ball. From
    // anyone else it is an ordinary run arrow — which is what the drag preview
    // showed him, so committing anything less would break that promise.
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
  } else if (kind === 'drag') {
    const opp = opponentAt(state, point, p.team);
    if (opp && setCover(state, playerId, opp)) {
      say(`${p.role} will cover ${getPlayer(state, opp).role}.`);
    } else {
      const run = planForDrag(p, gesture.travel);
      setPlan(state, playerId, run.dir, run.throttle, run.target, run.short);
      say('');
    }
    pendingWarning = false;
  } else if (kind === 'doubletap') {
    const target =
      p.mode !== 'normal' ? 'normal'
      // An offensive lineman can never tuck (setMode refuses it outright), so
      // this has to be checked before the carrier-tucked branch below —
      // otherwise a double tap on the centre pre-snap (he's the placeholder
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
  // kind === 'click': a single tap on a player does nothing on its own. Moving
  // him is a drag, and only in reposition mode — one tap is how you arm the
  // second, and it cannot also be how you move somebody.
  paint();
  lessonSaw();
}

function onDragPreview(playerId, log, prevTapAt) {
  if (animating) return; // the board belongs to the turn being drawn right now
  if (!playerId || !log || state.phase !== 'planning') {
    layer('game-preview').clear();
    return;
  }
  const g = classifyGesture(log, prevTapAt);
  if (g.kind !== 'drag' && g.kind !== 'passdrag') return;
  // A lesson that would refuse this gesture on release should not spend the
  // whole drag promising it with a live arrow — the same check onGesture
  // makes when the finger lifts, made here before a preview is drawn instead
  // of after one has been shown and taken back.
  if (lesson && lesson.allows({ kind: 'gesture', playerId, gestureKind: g.kind }) !== null) {
    layer('game-preview').clear();
    return;
  }
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
  // from anyone else a double-tap-drag is an ordinary run. Both marks come
  // from render.js, so the arrow being dragged and the arrow committed are the
  // same picture either way.
  const tip = log[log.length - 1];
  if (g.kind === 'passdrag' && backOnPasser(p, tip)) {
    // Back on the man himself: releasing here throws nothing, so nothing is
    // drawn. The arrow vanishing out from under the finger is the promise that
    // the pass is off.
    layer('game-preview').clear();
    return;
  }
  const throwing = g.kind === 'passdrag' && state.ball.carrierId === playerId;
  const mark = throwing
    ? throwMark(p, g, tip)
    : runOrCoverMark(p, g.travel, tip);
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
 * The menu's own buttons wear the icons their plates wear. Written from the
 * same table the board reads, so the two can never say different things —
 * which is the whole point of a coach being able to relate one to the other.
 *
 * Only the three whose text is never rewritten need doing here; the rest get
 * their icon from paint()'s templates.
 */
for (const [btn, name] of [[runBtn, 'run'], [clearBtn, 'clear'], [savePlayBtn, 'save']]) {
  btn.textContent = `${FIELD_BUTTON_ICONS[name]} ${btn.textContent}`;
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
    slotBtns[i].textContent = `${FIELD_BUTTON_ICONS[`play${i + 1}`]} ${play ? play.name : '(empty)'}`;
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
 * What a press on the board itself does: open the menu, or work whichever
 * quick-press plate the press landed on. Every one of these nodes is
 * re-created — the menu rect by rebuildBoard(), the plates by every paint()
 * — so the listener goes on the board and matches on the way up rather than
 * on the nodes themselves.
 *
 * The plates are shortcuts and nothing more: each one calls the same
 * function the menu's own matching control does, so there is no second copy
 * of any rule to keep in step.
 */
function pressBoardButton(target) {
  if (!target.closest) return false;
  if (target.closest('[data-tutorial-next]')) nextLesson();
  // Openable in an ordinary drive, and on the one lesson step that asks for it
  // — where opening it is what ends the tutorial. Everywhere else in a lesson
  // there is no plate to press anyway; this is the second lock on that door.
  else if (target.closest('[data-menu-button]')) pressMenu();
  else if (target.closest('[data-reposition-button]')) toggleReposition();
  else if (target.closest('[data-run-button]')) pressRun();
  else if (target.closest('[data-autoplan-button]')) pressAutoplan();
  else if (target.closest('[data-clear-button]')) pressClear();
  else if (target.closest('[data-ai-button]')) pressAi();
  else if (target.closest('[data-personnel-button]')) pressPersonnel();
  else if (target.closest('[data-save-button]')) savePlay();
  else return callPlayFromBoard(target);
  return true;
}

/**
 * The five load plates share one attribute and are told apart by its value, so
 * one line reads the slot straight off the plate that was pressed rather than
 * five branches saying the same thing.
 */
function callPlayFromBoard(target) {
  const el = target.closest('[data-play-button]');
  if (!el) return false;
  callPlay(Number(el.getAttribute('data-play-button')));
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
  // A lesson is not a down this coach called: it is a script, and teaching the
  // ghost to play it would poison the log with somebody else's football.
  if (lesson) return;
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
  if (refused({ kind: 'run' })) return;
  // Never during a lesson. The warning exists to catch a coach who forgot
  // somebody, and a lesson is the one place he cannot have: it tells him which
  // single man to order and refuses every other gesture, so the men without
  // arrows are the ones it is deliberately not teaching yet. Asking him to
  // press again to run anyway would be asking him to overrule an instruction
  // the same screen just gave him — on the very first press, where the quarter-
  // back has no arrow because the step teaching that comes next.
  const missing = lesson ? [] : unplannedPlayers(state);
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
    // However the play died — a tackle, a touchdown, an incompletion, a step
    // out of bounds, a fumble the defense fell on — the game moves on by
    // itself after a beat. The whistle has already settled everything there
    // is to settle, so the beat is for reading the board, not for asking the
    // coach to confirm that the play is over. Next Down is still there for a
    // coach who doesn't want to wait. A touchdown restarts the game because
    // scoring is how this one is won — unless a flag is being enforced, which
    // wipes the score and makes it an ordinary next down.
    //
    // Never during a lesson: the tutorial deals its own downs and ends its own
    // plays, and a drive advancing underneath one would swap the board out from
    // under the step the coach is still being asked to complete.
    if (!lesson && state.phase === 'playOver') {
      scheduleAutoAdvance(
        state.deadReason === 'touchdown' && !state.penalty ? startNewGame : goToNextDown,
      );
    }
    // The lesson judges the down AFTER everything the whistle had to say, so
    // its card is the last word on the board rather than something the
    // referee's plate overwrites a moment later.
    lessonSaw();
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
    trainBtn.disabled = true;
    copyGenomeBtn.disabled = true;
    discardGenomeBtn.disabled = true;
    animate(frames, finish);
  } else finish();
}

runBtn.addEventListener('click', () => {
  closeMenu();
  pressRun();
});

/**
 * Draw up what the learned brain would play on the coach's own side of the
 * ball: the menu's Autoplan button and the board's own plate both come here,
 * same as pressRun's own shortcut discipline.
 */
function pressAutoplan() {
  if (animating || state.phase !== 'planning') return;
  const note = autoplanLearned(state);
  if (note === null) return; // declined silently -- there was nothing to plan
  pendingWarning = false;
  say(note);
  paint();
}

autoplanBtn.addEventListener('click', () => {
  closeMenu();
  pressAutoplan();
});

/**
 * Clear, Defense and Personnel, from the menu or from their plates on the
 * board. One function each so the two surfaces cannot drift: whichever is
 * pressed, the same rule runs and the same thing is said.
 */
function pressClear() {
  if (animating || state.phase !== 'planning') return;
  clearAllPlans(state);
  pendingWarning = false;
  paint();
}

function pressAi() {
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
}

function pressPersonnel() {
  // The aiTeam check is new here. paint() has always greyed the menu button on
  // it — the computer picks its own package, and the two would fight on every
  // press — but the handler never carried it, which was safe only while a
  // disabled button was the sole way in. A plate on the board is a second way.
  if (animating || !canReposition(state) || state.aiTeam === 'defense') return;
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
}

clearBtn.addEventListener('click', () => { closeMenu(); pressClear(); });
aiBtn.addEventListener('click', () => { closeMenu(); pressAi(); });
personnelBtn.addEventListener('click', () => { closeMenu(); pressPersonnel(); });

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
  if (refused({ kind: 'reposition' })) return;
  repositioning = !repositioning;
  layer('game-preview').clear();
  say(repositioning
    ? `Drag your players to move them. ${formationNote()}`
    : 'Back to drawing arrows.');
  paint();
  lessonSaw();
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
 * Put the freshly trained genome on the board. The brain reads it from the
 * next order it gives; the FORMATION is a pre-snap picture, so it only changes
 * while there still is one — maybeApplyLearnedFormations writes through
 * applyLearnedDefenseFormation, which is gated on the planning phase and turn
 * zero and does nothing the rest of the time. aimSnap follows because an
 * offense genome can move the quarterback, and the automatic snap is aimed at
 * where he stands — the same two lines, in the same order, that createGame and
 * nextDown end on.
 */
function applyGenomeOverrides() {
  state.genomeOverrides = overrideValues(genomeBundles);
  maybeApplyLearnedFormations(state);
  aimSnap(state);
}

function stopTraining() {
  if (trainer) trainer.terminate();
  trainer = null;
}

/**
 * Train a genome against a ghost of THIS coach, here, on this device — the
 * same run tools/train-vs-ghost.js makes, in a worker, seeded from whatever
 * genome is already playing so that a second press keeps climbing.
 *
 * The side is read off the log rather than chosen: the ghost imitates the side
 * you were recorded coaching and the genome that gets trained is the other one
 * (lib/game/train/vs-ghost.js's ghostReadiness). A log too thin to imitate is
 * refused out loud rather than trained against badly.
 */
function startTraining() {
  if (animating || trainer !== null) return;
  const ready = ghostReadiness(coachLog, state.variantId);
  if (!ready.ok) {
    say(ready.reason);
    return;
  }
  const job = {
    ...BROWSER_TRAINING_RUN,
    log: coachLog,
    side: ready.side,
    snapshots: ready.snapshots,
    seedGenome: genomeBundles[ready.side] ? genomeBundles[ready.side].values : null,
    exportedAt: new Date().toISOString(),
  };
  trainer = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
  trainer.addEventListener('message', (e) => {
    if (e.data.type === 'progress') {
      say(`Training the ${ready.side} — generation ${e.data.gen + 1}`
        + ` of ${BROWSER_TRAINING_RUN.generations}, best ${e.data.score.toFixed(2)}.`);
      return;
    }
    const { bundle } = e.data;
    stopTraining();
    genomeBundles = { ...genomeBundles, [bundle.side]: bundle };
    trainedSide = bundle.side;
    if (!saveGenomeBundle(bundle.side, bundle)) {
      say('Trained — but this browser refused to save it, so copy it now or it goes away on reload.');
    } else {
      say(`Trained a new ${bundle.side} against ${ready.snapshots} of your calls`
        + ` (fitness ${bundle.meta.fitness.toFixed(2)}). It is playing now —`
        + ' Copy trained genome sends it in.');
    }
    applyGenomeOverrides();
    paint();
  });
  trainer.addEventListener('error', (e) => {
    stopTraining();
    // Two different failures arrive at this one handler. A worker that never
    // LOADED fires it with nothing to say, and on a file:// page that is the
    // only way it ever fires — which is why this used to be the only sentence
    // here. A worker that loaded and then THREW brings the throw's own message
    // along, and telling a coach whose page is already served over http to
    // serve it over http sends him looking in the wrong place entirely.
    say(e.message
      ? `Training stopped — the trainer hit an error: ${e.message}`
      : 'Training could not start — this page has to be served over http (npm run serve), not opened as a file.');
    paint();
  });
  trainer.postMessage(job);
  say(`${ready.reason} This takes a few seconds.`);
  paint();
}

trainBtn.addEventListener('click', () => {
  closeMenu();
  startTraining();
});

/**
 * Hand the trained genome over as a bundle — the JSON file
 * tools/import-genome.js reads. Clipboard first, prompt as the fallback, the
 * same bargain the coaching-log copy button strikes and for the same reason.
 */
copyGenomeBtn.addEventListener('click', async () => {
  closeMenu();
  if (animating || trainedSide === null) return;
  const text = serializeBundle(genomeBundles[trainedSide]);
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied your trained ${trainedSide} genome. Save it as JSON and send it in.`);
  } catch {
    window.prompt('Copy this genome bundle:', text);
    say('The browser refused the clipboard — the genome is in the prompt instead.');
  }
});

/** Back to the genome this build ships. Both sides, always — a coach asking
 *  for the shipped AI back does not mean half of it. */
discardGenomeBtn.addEventListener('click', () => {
  closeMenu();
  if (animating || trainedSide === null) return;
  genomeBundles = { defense: null, offense: null };
  trainedSide = null;
  clearGenomeBundles();
  applyGenomeOverrides();
  say('Back to the shipped genome. Your trained one is gone from this browser.');
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
    genomeOverrides: overrideValues(genomeBundles),
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
  lesson = null;
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

/**
 * Deal the lesson's current scenario onto the board, saying `note` over it.
 *
 * `note` is said AFTER rebuildBoard() rather than before, and the two happen
 * in the same call with no yield back to the browser in between — say() and
 * dealLesson()'s own rebuild used to run as two separate synchronous steps
 * (say the line, then wipe it by dealing a fresh, blank-message board), and a
 * browser never paints a frame in between two synchronous statements. The
 * coach saw the board reset with no explanation of why. Folding the note into
 * the deal itself means the fresh down and the sentence explaining it always
 * land in the same painted frame — the default of '' is what every other
 * caller (a fresh lesson, the "next lesson" press) still lands on a blank
 * message, exactly as before.
 */
function dealLesson(note = '') {
  cancelAutoAdvance();
  stopRepositioning();
  const dealt = lesson.deal();
  state = dealt.state;
  random = dealt.random;
  pendingWarning = false;
  rebuildBoard(); // the message layer does not exist until this has run
  say(note);
  paint();
}

/** The coach card's one control: on to the next lesson, or out of the tutorial. */
function nextLesson() {
  if (!lesson || animating) return;
  if (lesson.next().finished) {
    // The escape hatch, not the taught path: a coach who skips his way out of
    // the last lesson never sees the clipboard, so he is sent home directly.
    finishLesson();
    goHome();
    return;
  }
  dealLesson();
}

/**
 * Start the tutorial. app/home.js calls this when a coach presses How to play,
 * and it is the twin of startGame: same module, same listeners, a different
 * kind of down. The input plumbing is attached once here too, because a coach
 * may reach the tutorial before he has ever started a game.
 */
export function startTutorial({ onExit = () => {} } = {}) {
  exitToHome = onExit;
  if (!inputAttached) {
    attachInput(board, { hitTest, onGesture, onDragPreview });
    inputAttached = true;
  }
  lesson = createLesson();
  dealLesson();
}

export function startGame({ variant = DEFAULT_VARIANT, side = 'training', onExit = () => {} } = {}) {
  lesson = null;
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
