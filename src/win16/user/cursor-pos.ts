'use strict';

/**
 * Where the cursor is on the screen. Moving it moves nothing on the page's
 * own pointer; it is where the next message not the mouse's own is said to
 * have come from, and where a scroll bar held down is looked at again.
 */
export function SetCursorPos(this: any, x: number, y: number) {
  const cursor = { x: (x << 16) >> 16, y: (y << 16) >> 16 };

  /* And a mouse move where it now is (`mousemv`). */
  if (this.rasterInput) {
    this.rasterInput.cursor = cursor;
    this.rasterInput.nudge();
  } else {
    this._cursor = cursor;
  }
}

/** Where the cursor is: the page's pointer's place, or where it was last set. */
export function cursorOf(system: any) {
  return system.rasterInput?.cursor ?? system._cursor ?? { x: 0, y: 0 };
}

/** The cursor's place on the screen, into a point the program gives. */
export function GetCursorPos(this: any, lppt: any) {
  const cursor = cursorOf(this);

  lppt.x = cursor.x;
  lppt.y = cursor.y;
}
