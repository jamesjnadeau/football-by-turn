/**
 * The home screen: what a coach lands on, and the only script the page loads.
 * The game is import()ed the first time somebody picks one off it, so nothing
 * about a drive — no state, no board, no listeners — exists until one is asked
 * for.
 *
 * The markup comes from lib/game/home.js as a string, the same way the board's
 * does. This file only writes it into the page and listens for the press.
 */
import { homeMarkup, sideMarkup, sidesFor, homeAction } from '../lib/game/home.js';
import { isPlayable, getVariant } from '../lib/game/variants.js';
import { loadTutorialDone } from './tutorial-store.js';
import { MULTIPLAYER } from './build-config.js';

const home = document.getElementById('home');
const board = document.getElementById('board');
const controls = document.getElementById('controls');

// The game module, once it has been asked for. main.js registers its listeners
// at module scope, so it is imported exactly once however many drives get
// played; startGame() is what every visit after the first calls.
let game = null;

// The variant whose side chooser is on screen, or null when the variant
// list is. Only the click handler reads it, so the two screens cannot get
// out of step with what a press means.
let pickedVariant = null;

// Whether the home screen is still the thing drawn in `home`. False from the
// moment multiplayer takes the section over -- see startMultiplayer and
// homeAction in lib/game/home.js for why a listener has to know this.
let ownsSection = true;

function showChoices() {
  pickedVariant = null;
  ownsSection = true;
  home.innerHTML = homeMarkup(undefined, { tutorialDone: loadTutorialDone() });
}

/**
 * `hidden` is an HTMLElement property, and the board is an <svg> — an
 * SVGElement, which has no such property at all: assigning to it writes a
 * field nobody reads and leaves the attribute, and the `#board[hidden]` rule
 * in index.html, exactly where they were. The attribute is what CSS matches,
 * so setting the attribute is the only thing that actually shows or hides
 * anything here. The section would tolerate the property; it goes through the
 * same helper so there is one way of doing this rather than two.
 */
function show(el, visible) {
  el.toggleAttribute('hidden', !visible);
}

function showHome() {
  show(board, false);
  show(controls, false);
  show(home, true);
  showChoices();
}

async function startTutorial() {
  show(home, false);
  show(board, true);
  game ??= await import('./main.js');
  // The bar is shown only once main.js has built its buttons. On a phone it is
  // a full-width bordered strip, so showing it before the import lands paints
  // an empty box across the bottom of the screen for as long as the module
  // takes to arrive.
  show(controls, true);
  game.startTutorial({ onExit: showHome });
}

async function start(variantId, side) {
  // The unplayable button is disabled in the markup; this is that same rule
  // said again, because a disabled button is a picture and this is the gate.
  if (!isPlayable(variantId)) return;
  show(home, false);
  show(board, true);
  game ??= await import('./main.js');
  show(controls, true); // after the import, for the reason startTutorial() gives
  game.startGame({ variant: variantId, side, onExit: showHome });
}

// The multiplayer module, imported the same lazily-once way main.js is —
// nothing about a lobby socket exists until a coach actually picks
// Multiplayer off the side chooser.
let multiplayerModule = null;

async function startMultiplayer(variantId) {
  // Handing the section over, not just the screen. app/multiplayer.js draws
  // its own side chooser here out of the same sideMarkup, so its buttons
  // carry the same data-side this file's listener matches on; without giving
  // up ownership, one press would enter the lobby AND start a single-player
  // game. showChoices takes it back when a coach comes home.
  ownsSection = false;
  show(home, false);
  show(board, true);
  multiplayerModule ??= await import('./multiplayer.js');
  multiplayerModule.startMultiplayer({ variant: variantId, onExit: showHome });
}

// One listener on the section for both screens: the buttons are written in
// as markup, so matching on the way up means there is nothing to re-bind
// when the screen swaps from the game list to the side chooser and back.
home.addEventListener('click', (e) => {
  const sideBtn = e.target.closest?.('[data-side]');
  const variantBtn = e.target.closest?.('[data-variant]');
  const action = homeAction({
    tutorial: !!e.target.closest?.('[data-tutorial]'),
    back: !!e.target.closest?.('[data-home-back]'),
    // A side means nothing without the game it is a side of.
    side: pickedVariant ? sideBtn?.dataset.side : undefined,
    variant: variantBtn?.dataset.variant,
  }, { owns: ownsSection });
  if (action === null) return;
  if (action.kind === 'tutorial') startTutorial();
  else if (action.kind === 'back') showChoices();
  else if (action.kind === 'side') {
    if (action.side === 'multiplayer') startMultiplayer(pickedVariant);
    else start(pickedVariant, action.side);
  } else if (action.kind === 'variant' && isPlayable(action.variant)) {
    pickedVariant = action.variant;
    home.innerHTML = sideMarkup(getVariant(pickedVariant),
      sidesFor({ multiplayer: MULTIPLAYER }));
  }
});
/**
 * A tab that reloaded mid-match goes back to its match, not to the menu.
 * Only a build with a Worker behind it can have saved one; the import is
 * the same lazy one startMultiplayer makes.
 */
async function resumeOrHome() {
  if (MULTIPLAYER) {
    ownsSection = false;
    multiplayerModule ??= await import('./multiplayer.js');
    if (multiplayerModule.resumeSavedMatch({ onExit: showHome })) return;
  }
  showHome();
}
resumeOrHome();
