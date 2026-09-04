/**
 * Socket and alarm plumbing over worker/match-engine.js's pure state
 * machine. One instance per match, named by match id. Everything that is a
 * DECISION lives in match-engine.js and is tested there.
 *
 * A Durable Object's alarm is one-shot and global to the instance, so this
 * shell has to remember which KIND of deadline it last armed
 * ('clock' | 'connectTimeout' | 'dropTimeout') to know which message the
 * alarm firing should turn into -- the pure record has no business knowing
 * about DO alarm semantics, so that tracking lives here, not on it.
 *
 * WHICH deadline is next, though, is the engine's to say: nextAlarm reads it
 * off the record, and dispatch re-arms after every message. Arming only at
 * the moments that seemed to need it is what left a started match with no
 * alarm at all -- the huddle clock was set on the record and never given to
 * one, so nothing was ever coming to end a turn nobody committed.
 */
import { createMatch, applyMatchMessage, nextAlarm, CONNECT_TIMEOUT_MS } from './match-engine.js';

export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = { offense: null, defense: null };
    this.record = null;
    this.armedFor = null;
    this.armedAt = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/create') {
      const { matchId, variant, seed, tokens } = await request.json();
      this.record = createMatch({ matchId, variant, seed, tokens });
      // The one deadline nextAlarm cannot name: a waiting match has none of
      // its own, and this is the spec's timeout for one nobody completes.
      await this.arm(Date.now() + CONNECT_TIMEOUT_MS, 'connectTimeout');
      return new Response('ok');
    }

    const side = url.searchParams.get('side');
    const token = url.searchParams.get('token');
    if ((side !== 'offense' && side !== 'defense') || !this.record) {
      return new Response('bad request', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // A coach whose seat is being held is coming BACK, and the engine's
    // reconnect is what gives him his board and his clock again; a plain
    // connect would refuse him as already connected. Everyone else is
    // connecting for the first time.
    const returning = this.record.status === 'paused' && this.record.disconnectedAt[side] !== null;
    const result = applyMatchMessage(
      this.record, { type: returning ? 'reconnect' : 'connect', side, token }, Date.now(),
    );
    // The engine decides who is seated; this shell only seats the socket the
    // engine accepted. A refused socket -- a wrong token, or a second tab
    // opening a seat that is already taken -- is answered on itself and
    // closed, and never takes the seated coach's place in `sockets`: doing
    // that would have cut a live coach off from every message that followed
    // on the strength of a token that was wrong.
    if (result.messages.some((m) => m.to === side && m.type === 'refused')) {
      try { server.send(JSON.stringify({ type: 'refused' })); } catch { /* already gone */ }
      server.close(1008, 'refused');
      return new Response(null, { status: 101, webSocket: client });
    }
    // The same coach on a new socket (the engine accepted his token on a
    // seat it still had as taken): the old socket is dead or superseded, and
    // closing it here is what keeps its late close from being read as a
    // disconnect -- onClose only listens to the seated socket.
    const superseded = this.sockets[side];
    this.sockets[side] = server;
    if (superseded) try { superseded.close(1000, 'superseded'); } catch { /* already gone */ }
    server.addEventListener('message', (ev) => this.onMessage(side, server, ev));
    server.addEventListener('close', () => this.onClose(side, server));
    await this.dispatch(result);
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(side, server, ev) {
    if (this.sockets[side] !== server) return; // a socket that is no longer the seated one
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'commit') {
      this.dispatch(applyMatchMessage(
        this.record, { type: 'commit', side, turnIndex: msg.turnIndex, play: msg.play }, Date.now(),
      ));
    }
  }

  onClose(side, server) {
    // Only the seated socket closing empties the seat: a superseded one
    // closing late must not unseat the coach who replaced it.
    if (this.sockets[side] !== server) return;
    this.sockets[side] = null;
    this.dispatch(applyMatchMessage(this.record, { type: 'disconnect', side }, Date.now()));
  }

  async alarm() {
    if (!this.record) return;
    const kind = this.armedFor;
    this.armedFor = null;
    if (kind === 'connectTimeout') {
      await this.dispatch(applyMatchMessage(this.record, { type: 'connectTimeout' }, Date.now()));
      return;
    }
    if (kind === 'dropTimeout') {
      const side = this.record.disconnectedAt.offense !== null ? 'offense' : 'defense';
      await this.dispatch(applyMatchMessage(this.record, { type: 'dropTimeout', side }, Date.now()));
      return;
    }
    // dispatch re-arms from the record, so there is nothing to do here after
    // it but let it.
    await this.dispatch(applyMatchMessage(this.record, { type: 'alarm' }, Date.now()));
  }

  /** Arm the one alarm, remembering what it is for. */
  async arm(at, kind) {
    if (this.armedFor === kind && this.armedAt === at) return;
    await this.state.storage.setAlarm(at);
    this.armedFor = kind;
    this.armedAt = at;
  }

  async dispatch({ record, messages }) {
    this.record = record;
    for (const m of messages) {
      const ws = this.sockets[m.to];
      // A socket the browser already dropped throws on send; one such throw
      // must not leave the other coach's message unsent or the alarm unarmed.
      if (ws) try { ws.send(JSON.stringify(m)); } catch { /* its close event is on its way */ }
    }
    if (record.status === 'over') {
      // Nothing left to referee. Deleting the alarm is enough to let the
      // instance go quiet and eventually evict; there is no explicit
      // "destroy a Durable Object" call to make.
      await this.state.storage.deleteAlarm();
      this.armedFor = null;
      this.armedAt = null;
      return;
    }
    // Every message, not just the ones that look like they move a deadline:
    // the clock the huddle set, the flush window, the drop grace and the
    // clock a returning coach resumes are all just "what the record says now".
    const next = nextAlarm(record);
    if (next) await this.arm(next.at, next.kind);
  }
}
