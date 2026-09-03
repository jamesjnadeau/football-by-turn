/**
 * The home screen: what a coach lands on, and the only script the page loads.
 * The game is import()ed the first time somebody picks one off it, so nothing
 * about a drive — no state, no board, no listeners — exists until one is asked
 * for.
 *
 * The markup comes from lib/game/home.js as a string, the same way the board's
 * does. This file only writes it into the page and listens for the press.
 */
import { homeMarkup, sideMarkup } from '../lib/game/home.js';
import { isPlayable, getVariant } from '../lib/game/variants.js';
import { loadTutorialDone } from './tutorial-store.js';

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

function showChoices() {
  pickedVariant = null;
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
  show(controls, true);
  game ??= await import('./main.js');
  game.startTutorial({ onExit: showHome });
}

async function start(variantId, side) {
  // The unplayable button is disabled in the markup; this is that same rule
  // said again, because a disabled button is a picture and this is the gate.
  if (!isPlayable(variantId)) return;
  show(home, false);
  show(board, true);
  show(controls, true);
  game ??= await import('./main.js');
  game.startGame({ variant: variantId, side, onExit: showHome });
}

// One listener on the section for both screens: the buttons are written in
// as markup, so matching on the way up means there is nothing to re-bind
// when the screen swaps from the game list to the side chooser and back.
home.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-tutorial]')) {
    startTutorial();
    return;
  }
  if (e.target.closest?.('[data-home-back]')) {
    showChoices();
    return;
  }
  const sideBtn = e.target.closest?.('[data-side]');
  if (sideBtn && pickedVariant) {
    start(pickedVariant, sideBtn.dataset.side);
    return;
  }
  const btn = e.target.closest?.('[data-variant]');
  if (btn && isPlayable(btn.dataset.variant)) {
    pickedVariant = btn.dataset.variant;
    home.innerHTML = sideMarkup(getVariant(pickedVariant));
  }
});
showHome();
