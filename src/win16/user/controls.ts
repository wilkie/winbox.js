'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';

import { Painter, type PaintEnvironment } from './painter.js';
import { layoutText } from './DrawText.js';

/**
 * The standard controls -- the `BUTTON`, `STATIC`, `EDIT`, `LISTBOX` and
 * `SCROLLBAR` classes USER registers itself -- as USER paints them.
 *
 * Read off the `chrome` probe's `controls` window, one of each on each of
 * four displays: a push button, a default push button, a checked check box,
 * a checked radio button, static text, an edit control with a border, a list
 * box with a border and two items, and a horizontal scroll bar.
 */

export const CONTROL_CLASSES = new Set(['BUTTON', 'STATIC', 'EDIT', 'LISTBOX', 'SCROLLBAR', 'COMBOBOX', 'COMBOLBOX']);

export const BS_PUSHBUTTON = 0x0;
export const BS_DEFPUSHBUTTON = 0x1;
export const BS_CHECKBOX = 0x2;
export const BS_AUTOCHECKBOX = 0x3;
export const BS_RADIOBUTTON = 0x4;
export const BS_3STATE = 0x5;
export const BS_AUTO3STATE = 0x6;
export const BS_GROUPBOX = 0x7;
export const BS_AUTORADIOBUTTON = 0x9;

export const SBS_VERT = 0x1;
export const SS_NOPREFIX = 0x80;

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
  /* A list box moves itself out by a border each way as it is made, border
   * or not (`USER.EXE` seg38 `02d5`). */
  if (className === 'LISTBOX' || className === 'COMBOLBOX') {
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

  /** The control's window. */
  hwnd?: number;

  /** An edit control's selection, scroll and limit; see `edit.ts`. */
  edit?: import('./edit.js').EditState;

  /** The font `WM_SETFONT` gave it, and that font's height and ascent; the System font without one. */
  font?: {
    handle: number;
    font: any;
    metrics: { height: number; ascent: number; overhang?: number; fixedPitch?: boolean; average?: number };
  };

  /** An edit control's border, which it draws inside its client area rather than as a frame. */
  border?: boolean;

  /** A static control's icon, with `SS_ICON`. */
  icon?: import('../../raster/icon.js').IconData | null;
}

/** What painting a control asks of the display, beyond painting. */
export interface ControlEnvironment extends PaintEnvironment {
  /** The width of a line of text in the System font. */
  measure(text: string): number;

  /** The font's metrics, as `GetTextMetrics` gives them: the System font's, or the control's own. */
  font: { height: number; ascent: number; overhang?: number };

  /** The System font's average width, as `GetDialogBaseUnits` gives it across. */
  systemAverage?: number;

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
      } else if (kind === BS_GROUPBOX) {
        groupBox(painter, width, height, control, environment);
      }
      break;

    case 'STATIC':
      staticControl(bitmap, painter, width, height, control, environment);
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
      painter.scrollBar(
        0,
        0,
        width,
        height,
        (control.style & SBS_VERT) !== 0,
        (control as any).scroll && { ...(control as any).scroll, shaft: (control as any).shaft ?? null }
      );
      break;
  }
}

/**
 * A static control painted (`USER.EXE` seg25 `20da`): its client area
 * filled, then by its type, the style's low seven bits. Text -- left, centred
 * or right, and `SS_LEFTNOWORDWRAP` -- is laid out as `DrawText` lays it out
 * (seg25 `1fe5`): with `DT_WORDBREAK | DT_EXPANDTABS` and the type's
 * alignment, or for `SS_LEFTNOWORDWRAP` with `DT_EXPANDTABS | DT_NOCLIP`;
 * and `DT_NOPREFIX` with `SS_NOPREFIX`. `SS_ICON` draws its icon at its
 * corner. Not followed: the rectangles and frames, `SS_SIMPLE`'s own path,
 * which is drawn as one line, and disabled text, which USER greys.
 */
function staticControl(
  bitmap: DeviceBitmap,
  painter: Painter,
  width: number,
  height: number,
  control: ControlState,
  environment: ControlEnvironment
) {
  const type = control.style & 0x7f;

  painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));

  if (type === SS_ICON) {
    const icon = control.icon;

    if (icon) {
      for (let y = 0; y < icon.height; y++) {
        for (let x = 0; x < icon.width; x++) {
          const at = y * icon.width + x;
          const beneath = bitmap.indexAt(x, y);

          if (beneath !== null) {
            bitmap.put(x, y, (icon.and[at] ? beneath : 0) ^ icon.xor[at]);
          }
        }
      }
    }

    return;
  }

  if (type > SS_RIGHT && type !== SS_LEFTNOWORDWRAP) {
    label(painter, environment, control.text, COLOR_WINDOWTEXT, 0, 0, !(control.style & SS_NOPREFIX));
    return;
  }

  let format = type === SS_LEFTNOWORDWRAP ? 0x0140 : type | 0x0050;

  if (control.style & SS_NOPREFIX) {
    format |= 0x0800;
  }

  const colour = environment.sysColor(COLOR_WINDOWTEXT);

  layoutText(
    {
      extent: (text) => environment.measure(text),
      metrics: {
        height: environment.font.height,
        externalLeading: 0,
        overhang: environment.font.overhang ?? 0,
        ascent: environment.font.ascent,
        average: control.font?.metrics.average ?? environment.systemAverage ?? 8,
      },
      isSystem: !control.font,
      textOut: (x, y, text) => environment.text(text, colour, x, y),
      underline: (left, top, right, bottom) =>
        painter.fill(left, top, right, bottom, painter.colour(COLOR_WINDOWTEXT)),
      withClip: (_rect, draw) => draw(),
      widest: { value: 0 },
    },
    control.text,
    -1,
    { left: 0, top: 0, right: width, bottom: height },
    format
  );
}

const SS_RIGHT = 0x02;
const SS_ICON = 0x03;
const SS_LEFTNOWORDWRAP = 0x0c;

/* Provisional, to be fitted to the captures. */
const EDIT_LEFT = 3;
const EDIT_TOP = (environment: ControlEnvironment) =>
  environment.font.height - environment.font.ascent;
const LIST_LEFT = 2;
const CHECK_TEXT_GAP = 5;

/**
 * A group box (`USER.EXE` seg25 `193a`): an outline in the frame colour on
 * its rectangle, the top line half the font's height down, and its caption
 * over that line on a ground of the control colour. The ground starts a pixel
 * before the **System** font's average width, whatever font the caption is
 * in, and is the caption's size and four more each way; the caption is two
 * in, and half of the descent and four down. The inside is never painted, so
 * what lies in it -- a dialog's radio buttons -- shows.
 *
 * **Read out**, and **recorded** by `groupbox`: two group boxes in bold MS
 * Sans Serif and two in the System font, on four displays.
 */
function groupBox(
  painter: Painter,
  width: number,
  height: number,
  control: ControlState,
  environment: ControlEnvironment
) {
  const high = environment.font.height;

  painter.outline(0, Math.trunc(high / 2), width, height, painter.colour(COLOR_WINDOWFRAME));

  const shown = plain(control.text);

  if (!shown) {
    return;
  }

  const left = (environment.systemAverage ?? 8) - 1;
  const across = environment.measure(shown);

  painter.fill(left, 0, left + across + 4, high + 4, painter.colour(COLOR_WINDOW));
  label(
    painter,
    environment,
    control.text,
    COLOR_WINDOWTEXT,
    left + 2,
    Math.trunc((high + 4 - environment.font.ascent) / 2),
    true
  );
}

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

  /* Centred down by the font's ascent, not its height: half of what the
   * button leaves beside the ascent, less one. It fits every push button
   * recorded -- `chrome`'s, 24 high in the System font on four displays, and
   * `dialogs`' in the System font and bold MS Sans Serif. Refused: half of
   * what the height leaves, which is a row low on the EGA's 18-high buttons
   * in MS Sans Serif, and the height less its internal leading, likewise. */
  label(
    painter,
    environment,
    control.text,
    COLOR_BTNTEXT,
    Math.floor((width - environment.measure(plain(control.text))) / 2) - 1,
    Math.floor((height - environment.font.ascent) / 2) - 1,
    true
  );
}

/**
 * Where a push button with the focus draws its dotted rectangle, around its
 * caption (`USER.EXE` seg25 `15d3`): two borders left of the text and two
 * right, one above and two below, inside the client area; and for a push
 * button inside its own edge too -- at least three borders from the top
 * (two on a screen of 300 rows or fewer, seg3 `0d44`) and four from the
 * bottom. Null for anything else.
 */
export function focusRect(
  width: number,
  height: number,
  control: ControlState,
  environment: ControlEnvironment,
  border: { x: number; y: number },
  tallScreen: boolean
) {
  const kind = control.style & 0x0f;

  if (control.className !== 'BUTTON' || (kind !== BS_PUSHBUTTON && kind !== BS_DEFPUSHBUTTON)) {
    return null;
  }

  const textWidth = environment.measure(plain(control.text));
  const x = Math.floor((width - textWidth) / 2) - 1;
  const y = Math.floor((height - environment.font.ascent) / 2) - 1;
  const left = Math.max(0, x - 2 * border.x);
  const right = Math.min(width, left + textWidth + 4 * border.x);
  let top = Math.max(0, y - border.y);
  let bottom = Math.min(height, top + environment.font.height + 3 * border.y);

  top = Math.max(top, (tallScreen ? 3 : 2) * border.y);
  bottom = Math.min(bottom, height - 4 * border.y);

  return { left, top, right, bottom };
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

  label(
    painter,
    environment,
    control.text,
    COLOR_WINDOWTEXT,
    boxWidth + CHECK_TEXT_GAP,
    Math.floor((height - environment.font.height) / 2) + 1,
    true
  );
}

/** A control's text as it shows: `&&` is an ampersand, and a lone `&` is dropped. */
function plain(text: string) {
  return text.replace(/&(.?)/g, '$1');
}

/**
 * A control's text, its mnemonic underlined: the character after a lone `&`,
 * a line under it a row below the font's ascent -- the menu bar's rule, which
 * the `menus` probe measured and `dialogs` shows controls keep. `&&` is one
 * ampersand. Static text with `SS_NOPREFIX` shows its ampersands as they are.
 */
function label(
  painter: Painter,
  environment: ControlEnvironment,
  text: string,
  colour: number,
  x: number,
  y: number,
  prefix: boolean
) {
  if (!prefix) {
    environment.text(text, environment.sysColor(colour), x, y);
    return;
  }

  const shown = plain(text);

  environment.text(shown, environment.sysColor(colour), x, y);

  const match = /&([^&])/.exec(text.replace(/&&/g, '\u0000\u0000'));

  /* Measured by the `dialogs` probe: under an emboldened font, whose text
   * measures a pixel wider than it draws, the line starts that overhang to
   * the left -- the extents with the overhang taken off, as `DrawText` works
   * them out. With the System font there is none. */
  if (match) {
    const before = plain(text.slice(0, match.index));
    const under = x + environment.measure(before) - (environment.font.overhang ?? 0);
    const row = y + environment.font.ascent + 1;

    painter.fill(
      under,
      row,
      under + environment.measure(match[1]),
      row + 1,
      painter.colour(colour)
    );
  }
}
