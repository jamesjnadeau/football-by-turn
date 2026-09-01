/**
 * The tutorial's step machine. Pure: it reads a scenario and a game state and
 * says what may happen, what has happened, and what the card should say. It
 * mutates nothing and knows nothing about the browser.
 *
 * Strictness is drawn deliberately: strict on WHICH MAN and WHICH VERB, and
 * guiding on where the arrow lands. Refusing a cover drag that missed the
 * quarterback by two units would read as a broken game rather than as a lesson,
 * so a drag on the right man that achieves nothing is allowed — it simply does
 * not land the step, and the card asks again.
 */

/** The step at this index, or null — past the last step is the sign-off card. */
export function stepAt(scenario, index) {
  return scenario.steps[index] ?? null;
}

/**
 * Null to go ahead, or the words to say instead. The caller must not have
 * applied anything before asking: a refusal has to leave the board exactly as
 * the coach found it, or "that did not happen" becomes a lie.
 */
export function allows(scenario, index, action) {
  const step = stepAt(scenario, index);
  if (step === null) return null; // the sign-off gates nothing
  // A lone tap does nothing in the real game, and app/input.js records it as
  // the arming half of a double tap before this is ever consulted. Refusing one
  // would scold a coach halfway through a gesture the step actually wants.
  if (action.kind === 'gesture' && action.gestureKind === 'click') return null;
  const want = step.allow;
  if (want.action === 'any') return null;
  if (want.action !== action.kind) return step.nudge;
  if (want.action !== 'gesture') return null;
  if (!want.playerIds.includes(action.playerId)) return step.nudge;
  if (!want.kinds.includes(action.gestureKind)) return step.nudge;
  return null;
}

/**
 * The index after everything that has already landed. A loop rather than a
 * single check because one press can satisfy two beats at once — the turn that
 * finishes a run step can also be the turn that ends the play — and a coach
 * left sitting on a step whose condition is already true has no way forward.
 */
export function advance(scenario, index, state, ctx) {
  let i = index;
  while (i < scenario.steps.length && scenario.steps[i].done(state, ctx)) i += 1;
  return i;
}

/**
 * Whether the Coaches Menu should be on the board right now. True only for a
 * step that asks to be pressed — which is the last step of the last lesson, and
 * nothing else.
 *
 * Derived from the step rather than kept as a flag beside it so that the plate
 * drawn and the press accepted cannot disagree: one condition decides both.
 */
export function showsMenu(scenario, index) {
  return stepAt(scenario, index)?.allow.action === 'menu';
}

/**
 * Whether this down stopped being the one the script was written for. Asked
 * AFTER advancing, so the closing beat is reached before the whistle it is
 * meant to outlive gets called a failure.
 */
export function offScript(scenario, index, state) {
  if (state.penalty) return true;
  const step = stepAt(scenario, index);
  if (step === null || !step.needsLivePlay) return false;
  return state.phase === 'playOver' || state.phase === 'gameOver';
}

/**
 * What the coach card says. `attempt` counts from 1; from the second onwards
 * the footer names the skip, so a coach who keeps losing the down is always
 * shown the door rather than having to find it.
 */
export function cardFor(scenario, index, { attempt = 1, isLastScenario = false } = {}) {
  const step = stepAt(scenario, index);
  if (step === null) {
    return {
      title: scenario.title,
      progress: 'Lesson done',
      text: scenario.outro,
      highlight: null,
      control: isLastScenario ? 'Finish' : 'Next lesson',
      footer: null,
    };
  }
  return {
    title: scenario.title,
    progress: `Step ${index + 1} of ${scenario.steps.length}`,
    text: step.text,
    highlight: step.highlight ?? null,
    control: 'Skip lesson',
    footer: attempt > 1 ? 'Stuck? Skip lesson moves you on.' : null,
  };
}
