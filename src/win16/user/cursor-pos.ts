'use strict';

/**
 * Where the cursor is on the screen. Moving it moves nothing on the page's
 * own pointer; it is where the next message not the mouse's own is said to
 * have come from, and where a scroll bar held down is looked at again.
 */
export function SetCursorPos(this: any, x: number, y: number) {
  const cursor = heldIn(this, { x: (x << 16) >> 16, y: (y << 16) >> 16 });

  /* And a mouse move where it now is (`mousemv`). */
  if (this.rasterInput) {
    this.rasterInput.cursor = cursor;
    this.rasterInput.nudge();
  } else {
    this._cursorPos = cursor;
  }
}

/**
 * Where the cursor may be: the rectangle `ClipCursor` gave, as it gave it,
 * or the screen. The rectangle takes the screen's place, a part off the
 * screen included: clipped to (-50, -50)-(700, 500), the cursor goes to
 * (-10, -10) and (699, 499) (`cursclip`).
 */
export function cursorBounds(system: any) {
  const screen = system.rasterDesktop?.screen;

  return (
    system._cursorClip ?? {
      left: 0,
      top: 0,
      right: screen?.width ?? 640,
      bottom: screen?.height ?? 480,
    }
  );
}

/**
 * A place for the cursor held inside its bounds, their right and bottom
 * outside, the left and top taken first: a rectangle whose right comes
 * before its left holds it at its right less one (`cursclip`).
 */
export function heldIn(system: any, point: { x: number; y: number }) {
  const { left, top, right, bottom } = cursorBounds(system);

  return {
    x: Math.min(Math.max(point.x, left), right - 1),
    y: Math.min(Math.max(point.y, top), bottom - 1),
  };
}

/** Where the cursor is: the page's pointer's place, or where it was last set. */
export function cursorOf(system: any) {
  return system.rasterInput?.cursor ?? system._cursorPos ?? { x: 0, y: 0 };
}

/** The cursor's place on the screen, into a point the program gives. */
export function GetCursorPos(this: any, lppt: any) {
  const cursor = cursorOf(this);

  lppt.x = cursor.x;
  lppt.y = cursor.y;
}
