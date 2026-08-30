/**
 * The home screen: what a coach lands on, and the only script the page loads.
 * The game is import()ed the first time somebody picks one off it, so nothing
 * about a drive — no state, no board, no listeners — exists until one is asked
 * for.
 *
 * The markup comes from lib/game/home.js as a string, the same way the board's
 * does. This file only writes it into the page and listens for the press.
 */
import { homeMarkup } from '../lib/game/home.js';
import { isPlayable } from '../lib/game/variants.js';

const home = document.getElementById('home');
const board = document.getElementById('board');

// The game module, once it has been asked for. main.js registers its listeners
// at module scope, so it is imported exactly once however many drives get
// played; startGame() is what every visit after the first calls.
let game = null;

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
  show(home, true);
}

async function start(variantId) {
  // The unplayable button is disabled in the markup; this is that same rule
  // said again, because a disabled button is a picture and this is the gate.
  if (!isPlayable(variantId)) return;
  show(home, false);
  show(board, true);
  game ??= await import('./main.js');
  game.startGame({ onExit: showHome });
}

home.innerHTML = homeMarkup();
// One listener on the section rather than one per button: the buttons are
// written in as markup, so matching on the way up means there is nothing to
// re-bind if the list of games ever changes.
home.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-variant]');
  if (btn) start(btn.dataset.variant);
});
showHome();
