/**
 * Training, off the main thread.
 *
 * A training run is one to two seconds of solid arithmetic — a thousand-odd
 * simulated downs — and on the main thread that is a frozen board, a dead
 * menu, and a browser offering to kill the page. In a worker it is a progress
 * message every generation and a board that still scrolls.
 *
 * A worker has no localStorage and no DOM, so this file asks for nothing: the
 * page posts the whole job — the log, which genome to train, where to start
 * from, how big the run is, and the seed — and gets back one bundle. Every
 * number in the result is a function of that job, so the same job posted twice
 * produces the same genome twice.
 *
 * Spawned as a module worker (see app/main.js), which is what lets it import
 * lib/ directly; the deploy workflow copies lib/ to Pages, which is why the
 * trainer had to live there.
 */
import { trainVsGhost } from '../lib/game/train/vs-ghost.js';
import { makeBundle } from '../lib/game/train/bundle.js';

self.addEventListener('message', (e) => {
  const {
    log, side, generations, popSize, plays, sigma, seed, seedGenome,
    snapshots, exportedAt,
  } = e.data;
  const { best, score } = trainVsGhost({
    log,
    side,
    generations,
    popSize,
    plays,
    sigma,
    seed,
    seedGenome,
    onGeneration: (gen, scored) =>
      self.postMessage({ type: 'progress', gen, score: scored[0].score }),
  });
  self.postMessage({
    type: 'done',
    bundle: makeBundle({
      side,
      values: best,
      meta: {
        trainedBy: 'app/train-worker.js',
        generations,
        popSize,
        plays,
        sigma,
        seed,
        fitness: score,
        snapshots,
        // Stamped by the page, not read from a clock here: the training path
        // stays a pure function of the job it was given.
        exportedAt,
      },
    }),
  });
});
