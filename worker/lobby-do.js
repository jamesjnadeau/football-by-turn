/**
 * Socket and alarm plumbing over worker/lobby-engine.js's pure pairing logic.
 * One instance per variant (the Worker names the instance by variant id --
 * see index.js). Everything that is actually a DECISION lives in
 * lobby-engine.js and is tested there; this file only turns WebSocket events
 * into calls into it and its messages back into WebSocket sends.
 */
import { createLobby, applyLobbyMessage } from './lobby-engine.js';

/**
 * A send that cannot take the dispatch down with it. A socket the browser has
 * already dropped throws on send ("Network connection lost"), and one thrown
 * send inside dispatch's loop would leave every later message unsent -- the
 * other coach's included.
 */
function safeSend(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* the close event is on its way */ }
}

export class LobbyDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map(); // connection id -> WebSocket
    this.record = createLobby();
    this.variant = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const side = url.searchParams.get('side');
    if (side !== 'offense' && side !== 'defense') return new Response('bad side', { status: 400 });
    // LobbyDO is one instance per variant (spec) -- the first request into a
    // fresh instance is what names it, since index.js routes by variant id
    // but never tells the DO instance its own name directly.
    this.variant ??= url.searchParams.get('variant');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = crypto.randomUUID();
    this.sockets.set(id, server);

    server.addEventListener('message', (ev) => this.onMessage(id, ev));
    // Both, and for the same handler. A socket that dies badly -- a killed
    // tab, a sleeping laptop, a phone changing network -- raises `error`, and
    // some of those never raise `close` at all. Listening only for `close` is
    // what left this coach's id in the queue to be paired with as a ghost.
    server.addEventListener('close', () => this.onClose(id));
    server.addEventListener('error', () => this.onClose(id));

    // Before the join, so a ghost at the head of a queue is gone before this
    // coach can be paired with it rather than after.
    await this.sweep();
    await this.dispatch(applyLobbyMessage(this.record, { type: 'join', id, side }));
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(id, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'switch') this.dispatch(applyLobbyMessage(this.record, { type: 'switch', id }));
  }

  onClose(id) {
    // `close` and `error` can both arrive for the same socket, and a coach
    // who has already been matched is no longer in a queue at all -- so this
    // has to be safe to run twice. It is: deleting a key that is gone is a
    // no-op, and lobby-engine's `leave` returns no messages when the id was
    // not queued.
    if (!this.sockets.delete(id)) return;
    this.dispatch(applyLobbyMessage(this.record, { type: 'leave', id }));
  }

  /** Whether `id`'s socket is one this DO can still send on. */
  isLive(id) {
    const ws = this.sockets.get(id);
    // 1 is OPEN. A socket that is closing or closed can still be handed to
    // send() without throwing, which is exactly how a ghost went unnoticed.
    return !!ws && ws.readyState === 1;
  }

  /**
   * Drop queued coaches whose sockets are gone. Runs before every join, which
   * is the only moment a ghost can do any harm: pairing happens on a join, so
   * a queue that is clean going into one cannot pair anybody with a ghost.
   */
  async sweep() {
    for (const [id, ws] of this.sockets) if (ws.readyState !== 1) this.sockets.delete(id);
    const live = [...this.sockets.keys()];
    await this.dispatch(applyLobbyMessage(this.record, { type: 'sweep', live }));
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
    const matchedPair = messages.filter((m) => m.type === 'matched');
    // The sweep makes this rare; it does not make it impossible. A socket can
    // die in the moment between the sweep that kept it and the pairing that
    // popped it, and a match minted for a pair with only one live coach in it
    // is the ghost bug all over again -- so the survivor goes back to the
    // FRONT of his queue (he has waited longest) and no match is created.
    if (matchedPair.length === 2 && !matchedPair.every((m) => this.isLive(m.to))) {
      let requeued = record;
      for (const m of matchedPair) {
        if (this.isLive(m.to)) requeued = { ...requeued, [m.side]: [m.to, ...requeued[m.side]] };
        else this.sockets.delete(m.to);
      }
      this.record = requeued;
      const depth = {
        to: 'broadcast', type: 'queued',
        offense: requeued.offense.length, defense: requeued.defense.length,
      };
      for (const ws of this.sockets.values()) safeSend(ws, depth);
      return;
    }
    let tokens = null;
    let matchId = null;
    if (matchedPair.length === 2) {
      matchId = crypto.randomUUID();
      tokens = { offense: crypto.randomUUID(), defense: crypto.randomUUID() };
      const stub = this.env.MATCH.get(this.env.MATCH.idFromName(matchId));
      await stub.fetch('https://match/create', {
        method: 'POST',
        body: JSON.stringify({ matchId, variant: this.variant, seed: (Math.random() * 2 ** 31) | 0, tokens }),
      });
    }
    for (const m of messages) {
      if (m.to === 'broadcast') {
        for (const ws of this.sockets.values()) safeSend(ws, m);
        continue;
      }
      // lobby-engine's `matched` messages carry the CONNECTION id as `to`
      // (that is the id space this DO minted); a matched coach also gets a
      // per-player token and the match id is what he opens /match/<id> with.
      const ws = this.sockets.get(m.to);
      if (!ws) continue;
      if (m.type === 'matched') {
        safeSend(ws, { ...m, matchId, token: tokens[m.side] });
      } else {
        safeSend(ws, m);
      }
    }
  }
}
