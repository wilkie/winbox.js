'use strict';

import { BitBlt } from '../gdi/BitBlt.js';
import { CreateCompatibleBitmap } from '../gdi/CreateCompatibleBitmap.js';
import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { CreatePen } from '../gdi/CreatePen.js';
import { CreateSolidBrush } from '../gdi/CreateSolidBrush.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { GetNearestColor } from '../gdi/GetNearestColor.js';
import { GetStockObject } from '../gdi/GetStockObject.js';
import { LineTo } from '../gdi/LineTo.js';
import { MoveTo } from '../gdi/MoveTo.js';
import { Polygon } from '../gdi/Polygon.js';
import { Rectangle } from '../gdi/Rectangle.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { FindResource } from '../kernel/FindResource.js';
import { FreeResource } from '../kernel/FreeResource.js';
import { GetModuleHandle } from '../kernel/GetModuleHandle.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { LoadResource } from '../kernel/LoadResource.js';
import { LockResource } from '../kernel/LockResource.js';
import { PAINTSTRUCT } from '../user.js';
import { BeginPaint } from '../user/BeginPaint.js';
import { ClientToScreen } from '../user/ClientToScreen.js';
import { GetDlgItemInt, GetDlgItemText, SetDlgItemInt } from '../user/dialog-items.js';
import { DialogBoxIndirectParam, EndDialog } from '../user/dialogs.js';
import { DrawFocusRect } from '../user/DrawFocusRect.js';
import { EndPaint } from '../user/EndPaint.js';
import { FillRect } from '../user/FillRect.js';
import { FrameRect } from '../user/FrameRect.js';
import { GetDC } from '../user/GetDC.js';
import { GetDlgItem } from '../user/GetDlgItem.js';
import { GetFocus } from '../user/GetFocus.js';
import { GetSysColor } from '../user/GetSysColor.js';
import { GetSystemMetrics } from '../user/GetSystemMetrics.js';
import { GetWindowRect } from '../user/GetWindowRect.js';
import { InvalidateRect } from '../user/InvalidateRect.js';
import { MoveWindow } from '../user/MoveWindow.js';
import { GetProp, RemoveProp, SetProp } from '../user/props.js';
import { ReleaseDC } from '../user/ReleaseDC.js';
import { ScreenToClient } from '../user/ScreenToClient.js';
import { SendDlgItemMessage } from '../user/SendDlgItemMessage.js';
import { SendMessage } from '../user/SendMessage.js';
import { SetCapture } from '../user/SetCapture.js';
import { SetFocus } from '../user/SetFocus.js';
import { ShowWindow } from '../user/ShowWindow.js';
import { UpdateWindow } from '../user/UpdateWindow.js';
import { ClipCursor } from '../user/userwin.js';
import { ValidateRect } from '../user/ValidateRect.js';
import { ChildWindowFromPoint } from '../user/window-from-point.js';
import { EnableWindow, GetParent } from '../user/window-queries.js';
import { SetWindowPos } from '../user/window-state.js';
import {
  CallWindowProc,
  GetWindowLong,
  GetWindowWord,
  SetWindowLong,
} from '../user/window-words.js';
import { hlsToRgb, rgbToHls } from './colour-math.js';
import {
  callHook,
  dword,
  freeTemplate,
  instance,
  lpcstr,
  nextNumber,
  ownTemplate,
  procAddress,
  registered,
  setDword,
  setError,
  stateOf,
  withBlocks,
  word,
} from './guest-calls.js';
import { waitCursor } from './state.js';
import { BASIC_COLOURS, COLOR_TEMPLATE } from './templates.js';

/**
 * COMMDLG's Color dialog: `ChooseColor` (5), its procedure `ColorDlgProc`
 * (8) and `WantArrows` (25), the procedure its two grids are subclassed
 * with. **Read out** of `COMMDLG.DLL` seg1 and **recorded** by `choosclr`;
 * each step is COMMDLG's, at the address the comments give. Its words are
 * kept as COMMDLG keeps them, signed or not as its code takes them. The twin
 * of `crates/winbox-win16/src/commdlg/choose_color.rs`.
 */

const WM_MOVE = 0x0003;
const WM_SETFOCUS = 0x0007;
const WM_KILLFOCUS = 0x0008;
const WM_PAINT = 0x000f;
const WM_GETDLGCODE = 0x0087;
const WM_KEYDOWN = 0x0100;
const WM_CHAR = 0x0102;
const WM_INITDIALOG = 0x0110;
const WM_COMMAND = 0x0111;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_LBUTTONDBLCLK = 0x0203;
const EN_KILLFOCUS = 0x0200;
const EN_CHANGE = 0x0300;
const EM_SETSEL = 0x0401;

const IDOK = 1;
const IDCANCEL = 2;
const PSH_HELP = 0x40e;
const ID_LUMINOSITY = 0x2be;
const ID_HUE = 0x2bf;
const ID_SAT = 0x2c0;
const ID_LUM = 0x2c1;
const ID_RED = 0x2c2;
const ID_GREEN = 0x2c3;
const ID_BLUE = 0x2c4;
const ID_SAMPLE = 0x2c5;
const ID_SPECTRUM = 0x2c6;
const ID_ADD = 0x2c8;
const ID_SOLID = 0x2c9;
const ID_DEFINE = 0x2cf;
const ID_BASIC = 0x2d0;
const ID_CUSTOM = 0x2d1;
const ID_HUE_LABEL = 0x2d3;
const ID_BLUE_LABEL = 0x2d8;

const CC_RGBINIT = 0x1;
const CC_FULLOPEN = 0x2;
const CC_PREVENTFULLOPEN = 0x4;
const CC_SHOWHELP = 0x8;
const CC_ENABLEHOOK = 0x10;
const CC_ENABLETEMPLATE = 0x20;
const CC_ENABLETEMPLATEHANDLE = 0x40;

const CDERR_NOTEMPLATE = 0x3;
const CDERR_NOHINSTANCE = 0x4;
const CDERR_FINDRESFAILURE = 0x6;
const CDERR_LOADRESFAILURE = 0x7;
const CDERR_NOHOOK = 0xb;
const CDERR_DIALOGFAILURE = 0xffff;

const SM_CYCAPTION = 4;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXSIZE = 30;
const COLOR_WINDOW = 5;
const GWL_WNDPROC = -4;
const GWL_STYLE = -16;
const GWW_ID = -12;
const WS_TABSTOP = 0x00010000;
const SRCCOPY = 0x00cc0020;
const SW_HIDE = 0;
const SW_SHOWNORMAL = 1;
const PS_SOLID = 0;
const WHITE_BRUSH = 0;
const NULL_BRUSH = 5;
const BLACK_PEN = 7;
const RT_DIALOG = 5;

/** The structure's fields, by offset. */
const HWND_OWNER = 0x04;
const H_INSTANCE = 0x06;
const RGB_RESULT = 0x08;
const CUST_COLORS = 0x0c;
const FLAGS = 0x10;
const HOOK = 0x18;
const TEMPLATE_NAME = 0x1c;

type Rect = [number, number, number, number];

/** A dialog's data (COMMDLG's 15Eh bytes). */
interface Dialog {
  hwnd: number;
  lpcc: number;
  rgb: number;
  hue: number;
  sat: number;
  lum: number;
  width: number;
  height: number;
  lumHeight: number;
  custom: number;
  basic: number;
  current: number;
  x: number;
  y: number;
  lumY: number;
  window: Rect;
  spectrum: Rect;
  mark: Rect;
  bar: Rect;
  colour: Rect;
  solid: Rect;
  sample: Rect;
  full: boolean;
  colours: number[];
}

const s16 = (value: number) => (value << 16) >> 16;
const u16 = (value: number) => value & 0xffff;
const u32 = (value: number) => value >>> 0;

function blank(): Dialog {
  return {
    hwnd: 0,
    lpcc: 0,
    rgb: 0,
    hue: 0,
    sat: 0,
    lum: 0,
    width: 0,
    height: 0,
    lumHeight: 0,
    custom: 0,
    basic: 0,
    current: 0,
    x: 0,
    y: 0,
    lumY: 0,
    window: [0, 0, 0, 0],
    spectrum: [0, 0, 0, 0],
    mark: [0, 0, 0, 0],
    bar: [0, 0, 0, 0],
    colour: [0, 0, 0, 0],
    solid: [0, 0, 0, 0],
    sample: [0, 0, 0, 0],
    full: false,
    colours: new Array(64).fill(0),
  };
}

const globals = (system: any) => stateOf(system).colour;
const get = (system: any, id: number): Dialog => globals(system).dialogs.get(id) ?? blank();
const put = (system: any, id: number, dialog: Dialog) => globals(system).dialogs.set(id, dialog);
const copy = (dialog: Dialog): Dialog => ({
  ...dialog,
  window: [...dialog.window] as Rect,
  spectrum: [...dialog.spectrum] as Rect,
  mark: [...dialog.mark] as Rect,
  bar: [...dialog.bar] as Rect,
  colour: [...dialog.colour] as Rect,
  solid: [...dialog.solid] as Rect,
  sample: [...dialog.sample] as Rect,
  colours: [...dialog.colours],
});

const rectOf = (r: Rect) => ({ left: r[0], top: r[1], right: r[2], bottom: r[3] });
const inRect = (r: Rect, x: number, y: number) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];

/** `IntersectRect`: the overlap, if any. */
function intersect(a: Rect, b: Rect): Rect | null {
  const r: Rect = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];

  return r[0] < r[2] && r[1] < r[3] ? r : null;
}

const item = (system: any, dialog: number, id: number) => GetDlgItem.call(system, dialog, id);
const metric = (system: any, index: number) => s16(GetSystemMetrics.call(system, index));

/** A window's rectangle on the screen. */
function windowRect(system: any, hwnd: number): Rect {
  const r: any = { left: 0, top: 0, right: 0, bottom: 0 };

  GetWindowRect.call(system, hwnd, r);
  return [s16(r.left), s16(r.top), s16(r.right), s16(r.bottom)];
}

/** A rectangle's two corners each taken to a window's client area, as COMMDLG's two calls of `ScreenToClient` do. */
function toClient(system: any, hwnd: number, r: Rect): Rect {
  const a: any = { x: r[0], y: r[1] };
  const b: any = { x: r[2], y: r[3] };

  ScreenToClient.call(system, hwnd, a);
  ScreenToClient.call(system, hwnd, b);
  return [s16(a.x), s16(a.y), s16(b.x), s16(b.y)];
}

function toScreen(system: any, hwnd: number, r: Rect): Rect {
  const a: any = { x: r[0], y: r[1] };
  const b: any = { x: r[2], y: r[3] };

  ClientToScreen.call(system, hwnd, a);
  ClientToScreen.call(system, hwnd, b);
  return [s16(a.x), s16(a.y), s16(b.x), s16(b.y)];
}

const invalidate = (system: any, hwnd: number, r: Rect) =>
  InvalidateRect.call(system, hwnd, rectOf(r), 0);
const validate = (system: any, hwnd: number, r: Rect) => ValidateRect.call(system, hwnd, rectOf(r));
const fill = (system: any, hdc: number, r: Rect, brush: number) =>
  FillRect.call(system, hdc, rectOf(r), brush);
const brushOf = (system: any, colour: number) => CreateSolidBrush.call(system, colour >>> 0);
const rectangle = (system: any, hdc: number, r: Rect) =>
  Rectangle.call(system, hdc, r[0], r[1], r[2], r[3]);
const nearest = (system: any, hdc: number, colour: number) =>
  GetNearestColor.call(system, hdc, colour >>> 0) >>> 0;
const setInt = (system: any, dialog: number, id: number, value: number) =>
  SetDlgItemInt.call(system, dialog, id, value, 0);

/** `GetDlgItemInt` unsigned: the number and whether it was one. */
async function getInt(system: any, dialog: number, id: number): Promise<[number, boolean]> {
  const [value, [flag]] = await withBlocks(system, [[0, 0]], ([far]) =>
    GetDlgItemInt.call(system, dialog, id, far, 0)
  );

  return [u16(value), flag[0] !== 0 || flag[1] !== 0];
}

/** Whether a control's text is not empty: `GetDlgItemText` into two bytes. */
async function hasText(system: any, dialog: number, id: number) {
  const [count] = await withBlocks(system, [[0, 0]], ([far]) =>
    GetDlgItemText.call(system, dialog, id, far, 2)
  );

  return !!count;
}

/** The number put back and selected (`0ab4`, `2b78`). */
const selectAll = (system: any, dialog: number, id: number) =>
  SendDlgItemMessage.call(system, dialog, id, EM_SETSEL, 0, 0x7fff0000);

/**
 * The Color dialog, run to its end.
 *
 * @returns {Types.BOOL} 1 for OK, nought for Cancel or a failure.
 */
export async function ChooseColor(this: any, lpcc: number) {
  return choose(this, lpcc >>> 0);
}

/** `ChooseColor` (seg1 `0ea1`). */
async function choose(system: any, lpcc: number): Promise<number> {
  const fail = (code: number | null) => {
    if (code !== null) {
      setError(system, code);
    }

    globals(system).hook = 0;
    return 0;
  };

  if (dword(system, lpcc) !== 0x20) {
    return 0;
  }

  const flags = dword(system, lpcc, FLAGS);

  if (flags & CC_ENABLEHOOK) {
    const hook = dword(system, lpcc, HOOK);

    if (!hook) {
      setError(system, CDERR_NOHOOK);
      return 0;
    }

    globals(system).hook = hook;
  } else {
    setDword(system, lpcc, HOOK, 0);
  }

  const program = word(system, lpcc, H_INSTANCE);
  let handle: number;
  let own = false;

  if (flags & CC_ENABLETEMPLATEHANDLE) {
    if (!program) {
      return fail(CDERR_NOTEMPLATE);
    }

    handle = program;
  } else if (flags & CC_ENABLETEMPLATE) {
    const name = dword(system, lpcc, TEMPLATE_NAME);

    if (!name) {
      return fail(CDERR_NOTEMPLATE);
    }

    if (!program) {
      return fail(CDERR_NOHINSTANCE);
    }

    const found = FindResource.call(system, program, lpcstr(system, name), RT_DIALOG);

    if (!found) {
      return fail(CDERR_FINDRESFAILURE);
    }

    handle = await LoadResource.call(system, program, found);

    if (!handle) {
      return fail(CDERR_LOADRESFAILURE);
    }
  } else {
    handle = await ownTemplate(system, COLOR_TEMPLATE);
    own = true;
  }

  if (!(LockResource.call(system, handle) >>> 0)) {
    return fail(null);
  }

  let answer = u16(
    await DialogBoxIndirectParam.call(
      system,
      instance(system),
      handle,
      word(system, lpcc, HWND_OWNER),
      procAddress(system, 8),
      lpcc
    )
  );

  if (answer === 0xffff) {
    setError(system, CDERR_DIALOGFAILURE);
    answer = 0;
  }

  GlobalUnlock.call(system, handle);

  if (own) {
    freeTemplate(system, handle);
  }

  globals(system).hook = 0;
  return answer;
}

/** The dialog's procedure, COMMDLG's export 8 (seg1 `0197`). */
export async function ColorDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return procedure(this, hwnd, message, wParam, lParam >>> 0);
}

/** The dialog's number under its property: nought before it starts. */
const numberOf = (system: any, hwnd: number) => GetProp.call(system, hwnd, 0xa000);

async function procedure(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
): Promise<number> {
  const id = numberOf(system, hwnd);

  if (id) {
    const lpcc = get(system, id).lpcc;

    if (dword(system, lpcc, FLAGS) & CC_ENABLEHOOK) {
      const answer = await callHook(
        system,
        dword(system, lpcc, HOOK),
        hwnd,
        message,
        wParam,
        lParam
      );

      if (answer) {
        return answer;
      }
    }
  }

  const x = s16(lParam);
  const y = s16(lParam >>> 16);

  switch (message) {
    case WM_MOVE: {
      const d = copy(get(system, id));

      measure(system, d);
      put(system, id, d);
      return 0;
    }
    case WM_PAINT: {
      const ps: any = new PAINTSTRUCT();
      const hdc = await BeginPaint.call(system, hwnd, ps);
      const r = ps.rcPaint;

      await paint(system, hwnd, id, hdc, [s16(r.left), s16(r.top), s16(r.right), s16(r.bottom)]);
      EndPaint.call(system, hwnd, ps);
      break;
    }
    case WM_GETDLGCODE:
      return 0x0d;
    case WM_KEYDOWN: {
      const index = await key(system, id, wParam);

      if (index !== null) {
        await moveFocus(system, id, index);
      }

      break;
    }
    case WM_CHAR:
      if (wParam === 0x20) {
        return space(system, hwnd, id);
      }

      break;
    case WM_INITDIALOG: {
      await waitCursor(system, true);

      const answer = await start(system, hwnd, wParam, lParam);

      await waitCursor(system, false);

      if (answer) {
        await ShowWindow.call(system, hwnd, SW_SHOWNORMAL);
      }

      return answer;
    }
    case WM_COMMAND:
      return command(system, hwnd, id, wParam, lParam);
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
      if (message === WM_MOUSEMOVE && !globals(system).tracking) {
        return 1;
      }

      return press(system, hwnd, id, message, x, y);
    case WM_LBUTTONUP:
      if (globals(system).tracking) {
        globals(system).tracking = false;
        SetCapture.call(system, 0);
        ClipCursor.call(system, null);

        const d = copy(get(system, id));

        if (inRect(d.spectrum, x, y)) {
          const hdc = GetDC.call(system, hwnd);

          d.x = u16(x);
          d.y = u16(y);
          put(system, id, d);
          await cross(system, hdc, d.x, d.y, d);
          await paintParts(system, d, hdc, d.bar);
          ReleaseDC.call(system, hwnd, hdc);
          validate(system, hwnd, d.spectrum);
        } else if (inRect(d.bar, x, y)) {
          const hdc = GetDC.call(system, hwnd);

          arrow(system, hdc, d);
          ReleaseDC.call(system, hwnd, hdc);
          validate(system, hwnd, d.bar);
        }
      }

      break;
    case WM_LBUTTONDBLCLK:
      if (inRect(get(system, id).solid, x, y)) {
        await solid(system, id);
      }

      break;
    default: {
      if (message !== registered(system, 'commdlg_SetRGBColor')) {
        return 0;
      }

      const d = copy(get(system, id));

      if (await findColour(system, d, lParam)) {
        d.rgb = lParam;

        if (d.custom > d.current) {
          d.basic = d.current;
        } else {
          d.custom = d.current;
        }
      }

      put(system, id, d);

      if (d.full) {
        const next = copy(get(system, id));

        next.rgb = lParam;
        put(system, id, next);
        await rgbChanged(system, id);
        await setHlsEdits(system, id, 0);
        await setRgbEdits(system, id, 0);

        const hdc = GetDC.call(system, hwnd);
        const now = get(system, id);

        await paintParts(system, now, hdc, now.sample);
        ReleaseDC.call(system, hwnd, hdc);
      }
    }
  }

  return 1;
}

/** The colour looked for among the 64 boxes; found, it is chosen (`014e`). */
async function findColour(system: any, d: Dialog, rgb: number) {
  const index = d.colours.findIndex((colour) => colour === rgb >>> 0);

  if (index < 0) {
    return false;
  }

  await chooseBox(system, d, index);
  d.current = index;
  return true;
}

/** A box's frame, black or the window's colour, a pixel outside it (`1023`). */
function frame(system: any, hdc: number, index: number, black: boolean) {
  const b = globals(system).boxes[index];
  const brush = brushOf(system, black ? 0 : GetSysColor.call(system, COLOR_WINDOW));

  FrameRect.call(system, hdc, rectOf([b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1]), brush);
  DeleteObject.call(system, brush);
}

/** A box chosen: its frame moved to it, and the colour taken (`1086`). */
async function chooseBox(system: any, d: Dialog, index: number) {
  const hdc = GetDC.call(system, d.hwnd);

  frame(system, hdc, d.current, false);
  frame(system, hdc, index, true);
  ReleaseDC.call(system, d.hwnd, hdc);
  d.rgb = d.colours[index];
}

/** The focus box moved within its grid (`10d9`): the old one's focus rectangle drawn over in the window's colour, the new one's drawn. */
async function moveFocus(system: any, id: number, index: number) {
  const d = copy(get(system, id));
  const pen = CreatePen.call(system, PS_SOLID, 1, GetSysColor.call(system, COLOR_WINDOW));
  const hollow = GetStockObject.call(system, NULL_BRUSH);
  const hdc = GetDC.call(system, d.hwnd);
  const oldPen = SelectObject.call(system, hdc, pen);
  const oldBrush = SelectObject.call(system, hdc, hollow);
  const custom = index >= 0x30;
  const old = custom ? d.custom : d.basic;
  const inflated = (i: number): Rect => {
    const b = globals(system).boxes[i];

    return [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
  };

  rectangle(system, hdc, inflated(old));

  if (custom) {
    d.custom = index;
  } else {
    d.basic = index;
  }

  put(system, id, d);

  const r = inflated(index);

  rectangle(system, hdc, r);
  DrawFocusRect.call(system, hdc, rectOf(r));

  const made = SelectObject.call(system, hdc, oldPen);

  SelectObject.call(system, hdc, oldBrush);
  ReleaseDC.call(system, d.hwnd, hdc);
  DeleteObject.call(system, made);
}

/** The keys of a grid (`11ff`): the box the focus moves to, if it moves to one not chosen in either grid. */
async function key(system: any, id: number, vk: number): Promise<number | null> {
  const d = get(system, id);
  const control = u16(GetWindowWord.call(system, GetFocus.call(system), GWW_ID));
  let i: number;

  if (control === ID_BASIC) {
    i = d.basic;
  } else if (control === ID_CUSTOM) {
    i = d.custom;
  } else {
    return null;
  }

  const count = u16(globals(system).count);

  switch (vk) {
    case 0x23:
      i = d.basic === i ? u16(count - 1) : 0x3f;
      break;
    case 0x24:
      i = d.basic === i ? 0 : 0x30;
      break;
    case 0x25:
      if (i & 7) {
        i--;
      }

      break;
    case 0x26:
      if (i >= 0x38 || (i >= 8 && i < 0x30)) {
        i -= 8;
      }

      break;
    case 0x27:
      i++;

      if (!(i & 7)) {
        i--;
      }

      break;
    case 0x28:
      if (i < 0x28 || (i >= 0x30 && i < 0x38)) {
        i += 8;
      }

      break;
  }

  if (count <= i && i < 0x30) {
    i = d.basic;
  }

  return i !== d.basic && i !== d.custom ? i : null;
}

/** Space on a grid: its focus box chosen (`0751`). */
async function space(system: any, hwnd: number, id: number): Promise<number> {
  const focus = GetFocus.call(system);
  const d = copy(get(system, id));
  let index: number;

  if (item(system, hwnd, ID_BASIC) === focus) {
    index = d.basic;
  } else if (item(system, hwnd, ID_CUSTOM) === focus) {
    index = d.custom;
  } else {
    return 0;
  }

  d.rgb = d.colours[index];
  put(system, id, d);
  await rgbChanged(system, id);

  const next = copy(get(system, id));

  await invalidate(system, hwnd, next.sample);
  await chooseBox(system, next, index);
  next.current = index;
  put(system, id, next);

  if (next.full) {
    await setHlsEdits(system, id, 0);
    await setRgbEdits(system, id, 0);
  }

  return 1;
}

/** The rectangles measured (`1654`). */
function measure(system: any, d: Dialog) {
  const hwnd = d.hwnd;
  const half = metric(system, SM_CXSIZE) >> 1;
  const s = windowRect(system, item(system, hwnd, ID_SPECTRUM));

  d.spectrum = toClient(system, hwnd, [s[0] + 1, s[1] + 1, s[2] - 1, s[3] - 1]);

  const b = windowRect(system, item(system, hwnd, ID_LUMINOSITY));

  b[2] = s16(b[2] + half);
  d.bar = toClient(system, hwnd, b);
  d.mark = [d.bar[2], d.bar[1], d.bar[2] + half, d.bar[3]];
  d.lumHeight = u16(d.bar[3] - d.bar[1]);

  const c = windowRect(system, item(system, hwnd, ID_SAMPLE));
  const left = c[0] + 1;
  const middle = Math.trunc((c[2] + left) / 2);

  d.colour = toClient(system, hwnd, [left, c[1] + 1, middle, c[3] - 1]);
  d.solid = toClient(system, hwnd, [middle, c[1] + 1, c[2] - 1, c[3] - 1]);
  d.sample = [d.colour[0], d.colour[1], d.solid[2], d.solid[3]];
}

/** The display driver's colours, `OEMBIN` 2: how many, at most 48, and they; none without it. */
async function displayColours(system: any): Promise<[number, number[]]> {
  const module = GetModuleHandle.call(system, 'DISPLAY');
  const found = FindResource.call(system, module, 2, 'OEMBIN');

  if (!found) {
    return [0, []];
  }

  const loaded = await LoadResource.call(system, module, found);

  if (!loaded) {
    return [0, []];
  }

  const far = LockResource.call(system, loaded) >>> 0;
  let count = 0;
  const colours: number[] = [];

  if (far) {
    count = Math.min(s16(word(system, far)), 0x30);

    for (let i = 0; i < Math.max(count, 0); i++) {
      colours.push(dword(system, far, 2 + i * 4));
    }

    GlobalUnlock.call(system, loaded);
  }

  FreeResource.call(system, loaded);
  return [count, colours];
}

/** The grids measured and subclassed, and the basic colours read (`139a`). */
async function grids(system: any, d: Dialog) {
  const hwnd = d.hwnd;
  const basic = item(system, hwnd, ID_BASIC);
  const custom = item(system, hwnd, ID_CUSTOM);
  const g = globals(system);

  g.staticProc = GetWindowLong.call(system, basic, GWL_WNDPROC) >>> 0;

  for (const grid of [basic, custom]) {
    SetWindowLong.call(system, grid, GWL_WNDPROC, procAddress(system, 25));
  }

  const r = toClient(system, hwnd, windowRect(system, basic));
  let left = r[0] + 3;
  let top = r[1] + 3;
  const pitchW = Math.trunc((r[2] - 3 - left) / 8);
  const pitchH = Math.trunc((r[3] - 3 - top) / 6);
  const [count, colours] = await displayColours(system);
  const boxes: number[][] = new Array(64).fill(null).map(() => [0, 0, 0, 0]);

  for (let i = 0; i < 48; i++) {
    const l = (i % 8) * pitchW + left;
    const t = Math.trunc(i / 8) * pitchH + top;

    boxes[i] = [l, t, l + pitchW - 5, t + pitchH - 5];
    d.colours[i] = i < count ? colours[i] : count !== 0 ? 0x00ffffff : BASIC_COLOURS[i];
  }

  const c = toClient(system, hwnd, windowRect(system, custom));

  left = c[0] + 3;
  top = c[1] + 3;

  for (let j = 0; j < 16; j++) {
    const l = (j % 8) * pitchW + left;
    const t = Math.trunc(j / 8) * pitchH + top;

    boxes[0x30 + j] = [l, t, l + pitchW - 5, t + pitchH - 5];
  }

  g.boxes = boxes;
  g.pitch = [pitchW, pitchH];
  g.count = count === 0 ? 0x30 : count;
}

/** `WM_INITDIALOG` (`17c5`). */
async function start(system: any, hwnd: number, wParam: number, lpcc: number): Promise<number> {
  const solidButton = item(system, hwnd, ID_SOLID);
  const g = globals(system);

  if (!g.memoryDc) {
    const hdc = GetDC.call(system, hwnd);
    const memory = CreateCompatibleDC.call(system, hdc);

    ReleaseDC.call(system, hwnd, hdc);
    g.memoryDc = memory;

    if (!memory) {
      return 0;
    }
  }

  const id = nextNumber(system);

  SetProp.call(system, hwnd, 0xa000, id);
  g.hook = dword(system, lpcc, HOOK);

  const first = blank();

  first.hwnd = hwnd;
  first.lpcc = lpcc;
  measure(system, first);

  const flags = dword(system, lpcc, FLAGS);

  first.rgb = flags & CC_RGBINIT ? dword(system, lpcc, RGB_RESULT) : 0;
  put(system, id, first);

  if (flags & (CC_FULLOPEN | CC_PREVENTFULLOPEN)) {
    await EnableWindow.call(system, item(system, hwnd, ID_DEFINE), 0);
  }

  if (flags & CC_FULLOPEN) {
    await drawSpectrum(system, id);

    const d = copy(get(system, id));
    const [h, l, s] = rgbToHls(d.rgb);

    d.full = true;
    d.hue = h;
    d.sat = s;
    d.lum = l;
    put(system, id, d);
    await setRgbEdits(system, id, 0);
    await setHlsEdits(system, id, 0);
  } else {
    for (let control = ID_HUE; control <= ID_BLUE; control++) {
      await EnableWindow.call(system, item(system, hwnd, control), 0);
    }

    for (let control = ID_HUE_LABEL; control <= ID_BLUE_LABEL; control++) {
      await EnableWindow.call(system, item(system, hwnd, control), 0);
    }

    await EnableWindow.call(system, item(system, hwnd, ID_ADD), 0);
    await EnableWindow.call(system, solidButton, 0);

    const d = copy(get(system, id));

    d.full = false;

    const basic = windowRect(system, item(system, hwnd, ID_BASIC));
    const spectrum = windowRect(system, item(system, hwnd, ID_SPECTRUM));
    const w = windowRect(system, hwnd);

    d.window = w;
    put(system, id, d);
    await MoveWindow.call(
      system,
      hwnd,
      w[0],
      w[1],
      s16(Math.trunc((spectrum[0] + basic[2]) / 2) - w[0]),
      s16(w[3] - w[1]),
      0
    );
  }

  const d = copy(get(system, id));

  await grids(system, d);

  const custom = dword(system, lpcc, CUST_COLORS);

  for (let i = 0; i < 16; i++) {
    d.colours[0x30 + i] = dword(system, custom, i * 4);
  }

  d.basic = 0;
  d.current = 0;
  d.custom = 0x30;
  await findColour(system, d, d.rgb);

  if (d.custom > d.current) {
    d.basic = d.current;
  } else {
    d.custom = d.current;
  }

  put(system, id, d);

  if (!(flags & CC_SHOWHELP)) {
    const help = item(system, hwnd, PSH_HELP);

    await EnableWindow.call(system, help, 0);
    await ShowWindow.call(system, help, SW_HIDE);
  }

  const style = GetWindowLong.call(system, solidButton, GWL_STYLE) >>> 0;

  SetWindowLong.call(system, solidButton, GWL_STYLE, (style & ~WS_TABSTOP) >>> 0);

  if (flags & CC_ENABLEHOOK) {
    return callHook(system, dword(system, lpcc, HOOK), hwnd, WM_INITDIALOG, wParam, lpcc);
  }

  return 1;
}

/** The spectrum drawn into its bitmap, and the numbers and marks set from the colour (`23f8`). */
async function drawSpectrum(system: any, id: number) {
  const d = copy(get(system, id));
  const [h, l, s] = rgbToHls(d.rgb);

  measure(system, d);
  d.width = u16(d.spectrum[2] - d.spectrum[0]);
  d.height = u16(d.spectrum[3] - d.spectrum[1]);
  d.hue = h;
  d.sat = s;
  d.lum = l;
  positions(d, 0);
  put(system, id, d);
  await setRgbEdits(system, id, 0);
  await setHlsEdits(system, id, 0);

  const hwnd = d.hwnd;
  const g = globals(system);
  let hdc = 0;

  if (!g.spectrum) {
    hdc = GetDC.call(system, hwnd);
    g.spectrum = CreateCompatibleBitmap.call(system, hdc, d.width, d.height);

    if (!g.spectrum) {
      return false;
    }
  }

  const memory = g.memoryDc;
  const old = SelectObject.call(system, memory, g.spectrum);
  let bottom = 0;

  for (let sat = 240; sat !== 0; sat -= 8) {
    const top = bottom;

    bottom = s16(Math.floor(u32(240 * d.height - (sat - 8) * d.height) / 240));

    let right = 0;

    for (let hue = 0; hue < 239; hue += 4) {
      const left = right;

      right = s16(Math.floor(((hue + 4) * d.width) / 240));

      const brush = brushOf(system, hlsToRgb(hue, 120, sat));

      fill(system, memory, [left, top, right, bottom], brush);
      DeleteObject.call(system, brush);
    }
  }

  SelectObject.call(system, memory, old);

  if (hdc) {
    ReleaseDC.call(system, hwnd, hdc);
  }

  await UpdateWindow.call(system, hwnd);
  return true;
}

/** Hue, saturation and luminosity from where the marks are (`21ba`). */
function numbers(d: Dialog, id: number) {
  const hue = (less: number) => {
    const span = u16(d.width - less) || 1;

    return u16(Math.floor((u16(s16(d.x) - d.spectrum[0]) * 239) / span));
  };
  const sat = (less: number) => {
    const span = u16(d.height - less) || 1;

    return u16(240 - Math.floor((u16(s16(d.y) - d.spectrum[1]) * 240) / span));
  };
  const lum = (less: number) => {
    const span = u16(d.lumHeight - less) || 1;

    return u16(240 - Math.floor((u16(s16(d.lumY) - d.bar[1]) * 240) / span));
  };

  if (id === ID_HUE) {
    d.hue = hue(1);
  } else if (id === ID_SAT) {
    d.sat = sat(1);
  } else if (id === ID_LUM) {
    d.lum = lum(1);
  } else {
    d.hue = hue(0);
    d.sat = sat(0);
    d.lum = lum(0);
  }
}

/** Where the marks go for the numbers (`2276`). */
function positions(d: Dialog, id: number) {
  const x = () => u16(s16(u16(Math.floor((d.hue * d.width) / 239))) + d.spectrum[0]);
  const y = () =>
    u16(s16(u16(Math.floor((u16(240 - d.sat) * u16(d.height - 1)) / 240))) + d.spectrum[1]);
  const lumY = () =>
    u16(s16(u16(Math.floor((u16(240 - d.lum) * u16(d.lumHeight - 1)) / 240))) + d.bar[1]);

  if (id === ID_HUE) {
    d.x = x();
  } else if (id === ID_SAT) {
    d.y = y();
  } else if (id === ID_LUM) {
    d.lumY = lumY();
  } else {
    d.x = x();
    d.y = y();
    d.lumY = lumY();
  }
}

/** The hue, saturation and luminosity controls set (`2314`). */
async function setHlsEdits(system: any, id: number, which: number) {
  const d = get(system, id);

  if (which === ID_HUE) {
    await setInt(system, d.hwnd, ID_HUE, d.hue);
  } else if (which === ID_SAT) {
    await setInt(system, d.hwnd, ID_SAT, d.sat);
  } else if (which === ID_LUM) {
    await setInt(system, d.hwnd, ID_LUM, d.lum);
  } else {
    await setInt(system, d.hwnd, ID_HUE, d.hue);
    await setInt(system, d.hwnd, ID_SAT, get(system, id).sat);
    await setInt(system, d.hwnd, ID_LUM, get(system, id).lum);
  }
}

/** The red, green and blue controls set (`237b`): from the colour as the call began. */
async function setRgbEdits(system: any, id: number, which: number) {
  const d = get(system, id);
  const rgb = d.rgb;
  const part = (shift: number) => (rgb >>> shift) & 0xff;

  if (which === ID_RED) {
    await setInt(system, d.hwnd, ID_RED, part(0));
  } else if (which === ID_GREEN) {
    await setInt(system, d.hwnd, ID_GREEN, part(8));
  } else if (which === ID_BLUE) {
    await setInt(system, d.hwnd, ID_BLUE, part(16));
  } else {
    await setInt(system, d.hwnd, ID_RED, part(0));
    await setInt(system, d.hwnd, ID_GREEN, part(8));
    await setInt(system, d.hwnd, ID_BLUE, part(16));
  }
}

/** The colour changed: its hue, saturation and luminosity, the marks moved and the bar painted again where they changed (`1c52`). */
async function rgbChanged(system: any, id: number) {
  const first = get(system, id);
  const [h, l, s] = rgbToHls(first.rgb);
  const hwnd = first.hwnd;

  if (first.lum !== l) {
    const hdc = GetDC.call(system, hwnd);

    eraseArrow(system, hdc, get(system, id));

    const d = copy(get(system, id));

    d.lum = l;
    positions(d, ID_LUM);
    put(system, id, d);
    arrow(system, hdc, d);
    ReleaseDC.call(system, hwnd, hdc);
  }

  const d = copy(get(system, id));

  if (d.hue !== h || d.sat !== s) {
    d.hue = h;
    d.sat = s;
    put(system, id, d);
    await invalidate(system, hwnd, d.bar);

    const hdc = GetDC.call(system, hwnd);

    eraseCross(system, hdc, d);
    positions(d, ID_HUE);
    positions(d, ID_SAT);
    put(system, id, d);
    await cross(system, hdc, d.x, d.y, d);
    ReleaseDC.call(system, hwnd, hdc);
  }
}

/** The luminosity's mark (`1d0b`): a triangle, black-edged and white, pointing at the bar from its right. */
async function arrow(system: any, hdc: number, d: Dialog) {
  const c = metric(system, SM_CYCAPTION) >> 2;
  const y = s16(d.lumY);
  const points = [d.mark[0] + 2, y, d.mark[2] - 1, y - c, d.mark[2] - 1, y + c];
  const bytes = points.flatMap((value) => [value & 0xff, (value >> 8) & 0xff]);
  const oldPen = SelectObject.call(system, hdc, GetStockObject.call(system, BLACK_PEN));
  const oldBrush = SelectObject.call(system, hdc, GetStockObject.call(system, WHITE_BRUSH));

  await withBlocks(system, [bytes], ([far]) => Polygon.call(system, hdc, far, 3));
  SelectObject.call(system, hdc, oldPen);
  SelectObject.call(system, hdc, oldBrush);
}

/** The mark taken away: filled with the window's colour (`1d96`). */
function eraseArrow(system: any, hdc: number, d: Dialog) {
  const brush = brushOf(system, nearest(system, hdc, GetSysColor.call(system, COLOR_WINDOW)));
  const c = metric(system, SM_CYCAPTION) >> 2;
  const y = s16(d.lumY);

  fill(system, hdc, [d.mark[0] + 1, y - c - 1, d.mark[2], y + c + 1], brush);
  DeleteObject.call(system, brush);
}

/** The cross taken away: the spectrum copied back round it (`1dfd`). */
function eraseCross(system: any, hdc: number, d: Dialog) {
  const r = d.spectrum;
  const dy = u16(10 * metric(system, SM_CYBORDER));
  const dx = u16(10 * metric(system, SM_CXBORDER));
  const below = (v: number, floor: number) => (v < u16(floor) ? u16(floor) : v);
  const above = (v: number, ceiling: number) => (v > u16(ceiling) ? u16(ceiling) : v);
  const top = below(u16(d.y - dy), r[1]);
  const bottom = above(u16(d.y + dy), r[3]);
  const left = below(u16(d.x - dx), r[0]);
  const right = above(u16(d.x + dx), r[2]);
  const g = globals(system);
  const old = SelectObject.call(system, g.memoryDc, g.spectrum);

  BitBlt.call(
    system,
    hdc,
    s16(left),
    s16(top),
    s16(right - left),
    s16(bottom - top),
    g.memoryDc,
    s16(left - u16(r[0])),
    s16(top - u16(r[1])),
    SRCCOPY
  );
  SelectObject.call(system, g.memoryDc, old);
}

/** The cross at a point (`1ec7`): four arms of three lines each, kept inside the spectrum, in the DC's pen. */
async function cross(system: any, hdc: number, px: number, py: number, d: Dialog) {
  const [left, top, right, bottom] = d.spectrum;
  const x = s16(px);
  const y = s16(py);
  const a = s16(5 * metric(system, SM_CYBORDER));
  const b = s16(5 * metric(system, SM_CXBORDER));
  const yUp2 = Math.max(y - 2 * a, top);
  const yDown2 = Math.min(y + 2 * a, bottom);
  const xLeft2 = Math.max(x - 2 * b, left);
  const xRight2 = Math.min(x + 2 * b, right);
  const yUp = Math.max(y - a, top);
  const yDown = Math.min(a + y, bottom);
  const xLeft = Math.max(x - b, left);
  const xRight = Math.min(b + x, right);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    MoveTo.call(system, hdc, x0, y0);
    LineTo.call(system, hdc, x1, y1);
  };
  const columns: [number, boolean][] = [
    [x - 1, x - 1 >= left],
    [x, x < right],
    [x + 1, x + 1 < right],
  ];
  const rows: [number, boolean][] = [
    [y - 1, y - 1 >= top],
    [y, y < bottom],
    [y + 1, y + 1 < bottom],
  ];

  if (yUp > top) {
    for (const [column, shown] of columns) {
      if (shown) {
        line(column, yUp, column, yUp2);
      }
    }
  }

  if (bottom > yDown) {
    for (const [column, shown] of columns) {
      if (shown) {
        line(column, yDown, column, yDown2);
      }
    }
  }

  if (left < xLeft) {
    for (const [row, shown] of rows) {
      if (shown) {
        line(xLeft, row, xLeft2, row);
      }
    }
  }

  if (right > xRight) {
    for (const [row, shown] of rows) {
      if (shown) {
        line(xRight, row, xRight2, row);
      }
    }
  }
}

/** The spectrum copied to the dialog where it is to be painted, and the cross drawn (`255d`). */
async function copySpectrum(system: any, hdc: number, area: Rect, d: Dialog) {
  const g = globals(system);

  if (!g.spectrum) {
    return;
  }

  const old = SelectObject.call(system, g.memoryDc, g.spectrum);

  BitBlt.call(
    system,
    hdc,
    area[0],
    area[1],
    area[2] - area[0],
    area[3] - area[1],
    g.memoryDc,
    area[0] - d.spectrum[0],
    area[1] - d.spectrum[1],
    SRCCOPY
  );
  SelectObject.call(system, g.memoryDc, old);
  await cross(system, hdc, d.x, d.y, d);
  await UpdateWindow.call(system, d.hwnd);
}

/** The sample, the bar, its mark and the spectrum, each where it meets the area painted (`25e4`). */
async function paintParts(system: any, d: Dialog, hdc: number, area: Rect) {
  const colour = intersect(area, d.colour);

  if (colour) {
    const brush = brushOf(system, d.rgb);

    fill(system, hdc, colour, brush);
    DeleteObject.call(system, brush);
  }

  const solidPart = intersect(area, d.solid);

  if (solidPart) {
    const brush = brushOf(system, nearest(system, hdc, d.rgb));

    fill(system, hdc, solidPart, brush);
    DeleteObject.call(system, brush);
  }

  if (intersect(area, d.bar)) {
    const bar = d.bar;
    const r: Rect = [bar[0], bar[3] - 4, bar[2], bar[3]];
    let brush = brushOf(system, hlsToRgb(d.hue, 0, d.sat));

    fill(system, hdc, r, brush);
    DeleteObject.call(system, brush);

    for (let lum = 8; lum < 240; lum += 8) {
      r[3] = r[1];
      r[1] = s16(Math.floor(u32((bar[3] + 4) * 240 - d.lumHeight * (lum + 8)) / 240));
      brush = brushOf(system, hlsToRgb(d.hue, lum, d.sat));
      fill(system, hdc, r, brush);
      DeleteObject.call(system, brush);
    }

    r[3] = r[1];
    r[1] = bar[1];
    brush = brushOf(system, hlsToRgb(d.hue, 240, d.sat));
    fill(system, hdc, r, brush);
    DeleteObject.call(system, brush);

    if (area[0] !== bar[0] || area[1] !== bar[1] || area[2] !== bar[2] || area[3] !== bar[3]) {
      const old = SelectObject.call(system, hdc, GetStockObject.call(system, NULL_BRUSH));

      rectangle(system, hdc, [bar[0] - 1, bar[1] - 1, bar[2] + 1, bar[3] + 1]);
      SelectObject.call(system, hdc, old);
    }
  }

  if (intersect(area, d.mark)) {
    await arrow(system, hdc, d);
  }

  const spectrum = intersect(area, d.spectrum);

  if (spectrum) {
    await copySpectrum(system, hdc, spectrum, d);
  }
}

/** A box drawn: a rectangle in the DC's pen, filled with its colour, and the chosen one's frame (`1316`). */
function drawBox(system: any, d: Dialog, hdc: number, index: number) {
  const g = globals(system);

  if (index < 0x30 && index >= u16(g.count)) {
    return;
  }

  const brush = brushOf(system, d.colours[index]);
  const old = SelectObject.call(system, hdc, brush);

  rectangle(system, hdc, g.boxes[index] as Rect);
  DeleteObject.call(system, SelectObject.call(system, hdc, old));

  if (d.current === index) {
    frame(system, hdc, index, true);
  }
}

/** `WM_PAINT` (`1aaf`). */
async function paint(system: any, hwnd: number, id: number, hdc: number, area: Rect) {
  const d = get(system, id);
  const count = u16(globals(system).count);

  for (let index = 0; index < count; index++) {
    drawBox(system, d, hdc, index);
  }

  for (let index = 0x30; index < 0x40; index++) {
    drawBox(system, d, hdc, index);
  }

  const focus = GetFocus.call(system);

  if (item(system, hwnd, ID_BASIC) === focus) {
    await moveFocus(system, id, d.basic);
  } else if (item(system, hwnd, ID_CUSTOM) === focus) {
    await moveFocus(system, id, d.custom);
  }

  await paintParts(system, get(system, id), hdc, area);
}

/** A press, or a move with the mouse captured (`02e7`). */
async function press(
  system: any,
  hwnd: number,
  id: number,
  message: number,
  x: number,
  y: number
): Promise<number> {
  const d = get(system, id);

  if (inRect(d.spectrum, x, y)) {
    if (message === WM_LBUTTONDOWN) {
      const hdc = GetDC.call(system, hwnd);

      eraseCross(system, hdc, d);
      ReleaseDC.call(system, hwnd, hdc);
    }

    let next = copy(get(system, id));

    next.x = u16(x);
    numbers(next, ID_HUE);
    put(system, id, next);
    await setHlsEdits(system, id, ID_HUE);
    next = copy(get(system, id));
    next.y = u16(y);
    numbers(next, ID_SAT);
    put(system, id, next);
    await setHlsEdits(system, id, ID_SAT);
    next = copy(get(system, id));
    next.rgb = hlsToRgb(next.hue, next.lum, next.sat);
    put(system, id, next);

    const hdc = GetDC.call(system, hwnd);

    await paintParts(system, next, hdc, next.bar);
    await paintParts(system, next, hdc, next.sample);
    ReleaseDC.call(system, hwnd, hdc);
    await setRgbEdits(system, id, 0);

    if (!globals(system).tracking) {
      capture(system, hwnd, next.spectrum);
    }

    return 1;
  }

  if (inRect(d.bar, x, y) || inRect(d.mark, x, y)) {
    const hdc = GetDC.call(system, hwnd);

    eraseArrow(system, hdc, d);

    let next = copy(get(system, id));

    next.lumY = u16(y);
    put(system, id, next);
    await arrow(system, hdc, next);
    numbers(next, ID_LUM);
    put(system, id, next);
    await setHlsEdits(system, id, ID_LUM);
    next = copy(get(system, id));
    next.rgb = hlsToRgb(next.hue, next.lum, next.sat);
    put(system, id, next);
    await paintParts(system, next, hdc, next.sample);
    ReleaseDC.call(system, hwnd, hdc);
    validate(system, hwnd, next.mark);
    validate(system, hwnd, next.sample);
    await setRgbEdits(system, id, 0);

    if (!globals(system).tracking) {
      capture(system, hwnd, next.mark);
    }

    return 1;
  }

  /* A grid (`04db`). */
  const child = ChildWindowFromPoint.call(system, hwnd, ((u16(y) << 16) | u16(x)) >>> 0);
  const boxes = globals(system).boxes;
  let area: Rect;
  let rows: number;
  let base: number;

  if (child === item(system, hwnd, ID_BASIC)) {
    area = [boxes[0][0], boxes[0][1], boxes[0x2f][2] + 5, boxes[0x2f][3] + 5];
    rows = 6;
    base = 0;
  } else if (child === item(system, hwnd, ID_CUSTOM)) {
    area = [boxes[0x30][0], boxes[0x30][1], boxes[0x3f][2] + 5, boxes[0x3f][3] + 5];
    rows = 2;
    base = 0x30;
  } else {
    return 0;
  }

  if (GetFocus.call(system) !== child) {
    await SetFocus.call(system, child);
  }

  const [pitchW, pitchH] = globals(system).pitch;
  const ux = u16(x);
  const uy = u16(y);

  if (uy >= u16(area[3]) || ux >= u16(area[2])) {
    return 1;
  }

  const dx = u16(ux - u16(area[0]));
  const dy = u16(uy - u16(area[1]));

  if (dx % u16(pitchW) >= u16(pitchW - 5) || dy % u16(pitchH) >= u16(pitchH - 5)) {
    return 1;
  }

  const row = u16(Math.floor((dy * rows) / u16(area[3] - area[1])));
  const column = u16(Math.floor((dx << 3) / u16(area[2] - area[0])));
  const index = base + (row << 3) + column;
  const count = u16(globals(system).count);

  if (s16(index) < s16(count) || index >= 0x30) {
    let next = copy(get(system, id));

    await chooseBox(system, next, index);
    next.current = index;
    put(system, id, next);
    await moveFocus(system, id, index);
    next = copy(get(system, id));

    if (index >= 0x30) {
      next.custom = next.current;
    } else {
      next.basic = next.current;
    }

    next.rgb = next.colours[next.current];
    put(system, id, next);

    const hdc = GetDC.call(system, hwnd);

    if (next.full) {
      await rgbChanged(system, id);
      await setHlsEdits(system, id, 0);
      await setRgbEdits(system, id, 0);
      await paintParts(system, get(system, id), hdc, next.sample);
    }

    const now = get(system, id);

    drawBox(system, now, hdc, now.basic);
    drawBox(system, now, hdc, now.custom);
    ReleaseDC.call(system, hwnd, hdc);
  }

  return 1;
}

/** The mouse captured and the cursor kept in a rectangle. */
function capture(system: any, hwnd: number, r: Rect) {
  SetCapture.call(system, hwnd);
  ClipCursor.call(system, rectOf(toScreen(system, hwnd, r)));
  globals(system).tracking = true;
}

/** The colour made its nearest pure one (`2115`). */
async function solid(system: any, id: number) {
  const first = get(system, id);
  const hwnd = first.hwnd;
  const hdc = GetDC.call(system, hwnd);

  eraseCross(system, hdc, first);
  eraseArrow(system, hdc, first);

  const d = copy(get(system, id));

  d.rgb = nearest(system, hdc, d.rgb);

  const [h, l, s] = rgbToHls(d.rgb);

  d.hue = h;
  d.lum = l;
  d.sat = s;
  positions(d, 0);
  put(system, id, d);
  await cross(system, hdc, d.x, d.y, d);
  await arrow(system, hdc, d);
  ReleaseDC.call(system, hwnd, hdc);
  await setHlsEdits(system, id, 0);
  await setRgbEdits(system, id, 0);
  await invalidate(system, hwnd, d.sample);
  await invalidate(system, hwnd, d.bar);
}

/** `WM_COMMAND` (`081c`). */
async function command(
  system: any,
  hwnd: number,
  id: number,
  control: number,
  lParam: number
): Promise<number> {
  const notification = (lParam >>> 16) & 0xffff;

  if (control === IDOK || control === IDCANCEL || control === 3) {
    const d = get(system, id);
    const g = globals(system);

    if (control === IDOK) {
      setDword(system, d.lpcc, RGB_RESULT, d.rgb);
    }

    if (control !== 3) {
      if (g.tracking) {
        g.tracking = false;
        SetCapture.call(system, 0);
        ClipCursor.call(system, null);
      }

      const custom = dword(system, d.lpcc, CUST_COLORS);

      for (let i = 0; i < 16; i++) {
        setDword(system, custom, i * 4, d.colours[0x30 + i]);
      }

      const hook = dword(system, d.lpcc, HOOK);

      if (control === IDOK && hook) {
        if (await callHook(system, hook, hwnd, registered(system, 'commdlg_ColorOK'), 0, d.lpcc)) {
          return 1;
        }
      }
    }

    if (g.memoryDc) {
      DeleteDC.call(system, g.memoryDc);
      g.memoryDc = 0;
    }

    if (g.spectrum) {
      DeleteObject.call(system, g.spectrum);
      g.spectrum = 0;
    }

    RemoveProp.call(system, hwnd, 0xa000);
    g.hook = dword(system, d.lpcc, HOOK);
    g.dialogs.delete(id);
    await EndDialog.call(system, hwnd, control === 3 ? u16(lParam) : control === IDOK ? 1 : 0);
  } else if (control === ID_HUE || control === ID_SAT || control === ID_LUM) {
    if (notification === EN_CHANGE) {
      await numberTyped(system, hwnd, id, control);
    }
  } else if (control >= ID_RED && control <= ID_BLUE) {
    if (notification === EN_CHANGE) {
      await rgbTyped(system, id, control);
      await invalidate(system, hwnd, get(system, id).sample);
    } else if (notification === EN_KILLFOCUS) {
      const [, ok] = await getInt(system, hwnd, control);

      if (!ok) {
        await setRgbEdits(system, id, control);
      }
    }
  } else if (control === ID_ADD) {
    const d = copy(get(system, id));
    const index = d.custom;

    d.colours[index] = d.rgb;
    put(system, id, d);
    await invalidate(system, hwnd, globals(system).boxes[index] as Rect);

    const next = copy(get(system, id));

    next.custom = index >= 0x3f ? 0x30 : index >= 0x38 ? index - 7 : index + 8;
    put(system, id, next);
  } else if (control === ID_SOLID) {
    await solid(system, id);
  } else if (control === ID_DEFINE) {
    await define(system, hwnd, id);
  } else if (control === PSH_HELP) {
    const help = registered(system, 'commdlg_help');
    const lpcc = get(system, id).lpcc;
    const owner = word(system, lpcc, HWND_OWNER);

    if (help && owner) {
      await SendMessage.call(system, owner, help, hwnd, lpcc);
    }
  }

  return 1;
}

/** Hue, saturation or luminosity typed (`0a11`, `0ad8`, `0bb9`). */
async function numberTyped(system: any, hwnd: number, id: number, control: number) {
  const [read, ok] = await getInt(system, hwnd, control);
  let value = read;

  if (!ok) {
    if (await hasText(system, hwnd, control)) {
      await setHlsEdits(system, id, control);
      await selectAll(system, hwnd, control);
    }

    return;
  }

  const most = control === ID_HUE ? 239 : 240;

  if (value > most) {
    value = most;
    await setInt(system, hwnd, control, most);
  }

  const d = get(system, id);
  const now = control === ID_HUE ? d.hue : control === ID_SAT ? d.sat : d.lum;

  if (now === value) {
    return;
  }

  const hdc = GetDC.call(system, hwnd);

  if (control === ID_LUM) {
    eraseArrow(system, hdc, d);
  } else {
    eraseCross(system, hdc, d);
  }

  let next = copy(get(system, id));

  if (control === ID_HUE) {
    next.hue = value;
  } else if (control === ID_SAT) {
    next.sat = value;
  } else {
    next.lum = value;
  }

  if (control === ID_LUM) {
    positions(next, ID_LUM);
  }

  next.rgb = hlsToRgb(next.hue, next.lum, next.sat);
  put(system, id, next);
  await setRgbEdits(system, id, 0);
  next = copy(get(system, id));

  if (control === ID_LUM) {
    await arrow(system, hdc, next);
    ReleaseDC.call(system, hwnd, hdc);
  } else {
    positions(next, control);
    put(system, id, next);
    await cross(system, hdc, next.x, next.y, next);
    ReleaseDC.call(system, hwnd, hdc);
    await invalidate(system, hwnd, next.bar);
  }

  await invalidate(system, hwnd, next.sample);
  await UpdateWindow.call(system, hwnd);
}

/** Red, green or blue typed (`2ae3`). */
async function rgbTyped(system: any, id: number, control: number) {
  const hwnd = get(system, id).hwnd;
  const [read, ok] = await getInt(system, hwnd, control);
  let value = read;
  const shift = (control - ID_RED) * 8;

  if (!ok) {
    if (await hasText(system, hwnd, control)) {
      await setRgbEdits(system, id, control);
      await selectAll(system, hwnd, control);
    }

    return;
  }

  if (s16(value) > 255) {
    value = 255;
    await setInt(system, hwnd, control, 255);
  }

  const d = copy(get(system, id));

  if (((d.rgb >>> shift) & 0xff) === (value & 0xff)) {
    return;
  }

  d.rgb = ((d.rgb & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0;
  put(system, id, d);
  await rgbChanged(system, id);
  await setHlsEdits(system, id, control);
}

/** "Define Custom Colors..." (`0cfd`). */
async function define(system: any, hwnd: number, id: number) {
  await waitCursor(system, true);
  await drawSpectrum(system, id);

  for (let control = ID_HUE; control <= ID_BLUE; control++) {
    await EnableWindow.call(system, item(system, hwnd, control), 1);
  }

  for (let control = ID_HUE_LABEL; control <= ID_BLUE_LABEL; control++) {
    await EnableWindow.call(system, item(system, hwnd, control), 1);
  }

  await EnableWindow.call(system, item(system, hwnd, ID_ADD), 1);
  await EnableWindow.call(system, item(system, hwnd, ID_SOLID), 1);
  await EnableWindow.call(system, item(system, hwnd, ID_DEFINE), 0);

  const now = windowRect(system, hwnd);
  const w = get(system, id).window;

  await SetWindowPos.call(system, hwnd, 0, w[0], w[1], w[2] - w[0], w[3] - w[1], 0x16);
  await invalidate(system, hwnd, [w[0], now[1], now[0], now[3]]);
  await waitCursor(system, false);
  await SetFocus.call(system, item(system, hwnd, ID_HUE));

  const d = copy(get(system, id));

  d.full = true;
  put(system, id, d);
}

/**
 * The grids' procedure, COMMDLG's export 25 (`1b46`): their arrows and
 * characters sent to the dialog, and their focus rectangle drawn as they gain
 * and lose the focus.
 */
export async function WantArrows(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const system = this;

  switch (message) {
    case WM_GETDLGCODE:
      return 0x81;
    case WM_KEYDOWN:
    case WM_CHAR:
      return SendMessage.call(system, GetParent.call(system, hwnd), message, wParam, lParam >>> 0);
    case WM_SETFOCUS:
    case WM_KILLFOCUS: {
      const parent = GetParent.call(system, hwnd);
      const id = numberOf(system, parent);

      if (!id) {
        break;
      }

      const d = get(system, id);
      const index = u16(GetWindowWord.call(system, hwnd, GWW_ID)) === ID_BASIC ? d.basic : d.custom;
      const hdc = GetDC.call(system, parent);
      const b = globals(system).boxes[index];

      DrawFocusRect.call(system, hdc, rectOf([b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3]));
      return ReleaseDC.call(system, parent, hdc);
    }
  }

  return CallWindowProc.call(
    system,
    globals(system).staticProc,
    hwnd,
    message,
    wParam,
    lParam >>> 0
  );
}
