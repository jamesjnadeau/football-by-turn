# Velocity triangle

Replace the debug velocity *line* with a blue *triangle* that sits where the
line used to start (the player's centre) and grows with speed.

## Global Constraints

- Colour stays `#1668dc` — the exact hex already used by `.vel`.
- The marker stays anchored at the player group's local origin `(0, 0)` — the
  point the line started at.
- The marker's size is strictly proportional to speed in the same way the old
  line's length was: circumradius `R = player.radius + speed × DEBUG_VELOCITY_SECONDS`.
  `DEBUG_VELOCITY_SECONDS` keeps its current value and meaning.
- A player with `speed === 0` still draws nothing (no direction to point).
- The marker still points along the *velocity*, not along the plan.
- The class stays `.vel`, still `pointer-events:none`, still drawn last inside
  the player group so it paints over the body.
- All existing tests must pass; tests that describe the line are rewritten to
  describe the triangle. `npm test` is the whole suite.
- Comment style: this codebase writes prose comments explaining *why*. Match
  the density and voice of the surrounding code in `lib/game/render.js`.

## Task 1: Turn the velocity line into a velocity triangle

Files: `lib/game/render.js`, `test/game/render.test.js`, `app/main.js`.

### Geometry

Replace `velocityLine(player)` in `lib/game/render.js` with
`velocityTriangle(player)`. It emits an equilateral triangle as a single
`<polygon class="vel"/>`:

- Let `speed = Math.hypot(player.vel.x, player.vel.y)`; return `''` when it is `0`.
- Let `R = player.radius + speed * DEBUG_VELOCITY_SECONDS` — the same length
  the old line drew, so the triangle's apex lands exactly on the old tip.
- Let `theta = Math.atan2(player.vel.y, player.vel.x)` — the velocity heading.
- The three vertices sit at distance `R` from the local origin, at angles
  `theta`, `theta + 2π/3`, `theta + 4π/3`. Emit them in that order, apex first.
- Format every coordinate with the module's existing `num()` helper, and join
  the polygon points as `"x,y x,y x,y"`.

Because the circumcentre is the local origin, the triangle is centred exactly
where the line began, and because `R` carries the speed term, more speed means
a bigger triangle.

### Style

In `STYLE_GAME`, replace the `.vel` rule with a filled one that keeps the
colour: `'.vel{fill:#1668dc;pointer-events:none}'`. Update the comment above it
so it describes a triangle rather than a hairline (it is still an instrument
drawn over the player, not part of the play).

### Call site

`playerMark` calls `velocityTriangle` in place of `velocityLine`, in the same
position (last, over the body). No signature changes anywhere:
`renderPlayers(state, { showVelocity })` keeps its shape.

### The button label

In `app/main.js`, the debug button reads `Velocity lines: on|off`. It is no
longer a line — change the label to `Velocity: on|off`. Nothing else in
`app/main.js` changes.

### Tests

Rewrite the four velocity tests in `test/game/render.test.js` (they currently
live around lines 171-209 and match on `<line x1="0" y1="0"`) so they describe
the triangle. Keep the existing `rbGroup` scoping helper. Cover:

1. Off by default; on with `{ showVelocity: true }` exactly one moving player
   gets a marker; the marker is a `<polygon>` with three points.
2. Size scales with speed: for `vel = {x: 40, y: 0}` the apex is at
   `(rb.radius + 40 * DEBUG_VELOCITY_SECONDS, 0)`; doubling the speed to
   `{x: 80, y: 0}` gives `rb.radius + 80 * DEBUG_VELOCITY_SECONDS` — and the
   second triangle is strictly larger than the first.
3. It points along the velocity, not along the plan: with
   `rb.vel = {x: 0, y: -40}` and `setPlan(s, 'o-rb', {x: 0, y: 1}, 1)` the apex
   is at `(0, -(rb.radius + 40 * DEBUG_VELOCITY_SECONDS))`.
4. The triangle is filled in the same blue: `STYLE_GAME` includes
   `.vel{fill:#1668dc`.

Watch for `-0` when comparing coordinates — compare the numbers the markup
actually carries, and allow a small epsilon where trig rounding makes exact
equality fragile.

### Verification

`npm test` — the whole suite passes, with no test left matching on
`class="vel"` as a `<line>`.
