#!/usr/bin/env node
/**
 * Assembles `_site`: exactly what the browser actually loads, copied out of
 * the repo so publishing is from a directory rather than from a git branch.
 * It runs identically on a laptop (for `wrangler dev`) and in CI -- see the
 * spec's "Hosting and deployment" section.
 *
 * The site is published twice, and `--no-multiplayer` is the difference
 * between the two. The Worker build carries the lobby; the GitHub Pages build
 * is the same files with no Worker behind them, so it is assembled with the
 * flag off and its home screen never offers a game it cannot deal. The flag
 * is applied by overwriting app/build-config.js in the OUTPUT only: the source
 * tree is never edited by a build, and nothing else is rewritten.
 *
 * The work is a function rather than a script body so a test can build into a
 * directory of its own and read what came out, the same discipline the markup
 * modules follow in returning strings rather than touching a page.
 */
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

export function buildSite({ out = join(ROOT, '_site'), multiplayer = true } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(join(ROOT, 'index.html'), join(out, 'index.html'));
  cpSync(join(ROOT, 'app'), join(out, 'app'), { recursive: true });
  cpSync(join(ROOT, 'lib'), join(out, 'lib'), { recursive: true });
  if (!multiplayer) {
    writeFileSync(join(out, 'app', 'build-config.js'),
      '// Written by tools/build-site.js --no-multiplayer: this copy of the\n'
      + '// site is published with no Worker behind it, so it does not offer\n'
      + '// a lobby. See app/build-config.js in the repository.\n'
      + 'export const MULTIPLAYER = false;\n');
  }
  writeFileSync(join(out, '.nojekyll'), '');
  return out;
}

// Only when run as a command, so importing this in a test assembles nothing.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const multiplayer = !process.argv.includes('--no-multiplayer');
  buildSite({ multiplayer });
  console.log(`_site assembled${multiplayer ? '' : ', without multiplayer'}.`);
}
