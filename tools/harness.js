/**
 * The training harness, unchanged for every caller — the code itself now lives
 * in lib/game/train/harness.js so that app/train-worker.js can run the very
 * same loop the CLI trainers run. The deploy workflow copies index.html, app/
 * and lib/ to GitHub Pages and never tools/, which is the whole reason.
 *
 * Kept as a file rather than deleted so that every existing import path — the
 * other trainers, test/tools/harness.test.js — still resolves.
 */
export * from '../lib/game/train/harness.js';
