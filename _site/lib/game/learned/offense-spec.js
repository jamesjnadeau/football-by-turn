/**
 * Every number the learned offense may tune. Same conventions as
 * defense-spec.js: formation inits are the '7' roster itself, so an
 * untrained genome fields the game's own offense.
 *
 * The formation ranges are where legality lives (see the Global Constraints
 * of the plan that built this): the five line players' `down` can never
 * leave [-1.8, -0.5], which keeps them inside ON_LINE_YARDS (2) — so every
 * formation any training run can express passes formationFoul. Backfield
 * `down` tops out at -0.5: nobody may learn to line up offside.
 */

const F = [];

// The line five: on the line by construction.
const LINE = [
  ['o-c', 0], ['o-lg', -2.5], ['o-rg', 2.5], ['o-wr1', -15], ['o-wr2', 15],
];
for (const [id, across] of LINE) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: -1.8, max: -0.5, init: -1 });
}
// The backfield.
F.push(
  { key: 'pos:o-qb:across', min: -24, max: 24, init: 0 },
  { key: 'pos:o-qb:down', min: -8, max: -2.5, init: -4 },
  { key: 'pos:o-rb:across', min: -24, max: 24, init: 0 },
  { key: 'pos:o-rb:down', min: -10, max: -4, init: -7 },
);

F.push(
  // Run/pass logit: pass when bias + wDown·down + wToGo·toGo + wBox·box > 0.
  // Bias starts firmly negative — an untrained genome runs the option, the
  // play the scripted autoplan already proved out.
  { key: 'call:bias', min: -4, max: 4, init: -2 },
  { key: 'call:down', min: -4, max: 4, init: 0 },
  { key: 'call:toGo', min: -4, max: 4, init: 1 },
  { key: 'call:box', min: -4, max: 4, init: 1 },
  // The run: which side, how wide the read is (OPTION_READ_UNITS as a
  // learnable, in units), how hard the runners lean off straight upfield.
  { key: 'run:sideBias', min: -2, max: 2, init: 0.5 },
  { key: 'run:read', min: 0, max: 12, init: 6 },
  { key: 'run:lean', min: 0.2, max: 2, init: 0.5 },
  // The pass: how open is open enough, how many turns the QB will wait,
  // and how hard he drops back at the snap.
  { key: 'throw:go', min: -20, max: 40, init: 8 },
  { key: 'throw:hold', min: 1, max: 4, init: 3 },
  { key: 'qb:drop', min: 0.2, max: 1, init: 0.6 },
  // Receiver scoring, all in yards: separation from the nearest defender,
  // progress downfield, and throw distance (a cost, so its range is <= 0).
  { key: 'tgt:sep', min: 0, max: 3, init: 1 },
  { key: 'tgt:depth', min: -2, max: 2, init: 0.5 },
  { key: 'tgt:dist', min: -2, max: 0, init: -0.3 },
);

// Routes: degrees off straight upfield (positive bends right), one angle for
// the release turn and one for every turn after.
for (const [id, deg0, degLate] of [
  ['o-wr1', -20, 0], ['o-wr2', 20, 0], ['o-rb', 0, 30],
]) {
  F.push({ key: `route:${id}:deg0`, min: -80, max: 80, init: deg0 });
  F.push({ key: `route:${id}:degLate`, min: -80, max: 80, init: degLate });
}

export const OFFENSE_SPEC = F;
export const OFFENSE_VARIANT = '7';
