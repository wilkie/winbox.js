'use strict';

/**
 * A client rectangle grown to the window that would have it, for a style: the
 * frame as the desktop draws it (`Desktop.frameInsets`), with a menu bar when
 * `fMenu` says so. Scroll bars are not counted, as Windows does not count
 * them. With `WS_EX_DLGMODALFRAME`, a dialog's frame.
 */
export function AdjustWindowRectEx(this: any, lprc: any, dwStyle: number, fMenu: number, dwExStyle: number) {
  const desktop = this.rasterDesktop;

  if (!desktop || !lprc) {
    return;
  }

  const style = (dwStyle & ~0x00300000) >>> 0;
  const insets = desktop.frameInsets(style, (dwExStyle & 0x0001) !== 0, !!fMenu);

  lprc.left -= insets.left;
  lprc.top -= insets.top;
  lprc.right += insets.right;
  lprc.bottom += insets.bottom;
}

export function AdjustWindowRect(this: any, lprc: any, dwStyle: number, fMenu: number) {
  AdjustWindowRectEx.call(this, lprc, dwStyle, fMenu, 0);
}
