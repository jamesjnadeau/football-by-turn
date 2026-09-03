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

/**
 * @param root the #controls element
 * @param handlers a map of control name to the function its press calls
 */
export function mountControls(root, handlers) {
  const groups = new Map(
    [...root.querySelectorAll('.control-group')].map((el) => [el.dataset.group, el]),
  );
  const buttons = new Map();

  const buttonFor = (control) => {
    let btn = buttons.get(control.name);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'control';
    btn.dataset.control = control.name;
    btn.addEventListener('click', () => handlers[control.name]?.());
    groups.get(control.group).appendChild(btn);
    buttons.set(control.name, btn);
    return btn;
  };

  return {
    sync(controls) {
      const live = new Map(controls.map((c) => [c.name, c]));
      // Build or update everything the list holds, in the list's own order.
      for (const c of controls) {
        const btn = buttonFor(c);
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
      // the next down instead of being rebuilt.
      for (const [name, btn] of buttons) if (!live.has(name)) btn.hidden = true;
    },
  };
}
