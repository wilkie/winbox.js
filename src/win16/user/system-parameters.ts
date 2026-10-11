'use strict';

import { readProfile, toInteger } from '../kernel/profiles.js';
import { type Wallpaper, setPattern, setWallpaper } from './desk.js';

/**
 * USER's system parameters: what `SystemParametersInfo` reads and sets,
 * kept as USER keeps them, read from `WIN.INI` as USER reads them as it
 * starts. The Rust engine's `system_parameters.rs` is the same, and says
 * where each is read out of `USER.EXE`.
 *
 * Where USER reads them as it starts is seg3: the keyboard's at `0356`, the
 * mouse's at `03f9`, the clicks', the menus' and the beep's at `1182` to
 * `128d`, the grid at `12a2`, the screen saver's at `20fc`, the border at
 * `226c`, and the icons' and their titles' at `1c4e`. Most go through a
 * helper (`0286`) that asks `GetProfileString` for one character and gives
 * the default where there is none, else asks `GetProfileInt`.
 */

/** The two sections, by their names in USER's string table. */
export const WINDOWS = 'Windows';
export const DESKTOP = 'Desktop';

/** The border width the displays' metrics were recorded with, USER's default. */
const RECORDED_BORDER = 3;

const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;
const SM_CXMIN = 28;
const SM_CYMIN = 29;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CXMINTRACK = 34;
const SM_CYMINTRACK = 35;
const SM_CXDOUBLECLK = 36;
const SM_CYDOUBLECLK = 37;
const SM_CXICONSPACING = 38;
const SM_CYICONSPACING = 39;
const SM_MENUDROPALIGNMENT = 40;

/** What USER keeps of the settings, each as it keeps it (seg45 in brackets). */
export interface Parameters {
  /** Whether `MessageBeep` sounds (`[14Ch]`): the word given, as given. */
  beep: number;
  /** The mouse's two thresholds and its speed. */
  mouse: [number, number, number];
  /** The sizing frame's width in borders, 1 to 50 (`[4F8h]`). */
  border: number;
  /** The keyboard's speed in the low five bits, its delay in the two above (`[0E6h]`). */
  keyboard: number;
  /** The screen saver's delay in seconds, negative while not active (`[0E8h]`). */
  screenSave: number;
  /** The sizing grid in pixels, eight to a unit, never less than 1 (`[6E8h]`). */
  grid: number;
  /** `SM_CXICONSPACING` and `SM_CYICONSPACING` (`[0C0h]`, `[0C2h]`). */
  iconSpacing: [number, number];
  /** Whether icons' titles wrap (`[1B2h]`). */
  iconTitleWrap: number;
  /** `SM_MENUDROPALIGNMENT` (`[0C4h]`). */
  menuDropAlignment: number;
  /** `SM_CXDOUBLECLK` and `SM_CYDOUBLECLK` (`[0BCh]`, `[0BEh]`). */
  doubleClickSize: [number, number];
  /** The icons' titles' `LOGFONT` (`[91Ah]`). */
  iconTitleFont: Uint8Array;
  /** Whether Alt+Tab switches at once (`[1AEh]`). */
  fastTaskSwitch: number;
  /** The wallpaper as last loaded: null for "(None)" (`desk.ts`; `desktop.ts` paints it). */
  wallpaper: Wallpaper | null;
  /** The desktop's pattern's eight rows as last made: null for "(None)" (`desk.ts`). */
  pattern: number[] | null;
}

/** A metric as the display recorded it. */
function recorded(system: any, index: number): number {
  return system.display?.metricsByIndex?.[index] ?? 0;
}

/**
 * One of `[Windows]`'s settings as USER's helper reads it (seg3 `0286`):
 * the default where the entry gives no character, else `GetProfileInt`'s
 * number.
 */
function setting(profile: any, key: string, fallback: number): number {
  const value = profile.get(WINDOWS, key, true);

  if (value === null || value === '') {
    return fallback;
  }

  return toInteger(profile.get(WINDOWS, key, false), fallback);
}

/** Whether a `[Windows]` entry starts with a Y, in either case (seg3 `11ea`, `1238`). */
function firstIsY(profile: any, key: string, fallback: string): boolean {
  const value = profile.get(WINDOWS, key, true) ?? fallback;

  return value[0] === 'Y' || value[0] === 'y';
}

/** USER's own `MulDiv` (seg1 `39ab`): half the divisor added, divided toward nought. */
export function mulDiv(value: number, by: number, over: number): number {
  if (!over) {
    return value;
  }

  return Math.trunc((value * by + (over >> 1)) / over);
}

/**
 * The icons' titles' `LOGFONT` as `[Desktop]` gives it (seg3 `1c81`): all
 * noughts, then `IconTitleFaceName` (MS Sans Serif), `IconTitleSize` in
 * points (8) on the display's dots to the inch, made negative, and a weight
 * of 700 where `IconTitleStyle`'s low bit is set, else 400.
 */
export function iconTitleFontOfProfile(system: any, profile: any): Uint8Array {
  const font = new Uint8Array(50);
  const face = profile.get(DESKTOP, 'IconTitleFaceName', true) ?? 'MS Sans Serif';
  const size = (toInteger(profile.get(DESKTOP, 'IconTitleSize', false), 8) << 16) >> 16;
  const style = toInteger(profile.get(DESKTOP, 'IconTitleStyle', false), 0);
  const height = -mulDiv(size, system.display?.logicalPixelsY ?? 96, 72) & 0xffff;
  const weight = style & 1 ? 700 : 400;

  font[0] = height & 0xff;
  font[1] = height >> 8;
  font[8] = weight & 0xff;
  font[9] = weight >> 8;

  for (let at = 0; at < Math.min(face.length, 31); at++) {
    font[18 + at] = face.charCodeAt(at) & 0xff;
  }

  return font;
}

/**
 * The settings, read from `WIN.INI` the first time, as USER reads them as
 * it starts; and the double-click time and the mouse's buttons with them,
 * where nothing set them yet.
 */
export async function loadParameters(system: any): Promise<Parameters> {
  if (system._parameters) {
    return system._parameters;
  }

  const profile = await readProfile(system, 'WIN.INI');

  /* seg3 `1190`: `SetDoubleClickTime`, which takes nought for 500. */
  system._doubleClickTime ??= setting(profile, 'DoubleClickSpeed', 0) || 500;

  /* seg3 `1182`: `SetCaretBlinkTime` with `CursorBlinkRate`, 500 for none
   * (`spiboot`). */
  system._caretBlink ??= setting(profile, 'CursorBlinkRate', 500);

  /* seg3 `11ea`: a first character of Y, in either case, swaps them. */
  system._swapButtons ??= firstIsY(profile, 'SwapMouseButtons', '') ? 1 : 0;

  /* seg3 `0356`: no speed, 15 and no delay; else the delay's two bits above
   * the speed, where there is one. */
  const speed = setting(profile, 'KeyboardSpeed', 0xffff);
  let keyboard = 0x000f;

  if (speed !== 0xffff) {
    const delay = setting(profile, 'KeyboardDelay', 0xffff);

    keyboard = delay === 0xffff ? speed : speed | ((delay & 3) << 5);
  }

  /* seg3 `03f9`: the first threshold the mouse driver's own, 2 as recorded;
   * the second read only for a speed of 2, nought else. */
  const threshold = setting(profile, 'MouseThreshold1', 2);
  const mouseSpeed = setting(profile, 'MouseSpeed', 1);
  const second = mouseSpeed === 2 ? setting(profile, 'MouseThreshold2', 10) : 0;

  /* seg3 `20fc`: a delay not active is kept negative. */
  let screenSave = (setting(profile, 'ScreenSaveTimeOut', 0) << 16) >> 16;

  if (setting(profile, 'ScreenSaveActive', 0) === 0 && screenSave > 0) {
    screenSave = -screenSave;
  }

  /* seg3 `12a2`: `GetProfileInt` itself, eight pixels to a unit. */
  const grid = ((toInteger(profile.get(DESKTOP, 'GridGranularity', false), 0) << 3) << 16) >> 16;
  const spacing = (key: string, index: number, least: number) =>
    Math.max(
      toInteger(profile.get(DESKTOP, key, false), recorded(system, index)),
      recorded(system, least)
    );
  const border = (setting(profile, 'BorderWidth', 3) << 16) >> 16;

  system._parameters = {
    beep: firstIsY(profile, 'Beep', 'Y') ? 1 : 0,
    mouse: [threshold, second, mouseSpeed],
    border: Math.min(Math.max(border, 1), 50),
    keyboard,
    screenSave,
    grid: grid || 1,
    iconSpacing: [
      spacing('IconSpacing', SM_CXICONSPACING, SM_CXICON),
      spacing('IconVerticalSpacing', SM_CYICONSPACING, SM_CYICON),
    ],
    iconTitleWrap: toInteger(profile.get(DESKTOP, 'IconTitleWrap', false), 1),
    menuDropAlignment: setting(profile, 'MenuDropAlignment', 0),
    doubleClickSize: [
      setting(profile, 'DoubleClickWidth', 4),
      setting(profile, 'DoubleClickHeight', 4),
    ],
    iconTitleFont: iconTitleFontOfProfile(system, profile),
    fastTaskSwitch: setting(profile, 'CoolSwitch', 1),
    wallpaper: null,
    pattern: null,
  } satisfies Parameters;

  /* seg3 `1aa7`, `1ab0`: the pattern and the wallpaper, each as the action
   * makes it from `WIN.INI` alone. */
  await setPattern(system, system._parameters, true, null);
  await setWallpaper(system, system._parameters, null);

  return system._parameters;
}

/**
 * A metric that follows the settings, once they are read: the border's
 * (seg3 `24bc`, `253b`), the clicks', the icons' spacing and the menus'
 * alignment, which USER keeps among its metrics. Undefined for another, or
 * before the settings are read.
 */
export function parameterMetric(system: any, index: number): number | undefined {
  const parameters: Parameters | undefined = system._parameters;

  if (!parameters) {
    return undefined;
  }

  const border = parameters.border - RECORDED_BORDER;
  const signed = (value: number) => (value << 16) >> 16;

  switch (index) {
    case SM_CXFRAME:
      return recorded(system, SM_CXBORDER) * (parameters.border + 1);
    case SM_CYFRAME:
      return recorded(system, SM_CYBORDER) * (parameters.border + 1);
    case SM_CXMIN:
    case SM_CXMINTRACK:
      return recorded(system, index) + 2 * border * recorded(system, SM_CXBORDER);
    case SM_CYMIN:
    case SM_CYMINTRACK:
      return recorded(system, index) + 2 * border * recorded(system, SM_CYBORDER);
    case SM_CXDOUBLECLK:
      return signed(parameters.doubleClickSize[0]);
    case SM_CYDOUBLECLK:
      return signed(parameters.doubleClickSize[1]);
    case SM_CXICONSPACING:
      return signed(parameters.iconSpacing[0]);
    case SM_CYICONSPACING:
      return signed(parameters.iconSpacing[1]);
    case SM_MENUDROPALIGNMENT:
      return signed(parameters.menuDropAlignment);
  }

  return undefined;
}
