/**
 * The Worker's only routes. Everything else falls through to the static
 * assets binding -- the game is still a page the browser loads; this is a
 * referee it talks to over two paths.
 */
export { LobbyDO } from './lobby-do.js';
export { MatchDO } from './match-do.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/lobby') {
      const variant = url.searchParams.get('variant');
      if (variant !== '7' && variant !== '11') return new Response('bad variant', { status: 400 });
      const id = env.LOBBY.idFromName(variant);
      const stub = env.LOBBY.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/match/')) {
      const matchId = url.pathname.slice('/match/'.length);
      if (!matchId) return new Response('bad match id', { status: 400 });
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
