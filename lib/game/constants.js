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

// How far outside his own circle a player can be grabbed by a pointer. The same
// slop picks the man you are ORDERING (app/main.js's hitTest) and the man you
// are dragging ONTO to cover him (cover.js's opponentAt) — a fat-finger margin
// should not depend on which end of the drag it is.
export const PICK_SLOP_UNITS = 2;

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

// --- cut block ("tucked special": a lineman's cut block) ---
// An offensive lineman (OFFENSIVE_LINE_ROLES, rosters.js) may commit to this
// stance only on the first turn of a play (state.turnIndex === 0) — a cut
// block is called at the line, not drawn up mid-down. Committing arms the
// same CHARGE_MULT burst every stance grants (setMode, above), but the
// discrete shove itself waits until the turn actually starts running
// (applyPendingCutBlocks, block.js, called from turn.js) rather than firing
// the instant he commits — unlike an ordinary block, the push is not
// something physics has to resolve over the turn, but it is still timed to
// the snap, not to the double tap that called it.
export const CUT_BLOCK_ENGAGE_UNITS = 4;       // 1 yard, × 3.75 units/yard - 
// Hhow far away a defender may stand dead
// ahead of the blocker and still be the one who gets cut. Wide enough to
// reach the man lined up across from him, not the next gap over.
export const CUT_BLOCK_PUSH_UNITS = 1.875;     // 0.5 yard, × 3.75 units/yard —
// a pure positional shove: applyCutBlock (block.js) repositions the target
// but does not touch his velocity, forward or backward — no momentum for
// IDLE_DAMPING to bleed off afterward, just the discrete teleport itself.
export const CUT_BLOCK_DRIVE_SPEED_MULT = 0.3; // spec: can't move very fast
// the turn after — between HOLD_SPEED_MULT (0.15, "severely limited") and
// TUCK_SPEED_MULT (0.85, "a little slower"): driving hard, not going far.
export const CUT_BLOCK_DRIVE_REACH = 3;     // 1 yard, × 3.75 units/yard —
// driveReachBonus) — double HOLD_REACH (3): the spec's "much greater
// friction ... by a larger area".
export const FRICTION_CUT_BLOCK_DRIVE = 0.75;  // above FRICTION_HOLD (0.6):
// "much greater friction" than an ordinary held block. Like every friction
// coefficient in this file, it only bites the TANGENTIAL component of a
// contact — a defender sliding past or around the blocker — not a defender
// driving straight into him head-on; that resistance is effectiveMass, which
// cutBlockDrive deliberately does not touch (design decision 5). That is the
// right shape for a cut block: it does not anchor him against a bull rush,
// it makes it hard to release past him.
export const CUT_BLOCK_ASSIST_RADIUS_UNITS = 3.75; // spec: within 1 yard,
// measured edge-to-edge (see the plan's design decision 6) — × 3.75 units/yard.
export const CUT_BLOCK_ASSIST_SPEED_MULT = 1.25;   // spec: a speed boost
export const CUT_BLOCK_ASSIST_ACCEL_MULT = 1.5;    // spec: turns quicker — the
// same weight as CHARGE_MULT: "responds to a new direction faster" is exactly
// what accelMult means everywhere else in this file.

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

// --- lobs: the throw that goes UP ---
// How far a throw stays inside everybody's reach after it leaves the hand. Out
// to this many yards of FLIGHT the ball is an ordinary throw and anyone may
// take it; past it, on a throw long enough to arc, it is over their heads.
// It is also the lock-on range: a throw drag onto a man further away than this
// cannot be aimed at him, because the ball would be above him when it arrived.
export const LOB_LOCK_YARDS = 15;
// The window at the end of a lob's flight where the ball has come back down and
// can be caught — or picked off — as normal. It is also the RADIUS of the
// landing circle at the shortest lob: the ball comes down somewhere inside a
// catch window's worth of where it was aimed, which is the whole bargain of
// throwing one.
export const LOB_CATCH_YARDS = 1;
// How much wider that circle gets per yard of throw past LOB_LOCK_YARDS. At the
// longest throw in the game (29.6 yards) it puts the circle at
// 3 + 0.2 * 14.6 = 5.9 yards — twice the catch window, so a bomb is genuinely a
// guess, while a 16-yard lob is barely one.
// 3 + 0.1 * 14.6 = ~2.5
// 3 + 0.05 * 14.6 = ~1.25
export const LOB_SCATTER_PER_YARD = 0.05;
// How much longer a lob hangs than an ordinary throw of the same length, at
// FULL LOFT — the ceiling a coach reaches by dragging the committed arrow's
// tip all the way out (see pass.js's loftFromDrag). The yardstick is the
// whole board: a full-power throw covers its 29.6 yards in about one turn at
// LOB_MIN_TIME_MULT, so a fully lofted one that long takes two, and one at
// the lock boundary takes exactly one. That is the price of the arc — and
// the reason the receivers get a planning phase to run under a deep ball.
// Both this and LOB_MIN_TIME_MULT below carry a shared ×1.5: the earlier 1/2
// split (fastest arm covers the board in one turn, full loft in two) played
// too fast to read as a lob at all. The ×1.5 keeps that same 2:1 ratio
// between no loft and full loft — deadZoneSpan's widening formula leans on
// that ratio staying put — while slowing every lob, human and AI alike, by a
// third.
export const LOB_TIME_MULT = 3;
// The floor: how long a lob hangs with no loft dragged in at all. Half of
// LOB_TIME_MULT, so the same full-power bomb that takes two turns at full
// loft covers the board in exactly one at none — the fastest arm in the game
// throws it, and a coach who never touches the loft handle gets that throw
// by default.
export const LOB_MIN_TIME_MULT = 1.5;
// How much pointer travel, along the throw's own line, spans the loft handle's
// whole 0-to-1 range. Half of MAX_PASS_ARROW_UNITS — a smaller, second-thought
// gesture on top of the throw the coach already committed.
export const LOFT_DRAG_UNITS = 30;
// How forgiving a first touch on the loft handle is, in board units — its own
// margin, not PICK_SLOP_UNITS. The handle sits on a bare point in space (the
// near edge of the dead zone itself, see render.js's loftHandlePoint), not on
// a player's own body, so it earns a much fatter margin than the couple of
// units PICK_SLOP_UNITS gives every pick anchored to an actual body on the
// field. Widening PICK_SLOP_UNITS itself to fix this would have made every
// other pick in the game sloppier just to rescue one; this constant is
// scoped to the one target that needed it.
export const LOFT_HANDLE_RADIUS_UNITS = 8;
// How much bigger the ball is drawn at the top of its arc. There is no z axis
// on this board, so size is the only way to say "this one is over your head",
// and it is the same cue that says why nobody can catch it there.
export const LOB_BALL_SCALE = 2;

// --- covering a man ---
// How far ahead of a covered player his blocker aims, in seconds of that
// player's own velocity. Shorter than AI_LEAD_MAX_SECONDS because a blocker is
// working at arm's length, not running a pursuit angle across the field: lead
// him a whole second and the blocker steps past him on every cut.
export const COVER_LEAD_MAX_SECONDS = 0.5;
// The spec's "slight boost to blocking force". Effective mass is what decides
// who gives ground in a collision, so this is the whole of the force bonus.
// Deliberately far below HOLD_MASS_MULT's 4: the defend-position stance costs a
// player almost all his movement to earn that, and a cover order costs nothing.
export const COVER_MASS_MULT = 1.5;
// The spec's "slight boost to grab reach": extra contact distance between a
// blocker and the man he took, in units. 1.5 units is 0.4 yards — an arm, and
// half of what HOLD_REACH grants. It applies to that ONE pair, so taking a man
// on never turns a blocker into a wider obstacle for everyone else on the field.
export const COVER_GRAB_REACH = 1.5;
// How far the cover halo sticks out past the covered player's own circle. It is
// drawn in the layer BENEATH the players, so this rim is the only part of it
// anyone ever sees — the spec asks for exactly that: an edge just visible from
// under the man. Keep it well under a skill player's radius (2.5) or it stops
// reading as a shadow and starts reading as a target ring.
export const COVER_HALO_UNITS = 1.2;

// --- the computer's assignment defense (aiLevel: 'smart') ---
// The pursuit brain aims at a lead point; the assignment brain solves the
// actual intercept — the spot on the carrier's path that both men reach at the
// same instant. When there is no such spot (the carrier is faster and running
// away) it falls back to a lead, and this caps both. Longer than
// AI_LEAD_MAX_SECONDS because a solved intercept stays meaningful much further
// out than a guessed lead does.
export const AI_INTERCEPT_MAX_SECONDS = 2;
// Inside this many units of the carrier a defender stops managing leverage and
// contain and simply attacks the man. Deliberately a shade wider than
// AI_BREAKDOWN_UNITS (11), so he gives up the angle a moment before he breaks
// down into the stance: the two decisions are the same decision.
export const AI_ATTACK_UNITS = 12;
// How far on the goal side of the carrier a pursuing defender holds his aim
// point while he is still managing leverage. About a yard — enough that the
// carrier cannot simply run through the spot the defender was aiming at.
export const AI_LEVERAGE_CUSHION = 4;
// How far outside the ball a containing rusher keeps himself: 6 units, about a
// yard and a half. Enough that a carrier who wants that edge has to run round
// him rather than through the gap he left, and not so wide that the front
// stops being a front.
export const AI_CONTAIN_UNITS = 6;
// Where a linebacker waits while the run has yet to declare: this many units on
// his own side of the line of scrimmage. About two yards — a run fit, close
// enough to arrive at the hole and deep enough that he is not blocked by the
// front he is standing behind.
export const AI_BACKER_DEPTH_UNITS = 8;
// And when he stops waiting: the carrier coming within this many units of the
// line. About two yards, so a quarterback still setting up 4 yards deep does
// not pull him out of the middle of the field, but a back coming downhill does.
export const AI_BACKER_TRIGGER_UNITS = 8;
// How far on the goal side of the deepest threat the free defensive back
// plays. 20 units is about five and a third yards — on a field whose whole
// depth from the line to the goal is ten yards, that is as "deep" as deep
// gets. Not re-derived against a longer field; a playtest number.
export const AI_DEEP_CUSHION_UNITS = 20;
// Who counts as a receiver worth covering: an opponent who can run at least
// this fraction of the covering back's own top speed. It is the one honest
// generalization of "receiver" available — the game has no eligibility rule,
// but a lineman still cannot run with a corner. At 0.9 a corner (60 units/s)
// covers anyone above 54, which is every skill player and no lineman.
export const AI_THREAT_SPEED_RATIO = 0.9;

// --- between downs ---
// How long the finished play stays on the board before the game moves itself
// on — long enough to read the call ("Tackled!", "TOUCHDOWN!") and see where
// everyone ended up, short enough that nobody reaches for a button first.
export const DEAD_BALL_PAUSE_SECONDS = 4;

// --- lining up before the snap ---
// How close to the line of scrimmage a man has to be for it to count as
// lining up ON it: two yards. Anyone deeper is a back — there is no third
// category, so a formation is fully described by this one number.
//
// Wider than ALIGN_LINE_YARDS, the depth the formation actually stands at, and
// that gap is the point: the drive-start line sits a yard inside the zone
// rather than on its edge, so there is room on both sides of where the players
// really are and a drag landing slightly off cannot silently turn a receiver
// into a back. render.js draws the band while the coach is repositioning, so
// the edge he is working against is on the board rather than in his head.
export const ON_LINE_YARDS = 2;
// How far apart linebackers keep themselves across the field: 22.5 units, six
// yards. A UNITS value rather than a yards one because it is used as a lateral
// offset from the ball's x, which is already in units — the same reasoning as
// AI_CONTAIN_UNITS. A defense with one linebacker gets a lane of zero, which is
// what keeps a one-backer box playing exactly as it did before lanes existed.
export const BACKER_LANE_UNITS = 22.5;
// Where the computer's alignment puts each group, in yards off the line: the
// front head-up across the ball, the backer at depth behind it, the corners
// off their man, and the last man back over the top of everything.
//
// These ARE the drive-start defensive formation's depths (see state.js's
// DEFENSE), and deliberately so: aligning against an offense that has not
// moved has to put every defender back exactly where he already was, or
// nudging one receiver would teleport the whole defense. The test named
// "reproduces the drive-start defense" is what holds the two in step.
export const ALIGN_LINE_YARDS = 1;
export const ALIGN_CORNER_YARDS = 2;
export const ALIGN_BACKER_YARDS = 4;
export const ALIGN_DEEP_YARDS = 8;
// How far a defender is shifted at a time when the spot his job wants is
// already occupied, and how far the search may travel before giving up. One
// unit is finer than any body on the field, and the field is 200 units wide,
// so the scan cannot run out of room before it runs out of field.
export const ALIGN_NUDGE_UNITS = 1;
export const ALIGN_NUDGE_STEPS = 200;

// --- the full field ---
// Real football: kickoff-return position, not literally a kickoff (this game
// has none) -- the offense's first set of downs starts 1st and 10 from its
// own 20, same as after a touchback.
export const DRIVE_START_YARD = 20;
// Real football: the yardage a set of downs must reach for a fresh one.
export const FIRST_DOWN_YARDS = 10;
// How close to the offense's own goal line a new set of downs may be spotted.
// One yard behind the running back's own 7-yard split in the drive-start
// formation of every variant in rosters.js -- whose deepest man is the running
// back, seven yards back in both -- so the backfield never has to line up
// behind the goal line. rosters.test.js holds that against the tables. This game has no safety rule (see the plan's design
// decisions) -- this clamp exists to keep formations on the field, not to
// penalize being pinned deep.
export const MIN_SPOT_YARD = 8;
// The camera's fixed height, in yards: enough room behind the line of
// scrimmage for a sack, enough ahead to see the sticks and a turn's worth of
// running room. Only the window's POSITION scrolls with the line of
// scrimmage; its size never changes.
export const WINDOW_YARDS = 40;
export const WINDOW_BEHIND_YARDS = 15;
// How far behind the offense's own goal line the camera is allowed to
// scroll -- a little visual buffer, not a rule. There is no end zone drawn
// back there (design decision 7): the goal line at yard 0 is an ordinary
// labelled yard line like any other.
export const FIELD_LOW_YARD = -10;
// How far the ball may get from the line of scrimmage before the camera starts
// to follow it, in yards. Inside this the camera holds still, so a scrum at the
// line does not slide the field about; past it the camera trails the ball at
// exactly this distance, which parks the ball on screen and scrolls the field
// underneath. Ten yards is the sticks -- the camera starts moving at about the
// point the run has become a first down.
export const CAMERA_DEADZONE_YARDS = 10;

// --- pinch-zoom / drag-pan (touch only, pre-snap) ---
// 1x is the ordinary auto-following window above; a coach can pinch in this
// far past it to see a tight formation up close, and no further.
export const MIN_ZOOM_SCALE = 1;
export const MAX_ZOOM_SCALE = 3;

// --- the human offense's autoplan (QB run option) ---
// How far wide of the offensive line's own edge the play-side defender has to
// be standing before the read calls him "containing" rather than "crashing".
// The same idea as AI_CONTAIN_UNITS (a defense's own contain lane), read from
// the other side of the ball.
export const OPTION_READ_UNITS = 6;
// The lean every play-side runner takes off a straight-upfield line: the
// ratio of sideways push to forward push in the (unnormalized) direction
// before it is normalized. The dive stays tight to the line the o-line is
// stepping; OPTION_KEEP_LEAN is wider because the quarterback has to clear
// the crashed read defender rather than hit a blocked gap.
export const OPTION_DIVE_LEAN = 0.5;
export const OPTION_KEEP_LEAN = 1.2;
// The quarterback's fake when the RB actually has the ball: a step away from
// the play, shallow upfield -- OPTION_FAKE_FORWARD plays the same role
// OPTION_DIVE_LEAN's y=1 does for the dive, and OPTION_FAKE_THROTTLE keeps it
// well under full speed, since it is a sell and not the play.
export const OPTION_FAKE_FORWARD = 0.3;
export const OPTION_FAKE_THROTTLE = 0.5;
// How close a blocker has to already be to the man he's assigned before
// autoplan commits him to the holding stance instead of just running at him
// -- past this range he is still closing the gap, not yet in a position to
// screen anybody.
export const BLOCK_ENGAGE_UNITS = 4;
// The fan of running lanes the ball carrier's "find daylight" heuristic
// scores, in degrees off a straight-upfield line. 0 first, so a dead tie
// reads as "there is no reason to cut" rather than being resolved by
// whichever angle happens to iterate last.
export const DAYLIGHT_ANGLES_DEG = [0, -20, 20, -40, 40, -60, 60];
// How far ahead of the carrier a defender counts against a candidate lane at
// all. A defender further upfield of him than this has not committed to
// anything yet; one already behind him already missed. About 8 yards.
export const DAYLIGHT_LOOKAHEAD_UNITS = 30;
// --- learning the human's tendencies (lib/game/tendencies.js and the bias
//     lib/game/learned/defense-policy.js applies from it) ---
// The Laplace prior, in plays: how many imaginary neutral calls every count
// starts with. It is what makes a sample of three barely move the defense and
// a sample of twenty move it a lot, with no special case for "not enough data
// yet" anywhere — with nothing counted at all every read comes out exactly
// neutral, which is the same thing as no bias.
export const TENDENCY_PRIOR = 4;
// Where short yardage stops and long yardage starts, in yards to gain. Three
// buckets rather than ten, because a bucket is only useful once it has plays
// in it and a coach does not call thirty downs a night.
export const TENDENCY_SHORT_YARDS = 3;
export const TENDENCY_MEDIUM_YARDS = 7;
// How far off straight-upfield the average arrow of a called run has to lean
// before it counts as a run to one side rather than up the middle.
export const TENDENCY_SIDE_DEADZONE = 0.25;
// The three clamps on what a tendency may do. Every bias is bounded by one of
// these and by the smoothed read itself, so a habit shades the defense and can
// never replace it — the genome is still what plays.
// A logit shift against scheme:bias, whose own range is [-4, 4]: a read can
// move the man/zone call, but only from a gate that was already close.
export const TENDENCY_SCHEME_SHADE = 1;
// Yards of discount on the cost of covering the favorite receiver — about one
// body's worth of head start for the corner nearest him.
export const TENDENCY_COVER_DISCOUNT_YARDS = 3;
// Yards a zone anchor slides toward the side the runs have been going.
export const TENDENCY_ANCHOR_SHIFT_YARDS = 4;
