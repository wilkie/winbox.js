'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';

import { Painter, type PaintEnvironment } from './painter.js';

/**
 * The standard controls -- the `BUTTON`, `STATIC`, `EDIT`, `LISTBOX` and
 * `SCROLLBAR` classes USER registers itself -- as USER paints them.
 *
 * Read off the `chrome` probe's `controls` window, one of each on each of
 * four displays: a push button, a default push button, a checked check box,
 * a checked radio button, static text, an edit control with a border, a list
 * box with a border and two items, and a horizontal scroll bar.
 */

export const CONTROL_CLASSES = new Set(['BUTTON', 'STATIC', 'EDIT', 'LISTBOX', 'SCROLLBAR']);

export const BS_PUSHBUTTON = 0x0;
export const BS_DEFPUSHBUTTON = 0x1;
export const BS_CHECKBOX = 0x2;
export const BS_AUTOCHECKBOX = 0x3;
export const BS_RADIOBUTTON = 0x4;
export const BS_3STATE = 0x5;
export const BS_AUTO3STATE = 0x6;
export const BS_AUTORADIOBUTTON = 0x9;

export const SBS_VERT = 0x1;

export const WM_USER = 0x400;
export const BM_GETCHECK = WM_USER;
export const BM_SETCHECK = WM_USER + 1;
export const LB_ADDSTRING = WM_USER + 1;
export const LB_GETCOUNT = WM_USER + 12;

export const OBM_CHECKBOXES = 32759;

const COLOR_WINDOW = 5;
const COLOR_WINDOWFRAME = 6;
const COLOR_WINDOWTEXT = 8;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_BTNTEXT = 18;
const COLOR_BTNHIGHLIGHT = 20;

const WS_BORDER = 0x00800000;

/**
 * Where a control's window goes for the rectangle it was made with: there,
 * except a list box with a border, whose border goes around the rectangle
 * rather than inside it, so its items have all of it. Measured on each of
 * the four displays, one list box each.
 */
export function controlRect(
  className: string,
  style: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  if (className === 'LISTBOX' && style & WS_BORDER) {
    return { x: x - 1, y: y - 1, width: width + 2, height: height + 2 };
  }

  return { x, y, width, height };
}

/** What a control keeps: its class and style, its text, and what it holds. */
export interface ControlState {
  className: string;
  style: number;
  text: string;
  checked: number;
  items: string[];
}

/** What painting a control asks of the display, beyond painting. */
export interface ControlEnvironment extends PaintEnvironment {
  /** The width of a line of text in the System font. */
  measure(text: string): number;

  /** The System font's metrics, as `GetTextMetrics` gives them. */
  font: { height: number; ascent: number };

  /** Draws a line of text in the System font, its cell's top left at `x, y`. */
  text(text: string, colour: number, x: number, y: number): void;
}

/**
 * Paints a control's client area, `width` by `height`, into `bitmap`, a view
 * of the screen there.
 */
export function paintControl(
  bitmap: DeviceBitmap,
  width: number,
  height: number,
  control: ControlState,
  environment: ControlEnvironment
) {
  const painter = new Painter(bitmap, 0, 0, width, height, environment);
  const kind = control.style & 0x0f;

  switch (control.className) {
    case 'BUTTON':
      if (kind === BS_PUSHBUTTON || kind === BS_DEFPUSHBUTTON) {
        pushButton(painter, width, height, control, kind === BS_DEFPUSHBUTTON, environment);
      } else if (
        kind === BS_CHECKBOX ||
        kind === BS_AUTOCHECKBOX ||
        kind === BS_RADIOBUTTON ||
        kind === BS_AUTORADIOBUTTON ||
        kind === BS_3STATE ||
        kind === BS_AUTO3STATE
      ) {
        checkBox(painter, width, height, control, kind, environment);
      }
      break;

    case 'STATIC':
      painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
      environment.text(control.text, environment.sysColor(COLOR_WINDOWTEXT), 0, 0);
      break;

    case 'EDIT':
      painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
      environment.text(
        control.text,
        environment.sysColor(COLOR_WINDOWTEXT),
        EDIT_LEFT,
        EDIT_TOP(environment)
      );
      break;

    case 'LISTBOX':
      painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
      control.items.forEach((item, at) => {
        environment.text(
          item,
          environment.sysColor(COLOR_WINDOWTEXT),
          LIST_LEFT,
          at * environment.font.height
        );
      });
      break;

    case 'SCROLLBAR':
      painter.scrollBar(0, 0, width, height, (control.style & SBS_VERT) !== 0);
      break;
  }
}

/* Provisional, to be fitted to the captures. */
const EDIT_LEFT = 3;
const EDIT_TOP = (environment: ControlEnvironment) =>
  environment.font.height - environment.font.ascent;
const LIST_LEFT = 2;
const CHECK_TEXT_GAP = 5;

/**
 * A push button: an outline in the frame colour without its corners, a
 * second outline inside it for the default button, and a raised face two
 * pixels deep, its text centred.
 */
function pushButton(
  painter: Painter,
  width: number,
  height: number,
  control: ControlState,
  isDefault: boolean,
  environment: ControlEnvironment
) {
  const line = painter.colour(COLOR_WINDOWFRAME);
  const light = painter.colour(COLOR_BTNHIGHLIGHT);
  const shadow = painter.colour(COLOR_BTNSHADOW);

  painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
  painter.fill(1, 0, width - 1, 1, line);
  painter.fill(1, height - 1, width - 1, height, line);
  painter.fill(0, 1, 1, height - 1, line);
  painter.fill(width - 1, 1, width, height - 1, line);

  const o = isDefault ? 1 : 0;

  if (isDefault) {
    painter.outline(1, 1, width - 1, height - 1, line);
  }

  const [a, b, c, d] = [o, width - o, o, height - o];

  painter.fill(a + 1, c + 1, b - 1, d - 1, painter.colour(COLOR_BTNFACE));

  for (let i = 0; i < 2; i++) {
    painter.fill(a + 1, c + 1 + i, b - 2 - i, c + 2 + i, light);
    painter.fill(a + 1 + i, c + 1, a + 2 + i, d - 2 - i, light);
    painter.fill(b - 2 - i, c + 1 + i, b - 1 - i, d - 1, shadow);
    painter.fill(a + 1 + i, d - 2 - i, b - 1, d - 1 - i, shadow);
  }

  environment.text(
    control.text,
    environment.sysColor(COLOR_BTNTEXT),
    Math.floor((width - environment.measure(control.text)) / 2) - 1,
    Math.floor((height - environment.font.height) / 2)
  );
}

/**
 * A check box or radio button: its image from the display driver's
 * `OBM_CHECKBOXES` -- check boxes in the first row, radio buttons in the
 * second, three-state boxes in the third, unchecked and checked across --
 * centred at the left, and its text after it.
 */
function checkBox(
  painter: Painter,
  width: number,
  height: number,
  control: ControlState,
  kind: number,
  environment: ControlEnvironment
) {
  const images = environment.oem.get(OBM_CHECKBOXES);

  painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));

  const cellWidth = images ? images.width / 4 : 14;
  const cellHeight = images ? images.height / 3 : 13;
  const boxWidth = cellWidth - 1;
  const row =
    kind === BS_RADIOBUTTON || kind === BS_AUTORADIOBUTTON
      ? 1
      : kind === BS_3STATE || kind === BS_AUTO3STATE
        ? 2
        : 0;
  const column = control.checked ? 1 : 0;

  painter.blit(
    images,
    0,
    Math.floor((height - cellHeight) / 2),
    boxWidth,
    column * cellWidth,
    cellHeight,
    row * cellHeight
  );

  environment.text(
    control.text,
    environment.sysColor(COLOR_WINDOWTEXT),
    boxWidth + CHECK_TEXT_GAP,
    Math.floor((height - environment.font.height) / 2) + 1
  );
}
