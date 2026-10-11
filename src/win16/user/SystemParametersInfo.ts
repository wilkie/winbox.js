'use strict';

import { FALSE, TRUE } from '../consts.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { holdProfile, readProfile, writeProfile } from '../kernel/profiles.js';
import { broadcastTargets } from './broadcast.js';
import { noteInput } from './screen-saver.js';
import { languageDriver, setLanguageDriver } from './language-driver.js';
import { descendants, topLevel } from './enumerate.js';
import { RasterWindow } from './raster-window.js';
import { setPattern, setWallpaper } from './desk.js';
import { SendMessage } from './SendMessage.js';
import {
  DESKTOP,
  iconTitleFontOfProfile,
  loadParameters,
  type Parameters,
  WINDOWS,
} from './system-parameters.js';
import { positionRaster } from './window-state.js';

const SPI_GETBEEP = 1;
const SPI_SETBEEP = 2;
const SPI_GETMOUSE = 3;
const SPI_SETMOUSE = 4;
const SPI_GETBORDER = 5;
const SPI_SETBORDER = 6;
const SPI_GETKEYBOARDSPEED = 10;
const SPI_SETKEYBOARDSPEED = 11;
const SPI_LANGDRIVER = 12;
const SPI_ICONHORIZONTALSPACING = 13;
const SPI_GETSCREENSAVETIMEOUT = 14;
const SPI_SETSCREENSAVETIMEOUT = 15;
const SPI_GETSCREENSAVEACTIVE = 16;
const SPI_SETSCREENSAVEACTIVE = 17;
const SPI_GETGRIDGRANULARITY = 18;
const SPI_SETGRIDGRANULARITY = 19;
const SPI_SETDESKWALLPAPER = 20;
const SPI_SETDESKPATTERN = 21;
const SPI_GETKEYBOARDDELAY = 22;
const SPI_SETKEYBOARDDELAY = 23;
const SPI_ICONVERTICALSPACING = 24;
const SPI_GETICONTITLEWRAP = 25;
const SPI_SETICONTITLEWRAP = 26;
const SPI_GETMENUDROPALIGNMENT = 27;
const SPI_SETMENUDROPALIGNMENT = 28;
const SPI_SETDOUBLECLKWIDTH = 29;
const SPI_SETDOUBLECLKHEIGHT = 30;
const SPI_GETICONTITLELOGFONT = 31;
const SPI_SETDOUBLECLICKTIME = 32;
const SPI_SETMOUSEBUTTONSWAP = 33;
const SPI_SETICONTITLELOGFONT = 34;
const SPI_GETFASTTASKSWITCH = 35;
const SPI_SETFASTTASKSWITCH = 36;

const SPIF_UPDATEINIFILE = 1;
const SPIF_SENDWININICHANGE = 2;

const WM_WININICHANGE = 0x001a;
const WM_SYSCOLORCHANGE = 0x0015;

const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;

const WS_THICKFRAME = 0x00040000;

/** The actions that read a setting into the buffer given. */
const READING = new Set([
  SPI_GETBEEP,
  SPI_GETMOUSE,
  SPI_GETBORDER,
  SPI_GETKEYBOARDSPEED,
  SPI_GETSCREENSAVETIMEOUT,
  SPI_GETSCREENSAVEACTIVE,
  SPI_GETGRIDGRANULARITY,
  SPI_GETKEYBOARDDELAY,
  SPI_GETICONTITLEWRAP,
  SPI_GETMENUDROPALIGNMENT,
  SPI_GETICONTITLELOGFONT,
  SPI_GETFASTTASKSWITCH,
]);

/** A number as USER writes one, `wsprintf`'s `%d`. */
const decimal = (value: number) => String((value << 16) >> 16);

/** What an action leaves to be done once USER's own state is set, in USER's order. */
interface After {
  border?: number;
  redraw?: boolean;
  sysColorChange?: boolean;
  iniChange?: string;
}

/**
 * The **SystemParametersInfo** function reads or sets a system-wide
 * setting, as USER's table has each (`USER.EXE` seg41 `0ed6`, behind the
 * checks at `1895`): TRUE, or FALSE for an action it has no case for --
 * nought, 7, 8, 9 and past 36 -- and for a setting it would not take.
 *
 * With `SPIF_UPDATEINIFILE` a setting that changes is written to `WIN.INI`,
 * in `[Windows]` or `[Desktop]`, under its name in USER's string table
 * (`0e91`); with `SPIF_SENDWININICHANGE` as well, where the last write took,
 * every window at the top is sent `WM_WININICHANGE` with the section's name
 * (`16ed`). **Recorded** by `sysparam`, action by action. The Rust engine's
 * `system_parameters.rs` is the same.
 *
 * Not followed: a reading action given a null pointer, which USER writes
 * through and faults on, answers FALSE here; and nothing is made of the
 * keyboard's repeat and delay beyond keeping them: the host's keyboard
 * repeats.
 *
 * @param {Types.UINT} uAction - The setting.
 * @param {Types.UINT} uParam - Its parameter.
 * @param {Types.FARPTR} lpvParam - Where it is read from or written.
 * @param {Types.UINT} fuWinIni - Whether a change goes to `WIN.INI`, and is told.
 *
 * @returns {Types.BOOL} Whether the setting was answered or taken.
 */
export async function SystemParametersInfo(
  this: any,
  uAction: number,
  uParam: number,
  lpvParam: number,
  fuWinIni: number
) {
  const [answer, after] = await set(
    this,
    uAction & 0xffff,
    uParam & 0xffff,
    lpvParam >>> 0,
    fuWinIni
  );

  if (after.border !== undefined) {
    await growFrames(this, after.border);
  }

  if (after.sysColorChange) {
    await broadcast(this, WM_SYSCOLORCHANGE, null);
  }

  if (after.redraw) {
    this.rasterDesktop?.repaintAll();
  }

  if (after.iniChange !== undefined) {
    await broadcast(this, WM_WININICHANGE, after.iniChange);
  }

  return answer ? TRUE : FALSE;
}

/** USER's own state read or set, and `WIN.INI` written. */
async function set(
  system: any,
  action: number,
  param: number,
  far: number,
  ini: number
): Promise<[boolean, After]> {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const update = (ini & SPIF_UPDATEINIFILE) !== 0;
  const after: After = {};
  /* Whether the last write took, and the section it named (seg41 `bp-6Ch`, `bp-3Ch`). */
  let written = false;
  let section = '';

  const write = async (from: string, key: string, value: string | null) => {
    section = from;
    written = await writeSetting(system, from, key, value);

    return written;
  };
  const word = (value: number, at = 0) =>
    core.write16(segment, (offset + at) & 0xffff, value & 0xffff);
  const readWord = (at: number) => core.read16(segment, (offset + at) & 0xffff);
  const readString = () => {
    let text = '';

    for (let at = 0; at < 0x400; at++) {
      const byte = core.read8(segment, (offset + at) & 0xffff);

      if (!byte) {
        break;
      }

      text += String.fromCharCode(byte);
    }

    return text;
  };

  if (READING.has(action) && !far) {
    return [false, after];
  }

  const parameters: Parameters = await loadParameters(system);

  switch (action) {
    case SPI_GETBEEP:
      word(parameters.beep);
      return [true, after];

    case SPI_SETBEEP:
      parameters.beep = param;

      if (update) {
        await write(WINDOWS, 'Beep', param ? 'Yes' : 'No');
      }

      break;

    case SPI_GETMOUSE:
      parameters.mouse.forEach((value, at) => word(value, at * 2));
      return [true, after];

    case SPI_SETMOUSE: {
      const mouse: [number, number, number] = [readWord(0), readWord(2), readWord(4)];

      parameters.mouse = mouse;

      if (update) {
        let any = false;

        for (const [at, key] of ['MouseThreshold1', 'MouseThreshold2', 'MouseSpeed'].entries()) {
          any = (await write(WINDOWS, key, decimal(mouse[at]))) || any;
        }

        written = any;
      }

      break;
    }

    case SPI_GETBORDER:
      word(parameters.border);
      return [true, after];

    case SPI_SETBORDER: {
      const before = parameters.border;
      const border = Math.min(Math.max((param << 16) >> 16, 1), 50);

      if (border === before) {
        return [true, after];
      }

      parameters.border = border;
      after.border = border - before;
      after.redraw = true;

      if (update) {
        await write(WINDOWS, 'BorderWidth', decimal(param));
      }

      break;
    }

    case SPI_GETKEYBOARDSPEED:
      word(parameters.keyboard & 0x1f);
      return [true, after];

    case SPI_SETKEYBOARDSPEED:
      parameters.keyboard = ((parameters.keyboard & 0xffe0) | param) & 0xffff;

      if (update) {
        await write(WINDOWS, 'KeyboardSpeed', decimal(param));
      }

      break;

    case SPI_GETKEYBOARDDELAY:
      word((parameters.keyboard & 0x60) >> 5);
      return [true, after];

    case SPI_SETKEYBOARDDELAY:
      parameters.keyboard = ((parameters.keyboard & 0xff9f) | (param << 5)) & 0xffff;

      if (update) {
        await write(WINDOWS, 'KeyboardDelay', decimal(param));
      }

      break;

    /* The language driver loaded (`language-driver.ts`); `SYSTEM.INI`
     * written with no message (seg41 `116f`-`11e5`). */
    case SPI_LANGDRIVER: {
      const name = far ? readString() : null;

      if (!(await setLanguageDriver(system, name))) {
        return [false, after];
      }

      if (update) {
        const profile = await readProfile(system, 'SYSTEM.INI');

        profile.set('boot', 'LANGUAGE.DLL', languageDriver(system) ? (name ?? '') : '');

        if (await writeProfile(system, 'SYSTEM.INI', profile)) {
          holdProfile(system, 'SYSTEM.INI', profile);
        }
      }

      return [true, after];
    }

    case SPI_ICONHORIZONTALSPACING:
    case SPI_ICONVERTICALSPACING: {
      const horizontal = action === SPI_ICONHORIZONTALSPACING;
      const at = horizontal ? 0 : 1;

      /* A pointer with a selector reads (`11ed`); none, and nought, does nothing. */
      if (segment) {
        word(parameters.iconSpacing[at]);
        return [true, after];
      }

      if (!param) {
        return [true, after];
      }

      const least = system.display?.metricsByIndex?.[horizontal ? SM_CXICON : SM_CYICON] ?? 0;
      const spacing = Math.max(param, least);

      parameters.iconSpacing[at] = spacing;

      if (update) {
        await write(DESKTOP, horizontal ? 'IconSpacing' : 'IconVerticalSpacing', decimal(spacing));
      }

      break;
    }

    case SPI_GETSCREENSAVETIMEOUT:
      word(Math.abs(parameters.screenSave));
      return [true, after];

    case SPI_SETSCREENSAVETIMEOUT: {
      const delay = (param << 16) >> 16;

      /* The time noted, the screen saver's delay counted from it (seg41
       * `1297`; `screen-saver.ts`). */
      noteInput(system);

      parameters.screenSave = parameters.screenSave < 0 ? (-delay << 16) >> 16 : delay;

      if (update) {
        await write(WINDOWS, 'ScreenSaveTimeOut', decimal(param));
      }

      break;
    }

    case SPI_GETSCREENSAVEACTIVE:
      word(parameters.screenSave > 0 ? 1 : 0);
      return [true, after];

    case SPI_SETSCREENSAVEACTIVE:
      /* The time noted (seg41 `12f8`). */
      noteInput(system);

      if ((param && parameters.screenSave < 0) || (!param && parameters.screenSave > 0)) {
        parameters.screenSave = (-parameters.screenSave << 16) >> 16;
      }

      if (update) {
        await write(WINDOWS, 'ScreenSaveActive', param ? '1' : '0');
      }

      break;

    case SPI_GETGRIDGRANULARITY:
      word(Math.trunc(parameters.grid / 8));
      return [true, after];

    case SPI_SETGRIDGRANULARITY:
      parameters.grid = Math.max((((param << 3) & 0xffff) << 16) >> 16, 1);

      if (update) {
        await write(DESKTOP, 'GridGranularity', decimal(param));
      }

      break;

    case SPI_SETDESKWALLPAPER: {
      const given = far && far !== 0xffffffff ? readString() : null;

      if (!(await setWallpaper(system, parameters, given))) {
        return [false, after];
      }

      if (update && far !== 0xffffffff) {
        await write(DESKTOP, 'Wallpaper', given ?? '(None)');
      }

      after.redraw = true;
      break;
    }

    case SPI_SETDESKPATTERN: {
      if (param === 0xffff && far) {
        return [false, after];
      }

      const given = far ? readString() : null;

      if (!(await setPattern(system, parameters, param === 0xffff, given))) {
        return [false, after];
      }

      after.sysColorChange = true;
      after.redraw = true;

      if (update) {
        await write(DESKTOP, 'Pattern', given);
      }

      break;
    }

    case SPI_GETICONTITLEWRAP:
      word(parameters.iconTitleWrap);
      return [true, after];

    case SPI_SETICONTITLEWRAP: {
      const wrap = param ? 1 : 0;

      if (parameters.iconTitleWrap && wrap) {
        return [true, after];
      }

      parameters.iconTitleWrap = wrap;
      after.redraw = true;

      if (update) {
        await write(DESKTOP, 'IconTitleWrap', decimal(wrap));
      }

      break;
    }

    case SPI_GETMENUDROPALIGNMENT:
      word(parameters.menuDropAlignment);
      return [true, after];

    case SPI_SETMENUDROPALIGNMENT:
      parameters.menuDropAlignment = param ? 1 : 0;

      if (update) {
        await write(WINDOWS, 'MenuDropAlignment', decimal(param));
      }

      break;

    case SPI_SETDOUBLECLKWIDTH:
    case SPI_SETDOUBLECLKHEIGHT: {
      const width = action === SPI_SETDOUBLECLKWIDTH;

      parameters.doubleClickSize[width ? 0 : 1] = param;

      if (update) {
        await write(WINDOWS, width ? 'DoubleClickWidth' : 'DoubleClickHeight', decimal(param));
      }

      break;
    }

    case SPI_GETICONTITLELOGFONT:
      /* As many bytes as asked for (seg1 `39e2`); past the structure, noughts. */
      for (let at = 0; at < param; at++) {
        core.write8(segment, (offset + at) & 0xffff, parameters.iconTitleFont[at] ?? 0);
      }

      return [true, after];

    case SPI_SETDOUBLECLICKTIME:
      system._doubleClickTime = param || 500;

      if (update) {
        await write(WINDOWS, 'DoubleClickSpeed', decimal(param));
      }

      break;

    case SPI_SETMOUSEBUTTONSWAP:
      system._swapButtons = param ? 1 : 0;

      if (update) {
        await write(WINDOWS, 'SwapMouseButtons', param === 1 ? '1' : '0');
      }

      break;

    case SPI_SETICONTITLELOGFONT: {
      if ((far && param !== 50) || (!far && param !== 0)) {
        return [false, after];
      }

      let font: Uint8Array;

      if (far) {
        font = new Uint8Array(50);

        for (let at = 0; at < 50; at++) {
          font[at] = core.read8(segment, (offset + at) & 0xffff);
        }
      } else {
        font = iconTitleFontOfProfile(system, await readProfile(system, 'WIN.INI'));
      }

      parameters.iconTitleFont = font;
      after.redraw = true;

      if (update) {
        if (!far) {
          /* Nothing written, and the section's name never loaded: the
           * message names what was there, nothing as recorded. */
          written = true;
        } else {
          let face = '';

          for (let at = 18; at < 50 && font[at]; at++) {
            face += String.fromCharCode(font[at]);
          }

          await write(DESKTOP, 'IconTitleFaceName', face);
          await write(DESKTOP, 'IconTitleSize', decimal(font[0] | (font[1] << 8)));
          await write(DESKTOP, 'IconTitleStyle', (font[8] | (font[9] << 8)) === 700 ? '1' : '0');
        }
      }

      break;
    }

    case SPI_GETFASTTASKSWITCH:
      word(parameters.fastTaskSwitch);
      return [true, after];

    case SPI_SETFASTTASKSWITCH:
      parameters.fastTaskSwitch = param === 1 ? 1 : 0;

      if (update) {
        await write(WINDOWS, 'CoolSwitch', decimal(parameters.fastTaskSwitch));
      }

      break;

    default:
      return [false, after];
  }

  if (written && ini & SPIF_SENDWININICHANGE) {
    after.iniChange = section;
  }

  return [true, after];
}

/**
 * An entry of `WIN.INI` written as `WriteProfileString` writes it -- its
 * trailing spaces and tabs cut -- or taken away for none: whether it was.
 */
async function writeSetting(system: any, section: string, key: string, value: string | null) {
  const profile = await readProfile(system, 'WIN.INI');

  profile.set(section, key, value === null ? null : value.replace(/[ \t]+$/, ''));

  const ok = await writeProfile(system, 'WIN.INI', profile);

  if (ok) {
    holdProfile(system, 'WIN.INI', profile);
  }

  return ok;
}

/**
 * A message sent to every window at the top (`SendMessage` with
 * `HWND_BROADCAST`, seg1 `22e3`), as `EnumWindows` takes them. A section's
 * name goes in a block of `GlobalAlloc`'s, flags 1000h, its offset
 * nought, freed after (seg1 `0093`).
 */
async function broadcast(system: any, message: number, text: string | null) {
  const hwnds = broadcastTargets(system, false);
  let block = 0;
  let far = 0;

  if (text !== null) {
    block = GlobalAlloc.call(system, 0x1000, text.length + 1);

    if (!block) {
      return;
    }

    far = globalPointer.call(system, block) >>> 0;

    const core = system.machine.cpu.core;

    for (let at = 0; at <= text.length; at++) {
      core.write8(far >>> 16, (far & 0xffff) + at, at < text.length ? text.charCodeAt(at) : 0);
    }
  }

  for (const hwnd of hwnds) {
    if (system.handles.resolve(hwnd) instanceof RasterWindow) {
      await SendMessage.call(system, hwnd, message, 0, far);
    }
  }

  if (block) {
    GlobalFree.call(system, block);
  }
}

/**
 * Every sizable window grown by the border's change, its client area as it
 * was (seg41 `0d6e`): one not minimized moved and sized, one minimized
 * given a larger place to be restored to; each window's children after it.
 */
async function growFrames(system: any, delta: number) {
  const metrics = system.display?.metricsByIndex ?? {};
  const dx = delta * (metrics[SM_CXBORDER] ?? 1);
  const dy = delta * (metrics[SM_CYBORDER] ?? 1);
  const hwnds: number[] = [];

  for (const top of topLevel(system)) {
    hwnds.push(top.window.hwnd, ...descendants(system, top));
  }

  for (const hwnd of hwnds) {
    const raster = system.handles.resolve(hwnd);

    if (!(raster instanceof RasterWindow)) {
      continue;
    }

    const window: any = raster.window;

    if (!(window.style & WS_THICKFRAME)) {
      continue;
    }

    if (window.state === 'minimized') {
      const rect = window.restoreRect;

      if (rect) {
        window.restoreRect = {
          left: rect.left - dx,
          top: rect.top - dy,
          width: rect.width + 2 * dx,
          height: rect.height + 2 * dy,
        };
      }

      continue;
    }

    const parent = window.parent;
    const x = parent ? parent.left + parent.client.left : 0;
    const y = parent ? parent.top + parent.client.top : 0;

    await positionRaster(
      system,
      hwnd,
      raster,
      0,
      window.left - x - dx,
      window.top - y - dy,
      window.width + 2 * dx,
      window.height + 2 * dy,
      0x011c
    );
  }
}
