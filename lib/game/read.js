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
 * This is the down as one object instead — the look it snapped against, a read
 * of what the play is, and the call it committed to — advanced once per turn
 * by turn.js and cleared by rules.js at every whistle.
 *
 * PURE and dice-free, like defense.js and zone.js beside it. The read is
 * fallible but it is not random: it is fooled because the evidence in front of
 * it genuinely says the wrong thing for a turn, which is both honest football
 * and the only version the training harness could reproduce from a seed.
 *
 * THE RULE THIS FILE RESTS ON: it may never look at the opponent's ORDERS —
 * not `plan`, not `cover`, not `mode`, not `state.plannedPass`. Positions,
 * velocities and the ball, and nothing else. advancePlay runs before coachAi,
 * so the board still holds the human's drawn arrows; a read that looked at
 * them would diagnose the play call off the arrows themselves, be perfect on
 * turn zero, and make play-action impossible by construction. A fake has to be
 * visible only as MOTION, one turn late.
 */
import { SNAP_TARGET_ID } from './state.js';
import { onTheLine } from './formation.js';
import { maxSpeed } from './modes.js';
import { yardsOfY } from './view.js';
import { OFFENSIVE_LINE_ROLES } from './rosters.js';
import { SIDELINE_LEFT, SIDELINE_RIGHT } from '../field/geometry.js';
import { READ_DROP_YARDS } from './constants.js';

/** Held to [-1,1], so that one genome range serves every cue and no raw yard
 *  count can swamp the accumulator on its own. */
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

/** How deep behind the line this man is, in yards. The offense advances in
 *  +y, so behind the line is a smaller y and therefore a positive depth. */
function depthYards(state, p) {
  return state.losYard - yardsOfY(p.pos.y);
}

/**
 * The picture the down started from, frozen at the top of turn 0.
 *
 * `spread` and `backs` are the two the scheme gate reads, and they are
 * deliberately the same two numbers formation.js's learnedPersonnel already
 * computes off a look — the same question, asked once and kept.
 *
 * `qbDepth` is NOT a gate feature. It is the reference the qbDepth cue
 * measures against: the quarterback already stands about six yards deep at
 * the snap, so a cue reading his absolute depth would call every play a pass.
 * What separates a drop from a run is how much deeper he gets than this.
 */
export function snapLook(state) {
  const them = state.players.filter((p) => p.team === 'offense');
  const xs = them.map((p) => p.pos.x);
  const qb = them.find((p) => p.id === SNAP_TARGET_ID);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
    backs: them.length ? them.filter((p) => !onTheLine(state, p)).length / them.length : 0,
    qbDepth: qb ? depthYards(state, qb) : 0,
  };
}

/**
 * What the last turn's physics left on the field, as evidence. Positive is a
 * pass key in every one of them.
 *
 * qbDepth  — how much deeper than the snap the quarterback has got. A real
 *            drop goes backwards; the option's fake boots him FORWARD, which
 *            is why the give does not read as a pass.
 * lineFlow — the line's mean speed downfield, negated. Run blocking drives
 *            downfield, pass protection sets and holds.
 * ballAir  — nobody is carrying it. Usefully NOT conclusive: a direct snap to
 *            the back is a setPass too, so the give looks like a throw for
 *            exactly one turn. That is the mesh point, and it costs nothing.
 */
export function readCues(state, look) {
  const them = state.players.filter((p) => p.team === 'offense');
  const qb = them.find((p) => p.id === SNAP_TARGET_ID);
  const line = them.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  const flow = line.length
    ? line.reduce((sum, p) => sum + p.vel.y / maxSpeed(p), 0) / line.length
    : 0;
  return {
    qbDepth: qb ? clamp1((depthYards(state, qb) - look.qbDepth) / READ_DROP_YARDS) : 0,
    lineFlow: clamp1(-flow),
    ballAir: state.ball.carrierId === null ? 1 : 0,
  };
}

/**
 * The belief, one turn on. Positive is pass.
 *
 * At the snap (`prev === null`) there are no cues, because nothing has moved:
 * the read is the genome's prior and the look, which is the order a defense
 * really does get its information in. After that each turn keeps
 * `read:inertia` of what it believed and adds what it has just seen — which is
 * where being fooled lives. At inertia 1 it never forgets and stays wrong for
 * turns; at 0 it is jumpy and commits to nothing.
 */
export function advanceRead(look, prev, cues, genome) {
  const z = prev === null
    ? genome['read:prior']
      + genome['read:spread'] * look.spread
      + genome['read:backs'] * look.backs
    : genome['read:inertia'] * prev.pass
      + genome['read:qbDepth'] * cues.qbDepth
      + genome['read:lineFlow'] * cues.lineFlow
      + genome['read:ballAir'] * cues.ballAir;
  return {
    pass: z,
    confidence: Math.tanh(Math.abs(z)),
    committed: Math.abs(z) > genome['read:commit'],
  };
}

/**
 * The down, one turn on. turn.js is the only caller, and calls it
 * UNCONDITIONALLY — never gated on state.aiTeam, because the training harness
 * runs hot-seat with no aiTeam at all and coaches both sides itself, so a
 * percept that needed one would be missing from every play a genome is scored
 * on.
 *
 * Built here rather than in rules.js's nextDown because nextDown ends before
 * the planning phase does: the coach then spends it dragging people around,
 * and a look frozen back there would be a picture nobody ever lined up in.
 */
export function advancePlay(state, genome) {
  if (!state.playRead) {
    const look = snapLook(state);
    state.playRead = {
      look,
      read: advanceRead(look, null, null, genome),
      call: { offense: null, defense: null },
    };
    return;
  }
  const { look, read } = state.playRead;
  state.playRead.read = advanceRead(look, read, readCues(state, look), genome);
}
