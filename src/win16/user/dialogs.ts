'use strict';

import { Surface } from '../../raster/surface.js';
import { Executable } from '../../executable.js';
import { FALSE, NULL, TRUE } from '../consts.js';
import { CreateFont } from '../gdi/CreateFont.js';
import { MulDiv } from '../gdi/MulDiv.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { User, WNDCLASS } from '../user.js';

import { CreateWindow } from './CreateWindow.js';
import { DefWindowProc } from './DefWindowProc.js';
import { DestroyWindow } from './DestroyWindow.js';
import { DispatchMessage } from './DispatchMessage.js';
import { parseDialogTemplate, type DialogTemplate } from './dialog-template.js';
import { nextMessage } from './queue.js';
import { fontOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';
import { resourceBytes } from './resources.js';
import { ShowWindow } from './ShowWindow.js';
import { TranslateMessage } from './TranslateMessage.js';
import { clickControl } from './control-classes.js';
import { EnableWindow } from './window-queries.js';
import { GetWindowLong } from './window-words.js';

/**
 * Dialog boxes on the raster desktop: made from a template, run modal or
 * modeless, and driven from the keyboard by `IsDialogMessage`.
 *
 * Measured by the `dialogs` probe on four displays:
 *
 * * Sizes and places in a template are dialog units, a quarter of the base
 *   width across and an eighth of the base height down, each rounded as
 *   `MulDiv` rounds -- 90 units of a font 10 high are 113 pixels, not 112.
 * * The base units are the dialog font's: its height, and, across, the width
 *   of the fifty-two letters over 26, plus one, halved -- the rule Microsoft
 *   gives for a dialog with a font of its own. The System font's 429 pixels
 *   give 8, MS Sans Serif's 376 give 7. Not ruled out: the letters over 52,
 *   rounded, and the average character width plus one, which give the same on
 *   every display recorded.
 * * `DS_SETFONT`'s face is made bold: MS Sans Serif 8 is `lfHeight` -11 and
 *   weight 700 on the VGA, -8 on the EGA, as `WM_GETFONT` gives it back.
 * * The dialog's client area is the template's place from its owner's client
 *   area, or from the screen without one. Its window's left edge is then put
 *   on the nearest multiple of eight -- 36 goes to 40, 35 to 32 -- as the
 *   dialog class aligns its windows; its top is not moved. A dialog that
 *   would leave the screen is brought back onto it; see `dlgclamp`.
 * * After `WM_INITDIALOG` answers TRUE the first control with `WS_TABSTOP`
 *   has the focus; Tab moves to the next, in the template's order, wrapping.
 *   Enter is the default button's command, Escape `IDCANCEL`'s.
 * * `DialogBox` disables the owner while the dialog runs, enables it again
 *   after, and answers what `EndDialog` was given.
 */

const DS_MODALFRAME = 0x80;
const SM_CYDLGFRAME = 8;
const DS_SETFONT = 0x40;
const WS_TABSTOP = 0x00010000;
const WS_GROUP = 0x00020000;
const WS_DISABLED = 0x08000000;
const WS_VISIBLE = 0x10000000;
const WS_CHILD = 0x40000000;

const WM_GETDLGCODE = 0x0087;
const DM_GETDEFID = 0x0400;
const DM_SETDEFID = 0x0401;
const DC_HASDEFID = 0x534b;

const DLGC_WANTARROWS = 0x0001;
const DLGC_WANTTAB = 0x0002;
const DLGC_WANTALLKEYS = 0x0004;
const DLGC_DEFPUSHBUTTON = 0x0010;
const DLGC_UNDEFPUSHBUTTON = 0x0020;
const DLGC_RADIOBUTTON = 0x0040;
const DLGC_WANTCHARS = 0x0080;
const DLGC_STATIC = 0x0100;
const DLGC_BUTTON = 0x2000;

const IDOK = 1;
const IDCANCEL = 2;
const BN_CLICKED = 0;

const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_SHIFT = 0x10;
const VK_ESCAPE = 0x1b;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;

const DIALOG_CLASS = '#32770';

/** What USER keeps of a dialog beside its window. */
export interface DialogState {
  /** The program's dialog procedure, a far address. */
  proc: number;
  /** The dialog font's handle; 0 for the System font. */
  font: number;
  base: { x: number; y: number };
  modal: boolean;
  ended: boolean;
  result: number;
  defId: number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A font's dialog base units: across, the letters' rule; down, its height. */
function baseUnitsOf(system: any, handle: number) {
  const { font, metrics } = fontOf(system, handle);
  const surface: any = Surface.memory();

  surface.font = font;

  const letters = surface.measureText(LETTERS).width;

  return { x: (Math.floor(letters / 26) + 1) >> 1 || 1, y: metrics.height || 1 };
}

/** The System font's, as `GetDialogBaseUnits` answers them. */
export function systemBaseUnits(system: any) {
  system._dialogBase ??= baseUnitsOf(system, stockFontHandle(system, SYSTEM_FONT));

  return system._dialogBase;
}

export function GetDialogBaseUnits(this: any) {
  const base = systemBaseUnits(this);

  return ((base.y << 16) | base.x) >>> 0;
}

/** The dialog class, `#32770`, whose procedure is `DefDlgProc`: registered the first time it is needed. */
export function dialogClass(system: any) {
  const found = system.handles.retrieve(DIALOG_CLASS);

  if (found) {
    return found;
  }

  const windowClass: any = new WNDCLASS();

  windowClass.style = 0;
  windowClass.cbWndExtra = 30;
  windowClass.hbrBackground = 5 + 1;
  windowClass.lpszClassName = DIALOG_CLASS;
  windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
    DefDlgProc.call(system, hwnd, message, wParam, lParam);

  system.handles.register(system.handles.allocate(windowClass), DIALOG_CLASS);

  return windowClass;
}

function stateOf(system: any, hwnd: number): DialogState | null {
  const window = system.handles.resolve(hwnd);

  return window instanceof RasterWindow ? ((window as any).dialogState ?? null) : null;
}

async function send(system: any, hwnd: number, message: number, wParam: number, lParam: any) {
  const window = system.handles.resolve(hwnd);
  const windowClass = window && system.handles.retrieve(window.options.windowClass);

  return windowClass
    ? await system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam)
    : 0;
}

/**
 * Makes a dialog from its template: the window, its font, its controls, then
 * `WM_INITDIALOG` and the focus. Answers the dialog's window, or 0.
 */
export async function createDialog(
  system: any,
  hinst: number,
  template: DialogTemplate,
  hwndOwner: number,
  proc: number,
  param: number,
  modal: boolean
) {
  const desktop = system.rasterDesktop;

  if (!desktop) {
    return NULL;
  }

  dialogClass(system);

  /* The font, and the units it makes. */
  let font = 0;
  let base = systemBaseUnits(system);

  if (template.style & DS_SETFONT && template.font) {
    const logical = system.display?.logicalPixelsY ?? 96;

    font = CreateFont.call(
      system,
      -MulDiv(template.font.points, logical, 72),
      0,
      0,
      0,
      700,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      template.font.face
    );
    base = baseUnitsOf(system, font);
  }

  const across = (units: number) => MulDiv(units, base.x, 4);
  const down = (units: number) => MulDiv(units, base.y, 8);

  /* The client area, from the owner's client area or the screen. */
  const owner = hwndOwner ? system.handles.resolve(hwndOwner) : null;
  const origin = owner instanceof RasterWindow ? owner.clientOrigin : { x: 0, y: 0 };
  const client = {
    x: origin.x + across(template.x),
    y: origin.y + down(template.y),
    width: across(template.cx),
    height: down(template.cy),
  };

  const style = template.style & ~WS_VISIBLE;
  const modalFrame = (template.style & DS_MODALFRAME) !== 0;
  const insets = desktop.frameInsets(style, modalFrame, template.menu !== null);
  const className = template.className ?? DIALOG_CLASS;

  const width = client.width + insets.left + insets.right;
  const height = client.height + insets.top + insets.bottom;

  /* The dialog class keeps its windows' left edges on multiples of eight. */
  const aligned = className === DIALOG_CLASS;
  let left = client.x - insets.left;
  let top = client.y - insets.top;

  if (aligned) {
    left = (left + 4) & ~7;
  }

  /* Kept on the screen, measured by the `dlgclamp` probe on four displays: a
   * dialog past the right edge is moved to end at it -- and then down to a
   * multiple of eight, which keeps it on -- and one past the bottom to end
   * four pixels above it; nothing is left above or left of the screen. The
   * four is `SM_CYDLGFRAME` here; `SM_CYFRAME` is four on every display too,
   * and a constant cannot be told from either. */
  if (!(style & WS_CHILD)) {
    const right = desktop.screen.width;
    const bottom = desktop.screen.height - desktop.environment.metric(SM_CYDLGFRAME);

    if (left + width > right) {
      left = aligned ? (right - width) & ~7 : right - width;
    }

    if (top + height > bottom) {
      top = bottom - height;
    }

    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  const hwnd = await CreateWindow.call(
    system,
    className,
    template.caption,
    style,
    left,
    top,
    width,
    height,
    hwndOwner,
    0,
    hinst,
    param
  );
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  if (!(window instanceof RasterWindow)) {
    return NULL;
  }

  if (modalFrame) {
    window.window.modalFrame = true;
    desktop.place(
      window.window,
      window.window.left,
      window.window.top,
      window.window.width,
      window.window.height
    );
  }

  (window as any).dialogState = {
    proc,
    font,
    base,
    modal,
    ended: false,
    result: 0,
    defId: 0,
  } satisfies DialogState;

  if (font) {
    await send(system, hwnd, User.WM_SETFONT, font, 0);
  }

  for (const item of template.items) {
    const text = typeof item.text === 'number' ? `#${item.text}` : item.text;
    const child = await CreateWindow.call(
      system,
      item.className,
      text,
      (item.style | WS_CHILD) >>> 0,
      across(item.x),
      down(item.y),
      across(item.cx),
      down(item.cy),
      hwnd,
      item.id,
      hinst,
      0
    );

    if (child && font) {
      await send(system, child, User.WM_SETFONT, font, 0);
    }
  }

  const first = firstTabItem(system, hwnd);
  const answer = await send(system, hwnd, User.WM_INITDIALOG, first, param);

  /* Worked out again after `WM_INITDIALOG`, which may have changed the
   * controls (`USER.EXE` seg24 `08e5`). */
  if (answer & 0xffff) {
    const focus = firstTabItem(system, hwnd);

    if (focus) {
      await setFocus(system, focus);
    }
  }

  if (template.style & WS_VISIBLE) {
    await ShowWindow.call(system, hwnd, User.SW_SHOWNORMAL);
  }

  return hwnd;
}

/** A template by name or number from a module's resources. */
async function resourceTemplate(system: any, hinst: number, name: any) {
  const module = system.handles.resolve(hinst);
  const bytes = await resourceBytes(module?.executable, Executable.RESOURCES.Dialog, name);

  return bytes ? parseDialogTemplate((at) => bytes[at] ?? 0) : null;
}

/** A template in the program's memory, at a far address. */
function memoryTemplate(system: any, far: number) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  return parseDialogTemplate((at) => core.read8(segment, (offset + at) & 0xffff));
}

/** Runs a dialog until `EndDialog`: its owner disabled meanwhile, and the dialog gone after. */
async function runModal(system: any, hwnd: number, hwndOwner: number) {
  if (!hwnd) {
    return -1;
  }

  const state = stateOf(system, hwnd)!;

  if (hwndOwner) {
    await EnableWindow.call(system, hwndOwner, FALSE);
  }

  if (!system.handles.resolve(hwnd)?.visible) {
    await ShowWindow.call(system, hwnd, User.SW_SHOWNORMAL);
  }

  while (!state.ended && system.handles.resolve(hwnd)) {
    const msg = await nextMessage(system);

    if (!msg) {
      break;
    }

    if (!(await IsDialogMessage.call(system, hwnd, msg))) {
      TranslateMessage.call(system, msg);
      await DispatchMessage.call(system, msg);
    }
  }

  if (hwndOwner) {
    await EnableWindow.call(system, hwndOwner, TRUE);
  }

  if (system.handles.resolve(hwnd)) {
    await DestroyWindow.call(system, hwnd);
  }

  return state.result;
}

export async function CreateDialog(
  this: any,
  hinst: number,
  name: any,
  hwndOwner: number,
  proc: number
) {
  return CreateDialogParam.call(this, hinst, name, hwndOwner, proc, 0);
}

export async function CreateDialogParam(
  this: any,
  hinst: number,
  name: any,
  hwndOwner: number,
  proc: number,
  param: number
) {
  const template = await resourceTemplate(this, hinst, name);

  return template ? createDialog(this, hinst, template, hwndOwner, proc, param, false) : NULL;
}

export async function CreateDialogIndirect(
  this: any,
  hinst: number,
  far: number,
  hwndOwner: number,
  proc: number
) {
  return createDialog(this, hinst, memoryTemplate(this, far), hwndOwner, proc, 0, false);
}

export async function CreateDialogIndirectParam(
  this: any,
  hinst: number,
  far: number,
  hwndOwner: number,
  proc: number,
  param: number
) {
  return createDialog(this, hinst, memoryTemplate(this, far), hwndOwner, proc, param, false);
}

export async function DialogBox(
  this: any,
  hinst: number,
  name: any,
  hwndOwner: number,
  proc: number
) {
  return DialogBoxParam.call(this, hinst, name, hwndOwner, proc, 0);
}

export async function DialogBoxParam(
  this: any,
  hinst: number,
  name: any,
  hwndOwner: number,
  proc: number,
  param: number
) {
  const template = await resourceTemplate(this, hinst, name);

  if (!template) {
    return -1;
  }

  return runModal(
    this,
    await createDialog(this, hinst, template, hwndOwner, proc, param, true),
    hwndOwner
  );
}

/** `DialogBoxIndirect` takes the template as a global memory handle, not an address. */
export async function DialogBoxIndirect(
  this: any,
  hinst: number,
  hglb: number,
  hwndOwner: number,
  proc: number
) {
  return DialogBoxIndirectParam.call(this, hinst, hglb, hwndOwner, proc, 0);
}

export async function DialogBoxIndirectParam(
  this: any,
  hinst: number,
  hglb: number,
  hwndOwner: number,
  proc: number,
  param: number
) {
  const far = ((hglb | 1) << 16) >>> 0;
  const template = memoryTemplate(this, far);

  return runModal(
    this,
    await createDialog(this, hinst, template, hwndOwner, proc, param, true),
    hwndOwner
  );
}

/** Ends a dialog: a modal one's loop stops and `DialogBox` answers `nResult`; a modeless one is hidden. */
export async function EndDialog(this: any, hwndDlg: number, nResult: number) {
  const state = stateOf(this, hwndDlg);

  if (!state) {
    return;
  }

  state.ended = true;
  state.result = (nResult << 16) >> 16;

  if (!state.modal) {
    await ShowWindow.call(this, hwndDlg, User.SW_HIDE);
  }
}

/**
 * The dialog class's window procedure: the program's dialog procedure first,
 * and what it leaves -- answering FALSE -- done here.
 */
export async function DefDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: any
) {
  const state = stateOf(this, hwnd);

  if (state?.proc) {
    const answer = await this.scheduler.callWindowProc(state.proc, hwnd, message, wParam, lParam);

    if (answer & 0xffff) {
      /* These answer with what the procedure returned; the rest with what it
       * left in the dialog's `DWL_MSGRESULT`. */
      switch (message) {
        case User.WM_INITDIALOG:
        case User.WM_CTLCOLOR:
        case User.WM_COMPAREITEM:
        case User.WM_VKEYTOITEM:
        case User.WM_CHARTOITEM:
        case User.WM_QUERYDRAGICON:
          return answer & 0xffff;
      }

      return GetWindowLong.call(this, hwnd, 0);
    }
  }

  switch (message) {
    case User.WM_INITDIALOG:
      return 0;

    case User.WM_SETFONT:
      if (state) {
        state.font = wParam;
      }
      return 0;

    case User.WM_GETFONT:
      return state?.font ?? 0;

    case User.WM_CLOSE: {
      /* Closing a dialog is its Cancel button. */
      const cancel = dlgItem(this, hwnd, IDCANCEL);

      await send(this, hwnd, User.WM_COMMAND, IDCANCEL, ((BN_CLICKED << 16) | cancel) >>> 0);
      return 0;
    }

    case DM_GETDEFID: {
      const id = defaultId(this, hwnd);

      return id ? ((DC_HASDEFID << 16) | id) >>> 0 : 0;
    }

    case DM_SETDEFID:
      if (state) {
        state.defId = wParam;
      }
      return 1;
  }

  return DefWindowProc.call(this, hwnd, message, wParam, lParam);
}

/** A dialog's controls, in the order they were made. */
function controlsOf(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return [];
  }

  return window.desktop.windows.filter(
    (child: any) => child.parent === window.window && child.hwnd
  );
}

function dlgItem(system: any, hwnd: number, id: number) {
  return controlsOf(system, hwnd).find((child: any) => child.controlId === id)?.hwnd ?? 0;
}

/** The dialog's default button: set with `DM_SETDEFID`, else the default push button, else none. */
function defaultId(system: any, hwnd: number) {
  const state = stateOf(system, hwnd);

  if (state?.defId) {
    return state.defId;
  }

  const button = controlsOf(system, hwnd).find(
    (child: any) => child.control?.className === 'BUTTON' && (child.style & 0x0f) === 1
  );

  return button?.controlId ?? 0;
}

const takesFocus = (child: any) => child.visible && !(child.style & WS_DISABLED);

/** The control with `WS_TABSTOP` after `from` -- or before it, `previous` -- wrapping; the first with none. */
/**
 * The control a dialog's focus starts on (`USER.EXE` seg25 `0089`): the first
 * with `WS_TABSTOP` that is visible and not disabled; failing that the first
 * control at all, whatever it is -- a group box, which shows no focus, as
 * `groupbox` records -- and with no controls the dialog itself.
 */
export function firstTabItem(system: any, hwnd: number) {
  const controls = controlsOf(system, hwnd);
  const stop = controls.find(
    (child: any) => child.style & WS_TABSTOP && child.style & 0x10000000 && !(child.style & 0x08000000)
  );

  return (stop ?? controls[0])?.hwnd ?? hwnd;
}

export function nextTabItem(system: any, hwnd: number, from: number, previous: boolean) {
  const controls = controlsOf(system, hwnd);
  const stops = controls.filter((child: any) => child.style & WS_TABSTOP);
  const candidates = stops.length ? stops : controls;
  const order = previous ? [...candidates].reverse() : candidates;
  const at = order.findIndex((child: any) => child.hwnd === from);

  for (let step = 1; step <= order.length; step++) {
    const child = order[(Math.max(at, -1) + step) % order.length];

    if (child && takesFocus(child)) {
      return child.hwnd;
    }
  }

  return 0;
}

export function GetNextDlgTabItem(this: any, hwndDlg: number, hwndCtl: number, fPrevious: number) {
  return nextTabItem(this, hwndDlg, hwndCtl, !!fPrevious);
}

/** The next control in `from`'s group -- the controls from one with `WS_GROUP` up to the next -- wrapping. */
export function GetNextDlgGroupItem(
  this: any,
  hwndDlg: number,
  hwndCtl: number,
  fPrevious: number
) {
  const controls = controlsOf(this, hwndDlg);
  const at = controls.findIndex((child: any) => child.hwnd === hwndCtl);

  if (at < 0) {
    return 0;
  }

  let start = at;

  while (start > 0 && !(controls[start].style & WS_GROUP)) {
    start--;
  }

  let end = at + 1;

  while (end < controls.length && !(controls[end].style & WS_GROUP)) {
    end++;
  }

  const group = controls.slice(start, end);
  const inGroup = group.indexOf(controls[at]);

  for (let step = 1; step <= group.length; step++) {
    const index = fPrevious
      ? (inGroup - step + group.length * 2) % group.length
      : (inGroup + step) % group.length;

    if (takesFocus(group[index])) {
      return group[index].hwnd;
    }
  }

  return hwndCtl;
}

/** The focus moved to a window: `WM_KILLFOCUS` to the one losing it, `WM_SETFOCUS` to it. */
export async function setFocus(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const desktop = window.desktop;
  const previous = desktop.focus?.hwnd ?? 0;

  if (desktop.focus === window.window) {
    return previous;
  }

  /* Where the focus is going, for a control that learns of its leaving only
   * from its own child: a combo box's edit control. */
  if (previous) {
    system._focusGoing = hwnd;
    await send(system, previous, User.WM_KILLFOCUS, hwnd, 0);
    system._focusGoing = undefined;
  }

  desktop.focus = window.window;
  await send(system, hwnd, User.WM_SETFOCUS, previous, 0);

  return previous;
}

/** A keyboard message a dialog handles itself: the focus moved, or a button pressed. */
export async function IsDialogMessage(this: any, hwndDlg: number, lpmsg: any) {
  const dialog = this.handles.resolve(hwndDlg);

  if (!(dialog instanceof RasterWindow)) {
    return FALSE;
  }

  /* Only messages for the dialog or a window in it. */
  const target = this.handles.resolve(lpmsg.hwnd);

  if (!(target instanceof RasterWindow)) {
    return FALSE;
  }

  let inside = false;

  for (let at: any = target.window; at; at = at.parent) {
    if (at === dialog.window) {
      inside = true;
    }
  }

  if (!inside) {
    return FALSE;
  }

  const message = lpmsg.message;

  if (message === User.WM_KEYDOWN) {
    const focus = this.rasterDesktop?.focus?.hwnd ?? 0;
    const code = focus ? await send(this, focus, WM_GETDLGCODE, lpmsg.wParam, 0) : 0;

    if (!(code & DLGC_WANTALLKEYS)) {
      switch (lpmsg.wParam) {
        case VK_TAB:
          if (!(code & DLGC_WANTTAB)) {
            const shift = (this._keyStates?.[VK_SHIFT] ?? 0) & 0x80;
            const next = nextTabItem(this, hwndDlg, focus, !!shift);

            if (next) {
              await setFocus(this, next);
            }

            return TRUE;
          }
          break;

        case VK_RETURN: {
          /* A push button with the focus is the one Enter presses. */
          const id =
            code & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON)
              ? GetDlgCtrlID.call(this, focus)
              : defaultId(this, hwndDlg) || IDOK;
          const button = dlgItem(this, hwndDlg, id);

          await send(this, hwndDlg, User.WM_COMMAND, id, ((BN_CLICKED << 16) | button) >>> 0);
          return TRUE;
        }

        case VK_ESCAPE: {
          const button = dlgItem(this, hwndDlg, IDCANCEL);

          await send(this, hwndDlg, User.WM_COMMAND, IDCANCEL, ((BN_CLICKED << 16) | button) >>> 0);
          return TRUE;
        }

        case VK_LEFT:
        case VK_UP:
        case VK_RIGHT:
        case VK_DOWN:
          if (!(code & DLGC_WANTARROWS)) {
            const previous = lpmsg.wParam === VK_LEFT || lpmsg.wParam === VK_UP;
            const next = GetNextDlgGroupItem.call(this, hwndDlg, focus, previous ? 1 : 0);

            if (next && next !== focus) {
              await setFocus(this, next);

              /* An automatic radio button is checked as the focus reaches it. */
              if ((await send(this, next, WM_GETDLGCODE, 0, 0)) & DLGC_RADIOBUTTON) {
                await clickControl(this, next);
              }
            }

            return TRUE;
          }
          break;
      }
    }
  }

  /* A mnemonic: Alt and a letter, or a letter where the focus takes none. */
  if (message === User.WM_SYSCHAR || message === User.WM_CHAR) {
    const focus = this.rasterDesktop?.focus?.hwnd ?? 0;
    const code = focus ? await send(this, focus, WM_GETDLGCODE, lpmsg.wParam, 0) : 0;

    if (message === User.WM_SYSCHAR || !(code & (DLGC_WANTCHARS | DLGC_WANTALLKEYS))) {
      const hit = mnemonicTarget(this, hwndDlg, String.fromCharCode(lpmsg.wParam & 0xff));

      if (hit) {
        await setFocus(this, hit.hwnd);

        if (hit.control?.className === 'BUTTON') {
          await clickControl(this, hit.hwnd);
        }

        return TRUE;
      }

      if (message === User.WM_CHAR) {
        return TRUE;
      }
    }
  }

  TranslateMessage.call(this, lpmsg);
  await DispatchMessage.call(this, lpmsg);

  return TRUE;
}

/** The control a mnemonic names: the one whose text has `&` before it, or the one after such static text. */
function mnemonicTarget(system: any, hwnd: number, letter: string) {
  const controls = controlsOf(system, hwnd);
  const lower = letter.toLowerCase();

  for (const [index, child] of controls.entries()) {
    const text = String(child.control?.text ?? child.title ?? '');
    const at = text.search(/&[^&]/);

    if (at < 0 || text[at + 1].toLowerCase() !== lower || !takesFocus(child)) {
      continue;
    }

    if (child.control?.className === 'STATIC') {
      return (
        controls
          .slice(index + 1)
          .find((next: any) => takesFocus(next) && next.style & WS_TABSTOP) ?? null
      );
    }

    return child;
  }

  return null;
}

export function GetDlgCtrlID(this: any, hwnd: number) {
  const window = this.handles.resolve(hwnd);

  return window instanceof RasterWindow ? window.window.controlId : 0;
}

/** Dialog units into pixels, in a dialog's own units. */
export function MapDialogRect(this: any, hwnd: number, lprc: any) {
  const base = stateOf(this, hwnd)?.base ?? systemBaseUnits(this);

  lprc.left = MulDiv(lprc.left, base.x, 4);
  lprc.right = MulDiv(lprc.right, base.x, 4);
  lprc.top = MulDiv(lprc.top, base.y, 8);
  lprc.bottom = MulDiv(lprc.bottom, base.y, 8);
}
