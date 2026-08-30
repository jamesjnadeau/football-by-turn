import { SVG } from './vendor/svg.esm.js';
import { VIEWBOX_WIDTH } from '../lib/field/geometry.js';
import { renderField } from '../lib/field/field.js';
import { STYLE, DEFS } from '../lib/field/style.js';
import { gameView } from '../lib/game/view.js';

const board = SVG(document.getElementById('board'));
const view = gameView(0);
const { svg, height } = renderField(view);
board.attr('viewBox', `0 0 ${VIEWBOX_WIDTH} ${height}`);
board.svg(`<style>${STYLE}</style>${DEFS}<g id="game-field">${svg}</g>` +
  `<g id="game-arrows"></g><g id="game-players"></g><g id="game-overlay"></g>`);
