var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/lobby-engine.js
function createLobby() {
  return { offense: [], defense: [] };
}
__name(createLobby, "createLobby");
function depthMessage(record) {
  return { to: "broadcast", type: "queued", offense: record.offense.length, defense: record.defense.length };
}
__name(depthMessage, "depthMessage");
function maybePair(record) {
  if (record.offense.length === 0 || record.defense.length === 0) return { record, messages: [] };
  const [offenseId, ...restOffense] = record.offense;
  const [defenseId, ...restDefense] = record.defense;
  const matchId = `${offenseId}:${defenseId}:${Date.now()}`;
  return {
    record: { offense: restOffense, defense: restDefense },
    messages: [
      { to: offenseId, type: "matched", matchId, side: "offense" },
      { to: defenseId, type: "matched", matchId, side: "defense" }
    ]
  };
}
__name(maybePair, "maybePair");
function removeFrom(record, id) {
  return {
    offense: record.offense.filter((x2) => x2 !== id),
    defense: record.defense.filter((x2) => x2 !== id)
  };
}
__name(removeFrom, "removeFrom");
function applyLobbyMessage(record, message) {
  if (message.type === "join") {
    const withJoin = { ...removeFrom(record, message.id) };
    withJoin[message.side] = [...withJoin[message.side], message.id];
    const paired = maybePair(withJoin);
    const messages = paired.messages.length > 0 ? paired.messages : [depthMessage(paired.record)];
    return { record: paired.record, messages };
  }
  if (message.type === "switch") {
    const inOffense = record.offense.includes(message.id);
    const inDefense = record.defense.includes(message.id);
    if (!inOffense && !inDefense) return { record, messages: [] };
    const side = inOffense ? "defense" : "offense";
    return applyLobbyMessage(removeFrom(record, message.id), { type: "join", id: message.id, side });
  }
  if (message.type === "leave") {
    const next = removeFrom(record, message.id);
    if (next.offense.length === record.offense.length && next.defense.length === record.defense.length) {
      return { record, messages: [] };
    }
    return { record: next, messages: [depthMessage(next)] };
  }
  return { record, messages: [] };
}
__name(applyLobbyMessage, "applyLobbyMessage");

// worker/lobby-do.js
var LobbyDO = class {
  static {
    __name(this, "LobbyDO");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = /* @__PURE__ */ new Map();
    this.record = createLobby();
    this.variant = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const side = url.searchParams.get("side");
    if (side !== "offense" && side !== "defense") return new Response("bad side", { status: 400 });
    this.variant ??= url.searchParams.get("variant");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = crypto.randomUUID();
    this.sockets.set(id, server);
    server.addEventListener("message", (ev) => this.onMessage(id, ev));
    server.addEventListener("close", () => this.onClose(id));
    await this.dispatch(applyLobbyMessage(this.record, { type: "join", id, side }));
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(id, ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "switch") this.dispatch(applyLobbyMessage(this.record, { type: "switch", id }));
  }
  onClose(id) {
    this.sockets.delete(id);
    this.dispatch(applyLobbyMessage(this.record, { type: "leave", id }));
  }
  /**
   * `matched` always arrives as a pair (lobby-engine's maybePair pops one
   * from each queue and emits both at once), so the moment this dispatch
   * sees both halves of a pair it mints ONE real match id and BOTH players'
   * tokens together, and creates the MatchDO instance itself before either
   * `matched` send goes out -- a client that raced to open /match/<id> the
   * instant it heard back must always find the match record already there.
   * lobby-engine's own matchId (built from Date.now()) is deliberately a
   * test-only placeholder; this is where it is replaced with a real one.
   */
  async dispatch({ record, messages }) {
    this.record = record;
    const matchedPair = messages.filter((m) => m.type === "matched");
    let tokens = null;
    let matchId = null;
    if (matchedPair.length === 2) {
      matchId = crypto.randomUUID();
      tokens = { offense: crypto.randomUUID(), defense: crypto.randomUUID() };
      const stub = this.env.MATCH.get(this.env.MATCH.idFromName(matchId));
      await stub.fetch("https://match/create", {
        method: "POST",
        body: JSON.stringify({ matchId, variant: this.variant, seed: Math.random() * 2 ** 31 | 0, tokens })
      });
    }
    for (const m of messages) {
      if (m.to === "broadcast") {
        for (const ws2 of this.sockets.values()) ws2.send(JSON.stringify(m));
        continue;
      }
      const ws = this.sockets.get(m.to);
      if (!ws) continue;
      if (m.type === "matched") {
        ws.send(JSON.stringify({ ...m, matchId, token: tokens[m.side] }));
      } else {
        ws.send(JSON.stringify(m));
      }
    }
  }
};

// lib/field/geometry.js
var SIDELINE_LEFT = 35;
var SIDELINE_RIGHT = 235;
var CENTRE_X = (SIDELINE_LEFT + SIDELINE_RIGHT) / 2;
var FIELD_WIDTH_YARDS = 160 / 3;
var UNITS_PER_YARD_X = (SIDELINE_RIGHT - SIDELINE_LEFT) / FIELD_WIDTH_YARDS;
var HASH_FROM_SIDELINE_YARDS = 160 / 9;
var HASH_FROM_CENTRE_YARDS = FIELD_WIDTH_YARDS / 2 - HASH_FROM_SIDELINE_YARDS;
var GOAL_POST_SPACING_YARDS = 70 / 9;
function x(yardsFromCentre) {
  return CENTRE_X + yardsFromCentre * UNITS_PER_YARD_X;
}
__name(x, "x");
function xToYards(svgX) {
  return (svgX - CENTRE_X) / UNITS_PER_YARD_X;
}
__name(xToYards, "xToYards");
function hashCentresX() {
  return [x(-HASH_FROM_CENTRE_YARDS), x(HASH_FROM_CENTRE_YARDS)];
}
__name(hashCentresX, "hashCentresX");

// lib/game/constants.js
var TURN_SECONDS = 0.5;
var DT = 1 / 60;
var SUBSTEPS_PER_TURN = Math.round(TURN_SECONDS / DT);
var RADIUS_LINE = 3.5;
var RADIUS_MID = 3;
var RADIUS_SKILL = 2.5;
var SPEED_FACTOR = 150;
var ACCEL = 60;
var IDLE_DAMPING = 0.96;
var FRICTION_BLOCK = 0.4;
var FRICTION_RELEASE = 0.15;
var FRICTION_HOLD = 0.6;
var RELEASE_SPEED = 20;
var TUCK_SPEED_MULT = 0.85;
var STANCE_LATERAL_MULT = 0.3;
var HOLD_SPEED_MULT = 0.15;
var PREPARED_REACH = 2.5;
var PREPARED_REACH_MULT = 2;
var STANCE_CONE_HALF_ANGLE = Math.PI / 4;
var HOLD_REACH = 3;
var HOLD_MASS_MULT = 4;
var CHARGE_MULT = 1.5;
var CUT_BLOCK_ENGAGE_UNITS = 4;
var CUT_BLOCK_PUSH_UNITS = 1.875;
var CUT_BLOCK_DRIVE_SPEED_MULT = 0.3;
var CUT_BLOCK_DRIVE_REACH = 3;
var FRICTION_CUT_BLOCK_DRIVE = 0.75;
var CUT_BLOCK_ASSIST_RADIUS_UNITS = 3.75;
var CUT_BLOCK_ASSIST_SPEED_MULT = 1.25;
var CUT_BLOCK_ASSIST_ACCEL_MULT = 1.5;
var TACKLE_BASE = 1;
var PREPARED_TACKLE_BONUS = 1;
var TUCK_BREAK_BONUS = 1;
var NEARBY_RADIUS = 12;
var NEARBY_BONUS = 0.5;
var MOMENTUM_SCALE = 1 / 240;
var TACKLE_COOLDOWN_SUBSTEPS = 15;
var FUMBLE_UNTUCKED = 0.25;
var FUMBLE_TUCKED = 0.05;
var FUMBLE_BALL_SPEED = 45;
var BALL_FRICTION = 0.94;
var PICKUP_RADIUS_BONUS = 1;
var FUMBLE_SPAWN_EPSILON = 0.5;
var LOOSE_BALL_GRACE_SUBSTEPS = 9;
var AI_LEAD_MAX_SECONDS = 1;
var AI_BREAKDOWN_UNITS = 11;
var PASS_SPEED_MAX = 400;
var PASS_SPEED_MIN = 60;
var PASS_SPAWN_EPSILON = 0.5;
var PASS_GRACE_SUBSTEPS = 3;
var PASS_DEAD_SPEED = 12;
var PENALTY_YARDS = 5;
var LOB_LOCK_YARDS = 15;
var LOB_CATCH_YARDS = 1;
var LOB_SCATTER_PER_YARD = 0.2;
var LOB_TIME_MULT = 2;
var LOB_BALL_SCALE = 2;
var COVER_LEAD_MAX_SECONDS = 0.5;
var COVER_MASS_MULT = 1.5;
var COVER_GRAB_REACH = 1.5;
var AI_INTERCEPT_MAX_SECONDS = 2;
var AI_ATTACK_UNITS = 12;
var AI_LEVERAGE_CUSHION = 4;
var AI_CONTAIN_UNITS = 6;
var AI_BACKER_DEPTH_UNITS = 8;
var AI_BACKER_TRIGGER_UNITS = 8;
var AI_DEEP_CUSHION_UNITS = 20;
var AI_THREAT_SPEED_RATIO = 0.9;
var ON_LINE_YARDS = 2;
var BACKER_LANE_UNITS = 22.5;
var ALIGN_LINE_YARDS = 1;
var ALIGN_CORNER_YARDS = 2;
var ALIGN_BACKER_YARDS = 4;
var ALIGN_DEEP_YARDS = 8;
var ALIGN_NUDGE_UNITS = 1;
var ALIGN_NUDGE_STEPS = 200;
var DRIVE_START_YARD = 20;
var FIRST_DOWN_YARDS = 10;
var MIN_SPOT_YARD = 8;
var FIELD_LOW_YARD = -10;
var OPTION_FAKE_FORWARD = 0.3;
var OPTION_FAKE_THROTTLE = 0.5;
var BLOCK_ENGAGE_UNITS = 4;
var DAYLIGHT_ANGLES_DEG = [0, -20, 20, -40, 40, -60, 60];
var DAYLIGHT_LOOKAHEAD_UNITS = 30;
var TENDENCY_PRIOR = 4;
var TENDENCY_SHORT_YARDS = 3;
var TENDENCY_MEDIUM_YARDS = 7;
var TENDENCY_SCHEME_SHADE = 1;
var TENDENCY_COVER_DISCOUNT_YARDS = 3;
var TENDENCY_ANCHOR_SHIFT_YARDS = 4;

// lib/game/view.js
var GOAL_YARD = 100;
var MARGIN_TOP = 10;
var ANCHOR_Y = MARGIN_TOP + -FIELD_LOW_YARD * UNITS_PER_YARD_X;
function fieldPos(acrossYards, downYards) {
  return { x: x(acrossYards), y: ANCHOR_Y + downYards * UNITS_PER_YARD_X };
}
__name(fieldPos, "fieldPos");
function yardsOfY(svgY) {
  return (svgY - ANCHOR_Y) / UNITS_PER_YARD_X;
}
__name(yardsOfY, "yardsOfY");

// lib/game/vec.js
var add = /* @__PURE__ */ __name((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), "add");
var sub = /* @__PURE__ */ __name((a, b) => ({ x: a.x - b.x, y: a.y - b.y }), "sub");
var scale = /* @__PURE__ */ __name((v, k) => ({ x: v.x * k, y: v.y * k }), "scale");
var dot = /* @__PURE__ */ __name((a, b) => a.x * b.x + a.y * b.y, "dot");
var len = /* @__PURE__ */ __name((v) => Math.hypot(v.x, v.y), "len");
var dist = /* @__PURE__ */ __name((a, b) => Math.hypot(a.x - b.x, a.y - b.y), "dist");
var norm = /* @__PURE__ */ __name((v) => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}, "norm");
var clampLen = /* @__PURE__ */ __name((v, max) => {
  const l = len(v);
  return l <= max ? v : scale(v, max / l);
}, "clampLen");

// lib/game/modes.js
var SPEED_MULT = {
  normal: 1,
  tucked: TUCK_SPEED_MULT,
  prepared: 1,
  holding: HOLD_SPEED_MULT,
  // The lunge costs nothing (full tilt, spec); the drive turn after it is
  // where "can't move very fast" actually lives.
  cutBlock: 1,
  cutBlockDrive: CUT_BLOCK_DRIVE_SPEED_MULT
};
var REACH_BONUS = {
  normal: 0,
  tucked: 0,
  prepared: PREPARED_REACH,
  holding: HOLD_REACH,
  // A driving blocker's real "reach" is the extra collision distance he
  // grants everyone who touches him (physics.js's driveReachBonus), not a
  // tackle-strike bonus for himself — an offensive lineman is never the
  // defender a tackle check evaluates, so this entry only exists to keep
  // reach()/tackleReach() from returning NaN if ever asked about him.
  cutBlock: 0,
  cutBlockDrive: 0
};
function maxSpeed(player) {
  const base = SPEED_FACTOR / player.radius * SPEED_MULT[player.mode];
  return player.cutBlockAssist ? base * CUT_BLOCK_ASSIST_SPEED_MULT : base;
}
__name(maxSpeed, "maxSpeed");
function reach(player) {
  return player.radius + REACH_BONUS[player.mode];
}
__name(reach, "reach");
function effectiveMass(player) {
  const stance = player.mode === "holding" ? HOLD_MASS_MULT : 1;
  const covering = player.cover ? COVER_MASS_MULT : 1;
  return player.mass * stance * covering;
}
__name(effectiveMass, "effectiveMass");
function accelMult(player) {
  const base = player.charge ? CHARGE_MULT : 1;
  return player.cutBlockAssist ? base * CUT_BLOCK_ASSIST_ACCEL_MULT : base;
}
__name(accelMult, "accelMult");
function fumbleChance(player) {
  return player.mode === "tucked" ? FUMBLE_TUCKED : FUMBLE_UNTUCKED;
}
__name(fumbleChance, "fumbleChance");
function headingOf(player) {
  if (player.vel && (player.vel.x !== 0 || player.vel.y !== 0)) return norm(player.vel);
  if (player.plan) return norm(player.plan.dir);
  return { x: 0, y: player.team === "offense" ? 1 : -1 };
}
__name(headingOf, "headingOf");
var CONE_COS = Math.cos(STANCE_CONE_HALF_ANGLE);
function inStanceCone(player, toTarget) {
  if (!player.facing || len(toTarget) === 0) return false;
  return dot(norm(toTarget), player.facing) >= CONE_COS;
}
__name(inStanceCone, "inStanceCone");
function tackleReach(player, toTarget) {
  const r = reach(player);
  if (player.mode !== "prepared") return r;
  return inStanceCone(player, toTarget) ? r * PREPARED_REACH_MULT : r;
}
__name(tackleReach, "tackleReach");
function clampToStance(player, v) {
  const top = maxSpeed(player);
  if (!player.facing) return clampLen(v, top);
  const f = player.facing;
  const side = { x: -f.y, y: f.x };
  const along = Math.max(-top, Math.min(top, dot(v, f)));
  const lateralCap = top * STANCE_LATERAL_MULT;
  const across = Math.max(-lateralCap, Math.min(lateralCap, dot(v, side)));
  return add(scale(f, along), scale(side, across));
}
__name(clampToStance, "clampToStance");

// lib/game/flight.js
function passSpeed(power) {
  return PASS_SPEED_MIN + (PASS_SPEED_MAX - PASS_SPEED_MIN) * power;
}
__name(passSpeed, "passSpeed");
function passReach(power) {
  return passSpeed(power) * DT / (1 - BALL_FRICTION);
}
__name(passReach, "passReach");
var PASS_REACH_MAX = passReach(1);
function passTravel(power, substeps) {
  return passReach(power) * (1 - Math.pow(BALL_FRICTION, substeps));
}
__name(passTravel, "passTravel");
function powerForTravel(units, substeps = SUBSTEPS_PER_TURN) {
  const reach2 = units / (1 - Math.pow(BALL_FRICTION, substeps));
  const speed = reach2 * (1 - BALL_FRICTION) / DT;
  return Math.max(0, Math.min(1, (speed - PASS_SPEED_MIN) / (PASS_SPEED_MAX - PASS_SPEED_MIN)));
}
__name(powerForTravel, "powerForTravel");
function spawnOffset(player) {
  return player.radius + PICKUP_RADIUS_BONUS + PASS_SPAWN_EPSILON;
}
__name(spawnOffset, "spawnOffset");

// lib/game/rosters.js
var SEVEN_OFFENSE = [
  { id: "o-c", role: "C", radius: RADIUS_LINE, across: 0, down: -1 },
  { id: "o-lg", role: "LG", radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: "o-rg", role: "RG", radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: "o-wr1", role: "WR", radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: "o-wr2", role: "WR", radius: RADIUS_SKILL, across: 15, down: -1 },
  { id: "o-qb", role: "QB", radius: RADIUS_MID, across: 0, down: -4 },
  { id: "o-rb", role: "RB", radius: RADIUS_SKILL, across: 0, down: -7 }
];
var SEVEN_DEFENSE = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-dt2", role: "DT", radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: 0, down: 4 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var SEVEN_DEFENSE_NICKEL = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: -3, down: 4 },
  { id: "d-lb2", role: "LB", radius: RADIUS_MID, across: 3, down: 4 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var SEVEN_DEFENSE_DIME = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-cb3", role: "CB", radius: RADIUS_SKILL, across: 2.5, down: 2 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: 0, down: 4 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var ELEVEN_OFFENSE = [
  { id: "o-c", role: "C", radius: RADIUS_LINE, across: 0, down: -1 },
  { id: "o-lg", role: "LG", radius: RADIUS_LINE, across: -2.5, down: -1 },
  { id: "o-rg", role: "RG", radius: RADIUS_LINE, across: 2.5, down: -1 },
  { id: "o-lt", role: "LT", radius: RADIUS_LINE, across: -5, down: -1 },
  { id: "o-rt", role: "RT", radius: RADIUS_LINE, across: 5, down: -1 },
  { id: "o-te", role: "TE", radius: RADIUS_MID, across: 7.5, down: -1 },
  { id: "o-wr1", role: "WR", radius: RADIUS_SKILL, across: -15, down: -1 },
  { id: "o-wr2", role: "WR", radius: RADIUS_SKILL, across: 15, down: -3 },
  { id: "o-fb", role: "FB", radius: RADIUS_MID, across: -7.5, down: -3 },
  { id: "o-qb", role: "QB", radius: RADIUS_MID, across: 0, down: -4 },
  { id: "o-rb", role: "RB", radius: RADIUS_SKILL, across: 0, down: -7 }
];
var ELEVEN_DEFENSE = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-dt2", role: "DT", radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: "d-de1", role: "DE", radius: RADIUS_LINE, across: -5, down: 1 },
  { id: "d-de2", role: "DE", radius: RADIUS_LINE, across: 5, down: 1 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: -3, down: 4 },
  { id: "d-lb2", role: "LB", radius: RADIUS_MID, across: 3, down: 4 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-fs", role: "FS", radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var ELEVEN_DEFENSE_NICKEL = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-dt2", role: "DT", radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: "d-de1", role: "DE", radius: RADIUS_LINE, across: -5, down: 1 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: -6, down: 4 },
  { id: "d-lb2", role: "LB", radius: RADIUS_MID, across: 0, down: 4 },
  { id: "d-lb3", role: "LB", radius: RADIUS_MID, across: 6, down: 4 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-fs", role: "FS", radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var ELEVEN_DEFENSE_DIME = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-dt1", role: "DT", radius: RADIUS_LINE, across: -2.5, down: 1 },
  { id: "d-dt2", role: "DT", radius: RADIUS_LINE, across: 2.5, down: 1 },
  { id: "d-de1", role: "DE", radius: RADIUS_LINE, across: -5, down: 1 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: -3, down: 4 },
  { id: "d-lb2", role: "LB", radius: RADIUS_MID, across: 3, down: 4 },
  { id: "d-cb1", role: "CB", radius: RADIUS_SKILL, across: -15, down: 2 },
  { id: "d-cb2", role: "CB", radius: RADIUS_SKILL, across: 15, down: 2 },
  { id: "d-fs", role: "FS", radius: RADIUS_SKILL, across: -7.5, down: 2 },
  { id: "d-cb3", role: "CB", radius: RADIUS_SKILL, across: 7.5, down: 2 },
  { id: "d-s", role: "S", radius: RADIUS_SKILL, across: 0, down: 8 }
];
var DRILL_OFFENSE = [
  { id: "o-c", role: "C", radius: RADIUS_LINE, across: 0, down: -1 },
  // Five yards off his centre rather than the three a real quarterback takes.
  // A lesson is watched, not played at speed: the extra depth buys the coach a
  // turn to read what the rush is doing before it is on top of him, and it puts
  // daylight between the two men so the snap arrow reads as an arrow.
  { id: "o-qb", role: "QB", radius: RADIUS_MID, across: 0, down: -6 }
];
var DRILL_DEFENSE = [
  { id: "d-nt", role: "NT", radius: RADIUS_LINE, across: 0, down: 1 },
  { id: "d-lb", role: "LB", radius: RADIUS_MID, across: 0, down: 4 }
];
var DRILL_PASS_OFFENSE = [
  ...DRILL_OFFENSE,
  { id: "o-rb", role: "RB", radius: RADIUS_SKILL, across: 6, down: -5 }
];
var DRILL_ROSTERS = {
  "tutorial-2v2": {
    id: "tutorial-2v2",
    teamSize: 2,
    minOnLine: 0,
    offense: DRILL_OFFENSE,
    defense: DRILL_DEFENSE
  },
  "tutorial-pass": {
    id: "tutorial-pass",
    teamSize: 2,
    // The one asymmetric roster in the game: three against two. `teamSize`
    // still answers for the defense, and `offenseSize` overrides it for the
    // side that has the extra man.
    offenseSize: 3,
    minOnLine: 0,
    offense: DRILL_PASS_OFFENSE,
    defense: DRILL_DEFENSE
  }
};
function offenseSize(roster) {
  return roster.offenseSize ?? roster.teamSize;
}
__name(offenseSize, "offenseSize");
function defenseSize(roster) {
  return roster.defenseSize ?? roster.teamSize;
}
__name(defenseSize, "defenseSize");
var OFFENSIVE_LINE_ROLES = /* @__PURE__ */ new Set(["C", "LG", "RG", "LT", "RT"]);
var ROSTERS = {
  7: {
    id: "7",
    teamSize: 7,
    // Real football wants seven of eleven on the line; 7/11 of a seven-man
    // team rounds to five, which is exactly what this formation shows.
    minOnLine: 5,
    offense: SEVEN_OFFENSE,
    defense: SEVEN_DEFENSE
  },
  "7-nickel": {
    id: "7-nickel",
    teamSize: 7,
    minOnLine: 5,
    offense: SEVEN_OFFENSE,
    defense: SEVEN_DEFENSE_NICKEL
  },
  "7-dime": {
    id: "7-dime",
    teamSize: 7,
    minOnLine: 5,
    offense: SEVEN_OFFENSE,
    defense: SEVEN_DEFENSE_DIME
  },
  11: {
    id: "11",
    teamSize: 11,
    // Real football, unrounded: seven of eleven on the line.
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE
  },
  "11-nickel": {
    id: "11-nickel",
    teamSize: 11,
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE_NICKEL
  },
  "11-dime": {
    id: "11-dime",
    teamSize: 11,
    minOnLine: 7,
    offense: ELEVEN_OFFENSE,
    defense: ELEVEN_DEFENSE_DIME
  }
};
var DEFAULT_VARIANT = "7";
function getRoster(id) {
  return ROSTERS[id] ?? DRILL_ROSTERS[id] ?? ROSTERS[DEFAULT_VARIANT];
}
__name(getRoster, "getRoster");
function minOnLine(state) {
  return getRoster(state.variantId).minOnLine;
}
__name(minOnLine, "minOnLine");
function baseVariantId(variantId) {
  const dash = String(variantId).indexOf("-");
  return dash === -1 ? variantId : variantId.slice(0, dash);
}
__name(baseVariantId, "baseVariantId");
function variantWithPersonnel(variantId, personnel) {
  const base = baseVariantId(variantId);
  const id = personnel === "stacked" ? base : `${base}-${personnel}`;
  return ROSTERS[id] ? id : base;
}
__name(variantWithPersonnel, "variantWithPersonnel");

// lib/game/learned/genome.js
function clampGenome(spec, genome) {
  const g = {};
  for (const p of spec) {
    const v = genome && typeof genome[p.key] === "number" ? genome[p.key] : p.init;
    g[p.key] = Math.max(p.min, Math.min(p.max, v));
  }
  return g;
}
__name(clampGenome, "clampGenome");

// lib/game/learned/defense-spec.js
var F = [];
var SPOTS = [
  ["d-nt", 0, 1],
  ["d-dt1", -2.5, 1],
  ["d-dt2", 2.5, 1],
  ["d-cb1", -15, 2],
  ["d-cb2", 15, 2],
  ["d-lb", 0, 4],
  ["d-s", 0, 8]
];
for (const [id, across, down] of SPOTS) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: 0.5, max: 12, init: down });
}
var SUB_SPOTS = [
  ["d-lb2", 3, 4],
  ["d-cb3", 2.5, 2]
];
for (const [id, across, down] of SUB_SPOTS) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: 0.5, max: 12, init: down });
}
var ZONES = [
  ["d-cb1", -12, 4],
  ["d-cb2", 12, 4],
  ["d-lb", 0, 3],
  ["d-s", 0, 9]
];
for (const [id, across, depth2] of ZONES) {
  F.push({ key: `zone:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `zone:${id}:depth`, min: 1, max: 15, init: depth2 });
}
for (const group of ["line", "backer", "back", "deep"]) {
  F.push({ key: `adapt:${group}:width`, min: 0, max: 1, init: 0 });
  F.push({ key: `adapt:${group}:depth`, min: 0, max: 1, init: 0 });
}
F.push(
  // Man-assignment cost weights: cost = dist·wDist + depth·wDepth + width·wWidth
  // (all in yards; see defense-policy.js). dist-only at init reproduces
  // defense.js's own nearest-pair greedy.
  { key: "cov:dist", min: 0, max: 3, init: 1 },
  { key: "cov:depth", min: -2, max: 2, init: 0 },
  { key: "cov:width", min: -2, max: 2, init: 0 },
  // The man/zone gate's logit: zone when
  // bias + wDown·down + wToGo·toGo + wSpread·spread > 0.
  // Bias starts firmly negative: an untrained genome plays man, the coverage
  // the game already knows how to play.
  { key: "scheme:bias", min: -4, max: 4, init: -2 },
  { key: "scheme:down", min: -4, max: 4, init: 0 },
  { key: "scheme:toGo", min: -4, max: 4, init: 0 },
  { key: "scheme:spread", min: -4, max: 4, init: 0 },
  // Substitution as ONE axis — how far this look drags bodies out of the box —
  // cut twice. Nickel and dime share the weights; their biases are independent
  // and unordered, and dime is tested first, so a genome that learns a looser
  // dime cut than nickel collapses the ladder to two packages (see
  // learnedPersonnel in formation.js). Both cuts start at the floor: an
  // untrained genome never subs.
  { key: "sub:spread", min: -4, max: 4, init: 0 },
  { key: "sub:backs", min: -4, max: 4, init: 0 },
  { key: "sub:toGo", min: -4, max: 4, init: 0 },
  { key: "sub:nickel:bias", min: -4, max: 4, init: -4 },
  { key: "sub:dime:bias", min: -4, max: 4, init: -4 }
);
var DEFENSE_SPEC = F;
var DEFENSE_VARIANT = "7";

// lib/game/learned/defense-genome.js
var DEFENSE_GENOME = {
  "meta": {
    "variant": "7",
    "trainedBy": "tools/train-vs-ghost.js",
    "opponent": "ghost of coach-log-2026-09-01.json (61 offense snapshots)",
    "options": {
      "generations": 40,
      "popSize": 16,
      "plays": 24,
      "seed": 1,
      "sigma": 0.08,
      "ghostShare": 0.5
    },
    "fitness": 5.041791499641123
  },
  "values": {
    "pos:d-nt:across": -22.691123448487602,
    "pos:d-nt:down": 9.986075535091787,
    "pos:d-dt1:across": 21.219205836482914,
    "pos:d-dt1:down": 4.156748805189498,
    "pos:d-dt2:across": 12.69033820598414,
    "pos:d-dt2:down": 0.5,
    "pos:d-cb1:across": -21.18752622929817,
    "pos:d-cb1:down": 7.5502389247686486,
    "pos:d-cb2:across": -2.522085186504863,
    "pos:d-cb2:down": 4.527154638552066,
    "pos:d-lb:across": 15.386575486471232,
    "pos:d-lb:down": 12,
    "pos:d-s:across": 22.72294688508342,
    "pos:d-s:down": 8.51473264914811,
    "pos:d-lb2:across": -7.580862170141,
    "pos:d-lb2:down": 11.626744167791532,
    "pos:d-cb3:across": -10.109702514494012,
    "pos:d-cb3:down": 6.7297468245258285,
    "zone:d-cb1:across": 4.040376488562996,
    "zone:d-cb1:depth": 1.9624766530986322,
    "zone:d-cb2:across": 14.87956142013349,
    "zone:d-cb2:depth": 4.909877726533816,
    "zone:d-lb:across": 22.7746442189827,
    "zone:d-lb:depth": 8.642762017712315,
    "zone:d-s:across": 22.60293987980029,
    "zone:d-s:depth": 1,
    "adapt:line:width": 0,
    "adapt:line:depth": 0.24353443909372574,
    "adapt:backer:width": 0.03508406243082756,
    "adapt:backer:depth": 0.7981801505579685,
    "adapt:back:width": 0.230731467479025,
    "adapt:back:depth": 0.3419887703436051,
    "adapt:deep:width": 0.04446438366798916,
    "adapt:deep:depth": 0.06544648289973175,
    "cov:dist": 1.7864998424153202,
    "cov:depth": 0.4446229067567935,
    "cov:width": -0.2642681879843584,
    "scheme:bias": 2.882547862975135,
    "scheme:down": -0.12171187681588913,
    "scheme:toGo": 0.5565451897690021,
    "scheme:spread": 2.889822942274033,
    "sub:spread": -0.8908474600946746,
    "sub:backs": -0.23376538155232723,
    "sub:toGo": -1.2853712752863937,
    "sub:nickel:bias": 2.1463790730223216,
    "sub:dime:bias": -3.237519479976793
  }
};

// lib/game/learned/offense-genome.js
var OFFENSE_GENOME = {
  "meta": {
    "variant": "7",
    "trainedBy": "tools/train-coevolve.js",
    "opponent": "co-evolved learned defense",
    "options": {
      "generations": 25,
      "popSize": 12,
      "plays": 16,
      "elite": 3,
      "sigma": 0.06,
      "hof": 2,
      "seed": 1
    },
    "fitness": 27.8433493977327
  },
  "values": {
    "pos:o-c:across": -4.682506917542076,
    "pos:o-c:down": -1.3079999210601425,
    "pos:o-lg:across": -15.585517548915817,
    "pos:o-lg:down": -1.228094813180761,
    "pos:o-rg:across": -7.333867548854134,
    "pos:o-rg:down": -1.0199559301195504,
    "pos:o-wr1:across": -11.797660317612209,
    "pos:o-wr1:down": -0.570460702263512,
    "pos:o-wr2:across": 23.590070255909776,
    "pos:o-wr2:down": -1.0206123073768185,
    "pos:o-qb:across": 24,
    "pos:o-qb:down": -2.759340418375944,
    "pos:o-rb:across": 19.286167573189267,
    "pos:o-rb:down": -6.231953511878418,
    "call:bias": -0.6080132002785972,
    "call:down": 2.962374239633171,
    "call:toGo": 2.0232179417169527,
    "call:box": 1.404352314226079,
    "run:sideBias": -1.0146131652744745,
    "run:read": 6.539086009442746,
    "run:lean": 0.7759110950959883,
    "throw:go": -13.032566898476722,
    "throw:hold": 3.7744140317982096,
    "qb:drop": 0.4258773373568086,
    "tgt:sep": 0,
    "tgt:depth": 2,
    "tgt:dist": -0.8529751719258308,
    "route:o-wr1:deg0": -56.69857796735997,
    "route:o-wr1:degLate": -39.00299228598399,
    "route:o-wr2:deg0": 0.19780361407874913,
    "route:o-wr2:degLate": -29.32456566283895,
    "route:o-rb:deg0": 79.05681390518164,
    "route:o-rb:degLate": 67.11179291054877
  }
};

// lib/game/learned/active.js
function shippedGenome(side) {
  return side === "defense" ? DEFENSE_GENOME.values : OFFENSE_GENOME.values;
}
__name(shippedGenome, "shippedGenome");
function activeGenome(state, side) {
  const override = state.genomeOverrides ? state.genomeOverrides[side] : null;
  return override ?? shippedGenome(side);
}
__name(activeGenome, "activeGenome");

// lib/game/learned/offense-spec.js
var F2 = [];
var LINE = [
  ["o-c", 0],
  ["o-lg", -2.5],
  ["o-rg", 2.5],
  ["o-wr1", -15],
  ["o-wr2", 15]
];
for (const [id, across] of LINE) {
  F2.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F2.push({ key: `pos:${id}:down`, min: -1.8, max: -0.5, init: -1 });
}
F2.push(
  { key: "pos:o-qb:across", min: -24, max: 24, init: 0 },
  { key: "pos:o-qb:down", min: -8, max: -2.5, init: -4 },
  { key: "pos:o-rb:across", min: -24, max: 24, init: 0 },
  { key: "pos:o-rb:down", min: -10, max: -4, init: -7 }
);
F2.push(
  // Run/pass logit: pass when bias + wDown·down + wToGo·toGo + wBox·box > 0.
  // Bias starts firmly negative — an untrained genome runs the option, the
  // play the scripted autoplan already proved out.
  { key: "call:bias", min: -4, max: 4, init: -2 },
  { key: "call:down", min: -4, max: 4, init: 0 },
  { key: "call:toGo", min: -4, max: 4, init: 1 },
  { key: "call:box", min: -4, max: 4, init: 1 },
  // The run: which side, how wide the read is (OPTION_READ_UNITS as a
  // learnable, in units), how hard the runners lean off straight upfield.
  { key: "run:sideBias", min: -2, max: 2, init: 0.5 },
  { key: "run:read", min: 0, max: 12, init: 6 },
  { key: "run:lean", min: 0.2, max: 2, init: 0.5 },
  // The pass: how open is open enough, how many turns the QB will wait,
  // and how hard he drops back at the snap.
  { key: "throw:go", min: -20, max: 40, init: 8 },
  { key: "throw:hold", min: 1, max: 4, init: 3 },
  { key: "qb:drop", min: 0.2, max: 1, init: 0.6 },
  // Receiver scoring, all in yards: separation from the nearest defender,
  // progress downfield, and throw distance (a cost, so its range is <= 0).
  { key: "tgt:sep", min: 0, max: 3, init: 1 },
  { key: "tgt:depth", min: -2, max: 2, init: 0.5 },
  { key: "tgt:dist", min: -2, max: 0, init: -0.3 }
);
for (const [id, deg0, degLate] of [
  ["o-wr1", -20, 0],
  ["o-wr2", 20, 0],
  ["o-rb", 0, 30]
]) {
  F2.push({ key: `route:${id}:deg0`, min: -80, max: 80, init: deg0 });
  F2.push({ key: `route:${id}:degLate`, min: -80, max: 80, init: degLate });
}
var OFFENSE_SPEC = F2;
var OFFENSE_VARIANT = "7";

// lib/game/learned/formation.js
var NUDGE_UNITS = 1;
var NUDGE_STEPS = 200;
var MAX_YARD = 108;
function inbounds(x2, radius) {
  return Math.max(SIDELINE_LEFT + radius, Math.min(SIDELINE_RIGHT - radius, x2));
}
__name(inbounds, "inbounds");
function clearX(placed, want, y2, radius) {
  for (let k = 0; k <= NUDGE_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x2 = inbounds(want + sign * k * NUDGE_UNITS, radius);
      if (!placed.some((q) => dist(q.pos, { x: x2, y: y2 }) < q.radius + radius)) return x2;
    }
  }
  return inbounds(want, radius);
}
__name(clearX, "clearX");
function learnedDefenseSpots(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const placed = state.players.filter((p) => p.team !== "defense").map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== "defense") continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== "number") continue;
    const down = Math.min(g[`pos:${p.id}:down`], MAX_YARD - state.losYard);
    const want = fieldPos(across, state.losYard + down);
    const x2 = clearX(placed, want.x, want.y, p.radius);
    const pos = { x: x2, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}
__name(learnedDefenseSpots, "learnedDefenseSpots");
function applyLearnedDefenseFormation(state, values) {
  if (state.phase !== "planning" || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedDefenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}
__name(applyLearnedDefenseFormation, "applyLearnedDefenseFormation");
function isLearnedDefense(state) {
  return state.aiTeam === "defense" && state.aiLevel === "learned" && baseVariantId(state.variantId) === DEFENSE_VARIANT;
}
__name(isLearnedDefense, "isLearnedDefense");
function maybeApplyLearnedFormations(state) {
  if (isLearnedDefense(state)) {
    applyLearnedDefenseFormation(state, activeGenome(state, "defense"));
  }
  if (state.aiTeam === "offense" && state.aiLevel === "learned" && state.variantId === OFFENSE_VARIANT) {
    applyLearnedOffenseFormation(state, activeGenome(state, "offense"));
  }
}
__name(maybeApplyLearnedFormations, "maybeApplyLearnedFormations");
function learnedOffenseSpots(state, values) {
  const g = clampGenome(OFFENSE_SPEC, values);
  const [hashLeft, hashRight] = hashCentresX();
  const placed = state.players.filter((p) => p.team !== "offense").map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const p of state.players) {
    if (p.team !== "offense") continue;
    const across = g[`pos:${p.id}:across`];
    if (typeof across !== "number") continue;
    const want = fieldPos(across, state.losYard + g[`pos:${p.id}:down`]);
    if (p.id === state.ball.carrierId) {
      want.x = Math.max(hashLeft, Math.min(hashRight, want.x));
    }
    const x2 = clearX(placed, want.x, want.y, p.radius);
    const pos = { x: x2, y: want.y };
    placed.push({ radius: p.radius, pos });
    spots.push({ id: p.id, pos });
  }
  return spots;
}
__name(learnedOffenseSpots, "learnedOffenseSpots");
function applyLearnedOffenseFormation(state, values) {
  if (state.phase !== "planning" || state.turnIndex !== 0) return false;
  for (const { id, pos } of learnedOffenseSpots(state, values)) {
    const p = state.players.find((pl) => pl.id === id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}
__name(applyLearnedOffenseFormation, "applyLearnedOffenseFormation");

// lib/game/state.js
var SNAPPER_ID = "o-c";
var SNAP_TARGET_ID = "o-qb";
function makePlayer(spec, team, losYard) {
  return {
    id: spec.id,
    team,
    role: spec.role,
    radius: spec.radius,
    mass: spec.radius * spec.radius,
    pos: fieldPos(spec.across, losYard + spec.down),
    vel: { x: 0, y: 0 },
    plan: null,
    mode: "normal",
    charge: 0,
    facing: null,
    // Whether this player is currently inside a driving blocker's assist
    // aura — recomputed every sub-step by block.js's applyCutBlockAssist,
    // never set by hand. Defaulted here so modes.js's maxSpeed/accelMult
    // never read `undefined` off a player nobody has scanned yet.
    cutBlockAssist: false,
    // The id of the opponent this player has been told to cover, or null. A
    // cover order and a movement arrow are alternatives, not layers: setPlan
    // clears this, and setCover writes the plan.
    cover: null,
    tackleCooldown: 0
  };
}
__name(makePlayer, "makePlayer");
function defensePlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.defense.length !== defenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${defenseSize(roster)} on defense`);
  }
  return roster.defense.map((s) => makePlayer(s, "defense", losYard));
}
__name(defensePlayers, "defensePlayers");
function formationPlayers(losYard, variantId = DEFAULT_VARIANT) {
  const roster = getRoster(variantId);
  if (roster.offense.length !== offenseSize(roster)) {
    throw new Error(`variant "${roster.id}" must field ${offenseSize(roster)} on offense`);
  }
  for (const id of [SNAPPER_ID, SNAP_TARGET_ID]) {
    if (!roster.offense.some((spec) => spec.id === id)) {
      throw new Error(`variant "${roster.id}" has no "${id}" to take the snap`);
    }
  }
  return [
    ...roster.offense.map((s) => makePlayer(s, "offense", losYard)),
    ...defensePlayers(losYard, variantId)
  ];
}
__name(formationPlayers, "formationPlayers");
function createGame({
  seed = 1,
  ai = null,
  aiLevel = "pursuit",
  variant = DEFAULT_VARIANT,
  genomeOverrides = null,
  losYard = DRIVE_START_YARD,
  scriptedOrders = null
} = {}) {
  const state = {
    seed,
    aiTeam: ai,
    // Which game this is: the same id the home screen's button carries.
    // Resolved through getRoster rather than stored raw, so an unknown name
    // never survives into the state where nextDown would rebuild the field
    // from it every down.
    variantId: getRoster(variant).id,
    // Which brain coaches `aiTeam`: 'pursuit' (ai.js — everyone at the ball)
    // or 'smart' (defense.js — assignment football). The default is the older
    // one so the library's semantics, and every test written against them,
    // stay exactly as they were; app/main.js is what opts the played game into
    // 'smart'.
    aiLevel,
    down: 1,
    losYard,
    // The absolute yard this set of downs must reach for a fresh one. Reset by
    // nextDown (rules.js) on every first down; clamped to the goal line itself
    // inside the 10, which is what makes "goal to go" fall out for free rather
    // than needing a special case.
    toGoYard: Math.min(losYard + FIRST_DOWN_YARDS, GOAL_YARD),
    phase: "planning",
    turnIndex: 0,
    players: formationPlayers(losYard, variant),
    ball: { carrierId: SNAPPER_ID, pos: null, vel: null },
    // A throw planned for this turn, the down's forward-pass tally, and the
    // flag it may have earned. All three are per-down: nextDown resets them.
    plannedPass: null,
    // The computer offense's play memory: the call it made at the snap
    // ({call, side?, give?}), so turn three still knows what turn zero
    // decided. Plain serializable data, per-down, like plannedPass — see
    // learned/offense-policy.js. null whenever no learned offense is playing.
    aiPlay: null,
    // What this coach keeps doing, as counts (lib/game/tendencies.js), or
    // null. Plain serializable data like everything else here; the app is
    // what loads it out of storage and hands it over, because the counts
    // outlive the game the way the playbook does. Only the learned DEFENSE
    // reads it — see ai.js's coachLearnedDefense.
    tendencyCounts: null,
    // The other side's authored orders, by turn index, or null — what ai.js's
    // 'scripted' level plays. Plain serializable data handed in, exactly like
    // tendencyCounts and genomeOverrides, and for the same reason: nothing
    // under lib/ may reach out for it, so the caller brings it.
    scriptedOrders,
    // A genome trained in this browser (app/train-worker.js), per side, or
    // null for the one this build ships. Plain serializable data like
    // tendencyCounts, and handed over for the same reason: learned/active.js
    // is what reads it, and nothing under lib/ may read a browser's storage.
    // Taken as an option rather than assigned afterwards because
    // maybeApplyLearnedFormations runs below, before this function returns —
    // an override that arrived late would miss the first down's formation.
    genomeOverrides: {
      defense: genomeOverrides?.defense ?? null,
      offense: genomeOverrides?.offense ?? null
    },
    forwardPasses: 0,
    penalty: null,
    deadReason: null,
    result: null
  };
  maybeApplyLearnedFormations(state);
  aimSnap(state);
  return state;
}
__name(createGame, "createGame");
function aimSnap(state) {
  if (state.phase !== "planning" || state.turnIndex !== 0) return false;
  if (state.plannedPass && !state.plannedPass.auto) return false;
  if (state.ball.carrierId !== SNAPPER_ID) return false;
  const from = state.players.find((p) => p.id === SNAPPER_ID);
  const to = state.players.find((p) => p.id === SNAP_TARGET_ID);
  if (!from || !to) return false;
  const gap = sub(to.pos, from.pos);
  const distance = len(gap);
  if (distance === 0) return false;
  const travel = Math.max(0, distance - spawnOffset(from));
  const power = powerForTravel(travel, Infinity);
  state.plannedPass = {
    from: SNAPPER_ID,
    dir: norm(gap),
    power,
    auto: true,
    target: SNAP_TARGET_ID
  };
  return true;
}
__name(aimSnap, "aimSnap");
function getPlayer(state, id) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`unknown player "${id}"`);
  return p;
}
__name(getPlayer, "getPlayer");
function carrier(state) {
  return state.ball.carrierId === null ? null : getPlayer(state, state.ball.carrierId);
}
__name(carrier, "carrier");
function ballPos(state) {
  const c = carrier(state);
  return c ? c.pos : state.ball.pos;
}
__name(ballPos, "ballPos");
function setPlan(state, id, dir, throttle, target = null, short = false) {
  const p = getPlayer(state, id);
  p.plan = { dir, throttle, target, short };
  p.cover = null;
}
__name(setPlan, "setPlan");
function clearPlan(state, id) {
  getPlayer(state, id).plan = null;
}
__name(clearPlan, "clearPlan");
function setMode(state, id, mode) {
  const p = getPlayer(state, id);
  const legal = mode === "normal" || mode === "tucked" && state.ball.carrierId === id && !OFFENSIVE_LINE_ROLES.has(p.role) || mode === "prepared" && p.team === "defense" || mode === "holding" && p.team === "offense" || // The cut block ("tucked special"): a lineman's own snap-count stance,
  // not something drawn up mid-down — see block.js for what committing to
  // it actually does.
  mode === "cutBlock" && p.team === "offense" && OFFENSIVE_LINE_ROLES.has(p.role) && state.turnIndex === 0;
  if (!legal) return false;
  p.mode = mode;
  p.charge = mode === "normal" ? 0 : 1;
  p.facing = mode === "normal" ? null : headingOf(p);
  return true;
}
__name(setMode, "setMode");
function setPass(state, id, dir, power, target = null) {
  if (state.ball.carrierId !== id) return false;
  state.plannedPass = { from: id, dir, power, target };
  return true;
}
__name(setPass, "setPass");
function clearPass(state) {
  state.plannedPass = null;
}
__name(clearPass, "clearPass");
function serializeState(state) {
  return structuredClone(state);
}
__name(serializeState, "serializeState");
function hydrateState(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.players)) {
    throw new Error("hydrateState: not a serialized state");
  }
  return structuredClone(data);
}
__name(hydrateState, "hydrateState");

// lib/game/defense.js
var GROUPS = {
  NT: "line",
  DT: "line",
  DE: "line",
  LB: "backer",
  MLB: "backer",
  OLB: "backer",
  CB: "back",
  S: "back",
  FS: "back",
  SS: "back"
};
function positionGroup(player) {
  return GROUPS[player.role] ?? "backer";
}
__name(positionGroup, "positionGroup");
function defendDir(team) {
  return team === "offense" ? -1 : 1;
}
__name(defendDir, "defendDir");
function losY(state) {
  return fieldPos(0, state.losYard).y;
}
__name(losY, "losY");
function pastLine(state, team, point) {
  const dir = defendDir(team);
  return dir > 0 ? point.y > losY(state) : point.y < losY(state);
}
__name(pastLine, "pastLine");
function groupMates(state, player) {
  const group = positionGroup(player);
  return state.players.filter(
    (p) => p.team === player.team && positionGroup(p) === group
  );
}
__name(groupMates, "groupMates");
function orderedMates(state, player) {
  return groupMates(state, player).slice().sort((a, b) => a.pos.x - b.pos.x || a.id.localeCompare(b.id));
}
__name(orderedMates, "orderedMates");
function backerLane(state, player) {
  const mates = orderedMates(state, player);
  const i = mates.findIndex((p) => p.id === player.id);
  return (i - (mates.length - 1) / 2) * BACKER_LANE_UNITS;
}
__name(backerLane, "backerLane");
function interceptPoint(pursuer, target) {
  const s = maxSpeed(pursuer);
  const d = sub(target.pos, pursuer.pos);
  const v = target.vel;
  const a = dot(v, v) - s * s;
  const b = 2 * dot(d, v);
  const c = dot(d, d);
  let t = null;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((r) => r > 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  if (t === null) t = len(d) / s;
  return add(target.pos, scale(v, Math.min(t, AI_INTERCEPT_MAX_SECONDS)));
}
__name(interceptPoint, "interceptPoint");
function leverageAim(defender, aim, target) {
  if (dist(defender.pos, target.pos) <= AI_ATTACK_UNITS) return aim;
  const dir = defendDir(defender.team);
  const floor = target.pos.y + dir * AI_LEVERAGE_CUSHION;
  return { x: aim.x, y: dir > 0 ? Math.max(aim.y, floor) : Math.min(aim.y, floor) };
}
__name(leverageAim, "leverageAim");
function containRank(state, player) {
  const line = orderedMates(state, player);
  const xs = line.map((p) => p.pos.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middle = line.reduce((a, b) => Math.abs(b.pos.x - mid) < Math.abs(a.pos.x - mid) ? b : a);
  return line.findIndex((p) => p.id === player.id) - line.findIndex((p) => p.id === middle.id);
}
__name(containRank, "containRank");
function rushLineman(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  if (dist(player.pos, car.pos) <= AI_ATTACK_UNITS) return { aim, cover: null };
  const rank = containRank(state, player);
  if (rank === 0) return { aim, cover: null };
  const edge = car.pos.x + rank * AI_CONTAIN_UNITS;
  const x2 = rank < 0 ? Math.min(aim.x, edge) : Math.max(aim.x, edge);
  return { aim: { x: x2, y: aim.y }, cover: null };
}
__name(rushLineman, "rushLineman");
function flowLinebacker(state, player) {
  const car = carrier(state);
  const aim = leverageAim(player, interceptPoint(player, car), car);
  const dir = defendDir(player.team);
  const gap = (car.pos.y - losY(state)) * dir;
  if (gap >= -AI_BACKER_TRIGGER_UNITS) return { aim, cover: null };
  const lane = backerLane(state, player);
  return {
    aim: { x: aim.x + lane, y: losY(state) + dir * AI_BACKER_DEPTH_UNITS },
    cover: null
  };
}
__name(flowLinebacker, "flowLinebacker");
function depth(team, point) {
  return point.y * defendDir(team);
}
__name(depth, "depth");
function deepestThreat(state, team) {
  const them = state.players.filter((p) => p.team !== team);
  if (!them.length) return null;
  return them.reduce((a, b) => depth(team, b.pos) > depth(team, a.pos) ? b : a);
}
__name(deepestThreat, "deepestThreat");
function deepMan(state, team) {
  const backs = state.players.filter(
    (p) => p.team === team && positionGroup(p) === "back"
  );
  if (!backs.length) return null;
  return backs.reduce((a, b) => depth(team, b.pos) > depth(team, a.pos) ? b : a);
}
__name(deepMan, "deepMan");
function deepestOpenThreat(state, team) {
  const { them, threats, dedicated } = assignCoverage(state, team);
  const open = them.filter((r) => threats.has(r.id) && !dedicated.has(r.id));
  if (!open.length) return null;
  return open.reduce((a, b) => depth(team, b.pos) > depth(team, a.pos) ? b : a);
}
__name(deepestOpenThreat, "deepestOpenThreat");
function deepAim(state, player) {
  const dir = defendDir(player.team);
  const threat = deepestOpenThreat(state, player.team) ?? deepestThreat(state, player.team);
  const bp = ballPos(state);
  const anchor = threat ? threat.pos : bp;
  const back = dir > 0 ? Math.max(anchor.y, bp.y) : Math.min(anchor.y, bp.y);
  return { x: (anchor.x + bp.x) / 2, y: back + dir * AI_DEEP_CUSHION_UNITS };
}
__name(deepAim, "deepAim");
function claimNearest(map, claimed, defenders, receivers) {
  const pairs = [];
  for (const d of defenders) {
    for (const r of receivers) {
      if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
      pairs.push({ d: d.id, r: r.id, gap: dist(d.pos, r.pos) });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));
  for (const { d, r } of pairs) {
    if (map.has(d) || claimed.has(r)) continue;
    map.set(d, r);
    claimed.add(r);
  }
  return new Set(pairs.map((p) => p.r));
}
__name(claimNearest, "claimNearest");
function assignCoverage(state, team) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === "back" && p.id !== free?.id
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);
  const map = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  const threats = claimNearest(map, claimed, takers, them);
  const dedicated = new Set(claimed);
  const leftover = them.filter((r) => threats.has(r.id) && !claimed.has(r.id));
  if (leftover.length) {
    const backers = state.players.filter((p) => p.team === team && positionGroup(p) === "backer");
    claimNearest(map, claimed, backers, leftover);
  }
  return { map, them, threats, dedicated };
}
__name(assignCoverage, "assignCoverage");
function coverAssignments(state, team) {
  return assignCoverage(state, team).map;
}
__name(coverAssignments, "coverAssignments");
function coverBack(state, player) {
  const assigned = coverAssignments(state, player.team).get(player.id);
  if (assigned) return { aim: null, cover: assigned };
  return { aim: deepAim(state, player), cover: null };
}
__name(coverBack, "coverBack");
var NO_ORDER = { aim: null, cover: null };
function smartOrder(state, player) {
  const bp = ballPos(state);
  if (!bp) return NO_ORDER;
  const car = carrier(state);
  if (!car) return { aim: { ...bp }, cover: null };
  if (car.team === player.team) return { aim: { ...bp }, cover: null };
  if (pastLine(state, player.team, car.pos)) {
    return { aim: leverageAim(player, interceptPoint(player, car), car), cover: null };
  }
  switch (positionGroup(player)) {
    case "line":
      return rushLineman(state, player);
    case "back":
      return coverBack(state, player);
    default: {
      const assigned = coverAssignments(state, player.team).get(player.id);
      return assigned ? { aim: null, cover: assigned } : flowLinebacker(state, player);
    }
  }
}
__name(smartOrder, "smartOrder");
function smartOrders(state, team) {
  return state.players.filter((p) => p.team === team).map((p) => ({ id: p.id, ...smartOrder(state, p) })).filter((o) => o.aim !== null || o.cover !== null);
}
__name(smartOrders, "smartOrders");

// lib/game/formation.js
function canReposition(state) {
  return state.phase === "planning" && state.turnIndex === 0;
}
__name(canReposition, "canReposition");
function spotFaultAmong(state, player, pos, others) {
  const dir = defendDir(player.team);
  const past = dir > 0 ? pos.y < losY(state) : pos.y > losY(state);
  if (past) return "past-line";
  if (pos.x - player.radius < SIDELINE_LEFT) return "out-of-bounds";
  if (pos.x + player.radius > SIDELINE_RIGHT) return "out-of-bounds";
  if (player.id === state.ball.carrierId) {
    const [hashLeft, hashRight] = hashCentresX();
    if (pos.x < hashLeft || pos.x > hashRight) return "outside-hashes";
  }
  for (const other of others) {
    if (other.id === player.id) continue;
    if (dist(other.pos, pos) < other.radius + player.radius) return "occupied";
  }
  return null;
}
__name(spotFaultAmong, "spotFaultAmong");
function placeFormation(state, spots) {
  const applied = [];
  const skipped = [];
  if (!canReposition(state)) return { applied, skipped: spots.map((s) => s.id) };
  const moving = new Set(spots.map((s) => s.id));
  const layout = state.players.filter((p) => !moving.has(p.id)).map((p) => ({ id: p.id, radius: p.radius, pos: p.pos }));
  for (const { id, pos } of spots) {
    const p = state.players.find((pl) => pl.id === id);
    if (!p) {
      skipped.push(id);
      continue;
    }
    const fault = spotFaultAmong(state, p, pos, layout);
    if (fault !== null) {
      skipped.push(id);
      layout.push({ id: p.id, radius: p.radius, pos: p.pos });
      continue;
    }
    p.pos = pos;
    p.plan = null;
    p.cover = null;
    layout.push({ id: p.id, radius: p.radius, pos });
    applied.push(id);
  }
  aimSnap(state);
  return { applied, skipped };
}
__name(placeFormation, "placeFormation");
function setPersonnel(state, personnel) {
  if (!canReposition(state)) return false;
  const variantId = variantWithPersonnel(state.variantId, personnel);
  state.variantId = variantId;
  state.players = [
    ...state.players.filter((p) => p.team === "offense"),
    ...defensePlayers(state.losYard, variantId)
  ];
  const onField = new Set(state.players.map((p) => p.id));
  for (const p of state.players) {
    if (p.cover === null || onField.has(p.cover)) continue;
    p.cover = null;
    p.plan = null;
  }
  return true;
}
__name(setPersonnel, "setPersonnel");
function learnedPersonnel(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const them = state.players.filter((p) => p.team === "offense");
  const xs = them.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  const spread = xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0;
  const backs = them.length ? them.filter((p) => !onTheLine(state, p)).length / them.length : 0;
  const toGo = Math.min(1, (state.toGoYard - state.losYard) / 10);
  const z = g["sub:spread"] * spread + g["sub:backs"] * backs + g["sub:toGo"] * toGo;
  if (z + g["sub:dime:bias"] > 0) return "dime";
  if (z + g["sub:nickel:bias"] > 0) return "nickel";
  return "stacked";
}
__name(learnedPersonnel, "learnedPersonnel");
function onTheLine(state, player) {
  return Math.abs(yardsOfY(player.pos.y) - state.losYard) <= ON_LINE_YARDS;
}
__name(onTheLine, "onTheLine");
function lineCount(state, team) {
  return state.players.filter((p) => p.team === team && onTheLine(state, p)).length;
}
__name(lineCount, "lineCount");
function formationFoul(state) {
  return lineCount(state, "offense") < minOnLine(state) ? "illegal-formation" : null;
}
__name(formationFoul, "formationFoul");
function inbounds2(x2, radius) {
  return Math.max(SIDELINE_LEFT + radius, Math.min(SIDELINE_RIGHT - radius, x2));
}
__name(inbounds2, "inbounds");
function clearX2(placed, want, y2, radius) {
  for (let k = 0; k <= ALIGN_NUDGE_STEPS; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const x2 = inbounds2(want + sign * k * ALIGN_NUDGE_UNITS, radius);
      const clash = placed.some((q) => dist(q.pos, { x: x2, y: y2 }) < q.radius + radius);
      if (!clash) return x2;
    }
  }
  return inbounds2(want, radius);
}
__name(clearX2, "clearX");
function defenseKeys(state, team = "defense") {
  const them = state.players.filter((p) => p.team !== team);
  const mine = state.players.filter((p) => p.team === team);
  const ball = ballPos(state) ?? { x: CENTRE_X, y: losY(state) };
  const middle = them.length ? them.reduce((sum, p) => sum + p.pos.x, 0) / them.length : ball.x;
  const onLine = them.filter((p) => onTheLine(state, p)).sort((a, b) => Math.abs(a.pos.x - ball.x) - Math.abs(b.pos.x - ball.x) || a.id.localeCompare(b.id));
  const front = mine.filter((p) => positionGroup(p) === "line");
  const covered = new Set(onLine.slice(0, front.length).map((p) => p.id));
  const wide = them.filter((p) => !covered.has(p.id)).sort((a, b) => Math.abs(b.pos.x - ball.x) - Math.abs(a.pos.x - ball.x) || a.id.localeCompare(b.id));
  const free = deepMan(state, team);
  const backs = mine.filter((p) => positionGroup(p) === "back" && p.id !== free?.id);
  const keys = /* @__PURE__ */ new Map();
  front.forEach((d, i) => keys.set(d.id, {
    group: "line",
    mate: onLine[i] ?? onLine[onLine.length - 1] ?? null
  }));
  backs.forEach((d, i) => keys.set(d.id, { group: "back", mate: wide[i] ?? null }));
  if (free) keys.set(free.id, { group: "deep", mate: null });
  for (const d of mine.filter((p) => positionGroup(p) === "backer")) {
    keys.set(d.id, { group: "backer", mate: null });
  }
  for (const d of mine) if (!keys.has(d.id)) keys.set(d.id, { group: "other", mate: null });
  return { keys, ball, middle };
}
__name(defenseKeys, "defenseKeys");
function answerYards(state, defender, key, ball, middle) {
  const acrossOf = /* @__PURE__ */ __name((p) => xToYards(p.pos.x), "acrossOf");
  const { group, mate } = key;
  if (group === "line") {
    return {
      across: mate ? acrossOf(mate) : xToYards(ball.x),
      down: ALIGN_LINE_YARDS
    };
  }
  if (group === "back") {
    return {
      across: mate ? acrossOf(mate) : xToYards(ball.x),
      down: ALIGN_CORNER_YARDS + (mate ? Math.max(0, state.losYard - yardsOfY(mate.pos.y)) : 0)
    };
  }
  if (group === "deep") {
    return { across: xToYards(middle), down: ALIGN_DEEP_YARDS };
  }
  if (group === "backer") {
    return {
      across: xToYards(middle + backerLane(state, defender)),
      down: ALIGN_BACKER_YARDS
    };
  }
  return { across: xToYards(ball.x), down: ALIGN_BACKER_YARDS };
}
__name(answerYards, "answerYards");
function learnedLook(state, values) {
  const g = clampGenome(DEFENSE_SPEC, values);
  const them = state.players.filter((p) => p.team !== "defense");
  if (!them.length) return learnedDefenseSpots(state, values);
  const { keys, ball, middle } = defenseKeys(state);
  const placed = them.map((p) => ({ radius: p.radius, pos: p.pos }));
  const spots = [];
  for (const d of state.players) {
    if (d.team !== "defense") continue;
    const key = keys.get(d.id);
    const answer = answerYards(state, d, key, ball, middle);
    const knob = key.group === "other" ? "backer" : key.group;
    const base = {
      across: g[`pos:${d.id}:across`],
      down: g[`pos:${d.id}:down`]
    };
    const named = typeof base.across === "number";
    const walk = /* @__PURE__ */ __name((from, to, pull) => named ? from + (to - from) * pull : to, "walk");
    const across = walk(base.across, answer.across, g[`adapt:${knob}:width`]);
    const down = Math.max(0.5, Math.min(
      walk(base.down, answer.down, g[`adapt:${knob}:depth`]),
      MAX_YARD - state.losYard
    ));
    const want = fieldPos(across, state.losYard + down);
    const x2 = clearX2(placed, want.x, want.y, d.radius);
    const pos = { x: x2, y: want.y };
    placed.push({ radius: d.radius, pos });
    spots.push({ id: d.id, pos });
  }
  return spots;
}
__name(learnedLook, "learnedLook");
function applyLearnedLook(state, values) {
  if (!canReposition(state)) return false;
  setPersonnel(state, learnedPersonnel(state, values));
  for (const { id, pos } of learnedLook(state, values)) {
    const p = getPlayer(state, id);
    p.pos = pos;
    p.plan = null;
    p.cover = null;
  }
  return true;
}
__name(applyLearnedLook, "applyLearnedLook");
function answerOffense(state, values) {
  if (!isLearnedDefense(state)) return false;
  return applyLearnedLook(state, values);
}
__name(answerOffense, "answerOffense");

// lib/game/hud.js
function humanSide(state) {
  if (state.aiTeam === "offense") return "defense";
  if (state.aiTeam === "defense") return "offense";
  return null;
}
__name(humanSide, "humanSide");
function coachedSide(state) {
  return humanSide(state) ?? "offense";
}
__name(coachedSide, "coachedSide");

// lib/game/play.js
var PLAY_NAME_MAX = 24;
var STANCES = ["tucked", "prepared", "holding", "cutBlock"];
var vec = /* @__PURE__ */ __name((v) => ({ x: v.x, y: v.y }), "vec");
function applyPlay(state, play, team = coachedSide(state)) {
  const applied = /* @__PURE__ */ new Set();
  const skipped = /* @__PURE__ */ new Set();
  const mine = /* @__PURE__ */ __name((id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && p.team === team ? p : null;
  }, "mine");
  for (const p of state.players) {
    if (p.team !== team) continue;
    setMode(state, p.id, "normal");
    clearPlan(state, p.id);
  }
  clearPass(state);
  const wanted = [];
  for (const [id, spot] of Object.entries(play.spots)) {
    if (!mine(id)) {
      skipped.add(id);
      continue;
    }
    wanted.push({ id, pos: fieldPos(spot.across, state.losYard + spot.down) });
  }
  const seated = placeFormation(state, wanted);
  for (const id of seated.skipped) skipped.add(id);
  for (const [id, plan] of Object.entries(play.plans)) {
    if (!mine(id)) {
      skipped.add(id);
      continue;
    }
    setPlan(state, id, vec(plan.dir), plan.throttle);
    applied.add(id);
  }
  for (const [id, stance] of Object.entries(play.stances)) {
    const p = mine(id);
    if (!p) {
      skipped.add(id);
      continue;
    }
    if (setMode(state, id, stance.mode)) p.facing = vec(stance.facing);
    else skipped.add(id);
  }
  if (play.pass) {
    if (setPass(state, play.pass.from, vec(play.pass.dir), play.pass.power)) {
      applied.add(play.pass.from);
    } else skipped.add(play.pass.from);
  }
  aimSnap(state);
  return { applied: [...applied], skipped: [...skipped] };
}
__name(applyPlay, "applyPlay");
var finite = /* @__PURE__ */ __name((v) => typeof v === "number" && Number.isFinite(v) ? v : null, "finite");
function sanVec(v) {
  if (!v || typeof v !== "object") return null;
  const x2 = finite(v.x);
  const y2 = finite(v.y);
  return x2 === null || y2 === null ? null : { x: x2, y: y2 };
}
__name(sanVec, "sanVec");
function sanUnit(v) {
  const n = finite(v);
  return n === null ? null : Math.max(0, Math.min(1, n));
}
__name(sanUnit, "sanUnit");
function sanitizePlay(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.name !== "string") return null;
  if (!raw.plans || typeof raw.plans !== "object") return null;
  if (!raw.stances || typeof raw.stances !== "object") return null;
  const plans = {};
  for (const [id, plan] of Object.entries(raw.plans)) {
    if (id === "__proto__") return null;
    if (!plan || typeof plan !== "object") return null;
    const dir = sanVec(plan.dir);
    const throttle = sanUnit(plan.throttle);
    if (!dir || throttle === null) return null;
    plans[id] = { dir, throttle };
  }
  const stances = {};
  for (const [id, stance] of Object.entries(raw.stances)) {
    if (id === "__proto__") return null;
    if (!stance || typeof stance !== "object") return null;
    const facing = sanVec(stance.facing);
    if (!facing || !STANCES.includes(stance.mode)) return null;
    stances[id] = { mode: stance.mode, facing };
  }
  let pass = null;
  if (raw.pass !== null && raw.pass !== void 0) {
    if (typeof raw.pass !== "object" || typeof raw.pass.from !== "string") return null;
    const dir = sanVec(raw.pass.dir);
    const power = sanUnit(raw.pass.power);
    if (!dir || power === null) return null;
    pass = { from: raw.pass.from, dir, power };
  }
  const spots = {};
  const rawSpots = raw.spots ?? {};
  if (typeof rawSpots !== "object" || Array.isArray(rawSpots)) return null;
  for (const [id, spot] of Object.entries(rawSpots)) {
    if (id === "__proto__") return null;
    if (!spot || typeof spot !== "object") return null;
    const across = finite(spot.across);
    const down = finite(spot.down);
    if (across === null || down === null) return null;
    spots[id] = { across, down };
  }
  return { name: raw.name.slice(0, PLAY_NAME_MAX), plans, stances, pass, spots };
}
__name(sanitizePlay, "sanitizePlay");

// lib/game/cover.js
function setCover(state, id, targetId) {
  const p = getPlayer(state, id);
  const t = getPlayer(state, targetId);
  if (t.team === p.team) return false;
  p.cover = targetId;
  const to = sub(t.pos, p.pos);
  p.plan = {
    dir: len(to) === 0 ? { x: 0, y: p.team === "offense" ? 1 : -1 } : norm(to),
    throttle: 1,
    target: null
  };
  return true;
}
__name(setCover, "setCover");
function clearCover(state, id) {
  getPlayer(state, id).cover = null;
}
__name(clearCover, "clearCover");
function coverAim(state, player) {
  const t = getPlayer(state, player.cover);
  const lead = Math.min(
    COVER_LEAD_MAX_SECONDS,
    len(sub(t.pos, player.pos)) / maxSpeed(player)
  );
  const aim = add(t.pos, scale(t.vel, lead));
  const car = carrier(state);
  if (!car || car.team !== player.team || car.id === player.id) return aim;
  const toBall = sub(car.pos, aim);
  if (len(toBall) === 0) return aim;
  return add(aim, scale(norm(toBall), t.radius + player.radius));
}
__name(coverAim, "coverAim");
function updateCoverPlans(state) {
  for (const p of state.players) {
    if (!p.cover) continue;
    if (!state.players.some((q) => q.id === p.cover)) {
      p.cover = null;
      continue;
    }
    const to = sub(coverAim(state, p), p.pos);
    if (len(to) === 0) continue;
    p.plan = { dir: norm(to), throttle: 1, target: null };
  }
}
__name(updateCoverPlans, "updateCoverPlans");
function grabBonus(a, b) {
  return a.cover === b.id || b.cover === a.id ? COVER_GRAB_REACH : 0;
}
__name(grabBonus, "grabBonus");

// lib/game/block.js
var CONE_COS2 = Math.cos(STANCE_CONE_HALF_ANGLE);
function cutTarget(state, blocker, heading) {
  let best = null;
  let bestDist = Infinity;
  for (const d of state.players) {
    if (d.team !== "defense") continue;
    const toD = sub(d.pos, blocker.pos);
    const dd = len(toD);
    if (dd === 0 || dd > blocker.radius + d.radius + CUT_BLOCK_ENGAGE_UNITS) continue;
    if (dot(norm(toD), heading) < CONE_COS2) continue;
    if (dd < bestDist) {
      best = d;
      bestDist = dd;
    }
  }
  return best;
}
__name(cutTarget, "cutTarget");
function applyCutBlock(state, blocker, heading) {
  const target = cutTarget(state, blocker, heading);
  if (!target) return null;
  const dir = norm(sub(target.pos, blocker.pos));
  target.pos = add(target.pos, scale(dir, CUT_BLOCK_PUSH_UNITS));
  return target;
}
__name(applyCutBlock, "applyCutBlock");
function applyPendingCutBlocks(state) {
  for (const p of state.players) {
    if (p.mode === "cutBlock") applyCutBlock(state, p, p.facing);
  }
}
__name(applyPendingCutBlocks, "applyPendingCutBlocks");
function driveReachBonus(a, b) {
  return a.mode === "cutBlockDrive" || b.mode === "cutBlockDrive" ? CUT_BLOCK_DRIVE_REACH : 0;
}
__name(driveReachBonus, "driveReachBonus");
function advanceCutBlockPhases(state) {
  for (const p of state.players) {
    if (p.mode === "cutBlock") p.mode = "cutBlockDrive";
    else if (p.mode === "cutBlockDrive") {
      p.mode = "normal";
      p.facing = null;
    }
  }
}
__name(advanceCutBlockPhases, "advanceCutBlockPhases");
function applyCutBlockAssist(state) {
  const drivers = state.players.filter((p) => p.mode === "cutBlockDrive");
  for (const p of state.players) {
    p.cutBlockAssist = p.team === "offense" && drivers.some((d) => {
      if (d.id === p.id) return false;
      const gap = dist(d.pos, p.pos) - d.radius - p.radius;
      return gap <= CUT_BLOCK_ASSIST_RADIUS_UNITS;
    });
  }
}
__name(applyCutBlockAssist, "applyCutBlockAssist");

// lib/game/lob.js
var LOCK_UNITS = LOB_LOCK_YARDS * UNITS_PER_YARD_X;
var CATCH_UNITS = LOB_CATCH_YARDS * UNITS_PER_YARD_X;
function isLob(distanceUnits) {
  return distanceUnits > LOCK_UNITS;
}
__name(isLob, "isLob");
function scatterRadius(distanceUnits) {
  const overYards = Math.max(0, (distanceUnits - LOCK_UNITS) / UNITS_PER_YARD_X);
  return (LOB_CATCH_YARDS + LOB_SCATTER_PER_YARD * overYards) * UNITS_PER_YARD_X;
}
__name(scatterRadius, "scatterRadius");
function scatterPoint(aim, radius, random) {
  const r = radius * Math.sqrt(random());
  const a = 2 * Math.PI * random();
  return { x: aim.x + r * Math.cos(a), y: aim.y + r * Math.sin(a) };
}
__name(scatterPoint, "scatterPoint");
function lobSubsteps(distanceUnits) {
  const share = distanceUnits / PASS_REACH_MAX;
  return Math.max(1, Math.round(LOB_TIME_MULT * SUBSTEPS_PER_TURN * share));
}
__name(lobSubsteps, "lobSubsteps");
function planLob(from, aim, random) {
  const radius = scatterRadius(dist(from, aim));
  const to = scatterPoint(aim, radius, random);
  return {
    from: { ...from },
    to,
    aim: { ...aim },
    radius,
    substeps: lobSubsteps(dist(from, to)),
    elapsed: 0
  };
}
__name(planLob, "planLob");
function lobProgress(lob) {
  return lob.substeps === 0 ? 1 : Math.min(1, lob.elapsed / lob.substeps);
}
__name(lobProgress, "lobProgress");
function lobPoint(lob) {
  const t = lobProgress(lob);
  return {
    x: lob.from.x + (lob.to.x - lob.from.x) * t,
    y: lob.from.y + (lob.to.y - lob.from.y) * t
  };
}
__name(lobPoint, "lobPoint");
function lobLanded(lob) {
  return lob.elapsed >= lob.substeps;
}
__name(lobLanded, "lobLanded");
function deadZone(lob) {
  const total = dist(lob.from, lob.to);
  return { start: LOCK_UNITS, end: total - CATCH_UNITS, total };
}
__name(deadZone, "deadZone");
function lobCatchable(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return true;
  const flown = lobProgress(lob) * total;
  return flown <= start || flown >= end;
}
__name(lobCatchable, "lobCatchable");
function lobBallScale(lob) {
  const { start, end, total } = deadZone(lob);
  if (end <= start) return 1;
  const flown = lobProgress(lob) * total;
  if (flown <= start || flown >= end) return 1;
  return 1 + (LOB_BALL_SCALE - 1) * Math.sin(Math.PI * ((flown - start) / (end - start)));
}
__name(lobBallScale, "lobBallScale");
function stepLob(lob) {
  if (lob.elapsed < lob.substeps) lob.elapsed += 1;
  return lobPoint(lob);
}
__name(stepLob, "stepLob");
function ballScale(ball) {
  return ball && ball.lob ? lobBallScale(ball.lob) : 1;
}
__name(ballScale, "ballScale");

// lib/game/physics.js
function steer(player, dt) {
  if (player.plan) {
    const wanted = scale(player.plan.dir, player.plan.throttle * maxSpeed(player));
    const target = clampToStance(player, wanted);
    const change = clampLen(sub(target, player.vel), ACCEL * accelMult(player) * dt);
    player.vel = add(player.vel, change);
    player.vel = clampToStance(player, player.vel);
  } else {
    player.vel = scale(player.vel, IDLE_DAMPING);
  }
  player.pos = add(player.pos, scale(player.vel, dt));
}
__name(steer, "steer");
function stepPhysics(state, dt) {
  for (const p of state.players) {
    steer(p, dt);
    if (p.tackleCooldown > 0) p.tackleCooldown -= 1;
  }
  if (state.ball.carrierId === null && state.ball.pos) {
    if (state.ball.lob) {
      state.ball.pos = stepLob(state.ball.lob);
    } else {
      state.ball.pos = add(state.ball.pos, scale(state.ball.vel, dt));
      state.ball.vel = scale(state.ball.vel, BALL_FRICTION);
    }
    if (state.ball.loose > 0) state.ball.loose -= 1;
  }
  return resolveCollisions(state);
}
__name(stepPhysics, "stepPhysics");
function frictionFor(a, b, tangentialSpeed) {
  if (a.mode === "cutBlockDrive" || b.mode === "cutBlockDrive") return FRICTION_CUT_BLOCK_DRIVE;
  if (a.mode === "holding" || b.mode === "holding") return FRICTION_HOLD;
  if (Math.abs(tangentialSpeed) > RELEASE_SPEED) return FRICTION_RELEASE;
  return FRICTION_BLOCK;
}
__name(frictionFor, "frictionFor");
function resolveCollisions(state) {
  const contacts = [];
  const players = state.players;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const delta = sub(b.pos, a.pos);
      const d = len(delta);
      const overlap = a.radius + b.radius + grabBonus(a, b) + driveReachBonus(a, b) - d;
      if (overlap <= 0) continue;
      const n = d === 0 ? { x: 0, y: 1 } : scale(delta, 1 / d);
      const invA = 1 / effectiveMass(a);
      const invB = 1 / effectiveMass(b);
      const invSum = invA + invB;
      a.pos = add(a.pos, scale(n, -overlap * (invA / invSum)));
      b.pos = add(b.pos, scale(n, overlap * (invB / invSum)));
      const rv = sub(b.vel, a.vel);
      const vn = dot(rv, n);
      if (vn < 0) {
        const jn = -vn / invSum;
        a.vel = add(a.vel, scale(n, -jn * invA));
        b.vel = add(b.vel, scale(n, jn * invB));
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const jtRaw = -vt / invSum;
        const jt = Math.max(-mu * jn, Math.min(mu * jn, jtRaw));
        a.vel = add(a.vel, scale(t, -jt * invA));
        b.vel = add(b.vel, scale(t, jt * invB));
      } else {
        const t = { x: -n.y, y: n.x };
        const vt = dot(rv, t);
        const mu = frictionFor(a, b, vt);
        const drag = vt * mu * 0.5;
        a.vel = add(a.vel, scale(t, drag * invA * effectiveMass(a) * (invA / invSum)));
        b.vel = add(b.vel, scale(t, -drag * invB * effectiveMass(b) * (invB / invSum)));
      }
      contacts.push({ a, b, point: add(a.pos, scale(n, a.radius)) });
    }
  }
  return contacts;
}
__name(resolveCollisions, "resolveCollisions");

// lib/game/rules.js
function tackleProbability(state, defender, car) {
  let tackle = TACKLE_BASE;
  if (defender.mode === "prepared" && inStanceCone(defender, sub(car.pos, defender.pos))) {
    tackle += PREPARED_TACKLE_BONUS;
  }
  tackle += effectiveMass(defender) * len(defender.vel) * MOMENTUM_SCALE;
  const helpers = state.players.filter(
    (p) => p.team === "defense" && p.id !== defender.id && dist(p.pos, car.pos) <= NEARBY_RADIUS
  ).length;
  tackle += helpers * NEARBY_BONUS;
  let breaks = TACKLE_BASE;
  if (car.mode === "tucked") breaks += TUCK_BREAK_BONUS;
  breaks += effectiveMass(car) * len(car.vel) * MOMENTUM_SCALE;
  return tackle / (tackle + breaks);
}
__name(tackleProbability, "tackleProbability");
function dropBall(state, car, random) {
  const angle = random() * 2 * Math.PI;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const offset = car.radius + PICKUP_RADIUS_BONUS + FUMBLE_SPAWN_EPSILON;
  state.ball = {
    carrierId: null,
    pos: add(car.pos, scale(dir, offset)),
    vel: scale(dir, FUMBLE_BALL_SPEED),
    loose: LOOSE_BALL_GRACE_SUBSTEPS
  };
}
__name(dropBall, "dropBall");
function checkTackles(state, random) {
  const car = carrier(state);
  if (!car || state.deadReason) return [];
  const events = [];
  for (const d of state.players) {
    if (d.team !== "defense" || d.tackleCooldown > 0) continue;
    const toCar = sub(car.pos, d.pos);
    if (len(toCar) > tackleReach(d, toCar) + car.radius) continue;
    if (random() < tackleProbability(state, d, car)) {
      if (random() < fumbleChance(car)) {
        dropBall(state, car, random);
        events.push({ type: "fumble", by: d.id });
      } else {
        state.deadReason = "tackled";
        events.push({ type: "tackled", by: d.id });
      }
      return events;
    }
    d.tackleCooldown = TACKLE_COOLDOWN_SUBSTEPS;
    events.push({ type: "broken", by: d.id });
  }
  return events;
}
__name(checkTackles, "checkTackles");
function checkPickup(state) {
  if (state.ball.carrierId !== null || !state.ball.pos || state.deadReason) return [];
  if (state.ball.loose > 0) return [];
  if (state.ball.lob && !lobCatchable(state.ball.lob)) return [];
  for (const p of state.players) {
    if (state.ball.forward && p.team === "offense" && OFFENSIVE_LINE_ROLES.has(p.role)) continue;
    if (dist(p.pos, state.ball.pos) <= p.radius + PICKUP_RADIUS_BONUS) {
      const atYard = yardsOfY(p.pos.y);
      state.ball = { carrierId: p.id, pos: null, vel: null };
      if (p.team === "defense") state.deadReason = "recovered";
      return [{
        type: "pickup",
        by: p.id,
        team: p.team,
        atYard
      }];
    }
  }
  return [];
}
__name(checkPickup, "checkPickup");
function checkIncomplete(state, { endOfTurn = false } = {}) {
  if (state.deadReason || state.ball.carrierId !== null || !state.ball.forward) return [];
  if (state.ball.lob) {
    if (!lobLanded(state.ball.lob)) return [];
  } else if (!endOfTurn && len(state.ball.vel) > PASS_DEAD_SPEED) return [];
  state.deadReason = "incomplete";
  return [{ type: "incomplete" }];
}
__name(checkIncomplete, "checkIncomplete");
function checkDeadBall(state) {
  if (state.deadReason) return [];
  const car = carrier(state);
  const bp = ballPos(state);
  if (!bp) return [];
  const ballFrontY = car ? bp.y + car.radius : bp.y;
  if (car && car.team === "offense" && yardsOfY(ballFrontY) >= GOAL_YARD) {
    state.deadReason = "touchdown";
    return [{ type: "touchdown" }];
  }
  if (car && (car.pos.x < SIDELINE_LEFT || car.pos.x > SIDELINE_RIGHT)) {
    state.deadReason = "out-of-bounds";
    return [{ type: "out-of-bounds" }];
  }
  const airborne = state.ball.lob && state.ball.forward;
  if (!car && !airborne && (bp.x < SIDELINE_LEFT || bp.x > SIDELINE_RIGHT)) {
    state.deadReason = "out-of-bounds";
    return [{ type: "out-of-bounds" }];
  }
  return [];
}
__name(checkDeadBall, "checkDeadBall");
function nextDown(state) {
  const enforcing = state.penalty && state.deadReason !== "recovered";
  if (!enforcing) {
    if (state.deadReason === "touchdown") {
      state.phase = "gameOver";
      state.result = "touchdown";
      return;
    }
    if (state.deadReason === "recovered") {
      state.phase = "gameOver";
      state.result = "turnover-fumble";
      return;
    }
  }
  const raw = enforcing ? state.penalty.spot - PENALTY_YARDS : state.deadReason === "incomplete" ? state.losYard : yardsOfY(ballPos(state).y);
  const spot = Math.max(MIN_SPOT_YARD, Math.min(GOAL_YARD - 0.5, raw));
  const gotFirstDown = !enforcing && spot >= state.toGoYard;
  if (!gotFirstDown && state.down >= 4) {
    state.phase = "gameOver";
    state.result = "turnover-on-downs";
    return;
  }
  state.down = gotFirstDown ? 1 : state.down + 1;
  state.losYard = spot;
  if (gotFirstDown) state.toGoYard = Math.min(spot + FIRST_DOWN_YARDS, GOAL_YARD);
  state.phase = "planning";
  state.turnIndex = 0;
  state.players = formationPlayers(spot, state.variantId);
  state.ball = { carrierId: SNAPPER_ID, pos: null, vel: null };
  state.deadReason = null;
  state.plannedPass = null;
  state.aiPlay = null;
  state.forwardPasses = 0;
  state.penalty = null;
  maybeApplyLearnedFormations(state);
  answerOffense(state, activeGenome(state, "defense"));
  aimSnap(state);
}
__name(nextDown, "nextDown");

// lib/game/zone.js
function zoneAnchorPoint(state, team, across, depth2) {
  return fieldPos(across, state.losYard + defendDir(team) * depth2);
}
__name(zoneAnchorPoint, "zoneAnchorPoint");
function zoneThreats(state, team) {
  const car = carrier(state);
  return state.players.filter((p) => p.team !== team && p.id !== car?.id);
}
__name(zoneThreats, "zoneThreats");
function zoneOrders(state, team, anchors) {
  const spots = [];
  for (const a of anchors) {
    const d = state.players.find((p) => p.id === a.id);
    if (!d) continue;
    spots.push({ d, point: zoneAnchorPoint(state, team, a.across, a.depth) });
  }
  const byZone = new Map(spots.map((s) => [s.d.id, []]));
  for (const t of zoneThreats(state, team)) {
    let best = null;
    let bestD = Infinity;
    for (const s of spots) {
      const gap = dist(t.pos, s.point);
      if (gap < bestD) {
        best = s;
        bestD = gap;
      }
    }
    if (best) byZone.get(best.d.id).push(t);
  }
  const dir = defendDir(team);
  return spots.map(({ d, point }) => {
    const mine = byZone.get(d.id).filter((t) => maxSpeed(t) >= maxSpeed(d) * AI_THREAT_SPEED_RATIO);
    if (!mine.length) return { id: d.id, aim: point, cover: null };
    const deepest = mine.reduce((a, b) => b.pos.y * dir > a.pos.y * dir ? b : a);
    return { id: d.id, aim: leverageAim(d, interceptPoint(d, deepest), deepest), cover: null };
  });
}
__name(zoneOrders, "zoneOrders");

// lib/game/learned/defense-policy.js
function schemeFeatures(state) {
  const offense = state.players.filter((p) => p.team === "offense");
  const xs = offense.map((p) => p.pos.x);
  const width = SIDELINE_RIGHT - SIDELINE_LEFT;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    spread: xs.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0
  };
}
__name(schemeFeatures, "schemeFeatures");
var clamp = /* @__PURE__ */ __name((v, limit) => Math.max(-limit, Math.min(limit, v)), "clamp");
function schemeShade(tendencies) {
  if (!tendencies) return 0;
  return clamp((tendencies.passRate - 0.5) * 2 * TENDENCY_SCHEME_SHADE, TENDENCY_SCHEME_SHADE);
}
__name(schemeShade, "schemeShade");
function favoriteDiscount(tendencies, receiverId) {
  const fav = tendencies?.favorite;
  if (!fav || fav.id !== receiverId) return 0;
  return Math.max(0, Math.min(
    TENDENCY_COVER_DISCOUNT_YARDS,
    fav.edge * TENDENCY_COVER_DISCOUNT_YARDS
  ));
}
__name(favoriteDiscount, "favoriteDiscount");
function anchorShift(tendencies) {
  if (!tendencies) return 0;
  return clamp(tendencies.runSide * TENDENCY_ANCHOR_SHIFT_YARDS, TENDENCY_ANCHOR_SHIFT_YARDS);
}
__name(anchorShift, "anchorShift");
function schemeChoice(state, genome, tendencies = null) {
  const f = schemeFeatures(state);
  const z = genome["scheme:bias"] + genome["scheme:down"] * f.down + genome["scheme:toGo"] * f.toGo + genome["scheme:spread"] * f.spread + schemeShade(tendencies);
  return z > 0 ? "zone" : "man";
}
__name(schemeChoice, "schemeChoice");
function learnedCoverAssignments(state, team, genome, tendencies = null) {
  const car = carrier(state);
  const free = deepMan(state, team);
  const takers = state.players.filter(
    (p) => p.team === team && positionGroup(p) === "back" && p.id !== free?.id
  );
  const them = state.players.filter((p) => p.team !== team && p.id !== car?.id);
  const dir = defendDir(team);
  const line = losY(state);
  const claim = /* @__PURE__ */ __name((map2, claimed2, defenders, receivers) => {
    const pairs = [];
    for (const d of defenders) {
      for (const r of receivers) {
        if (maxSpeed(r) < maxSpeed(d) * AI_THREAT_SPEED_RATIO) continue;
        const depth2 = (r.pos.y - line) * dir / UNITS_PER_YARD_X;
        const width = Math.abs(r.pos.x - CENTRE_X) / UNITS_PER_YARD_X;
        const cost = genome["cov:dist"] * (dist(d.pos, r.pos) / UNITS_PER_YARD_X) + genome["cov:depth"] * depth2 + genome["cov:width"] * width - favoriteDiscount(tendencies, r.id);
        pairs.push({ d: d.id, r: r.id, cost });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost || a.d.localeCompare(b.d) || a.r.localeCompare(b.r));
    for (const { d, r } of pairs) {
      if (map2.has(d) || claimed2.has(r)) continue;
      map2.set(d, r);
      claimed2.add(r);
    }
    return new Set(pairs.map((p) => p.r));
  }, "claim");
  const map = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  const threats = claim(map, claimed, takers, them);
  const leftover = them.filter((r) => threats.has(r.id) && !claimed.has(r.id));
  if (leftover.length) {
    const backers = state.players.filter(
      (p) => p.team === team && positionGroup(p) === "backer"
    );
    claim(map, claimed, backers, leftover);
  }
  return map;
}
__name(learnedCoverAssignments, "learnedCoverAssignments");
function zoneAnchorsFromGenome(players, genome, tendencies = null) {
  const shift = anchorShift(tendencies);
  const halfField = FIELD_WIDTH_YARDS / 2;
  return players.filter((p) => typeof genome[`zone:${p.id}:across`] === "number").map((p) => ({
    id: p.id,
    across: Math.max(-halfField, Math.min(halfField, genome[`zone:${p.id}:across`] + shift)),
    depth: genome[`zone:${p.id}:depth`]
  }));
}
__name(zoneAnchorsFromGenome, "zoneAnchorsFromGenome");
function learnedOrders(state, team, genome, tendencies = null) {
  const bp = ballPos(state);
  if (!bp) return [];
  const mine = state.players.filter((p) => p.team === team);
  const car = carrier(state);
  if (!car || car.team === team) {
    return mine.map((p) => ({ id: p.id, aim: { ...bp }, cover: null }));
  }
  if (pastLine(state, team, car.pos)) {
    return mine.map((p) => ({
      id: p.id,
      aim: leverageAim(p, interceptPoint(p, car), car),
      cover: null
    }));
  }
  const scheme = schemeChoice(state, genome, tendencies);
  const zone = scheme === "zone" ? zoneOrders(state, team, zoneAnchorsFromGenome(mine, genome, tendencies)) : [];
  const zoned = new Set(zone.map((o) => o.id));
  const man = scheme === "man" ? learnedCoverAssignments(state, team, genome, tendencies) : /* @__PURE__ */ new Map();
  const orders = [];
  for (const p of mine) {
    if (positionGroup(p) === "line") {
      orders.push({ id: p.id, ...rushLineman(state, p) });
      continue;
    }
    if (zoned.has(p.id)) continue;
    const assigned = man.get(p.id);
    if (assigned) {
      orders.push({ id: p.id, aim: null, cover: assigned });
      continue;
    }
    if (positionGroup(p) === "back") {
      orders.push({ id: p.id, aim: deepAim(state, p), cover: null });
      continue;
    }
    orders.push({ id: p.id, ...flowLinebacker(state, p) });
  }
  orders.push(...zone);
  return orders;
}
__name(learnedOrders, "learnedOrders");

// lib/game/tendencies.js
function distanceBucket(toGo) {
  if (toGo <= TENDENCY_SHORT_YARDS) return "short";
  if (toGo <= TENDENCY_MEDIUM_YARDS) return "medium";
  return "long";
}
__name(distanceBucket, "distanceBucket");
function situationKey(down, toGo) {
  return `${down}:${distanceBucket(toGo)}`;
}
__name(situationKey, "situationKey");
function readTendencies(counts, down, toGo) {
  const bucket = counts.calls[situationKey(down, toGo)] ?? { run: 0, pass: 0 };
  const passRate = (bucket.pass + TENDENCY_PRIOR) / (bucket.run + bucket.pass + 2 * TENDENCY_PRIOR);
  const { left, middle, right } = counts.sides;
  const runSide = (right - left) / (left + middle + right + 2 * TENDENCY_PRIOR);
  const ids = Object.keys(counts.targets).sort();
  let favorite = null;
  if (ids.length) {
    let best = ids[0];
    for (const id of ids) if (counts.targets[id] > counts.targets[best]) best = id;
    const total = ids.reduce((sum, id) => sum + counts.targets[id], 0);
    favorite = { id: best, edge: counts.targets[best] / (total + TENDENCY_PRIOR) };
  }
  return { passRate, runSide, favorite, samples: bucket.run + bucket.pass };
}
__name(readTendencies, "readTendencies");
function tendenciesForState(state) {
  if (!state.tendencyCounts) return null;
  return readTendencies(state.tendencyCounts, state.down, state.toGoYard - state.losYard);
}
__name(tendenciesForState, "tendenciesForState");

// lib/game/pursuit.js
function pursuitTarget(state, player) {
  const bp = ballPos(state);
  if (!bp) return null;
  const car = carrier(state);
  if (!car || car.id === player.id) return { ...bp };
  const t = Math.min(AI_LEAD_MAX_SECONDS, len(sub(bp, player.pos)) / maxSpeed(player));
  return add(bp, scale(car.vel, t));
}
__name(pursuitTarget, "pursuitTarget");

// lib/game/offense.js
function playSideEdgeX(side, line) {
  const onSide = line.filter((p) => side * p.pos.x >= 0);
  const pool = onSide.length ? onSide : line;
  return pool.reduce((best, p) => side * p.pos.x > side * best.pos.x ? p : best).pos.x;
}
__name(playSideEdgeX, "playSideEdgeX");
function readDefender(state, side) {
  const dl = state.players.filter((p) => p.team === "defense" && positionGroup(p) === "line");
  if (!dl.length) return null;
  return dl.reduce((best, p) => side * p.pos.x > side * best.pos.x ? p : best);
}
__name(readDefender, "readDefender");
function assignBlocks(blockers, defenders) {
  const pairs = [];
  for (const b of blockers) for (const d of defenders) pairs.push({ b: b.id, d: d.id, gap: dist(b.pos, d.pos) });
  pairs.sort((a, b) => a.gap - b.gap || a.b.localeCompare(b.b) || a.d.localeCompare(b.d));
  const map = /* @__PURE__ */ new Map();
  const claimed = /* @__PURE__ */ new Set();
  for (const { b, d } of pairs) {
    if (map.has(b) || claimed.has(d)) continue;
    map.set(b, d);
    claimed.add(d);
  }
  return map;
}
__name(assignBlocks, "assignBlocks");
function applyBlocks(state, blockers) {
  const defenders = state.players.filter((p) => p.team === "defense");
  const map = assignBlocks(blockers, defenders);
  for (const b of blockers) {
    const dId = map.get(b.id);
    if (!dId) continue;
    const d = getPlayer(state, dId);
    const gap = sub(d.pos, b.pos);
    if (len(gap) === 0) continue;
    setPlan(state, b.id, norm(gap), 1);
    if (len(gap) <= b.radius + d.radius + BLOCK_ENGAGE_UNITS) setMode(state, b.id, "holding");
  }
}
__name(applyBlocks, "applyBlocks");
function daylightDirection(state, carrierPlayer) {
  const defenders = state.players.filter((p) => p.team === "defense");
  let bestDir = null;
  let bestScore = -Infinity;
  for (const deg of DAYLIGHT_ANGLES_DEG) {
    const rad = deg * Math.PI / 180;
    const dir = { x: Math.sin(rad), y: Math.cos(rad) };
    let clearance = Infinity;
    for (const d of defenders) {
      const rel = sub(d.pos, carrierPlayer.pos);
      const along = dot(rel, dir);
      if (along <= 0 || along > DAYLIGHT_LOOKAHEAD_UNITS) continue;
      const across = len(sub(rel, scale(dir, along)));
      clearance = Math.min(clearance, across);
    }
    if (clearance > bestScore) {
      bestScore = clearance;
      bestDir = dir;
    }
  }
  return bestDir ?? { x: 0, y: 1 };
}
__name(daylightDirection, "daylightDirection");

// lib/game/learned/offense-policy.js
var BOX_DEPTH_YARDS = 3;
var BOX_HALF_WIDTH_YARDS = 8;
function boxDefenders(state) {
  const ball = ballPos(state);
  if (!ball) return [];
  return state.players.filter((p) => p.team === "defense" && Math.abs(yardsOfY(p.pos.y) - state.losYard) <= BOX_DEPTH_YARDS && Math.abs(p.pos.x - ball.x) <= BOX_HALF_WIDTH_YARDS * UNITS_PER_YARD_X);
}
__name(boxDefenders, "boxDefenders");
function callFeatures(state) {
  const defenders = state.players.filter((p) => p.team === "defense").length;
  return {
    down: (state.down - 1) / 3,
    toGo: Math.min(1, (state.toGoYard - state.losYard) / 10),
    box: defenders ? boxDefenders(state).length / defenders : 0
  };
}
__name(callFeatures, "callFeatures");
function chooseCall(state, genome) {
  const f = callFeatures(state);
  const z = genome["call:bias"] + genome["call:down"] * f.down + genome["call:toGo"] * f.toGo + genome["call:box"] * f.box;
  return z > 0 ? "pass" : "run";
}
__name(chooseCall, "chooseCall");
function chooseSide(state, genome) {
  const ball = ballPos(state);
  const box = boxDefenders(state);
  const left = box.filter((p) => p.pos.x < ball.x).length;
  const right = box.length - left;
  const z = genome["run:sideBias"] + 0.5 * (left - right);
  return z >= 0 ? 1 : -1;
}
__name(chooseSide, "chooseSide");
function planLearnedRun(state, genome) {
  const offense = state.players.filter((p) => p.team === "offense");
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  const rb = offense.find((p) => p.role === "RB");
  const line = offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role));
  if (!qb || !rb) return null;
  const side = chooseSide(state, genome);
  const reader = readDefender(state, side);
  const give = reader !== null && side * (reader.pos.x - playSideEdgeX(side, line)) > genome["run:read"];
  if (give) {
    const from = getPlayer(state, SNAPPER_ID);
    const gap = sub(rb.pos, from.pos);
    if (len(gap) > 0) {
      setPass(
        state,
        SNAPPER_ID,
        norm(gap),
        powerForTravel(Math.max(0, len(gap) - spawnOffset(from)), Infinity),
        rb.id
      );
    }
  }
  const lean = norm({ x: side * genome["run:lean"], y: 1 });
  for (const p of line) {
    setPlan(state, p.id, lean, 1);
    setMode(state, p.id, "cutBlock");
  }
  setPlan(state, rb.id, lean, 1);
  setPlan(
    state,
    qb.id,
    give ? norm({ x: -side, y: OPTION_FAKE_FORWARD }) : norm({ x: side * Math.max(1, genome["run:lean"] * 2), y: 1 }),
    give ? OPTION_FAKE_THROTTLE : 1
  );
  applyBlocks(state, offense.filter(
    (p) => p.id !== qb.id && p.id !== rb.id && !OFFENSIVE_LINE_ROLES.has(p.role)
  ));
  return { call: "run", side, give };
}
__name(planLearnedRun, "planLearnedRun");
function eligibleReceivers(state) {
  return state.players.filter((p) => p.team === "offense" && p.id !== SNAP_TARGET_ID && p.id !== SNAPPER_ID && !OFFENSIVE_LINE_ROLES.has(p.role));
}
__name(eligibleReceivers, "eligibleReceivers");
function routeDir(genome, id, phase) {
  const deg = genome[`route:${id}:${phase}`];
  if (typeof deg !== "number") return { x: 0, y: 1 };
  const rad = deg * Math.PI / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}
__name(routeDir, "routeDir");
function planLearnedPassSnap(state, genome) {
  const offense = state.players.filter((p) => p.team === "offense");
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  if (!qb) return null;
  for (const r of eligibleReceivers(state)) {
    setPlan(state, r.id, routeDir(genome, r.id, "deg0"), 1);
  }
  setPlan(state, qb.id, { x: 0, y: -1 }, genome["qb:drop"]);
  applyBlocks(state, offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role)));
  return { call: "pass" };
}
__name(planLearnedPassSnap, "planLearnedPassSnap");
function receiverScore(state, genome, qb, r) {
  const defenders = state.players.filter((p) => p.team === "defense");
  const sep = defenders.length ? Math.min(...defenders.map((d) => dist(d.pos, r.pos))) / UNITS_PER_YARD_X : 99;
  const depth2 = yardsOfY(r.pos.y) - state.losYard;
  const range = dist(qb.pos, r.pos) / UNITS_PER_YARD_X;
  return genome["tgt:sep"] * sep + genome["tgt:depth"] * depth2 + genome["tgt:dist"] * range;
}
__name(receiverScore, "receiverScore");
function planThrow(state, genome, qb) {
  if (state.forwardPasses > 0) return false;
  if (yardsOfY(qb.pos.y) > state.losYard) return false;
  const receivers = eligibleReceivers(state);
  if (!receivers.length) return false;
  const scored = receivers.map((r) => ({ r, score: receiverScore(state, genome, qb, r) })).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  const best = scored[0];
  const mustThrow = state.turnIndex >= Math.round(genome["throw:hold"]);
  if (best.score <= genome["throw:go"] && !mustThrow) return false;
  const gap = sub(best.r.pos, qb.pos);
  if (len(gap) === 0) return false;
  if (len(gap) <= LOCK_UNITS) {
    setPass(state, qb.id, norm(gap), 0.5, best.r.id);
    return true;
  }
  const lead = add(best.r.pos, scale(best.r.vel, 0.5));
  const to = sub(lead, qb.pos);
  if (len(to) === 0) return false;
  setPass(
    state,
    qb.id,
    norm(to),
    powerForTravel(Math.max(0, len(to) - spawnOffset(qb)), Infinity),
    null
  );
  return true;
}
__name(planThrow, "planThrow");
function tuckIfPressured(state, car) {
  const near = state.players.some((p) => p.team === "defense" && dist(p.pos, car.pos) <= AI_BREAKDOWN_UNITS);
  if (near && car.mode !== "tucked") setMode(state, car.id, "tucked");
}
__name(tuckIfPressured, "tuckIfPressured");
function coachLearnedOffense(state, genome) {
  const offense = state.players.filter((p) => p.team === "offense");
  const car = carrier(state);
  if (!car) {
    const bp = ballPos(state);
    if (!bp) return;
    for (const p of offense) {
      const to = sub(bp, p.pos);
      if (len(to) === 0) continue;
      setPlan(state, p.id, norm(to), 1);
    }
    return;
  }
  if (car.team !== "offense") return;
  if (state.turnIndex === 0) {
    state.aiPlay = chooseCall(state, genome) === "pass" ? planLearnedPassSnap(state, genome) : planLearnedRun(state, genome);
    return;
  }
  const qb = offense.find((p) => p.id === SNAP_TARGET_ID);
  if (state.aiPlay?.call === "pass" && qb && car.id === qb.id) {
    for (const r of eligibleReceivers(state)) {
      setPlan(state, r.id, routeDir(genome, r.id, "degLate"), 1);
    }
    applyBlocks(state, offense.filter((p) => OFFENSIVE_LINE_ROLES.has(p.role)));
    if (!planThrow(state, genome, qb)) {
      if (state.turnIndex > Math.round(genome["throw:hold"])) {
        setPlan(state, qb.id, daylightDirection(state, qb), 1);
        tuckIfPressured(state, qb);
      } else {
        setPlan(state, qb.id, { x: 0, y: -1 }, 0.2);
      }
    }
    return;
  }
  setPlan(state, car.id, daylightDirection(state, car), 1);
  tuckIfPressured(state, car);
  applyBlocks(state, offense.filter((p) => p.id !== car.id));
}
__name(coachLearnedOffense, "coachLearnedOffense");

// lib/game/ai.js
function aiPlayers(state, team = state.aiTeam) {
  if (!team) return [];
  return state.players.filter((p) => p.team === team);
}
__name(aiPlayers, "aiPlayers");
function defensePlans(state) {
  const plans = [];
  for (const p of aiPlayers(state)) {
    const target = pursuitTarget(state, p);
    if (target === null) continue;
    const to = sub(target, p.pos);
    if (len(to) === 0) continue;
    plans.push({ id: p.id, dir: norm(to), throttle: 1 });
  }
  return plans;
}
__name(defensePlans, "defensePlans");
function applyAiModes(state, team = state.aiTeam) {
  const car = carrier(state);
  const chasing = car !== null && car.team !== team;
  for (const p of aiPlayers(state, team)) {
    const close = chasing && len(sub(car.pos, p.pos)) <= AI_BREAKDOWN_UNITS;
    const want = close ? "prepared" : "normal";
    if (p.mode !== want) setMode(state, p.id, want);
  }
}
__name(applyAiModes, "applyAiModes");
function applyOrders(state, orders) {
  for (const { id, aim, cover } of orders) {
    if (cover) {
      setCover(state, id, cover);
      continue;
    }
    clearCover(state, id);
    if (!aim) continue;
    const to = sub(aim, getPlayer(state, id).pos);
    if (len(to) === 0) continue;
    setPlan(state, id, norm(to), 1);
  }
}
__name(applyOrders, "applyOrders");
function coachSmartDefense(state) {
  applyOrders(state, smartOrders(state, state.aiTeam));
}
__name(coachSmartDefense, "coachSmartDefense");
function coachLearnedDefense(state) {
  applyOrders(state, learnedOrders(
    state,
    state.aiTeam,
    activeGenome(state, "defense"),
    tendenciesForState(state)
  ));
}
__name(coachLearnedDefense, "coachLearnedDefense");
function applyScriptedOrders(state) {
  const script = state.scriptedOrders;
  if (!script || script.length === 0) return;
  const orders = script[Math.min(state.turnIndex, script.length - 1)];
  applyOrders(state, orders);
  for (const { id, mode } of orders) {
    if (mode && getPlayer(state, id).mode !== mode) setMode(state, id, mode);
  }
}
__name(applyScriptedOrders, "applyScriptedOrders");
function coachAi(state) {
  if (!state.aiTeam) return;
  if (state.aiLevel === "scripted") {
    applyScriptedOrders(state);
    return;
  }
  if (state.aiTeam === "offense" && state.aiLevel === "learned") {
    coachLearnedOffense(state, activeGenome(state, "offense"));
    return;
  }
  applyAiModes(state);
  if (state.aiLevel === "learned" && state.aiTeam === "defense") {
    coachLearnedDefense(state);
    return;
  }
  if (state.aiLevel === "smart") {
    coachSmartDefense(state);
    return;
  }
  for (const { id, dir, throttle } of defensePlans(state)) setPlan(state, id, dir, throttle);
}
__name(coachAi, "coachAi");
function clearAiPlans(state) {
  for (const p of aiPlayers(state)) {
    clearPlan(state, p.id);
    clearCover(state, p.id);
  }
}
__name(clearAiPlans, "clearAiPlans");

// lib/game/predict.js
function predictRoute(player) {
  const g = {
    ...player,
    pos: { ...player.pos },
    vel: { ...player.vel },
    plan: player.plan ? { ...player.plan } : null
  };
  const route = [];
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    steer(g, DT);
    route.push({ ...g.pos });
  }
  return route;
}
__name(predictRoute, "predictRoute");

// lib/game/pass.js
function isForward(dir) {
  return dir.y > 0;
}
__name(isForward, "isForward");
function passFoul(state, passer, dir) {
  if (!isForward(dir)) return null;
  if (state.forwardPasses > 0) return "second-forward-pass";
  if (yardsOfY(passer.pos.y) > state.losYard) return "illegal-forward-pass";
  return null;
}
__name(passFoul, "passFoul");
function passOrigin(player, dir) {
  return add(player.pos, scale(norm(dir), spawnOffset(player)));
}
__name(passOrigin, "passOrigin");
function lockOnPass(passer, receiver) {
  const route = predictRoute(receiver);
  const reach2 = receiver.radius + PICKUP_RADIUS_BONUS;
  let best = null;
  for (let n = PASS_GRACE_SUBSTEPS; n <= route.length; n++) {
    const to = sub(route[n - 1], passer.pos);
    const span = len(to);
    if (span === 0) continue;
    const gap = Math.max(0, span - spawnOffset(passer));
    const power = powerForTravel(gap, n);
    const miss = Math.abs(passTravel(power, n) - gap);
    const shot = { dir: norm(to), power };
    if (miss <= reach2) return shot;
    if (!best || miss < best.miss) best = { ...shot, miss };
  }
  return best ? { dir: best.dir, power: best.power } : { dir: norm(sub(receiver.pos, passer.pos)), power: 0 };
}
__name(lockOnPass, "lockOnPass");
function releasePass(state, random) {
  const planned = state.plannedPass;
  if (!planned) return [];
  const car = carrier(state);
  if (!car || car.id !== planned.from) return [];
  const aimed = planned.target ? state.players.find((p) => p.id === planned.target) : null;
  const shot = aimed ? lockOnPass(car, aimed) : planned;
  const dir = norm(shot.dir);
  const forward = isForward(dir);
  const foul = passFoul(state, car, dir);
  if (forward) state.forwardPasses += 1;
  if (foul && !state.penalty) state.penalty = { foul, spot: state.losYard };
  const speed = passSpeed(shot.power);
  const reach2 = passReach(shot.power);
  const pos = passOrigin(car, dir);
  state.ball = {
    carrierId: null,
    pos,
    vel: scale(dir, speed),
    loose: PASS_GRACE_SUBSTEPS,
    forward,
    // A throw long enough to arc is FLOWN rather than rolled: planLob fixes
    // where it comes down — somewhere inside the landing circle the coach was
    // shown — and how long it hangs, and physics.js walks it there. A throw
    // aimed at a man never arcs, whatever its power: the whole point of locking
    // on is that the ball stays in his reach, and a lob would go over his head.
    //
    // `vel` above is still what it left the hand at, which is true of a lob as
    // much as of a handoff and is what the arrow and the flag were drawn from.
    // It simply is not what moves the ball any more once `lob` is set.
    lob: !planned.target && isLob(reach2) ? planLob(pos, add(pos, scale(dir, reach2)), random) : null
  };
  const events = [{
    type: "pass",
    by: car.id,
    forward,
    auto: planned.auto === true,
    fromYard: yardsOfY(pos.y)
  }];
  if (foul) events.push({ type: "flag", foul });
  return events;
}
__name(releasePass, "releasePass");

// lib/game/turn.js
function snapshot(state) {
  const bp = ballPos(state);
  const loose = state.ball.carrierId === null ? state.ball.pos : null;
  return {
    players: state.players.map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y })),
    ball: bp ? { x: bp.x, y: bp.y } : null,
    looseBall: loose ? { x: loose.x, y: loose.y, scale: ballScale(state.ball) } : null
  };
}
__name(snapshot, "snapshot");
function runTurn(state, random) {
  state.phase = "running";
  if (state.turnIndex === 0 && !state.penalty) {
    const foul = formationFoul(state);
    if (foul) state.penalty = { foul, spot: state.losYard };
  }
  coachAi(state);
  applyPendingCutBlocks(state);
  const frames = [];
  const events = [];
  events.push(...releasePass(state, random));
  for (let i = 0; i < SUBSTEPS_PER_TURN; i++) {
    updateCoverPlans(state);
    applyCutBlockAssist(state);
    stepPhysics(state, DT);
    events.push(...checkDeadBall(state));
    events.push(...checkTackles(state, random));
    events.push(...checkPickup(state));
    events.push(...checkIncomplete(state));
    frames.push(snapshot(state));
    if (state.deadReason) break;
  }
  events.push(...checkIncomplete(state, { endOfTurn: true }));
  for (const p of state.players) p.charge = 0;
  advanceCutBlockPhases(state);
  clearAiPlans(state);
  clearPass(state);
  state.turnIndex += 1;
  state.phase = state.deadReason ? "playOver" : "planning";
  return { frames, events };
}
__name(runTurn, "runTurn");

// lib/game/rng.js
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
__name(mulberry32, "mulberry32");

// worker/match-engine.js
var HUDDLE_SECONDS = 30;
var TURN_CLOCK_SECONDS = 12;
var CONNECT_TIMEOUT_MS = 15e3;
var FLUSH_GRACE_MS = 2e3;
var DROP_GRACE_MS = 2e4;
var MAX_COMMIT_BYTES = 16384;
function createMatch({ matchId, variant, seed, tokens }) {
  return {
    matchId,
    variant,
    seed,
    status: "waiting",
    tokens,
    connected: { offense: false, defense: false },
    state: null,
    lastCommitted: { offense: null, defense: null },
    committed: { offense: null, defense: null },
    deadlineAt: null,
    flushDeadlineAt: null,
    disconnectedAt: { offense: null, defense: null },
    reason: null
  };
}
__name(createMatch, "createMatch");
var OTHER = { offense: "defense", defense: "offense" };
function bothConnected(record) {
  return record.connected.offense && record.connected.defense;
}
__name(bothConnected, "bothConnected");
function startMatch(record, now) {
  const state = createGame({ seed: record.seed, variant: record.variant });
  const deadlineAt = now + HUDDLE_SECONDS * 1e3;
  const next = { ...record, status: "active", state, deadlineAt };
  const messages = ["offense", "defense"].map((side) => ({
    to: side,
    type: "start",
    seed: record.seed,
    variant: record.variant,
    losYard: state.losYard,
    side,
    deadlineAt
  }));
  return { record: next, messages };
}
__name(startMatch, "startMatch");
function applyMatchMessage(record, message, now) {
  if (message.type === "connect") {
    if (record.connected[message.side]) {
      return { record, messages: [{ to: message.side, type: "refused" }] };
    }
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: "refused" }] };
    }
    const connected = { ...record.connected, [message.side]: true };
    const withConnect = { ...record, connected };
    if (record.status === "waiting" && bothConnected(withConnect)) {
      return startMatch(withConnect, now);
    }
    return { record: withConnect, messages: [] };
  }
  if (message.type === "connectTimeout") {
    if (record.status !== "waiting") return { record, messages: [] };
    const waitingSide = record.connected.offense ? "offense" : record.connected.defense ? "defense" : null;
    if (waitingSide === null) return { record, messages: [] };
    const next = { ...record, status: "over", reason: "no-opponent" };
    return { record: next, messages: [{ to: waitingSide, type: "matchOver", reason: "no-opponent" }] };
  }
  if (message.type === "disconnect") {
    if (record.status !== "active") return { record, messages: [] };
    const disconnectedAt = { ...record.disconnectedAt, [message.side]: now };
    const next = { ...record, status: "paused", disconnectedAt };
    const survivor = OTHER[message.side];
    return { record: next, messages: [{ to: survivor, type: "opponentGone", resumeBy: now + DROP_GRACE_MS }] };
  }
  if (message.type === "reconnect") {
    if (record.status !== "paused" || record.disconnectedAt[message.side] === null) {
      return { record, messages: [] };
    }
    if (record.tokens[message.side] !== message.token) {
      return { record, messages: [{ to: message.side, type: "refused" }] };
    }
    const disconnectedAt = { ...record.disconnectedAt, [message.side]: null };
    const pausedFor = now - record.disconnectedAt[message.side];
    const next = { ...record, status: "active", disconnectedAt, deadlineAt: record.deadlineAt + pausedFor };
    const survivor = OTHER[message.side];
    return {
      record: next,
      messages: [
        { to: survivor, type: "opponentBack" },
        {
          to: message.side,
          type: "turn",
          frames: [],
          events: [],
          down: record.state.down,
          deadlineAt: next.deadlineAt,
          state: stripForSide(record.state, message.side)
        }
      ]
    };
  }
  if (message.type === "dropTimeout") {
    if (record.status !== "paused" || record.disconnectedAt[message.side] === null) {
      return { record, messages: [] };
    }
    const next = { ...record, status: "over", reason: "opponent-left" };
    const survivor = OTHER[message.side];
    return { record: next, messages: [{ to: survivor, type: "matchOver", reason: "opponent-left" }] };
  }
  if (record.status !== "active") return { record, messages: [] };
  if (message.type === "commit") {
    const refuse = /* @__PURE__ */ __name((reason) => ({
      record,
      messages: [{ to: message.side, type: "commitRefused", reason, turnIndex: record.state.turnIndex }]
    }), "refuse");
    if (message.turnIndex !== record.state.turnIndex) return refuse("stale");
    if (JSON.stringify(message).length > MAX_COMMIT_BYTES) return refuse("too-big");
    const play = sanitizePlay(message.play);
    if (!play) return refuse("malformed");
    const state = cloneState(record.state);
    applyPlay(state, play, message.side);
    const committed = { ...record.committed, [message.side]: play };
    const withCommit = { ...record, state, committed };
    if (committed.offense !== null && committed.defense !== null) {
      return runResolvedTurn(withCommit, now);
    }
    return { record: withCommit, messages: [] };
  }
  if (message.type === "alarm") {
    if (record.status !== "active") return { record, messages: [] };
    const bothIn = record.committed.offense !== null && record.committed.defense !== null;
    if (bothIn) return { record, messages: [] };
    if (record.flushDeadlineAt === null) {
      if (now < record.deadlineAt) return { record, messages: [] };
      const missing = ["offense", "defense"].filter((side) => record.committed[side] === null);
      const next = { ...record, flushDeadlineAt: now + FLUSH_GRACE_MS };
      return { record: next, messages: missing.map((side) => ({ to: side, type: "timeUp" })) };
    }
    if (now < record.flushDeadlineAt) return { record, messages: [] };
    const filled = fillFromLastCommitted(record);
    const withFilled = { ...record, state: filled, flushDeadlineAt: null };
    return runResolvedTurn(withFilled, now);
  }
  return { record, messages: [] };
}
__name(applyMatchMessage, "applyMatchMessage");
function cloneState(state) {
  return hydrateState(serializeState(state));
}
__name(cloneState, "cloneState");
function stripForSide(state, side) {
  const stripped = cloneState(state);
  for (const p of stripped.players) {
    if (p.team === side) continue;
    p.plan = null;
    p.cover = null;
  }
  if (stripped.plannedPass && stripped.plannedPass.from && getTeamOf(stripped, stripped.plannedPass.from) !== side) {
    stripped.plannedPass = null;
  }
  return stripped;
}
__name(stripForSide, "stripForSide");
function getTeamOf(state, id) {
  return state.players.find((p) => p.id === id)?.team ?? null;
}
__name(getTeamOf, "getTeamOf");
function fillFromLastCommitted(record) {
  let state = record.state;
  for (const side of ["offense", "defense"]) {
    if (record.committed[side] !== null) continue;
    const last = record.lastCommitted[side];
    if (!last) continue;
    state = cloneState(state);
    const trimmedStances = {};
    for (const [id, stance] of Object.entries(last.stances)) {
      const current = state.players.find((p) => p.id === id);
      if (current && current.mode !== stance.mode) trimmedStances[id] = stance;
    }
    applyPlay(state, { ...last, spots: {}, stances: trimmedStances }, side);
  }
  return state;
}
__name(fillFromLastCommitted, "fillFromLastCommitted");
function runResolvedTurn(record, now) {
  const random = mulberry32(record.seed + record.state.turnIndex);
  const state = cloneState(record.state);
  const { frames, events } = runTurn(state, random);
  if (state.phase === "playOver") {
    nextDown(state);
  }
  const lastCommitted = {
    offense: record.committed.offense ?? record.lastCommitted.offense,
    defense: record.committed.defense ?? record.lastCommitted.defense
  };
  const deadlineAt = now + TURN_CLOCK_SECONDS * 1e3;
  const next = {
    ...record,
    state,
    lastCommitted,
    committed: { offense: null, defense: null },
    deadlineAt,
    flushDeadlineAt: null,
    status: state.phase === "gameOver" ? "over" : record.status,
    reason: state.phase === "gameOver" ? "down" : record.reason
  };
  const messages = ["offense", "defense"].map((side) => ({
    to: side,
    type: "turn",
    frames,
    events,
    down: state.down,
    deadlineAt,
    state: stripForSide(state, side)
  }));
  return { record: next, messages };
}
__name(runResolvedTurn, "runResolvedTurn");
function nextAlarm(record) {
  if (record.status === "active") {
    return { at: record.flushDeadlineAt ?? record.deadlineAt, kind: "clock" };
  }
  if (record.status === "paused") {
    const side = record.disconnectedAt.offense !== null ? "offense" : "defense";
    return { at: record.disconnectedAt[side] + DROP_GRACE_MS, kind: "dropTimeout" };
  }
  return null;
}
__name(nextAlarm, "nextAlarm");

// worker/match-do.js
var MatchDO = class {
  static {
    __name(this, "MatchDO");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = { offense: null, defense: null };
    this.record = null;
    this.armedFor = null;
    this.armedAt = null;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/create") {
      const { matchId, variant, seed, tokens } = await request.json();
      this.record = createMatch({ matchId, variant, seed, tokens });
      await this.arm(Date.now() + CONNECT_TIMEOUT_MS, "connectTimeout");
      return new Response("ok");
    }
    const side = url.searchParams.get("side");
    const token = url.searchParams.get("token");
    if (side !== "offense" && side !== "defense" || !this.record) {
      return new Response("bad request", { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets[side] = server;
    server.addEventListener("message", (ev) => this.onMessage(side, ev));
    server.addEventListener("close", () => this.onClose(side));
    await this.dispatch(applyMatchMessage(this.record, { type: "connect", side, token }, Date.now()));
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(side, ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "commit") {
      this.dispatch(applyMatchMessage(
        this.record,
        { type: "commit", side, turnIndex: msg.turnIndex, play: msg.play },
        Date.now()
      ));
    }
  }
  onClose(side) {
    this.sockets[side] = null;
    this.dispatch(applyMatchMessage(this.record, { type: "disconnect", side }, Date.now()));
  }
  async alarm() {
    if (!this.record) return;
    const kind = this.armedFor;
    this.armedFor = null;
    if (kind === "connectTimeout") {
      await this.dispatch(applyMatchMessage(this.record, { type: "connectTimeout" }, Date.now()));
      return;
    }
    if (kind === "dropTimeout") {
      const side = this.record.disconnectedAt.offense !== null ? "offense" : "defense";
      await this.dispatch(applyMatchMessage(this.record, { type: "dropTimeout", side }, Date.now()));
      return;
    }
    await this.dispatch(applyMatchMessage(this.record, { type: "alarm" }, Date.now()));
  }
  /** Arm the one alarm, remembering what it is for. */
  async arm(at, kind) {
    if (this.armedFor === kind && this.armedAt === at) return;
    await this.state.storage.setAlarm(at);
    this.armedFor = kind;
    this.armedAt = at;
  }
  async dispatch({ record, messages }) {
    this.record = record;
    for (const m of messages) {
      const ws = this.sockets[m.to];
      if (ws) ws.send(JSON.stringify(m));
    }
    if (record.status === "over") {
      await this.state.storage.deleteAlarm();
      this.armedFor = null;
      this.armedAt = null;
      return;
    }
    const next = nextAlarm(record);
    if (next) await this.arm(next.at, next.kind);
  }
};

// worker/index.js
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/lobby") {
      const variant = url.searchParams.get("variant");
      if (variant !== "7" && variant !== "11") return new Response("bad variant", { status: 400 });
      const id = env.LOBBY.idFromName(variant);
      const stub = env.LOBBY.get(id);
      return stub.fetch(request);
    }
    if (url.pathname.startsWith("/match/")) {
      const matchId = url.pathname.slice("/match/".length);
      if (!matchId) return new Response("bad match id", { status: 400 });
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ueA0xx/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ueA0xx/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  LobbyDO,
  MatchDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
