/**
 * The one escaper every string that reaches markup goes through.
 *
 * Lives on its own rather than inside `geometry.js` (which is about
 * coordinates, not text) or `field.js` (which `markers.js` must not depend
 * on). `label()` in `markers.js` will carry text a stranger typed into a URL,
 * so this escapes quotes as well as the usual `&`/`<`/`>` — not because SVG
 * text content requires it, but because nothing downstream can assume a
 * string that started as text content never ends up inside an attribute
 * value instead (`label()`'s `color` does exactly that).
 */
export function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
