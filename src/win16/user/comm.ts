'use strict';

import {
  DCB_SIZE,
  BAD_ID,
  enableNotification,
  escape,
  flush,
  initialise,
  readString,
  setBreak,
  setEventMask,
  setQueues,
  setState,
  stateOf,
  status,
  takeEvents,
  terminate,
  transmitCharacter,
  writeString,
} from '../comm.js';
import { GetCurrentTask } from '../kernel/tasks.js';
import { IsWindow } from './window-queries.js';

/**
 * USER's comm functions, which keep a table of the ports open and pass the
 * rest to COMM. **Read out** of `USER.EXE` (seg40) and **recorded** by
 * `comms`.
 *
 * * USER keeps 13 ports: COM1 to COM10, ids 0 to 9, and LPT1 to LPT3, ids
 *   80h to 82h. For each, whether it is open, a character put back, and the
 *   task that opened it. `ReadComm`, `UngetCommChar`, `WriteComm` and
 *   `CloseComm` check an id is one of these; the state calls look it up
 *   whatever it is; the rest pass it to COMM, open or not.
 * * An id whose high byte is not nought is refused before anything:
 *   `GetCommError`, `GetCommEventMask` and `EnableCommNotification` answer
 *   nought, `SetCommEventMask` a null pointer, the rest -1.
 *
 * Not followed: closing a task's serial ports when it ends, which USER does
 * -- its parallel ports it never closes; and queues in memory below 1 MB,
 * where USER puts them in standard mode for the driver's interrupts.
 */

const COM_DEFAULT = 'COM1:9600,E,7,1';

interface Slot {
  open: boolean;
  /** A character put back, if `ungot`. */
  ungot: boolean;
  character: number;
  owner: number;
}

function slotsOf(system: any): Slot[] {
  return (system._commSlots ??= Array.from({ length: 13 }, () => ({
    open: false,
    ungot: false,
    character: 0,
    owner: 0,
  })));
}

/** An id's place in USER's table, or none past it (seg40 `082b`). */
function slotOf(system: any, id: number): Slot | null {
  const index = id & 0x80 ? 10 + (id & 0x7f) : id;

  return slotsOf(system)[index] ?? null;
}

/** Whether an id is one USER's table has, as the calls that check it do. */
function inRange(id: number) {
  return (id & 0x7f) <= (id & 0x80 ? 2 : 9);
}

/** A character upper-cased as USER does, anything 61h to 7Fh (seg40 `09c8`). */
function fold(code: number) {
  return code >= 0x61 && code <= 0x7f ? code - 0x20 : code;
}

/**
 * A port's name as its id: COMn is n - 1, LPTn 80h + n - 1, AUX COM1 and PRN
 * LPT1, each with a colon after it or not, and nothing more; -1 for any
 * other (seg40 `073c`). The digit is not checked: `COM:` is COM10.
 */
export function portNamed(name: string) {
  const codes = Array.from(name, (c) => fold(c.charCodeAt(0) & 0xff));
  const patterns: Record<number, [string, number, boolean]> = {
    0x43: ['COM', 0, true],
    0x4c: ['LPT', 0x80, true],
    0x41: ['AUX', 0, false],
    0x50: ['PRN', 0x80, false],
  };
  const pattern = patterns[codes[0]];

  if (!pattern) {
    return -1;
  }

  const [text, base, required] = pattern;

  for (let i = 1; i < 3; i++) {
    if (codes[i] !== text.charCodeAt(i)) {
      return -1;
    }
  }

  let at = 3;
  let index: number;

  if (!required && (codes[at] === undefined || codes[at] === 0x3a)) {
    index = 0;
  } else {
    index = (codes[at] ?? 0) - 0x31;
    at++;
  }

  if (codes[at] === 0x3a) {
    at++;
  }

  if (codes[at] !== undefined || index < 0 || index > (base ? 2 : 9)) {
    return -1;
  }

  return base + index;
}

/** The baud rates `BuildCommDCB` knows, by their first two digits (seg40 `048f`). */
const BAUDS: Record<string, number> = {
  '11': 110,
  '12': 1200,
  '15': 150,
  '19': 19200,
  '24': 2400,
  '30': 300,
  '48': 4800,
  '60': 600,
  '96': 9600,
};

/**
 * `BuildCommDCB`'s reading of a string: nought and the DCB, or -1 and the
 * DCB as far as it got (seg40 `048f`, `06b8`).
 *
 * The fields are split at a space, a colon or a comma, spaces after it
 * skipped. A field is used only if there is more after it, but for the
 * baud rate's: so a field with a separator and nothing after it is dropped,
 * and the baud rate, when it is missing, is read from the name.
 */
export function buildDcb(text: string): { answer: number; dcb: Uint8Array } {
  const dcb = new Uint8Array(DCB_SIZE);
  const view = new DataView(dcb.buffer);
  let at = 0;
  let token = '';

  /* The next field into `token`; false when there was nothing more. */
  const fetch = () => {
    if (at >= text.length) {
      return false;
    }

    token = '';

    while (at < text.length && !' :,'.includes(text[at])) {
      token += String.fromCharCode(fold(text.charCodeAt(at) & 0xff));
      at++;
    }

    if (at >= text.length) {
      return true;
    }

    at++;

    while (text[at] === ' ') {
      at++;
    }

    return at < text.length;
  };

  fetch();

  const id = portNamed(token);

  if (id < 0) {
    return { answer: -1, dcb };
  }

  dcb[0] = id;

  if (id & 0x80) {
    return { answer: 0, dcb };
  }

  const more = fetch();
  const baud = token.length >= 2 ? BAUDS[token.slice(0, 2)] : undefined;

  if (!baud) {
    return { answer: -1, dcb };
  }

  view.setUint16(1, baud, true);
  view.setUint16(16, 10, true);
  view.setUint16(18, 10, true);
  dcb[12] = 0x01;
  dcb[14] = 0x11;
  dcb[15] = 0x13;

  if (!more || !fetch()) {
    return { answer: 0, dcb };
  }

  const parity = { '': 2, E: 2, M: 3, N: 0, O: 1, S: 4 }[token[0] ?? ''];

  if (parity === undefined) {
    return { answer: -1, dcb };
  }

  dcb[4] = parity;

  if (!fetch()) {
    return { answer: 0, dcb };
  }

  const size = { '': 7, '7': 7, '8': 8 }[token[0] ?? ''];

  if (size === undefined) {
    return { answer: -1, dcb };
  }

  dcb[3] = size;

  if (!fetch()) {
    return { answer: 0, dcb };
  }

  const stop = { '': baud === 110 ? 2 : 0, '1': 0, '2': 2 }[token[0] ?? ''];

  if (stop === undefined) {
    return { answer: -1, dcb };
  }

  dcb[5] = stop;

  if (!fetch()) {
    return { answer: 0, dcb };
  }

  if (token[0] !== 'P') {
    return { answer: -1, dcb };
  }

  view.setUint16(6, 0xffff, true);
  view.setUint16(8, 0xffff, true);
  view.setUint16(10, 0xffff, true);

  return { answer: 0, dcb };
}

function core(system: any) {
  return system.machine.cpu.core;
}

function readBytes(system: any, far: number, count: number) {
  const bytes = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    bytes[i] = core(system).read8(far >>> 16, ((far & 0xffff) + i) & 0xffff);
  }

  return bytes;
}

function writeBytes(system: any, far: number, bytes: Uint8Array) {
  bytes.forEach((byte, i) => core(system).write8(far >>> 16, ((far & 0xffff) + i) & 0xffff, byte));
}

const refused = (nCid: number) => (nCid & 0xff00) !== 0;

/**
 * Opens a port by name, with queues of the sizes given; its id, or an
 * error. **Read out** (seg40 `0000`): a serial port opens as `COM1:9600,E,7,1`
 * would make it, since a name it takes is never one `BuildCommDCB` can
 * read -- not as `WIN.INI`'s `[ports]` says. Both queues nought is -4.
 *
 * @param {Types.LPCSTR} lpszDevControl - The port's name.
 * @param {Types.UINT} cbInQueue - The receive queue's size.
 * @param {Types.UINT} cbOutQueue - The transmit queue's size.
 *
 * @returns {Types.INT} The id, or -1 for no such port, -2 for one open, -4
 *                      for no queues, -10 for one the machine does not have.
 */
export async function OpenComm(
  this: any,
  lpszDevControl: string,
  cbInQueue: number,
  cbOutQueue: number
) {
  const name = lpszDevControl ?? '';
  const id = portNamed(name);

  if (id < 0) {
    return -1;
  }

  const slot = slotOf(this, id)!;

  if (slot.open) {
    return -2;
  }

  let dcb: Uint8Array = new Uint8Array(DCB_SIZE);

  if (!(id & 0x80)) {
    if (!cbInQueue && !cbOutQueue) {
      return -4;
    }

    const built = name.length >= 4 ? buildDcb(name) : { answer: -1, dcb };

    dcb = built.answer ? buildDcb(COM_DEFAULT).dcb : built.dcb;
    setQueues(this, id, cbInQueue, cbOutQueue);
  }

  dcb[0] = id;

  const answer = await initialise(this, dcb);

  if (answer) {
    return answer;
  }

  slot.open = true;
  slot.owner = GetCurrentTask.call(this);

  return id;
}

/**
 * Closes a port, once what is queued has gone. **Read out** (seg40 `03a5`):
 * a character put back is kept, for the port's next open.
 *
 * @param {Types.INT} nCid - The port's id.
 *
 * @returns {Types.INT} Nought; -2 when what was queued could not go, the
 *                      port closed nonetheless; -1 for a port not open.
 */
export async function CloseComm(this: any, nCid: number) {
  if (refused(nCid) || !inRange(nCid)) {
    return -1;
  }

  const slot = slotOf(this, nCid)!;

  if (!slot.open) {
    return -1;
  }

  const answer = await terminate(this, nCid);

  if (answer === BAD_ID) {
    return -1;
  }

  slot.open = false;
  setQueues(this, nCid, 0, 0);

  return answer;
}

/**
 * Makes a string of a port's settings a DCB. **Read out** (seg40 `048f`):
 * the baud rate by its first two digits; parity E, M, N, O or S; seven or
 * eight bits; one stop bit or two; and a last field that must be `P`, for
 * timeouts of FFFFh -- so `WIN.INI`'s `x` is refused.
 *
 * @param {Types.LPCSTR} lpszDef - The settings, as `COM1:9600,n,8,1`.
 * @param {Types.FARPTR} lpdcb - The DCB to fill.
 *
 * @returns {Types.INT} Nought, or -1.
 */
export function BuildCommDCB(this: any, lpszDef: string, lpdcb: number) {
  const { answer, dcb } = buildDcb(lpszDef ?? '');

  writeBytes(this, lpdcb, dcb);

  return answer;
}

/**
 * A port's new settings, the DCB's Id naming it. **Read out** (COMM seg2
 * `07e9`): checked as baud rate, parity, byte size and stop bits, in that
 * order, and nothing is changed if one is wrong.
 *
 * @param {Types.FARPTR} lpdcb - The DCB.
 *
 * @returns {Types.INT} Nought; -3 for a port not open; -12 for the baud
 *                      rate, -11 the byte size, -5 the parity or stop bits.
 */
export function SetCommState(this: any, lpdcb: number) {
  const dcb = readBytes(this, lpdcb, DCB_SIZE);
  const slot = slotOf(this, dcb[0]);

  if (!slot?.open) {
    return -3;
  }

  return setState(this, dcb);
}

/**
 * A copy of a port's settings.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.FARPTR} lpdcb - Where to copy them.
 *
 * @returns {Types.INT} Nought, or -3 for a port not open.
 */
export function GetCommState(this: any, nCid: number, lpdcb: number) {
  if (refused(nCid)) {
    return -1;
  }

  if (!slotOf(this, nCid)?.open) {
    return -3;
  }

  const dcb = stateOf(this, nCid);

  if (!dcb) {
    return -1;
  }

  writeBytes(this, lpdcb, dcb);

  return 0;
}

/**
 * What has been received. **Read out** (seg40 `01d7`): a character put back
 * comes first, and is not counted; and nothing is read while an error is
 * waiting for `GetCommError`.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.FARPTR} lpvBuf - Where to put it.
 * @param {Types.INT} cbRead - How much there is room for.
 *
 * @returns {Types.INT} How many were read.
 */
export function ReadComm(this: any, nCid: number, lpvBuf: number, cbRead: number) {
  if (refused(nCid)) {
    return -1;
  }

  if (!cbRead || !inRange(nCid)) {
    return 0;
  }

  const slot = slotOf(this, nCid)!;

  if (!slot.open) {
    return 0;
  }

  let far = lpvBuf >>> 0;

  if (slot.ungot) {
    slot.ungot = false;
    writeBytes(this, far, Uint8Array.of(slot.character));
    far = ((far & 0xffff0000) | ((far + 1) & 0xffff)) >>> 0;
  }

  const bytes = readString(this, nCid, cbRead);

  writeBytes(this, far, bytes);

  return bytes.length;
}

/**
 * A character put back, for the next read.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.CHAR} chUnget - The character.
 *
 * @returns {Types.INT} Nought, or -1 when one is already back or the port is not open.
 */
export function UngetCommChar(this: any, nCid: number, chUnget: number) {
  if (refused(nCid)) {
    return -1;
  }

  if (!inRange(nCid)) {
    return 0;
  }

  const slot = slotOf(this, nCid)!;

  if (slot.ungot || !slot.open) {
    return -1;
  }

  slot.ungot = true;
  slot.character = chUnget & 0xff;

  return 0;
}

/**
 * Queues bytes to send. **Recorded**: as many as there is room for, and
 * minus that when not all of them.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.FARPTR} lpvBuf - The bytes.
 * @param {Types.INT} cbWrite - How many.
 *
 * @returns {Types.INT} How many were queued, negative if not all; -1 for a port not open.
 */
export function WriteComm(this: any, nCid: number, lpvBuf: number, cbWrite: number) {
  if (refused(nCid)) {
    return -1;
  }

  if (!inRange(nCid)) {
    return 0;
  }

  if (!slotOf(this, nCid)!.open) {
    return -1;
  }

  const size = cbWrite & 0xffff;
  const n = writeString(this, nCid, readBytes(this, lpvBuf >>> 0, size));

  return n < size ? -n : n;
}

/**
 * The port's errors since last asked, cleared, and its state.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.FARPTR} lpStat - A COMSTAT to fill, or null.
 *
 * @returns {Types.INT} The errors.
 */
export function GetCommError(this: any, nCid: number, lpStat: number) {
  if (refused(nCid)) {
    return 0;
  }

  const { answer, stat } = status(this, nCid);

  if (answer === BAD_ID || !stat) {
    return answer;
  }

  if (lpStat) {
    if (slotOf(this, nCid)?.ungot) {
      const count = (stat[1] | (stat[2] << 8)) + 1;

      stat[1] = count & 0xff;
      stat[2] = (count >> 8) & 0xff;
    }

    writeBytes(this, lpStat >>> 0, stat);
  }

  return answer;
}

/**
 * A character to send before what is queued.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.CHAR} chTransmit - The character.
 *
 * @returns {Types.INT} Nought, or 4000h when one is already waiting.
 */
export function TransmitCommChar(this: any, nCid: number, chTransmit: number) {
  if (refused(nCid)) {
    return -1;
  }

  return transmitCharacter(this, nCid, chTransmit);
}

/**
 * The events a port keeps. **Read out** (COMM seg2 `0fbc`): the mask is kept
 * across a close.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.UINT} fuEvtMask - The events.
 *
 * @returns {Types.FARPTR} The port's event word, or null.
 */
export function SetCommEventMask(this: any, nCid: number, fuEvtMask: number) {
  if (refused(nCid)) {
    return 0;
  }

  return setEventMask(this, nCid, fuEvtMask);
}

/**
 * A port's events, those asked for cleared.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.INT} fnEvtClear - The events to clear.
 *
 * @returns {Types.UINT} The events before.
 */
export function GetCommEventMask(this: any, nCid: number, fnEvtClear: number) {
  if (refused(nCid)) {
    return 0;
  }

  return takeEvents(this, nCid, fnEvtClear);
}

/**
 * A break on the line, holding output.
 *
 * @param {Types.INT} nCid - The port's id.
 *
 * @returns {Types.INT} The errors, not cleared.
 */
export function SetCommBreak(this: any, nCid: number) {
  return refused(nCid) ? -1 : setBreak(this, nCid, true);
}

/**
 * The break ended.
 *
 * @param {Types.INT} nCid - The port's id.
 *
 * @returns {Types.INT} The errors, not cleared.
 */
export function ClearCommBreak(this: any, nCid: number) {
  return refused(nCid) ? -1 : setBreak(this, nCid, false);
}

/**
 * Empties a queue: 0 the transmit queue, anything else the receive queue.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.INT} fnQueue - Which.
 *
 * @returns {Types.INT} The errors, not cleared.
 */
export function FlushComm(this: any, nCid: number, fnQueue: number) {
  return refused(nCid) ? -1 : flush(this, nCid, fnQueue);
}

/**
 * Something done to a port's lines, or asked of it. **Read out** (COMM seg2
 * `107a`), by the code's low byte: 1 to 6 set XOFF, XON, RTS and DTR or
 * clear them; 7 resets a printer, and on a serial port reads the UART as
 * one; 8 answers 82h and 9 answers 3, on a serial port; 10 and 11 answer
 * its interrupt and address.
 *
 * @param {Types.INT} nCid - The port's id.
 * @param {Types.INT} nFunction - The code.
 *
 * @returns {Types.DWORD} The errors, not cleared, or the answer asked for.
 */
export async function EscapeCommFunction(this: any, nCid: number, nFunction: number) {
  if (refused(nCid)) {
    return 0xffffffff;
  }

  return escape(this, nCid, nFunction);
}

/**
 * Which window hears of a port with `WM_COMMNOTIFY`, and when.
 *
 * @param {Types.INT} idComDev - The port's id.
 * @param {Types.HWND} hwnd - The window, or none.
 * @param {Types.INT} cbWriteNotify - Received bytes to be told at.
 * @param {Types.INT} cbOutQueue - Queued bytes to be told under.
 *
 * @returns {Types.BOOL} 1, or nought for no such port or window.
 */
export function EnableCommNotification(
  this: any,
  idComDev: number,
  hwnd: number,
  cbWriteNotify: number,
  cbOutQueue: number
) {
  if (refused(idComDev) || (hwnd && !IsWindow.call(this, hwnd))) {
    return 0;
  }

  return enableNotification(this, idComDev, hwnd, cbWriteNotify, cbOutQueue);
}
