/**
 * The one stylesheet every diagram inlines.
 *
 * The diagrams this replaces carried three drifted copies of this block. The
 * rules only some diagrams need — the penalty flag, the movement label — stay
 * here rather than being emitted conditionally: a few hundred bytes per file
 * costs less than the fork that drift came from.
 *
 * Everything is monochrome by constraint, not by preference. These print on
 * black-and-white lasers and get photocopied, so the end zone is hatched
 * rather than filled (gray dithers badly) and the officials are told apart by
 * shape — solid disc, outlined disc, halo — rather than by colour.
 */
export const STYLE = [
  'svg{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',

  // The field
  '.turf{fill:#FFFFFF}',
  '.ez{fill:url(#hz)}',
  '.hl{stroke:#B8B8B8;stroke-width:1.15}',
  '.sl{stroke:#8E8E8E;stroke-width:1.6;fill:none}',
  '.yl{stroke:#8E8E8E;stroke-width:.8;fill:none}',
  '.gl{stroke:#5A5A5A;stroke-width:2.2;fill:none}',
  '.rl{stroke:#000000;stroke-width:1.5;stroke-dasharray:7 4;fill:none}',
  '.hash{stroke:#8E8E8E;stroke-width:.9}',
  '.post{stroke:#000000;stroke-width:3;fill:none;stroke-linecap:round}',
  '.ylab{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8.5px;fill:#666666}',
  '.ylab.end{text-anchor:end}',
  '.ylab.start{text-anchor:start}',
  // The label is already written uppercase; this keeps it that way if it isn't.
  '.pb{font-size:8.5px;letter-spacing:.2em;fill:#666666;text-anchor:middle;text-transform:uppercase}',

  // Players
  '.kp line{stroke:#454545;stroke-width:1.7;stroke-linecap:round}',
  '.rp{fill:none;stroke:#454545;stroke-width:1.5}',

  // Officials. `hat-w` plus `halo` is the one being described.
  '.hat-b{fill:#000000}',
  '.hat-w{fill:#FFFFFF;stroke:#000000;stroke-width:2.6}',
  '.halo{fill:#C7C7C7}',
  '.mk{font-size:10px;font-weight:600;text-anchor:middle}',
  '.mk-l{fill:#FFFFFF}',
  '.mk-d{fill:#000000}',

  // Annotation
  '.mv{stroke:#000000;stroke-width:1.7;fill:none;stroke-dasharray:.1 4.4;stroke-linecap:round}',
  '.arh{fill:#000000}',
  '.mvlab{font-size:8.4px;fill:#454545;text-anchor:middle;font-style:italic}',
  '.note{font-size:8.6px;fill:#454545;font-style:italic}',
  '.note.middle{text-anchor:middle}',
  '.note.start{text-anchor:start}',
  '.note.end{text-anchor:end}',
  '.flagk{fill:#000000}',
  '.flagt{stroke:#000000;stroke-width:1.4;stroke-linecap:round}',
].join('\n');

/**
 * Emitted once per file. `hz` hatches the end zone; `ar` is the arrowhead on
 * every movement path.
 */
export const DEFS =
  '<defs>' +
  '<pattern id="hz" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<line x1="0" y1="0" x2="0" y2="7" class="hl"/>' +
  '</pattern>' +
  '<marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">' +
  '<path d="M0,1 L9,5 L0,9 z" class="arh"/>' +
  '</marker>' +
  '</defs>';
