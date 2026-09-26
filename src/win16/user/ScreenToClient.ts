'use strict';

/**
 * The **ScreenToClient** function converts a point on the screen to a point
 * in a window's client area, in place: {@link ClientToScreen} undone.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.POINT} lppt - The point, changed.
 */
export function ScreenToClient(hwnd, lppt) {
  const window = this.handles.resolve(hwnd);

  if (!window) {
    return;
  }

  const origin = window.clientOrigin ?? { x: window.x, y: window.y };

  lppt.x -= origin.x;
  lppt.y -= origin.y;
}
