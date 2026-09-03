/**
 * What controls the coach has in front of him right now, as data.
 *
 * This is the whole of the rules: which controls exist, what each is called,
 * and when each is live. It renders nothing and touches no DOM, so `node --test`
 * can hold every one of those rules — which is the point. They used to be
 * stated three times over (the press function's own guard, `*.disabled` in
 * app/main.js's paint, and `off:` in the SVG renderer), and two of the three
 * lived where no test could reach them.
 *
 * The Coaches Menu and the button bar both render from this list, so a rule is
 * written once and both surfaces obey it by construction.
 */
import { canReposition } from './formation.js';
import { canUsePlays } from './play.js';
import { personnelId } from './rosters.js';
import { coachedSide } from './hud.js';
import { PLAY_SLOTS } from './playbook.js';

/**
 * Every control, in the order they are shown: the game controls as they stand
 * in the column today, then the playbook.
 *
 * The icons are written down here and nowhere else. They are `\u{…}` escapes
 * rather than literal characters — a keycap is three codepoints (`1`, U+FE0F,
 * U+20E3), and a careless paste or a diff tool that drops the variation
 * selector leaves a bare digit that still looks very nearly right.
 */
const CONTROLS = {
  ai: { icon: '\u{1F916}', group: 'game' },
  personnel: { icon: '\u{1F465}', group: 'game' },
  reposition: { icon: '\u{1F500}', group: 'game' },
  menu: { icon: '\u{1F4CB}', group: 'game' },
  autoplan: { icon: '\u{1F381}', group: 'game' },
  run: { icon: '\u{23E9}', group: 'game' },
  save: { icon: '\u{1F4BE}', group: 'playbook' },
  play1: { icon: '1\u{FE0F}\u{20E3}', group: 'playbook' },
  play2: { icon: '2\u{FE0F}\u{20E3}', group: 'playbook' },
  play3: { icon: '3\u{FE0F}\u{20E3}', group: 'playbook' },
  play4: { icon: '4\u{FE0F}\u{20E3}', group: 'playbook' },
  play5: { icon: '5\u{FE0F}\u{20E3}', group: 'playbook' },
};

/**
 * The playbook column is built by counting to PLAY_SLOTS and looking each slot
 * up by name, so a sixth slot added to playbook.js without a sixth row here
 * would ask for a control that does not exist. Checked once at load instead,
 * so the failure says which of the two moved.
 */
const PLAY_CONTROLS = Object.keys(CONTROLS).filter((n) => /^play\d+$/.test(n));
if (PLAY_CONTROLS.length !== PLAY_SLOTS) {
  throw new Error(
    `controls.js holds ${PLAY_CONTROLS.length} play controls, but the playbook has ${PLAY_SLOTS} slots`,
  );
}

/** The icons, by control name — for the Coaches Menu's own labels. */
export const CONTROL_ICONS = Object.fromEntries(
  Object.entries(CONTROLS).map(([name, c]) => [name, c.icon]),
);

/** Every control the game knows about, in display order. */
export function controlNames() {
  return Object.keys(CONTROLS);
}

export function controlsFor(state, {
  repositioning = false,
  animating = false,
  book = [],
  allow = null,
  // Threaded in rather than read: AI_MODES lives in ai.js, and importing that
  // for one string would drag the whole learned-AI module graph into a module
  // whose job is describing buttons.
  aiLabel = 'Defense',
  highlight = null,
} = {}) {
  // `allow` is what a tutorial lesson uses to field only the controls it is
  // teaching. A normal drive passes nothing and gets everything.
  const fielded = (name) => allow === null || allow.includes(name);
  const ringedName = highlight?.kind === 'button' ? highlight.name : null;
  const planning = !animating && state.phase === 'planning';
  const setUp = !animating && canReposition(state);
  const plays = !animating && canUsePlays(state);

  const rows = [];
  const add = (name, { label, aria = label, disabled, pressed }) => {
    if (!fielded(name)) return;
    const c = CONTROLS[name];
    rows.push({
      name, icon: c.icon, group: c.group, label, aria, disabled,
      ringed: name === ringedName,
      ...(pressed === undefined ? {} : { pressed }),
    });
  };

  add('ai', { label: aiLabel, disabled: !planning });
  add('personnel', {
    label: `Personnel: ${personnelId(state.variantId)}`,
    // Not the human's to press when the computer coaches the defense: it picks
    // its own package, and the two would fight on every press.
    disabled: !setUp || state.aiTeam === 'defense',
  });
  // The one control that goes rather than greys. Repositioning is illegal once
  // the first turn has run, and its absence is the coach's cue that the play is
  // under way — every other control greys in place, because a button that moves
  // or vanishes is one you have to go looking for.
  if (canReposition(state) && !animating) {
    add('reposition', {
      label: `Reposition: ${repositioning ? 'on' : 'off'}`,
      disabled: false,
      pressed: repositioning,
    });
  }
  // Never dead. Everything the menu holds is behind it, including the way out
  // of a game, so it stays pressable even while a turn is being drawn.
  add('menu', { label: 'Coaches Menu', aria: 'Open the Coaches Menu', disabled: false });
  add('autoplan', { label: `Autoplan ${coachedSide(state)}`, disabled: !planning });
  add('run', { label: 'Run Turn', disabled: !planning });

  // A play is what you come to the line with, so saving and calling one are
  // offered only on the first turn of a down.
  add('save', { label: 'Save current play', aria: 'Save the current play', disabled: !plays });
  for (let i = 0; i < PLAY_SLOTS; i++) {
    const play = book[i];
    add(`play${i + 1}`, {
      label: play ? play.name : '(empty)',
      // The bar's button is a bare digit, so its name is the only place the
      // play — or the fact that there is not one — can be said at all.
      aria: play ? `Call play ${i + 1}: ${play.name}` : `Play slot ${i + 1} is empty`,
      disabled: !plays || !play,
    });
  }
  return rows;
}
