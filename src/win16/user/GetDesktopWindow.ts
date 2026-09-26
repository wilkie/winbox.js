'use strict';

/**
 * The desktop window's handle. See `desktop-handle.ts`.
 *
 * @returns {Types.HWND} The desktop window.
 */
export function GetDesktopWindow() {
  return this.desktopWindow ?? 0;
}
