'use strict';

/**
 * One of the system colours, as a `COLORREF`: the display's default for the
 * `COLOR_` index, recorded by the `chrome` probe on each display. See
 * `sysColors` in `display-modes.ts`. A `[colors]` section in `WIN.INI`, which
 * would override them, is not read yet.
 *
 * @param {Types.INT} nIndex - The `COLOR_` index.
 *
 * @returns {Types.COLORREF} The colour, or black for an index with none.
 */
export function GetSysColor(nIndex) {
  return this._sysColors?.[nIndex] ?? this.display?.sysColors?.[nIndex] ?? 0;
}

/**
 * Changes system colours: `cDspElements` of them, their indices and their new
 * colours in two arrays in the program's memory. Every window is drawn again
 * in them, and each top-level window is told with `WM_SYSCOLORCHANGE`. The
 * colours are this system's own; the display's defaults are left as they are.
 */
export async function SetSysColors(cDspElements, lpnDspElements, lpdwRgbValues) {
  const core = this.machine.cpu.core;
  const read16 = (far, at) => core.read16((far >>> 16) & 0xffff, (far & 0xffff) + at);

  this._sysColors ??= [...(this.display?.sysColors ?? [])];

  for (let at = 0; at < cDspElements; at++) {
    const index = read16(lpnDspElements, at * 2);
    const colour =
      (read16(lpdwRgbValues, at * 4) | (read16(lpdwRgbValues, at * 4 + 2) << 16)) >>> 0;

    this._sysColors[index] = colour & 0xffffff;
  }

  const desktop = this.rasterDesktop;

  if (desktop) {
    desktop.repaintAll();

    for (const window of desktop.windows) {
      const owner = !window.parent && window.hwnd ? this.handles.resolve(window.hwnd) : null;
      const windowClass = owner && this.handles.retrieve(owner.options.windowClass);

      if (windowClass) {
        await this.scheduler.callWndProc(windowClass, window.hwnd, WM_SYSCOLORCHANGE, 0, 0);
      }
    }
  }

  return 1;
}

const WM_SYSCOLORCHANGE = 0x0015;
