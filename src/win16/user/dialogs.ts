'use strict';

import { Surface } from '../../raster/surface.js';
import { Executable } from '../../executable.js';
import { FALSE, NULL, TRUE } from '../consts.js';
import { CreateFont } from '../gdi/CreateFont.js';
import { MulDiv } from '../gdi/MulDiv.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { MSG, POINT, User, WNDCLASS } from '../user.js';

import { CreateWindow } from './CreateWindow.js';
import { DefWindowProc } from './DefWindowProc.js';
import { DestroyWindow } from './DestroyWindow.js';
import { DispatchMessage } from './DispatchMessage.js';
import { SendMessage } from './SendMessage.js';
import { parseDialogTemplate, type DialogTemplate } from './dialog-template.js';
import { nextMessage, SENT_ANSWERED } from './queue.js';
import { noteTaken } from './queries.js';
import { askCbt, callMsgFilter, HCBT_SETFOCUS, MSGF_DIALOGBOX } from './hooks.js';
import { fontOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';
import { CTLCOLOR_DLG, defaultControlColour } from './ctlcolor.js';
import { OWN_STYLES } from './controls.js';
import { Brush } from '../../raster/brush.js';
import { UpdateWindow } from './UpdateWindow.js';
import { resourceBytes } from './resources.js';
import { ShowWindow } from './ShowWindow.js';
import { TranslateMessage } from './TranslateMessage.js';
import { ansiUpperByte } from './ansi.js';
import { BM_CLICK, DIALOG_FOCUS } from './button.js';
import { EnableWindow } from './window-queries.js';
import { LoadMenu } from './LoadMenu.js';
import { GetKeyState } from './accelerators.js';
import { MessageBeep } from './enumerate.js';
import { GetWindowLong } from './window-words.js';
import { activateForFocus, activateWindow, SetWindowPos } from './window-state.js';
import { GetSysModalWindow, SetSysModalWindow } from './userwin.js';
import { LockMyTask } from './lock-input.js';
import { postQuit } from './queue.js';

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
const DS_NOIDLEMSG = 0x100;
const DS_SYSMODAL = 0x02;
const WM_CANCELMODE = 0x001f;
const WM_SYSTIMER = 0x0118;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOREDRAW = 0x0008;
const HWND_TOPMOST = 0xffff;
const SWP_HIDEWINDOW = 0x0080;
const WM_ENTERIDLE = 0x0121;
const SM_CYDLGFRAME = 8;
const DS_SETFONT = 0x40;
const CS_BYTEALIGNWINDOW = 0x2000;
export const DS_ABSALIGN = 0x01;
const WS_TABSTOP = 0x00010000;
const WS_GROUP = 0x00020000;
const WS_DISABLED = 0x08000000;
const WS_VISIBLE = 0x10000000;
const WS_CHILD = 0x40000000;

const WM_GETDLGCODE = 0x0087;
const DM_GETDEFID = 0x0400;
const BM_GETCHECK = 0x0400;
const BM_SETSTYLE = 0x0404;
const BS_PUSHBUTTON = 0;
const BS_DEFPUSHBUTTON = 1;
const DM_SETDEFID = 0x0401;
const DC_HASDEFID = 0x534b;

const DLGC_WANTARROWS = 0x0001;
const DLGC_WANTTAB = 0x0002;
const DLGC_WANTALLKEYS = 0x0004;
const DLGC_HASSETSEL = 0x0008;
const DLGC_DEFPUSHBUTTON = 0x0010;
const DLGC_UNDEFPUSHBUTTON = 0x0020;
const DLGC_RADIOBUTTON = 0x0040;
const DLGC_WANTCHARS = 0x0080;

const EM_SETSEL = 0x0401;
const WM_NEXTDLGCTL = 0x0028;

const IDOK = 1;
const IDCANCEL = 2;
const BN_CLICKED = 0;

const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_SHIFT = 0x10;
const VK_ESCAPE = 0x1b;
const VK_MENU = 0x12;
const BM_SETSTATE = 0x0403;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_CANCEL = 0x03;
const VK_EXECUTE = 0x2b;
const DLGC_STATIC = 0x0100;
const DLGC_BUTTON = 0x2000;
const SS_NOPREFIX = 0x80;
const BS_AUTORADIOBUTTON = 0x09;

const DIALOG_CLASS = '#32770';

/** What USER keeps of a dialog beside its window. */
export interface DialogState {
  /** The program's dialog procedure, a far address. */
  proc: number;
  /** The dialog font's handle; 0 for the System font. */
  font: number;
  base: { x: number; y: number };
  modal: boolean;
  /** Ended by `EndDialog`, or going (`WM_NCDESTROY`): the dialog's word at 12h (seg25 `25b0`, `0627`). */
  ended: boolean;
  /**
   * The default button's identifier -- 1 as the dialog is made, then the
   * control that answers `WM_GETDLGCODE` with `DLGC_DEFPUSHBUTTON` -- and,
   * once `EndDialog` has written its value over it, what `DialogBox`
   * answers: one word of the dialog's, at 16h (`USER.EXE` seg24 `06fa`,
   * `08be`; seg25 `25b8`, `08b5`).
   */
  defId: number;
  /** Whether the owner was disabled before `DialogBox`, at 14h: 0 for a modeless dialog (seg24 `06d6`, seg25 `0797`). */
  ownerWasDisabled: boolean;
  /** The window system modal before a system-modal dialog, at 1Ch, to be so again as it ends (seg24 `063e`, seg25 `25ee`). */
  sysModalBefore: number;
  /** The control that had the focus as the dialog lost the activation, to have it again. */
  savedFocus?: number;
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

  windowClass.style = OWN_STYLES[DIALOG_CLASS];
  windowClass.cbWndExtra = 30;
  windowClass.hbrBackground = 5 + 1;
  windowClass.lpszClassName = DIALOG_CLASS;
  windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
    DefDlgProc.call(system, hwnd, message, wParam, lParam);
  /* USER's arrow (`USER.EXE` seg3 `156a`; `set-cursor.ts`). */
  windowClass.ownCursor = 32512;

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

  /* Half a unit added, then the fraction cut off toward nought: rounded as
   * `MulDiv` rounds for a place or a size above nought, but a pixel nearer
   * nought for one below it -- -1, -3, -5 for -1, -2, -3 down (`dlgneg`).
   * Space Traveler's About box, at -2 down, stood a row high. */
  const across = (units: number) => Math.trunc((units * base.x + 2) / 4);
  const down = (units: number) => Math.trunc((units * base.y + 4) / 8);

  /* The client area, from the owner's client area or the screen -- the
   * screen's with `DS_ABSALIGN` (documented). */
  const owner = hwndOwner ? system.handles.resolve(hwndOwner) : null;
  const origin =
    owner instanceof RasterWindow && !(template.style & DS_ABSALIGN)
      ? owner.clientOrigin
      : { x: 0, y: 0 };
  const client = {
    x: origin.x + across(template.x),
    y: origin.y + down(template.y),
    width: across(template.cx),
    height: down(template.cy),
  };

  /* A dialog owned by the system-modal window is made system modal too
   * (`USER.EXE` seg24 `011c`-`0148`: the owner at the top and the
   * system-modal window or inside it). **Recorded** by `sysdlg`: a dialog
   * run over a system-modal one is the system-modal window while it
   * shows. */
  const sysModal = GetSysModalWindow.call(system);
  const ownedBySysModal =
    owner instanceof RasterWindow && !owner.window.parent && sysModal && hwndOwner === sysModal;
  let style = (ownedBySysModal ? template.style | DS_SYSMODAL : template.style) & ~WS_VISIBLE;
  const modalFrame = (template.style & DS_MODALFRAME) !== 0;
  const insets = desktop.frameInsets(style, modalFrame, template.menu !== null);
  const className = template.className ?? DIALOG_CLASS;

  const width = client.width + insets.left + insets.right;
  const height = client.height + insets.top + insets.bottom;

  /* A class with `CS_BYTEALIGNWINDOW` keeps its windows' left edges on a
   * byte of the display, the nearest: eight pixels where a byte holds eight
   * (`dlgpos`), and any pixel on the 256-colour display, where it holds one
   * -- SimTower's message box stands at 119 in Windows' screen there. The
   * dialog class has it, and so does Borland's BWCC's `bordlg`, whose
   * dialogs were two and three pixels right of Windows' in Space Traveler
   * and Cell War. */
  const perByte = Math.max(1, 8 / (system.display?.bitsPerPixel ?? 1));
  const aligned =
    perByte > 1 &&
    (className === DIALOG_CLASS ||
      ((system.handles.retrieve(className)?.style ?? 0) & CS_BYTEALIGNWINDOW) !== 0);
  const align = (value: number) => value & ~(perByte - 1);
  let left = client.x - insets.left;
  let top = client.y - insets.top;

  if (aligned) {
    left = align(left + perByte / 2);
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
      left = aligned ? align(right - width) : right - width;
    }

    if (top + height > bottom) {
      top = bottom - height;
    }

    left = Math.max(0, left);
    top = Math.max(0, top);
  }

  /* The menu the template names, from the dialog's module (documented). */
  const menu =
    template.menu !== null && template.menu !== ''
      ? await LoadMenu.call(system, hinst, template.menu)
      : 0;

  /* A child dialog is made where its parent's client area puts it: the
   * place worked out on the screen, less that corner, which `CreateWindow`
   * adds again. BogOut's word lists are child dialogs, and stood forty
   * pixels below Windows'. */
  const child = (style & WS_CHILD) !== 0;
  const hwnd = await CreateWindow.call(
    system,
    className,
    template.caption,
    style,
    child ? left - origin.x : left,
    child ? top - origin.y : top,
    width,
    height,
    hwndOwner,
    menu,
    hinst,
    param
  );
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  if (!(window instanceof RasterWindow)) {
    return NULL;
  }

  /* System modal as soon as it is a window, the window system modal before
   * kept to be so again as it ends; refused -- another task's system-modal
   * window up -- it is not system modal at all (seg24 `062d`-`064b`). The
   * task is locked only as it shows. **Recorded** by `sysdlg`:
   * `GetSysModalWindow` names the dialog in its `WM_INITDIALOG`, and
   * `IsTaskLocked` names no task until it shows. */
  let sysModalBefore = 0;

  if (style & DS_SYSMODAL) {
    sysModalBefore = await SetSysModalWindow.call(system, hwnd);

    if (GetSysModalWindow.call(system) !== hwnd) {
      style &= ~DS_SYSMODAL;
      window.window.style = (window.window.style & ~DS_SYSMODAL) >>> 0;
    }
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
    defId: 1,
    ownerWasDisabled: false,
    sysModalBefore,
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

    if (!child) {
      continue;
    }

    if (font) {
      await send(system, child, User.WM_SETFONT, font, 0);
    }

    /* Each control asked what it is as it is made, and the last that
     * answers `DLGC_DEFPUSHBUTTON` is the dialog's default, over the 1 it
     * starts with (`USER.EXE` seg24 `08a9`-`08c2`). **Recorded** by
     * `dlgcode`: a control of a program's own class answering so after a
     * push button with `BS_DEFPUSHBUTTON` is `DM_GETDEFID`'s; the button keeps
     * its outline. */
    if ((await send(system, child, WM_GETDLGCODE, 0, 0)) & DLGC_DEFPUSHBUTTON) {
      (window as any).dialogState.defId = item.id & 0xffff;
    }
  }

  const first = firstTabItem(system, hwnd);
  const answer = await send(system, hwnd, User.WM_INITDIALOG, first, param);

  /* Worked out again after `WM_INITDIALOG`, which may have changed the
   * controls (`USER.EXE` seg24 `08e5`) -- unless `EndDialog` has ended it
   * there, when no control is given the focus and a dialog made shown is
   * not shown (`090e`, `0949`). **Recorded** by `enddlg`: ended in
   * `WM_INITDIALOG`, `WS_VISIBLE` or not, the dialog is neither shown nor
   * made active, and the focus stays where it was. */
  const ended = () => (window as any).dialogState?.ended === true;

  /* The focus given as the dialog manager gives it, and the default push
   * button kept as it moves from the control `WM_INITDIALOG` was given --
   * gone meanwhile, none -- to the first tab item now (`090e`-`093e`). */
  if (answer & 0xffff && !ended()) {
    const given = system.handles.resolve(first) ? first : 0;
    const focus = firstTabItem(system, hwnd);

    await dlgSetFocus(system, focus);
    await checkDefPush(system, hwnd, given, focus);
  }

  if (template.style & WS_VISIBLE && !ended() && !system.handles.resolve(hwnd)?.visible) {
    await ShowWindow.call(system, hwnd, User.SW_SHOWNORMAL);
    await updateDialog(system, hwnd);

    /* Shown system modal, the task is locked (`0963`-`0976`). */
    if (GetSysModalWindow.call(system) === hwnd) {
      LockMyTask.call(system, 1);
    }
  }

  return hwnd;
}

/** A dialog painted as it shows, it and its controls (seg24 `095d`, seg25 `0847`). */
async function updateDialog(system: any, hwnd: number) {
  const shown = system.handles.resolve(hwnd);

  if (shown instanceof RasterWindow) {
    for (const window of [
      shown.window,
      ...shown.desktop.windows.filter((w: any) => w.parent === shown.window),
    ]) {
      if (window.hwnd) {
        await UpdateWindow.call(system, window.hwnd);
      }
    }
  }
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

/**
 * A modal dialog, as `DialogBoxIndirectParam` runs one (`USER.EXE` seg25
 * `08eb`): its owner -- for a child, the window at the top it is in, and
 * that window's last owner (seg1 `63a2`) -- disabled before the dialog is
 * made, noting whether it was disabled already and whether it was the
 * active window; the dialog made, owned by it; then its loop. **Recorded**
 * by `enddlg`: the owner is sent `WM_CANCELMODE` and `WM_ENABLE` before the
 * dialog's `WM_INITDIALOG`.
 */
async function dialogBox(
  system: any,
  hinst: number,
  template: DialogTemplate,
  hwndOwner: number,
  proc: any,
  param: number
) {
  let owner =
    hwndOwner && system.handles.resolve(hwndOwner) instanceof RasterWindow ? hwndOwner : 0;
  let ownerWasDisabled = false;
  let ownerWasActive = false;

  if (owner) {
    let at = system.handles.resolve(owner).window;

    if (at.parent) {
      while (at.parent || at.owner) {
        at = at.parent ?? at.owner;
      }
    }

    owner = at.hwnd ?? owner;
    ownerWasDisabled = (at.style & WS_DISABLED) !== 0;
    ownerWasActive = system.rasterDesktop?.activeTop === at;
    await EnableWindow.call(system, owner, FALSE);
  }

  const hwnd = await createDialog(system, hinst, template, owner, proc, param, true);

  return runModal(system, hwnd, owner, ownerWasDisabled, ownerWasActive);
}

/**
 * The modal loop (`USER.EXE` seg25 `0737`), until the dialog has ended: the
 * value `EndDialog` wrote, then the dialog destroyed. `EndDialog` has hidden
 * it and enabled the owner already; nothing here does either.
 *
 * * No dialog made: the owner enabled again where it was not disabled
 *   before, given the focus where it was active, and -1 (`0749`-`0779`).
 * * The window with the mouse's capture told `WM_CANCELMODE` (`077c`).
 * * A message taken goes to `IsDialogMessage`, else is translated and
 *   dispatched. `WM_QUIT` is posted again and ends the loop, answering the
 *   dialog's word as it stands (`07d5`, `08ad`).
 * * The dialog not shown yet is shown the first time nothing is found, or
 *   at `WM_SYSTIMER` or `WM_SYSKEYDOWN`, and painted (`0801`-`084c`). So a
 *   message posted in `WM_INITDIALOG` is taken while it is hidden
 *   (`enddlg`).
 * * Shown and finding nothing, the owner is sent `WM_ENTERIDLE` once until
 *   a message comes, unless the dialog has `DS_NOIDLEMSG`; then it waits
 *   (`085b`-`0899`).
 * * The dialog destroyed without `EndDialog` ends the loop with 0, and the
 *   owner is left disabled (`089e`-`08ab`; `enddlg`).
 */
async function runModal(
  system: any,
  hwnd: number,
  hwndOwner: number,
  ownerWasDisabled: boolean,
  ownerWasActive: boolean
) {
  if (!hwnd) {
    if (hwndOwner && !ownerWasDisabled && system.handles.resolve(hwndOwner)) {
      await EnableWindow.call(system, hwndOwner, TRUE);

      if (ownerWasActive) {
        await setFocus(system, hwndOwner);
      }
    }

    return -1;
  }

  const state = stateOf(system, hwnd)!;
  const capture = system.rasterInput?.capture?.hwnd ?? 0;

  if (capture) {
    await SendMessage.call(system, capture, WM_CANCELMODE, 0, 0);
  }

  state.ownerWasDisabled = ownerWasDisabled;

  const style = system.handles.resolve(hwnd)?.window?.style ?? 0;
  let visible = system.handles.resolve(hwnd)?.window?.visible === true;
  const idles = !(style & DS_NOIDLEMSG);
  let idled = false;
  let owner = hwndOwner;

  for (;;) {
    if (state.ended) {
      break;
    }

    const msg = await nextMessage(system, { wait: false });

    if (msg) {
      /* The loop takes it with USER's own `PeekMessage` (seg25 `07c7`, the
       * function `PeekMessage` goes on to past its checks, seg1 `a76c`),
       * which notes its time and place for `GetMessageTime` and
       * `GetMessagePos`. Control Panel's spin buttons ask the place of a
       * press on them; they found the last a program took. */
      noteTaken(system, msg);
      idled = false;

      if (msg.message === User.WM_QUIT) {
        postQuit(system, msg.wParam);
        break;
      }

      /* `IsDialogMessage` past its checks, which calls the message filters
       * first (seg25 `07e4`, `0c38`). */
      if (!(await IsDialogMessage.call(system, hwnd, msg))) {
        TranslateMessage.call(system, msg);
        await DispatchMessage.call(system, msg);
      }

      if (visible || (msg.message !== WM_SYSTIMER && msg.message !== User.WM_SYSKEYDOWN)) {
        if (!system.handles.resolve(hwnd)) {
          return 0;
        }

        continue;
      }
    }

    if (!visible) {
      visible = true;

      /* System modal, it is put in front of all first, neither moved, sized,
       * drawn nor made active (`0826`-`0839`, `HWND_TOPMOST` with 1Bh). */
      if (GetSysModalWindow.call(system) === hwnd) {
        await SetWindowPos.call(
          system,
          hwnd,
          HWND_TOPMOST,
          0,
          0,
          0,
          0,
          SWP_NOSIZE | SWP_NOMOVE | SWP_NOREDRAW | SWP_NOACTIVATE
        );
      }

      await ShowWindow.call(system, hwnd, User.SW_SHOWNORMAL);

      /* Painted as it shows, it and its controls, not by its loop:
       * `hooks` recorded no `WM_PAINT` among the messages the loop took. */
      await updateDialog(system, hwnd);

      /* And the task locked while it shows (`084c`-`0854`). **Recorded** by
       * `sysdlg`: `IsTaskLocked` names the program once the dialog shows,
       * and another program posted a message answers it only once the
       * dialog has ended. */
      if (GetSysModalWindow.call(system) === hwnd) {
        LockMyTask.call(system, 1);
      }
    } else {
      if (owner && !system.handles.resolve(owner)) {
        owner = 0;
      }

      if (owner && idles && !idled) {
        idled = true;
        await SendMessage.call(system, owner, WM_ENTERIDLE, MSGF_DIALOGBOX, hwnd);
      } else {
        /* Waiting, a message another program sent the dialog, answered,
         * sends the loop back to see whether it has ended: the Task List's
         * Cancel, pressed by another program with `SendMessage`, ends
         * TASKMAN.EXE's dialog (`tasklist`). [[inferred]]: the loop waits
         * with `WaitMessage` (`USER.EXE` seg25 `0899`), and what makes that
         * return then is not read out. */
        const waited = await nextMessage(system, { sentEnds: true, remove: false });

        if (!waited) {
          break;
        }
      }
    }

    if (!system.handles.resolve(hwnd)) {
      return 0;
    }
  }

  const result = (state.defId << 16) >> 16;

  if (system.handles.resolve(hwnd)) {
    await DestroyWindow.call(system, hwnd);
  }

  return result;
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

  return dialogBox(this, hinst, template, hwndOwner, proc, param);
}

/** `DialogBoxIndirect` takes the template as a global memory handle, not an address. */
/** A modal dialog from a template already read: USER's own dialogs, such as the message box. */
export async function dialogBoxTemplate(
  system: any,
  hinst: number,
  template: DialogTemplate,
  hwndOwner: number,
  proc: any,
  param: number
) {
  return dialogBox(system, hinst, template, hwndOwner, proc, param);
}

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

  return dialogBox(this, hinst, template, hwndOwner, proc, param);
}

/**
 * Ends a dialog, modal or modeless, at once (`USER.EXE` seg25 `2564`); a
 * modal one's loop then sees it has ended and destroys it. **Recorded** by
 * `enddlg`:
 *
 * 1. The owner -- the parent of a child -- is enabled again, unless it was
 *    disabled before `DialogBox`; a modeless dialog notes nothing, so its
 *    owner is enabled whatever it was (`2589`-`25ab`).
 * 2. The dialog is marked ended, and its value written over its default
 *    button's word: `DM_GETDEFID` answers 0 from now on (`25b0`-`25b8`).
 * 3. Where the dialog is the active window and the focus is in one of its
 *    controls, the focus is taken back to the dialog itself (`25bb`-`25d0`):
 *    the control is told now, as the dialog ends, and the dialog, ended,
 *    gives it to no control. COMMDLG's hook hears `CBN_KILLFOCUS` after
 *    `IDCANCEL` (`comboesc`).
 * 4. The dialog is hidden, `SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOZORDER
 *    | SWP_NOMOVE | SWP_NOSIZE`, 97h (`25d5`-`25e3`); hidden already, it is
 *    asked and not told.
 * 5. Where it was the active window as `EndDialog` began, the owner is made
 *    active as `ActivateWindow` makes a window active, disabled, minimized
 *    or hidden as it may be (seg1 `38e4` with 1). `DefWindowProc` or the
 *    dialog manager moves the focus there; where the owner refuses it, the
 *    focus left in the dialog is moved to the owner all the same (seg1
 *    `37a3`). With no owner, no window is active and none has the focus,
 *    and nothing is told (`260e`-`2631`) -- until the dialog is destroyed,
 *    which makes the next window active (seg8 `0ba8`).
 *
 * Called again, it does all this again: the value is the last one given,
 * and the dialog, hidden and not active, is only asked 97h once more.
 */
export async function EndDialog(this: any, hwndDlg: number, nResult: number) {
  const state = stateOf(this, hwndDlg);
  const dialog = this.handles.resolve(hwndDlg);

  if (!state || !(dialog instanceof RasterWindow)) {
    return;
  }

  /* The task let go first, whoever locked it (`2579`). */
  LockMyTask.call(this, 0);

  const desktop = dialog.desktop;
  const wasActive = desktop.activeTop === dialog.window;
  const ownerWindow = dialog.window.parent ?? dialog.window.owner ?? null;
  let owner = ownerWindow?.hwnd ?? 0;

  if (owner && !state.ownerWasDisabled && this.handles.resolve(owner)) {
    await EnableWindow.call(this, owner, TRUE);
  }

  state.ended = true;
  state.defId = nResult & 0xffff;

  let inside = false;

  for (let at = desktop.focus?.parent; at; at = at.parent) {
    inside ||= at === dialog.window;
  }

  if (inside && desktop.activeTop === dialog.window) {
    await setFocus(this, hwndDlg);
  }

  await SetWindowPos.call(
    this,
    hwndDlg,
    0,
    0,
    0,
    0,
    0,
    SWP_HIDEWINDOW | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE
  );

  /* System modal, it makes the window system modal before it so again --
   * none, where that is gone -- and that window, not the owner, is made
   * active (`25e8`-`260b`). **Recorded** by `sysdlg`: a dialog ended over
   * a system-modal dialog gives the system modality and the activation
   * back to it, and the task stays let go. */
  if (GetSysModalWindow.call(this) === hwndDlg) {
    const before =
      state.sysModalBefore && this.handles.resolve(state.sysModalBefore) ? state.sysModalBefore : 0;

    await SetSysModalWindow.call(this, before);

    if (before) {
      owner = before;
    }
  }

  const top = owner ? this.handles.resolve(owner) : null;

  if (wasActive && owner) {
    if (top instanceof RasterWindow && !top.window.parent) {
      await activateWindow(this, top.window);
    }
  } else if (desktop.activeTop === dialog.window) {
    desktop.leaveNoneActive(dialog.window, true);
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
    /* With AX the stack's segment, not the window's instance (seg25 `0386`). */
    const answer = await this.scheduler.callWindowProc(
      state.proc,
      hwnd,
      message,
      wParam,
      lParam,
      this.machine.cpu.core.ss
    );

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

    /* The background: the brush the dialog answers itself for
     * `CTLCOLOR_DLG`, asked with the device context being erased, and
     * `DefWindowProc`'s window colour when it answers none (`dlgbrush`).
     * FIBS/W answers grey. */
    case User.WM_ERASEBKGND: {
      const window = this.handles.resolve(hwnd);

      if (!(window instanceof RasterWindow)) {
        break;
      }

      const hdc = wParam & 0xffff;
      let brush = this.handles.resolve(
        (await send(this, hwnd, User.WM_CTLCOLOR, hdc, ((CTLCOLOR_DLG << 16) | hwnd) >>> 0)) &
          0xffff
      );

      if (!(brush instanceof Brush)) {
        brush = this.handles.resolve(defaultControlColour(this, hdc, CTLCOLOR_DLG));
      }

      const colour = (brush as any).color;

      /* A hollow brush erases nothing: SimTower answers `NULL_BRUSH`, and
       * Windows shows its title picture through the corners its frame's
       * lines leave undrawn. */
      if (colour?.alpha === 0) {
        return 1;
      }

      window.desktop.erase(
        window.window,
        ((colour?.red ?? 0) | ((colour?.green ?? 0) << 8) | ((colour?.blue ?? 0) << 16)) >>> 0
      );

      return 1;
    }

    /* Activation (seg25 `050b`): the focus kept as the dialog loses it and
     * given back as it has it again; nothing for `DefWindowProc`, which would
     * give the dialog's own window the focus. */
    case User.WM_ACTIVATE:
      if (wParam & 0xffff) {
        await restoreFocus(this, hwnd, state);
      } else {
        await saveFocus(this, hwnd, state);
      }
      return 0;

    /* The focus given to the dialog's window (seg25 `0553`): to the control
     * kept, or else the first tab item -- unless the dialog has ended. */
    case User.WM_SETFOCUS:
      if (state && !state.ended && !(await restoreFocus(this, hwnd, state))) {
        const first = firstTabItem(this, hwnd);

        if (first) {
          await dlgSetFocus(this, first);
        }
      }
      return 0;

    /* Hidden, it keeps its focus first (seg25 `05ab`). */
    case User.WM_SHOWWINDOW:
      if (!(wParam & 0xffff)) {
        await saveFocus(this, hwnd, state);
      }
      break;

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

    /* Nought once the dialog has ended, its word holding `EndDialog`'s
     * value; a new default is not taken then (seg25 `06d7`, `06f0`;
     * `enddlg`). */
    case DM_GETDEFID: {
      const id = state?.ended ? 0 : (state?.defId ?? 0);

      return id ? ((DC_HASDEFID << 16) | id) >>> 0 : 0;
    }

    /* The default push button kept as it moves from the control of the
     * identifier before to the one given -- none for nought -- then the
     * identifier taken (seg25 `06f0`-`0726`). */
    case DM_SETDEFID:
      if (state && !state.ended) {
        const before = state.defId ? dlgItem(this, hwnd, state.defId) : 0;
        const after = wParam & 0xffff ? dlgItem(this, hwnd, wParam & 0xffff) : 0;

        await checkDefPush(this, hwnd, before, after);
        state.defId = wParam & 0xffff;
      }
      return 1;

    /* Moves the focus (seg25 `05c8`): to the window `wParam` names when
     * lParam's low word says so; otherwise to the next tab item, or the
     * previous when `wParam` is nonzero -- or the first, when nothing has
     * the focus -- and not at all when the focus is outside the dialog. */
    case WM_NEXTDLGCTL: {
      const focusWindow = this.rasterDesktop?.focus;
      const focus = focusWindow?.hwnd ?? 0;
      let target: number;
      let from: number;

      if (lParam & 0xffff) {
        target = wParam & 0xffff;
        from = focus || hwnd;
      } else if (!focus) {
        target = firstTabItem(this, hwnd);
        from = hwnd;
      } else if (!within(this, hwnd, focusWindow)) {
        return 1;
      } else {
        from = focus;
        target = nextTabItem(this, hwnd, focus, (wParam & 0xffff) !== 0);
      }

      /* And the default push button kept as it moves (`060b`-`0615`). */
      if (target) {
        await dlgSetFocus(this, target);
        await checkDefPush(this, hwnd, from, target);
      }

      return 1;
    }
  }

  return DefWindowProc.call(this, hwnd, message, wParam, lParam);
}

/**
 * The focus kept as a dialog loses it (seg25 `03a8`): the window that has
 * it, if it is inside the dialog and nothing is kept already; and then
 * every default push button made plain, from that control round
 * (`03d3`, `0ab2`). **Recorded** by `dlgcode`: a modeless dialog covered by
 * a modal one has each of its controls asked `WM_GETDLGCODE`.
 */
async function saveFocus(system: any, hwnd: number, state: DialogState | null) {
  const focus = system.rasterDesktop?.focus;

  if (state && focus?.hwnd && !state.savedFocus && within(system, hwnd, focus)) {
    state.savedFocus = focus.hwnd;
    await clearDefPush(system, hwnd, focus.hwnd);
  }
}

/**
 * The focus given back (seg25 `03e3`): to the control kept, if there is one,
 * it is still a window and the dialog is not minimized. Whether it was; the
 * control is kept no longer either way.
 */
async function restoreFocus(system: any, hwnd: number, state: DialogState | null) {
  const saved = state?.savedFocus ?? 0;
  const dialog = system.handles.resolve(hwnd);

  if (!state || !saved || dialog?.window?.state === 'minimized') {
    return false;
  }

  state.savedFocus = 0;

  if (!(system.handles.resolve(saved) instanceof RasterWindow)) {
    return false;
  }

  /* The default push button kept as the focus goes back (`0404`-`040c`). */
  await checkDefPush(system, hwnd, system.rasterDesktop?.focus?.hwnd ?? 0, saved);
  await setFocus(system, saved);

  return true;
}

/** Whether a desktop window is inside a dialog, however deep. */
function within(system: any, hwnd: number, window: any) {
  const dialog = system.handles.resolve(hwnd)?.window;

  for (let at = window?.parent; at; at = at.parent) {
    if (at === dialog) {
      return true;
    }
  }

  return false;
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

/** A control's text, as the dialog manager reads it to find a mnemonic (seg19 `0101`). */
function controlText(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  return window instanceof RasterWindow
    ? String(window.window.control?.text ?? window.window.title ?? '')
    : '';
}

/**
 * The control a dialog's focus starts on (`USER.EXE` seg25 `0089`): the first
 * with `WS_TABSTOP` that is visible and not disabled; failing that the first
 * control at all, whatever it is -- a group box, which shows no focus, as
 * `groupbox` records -- and with no controls the dialog itself.
 */
export function firstTabItem(system: any, hwnd: number) {
  const controls = controlsOf(system, hwnd);
  const stop = controls.find(
    (child: any) =>
      child.style & WS_TABSTOP && child.style & 0x10000000 && !(child.style & 0x08000000)
  );

  return (stop ?? controls[0])?.hwnd ?? hwnd;
}

/**
 * The dialog's own control a window is in (`USER.EXE` seg25 `0f8c`): the
 * window itself, or the last of its parents that is still a child before the
 * dialog -- a combo box for its edit control; none for the dialog or a window
 * that is no child.
 */
function childControl(system: any, hwnd: number, from: number) {
  const isChild = (window: any) => (window.style & 0xc0000000) >>> 0 === 0x40000000;
  let at = from ? system.handles.resolve(from)?.window : null;

  if (!at || from === hwnd || !isChild(at)) {
    return 0;
  }

  while (at.parent && at.parent.hwnd !== hwnd && isChild(at.parent)) {
    at = at.parent;
  }

  return at.hwnd ?? 0;
}

/**
 * The dialog's child after `from`, the first after the last, and the first
 * for none (`USER.EXE` seg25 `0f70`): the order the children lie in.
 */
function nextChild(system: any, hwnd: number, from: number) {
  const controls = controlsOf(system, hwnd);
  const at = from ? controls.findIndex((child: any) => child.hwnd === from) : -1;

  return (at >= 0 && at + 1 < controls.length ? controls[at + 1] : controls[0])?.hwnd ?? 0;
}

/**
 * The dialog's child before `from`, going round, and the last for none
 * (seg25 `0f38`): the children walked from `from` until it comes again.
 */
function previousChild(system: any, hwnd: number, from: number) {
  const controls = controlsOf(system, hwnd);
  const at = from ? controls.findIndex((child: any) => child.hwnd === from) : -1;

  if (!controls.length) {
    return 0;
  }

  return (at > 0 ? controls[at - 1] : controls[controls.length - 1]).hwnd ?? 0;
}

const styleOf = (system: any, hwnd: number) => system.handles.resolve(hwnd)?.window?.style ?? 0;
const grouped = (system: any, hwnd: number) => (styleOf(system, hwnd) & WS_GROUP) !== 0;

/**
 * The next control of `from`'s group (seg19 `09ab`): the next child, unless
 * it starts a group, when the group goes round to its first -- the last
 * child with `WS_GROUP` at or before `from`, going back round the dialog's
 * children: a first control without `WS_GROUP` is in the group of the last
 * control that has it.
 */
function groupNext(system: any, hwnd: number, from: number) {
  const next = nextChild(system, hwnd, from);

  if (!from || !grouped(system, next)) {
    return next;
  }

  let at = from;

  while (!grouped(system, at)) {
    const before = previousChild(system, hwnd, at);

    if (before === from) {
      break;
    }

    at = before;
  }

  return at;
}

/**
 * The control before `from` in its group (seg19 `096c`): the child before
 * it, unless `from` starts the group, when the group's last -- the child
 * before the next that starts a group.
 */
function groupPrevious(system: any, hwnd: number, from: number) {
  if (!from || !grouped(system, from)) {
    return previousChild(system, hwnd, from);
  }

  let at = from;

  for (;;) {
    const next = nextChild(system, hwnd, at);

    if (grouped(system, next) || next === from) {
      return at;
    }

    at = next;
  }
}

/** Shown and not disabled, as the dialog manager asks of a control it moves to. */
const reachable = (system: any, hwnd: number) => {
  const style = styleOf(system, hwnd);

  return !(style & WS_DISABLED) && system.handles.resolve(hwnd)?.window?.visible === true;
};

/**
 * The control with `WS_TABSTOP` after `from`'s control -- or before it,
 * `previous` -- shown and not disabled, going round (`USER.EXE` seg19
 * `09ee`, `GetNextDlgTabItem`). `from` is taken to the dialog's control it
 * is in first (`0a02`): Tab in a combo box's edit control goes on from the
 * combo box. With none other, the round ends at `from`'s control, which is
 * answered whatever it is; from no control, it starts after the last (or
 * before the first).
 */
export function nextTabItem(system: any, hwnd: number, from: number, previous: boolean) {
  const start = childControl(system, hwnd, from);
  const end = start || (previous ? nextChild(system, hwnd, 0) : previousChild(system, hwnd, 0));
  let at = start;

  for (;;) {
    at = previous ? previousChild(system, hwnd, at) : nextChild(system, hwnd, at);

    if (!at || at === end) {
      return at;
    }

    if (styleOf(system, at) & WS_TABSTOP && reachable(system, at)) {
      return at;
    }
  }
}

export function GetNextDlgTabItem(this: any, hwndDlg: number, hwndCtl: number, fPrevious: number) {
  return nextTabItem(this, hwndDlg, hwndCtl, !!fPrevious);
}

/**
 * The next control in `from`'s group, or the one before, shown and not
 * disabled (`USER.EXE` seg19 `0a5f`, `GetNextDlgGroupItem`), as
 * `groupNext` and `groupPrevious` go round it; come back to `from`'s
 * control, that one, whatever it is.
 */
export function GetNextDlgGroupItem(
  this: any,
  hwndDlg: number,
  hwndCtl: number,
  fPrevious: number
) {
  const start = childControl(this, hwndDlg, hwndCtl);
  let first = start;
  let at = start;

  for (;;) {
    at = fPrevious ? groupPrevious(this, hwndDlg, at) : groupNext(this, hwndDlg, at);

    const round = at === first;

    if (!first) {
      first = at;
    }

    if (round || !at || reachable(this, at)) {
      return at;
    }
  }
}

/**
 * The dialog manager moving the focus (`USER.EXE` seg25 `0000`): a control
 * that asks for it (`DLGC_HASSETSEL`) has all its text selected first, then
 * takes the focus. Every move the dialog manager makes goes through this --
 * the first control when a dialog is made, Tab, the arrows, a mnemonic,
 * `WM_NEXTDLGCTL` -- except handing the focus back to the control that had it
 * when the dialog was last active, which is a plain `SetFocus`. The end is
 * 0xFFFE for a program made for Windows 3 or later and 0x7FFF for an older
 * one.
 */
export async function dlgSetFocus(system: any, hwnd: number) {
  if ((await send(system, hwnd, WM_GETDLGCODE, 0, 0)) & DLGC_HASSETSEL) {
    const window = system.handles.resolve(hwnd);
    const instance = window?._createStruct?.hInstance ?? window?.data?.hInstance ?? 0;
    const version =
      system.handles.resolve(instance)?.executable?.neHeader?.expectedWindowsVersion ?? 0x300;

    await send(system, hwnd, EM_SETSEL, 0, version >= 0x300 ? 0xfffe0000 : 0x7fff0000);
  }

  return setFocus(system, hwnd);
}

/**
 * The dialog's default push button kept as the focus moves from `old` to
 * `to` (`USER.EXE` seg25 `0b5b`), each asked with `WM_GETDLGCODE`, `to`
 * first:
 *
 * * The same window: made the default if it answers
 *   `DLGC_UNDEFPUSHBUTTON`; nothing else.
 * * Otherwise, where either is a push button -- `old` asked first, `to`
 *   only if `old` is not -- every control that answers
 *   `DLGC_DEFPUSHBUTTON` is made plain (`0ab2`).
 * * Then `to`, if it answers `DLGC_UNDEFPUSHBUTTON`, is made the default;
 *   otherwise the control `DM_GETDEFID` names -- 1 where the dialog answers
 *   none -- if it answers `DLGC_UNDEFPUSHBUTTON` and not
 *   `DLGC_DEFPUSHBUTTON`, and is not disabled.
 *
 * `BM_SETSTYLE` with `BS_DEFPUSHBUTTON` or `BS_PUSHBUTTON`, drawn at once.
 * **Recorded** by `defpush` and `dlgcode`: the dialog's first push button
 * given the focus as it opens takes the default's outline, and the
 * template's default keeps its own, the focus coming to the same window it
 * was given to `WM_INITDIALOG`.
 */
export async function checkDefPush(system: any, hwnd: number, old: number, to: number) {
  const code = to ? await send(system, to, WM_GETDLGCODE, 0, 0) : 0;

  if (old === to) {
    if (code & DLGC_UNDEFPUSHBUTTON) {
      await send(system, to, BM_SETSTYLE, BS_DEFPUSHBUTTON, 1);
    }

    return;
  }

  if (
    (old &&
      (await send(system, old, WM_GETDLGCODE, 0, 0)) &
        (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON)) ||
    (to && code & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON))
  ) {
    await clearDefPush(system, hwnd, to);
  }

  if (code & DLGC_UNDEFPUSHBUTTON) {
    await send(system, to, BM_SETSTYLE, BS_DEFPUSHBUTTON, 1);
    return;
  }

  const answer = await send(system, hwnd, DM_GETDEFID, 0, 0);
  const id = answer >>> 16 === DC_HASDEFID ? answer & 0xffff : 1;
  const button = dlgItem(system, hwnd, id);

  if (button) {
    const its = await send(system, button, WM_GETDLGCODE, 0, 0);

    if (
      !(its & DLGC_DEFPUSHBUTTON) &&
      its & DLGC_UNDEFPUSHBUTTON &&
      !(styleOf(system, button) & WS_DISABLED)
    ) {
      await send(system, button, BM_SETSTYLE, BS_DEFPUSHBUTTON, 1);
    }
  }
}

/**
 * Every control that answers `DLGC_DEFPUSHBUTTON` made plain with
 * `BM_SETSTYLE` (`USER.EXE` seg25 `0ab2`): each child asked, from the
 * control `from` is in -- the first child for none -- round to it.
 */
async function clearDefPush(system: any, hwnd: number, from: number) {
  const start = (from && childControl(system, hwnd, from)) || nextChild(system, hwnd, 0);

  if (!start) {
    return;
  }

  let at = start;

  do {
    if ((await send(system, at, WM_GETDLGCODE, 0, 0)) & DLGC_DEFPUSHBUTTON) {
      await send(system, at, BM_SETSTYLE, BS_PUSHBUTTON, 1);
    }

    at = nextChild(system, hwnd, at);
  } while (at && at !== start);
}

/** The focus moved to a window: `WM_KILLFOCUS` to the one losing it, `WM_SETFOCUS` to it. */
export async function setFocus(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  /* Not to a window that is minimized or disabled, or inside one (`USER.EXE`
   * seg1 `3869`). */
  for (let at = window.window; at; at = at.parent) {
    if (at.state === 'minimized' || at.style & (User.WS_MINIMIZE | User.WS_DISABLED)) {
      return 0;
    }
  }

  const desktop = window.desktop;

  /* The computer-based training hooks asked, `HCBT_SETFOCUS`, the window and
   * the one that has the focus, unless it has it already; non-nought in AX,
   * nothing changes and the answer is nought (`387f`-`3897`; **recorded** by
   * `cbthook`). */
  if (desktop.focus !== window.window) {
    const asked = await askCbt(system, HCBT_SETFOCUS, hwnd, desktop.focus?.hwnd ?? 0);

    if (asked.answer & 0xffff) {
      return 0;
    }
  }

  /* The window at the top it is in made active first, if it is not
   * (`3899`-`38b2`; `comboact`) -- shown or hidden: nothing asks whether it
   * shows (`3514`). A dialog made hidden, as `DialogBox` and `MessageBox`
   * make one, is so made active as its first control is given the focus,
   * and the window it covers is told while its focus is still in it, keeps
   * that, and has it back when the box is gone (`hidfocus`). An activation
   * the computer-based training hooks refuse gives the focus to nothing,
   * and the answer is nought (`38a6`). */
  let activated = false;

  if (desktop.focus !== window.window) {
    let top = window.window;

    while (top.parent) {
      top = top.parent;
    }

    if (
      !top.active &&
      (top.style & (WS_CHILD | WS_POPUP)) !== WS_CHILD &&
      !(top.style & (User.WS_MINIMIZE | User.WS_DISABLED)) &&
      top.state !== 'minimized'
    ) {
      if (!(await activateForFocus(system, top))) {
        return 0;
      }

      activated = true;
    }
  }

  const previous = desktop.focus?.hwnd ?? 0;

  /* The window that has it already keeps it, told nothing -- but not after
   * an activation: USER gives the focus then whoever has it, the window
   * itself where `DefWindowProc` gave it that on `WM_ACTIVATE`, and it is
   * told it lost it to itself and has it (`38b2`, then `3842`-`3848`,
   * `3412`). */
  if (desktop.focus === window.window && !activated) {
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

const WS_POPUP = 0x80000000;

/**
 * The focus moved as USER moves it after an activation, asking nothing of
 * the window (`USER.EXE` seg1 `3412`): the focus set, the window that had it
 * told `WM_KILLFOCUS`, and the new one `WM_SETFOCUS` if it has it still.
 * **Recorded** by `enddlg`: an owner disabled before `DialogBox`, made
 * active again as the dialog ends, takes the focus from the hidden dialog,
 * though `SetFocus` would refuse it.
 */
export async function changeFocus(system: any, hwnd: number) {
  const desktop = system.rasterDesktop;
  const window = system.handles.resolve(hwnd);

  if (!desktop || !(window instanceof RasterWindow)) {
    return;
  }

  const previous = desktop.focus?.hwnd ?? 0;

  desktop.focus = window.window;

  if (previous) {
    system._focusGoing = hwnd;
    await send(system, previous, User.WM_KILLFOCUS, hwnd, 0);
    system._focusGoing = undefined;
  }

  if (desktop.focus === window.window) {
    await send(system, hwnd, User.WM_SETFOCUS, previous, 0);
  }
}

/**
 * A message handed to a dialog: the keys and characters it takes itself,
 * and the rest dispatched (`USER.EXE` seg25 `0c23`, behind the checks at
 * `2804`). TRUE for every message it takes or dispatches; FALSE for one not
 * for the dialog or a window inside it.
 *
 * * The message filters first, with `MSGF_DIALOGBOX`, as `CallMsgFilter`
 *   calls them (`0c38`): a message a filter takes is answered TRUE, and
 *   nothing more is done. **Recorded** by `dlgcode`: a filter is called with
 *   every message handed over, one for a window outside the dialog too, in
 *   a program's own loop as in `DialogBox`'s, and one it takes is not
 *   dispatched.
 * * `WM_KEYDOWN`, `WM_CHAR` and `WM_SYSCHAR` as below; a press of the left
 *   button on a control keeps the default push button as the focus would
 *   move to it, then is dispatched (`0e98`); anything else is dispatched.
 */
export async function IsDialogMessage(this: any, hwndDlg: number, lpmsg: any) {
  const dialog = this.handles.resolve(hwndDlg);

  if (!(dialog instanceof RasterWindow)) {
    return FALSE;
  }

  if (await callMsgFilter(this, lpmsg, MSGF_DIALOGBOX)) {
    return TRUE;
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
  const hwnd = lpmsg.hwnd & 0xffff;
  /* The control is asked with the message, as a far pointer to it
   * (`USER.EXE` seg25 `0cae`, `0db3`, `0ebc`): a multi-line edit control
   * learns so that it is in a dialog. A copy, its point a `POINT` as the
   * structure is written for a program's procedure: COMMDLG's lists are
   * subclassed. */
  const asked = () => {
    const msg: any = new MSG();
    const pt: any = new POINT();

    pt.x = lpmsg.pt?.x ?? 0;
    pt.y = lpmsg.pt?.y ?? 0;
    Object.assign(msg, {
      hwnd: lpmsg.hwnd,
      message: lpmsg.message,
      wParam: lpmsg.wParam,
      lParam: lpmsg.lParam,
      time: lpmsg.time ?? 0,
      pt,
    });
    return [msg];
  };
  const dispatch = async () => {
    TranslateMessage.call(this, lpmsg);
    await DispatchMessage.call(this, lpmsg);

    return TRUE;
  };
  const focus = () => this.rasterDesktop?.focus?.hwnd ?? 0;

  if (message === User.WM_KEYDOWN) {
    const code = await send(this, hwnd, WM_GETDLGCODE, lpmsg.wParam, asked());

    if (code & DLGC_WANTALLKEYS) {
      return dispatch();
    }

    switch (lpmsg.wParam & 0xffff) {
      /* Tab, Shift held or not: the next tab item or the one before
       * (`0d03`-`0d2a`). */
      case VK_TAB: {
        if (code & DLGC_WANTTAB) {
          return dispatch();
        }

        const shift = (GetKeyState.call(this, VK_SHIFT) & 0x8000) !== 0;
        const next = nextTabItem(this, hwndDlg, hwnd, shift);

        await dlgSetFocus(this, next);
        await checkDefPush(this, hwndDlg, hwnd, next);
        return TRUE;
      }

      /* Enter, or Execute: the focus's own identifier where it answers
       * `DLGC_DEFPUSHBUTTON`, else what `DM_GETDEFID` answers, else `IDOK`
       * (`0d2d`-`0d68`). */
      case VK_RETURN:
      case VK_EXECUTE: {
        const focused = focus();
        const its = focused ? await send(this, focused, WM_GETDLGCODE, 0, 0) : 0;
        let id = focused ? GetDlgCtrlID.call(this, focused) : 0;

        if (!(its & DLGC_DEFPUSHBUTTON)) {
          const answer = await send(this, hwndDlg, DM_GETDEFID, 0, 0);

          id = answer >>> 16 === DC_HASDEFID ? answer & 0xffff : IDOK;
        }

        return command(this, hwndDlg, id);
      }

      /* Escape, or Ctrl and Break: `IDCANCEL` (`0d6b`). */
      case VK_ESCAPE:
      case VK_CANCEL:
        return command(this, hwndDlg, IDCANCEL);

      /* An arrow: the next control of the group, or the one before
       * (`0d92`-`0e38`). */
      case VK_LEFT:
      case VK_UP:
      case VK_RIGHT:
      case VK_DOWN: {
        if (code & DLGC_WANTARROWS) {
          return dispatch();
        }

        const previous = lpmsg.wParam === VK_LEFT || lpmsg.wParam === VK_UP;
        const next = GetNextDlgGroupItem.call(this, hwndDlg, hwnd, previous ? 1 : 0);
        const its = await send(this, next, WM_GETDLGCODE, lpmsg.wParam, asked());

        /* A push button is given the focus marked as the dialog manager's,
         * as for a mnemonic. */
        if (its & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON)) {
          await markedFocus(this, next);
          await checkDefPush(this, hwndDlg, hwnd, next);
          return TRUE;
        }

        /* A radio button: and an automatic one unchecked is clicked, with
         * 463h (`0de6`-`0e27`). **Recorded** by `dlgcode`: the button tells
         * its parent it was clicked as it gains the focus, then again as
         * it is clicked. */
        if (its & DLGC_RADIOBUTTON) {
          await dlgSetFocus(this, next);
          await checkDefPush(this, hwndDlg, hwnd, next);

          if (
            (styleOf(this, next) & 0xdf) === BS_AUTORADIOBUTTON &&
            !(await send(this, next, BM_GETCHECK, 0, 0))
          ) {
            await send(this, next, BM_CLICK, 1, 0);
          }

          return TRUE;
        }

        /* Static text is not moved to. */
        if (its & DLGC_STATIC) {
          return TRUE;
        }

        await dlgSetFocus(this, next);
        await checkDefPush(this, hwndDlg, hwnd, next);
        return TRUE;
      }
    }

    return dispatch();
  }

  /* A press on a control: the default push button kept as the focus would
   * move to it, then the press dispatched (`0e98`-`0eb1`). */
  if (message === User.WM_LBUTTONDOWN) {
    if (hwnd !== hwndDlg && focus()) {
      await checkDefPush(this, hwndDlg, focus(), hwnd);
    }

    return dispatch();
  }

  /* `WM_SYSCHAR` (`0e48`-`0e78`): with no window focused, and Alt up by the
   * keyboard's state (`GetKeyState`, not the message), a beep -- or, for
   * Enter in a dialog minimized, `DefWindowProc`'s -- and nothing more;
   * Alt and Space is the dialog's own `DefWindowProc`'s, for its system
   * menu; anything else a mnemonic, as a character is. **Recorded** by
   * `syschar`: with no focus, a dialog posted Alt's bit and a letter takes
   * it and is sent nothing. */
  if (message === User.WM_SYSCHAR) {
    if (!focus() && !(GetKeyState.call(this, VK_MENU) & 0x8000)) {
      if (lpmsg.wParam === VK_RETURN && dialog.window.state === 'minimized') {
        await DefWindowProc.call(this, hwndDlg, message, lpmsg.wParam, lpmsg.lParam);
      } else {
        MessageBeep.call(this, 0);
      }

      return TRUE;
    }

    if (lpmsg.wParam === 0x20) {
      await DefWindowProc.call(this, hwndDlg, message, lpmsg.wParam, lpmsg.lParam);
      return TRUE;
    }
  }

  /* A character (`0eb4`-`0f2b`): one for the dialog itself is taken and
   * nothing done; one the window it is for wants, asked with the message,
   * is its own; a space is taken; then the control the character names
   * (seg19 `01a5`). Named by none, it is the window's own where it wants
   * every key; Alt's is the dialog's `DefWindowProc`'s, which opens its
   * system menu's loop for the letter; a plain character beeps. A control
   * it names that is not a push button has the default push button kept as
   * the focus moved to it. **Recorded** by `syschar` and `dlgcode`. */
  if (message === User.WM_SYSCHAR || message === User.WM_CHAR) {
    if (hwnd === hwndDlg) {
      return TRUE;
    }

    const code = await send(this, hwnd, WM_GETDLGCODE, lpmsg.wParam, asked());

    if (message === User.WM_CHAR && code & (DLGC_WANTCHARS | DLGC_WANTALLKEYS)) {
      return dispatch();
    }

    if ((lpmsg.wParam & 0xff) === 0x20) {
      return TRUE;
    }

    const taken = await takeMnemonic(this, hwndDlg, hwnd, lpmsg.wParam & 0xff);

    if (!taken) {
      if (code & DLGC_WANTALLKEYS) {
        return dispatch();
      }

      if (message === User.WM_SYSCHAR) {
        await DefWindowProc.call(this, hwndDlg, message, lpmsg.wParam, lpmsg.lParam);
      } else {
        MessageBeep.call(this, 0);
      }

      return TRUE;
    }

    if (taken !== 1) {
      await checkDefPush(this, hwndDlg, hwnd, taken);
    }

    return TRUE;
  }

  return dispatch();
}

/**
 * The command of Enter or Escape (seg25 `0d6b`, `0e3a`): `WM_COMMAND` to the
 * dialog with the control of that identifier -- none, where it has none --
 * or a beep for a control disabled.
 */
async function command(system: any, hwnd: number, id: number) {
  const button = dlgItem(system, hwnd, id);

  if (button && styleOf(system, button) & WS_DISABLED) {
    MessageBeep.call(system, 0);
    return TRUE;
  }

  await send(system, hwnd, User.WM_COMMAND, id, button & 0xffff);
  return TRUE;
}

/**
 * The focus given by the dialog manager to a button it is about to click
 * itself, marked so for the moment (`USER.EXE` seg19 `0233`-`023d`, seg25
 * `0dcc`-`0dd6`): a radio button so gaining it does not tell its parent it
 * was clicked.
 */
async function markedFocus(system: any, hwnd: number) {
  const control = system.handles.resolve(hwnd)?.window?.control;

  if (control) {
    control.state = (control.state ?? 0) | DIALOG_FOCUS;
  }

  await dlgSetFocus(system, hwnd);

  if (control) {
    control.state = (control.state ?? 0) & ~DIALOG_FOCUS;
  }
}

/**
 * Whether a control's text has the character as its mnemonic (`USER.EXE`
 * seg19 `0000`, with no first-letter match and a prefix looked for): spaces
 * at its start skipped, then the first `&` not doubled -- a doubled one
 * passed over -- and the character after it, both made capitals.
 */
function hasMnemonic(text: string, letter: number) {
  const upper = (code: number) => ansiUpperByte(code) & 0xff;
  const wanted = upper(letter);
  let at = 0;

  while (text.charCodeAt(at) === 0x20) {
    at++;
  }

  while (at < text.length) {
    if (text.charCodeAt(at++) !== 0x26) {
      continue;
    }

    if (text.charCodeAt(at) === 0x26) {
      at++;
      continue;
    }

    return at < text.length && upper(text.charCodeAt(at)) === wanted;
  }

  return false;
}

/**
 * The control a character names, from the control `from` is in (`USER.EXE`
 * seg19 `00a5`): first round its group with `GetNextDlgGroupItem`, up to
 * sixty, back to `from`; then round all the dialog's children from it. Each
 * is asked with `WM_GETDLGCODE` and nought: one that wants characters is
 * passed over, and so is static text with `SS_NOPREFIX`; the others' text
 * is read and looked at for the mnemonic. None, nought.
 */
async function findMnemonic(system: any, hwnd: number, from: number, letter: number) {
  const names = async (control: number) => {
    const code = await send(system, control, WM_GETDLGCODE, 0, 0);

    if (code & DLGC_WANTCHARS) {
      return false;
    }

    if (code & DLGC_STATIC && styleOf(system, control) & SS_NOPREFIX) {
      return false;
    }

    return hasMnemonic(await controlText(system, control), letter);
  };
  let at = childControl(system, hwnd, from);

  for (let count = 1; count <= 60; count++) {
    const next = GetNextDlgGroupItem.call(system, hwnd, at, 0);

    if (!next || next === from) {
      break;
    }

    at = next;

    if (await names(next)) {
      return next;
    }
  }

  const start = childControl(system, hwnd, from);

  at = start;

  do {
    at = nextChild(system, hwnd, at);

    if (!at) {
      return 0;
    }

    if (await names(at)) {
      return at;
    }
  } while (at !== start);

  return 0;
}

/**
 * The control a character names, taken (`USER.EXE` seg19 `01a5`-`02a0`):
 * nought where none is found; 1 for a push button; else the control.
 *
 * * Static text named gives way to the next tab item after it, unless it
 *   is disabled; a disabled control is passed over for the next named,
 *   until the first disabled one comes round again.
 * * A push button is pressed and let go with `BM_SETSTATE`, a pause
 *   between, and its parent sent `WM_COMMAND` with `BN_CLICKED`; the focus
 *   stays where it was.
 * * A button of another kind is given the focus marked as the dialog
 *   manager's, then clicked with 463h where no other control has the
 *   mnemonic.
 * * Anything else is given the focus.
 *
 * **Recorded** by `syschar`, and by `dlgcode`: Alt and C for a check box
 * `&Check` with the focus in an edit control asks the controls of the edit
 * control's group and the rest of the dialog, gives the box the focus,
 * asks round again for another `&C`, finds none and sends the box 463h,
 * which it answers with a press and a release: checked, and `BN_CLICKED`.
 * Two check boxes `&Dup` have the focus moved to the first, then from it to
 * the second, and neither is clicked.
 */
async function takeMnemonic(system: any, hwnd: number, from: number, letter: number) {
  let at = from;
  let firstDisabled = 0;
  let code = 0;
  let found = false;

  for (let tries = 0; tries < 0x200; tries++) {
    at = await findMnemonic(system, hwnd, at, letter);

    if (!at) {
      return 0;
    }

    code = await send(system, at, WM_GETDLGCODE, 0, 0);

    if (code & DLGC_STATIC && !(styleOf(system, at) & WS_DISABLED)) {
      at = nextTabItem(system, hwnd, at, false);
      code = await send(system, at, WM_GETDLGCODE, 0, 0);
    }

    if (!(styleOf(system, at) & WS_DISABLED)) {
      found = true;
      break;
    }

    if (firstDisabled === at) {
      return 0;
    }

    firstDisabled ||= at;
  }

  if (!found) {
    return 0;
  }

  if (!(code & DLGC_BUTTON)) {
    await dlgSetFocus(system, at);
    return at;
  }

  if (code & (DLGC_DEFPUSHBUTTON | DLGC_UNDEFPUSHBUTTON)) {
    const parent = system.handles.resolve(at)?.window?.parent?.hwnd ?? 0;

    await send(system, at, BM_SETSTATE, 1, 0);
    await send(system, at, BM_SETSTATE, 0, 0);

    if (parent) {
      await send(system, parent, User.WM_COMMAND, GetDlgCtrlID.call(system, at), at & 0xffff);
    }

    return 1;
  }

  await markedFocus(system, at);

  if ((await findMnemonic(system, hwnd, at, letter)) === at) {
    await send(system, at, BM_CLICK, 1, 0);
  }

  return at;
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
