/**
 * The genome bundle: one trained genome as plain JSON, the only thing that
 * crosses between a coach's browser and this repository.
 *
 * JSON and never a JS module, because it travels: a stranger sends the
 * maintainer a file, and a file that is source code is a file that runs. The
 * generated *-genome.js modules stay what they are — the trainers write them
 * on the way IN (see tools/import-genome.js), and nothing outside this repo
 * ever writes one.
 *
 * parseBundle is deliberately unforgiving about `values`: they must clamp
 * IDEMPOTENTLY against the side's own spec — every key the spec names, all
 * finite, all already inside their range, and nothing else. Quietly clamping a
 * stranger's genome would ship a genome nobody trained; a bundle that does not
 * fit this build's spec is a bundle from a different build, and the honest
 * answer is to say so.
 *
 * Pure, like coach-log.js and playbook.js: this file knows what a bundle IS.
 * app/genome-store.js knows where one is kept, and tools/import-genome.js
 * knows what to do with one that arrives.
 */
import { clampGenome } from '../learned/genome.js';
import { DEFENSE_SPEC, DEFENSE_VARIANT } from '../learned/defense-spec.js';
import { OFFENSE_SPEC, OFFENSE_VARIANT } from '../learned/offense-spec.js';

export const BUNDLE_KIND = 'football-by-turn-genome';
export const BUNDLE_VERSION = 1;

/** The spec a side's genome is governed by, and the variant it is written
 *  for — null for anything that is not a side of the ball. */
export function specForSide(side) {
  if (side === 'defense') return { spec: DEFENSE_SPEC, variant: DEFENSE_VARIANT };
  if (side === 'offense') return { spec: OFFENSE_SPEC, variant: OFFENSE_VARIANT };
  return null;
}

/**
 * Package a trained genome. The values are clamped on the way in, so a bundle
 * this repository produces always satisfies the check parseBundle applies to
 * one it receives.
 */
export function makeBundle({ side, values, meta = {} }) {
  const sided = specForSide(side);
  if (!sided) throw new Error(`unknown side "${side}"`);
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    side,
    variant: sided.variant,
    values: clampGenome(sided.spec, values),
    meta: { ...meta },
  };
}

/** Indented on purpose: the coach who is about to email this can read it. */
export function serializeBundle(bundle) {
  return JSON.stringify(bundle, null, 2);
}

/** Why these values are not this spec's values, or null when they are. */
function valuesFault(spec, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return 'values is not an object';
  }
  // Check if the prototype has been tampered with (e.g., __proto__ set to non-object)
  if (Object.getPrototypeOf(values) !== Object.prototype) {
    return 'values has "__proto__" pointing to something other than Object.prototype';
  }
  const named = new Set(spec.map((p) => p.key));
  // Object.getOwnPropertyNames catches all own properties including "__proto__"
  // which could arrive from JSON or be set as a property directly.
  const stray = Object.getOwnPropertyNames(values).find((k) => !named.has(k));
  if (stray !== undefined) return `values holds "${stray}", which the spec does not name`;
  const clamped = clampGenome(spec, values);
  for (const p of spec) {
    const v = values[p.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return `values is missing a finite number for "${p.key}"`;
    }
    if (v !== clamped[p.key]) {
      return `values["${p.key}"] is outside the spec's [${p.min}, ${p.max}]`;
    }
  }
  return null;
}

/**
 * Whatever arrived, as a bundle — or a reason it is not one. `{bundle}` on
 * success and `{error}` on failure rather than a throw, because both callers
 * have something better to do with the reason than crash: the CLI prints it
 * and exits 1, and the store treats it as "no saved genome".
 */
export function parseBundle(text) {
  if (typeof text !== 'string' || text === '') return { error: 'no bundle text' };
  // Reject JSON that includes __proto__ as a key for security
  if (text.includes('"__proto__"')) return { error: 'values holds "__proto__", which the spec does not name' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'not JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'not a JSON object' };
  }
  if (raw.kind !== BUNDLE_KIND) return { error: `kind is not "${BUNDLE_KIND}"` };
  if (raw.version !== BUNDLE_VERSION) return { error: `version is not ${BUNDLE_VERSION}` };
  const sided = specForSide(raw.side);
  if (!sided) return { error: 'side is not "defense" or "offense"' };
  if (raw.variant !== sided.variant) {
    return { error: `variant is not "${sided.variant}", the only game the ${raw.side} spec is written for` };
  }
  const fault = valuesFault(sided.spec, raw.values);
  if (fault) return { error: fault };
  // Meta is a stranger's free text: carried, never trusted, never read for
  // anything but printing. A meta that is not an object is simply absent.
  const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
    ? raw.meta : {};
  return {
    bundle: {
      kind: BUNDLE_KIND,
      version: BUNDLE_VERSION,
      side: raw.side,
      variant: raw.variant,
      // Rebuilt through clampGenome rather than handed over: the result is a
      // fresh object with exactly the spec's keys and no inherited surprises.
      values: clampGenome(sided.spec, raw.values),
      meta: { ...meta },
    },
  };
}
