'use strict';

import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { MulDiv } from '../gdi/MulDiv.js';
import { User } from '../user.js';
import { LoadCursor, SetCursor } from './cursor-api.js';
import { type DialogItem, type DialogTemplate } from './dialog-template.js';
import { dialogBoxTemplate, EndDialog, setFocus, systemBaseUnits } from './dialogs.js';
import { DrawText } from './DrawText.js';
import { GetDlgItem } from './GetDlgItem.js';
import { RasterWindow } from './raster-window.js';

/**
 * The message box, on the raster desktop: a dialog USER builds and runs
 * itself. **Read out of `USER.EXE`** (seg1 `9b91`; seg42 `04f5`, `0101`,
 * `01e2`; seg3 `23be`) and **recorded** by the `msgbox` probe on four
 * displays.
 *
 * * **The buttons** are the style's set -- OK; OK, Cancel; Abort, Retry,
 *   Ignore; Yes, No, Cancel; Yes, No; Retry, Cancel -- left to right, their
 *   captions USER's strings. `MB_DEFBUTTON2` and `3` make the second or third
 *   the default, or the first if there is no such button. All are the same
 *   width: the longest caption's by its count of characters -- `&Ignore` --
 *   measured without its `&`, and two widths of `0` more.
 * * **The icon** is the display driver's hand, question mark, exclamation
 *   mark or asterisk (7F01h to 7F04h).
 * * **The text** is laid out as `DrawText` with `DT_WORDBREAK` would lay it
 *   out, as wide as five eighths of the screen, less the margins and the
 *   icon, allow. The box is as wide as the text or the buttons, or the title,
 *   whichever is widest, and centred on the screen, whatever its owner; a
 *   box opened while another is open goes `SM_CXSIZE` and `SM_CYSIZE` on
 *   from it.
 * * **The answer** is the button's number. A box with only OK gives its
 *   button the number of Cancel, so that Escape closes it, and answers
 *   `IDOK` all the same. A box without Cancel takes Close out of its system
 *   menu. The owner is disabled while the box is up.
 *
 * Not followed: `MB_SYSTEMMODAL` with no icon or the hand, which USER shows
 * with `SysErrorBox` instead, not read out; the system menu's Close taken
 * away; and `MB_TASKMODAL` with no owner, which disables the task's other
 * windows.
 */

/** Each set's buttons, as USER's tables give them (DS `1FE`, `204`, `21E`, `20A`). */
const SETS: { id: number; caption: number }[][] = [
  [{ id: 1, caption: 84 }],
  [
    { id: 1, caption: 84 },
    { id: 2, caption: 85 },
  ],
  [
    { id: 3, caption: 86 },
    { id: 4, caption: 87 },
    { id: 5, caption: 88 },
  ],
  [
    { id: 6, caption: 89 },
    { id: 7, caption: 90 },
    { id: 2, caption: 85 },
  ],
  [
    { id: 6, caption: 89 },
    { id: 7, caption: 90 },
  ],
  [
    { id: 4, caption: 87 },
    { id: 2, caption: 85 },
  ],
  [],
  [],
];

/** Every caption USER keeps, in its order: which is longest sets the buttons' width. */
const CAPTIONS = [84, 85, 89, 90, 87, 86, 88, 114];

/** The default title, when none is given. */
const TITLE_ERROR = 78;

const ICONS: Record<number, number> = { 0x10: 0x7f01, 0x20: 0x7f02, 0x30: 0x7f03, 0x40: 0x7f04 };

const MB_OK = 0;
const MB_SYSTEMMODAL = 0x1000;

const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_CYCAPTION = 4;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;

export async function messageBox(system: any, hwndParent: number, text: any, title: any, style: number) {
  const desktop = system.rasterDesktop;
  const environment = desktop.environment;
  const string = (id: number) => environment.userStrings?.get(id) ?? '';
  const metric = (index: number) => environment.metric(index);

  style &= 0xffff;

  const type = style & 0x0f;
  const buttons = (SETS[type] ?? []).map((button) => ({ ...button, text: string(button.caption) }));
  const count = buttons.length;
  let defaultButton = (style >> 8) & 0x0f;

  if (defaultButton >= count) {
    defaultButton = 0;
  }

  const icon = ICONS[style & 0xf0] ?? 0;
  const caption = title === null || title === undefined ? string(TITLE_ERROR) : String(title);
  const message = text === null || text === undefined ? null : String(text);

  const cxS = metric(SM_CXSIZE);
  const cyS = metric(SM_CYSIZE);
  const cxB = metric(SM_CXBORDER);
  const cyB = metric(SM_CYBORDER);
  const cyCap = metric(SM_CYCAPTION);
  const screenW = metric(SM_CXSCREEN);
  const screenH = metric(SM_CYSCREEN);
  const base = systemBaseUnits(system);
  const cxCh = base.x;
  const cyCh = base.y;

  /* Measured in the System font, as the desktop's own DC has it. */
  const hdc = CreateCompatibleDC.call(system, 0);
  const extent = (s: string) => (s.length ? GetTextExtent.call(system, hdc, s, s.length) & 0xffff : 0);

  /* The buttons' width (seg3 `23be`): the caption with the most characters,
   * the first of equals, measured without its `&`. */
  let longest = '';

  for (const id of CAPTIONS) {
    const each = string(id);

    if (each.length > longest.length) {
      longest = each;
    }
  }

  const buttonW = extent(longest.replace(/&(.)/g, '$1')) + 2 * extent('0');

  const iconAdd = icon ? metric(SM_CXICON) + cxS : 0;
  const iconH = icon ? metric(SM_CYICON) : 0;
  const titleW = extent(caption);
  const rowW = buttonW * count + (count - 1) * cxS;
  const minW = Math.max(rowW, titleW + 2 * cxS);
  const margins = 2 * (cyB + cxS);
  const limit = Math.max(minW - margins - iconAdd, (screenW >> 3) * 5 - margins - iconAdd);
  const measured = { left: 0, top: 0, right: limit, bottom: limit };
  const textH = DrawText.call(system, hdc, message ?? '', -1, measured, 0x0c50);
  const textW = measured.right - measured.left;

  DeleteDC.call(system, hdc);

  /* The box, and where it goes (seg42 `05d7`). */
  const nest = (system._messageBoxes ??= 0);
  const width = Math.max(textW, minW) + 2 * cxS + iconAdd;
  const height = Math.max(iconH, textH) + 6 * cyCh;
  let x = ((screenW - width) >> 1) + cxS * nest;
  let y = ((screenH - height) >> 1) + cyS * nest;

  if (x + width > screenW) {
    x = screenW - 2 * cxB - width;
  }

  if (y + height > screenH) {
    y = screenH - 2 * cyB - height;
  }

  /* What goes in it, in the client area (seg42 `0670`). */
  const buttonsX = ((width - rowW) >> 1) - cxB;
  const buttonsBottom = height - 2 * cyB - (cyCh >> 1) - cyCap;
  const buttonH = (cyCh * 14) >> 3;
  const textY = ((Math.max(iconH, textH) - textH) >> 1) + cyCh;
  const iconY = ((textH - iconH) >> 1) + textY;
  const textX = cxS + iconAdd;

  /* In dialog units, each rounded (seg42 `0394`). */
  const across = (pixels: number) => MulDiv(pixels, 4, cxCh);
  const down = (pixels: number) => MulDiv(pixels, 8, cyCh);
  const items: DialogItem[] = [];
  const item = (x: number, y: number, cx: number, cy: number, id: number, itemStyle: number, className: string, itemText: string) =>
    items.push({ x, y, cx, cy, id, style: itemStyle >>> 0, className, text: itemText, data: new Uint8Array(0) });

  buttons.forEach((button, index) =>
    item(
      across(buttonsX + index * (buttonW + cxS)),
      down(buttonsBottom - buttonH),
      across(buttonW),
      down(buttonH),
      button.id,
      0x50010000 | (index === 0 ? 0x00020000 : 0) | (index === defaultButton ? 1 : 0),
      'BUTTON',
      button.text
    )
  );

  if (icon) {
    item(across(cxS), down(iconY), 0, 0, 0xffff, 0x50020003, 'STATIC', `#${icon}`);
  }

  if (message !== null) {
    /* A left-aligned static is one unit wider and taller (seg42 `03ff`). */
    item(across(textX), down(textY), across(textW) + 1, down(textH) + 1, 0xffff, 0x50020080, 'STATIC', message);
  }

  const systemModal = (style & 0x3000) === MB_SYSTEMMODAL;
  const template: DialogTemplate = {
    style: systemModal ? 0x80c80103 : 0x80c80181,
    x: across(x + cxB),
    y: down(y + cyCap),
    cx: across(width - 2 * cxB),
    cy: down(height - cyCap - cyB),
    menu: null,
    className: null,
    caption,
    font: null,
    items,
  };

  /* The box's procedure (seg42 `0101`). */
  const proc = async (hwnd: number, msg: number, wParam: number) => {
    if (msg === User.WM_INITDIALOG) {
      const window = system.handles.resolve(hwnd);
      const children =
        window instanceof RasterWindow
          ? desktop.windows.filter((other: any) => other.parent === window.window)
          : [];

      /* The default button has the focus: the buttons are made first. */
      const focus = children[defaultButton];

      if (focus?.hwnd) {
        await setFocus(system, focus.hwnd);
      }

      /* OK alone answers to Cancel's number, so that Escape closes it. */
      if (type === MB_OK) {
        const ok = GetDlgItem.call(system, hwnd, 1);
        const button = ok ? system.handles.resolve(ok) : null;

        if (button instanceof RasterWindow) {
          button.window.controlId = 2;
        }
      }

      return 0;
    }

    if (msg === User.WM_COMMAND) {
      const id = wParam & 0xffff;

      if ((id === 1 || id === 2) && !GetDlgItem.call(system, hwnd, id)) {
        return 0;
      }

      if (id >= 1 && id <= 7) {
        await EndDialog.call(system, hwnd, id);
        return 1;
      }
    }

    return 0;
  };

  const cursor = SetCursor.call(system, await LoadCursor.call(system, 0, 0x7f00));

  system._messageBoxes = nest + 1;

  let answer: number;

  try {
    answer = await dialogBoxTemplate(system, 0, template, hwndParent, proc, ((hwndParent << 16) | style) >>> 0);
  } finally {
    system._messageBoxes = Math.max(0, system._messageBoxes - 1);

    if (cursor) {
      SetCursor.call(system, cursor);
    }
  }

  if (answer === -1) {
    return 0;
  }

  return type === MB_OK && answer ? 1 : answer;
}
