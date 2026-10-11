'use strict';

/**
 * The desktop window, as `GetDesktopWindow` names it: the whole screen, at
 * its corner, always showing. What a program asks of it is its place and
 * size. It belongs to the first program, which takes the desktop's queue as
 * its own in its `InitApp` (`USER.EXE` seg5 `03ae`-`03d8`): its
 * `data.hInstance` is that program's, once it has called it (`tasklist`).
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

  /**
   * Its procedure, USER's own (`task-list.ts`), set as the system is made.
   * Its class's style is `CS_DBLCLKS` (`tasklist`): a double click on it is
   * one.
   */
  wndProc: any = null;

  readonly classStyle = 0x0008;

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
