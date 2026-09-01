#!/usr/bin/env node
/**
 * Assembles `_site`: exactly what the browser actually loads, copied out of
 * the repo so publishing is from a directory rather than from a git branch.
 * The one thing that changed from the old GitHub Pages build script is that
 * this now runs identically on a laptop (for `wrangler dev`) and in CI (for
 * `wrangler deploy`) -- see the spec's "Hosting and deployment" section.
 */
import { cpSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, '_site');

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
copyFileSync(join(ROOT, 'index.html'), join(SITE, 'index.html'));
cpSync(join(ROOT, 'app'), join(SITE, 'app'), { recursive: true });
cpSync(join(ROOT, 'lib'), join(SITE, 'lib'), { recursive: true });
writeFileSync(join(SITE, '.nojekyll'), '');
console.log('_site assembled.');
