/**
 * Assignment defense: the computer's second brain (`state.aiLevel === 'smart'`).
 *
 * Where ai.js's pursuit brain sends everyone at the ball, this one gives each
 * defender a job derived from where he is standing. Three functions do the
 * work, one per position — rushLineman, flowLinebacker, coverBack — and
 * smartOrder picks between them.
 *
 * Everything here is PURE: it reads `state` and returns orders. ai.js is the
 * only thing that writes them, which is what keeps the computer's plans out of
 * the state (and so off the screen) until the turn actually runs.
 *
 * Positions are read off the FIELD, not off role names. The contain side of a
 * lineman comes from where his own line is standing; the deep man is whoever is
 * aligned deepest; a "receiver" is anyone who can run with a defensive back.
 * A four-man front, an unbalanced one, or a role this file has never heard of
 * all still get coached.
 */
import { fieldPos } from './view.js';

/**
 * Role → position. Written as a table rather than as a test on the role string
 * so adding an end or a nickel back is one line here. Anything unlisted is
 * coached as a linebacker: the generalist's job — flow to the ball with
 * leverage — is the least wrong thing to do with a player you cannot place.
 */
const GROUPS = {
  NT: 'line', DT: 'line', DE: 'line',
  LB: 'backer', MLB: 'backer', OLB: 'backer',
  CB: 'back', S: 'back', FS: 'back', SS: 'back',
};

export function positionGroup(player) {
  return GROUPS[player.role] ?? 'backer';
}

/**
 * Which way along y this team's goal lies — the direction it is defending, and
 * so the direction "goal side" and "deep" mean for every function below. The
 * offense drives at +y (view.js: the goal line is yard 10, the backfield is
 * negative), so the defense protects +y and the offense protects -y.
 */
export function defendDir(team) {
  return team === 'offense' ? -1 : 1;
}

/** The line of scrimmage in SVG y. */
export function losY(state) {
  return fieldPos(0, state.losYard).y;
}

/** Whether `point` has got past the line, from `team`'s point of view. */
export function pastLine(state, team, point) {
  const dir = defendDir(team);
  return dir > 0 ? point.y > losY(state) : point.y < losY(state);
}

/**
 * The teammates playing the same position as `player`, himself included, in
 * `state.players` order. Contain assignments are shared out among these, so
 * this is what makes "the left edge rusher" a fact about the front rather than
 * a fact about an id.
 */
export function groupMates(state, player) {
  const group = positionGroup(player);
  return state.players.filter(
    (p) => p.team === player.team && positionGroup(p) === group,
  );
}
