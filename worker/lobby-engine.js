/**
 * One variant's lobby: two FIFO queues (offense, defense) and the rule that
 * pairs them. No sockets, no timers, no platform API -- LobbyDO (worker/
 * lobby-do.js) is the thin shell that turns these messages into real
 * WebSocket traffic and mints match ids and tokens. Everything here is a
 * plain function of (record, message) -> (new record, messages to send), the
 * same discipline lib/game/home.js's markup and lib/game/turn.js's runTurn
 * both already follow.
 */

export function createLobby() {
  return { offense: [], defense: [] };
}

const OTHER = { offense: 'defense', defense: 'offense' };

function depthMessage(record) {
  return { to: 'broadcast', type: 'queued', offense: record.offense.length, defense: record.defense.length };
}

/**
 * If both queues have a waiter, pop the oldest of each and match them. Runs
 * after every join/switch, because either one can be the move that makes
 * both queues non-empty at once.
 */
function maybePair(record) {
  if (record.offense.length === 0 || record.defense.length === 0) return { record, messages: [] };
  const [offenseId, ...restOffense] = record.offense;
  const [defenseId, ...restDefense] = record.defense;
  const matchId = `${offenseId}:${defenseId}:${Date.now()}`;
  return {
    record: { offense: restOffense, defense: restDefense },
    messages: [
      { to: offenseId, type: 'matched', matchId, side: 'offense' },
      { to: defenseId, type: 'matched', matchId, side: 'defense' },
    ],
  };
}

function removeFrom(record, id) {
  return {
    offense: record.offense.filter((x) => x !== id),
    defense: record.defense.filter((x) => x !== id),
  };
}

/**
 * Drop every queued coach whose socket is no longer live, then pair whoever
 * is left.
 *
 * A queue entry is a promise that there is a coach on the other end of it,
 * and a WebSocket does not always keep that promise: a tab that is killed, a
 * laptop that sleeps, a phone that changes network all leave a socket the
 * runtime has not yet told anyone about, and a `close` event that never
 * arrives is an id that waits in this queue for ever. The next coach to
 * arrive is then paired with a ghost -- he is told `matched`, he opens the
 * match, and nobody is ever going to connect to the other seat. That is one
 * coach's whole game lost to a browser that closed badly, and it is worse
 * than it sounds, because the ghost stays at the head of the queue and eats
 * the coach after him too.
 *
 * `live` is the ids whose sockets the shell can still see. Sweeping is
 * therefore something only the shell can ask for -- it is the only thing that
 * knows what a socket is -- but WHAT a sweep does to the queues is a pairing
 * decision like any other, so it lives here with them and is tested here.
 *
 * Pairing runs after the sweep, because dropping a ghost can be the very
 * thing that leaves a real coach at the head of each queue.
 */
export function applyLobbyMessage(record, message) {
  if (message.type === 'sweep') {
    const live = new Set(message.live);
    const kept = {
      offense: record.offense.filter((id) => live.has(id)),
      defense: record.defense.filter((id) => live.has(id)),
    };
    // Nothing to say when nothing was stale: a sweep runs before every join,
    // so the quiet case is the common one and it must not broadcast a depth
    // that has not changed.
    if (kept.offense.length === record.offense.length
      && kept.defense.length === record.defense.length) {
      return { record, messages: [] };
    }
    const paired = maybePair(kept);
    return {
      record: paired.record,
      messages: paired.messages.length > 0 ? paired.messages : [depthMessage(paired.record)],
    };
  }
  if (message.type === 'join') {
    const withJoin = { ...removeFrom(record, message.id) };
    withJoin[message.side] = [...withJoin[message.side], message.id];
    const paired = maybePair(withJoin);
    const messages = paired.messages.length > 0
      ? paired.messages
      : [depthMessage(paired.record)];
    return { record: paired.record, messages };
  }
  if (message.type === 'switch') {
    const inOffense = record.offense.includes(message.id);
    const inDefense = record.defense.includes(message.id);
    if (!inOffense && !inDefense) return { record, messages: [] };
    const side = inOffense ? 'defense' : 'offense';
    return applyLobbyMessage(removeFrom(record, message.id), { type: 'join', id: message.id, side });
  }
  if (message.type === 'leave') {
    const next = removeFrom(record, message.id);
    if (next.offense.length === record.offense.length && next.defense.length === record.defense.length) {
      return { record, messages: [] };
    }
    return { record: next, messages: [depthMessage(next)] };
  }
  return { record, messages: [] };
}
