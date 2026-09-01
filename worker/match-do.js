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
 */
import { createMatch, applyMatchMessage } from './match-engine.js';

export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = { offense: null, defense: null };
    this.record = null;
    this.armedFor = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/create') {
      const { matchId, variant, seed, tokens } = await request.json();
      this.record = createMatch({ matchId, variant, seed, tokens });
      // 15 seconds for a match nobody joins -- spec's connect timeout.
      await this.state.storage.setAlarm(Date.now() + 15_000);
      this.armedFor = 'connectTimeout';
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
    this.sockets[side] = server;
    server.addEventListener('message', (ev) => this.onMessage(side, ev));
    server.addEventListener('close', () => this.onClose(side));

    await this.dispatch(applyMatchMessage(this.record, { type: 'connect', side, token }, Date.now()));
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(side, ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'commit') {
      this.dispatch(applyMatchMessage(
        this.record, { type: 'commit', side, turnIndex: msg.turnIndex, play: msg.play }, Date.now(),
      ));
    }
  }

  onClose(side) {
    this.sockets[side] = null;
    this.dispatch(applyMatchMessage(this.record, { type: 'disconnect', side }, Date.now()));
  }

  async alarm() {
    if (!this.record) return;
    const kind = this.armedFor;
    this.armedFor = null;
    if (kind === 'connectTimeout') {
      this.dispatch(applyMatchMessage(this.record, { type: 'connectTimeout' }, Date.now()));
      return;
    }
    if (kind === 'dropTimeout') {
      const side = this.record.disconnectedAt.offense !== null ? 'offense' : 'defense';
      this.dispatch(applyMatchMessage(this.record, { type: 'dropTimeout', side }, Date.now()));
      return;
    }
    this.dispatch(applyMatchMessage(this.record, { type: 'alarm' }, Date.now()));
    if (this.record.status === 'active') {
      const next = this.record.flushDeadlineAt ?? this.record.deadlineAt;
      await this.state.storage.setAlarm(next);
      this.armedFor = 'clock';
    }
  }

  async dispatch({ record, messages }) {
    this.record = record;
    for (const m of messages) {
      const ws = this.sockets[m.to];
      if (ws) ws.send(JSON.stringify(m));
      if (m.type === 'opponentGone') {
        await this.state.storage.setAlarm(Date.now() + 20_000);
        this.armedFor = 'dropTimeout';
      }
      if (m.type === 'opponentBack') {
        await this.state.storage.setAlarm(record.deadlineAt);
        this.armedFor = 'clock';
      }
    }
    if (record.status === 'over') {
      // Nothing left to referee. Deleting the alarm is enough to let the
      // instance go quiet and eventually evict; there is no explicit
      // "destroy a Durable Object" call to make.
      await this.state.storage.deleteAlarm();
      this.armedFor = null;
    }
  }
}
