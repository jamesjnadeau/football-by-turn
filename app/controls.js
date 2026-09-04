/**
 * The control buttons, as real DOM.
 *
 * Every rule about which controls exist and when they are live is in
 * lib/game/controls.js; this file only paints them. It builds each button once
 * and thereafter writes only text, `disabled` and classes — never innerHTML,
 * which would throw away the focus of anyone working the controls from the
 * keyboard. app/main.js already learned that with the menu's slot buttons.
 *
 * It does not import app/main.js: main.js mounts this and hands the press
 * handlers over, so the dependency runs one way and main.js stays the single
 * owner of what a press does.
 */
import { controlNames, CONTROL_GROUPS } from '../lib/game/controls.js';

/**
 * @param root the #controls element
 * @param handlers a map of control name to the function its press calls
 * @param playbookIcon the emoji the phone layout's playbook toggle wears —
 *   handed in rather than reached for, so the icon stays written down once,
 *   in CONTROLS in lib/game/controls.js
 */
export function mountControls(root, handlers, playbookIcon) {
  const groups = new Map(
    [...root.querySelectorAll('.control-group')].map((el) => [el.dataset.group, el]),
  );
  const buttons = new Map();

  // Every button is built here, in the table's own order — controlNames() —
  // and hidden until a sync() says otherwise. None are grown on first sight:
  // a button appended only when its control first appeared in a filtered list
  // would land wherever THAT call's subset put it, not where the table says
  // the column reads. Lesson 4 fields reposition and run in one call and adds
  // menu only on a later one; a grow-on-sight column would read
  // run/reposition/menu instead of the table's reposition/menu/run, because a
  // hidden sibling still holds its place in flex layout — DOM order is what
  // decides where each button falls, regardless of which are visible.
  for (const name of controlNames()) {
    // Both of these are mount-time assertions about the two things this file
    // cannot see for itself: the markup it appends into, and the handler map
    // it was handed. Without them a control whose group has no container in
    // index.html throws `Cannot read properties of undefined` out of the loop
    // and takes the whole app down at mount with nothing naming the missing
    // piece, while a control with no handler is worse — it builds, paints,
    // takes the press and does nothing at all, silently.
    const group = groups.get(CONTROL_GROUPS[name]);
    if (!group) {
      throw new Error(
        `the ${name} control belongs to the ${CONTROL_GROUPS[name]} group, `
        + 'which has no [data-group] container in index.html',
      );
    }
    if (!handlers[name]) throw new Error(`the ${name} control was mounted with no handler`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'control';
    btn.dataset.control = name;
    btn.hidden = true;
    btn.addEventListener('click', () => handlers[name]());
    group.appendChild(btn);
    buttons.set(name, btn);
  }

  // The playbook lives behind a toggle on a narrow screen — see the media
  // query. Its open/closed state is view state and belongs here; nothing in the
  // game knows or cares whether the sheet is showing.
  const toggle = root.querySelector('#playbook-toggle');
  if (!toggle) throw new Error('#playbook-toggle is missing from index.html');
  const setOpen = (open) => {
    root.classList.toggle('playbook-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.textContent = playbookIcon;
  toggle.setAttribute('aria-label', 'Show the playbook');
  toggle.hidden = false;
  toggle.addEventListener('click', () => setOpen(!root.classList.contains('playbook-open')));
  // Escape closes the sheet, because that is what Escape does to anything
  // covering the page — the <dialog> the Coaches Menu lives in gets it for
  // free from the platform, and a sheet built out of a class on a div has to
  // ask. It listens on the document rather than on the sheet: the coach may
  // have the sheet open with focus still on the board behind it. Registered
  // here at mount alongside the toggle's own listener, so sync() keeps its
  // promise never to create, remove or re-parent anything.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('playbook-open')) setOpen(false);
  });
  setOpen(false);

  return {
    sync(controls) {
      const live = new Map(controls.map((c) => [c.name, c]));
      // Update everything the list holds; every button already exists.
      for (const c of controls) {
        const btn = buttons.get(c.name);
        // The icon is the button's whole visible content; `aria-label` is what
        // it announces, because there is no text beside it to read.
        if (btn.textContent !== c.icon) btn.textContent = c.icon;
        btn.setAttribute('aria-label', c.aria);
        btn.disabled = c.disabled;
        btn.hidden = false;
        btn.classList.toggle('is-ringed', c.ringed);
        if (c.pressed === undefined) btn.removeAttribute('aria-pressed');
        else btn.setAttribute('aria-pressed', String(c.pressed));
      }
      // A control the list left out is hidden rather than removed, so its
      // button — and anything the browser is tracking about it — survives to
      // the next down instead of being rebuilt. Its ring and pressed state are
      // cleared too: the shuffle can go from ringed (lesson 4's first step)
      // or pressed (mid-reposition) straight to hidden (the snap), and a
      // hidden button has no business remembering either.
      for (const [name, btn] of buttons) {
        if (live.has(name)) continue;
        btn.hidden = true;
        btn.classList.remove('is-ringed');
        btn.removeAttribute('aria-pressed');
      }
      // The toggle has nothing behind it once the list fields no playbook
      // control — a tutorial step that narrows the board to a single button
      // is the case that matters, but any state with an empty playbook group
      // would otherwise leave the toggle standing over a sheet with nothing
      // in it. Hiding it is an attribute write on a node that already exists,
      // same as every button above; closing the sheet alongside it means a
      // state change can never leave it open over nothing.
      const hasPlaybook = controls.some((c) => c.group === 'playbook');
      toggle.hidden = !hasPlaybook;
      if (!hasPlaybook) setOpen(false);
    },
  };
}
