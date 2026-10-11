'use strict';

import { heldIn } from './cursor-pos.js';

/**
 * The mouse driver's way into USER: a move, a press or a release put in as
 * the mouse made it, for USER's own loops to take like any other. Called with
 * registers, not a stack.
 *
 * **Read out** of `USER.EXE` (seg1 `507a`): AX the flags, BX and CX where.
 *
 * * Bit 1 moved; 2 and 4 the left button pressed and released, 8 and 0x10
 *   the right, 0x20 and 0x40 the middle. The buttons go in first, where the
 *   pointer was, and the move after them (`518a`, then `50c5`).
 * * With bit 0x8000, BX and CX are absolute, 0 to 65535 across the screen:
 *   the pointer goes to BX times the screen's width, and CX times its
 *   height, over 65536 (`50d7`).
 *
 * **Recorded** by `iconclk`, which presses on an icon, drags it and clicks
 * twice on it, all through this entry, as a program can.
 *
 * * Without bit 0x8000, BX and CX are how far it moved, in mickeys. Where
 *   the speed (`SPI_SETMOUSE`'s third word) is not nought, a move more than
 *   the first threshold is doubled, and one more than the second doubled
 *   again where the speed is 2 (`5209`), each way on its own, the move's
 *   size as given compared. Across, the mickeys are divided by the
 *   display's ratio (`[4Dh]`), its remainder kept for the next move;
 *   down, they are not (`510b`-`516e`). The pointer is then held in
 *   `ClipCursor`'s rectangle. **Recorded** by `spiidle` on the VGA, whose
 *   ratio is 1; the other displays' are not measured, and 1 here.
 *
 * Which press is a double click is the look's to say, as it takes it
 * (`mouse-scan.ts`, `dblrect`).
 */

const MOVED = 0x0001;
const ABSOLUTE = 0x8000;

/** Each button's bits, pressed and released, and its bit in `buttons`. */
const BUTTONS = [
  { down: 0x02, up: 0x04, button: 0, bit: 1 },
  { down: 0x08, up: 0x10, button: 2, bit: 2 },
  { down: 0x20, up: 0x40, button: 1, bit: 4 },
];

export async function Mouse_Event(this: any) {
  const core = this.machine.cpu.core;
  const flags = core.ax & 0xffff;
  const bx = core.bx & 0xffff;
  const cx = core.cx & 0xffff;
  const input = this.rasterInput;

  if (!input) {
    return;
  }

  for (const { down, up, button, bit } of BUTTONS) {
    if (!(flags & (down | up))) {
      continue;
    }

    const { x, y } = input.cursor;
    const pressed = (flags & down) !== 0;

    input.pointer(pressed ? 'down' : 'up', {
      x,
      y,
      button,
      buttons: pressed ? input.buttons | bit : input.buttons & ~bit,
      double: false,
      shift: false,
      control: false,
    });
  }

  if (flags & MOVED && !(flags & ABSOLUTE)) {
    const [first, second, speed] = this._parameters?.mouse ?? [2, 0, 1];
    const accelerated = (move: number) => {
      const size = Math.abs(move) & 0xffff;
      let out = move;

      if (speed && size > first) {
        out *= 2;

        if (size > second && speed === 2) {
          out *= 2;
        }
      }

      return (out << 16) >> 16;
    };
    const { x, y } = input.cursor;
    const to = heldIn(this, {
      x: x + accelerated((bx << 16) >> 16),
      y: y + accelerated((cx << 16) >> 16),
    });

    /* Where it went nowhere, nothing is put in (`5172`). */
    if (to.x !== x || to.y !== y) {
      input.pointer('move', {
        ...to,
        button: 0,
        buttons: input.buttons,
        double: false,
        shift: false,
        control: false,
      });
    }
  }

  if (flags & MOVED && flags & ABSOLUTE) {
    const { width, height } = input.desktop.screen;

    input.pointer('move', {
      x: Math.floor((bx * width) / 65536),
      y: Math.floor((cx * height) / 65536),
      button: 0,
      buttons: input.buttons,
      double: false,
      shift: false,
      control: false,
    });
  }
}
