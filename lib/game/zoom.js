/**
 * The pinch-zoom/drag-pan transform, applied on top of gameView's own
 * auto-following window rather than inside it: gameView still computes
 * exactly the same base crop it always did, and this only decides which
 * part of THAT crop, at what magnification, actually reaches the viewBox.
 * Kept as one pure function so the clamping math -- never scroll past the
 * field's own edges, never zoom out past the base window -- is testable
 * without touching a pointer.
 */
export function applyZoomPan(view, viewBoxWidth, { scale, panX, panY }) {
  const width = viewBoxWidth / scale;
  const height = view.height / scale;
  const fieldBottomY = view.anchorY + view.bottomYard * view.scaleY;

  const maxX = Math.max(0, viewBoxWidth - width);
  const x = Math.min(Math.max(panX, 0), maxX);

  const minY = view.fieldTopY;
  const maxY = Math.max(minY, fieldBottomY - height);
  const y = Math.min(Math.max(view.windowTopY + panY, minY), maxY);

  return { x, y, width, height };
}
