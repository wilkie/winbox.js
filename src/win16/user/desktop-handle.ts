'use strict';

/**
 * The desktop window, as `GetDesktopWindow` names it: the whole screen, at
 * its corner, always showing. It has no class and no procedure; what a
 * program asks of it is its place and size.
 *
 * Not recorded: its handle's value, and what the calls that take a window
 * answer for it beyond its rectangles.
 */
export class DesktopHandle {
  readonly system: any;

  /** What the window manager keeps about a window. */
  data: any = {};

  /** What `CreateWindow` keeps about a window: nothing, here. */
  options: any = {};

  constructor(system: any) {
    this.system = system;
  }

  readonly x = 0;
  readonly y = 0;

  get width() {
    return this.system.display.width;
  }

  get height() {
    return this.system.display.height;
  }

  get innerWidth() {
    return this.width;
  }

  get innerHeight() {
    return this.height;
  }

  get clientOrigin() {
    return { x: 0, y: 0 };
  }

  get visible() {
    return true;
  }

  get surface() {
    return this.system.screen;
  }
}
