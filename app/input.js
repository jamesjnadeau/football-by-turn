/**
 * Pointer plumbing built on the vendored SVG.js wrapper: `board.point()`
 * converts a pointer event's screen coordinates into the board's local SVG
 * coordinates (replacing hand-rolled createSVGPoint/getScreenCTM math), and
 * `board.on()` wraps addEventListener. All decisions about what a gesture
 * MEANS live in lib/game/ — this file only observes and reports.
 *
 * `hitTest` returns one of three things: a player id, `null`, or `{ loft:
 * passerId }` — the one target in the game that is not a player, the
 * committed throw arrow's own tip. That third shape skips classifyGesture
 * entirely: a loft adjustment is not a run, a throw, or a stance toggle, it
 * has no direction or throttle of its own to classify, only how far the
 * pointer has travelled since it grabbed on. It is reported through its own
 * pair of callbacks, onLoftDragPreview/onLoftDrag, rather than being forced
 * through onDragPreview/onGesture's player-shaped contract.
 */
import { classifyGesture } from '../lib/game/gesture.js';

export function attachInput(board, {
  hitTest, onGesture, onDragPreview, onLoftDragPreview, onLoftDrag,
}) {
  let log = null;
  let target = null; // a player id (string), or { loft: passerId }
  // When each player was last tapped. A tap arms the NEXT gesture on that same
  // player: released in place it is a double tap (his special move), dragged
  // away it is a throw. Anything else disarms him, so a tap from ten seconds
  // ago can never turn a run into a throw. classifyGesture owns the timing
  // rule; this map only remembers the tap. The loft handle never touches it —
  // it has no double-tap concept of its own.
  const lastTapAt = new Map();

  board.on('pointerdown', (e) => {
    const p = board.point(e.clientX, e.clientY);
    target = hitTest(p);
    if (!target) return;
    log = [{ t: e.timeStamp, ...p }];
    board.node.setPointerCapture(e.pointerId); // pointer capture has no SVG.js wrapper; use the raw node
    e.preventDefault();
  });

  board.on('pointermove', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    if (typeof target === 'object') { onLoftDragPreview(target.loft, log); return; }
    onDragPreview(target, log, lastTapAt.get(target) ?? null);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    if (typeof target === 'object') {
      onLoftDrag(target.loft, log);
      log = null;
      target = null;
      return;
    }
    const gesture = classifyGesture(log, lastTapAt.get(target) ?? null);
    if (gesture.kind === 'click') lastTapAt.set(target, log[log.length - 1].t);
    else lastTapAt.delete(target);
    onGesture(target, gesture, p);
    log = null;
    target = null;
  });

  board.on('pointercancel', () => {
    if (typeof target === 'string') lastTapAt.delete(target);
    log = null;
    target = null;
    onDragPreview(null, null, null);
  });
}
