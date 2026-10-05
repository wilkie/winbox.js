'use strict';

import { User } from '../user.js';

/**
 * The keyboard driver's way into USER: a key pressed or released, put in as
 * the keyboard made it, for USER's own loops and the program with the focus
 * to take like any other. Called with registers, not a stack.
 *
 * **Read out** of `USER.EXE` (seg1 `4b59`): AL the virtual key, AH 80h for
 * a release and nought for a press (`4b6c`-`4b8b`), BL the scan code. What
 * makes it a system key is `RasterInput.virtualKey`'s.
 *
 * **Recorded** by `altchild`, which puts all its keys in through this
 * entry, as a program can.
 *
 * Not modelled: the scan code, which goes into bits 16 to 23 of `lParam`
 * on Windows and is nought here, as it is for the page's keys; and the
 * character a key types is the US keyboard's, unshifted unless Shift is
 * down, for the letters, the digits, Space and the keys that type a
 * control character.
 */
export async function Keybd_Event(this: any) {
  const core = this.machine.cpu.core;
  const ax = core.ax & 0xffff;
  const input = this.rasterInput;

  if (!input) {
    return;
  }

  const virtual = ax & 0xff;
  const kind = ax & 0xff00 ? 'up' : 'down';
  const down = (vk: number) => ((this._asyncKeys?.[vk] ?? 0) & 0x80) !== 0;
  const shift = down(User.VK_SHIFT);
  let typed: number | undefined;

  if (virtual >= 0x41 && virtual <= 0x5a) {
    typed = shift ? virtual : virtual + 0x20;
  } else if ((virtual >= 0x30 && virtual <= 0x39) || virtual === 0x20) {
    typed = virtual;
  } else if ([0x08, 0x09, 0x0d, 0x1b].includes(virtual)) {
    typed = virtual;
  }

  /* Alt down with it, as the key leaves it: Alt's own release is without. */
  const alt = virtual === User.VK_MENU ? kind === 'down' : down(User.VK_MENU);

  /* A press of a key already down is a repeat, bit 30. */
  input.virtualKey(kind, virtual, { alt, repeat: kind === 'down' && down(virtual), typed });
}
