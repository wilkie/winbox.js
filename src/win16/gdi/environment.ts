'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalSize } from '../kernel/GlobalSize.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { nullPort, portKey, readFar } from './printer-driver.js';

/**
 * A printer's environment: the DEVMODE GDI keeps for a port, which a
 * driver's `Enable` and `ExtDeviceMode` keep there and read back. The twin
 * of `crates/winbox-win16/src/gdi/environment.rs`.
 *
 * **Read out** of `GDI.EXE` (seg7 `0571`, `05ed`; seg4 `0438`): GDI keeps
 * twenty slots, each the atom of a port's name -- a colon at its end left
 * off, compared without case -- and a block of global memory. For the
 * null port, WIN.INI's `NullPort`, the slot is named by the environment's
 * own first field, the device's name, instead.
 */

const SLOTS = 20;

interface Slot {
  name: string;
  handle: number;
}

function slotsOf(system: any): Slot[] {
  return (system._printerEnvironments ??= []);
}

/** The slot's name for a port and an environment, or null where the port is not named. */
async function nameOf(system: any, port: string, lpEnviron: number) {
  if (!port) {
    return null;
  }

  if (portKey(port) === portKey(await nullPort(system))) {
    const device = lpEnviron ? readFar(system, lpEnviron) : '';

    return device ? device.toUpperCase() : null;
  }

  return portKey(port);
}

/**
 * The environment kept for a port, copied into `lpEnviron`, no more than
 * `nMaxCount` bytes: the count copied. With `lpEnviron` nought, the size
 * of the block kept, as `GlobalSize` answers it. Nought where none is
 * kept (seg7 `0571`).
 */
export async function GetEnvironment(
  this: any,
  lpPortName: number,
  lpEnviron: number,
  nMaxCount: number
) {
  const name = await nameOf(this, readFar(this, lpPortName >>> 0), lpEnviron >>> 0);
  const slot = name ? slotsOf(this).find((other) => other.name === name) : null;

  if (!slot) {
    return 0;
  }

  const size = GlobalSize.call(this, slot.handle);

  if (!lpEnviron) {
    return size & 0xffff;
  }

  const count = Math.min(size, nMaxCount & 0xffff);
  const from = GlobalLock.call(this, slot.handle) >>> 0;
  const core = this.machine.cpu.core;

  for (let at = 0; at < count; at++) {
    core.write8(
      lpEnviron >>> 16,
      ((lpEnviron & 0xffff) + at) & 0xffff,
      core.read8(from >>> 16, ((from & 0xffff) + at) & 0xffff)
    );
  }

  GlobalUnlock.call(this, slot.handle);
  return count;
}

/**
 * An environment kept for a port: the one there let go, and with a count
 * of nought nothing kept and -1 answered; else a block of `GlobalAlloc
 * (2002h)` the count's size, copied from `lpEnviron`, put in the first
 * free slot, and its handle answered; nought with no slot free (seg7
 * `05ed`).
 */
export async function SetEnvironment(
  this: any,
  lpPortName: number,
  lpEnviron: number,
  nCount: number
) {
  const slots = slotsOf(this);
  const name = await nameOf(this, readFar(this, lpPortName >>> 0), lpEnviron >>> 0);
  const at = name ? slots.findIndex((other) => other.name === name) : -1;

  if (at >= 0) {
    GlobalFree.call(this, slots[at].handle);
    slots.splice(at, 1);
  }

  const count = nCount & 0xffff;

  if (!count) {
    return -1;
  }

  if (!name) {
    return 0;
  }

  const handle = GlobalAlloc.call(this, 0x2002, count);

  if (!handle) {
    return 0;
  }

  if (slots.length >= SLOTS) {
    GlobalFree.call(this, handle);
    return 0;
  }

  const to = GlobalLock.call(this, handle) >>> 0;
  const core = this.machine.cpu.core;

  for (let step = 0; step < count; step++) {
    core.write8(
      to >>> 16,
      ((to & 0xffff) + step) & 0xffff,
      core.read8(lpEnviron >>> 16, ((lpEnviron & 0xffff) + step) & 0xffff)
    );
  }

  GlobalUnlock.call(this, handle);
  slots.push({ name, handle });
  return handle;
}
