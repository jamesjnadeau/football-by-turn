/**
 * What the defense makes of the down it is in.
 *
 * The brains are called once a turn and, before this file, answered from
 * whatever was in front of them at that instant: the man/zone gate re-read a
 * spread that grows as men scatter, so a coverage call could flip in the
 * middle of a play, and the coverage assignment re-ran its greedy claim every
 * turn, so a defender could hand his man off between turn one and turn two.
 * Neither was a decision anybody made.
 *
 * This is the down as one object instead — the look it snapped against, a
 * read of what the play is, and the call it committed to — advanced once per
 * turn by turn.js and cleared by rules.js at every whistle.
 *
 * PURE and dice-free, like defense.js and zone.js beside it. The read is
 * fallible but it is not random: it is fooled because the evidence in front
 * of it genuinely says the wrong thing for a turn, which is both honest
 * football and the only version the training harness could reproduce from a
 * seed.
 *
 * THE RULE THIS FILE RESTS ON: it may never look at the opponent's ORDERS —
 * not `plan`, not `cover`, not `mode`, not `state.plannedPass`. Positions,
 * velocities and the ball, and nothing else. advancePlay runs before coachAi,
 * so the board still holds the human's drawn arrows; a read that looked at
 * them would diagnose the play call off the arrows themselves, be perfect on
 * turn zero, and make play-action impossible by construction. A fake has to
 * be visible only as MOTION, one turn late.
 *
 * THE READ IS PER DEFENDER, AND HIS KEY IS HIS OWN MAN. A single scalar built
 * from team aggregates was measured at 28.1% correct over a thousand
 * post-snap turns -- worse than a coin flip -- and being wrong cost the whole
 * second level at once, so training answered by switching the mechanic off
 * every time. Each covering defender now reads the man he has been given:
 * the signal is far stronger (2.70 units/s downfield on a run against 14.18
 * on a pass, measured), and a wrong read costs one man out of position rather
 * than a unit displaced. A defender with nobody to cover -- the rushing
 * line, the deep free man, every defender in a zone scheme -- has no man to
 * read and therefore no read.
 */
import { onTheLine } from './formation.js';
import { getPlayer } from './state.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { SPEED_FACTOR } from './constants.js';

/** Held to [-1,1], so that one genome range serves every cue and no raw
 *  velocity can swamp the accumulator on its own. */
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/**
 * How fast this man could run with no stance in it.
 *
 * NOT maxSpeed: that multiplies by SPEED_MULT[p.mode], and a stance is an
 * ORDER — offense.js sets 'holding' on a blocker who has engaged, which is
 * what pass protection looks like, while run blocking sets 'cutBlock'. Divide
 * by that and the divisor alone would tell the defense run from pass, which
 * is the one thing this file may never learn except from motion. A radius is
 * a body, not an order.
 */
function baseSpeed(p) {
  return SPEED_FACTOR / p.radius;
}

/**
 * The picture the down started from, frozen at the top of turn 0.
 *
 * `spread` is what the scheme gate reads, and it is deliberately the same
 * number formation.js's learnedPersonnel already computes off a look -- the
 * same question, asked once and kept. Taking it from here rather than
 * measuring it live is what stops the man/zone call flipping in the middle
 * of a play: men scatter, so a live width grows all down long, and a gate
 * reading it would answer a different question every turn. A scheme is a
 * pre-snap call.
 */
export function snapLook(state) {
  const them = state.players.filter((p) => p.team === 'offense');
  const xs = them.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
    backs: them.length ? them.filter((p) => !onTheLine(state, p)).length / them.length : 0,
  };
}

/**
 * The cues one covering defender reads off the man he has been given. Both
 * are independent of the DEFENDER's own position -- a cue that moved when he
 * moved would be reading himself, not the offense -- and both are measured
 * against that man's own top speed, with no stance in it (baseSpeed keeps
 * the same body-not-orders rule the line's cue used to).
 *
 * `downfield` is signed and positive is downfield, since the offense
 * advances in +y: a man who is not getting downfield is not running a
 * route. `lateral` is the unsigned sideways component, which is what
 * separates a real pass from the fake (a pulling lineman moves sideways
 * too, but not downfield).
 */
export function manCues(state, man) {
  const speed = baseSpeed(man);
  return {
    downfield: clamp1(man.vel.y / speed),
    lateral: clamp1(Math.abs(man.vel.x) / speed),
  };
}

/**
 * One defender's belief, one turn on. Positive is pass.
 *
 * `read:man:bias` first, as a constant applied on every advance rather than
 * only at the snap: `downfield` and `lateral` are both non-negative by
 * construction (lateral is an absolute value; downfield is positive on
 * nearly every turn), so with no intercept the sign of z is fixed by the
 * weights alone and the read can only ever answer one class. The bias is
 * what lets the decision boundary sit away from the origin. Then
 * `read:man:inertia` of what he believed last turn carries forward, plus
 * what he has just seen off his own man. At inertia 1 he never forgets and
 * stays wrong for turns after a fake ends; at 0 he is jumpy and never
 * commits to anything.
 */
export function advanceRead(prev, cues, genome) {
  const z = genome['read:man:bias']
    + genome['read:man:inertia'] * (prev ? prev.pass : 0)
    + genome['read:man:downfield'] * cues.downfield
    + genome['read:man:lateral'] * cues.lateral;
  return {
    pass: z,
    confidence: Math.tanh(Math.abs(z)),
    committed: Math.abs(z) > genome['read:man:commit'],
  };
}

/**
 * Every covering defender's read, one turn on. `cover` is the down's own
 * {defenderId: receiverId} map (read.js:committedCover writes it, once, at
 * turn 0) or null/undefined -- no assignments yet, or a zone down, which has
 * none ever -- and either way nobody gets a read.
 *
 * A defender whose man has since left the field (traded off, subbed out)
 * simply gets no cue and no read this turn; his old belief is not carried
 * forward past that, since the accumulator is rebuilt fresh off `cover` every
 * time rather than patched.
 */
function advanceReads(state, prevReads, cover, genome) {
  if (!cover) return {};
  const reads = {};
  for (const [defenderId, receiverId] of cover) {
    const man = getPlayer(state, receiverId);
    if (!man) continue;
    reads[defenderId] = advanceRead(prevReads[defenderId] ?? null, manCues(state, man), genome);
  }
  return reads;
}

/**
 * A fresh down's percept. THE one constructor: setCalledPlay builds a percept
 * too, and when two constructors disagree the difference is invisible until
 * something depends on it.
 */
function newPlayRead(state) {
  return {
    look: snapLook(state),
    // Whether the snap read has been taken yet. advancePlay branches on THIS
    // and not on whether the percept exists, because the percept can exist
    // first: the training harness coaches both sides before runTurn, and the
    // offense's autoplan button runs during the planning phase. If existence
    // decided it, those downs would skip the snap read altogether.
    snapped: false,
    // {defenderId: {pass, confidence, committed}}, one entry per covering
    // defender. Empty until assignments exist and cues have been seen --
    // there are none at the snap, since nothing has moved and cover.js's
    // `call.defense.cover` is not written until learnedOrders first runs.
    reads: {},
    call: { offense: null, defense: null },
    // The turnIndex this percept's read was last advanced for, so a turn
    // cannot be advanced twice. The training harness advances the read
    // itself, before it gives orders, and runTurn then advances it again a
    // moment later — one of those has to be a no-op or the down's evidence
    // is counted twice.
    advancedTurn: null,
  };
}

/**
 * The down, one turn on. turn.js is the only caller, and calls it
 * UNCONDITIONALLY — never gated on state.aiTeam, because the training harness
 * runs hot-seat with no aiTeam at all and coaches both sides itself, so a
 * percept that needed one would be missing from every play a genome is
 * scored on.
 *
 * Built here rather than in rules.js's nextDown because nextDown ends before
 * the planning phase does: the coach then spends it dragging people around,
 * and a look frozen back there would be a picture nobody ever lined up in.
 *
 * The percept can already exist by the time this runs — setCalledPlay may
 * have built it first (see below) — so the snap read is gated on the
 * `snapped` flag, not on `state.playRead` itself.
 *
 * Idempotent per turn (`advancedTurn`): the training harness now advances the
 * read itself before it gives orders (see train/harness.js's defenseCoach),
 * and runTurn calls this again a moment later on the same turn. Without the
 * guard the second call would count that turn's evidence twice; with it,
 * runTurn's own call is simply a no-op.
 *
 * There are no cues at the snap: `call.defense.cover` does not exist until
 * learnedOrders first runs (turn 0, inside coachAi, which runs AFTER this).
 * So the turn where `snapped` is still false always leaves `reads` at `{}`,
 * and the first turn any defender's belief can move is turn 1, once the map
 * this turn's coachAi wrote is there to key off.
 */
export function advancePlay(state, genome) {
  if (!state.playRead) state.playRead = newPlayRead(state);
  const p = state.playRead;
  if (p.advancedTurn === state.turnIndex) return;
  // Until the snap, the look is whatever is on the field NOW. setCalledPlay
  // can build the percept during the planning phase — the offense's autoplan
  // button does exactly that — and the coach may then drag somebody before he
  // snaps. Re-measuring here is what keeps the frozen look the picture they
  // actually lined up in rather than the one that happened to be there first.
  if (!p.snapped) p.look = snapLook(state);
  p.reads = p.snapped
    ? advanceReads(state, p.reads, p.call.defense?.cover, genome)
    : {};
  p.snapped = true;
  p.advancedTurn = state.turnIndex;
}

/**
 * The call one side committed to this down, and the way to set it.
 *
 * Tolerant of a missing percept on purpose: the training harness coaches both
 * sides BEFORE runTurn (see playOnePlay), so a coach can be the first thing to
 * touch a fresh down, ahead of advancePlay. Rather than make every caller
 * check, the setter builds the down through the same constructor advancePlay
 * uses, so a call written before the first advancePlay does not cost the down
 * its snap read.
 */
export function calledPlay(state, side) {
  return state.playRead ? state.playRead.call[side] : null;
}

export function setCalledPlay(state, side, play) {
  if (!state.playRead) state.playRead = newPlayRead(state);
  state.playRead.call[side] = play;
}
