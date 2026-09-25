'use strict';

/**
 * The **ClientToScreen** function converts a point in a window's client area
 * to a point on the screen, in place.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.POINT} lppt - The point, changed.
 */
export function ClientToScreen(hwnd, lppt) {
  const window = this.handles.resolve(hwnd);

  if (!window) {
    return;
  }

  const origin = window.clientOrigin ?? { x: window.x, y: window.y };

  lppt.x += origin.x;
  lppt.y += origin.y;
}
