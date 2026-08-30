/**
 * Which games this page can deal. The home screen is built from this list and
 * nothing else, so offering the eleven-a-side game one day is a flag flipped
 * here plus the formations that game needs — not a second screen.
 *
 * `teamSize` is written out rather than imported from constants.js on purpose.
 * It is a claim ABOUT the game the button starts, and the test that holds it
 * against TEAM_SIZE is what stops this list quietly lying about it.
 */
export const VARIANTS = [
  {
    id: '7',
    label: '7 Player',
    note: 'Three linemen, two receivers, a quarterback and a back.',
    teamSize: 7,
    available: true,
  },
  {
    id: '11',
    label: '11 Player',
    note: 'The full field. Not built yet.',
    teamSize: 11,
    available: false,
  },
];

/** The variant with this id, or null — an id from a button is still a string a stranger could have typed. */
export function getVariant(id) {
  return VARIANTS.find((v) => v.id === id) ?? null;
}

/** Whether pressing this id should start a game. The one gate; the disabled button is only the picture of it. */
export function isPlayable(id) {
  const v = getVariant(id);
  return v !== null && v.available;
}
