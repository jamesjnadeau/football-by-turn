/**
 * The tutorial, as data. Four lessons, each a single down on the fifty with a
 * handful of men on the field.
 *
 * Nothing here decides anything: machine.js reads it, app/tutorial.js plays it,
 * and the game underneath is the ordinary game. What lives here is what a
 * coach is told, which man he is allowed to touch while he is being told it,
 * and how the lesson knows the beat has landed.
 *
 * `demo` is the model answer for each step, and the running game never reads
 * it. It exists so the integration test can perform a step's intended action
 * without knowing what the step meant, which is what makes "the seed still
 * produces the authored beats" a thing a test can assert at all.
 */
import { fieldPos } from '../view.js';
import { getPlayer } from '../state.js';

export const TUTORIAL_LOS_YARD = 50;

/** A field point in the drill's own terms: yards across, yards from the line. */
function spot(across, down) {
  return fieldPos(across, TUTORIAL_LOS_YARD + down);
}

/** The whistle has gone, however it went. */
function playOver(state) {
  return state.phase === 'playOver' || state.phase === 'gameOver';
}

/** The closing beat every lesson ends on: run it out and see what happens. */
function whistleStep(text) {
  return {
    id: 'whistle',
    text,
    highlight: { kind: 'button', name: 'run' },
    allow: { action: 'run' },
    nudge: 'Press the fast-forward button to keep the play going.',
    needsLivePlay: false,
    // `runout`, not `run`: this beat ends when the whistle goes, and one
    // half-second turn is very unlikely to be the one that does it.
    demo: [{ verb: 'runout' }],
    done: (state) => playOver(state),
  };
}

/** A fast-forward beat: press run, and the turn count says it happened. */
function runStep(id, text, turnsSoFar) {
  return {
    id,
    text,
    highlight: { kind: 'button', name: 'run' },
    allow: { action: 'run' },
    nudge: 'Press the fast-forward button — that is what runs the half-second.',
    needsLivePlay: true,
    demo: [{ verb: 'run' }],
    done: (state) => state.turnIndex > turnsSoFar,
  };
}

const SNAP_AND_RUN = {
  id: 'snap-and-run',
  title: 'The snap, and running with it',
  variantId: 'tutorial-2v2',
  seed: 1001,
  coach: 'offense',
  scripted: 'defense',
  buttons: ['run'],
  // What the men this lesson is NOT teaching are already doing. Applied once at
  // the deal, to the coach's own side, so a beginner is never asked to give an
  // order the gate would refuse him — and so the centre does his actual job
  // instead of standing on the ball watching the nose tackle run past.
  openingOrders: [{ id: 'o-c', cover: 'd-nt' }],
  // A real rush, but only one man chasing: the nose tackle takes the
  // quarterback and the backer fills behind him, so the taught beats have room
  // to land before anybody gets home.
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(0, 0) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(-4, -2) }],
  ],
  steps: [
    {
      id: 'snap',
      text: 'Every play starts with the snap. The dashed arrow from your centre '
        + 'to the quarterback is already drawn — it is the one order you never '
        + 'have to give. You could aim it at somebody else, but not today. '
        + 'Press the fast-forward button to run the first half-second.',
      highlight: { kind: 'button', name: 'run' },
      allow: { action: 'run' },
      nudge: 'Press the fast-forward button to snap it.',
      needsLivePlay: true,
      demo: [{ verb: 'run' }],
      done: (state) => state.turnIndex > 0,
    },
    {
      id: 'run-the-qb',
      text: 'He has it. Drag out from the quarterback to send him running. '
        + 'The drag says two things at once: which way, and how hard — a long '
        + 'arrow is a sprint, a short one a jog. The filled circle is where he '
        + 'actually gets to by the whistle.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag'] },
      nudge: 'Drag out from the quarterback — he is the one with the ball.',
      needsLivePlay: true,
      demo: [{ verb: 'drag', id: 'o-qb', to: spot(-9, -3) }],
      done: (state) => getPlayer(state, 'o-qb').plan !== null,
    },
    runStep('run-it-1', 'Now run it. Half a second at a time is the whole game.', 1),
    {
      id: 'tuck',
      text: 'Double-tap the quarterback — two quick taps — and he tucks the ball '
        + 'away. Tucked he is a shade slower and much harder to strip, and he is '
        + 'locked onto the line he was already running: full pace along it, a '
        + 'shuffle across it.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on the quarterback, in the same place.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'o-qb', mode: 'tucked' }],
      done: (state) => getPlayer(state, 'o-qb').mode === 'tucked',
    },
    runStep('run-it-2', 'Run it again and see what the tuck bought you.', 2),
    whistleStep('Keep running it out. Arrows carry from turn to turn, so he '
      + 'keeps going until you tell him otherwise — or until they get him.'),
  ],
  outro: 'That is the whole loop: draw, run, draw again. Next, the two things '
    + 'that make a play out of it — a block and a throw.',
};

const BLOCK_AND_THROW = {
  id: 'block-and-throw',
  title: 'Blocking, and throwing it',
  variantId: 'tutorial-pass',
  seed: 2002,
  coach: 'offense',
  scripted: 'defense',
  buttons: ['run'],
  // What the men this lesson is NOT teaching are already doing. Applied once at
  // the deal, to the coach's own side, so a beginner is never asked to give an
  // order the gate would refuse him — and so the centre does his actual job
  // instead of standing on the ball watching the nose tackle run past.
  openingOrders: [{ id: 'o-c', cover: 'd-nt' }],
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(3, -2) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', cover: 'o-rb' }],
  ],
  steps: [
    {
      id: 'cut-block',
      text: 'You have a back now. Start with the centre: double-tap him for a '
        + 'cut block. Only a lineman can throw one and only on the first turn '
        + 'of a play — it is a call made at the line. The shove itself waits '
        + 'for the snap, so you can finish the huddle first.',
      highlight: { kind: 'player', id: 'o-c' },
      allow: { action: 'gesture', playerIds: ['o-c'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on the centre — the man over the ball.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'o-c', mode: 'cutBlock' }],
      done: (state) => getPlayer(state, 'o-c').mode === 'cutBlock',
    },
    {
      id: 'routes',
      text: 'Now send the quarterback and the back wherever you like — but keep '
        + 'the quarterback behind the line, because next turn he is throwing, '
        + 'and a forward pass from past the line is a flag.',
      highlight: { kind: 'player', id: 'o-rb' },
      allow: { action: 'gesture', playerIds: ['o-qb', 'o-rb'], kinds: ['drag'] },
      nudge: 'Drag out from the quarterback and from the back — both of them.',
      needsLivePlay: true,
      demo: [
        { verb: 'drag', id: 'o-qb', to: spot(-3, -6) },
        { verb: 'drag', id: 'o-rb', to: spot(13, -3) },
      ],
      done: (state) =>
        getPlayer(state, 'o-qb').plan !== null && getPlayer(state, 'o-rb').plan !== null,
    },
    runStep('run-it-1', 'Run it, and watch the centre go.', 0),
    {
      id: 'throw',
      text: 'Now the throw: double-tap the quarterback and, without letting go, '
        + 'drag onto the back. Dropping it on one of your own locks the ball '
        + 'onto him — the throw is aimed where he will be, not where he is.',
      highlight: { kind: 'player', id: 'o-rb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['passdrag', 'doubletap'] },
      nudge: 'Two quick taps on the quarterback, then drag onto the back.',
      needsLivePlay: true,
      demo: [{ verb: 'pass', from: 'o-qb', target: 'o-rb' }],
      done: (state) =>
        state.plannedPass?.from === 'o-qb' && state.plannedPass?.target === 'o-rb',
    },
    runStep('run-it-2', 'Let it go.', 1),
    whistleStep('Run it out. A forward pass is decided inside the turn it was '
      + 'thrown: caught, picked, or incomplete by the whistle.'),
  ],
  outro: 'A block, a route and a throw. Now the other side of the ball.',
};

const PLAYING_DEFENSE = {
  id: 'playing-defense',
  title: 'Playing defense',
  variantId: 'tutorial-2v2',
  // 3005, not 3003: at 3003 the quarterback fumbles on turn two and neither
  // man recovers, so the ball sits live on the grass and the down never ends.
  // That hang is what MAX_LESSON_TURNS now catches; the seed is what stops the
  // scripted path walking into it in the first place.
  seed: 3005,
  coach: 'defense',
  scripted: 'offense',
  buttons: ['run'],
  // Your nose tackle rushes without being told to. He is the man this lesson is
  // not about, and the centre is about to take him anyway — which is the lesson:
  // the block is why he never gets there, and why the backer has to.
  openingOrders: [{ id: 'd-nt', cover: 'o-qb' }],
  // The centre takes the nose tackle and the quarterback runs left, harder and
  // wider each turn. The lesson is entirely about the backer.
  orders: [
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-7, -4) }],
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-15, -2) }],
    [{ id: 'o-c', cover: 'd-nt' }, { id: 'o-qb', aim: spot(-22, 2) }],
  ],
  steps: [
    {
      id: 'cover',
      text: 'Your turn to stop it. The centre is going to take your nose tackle, '
        + 'and the quarterback is going left. Drag out from your linebacker and '
        + 'drop it on the quarterback: that is a cover order, not an arrow. It '
        + 'is re-aimed at wherever he has got to, every fraction of a second, '
        + 'which is how you stay with a man who cuts.',
      highlight: { kind: 'player', id: 'd-lb' },
      allow: { action: 'gesture', playerIds: ['d-lb'], kinds: ['drag'] },
      nudge: 'Drag from your linebacker onto the quarterback.',
      needsLivePlay: true,
      demo: [{ verb: 'cover', id: 'd-lb', target: 'o-qb' }],
      done: (state) => getPlayer(state, 'd-lb').cover === 'o-qb',
    },
    runStep('run-it-1', 'Run it and watch him track.', 0),
    {
      id: 'break-down',
      text: 'He is on him. Double-tap your linebacker to break down — feet set, '
        + 'arms out. He reaches further and hits harder inside the wedge he is '
        + 'facing, and from here he can only shuffle sideways. It is the trade '
        + 'the computer makes for itself when it gets this close.',
      highlight: { kind: 'player', id: 'd-lb' },
      allow: { action: 'gesture', playerIds: ['d-lb'], kinds: ['doubletap'] },
      nudge: 'Two quick taps on your linebacker.',
      needsLivePlay: true,
      demo: [{ verb: 'doubletap', id: 'd-lb', mode: 'prepared' }],
      done: (state) => getPlayer(state, 'd-lb').mode === 'prepared',
    },
    whistleStep('Now go and get him.'),
  ],
  outro: 'Cover a man, close him down, set your feet. One thing left: where '
    + 'everybody stands before any of it starts.',
};

const WHERE_THEY_STAND = {
  id: 'where-they-stand',
  title: 'Where they stand',
  variantId: 'tutorial-2v2',
  seed: 4004,
  coach: 'offense',
  scripted: 'defense',
  // 'menu' is listed for the whole scenario even though the clipboard stays
  // off the board for four of its five steps — app/main.js gates it
  // separately, off showsMenu() in machine.js, keyed to the one step whose
  // allow is 'menu'. It still has to be named here: a control has to be
  // fielded before it can be ringed, and this is what lets that last step put
  // a ring on it.
  buttons: ['reposition', 'run', 'menu'],
  // What the men this lesson is NOT teaching are already doing. Applied once at
  // the deal, to the coach's own side, so a beginner is never asked to give an
  // order the gate would refuse him — and so the centre does his actual job
  // instead of standing on the ball watching the nose tackle run past.
  openingOrders: [{ id: 'o-c', cover: 'd-nt' }],
  orders: [
    [{ id: 'd-nt', aim: spot(0, -4) }, { id: 'd-lb', aim: spot(0, 1) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', aim: spot(0, 0) }],
    [{ id: 'd-nt', cover: 'o-qb' }, { id: 'd-lb', cover: 'o-qb' }],
  ],
  steps: [
    {
      id: 'reposition-on',
      text: 'A play starts before the snap. Press the shuffle button to move '
        + 'your men around instead of ordering them about.',
      highlight: { kind: 'button', name: 'reposition' },
      allow: { action: 'reposition' },
      nudge: 'Press the shuffle button — the one above fast-forward.',
      needsLivePlay: true,
      demo: [{ verb: 'reposition' }],
      done: (state, ctx) => ctx.repositioning === true,
    },
    {
      id: 'move-him',
      text: 'Now drag your quarterback somewhere else. In this mode a drag moves '
        + 'the man rather than giving him an order, and the snap re-aims itself '
        + 'from wherever the two of them end up.',
      highlight: { kind: 'player', id: 'o-qb' },
      allow: { action: 'gesture', playerIds: ['o-qb'], kinds: ['drag', 'passdrag'] },
      nudge: 'Drag the quarterback to a new spot.',
      needsLivePlay: true,
      demo: [{ verb: 'move', id: 'o-qb', to: spot(-5, -5) }],
      done: (state, ctx) => {
        const p = getPlayer(state, 'o-qb');
        const was = ctx.startSpots['o-qb'];
        return p.pos.x !== was.x || p.pos.y !== was.y;
      },
    },
    {
      id: 'reposition-off',
      text: 'Press it again to go back to drawing arrows.',
      highlight: { kind: 'button', name: 'reposition' },
      allow: { action: 'reposition' },
      nudge: 'Press the shuffle button again.',
      needsLivePlay: true,
      demo: [{ verb: 'reposition' }],
      done: (state, ctx) => ctx.repositioning === false,
    },
    {
      id: 'coach-it',
      text: 'That is everything. Coach this one however you like — draw what you '
        + 'want, run it out, and see where it ends up.',
      highlight: null,
      allow: { action: 'any' },
      nudge: null,
      needsLivePlay: false,
      demo: [{ verb: 'drag', id: 'o-qb', to: spot(-8, -1) }, { verb: 'runout' }],
      done: (state) => playOver(state),
    },
    {
      id: 'the-menu',
      text: 'You are ready to coach. One last thing: the clipboard opens the '
        + 'Coaches Menu, and everything that is not on the board lives behind '
        + 'it — your playbook, your personnel, the velocity lines, and the way '
        + 'home. Press it, then press Back to Home.',
      highlight: { kind: 'button', name: 'menu' },
      allow: { action: 'menu' },
      nudge: 'Press the clipboard on the right to open the Coaches Menu.',
      needsLivePlay: false,
      demo: [{ verb: 'menu' }],
      // Read off the dialog itself rather than off a flag somebody has to
      // remember to set: the menu being open IS the thing this step is waiting
      // for, and <dialog>.open already knows.
      done: (state, ctx) => ctx.menuOpen === true,
    },
  ],
  // Never shown: opening the menu advances past the last step of the last
  // lesson, which is what ends the tutorial. It is written down anyway so that
  // cardFor has something to say if a lesson is ever reordered.
  outro: 'You are ready to coach. Pick a game and go.',
};

export const SCENARIOS = [SNAP_AND_RUN, BLOCK_AND_THROW, PLAYING_DEFENSE, WHERE_THEY_STAND];
