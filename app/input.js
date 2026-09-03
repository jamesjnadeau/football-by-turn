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
 *
 * A second job lives here too: touch-only pan and pinch-zoom on empty field.
 * It is tracked entirely separately from the player-drag `log` above — a
 * touch pointerdown that hits a target (a player OR the loft handle) always
 * starts a draw gesture, exactly as before, and never joins pan/pinch
 * tracking; a touch pointerdown that doesn't hit anything joins pan/pinch
 * tracking and never starts a draw gesture. The two cannot mix mid-gesture: a
 * second finger touching down while a draw is in flight is ignored (the draw
 * already holds pointer capture), so pinch can only start from two fingers
 * that both began on empty field.
 */
import { classifyGesture } from '../lib/game/gesture.js';

function dist(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function mid(a, b) {
  return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
}

export function attachInput(board, {
  hitTest, onGesture, onDragPreview, onLoftDragPreview, onLoftDrag, onPan, onPinch,
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

  // Touch pointers currently down on empty field, keyed by pointerId, holding
  // only what pan/pinch math needs: the last known screen position. A draw
  // gesture's pointer never appears here (see the module comment).
  const touches = new Map();
  // The two-finger distance as of the last pinch update, so each move reports
  // a delta rather than an absolute scale the caller would have to remember.
  let pinchDist = null;

  board.on('pointerdown', (e) => {
    // A second (or third) finger joining an in-flight player-drag is ignored:
    // the draw already holds pointer capture, and pinch/pan may only start
    // from fingers that both began on empty field.
    if (log) return;

    if (e.pointerType === 'touch' && touches.size === 1) {
      touches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      board.node.setPointerCapture(e.pointerId);
      pinchDist = dist(...touches.values());
      e.preventDefault();
      return;
    }
    if (touches.size > 0) return; // a third finger: ignored, not tracked

    if (e.pointerType === 'touch' && !hitTest(board.point(e.clientX, e.clientY))) {
      touches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      board.node.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    const p = board.point(e.clientX, e.clientY);
    target = hitTest(p);
    if (!target) return;
    log = [{ t: e.timeStamp, ...p }];
    board.node.setPointerCapture(e.pointerId); // pointer capture has no SVG.js wrapper; use the raw node
    e.preventDefault();
  });

  board.on('pointermove', (e) => {
    if (touches.has(e.pointerId)) {
      const prev = touches.get(e.pointerId);
      touches.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (touches.size === 1) {
        // Screen pixels -> SVG units via two board.point() reads rather than a
        // single conversion, so this stays correct under whatever CSS scaling
        // the board is currently displayed at.
        const a = board.point(prev.clientX, prev.clientY);
        const b = board.point(e.clientX, e.clientY);
        onPan(b.x - a.x, b.y - a.y);
      } else if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = dist(a, b);
        const anchor = board.point(mid(a, b).clientX, mid(a, b).clientY);
        if (pinchDist) onPinch(d / pinchDist, anchor);
        pinchDist = d;
      }
      return;
    }
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    if (typeof target === 'object') { onLoftDragPreview(target.loft, log); return; }
    onDragPreview(target, log, lastTapAt.get(target) ?? null);
  });

  board.on('pointerup', (e) => {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      pinchDist = touches.size === 2 ? dist(...touches.values()) : null;
      return;
    }
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

  board.on('pointercancel', (e) => {
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      pinchDist = null;
      return;
    }
    if (typeof target === 'string') lastTapAt.delete(target); // a cancelled gesture disarms, like any other non-tap
    log = null;
    target = null;
    onDragPreview(null, null, null);
  });
}
