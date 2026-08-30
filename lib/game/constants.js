/**
 * Every tunable number in the game. Units are SVG units (1 yard = 3.75) and
 * seconds unless stated. Task 13 is the sanctioned place to retune these;
 * mid-task "this feels wrong" edits go through a failing test first.
 */

// --- the turn ---
export const TURN_SECONDS = 0.5;          // spec: half-second intervals
export const DT = 1 / 60;                 // physics sub-step
export const SUBSTEPS_PER_TURN = Math.round(TURN_SECONDS / DT); // 30

// --- players ---
export const TEAM_SIZE = 7;
export const RADIUS_LINE = 3.5;           // linemen: big, slow
export const RADIUS_MID = 3;              // QB, LB
export const RADIUS_SKILL = 2.5;          // RB, WR, CB, S: small, fast
// maxSpeed = SPEED_FACTOR / radius → skill 60 u/s (16 yd/s),
// mid 50 u/s, line 42.9 u/s. Smaller is faster (spec).
// Playtest: at 72 a skill player took ~8.3 turns to cross a 30-yard open
// field at full throttle; the spec wants ~4-5 (half-second turns brisk, not
// teleporting). At 150, measured: ~4.7 turns to cross a 30-yard open field at
// full throttle (142 sub-steps from a standing start, ACCEL-limited ramp
// included).
export const SPEED_FACTOR = 150;
export const ACCEL = 60;                  // units/s²: how fast a plan takes hold
export const IDLE_DAMPING = 0.96;         // per sub-step velocity decay with no plan

// --- planning arrows ---
export const MAX_ARROW_UNITS = 30;        // drag length that means full throttle

// --- contact friction (spec: hand-fighting slows players sliding past each other) ---
export const FRICTION_BLOCK = 0.4;        // engaged blocking
export const FRICTION_RELEASE = 0.15;     // brushing past at speed (receiver releasing)
export const FRICTION_HOLD = 0.6;         // against a defend-position player
export const RELEASE_SPEED = 20;          // rel. tangential speed above which contact counts as a release

// --- modes ---
export const TUCK_SPEED_MULT = 0.85;      // spec: tucked is a little slower
// Any special move (tucking, preparing, holding) locks a player onto one axis
// — see setMode in state.js — and does not slow him down THAT axis: he can
// still drive through it at full tilt (and back off down it just as fast).
// What it costs him is agility: movement ACROSS the locked axis is cut to this
// fraction of his top speed, so an opponent who makes him change direction
// beats him. See clampToStance in modes.js.
export const STANCE_LATERAL_MULT = 0.3;
export const HOLD_SPEED_MULT = 0.15;      // spec: movement severely limited
export const PREPARED_REACH = 2.5;        // extra reach in units while prepared
// A defender who has broken down is committed to one axis, and the reach bonus
// stance grants is measured against it. Straight ahead he can still strike:
// inside STANCE_CONE_HALF_ANGLE of his locked facing his reach is multiplied
// by PREPARED_REACH_MULT (a DT: 6 units becomes 12, a 3.2-yard strike zone).
// Outside it he is back to plain stance reach. The reach doubling is still
// prepared-only — a tucked runner or a holding blocker locks an axis for the
// speed cap below but gets no strike-zone bonus from it. The half-angle itself
// is shared with render.js, which draws the stance arc from this same
// number — so the wedge on the board is literally the wedge that tackles.
export const PREPARED_REACH_MULT = 2;
export const STANCE_CONE_HALF_ANGLE = Math.PI / 4;
export const HOLD_REACH = 3;              // extra reach while holding position
export const HOLD_MASS_MULT = 4;          // spec: resists momentum from chargers
export const CHARGE_MULT = 1.5;           // accel bonus the turn after tucking/preparing

// --- tackles ---
export const TACKLE_BASE = 1;
// With TUCK_BREAK_BONUS this makes tucked-vs-prepared exactly 50/50 — but only
// head-on. The bonus is earned inside STANCE_CONE_HALF_ANGLE of the defender's
// locked axis and nowhere else, so a defender the runner has got around is a
// defender with no power, not merely one with no reach.
export const PREPARED_TACKLE_BONUS = 1;
export const TUCK_BREAK_BONUS = 1;
export const NEARBY_RADIUS = 12;          // ~3.2 yd: teammates in on the tackle
export const NEARBY_BONUS = 0.5;          // per extra nearby defender
export const MOMENTUM_SCALE = 1 / 240;    // score per unit of (mass × speed)
export const TACKLE_COOLDOWN_SUBSTEPS = 15; // a broken tackle sidelines that defender briefly

// --- fumbles and loose balls ---
export const FUMBLE_UNTUCKED = 0.25;
export const FUMBLE_TUCKED = 0.05;        // spec: tucking protects the ball
// Total roll-out is closed-form: FUMBLE_BALL_SPEED * DT / (1 - BALL_FRICTION).
// 45 * (1/60) / 0.06 = 12.5 units = 3.33 yards — far enough that the ball is
// genuinely contestable (a skill player's pickup radius is only 3.5 units).
export const FUMBLE_BALL_SPEED = 45;      // loose-ball pop-out speed
export const BALL_FRICTION = 0.94;        // per sub-step loose-ball decay
export const PICKUP_RADIUS_BONUS = 1;     // how far past his own body a player can scoop
// The pop-out spawns at car.radius + PICKUP_RADIUS_BONUS + this, i.e. strictly
// outside the fumbler's own scoop range so he can't re-claim it on the spot.
export const FUMBLE_SPAWN_EPSILON = 0.5;
// Nobody may pick the ball up for this many sub-steps (~0.15s), so the pop-out
// actually travels and everyone gets a fair race at it.
export const LOOSE_BALL_GRACE_SUBSTEPS = 9;

// --- the computer opponent ---
// A pursuing player aims at the carrier's position plus his velocity over the
// time that pursuer needs to close the gap. That time is capped here, so a
// breakaway run leads the deep safety a sane distance instead of sending him
// into the parking lot.
export const AI_LEAD_MAX_SECONDS = 1;
// Inside this many units of the carrier a coached defender breaks down into the
// prepared stance — gets low, squares up (spec) — instead of sprinting past.
// It used to have to be short because the stance cost him most of his speed.
// It no longer does: he keeps full speed along the axis he commits to. What
// breaking down early costs him now is the CUT — he can only shuffle sideways —
// so a wide value hands the runner an easy cutback rather than a jog-around.
// The 11 has not been re-derived against the new stance; that is a playtest job.
export const AI_BREAKDOWN_UNITS = 11; // ~3 yards

// --- the debug overlay ---
// How far past a player's edge the debug marker's reach projects: his speed
// times this many seconds — half a turn, long enough to read as "this is
// where his heading is taking him" rather than a twitch. This value only
// sizes the un-scaled reach the velocity triangle is built from;
// DEBUG_VELOCITY_TRIANGLE_SCALE below is what turns it into the triangle's
// height beyond the player's rim.
export const DEBUG_VELOCITY_SECONDS = 0.25;
// That reach is sized right to draw as a *line*, but far too large as the
// height of a *filled* triangle sitting on the player's own rim — at top
// speed (a skill player's 60 u/s) the unscaled reach is six times the
// player's own 2.5-unit body. Two fifths of it puts the triangle's height at
// 6.0 units beyond the rim at top speed — more than twice the player's own
// size. That is deliberate, not an overshoot: the marker is sized for
// legibility at the *low* end of speed, not the high end, since a smaller
// constant leaves it a barely-visible nub there — even at this scale a
// player loafing at 10 u/s draws a triangle only 1.0 unit tall. Being
// oversized next to a player at a full sprint is the price of that.
export const DEBUG_VELOCITY_TRIANGLE_SCALE = 0.4;

// --- passing ---
// A throw is the loose-ball machinery with a much bigger initial speed, so its
// total flight is the same closed form as the fumble roll-out:
// speed * DT / (1 - BALL_FRICTION) = speed / 3.6 units.
// 400 / 3.6 = 111 units = 29.6 yards at full power — a long throw on a field
// whose whole depth is 30 yards. Half power covers about 15.
export const PASS_SPEED_MAX = 400;
// The shortest handoff still has to leave the passer's hands and reach the man
// beside him: 60 / 3.6 = 16.7 units = 4.4 yards of travel.
export const PASS_SPEED_MIN = 60;
// The ball leaves from the passer's leading edge, strictly outside his own
// scoop range so he cannot re-take his own throw where he stands — the same
// reasoning, and the same arithmetic, as FUMBLE_SPAWN_EPSILON.
export const PASS_SPAWN_EPSILON = 0.5;
// Nobody may claim a throw for this many sub-steps. Much shorter than
// LOOSE_BALL_GRACE_SUBSTEPS, because a throw only needs to clear the thrower,
// not give a scattered field a fair race: at PASS_SPEED_MIN the ball is
// already 2.8 units further out after 3 sub-steps, so a handoff to the man
// two yards away is still catchable this turn.
export const PASS_GRACE_SUBSTEPS = 3;
// A forward pass nobody caught is incomplete once the throw has decayed to
// walking pace — this game has no z axis, so this is what "it hit the ground"
// means. A backward throw never gets here: a lateral on the ground is live.
export const PASS_DEAD_SPEED = 12;
// The illegal-pass penalty: this many yards back from the previous spot, and
// the down counts.
export const PENALTY_YARDS = 5;
// How long the arrow is drawn for a full-power throw — an arrow length, not a
// drag length. Deliberately longer than MAX_ARROW_UNITS (the run arrow's
// length) because a throw covers far more ground than a run; the drag length
// that MEANS full power is MAX_ARROW_UNITS for both verbs, run and throw
// alike (see gesture.js's classifyGesture, which is the only place throttle
// is computed).
export const MAX_PASS_ARROW_UNITS = 60;
