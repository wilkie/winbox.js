'use strict';

import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { UnrealizeObject } from '../gdi/CreatePatternBrush.js';
import { SetBkColor } from '../gdi/SetBkColor.js';
import { SetTextColor } from '../gdi/SetTextColor.js';
import { User } from '../user.js';
import { GetDC } from './GetDC.js';
import { GetSysColor } from './GetSysColor.js';
import { ReleaseDC } from './ReleaseDC.js';
import { SendMessage } from './SendMessage.js';
import { type ControlState } from './controls.js';

/**
 * `WM_CTLCOLOR`: a control asking its parent, as it paints, what to paint
 * with. The parent answers a brush and sets the device context's text and
 * background colours; Delphi colours every control of a form this way.
 *
 * **Read out** of `USER.EXE`: the control sends the message to its parent
 * with its device context and, in `lParam`, itself and its type (seg6
 * `028c`, and `GetControlBrush`, seg6 `02d2`); an answer that is no GDI
 * object is asked of `DefWindowProc` instead. `DefWindowProc` (seg1 `5f9c`)
 * sets the background to `COLOR_WINDOW` and the text to `COLOR_WINDOWTEXT`
 * and answers `COLOR_WINDOW`'s brush -- or for a scroll bar, sets them to
 * white and black and answers `COLOR_SCROLLBAR`'s, unrealized.
 *
 * **Recorded** by `ctlcolor`, a parent answering a red brush, blue text on
 * green, and one leaving it to `DefWindowProc`:
 *
 * * As each is first painted, a single-line edit control asks three times,
 *   a multi-line one twice, a list box three times, and a static control,
 *   each kind of button and a scroll bar once. Which of their painting asks
 *   which time is not read.
 * * Edit controls, static controls, check boxes, radio buttons and list
 *   boxes fill with the brush, draw their text in the text colour on the
 *   background colour, the cell the text takes -- a multi-line edit
 *   control's whole line. A check box's or radio button's box is drawn in
 *   the text colour, its inside the brush's.
 * * A group box's caption is on the brush, in the text colour on the
 *   background colour; its outline is the frame colour, and its inside is
 *   not painted.
 * * A push button takes the brush for its four corners, and nothing else.
 * * A scroll bar's shaft is the brush; its arrows are as they were.
 */

export const CTLCOLOR_EDIT = 1;
export const CTLCOLOR_LISTBOX = 2;
export const CTLCOLOR_BTN = 3;
export const CTLCOLOR_SCROLLBAR = 5;
export const CTLCOLOR_STATIC = 6;

const COLOR_SCROLLBAR = 0;
const COLOR_WINDOW = 5;
const COLOR_WINDOWTEXT = 8;

/** What a control paints with, from its parent's answer, as `COLORREF`s. */
export interface ControlColours {
  brush: number;
  text: number;
  ground: number;
}

const colorref = (colour: any) =>
  ((colour?.red ?? 0) | ((colour?.green ?? 0) << 8) | ((colour?.blue ?? 0) << 16)) >>> 0;

/** USER's brush of a system colour, kept as USER keeps its own, and made again when the colour changes. */
export function sysColorBrush(system: any, index: number) {
  const colour = GetSysColor.call(system, index) >>> 0;
  const kept = (system._sysColorBrushes ??= {})[index];

  if (kept && kept.colour === colour) {
    return kept.handle;
  }

  const brush = new Brush(new Color(colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff));
  const handle = system.handles.allocate(brush);

  system._sysColorBrushes[index] = { colour, handle };

  return handle;
}

/** `DefWindowProc`'s answer to `WM_CTLCOLOR` (seg1 `5f9c`). */
export function defaultControlColour(system: any, hdc: number, type: number) {
  if (type === CTLCOLOR_SCROLLBAR) {
    const brush = sysColorBrush(system, COLOR_SCROLLBAR);

    SetBkColor.call(system, hdc, 0xffffff);
    SetTextColor.call(system, hdc, 0);
    UnrealizeObject.call(system, brush);

    return brush;
  }

  SetBkColor.call(system, hdc, GetSysColor.call(system, COLOR_WINDOW));
  SetTextColor.call(system, hdc, GetSysColor.call(system, COLOR_WINDOWTEXT));

  return sysColorBrush(system, COLOR_WINDOW);
}

/** The type a control asks as, and how many times it asks as it paints, by its class; null for one not recorded. */
function asking(control: ControlState): [number, number] | null {
  switch (control.className) {
    case 'EDIT':
      return [CTLCOLOR_EDIT, control.style & 0x0004 ? 2 : 3];
    case 'LISTBOX':
      return [CTLCOLOR_LISTBOX, 3];
    case 'STATIC':
      return [CTLCOLOR_STATIC, 1];
    case 'SCROLLBAR':
      return [CTLCOLOR_SCROLLBAR, 1];
    case 'BUTTON':
      /* An owner-drawn button's owner paints it. */
      return (control.style & 0x0f) === 0x0b ? null : [CTLCOLOR_BTN, 1];
    default:
      return null;
  }
}

/**
 * Asks a control's parent what it is to paint with, as it is about to be
 * painted, and keeps the answer on the control for its painting.
 */
export async function askControlColours(system: any, hwnd: number, window: any) {
  const control: ControlState | undefined = window?.window?.control;
  const how = control && asking(control);

  if (!how) {
    return;
  }

  const [type, times] = how;
  const parent = window.window.parent?.hwnd ?? 0;
  const hdc = GetDC.call(system, hwnd);
  const lParam = ((hwnd & 0xffff) | (type << 16)) >>> 0;
  let answer = 0;

  try {
    for (let at = 0; at < times; at++) {
      answer = parent
        ? (await SendMessage.call(system, parent, User.WM_CTLCOLOR, hdc, lParam)) & 0xffff
        : 0;

      if (!(system.handles.resolve(answer) instanceof Brush)) {
        answer = defaultControlColour(system, hdc, type);
      }
    }

    const surface = system.handles.resolve(hdc);
    const brush = system.handles.resolve(answer);

    (control as any).colours = {
      brush: colorref(brush?.color),
      text: colorref(surface?.textColor ?? surface?.forecolor),
      ground: colorref(surface?.backcolor),
    } satisfies ControlColours;
  } finally {
    ReleaseDC.call(system, hwnd, hdc);
  }
}
