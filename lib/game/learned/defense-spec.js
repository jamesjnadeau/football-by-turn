/**
 * Every number the learned defense may tune, with its legal range and its
 * starting value. The formation inits are the '7' roster's own alignment
 * (rosters.js), so an untrained genome plays the defense the game already
 * fields; training is a walk away from a known-good posture, not from noise.
 *
 * Formation keys are per-id and therefore per-variant; the brain's weight
 * keys (cov:*, scheme:*, zone:*) are variant-agnostic in meaning even though
 * zone anchors are keyed by id too — an id the field doesn't hold simply
 * contributes nothing (see defense-policy.js and learned/formation.js).
 */

const F = [];

// Starting spots: across (yards from the field middle, negative left) and
// down (yards past the line of scrimmage — min 0.5 keeps every learnable spot
// on the defense's own side; formation.js's spotFault refuses the other side).
const SPOTS = [
  ['d-nt', 0, 1], ['d-dt1', -2.5, 1], ['d-dt2', 2.5, 1],
  ['d-cb1', -15, 2], ['d-cb2', 15, 2], ['d-lb', 0, 4], ['d-s', 0, 8],
];
for (const [id, across, down] of SPOTS) {
  F.push({ key: `pos:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `pos:${id}:down`, min: 0.5, max: 12, init: down });
}

// Zone anchors for the four coverage bodies: where each man's zone lives,
// as an across/depth offset from the ball's line of scrimmage.
const ZONES = [
  ['d-cb1', -12, 4], ['d-cb2', 12, 4], ['d-lb', 0, 3], ['d-s', 0, 9],
];
for (const [id, across, depth] of ZONES) {
  F.push({ key: `zone:${id}:across`, min: -24, max: 24, init: across });
  F.push({ key: `zone:${id}:depth`, min: 1, max: 15, init: depth });
}

F.push(
  // Man-assignment cost weights: cost = dist·wDist + depth·wDepth + width·wWidth
  // (all in yards; see defense-policy.js). dist-only at init reproduces
  // defense.js's own nearest-pair greedy.
  { key: 'cov:dist', min: 0, max: 3, init: 1 },
  { key: 'cov:depth', min: -2, max: 2, init: 0 },
  { key: 'cov:width', min: -2, max: 2, init: 0 },
  // The man/zone gate's logit: zone when
  // bias + wDown·down + wToGo·toGo + wSpread·spread > 0.
  // Bias starts firmly negative: an untrained genome plays man, the coverage
  // the game already knows how to play.
  { key: 'scheme:bias', min: -4, max: 4, init: -2 },
  { key: 'scheme:down', min: -4, max: 4, init: 0 },
  { key: 'scheme:toGo', min: -4, max: 4, init: 0 },
  { key: 'scheme:spread', min: -4, max: 4, init: 0 },
);

export const DEFENSE_SPEC = F;
export const DEFENSE_VARIANT = '7';
