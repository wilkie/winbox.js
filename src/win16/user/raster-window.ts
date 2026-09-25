'use strict';

import { type Desktop, type DesktopWindow } from './desktop.js';

/**
 * A window on the raster desktop, as the rest of USER reaches a window: the
 * same properties and methods the page's own window components answer to --
 * where it is, its client size, its surface, showing and hiding it -- so the
 * functions that take an `HWND` need not know which kind they were given.
 *
 * What a window is lives in `DesktopWindow`; this only carries it.
 */
export class RasterWindow {
  readonly desktop: Desktop;
  readonly window: DesktopWindow;

  /** What CreateWindow was asked for, as the page's windows keep it. */
  options: any;

  /** What the window manager and the functions keep about the window. */
  data: any = {};

  _createStruct: any;

  constructor(desktop: Desktop, window: DesktopWindow, options: any) {
    this.desktop = desktop;
    this.window = window;
    this.options = options;
  }

  get x() {
    return this.window.left;
  }

  set x(value: number) {
    this.move(value, this.window.top);
  }

  get y() {
    return this.window.top;
  }

  set y(value: number) {
    this.move(this.window.left, value);
  }

  get width() {
    return this.window.width;
  }

  set width(value: number) {
    this.resize(value, this.window.height);
  }

  get height() {
    return this.window.height;
  }

  set height(value: number) {
    this.resize(this.window.width, value);
  }

  get innerWidth() {
    return this.window.clientWidth;
  }

  get innerHeight() {
    return this.window.clientHeight;
  }

  /** Where the client area starts on the screen. */
  get clientOrigin() {
    return {
      x: this.window.left + this.window.client.left,
      y: this.window.top + this.window.client.top,
    };
  }

  get visible() {
    return this.window.visible;
  }

  get surface() {
    return this.window.surface;
  }

  get caption() {
    return this.window.title;
  }

  set caption(value: string) {
    this.window.title = value;

    if (this.window.visible) {
      this.desktop.paintFrame(this.window);
    }
  }

  show() {
    this.desktop.show(this.window);
  }

  hide() {
    this.desktop.hide(this.window);
  }

  destroy() {
    this.desktop.destroy(this.window);
  }

  move(x: number, y: number) {
    this.desktop.place(this.window, x, y, this.window.width, this.window.height);
  }

  resize(width: number, height: number) {
    this.desktop.place(this.window, this.window.left, this.window.top, width, height);
  }

  /** Where CreateWindow puts a window it was given no place for. Not measured: the screen's middle. */
  center() {
    this.move(
      Math.floor((this.desktop.screen.width - this.window.width) / 2),
      Math.floor((this.desktop.screen.height - this.window.height) / 2)
    );
  }

  /* Nothing here yet: sizing states, and events from the page, come with input. */
  /** Whether keys go to this window. */
  get focused() {
    return this.desktop.focus === this.window;
  }

  /** Gives this window the keys. */
  focus() {
    this.desktop.focus = this.window;
  }

  restore() {}
  maximize() {}
  minimize() {}
  on() {}
  append() {}
}
