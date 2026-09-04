/**
 * What this particular build of the site can do. One flag, and it exists
 * because the game is published twice: from the Cloudflare Worker, which
 * carries the lobby and the match objects, and from GitHub Pages, which is
 * the same files with nothing behind them.
 *
 * The value here is the development answer — `npm run serve` and
 * `wrangler dev` both want the whole game. `tools/build-site.js --no-multiplayer`
 * overwrites this file inside `_site` on its way to Pages, which is the only
 * place the answer is ever `false`. Nothing else in the build is rewritten,
 * so a coach reading the source sees the file the browser actually loaded.
 */
export const MULTIPLAYER = true;
