/**
 * Pointer plumbing built on the vendored SVG.js wrapper: `board.point()`
 * converts a pointer event's screen coordinates into the board's local SVG
 * coordinates (replacing hand-rolled createSVGPoint/getScreenCTM math), and
 * `board.on()` wraps addEventListener. All decisions about what a gesture
 * MEANS live in lib/game/ — this file only observes and reports.
 */
import { classifyGesture } from '../lib/game/gesture.js';

export function attachInput(board, { hitTest, onGesture, onDragPreview }) {
  let log = null;
  let playerId = null;
  // When each player was last tapped. A tap arms the NEXT drag on that same
  // player as a throw (the spec's double-tap-then-drag); anything else disarms
  // him, so a tap from ten seconds ago can never turn a run into a throw.
  // classifyGesture owns the timing rule; this map only remembers the tap.
  const lastTapAt = new Map();

  board.on('pointerdown', (e) => {
    const p = board.point(e.clientX, e.clientY);
    playerId = hitTest(p);
    if (!playerId) return;
    log = [{ t: e.timeStamp, ...p }];
    board.node.setPointerCapture(e.pointerId); // pointer capture has no SVG.js wrapper; use the raw node
    e.preventDefault();
  });

  board.on('pointermove', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    onDragPreview(playerId, log, lastTapAt.get(playerId) ?? null);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    const gesture = classifyGesture(log, lastTapAt.get(playerId) ?? null);
    if (gesture.kind === 'click') lastTapAt.set(playerId, log[log.length - 1].t);
    else lastTapAt.delete(playerId);
    onGesture(playerId, gesture, p);
    log = null;
    playerId = null;
  });

  board.on('pointercancel', () => {
    if (playerId) lastTapAt.delete(playerId); // a cancelled gesture disarms, like any other non-tap
    log = null;
    playerId = null;
    onDragPreview(null, null, null);
  });
}
