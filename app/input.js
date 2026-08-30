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
    onDragPreview(playerId, log);
  });

  board.on('pointerup', (e) => {
    if (!log) return;
    const p = board.point(e.clientX, e.clientY);
    log.push({ t: e.timeStamp, ...p });
    onGesture(playerId, classifyGesture(log), p);
    log = null;
    playerId = null;
  });

  board.on('pointercancel', () => {
    log = null;
    playerId = null;
    onDragPreview(null, null);
  });
}
