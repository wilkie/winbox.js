'use strict';

import { readProfile } from './kernel/profiles.js';
import { GlobalAlloc } from './kernel/GlobalAlloc.js';
import { GlobalLock } from './kernel/GlobalLock.js';
import { PostMessage } from './user/PostMessage.js';

/**
 * COMM, the serial and parallel ports' driver, as winbox.js keeps it: what
 * USER's comm functions reach. **Read out** of `COMM.DRV` (seg2, seg3) and
 * **recorded** by `comms`.
 *
 * The machine's ports are those DOSBox's BIOS lists, where the recordings
 * were made: COM1 at 3F8h and COM2 at 2F8h, and LPT1 at 378h. Nothing is
 * connected to any of them. A serial port with nothing connected shows every
 * modem line low (**recorded**: a write waiting on any of DCD, CTS or DSR
 * times out, and a flow flag holds output), sends what it is given into
 * nothing, and receives nothing. The parallel port answers every status
 * read with an I/O error and not selected (**recorded**: a write stops at
 * once with error bits 0C00h).
 *
 * * A port's address comes from the BIOS, or else `SYSTEM.INI`'s `[386Enh]`
 *   `COMnBASE`; COM3 has 3E8h when neither gives one, and the other ports
 *   none. Its interrupt comes from `COMnIRQ`, 4, 3, 4, 3 when not given. It
 *   is looked up at the port's first open, and kept.
 * * The transmitter sends a byte at once when started with nothing in
 *   hand, and each next byte when the one before has gone, at the port's
 *   baud rate: **recorded**, the queue shows four of five bytes just after
 *   they are written, and none a second later.
 * * A flow flag whose line is low holds output from `SetCommState` on until
 *   the line rises, which with nothing connected is never. Restoring the
 *   state does not release it (**recorded**).
 *
 * Not followed: the 16550's FIFO, and the writes `RESETDEV` makes to its
 * control register; the 200 ms `SetCommState` spends reading and dropping
 * what arrives; the waits of a write on a handshake line, and of a parallel
 * port on a busy printer, answered at once since nothing will change;
 * enhanced mode's contention with DOS programs; and receiving, since
 * nothing is connected to send anything.
 */

/** A DCB's size: `GetCommState` copies this much. */
export const DCB_SIZE = 0x19;

/** The id `COMM` answers with for an id it has no port for, and several calls return. */
export const BAD_ID = 0x8000;

const CE_TXFULL = 0x0100;
const CE_CTSTO = 0x0020;
const CE_DSRTO = 0x0040;
const CE_RLSDTO = 0x0080;

const EV_TXEMPTY = 0x0004;

const CN_TRANSMIT = 0x02;
const CN_EVENT = 0x04;
const WM_COMMNOTIFY = 0x0044;

/* The modem status register's lines. */
const MSR_CTS = 0x10;
const MSR_DSR = 0x20;
const MSR_DCD = 0x80;

/* The interrupt enable register's bits. */
const IER_THRE = 0x02;

/* The handshake state's bits (COMM seg3). */
const HELD_XOFF = 0x08;
const HELD_LINES = 0x20;
const HELD_BREAK = 0x40;
const LINES_MISSING = 0x80;
const SEND_XON = 0x04;

/* The port's other flags. */
const FORCE_DSR = 0x01;
const EOF_SEEN = 0x20;
const IMMEDIATE = 0x40;

/** Each port's structure in COMM's data, where the event word lives. */
const PORT_SIZE = 0xa6;
const EVENT_WORD = 0x2e;
const DATA_SIZE = 0x318;

/** The divisors of the baud rates given as indices, FF10h on (COMM seg2 `0992`). */
const INDEXED_DIVISORS = [1047, 384, 192, 96, 48, 24, 12, 9, 6, 0, 0, 3, 0, 0, 0, 2];

/** The BIOS's ports: COM1 to COM4, then LPT1 to LPT3. */
const BIOS_COM = [0x3f8, 0x2f8, 0, 0];
const BIOS_LPT = [0x378, 0, 0];

const DEFAULT_IRQ = [4, 3, 4, 3];

/** What a parallel port with no printer answers at its status port. */
const NO_PRINTER_STATUS = 0x00;

/** What is connected to a serial port: nothing, unless something is given. */
export interface SerialLine {
  /** The modem status register's lines, CTS 10h, DSR 20h, RI 40h, DCD 80h. */
  readonly modemStatus: number;
  /** A byte the port sent. */
  send(byte: number): void;
}

const NOTHING: SerialLine = { modemStatus: 0, send() {} };

export class ComPort {
  readonly id: number;
  dcb = new Uint8Array(DCB_SIZE);
  error = 0;
  base = 0;
  irq = 0;
  hwnd = 0;
  notify = 0;
  receiveTrigger = 0xffff;
  transmitTrigger = 0;
  eventMask = 0;
  flags = 0;
  handshake = 0;
  /** The lines output needs, and those with a timeout, as the modem status's bits. */
  needed = 0;
  immediate = 0;
  ier = 0;
  mcr = 0;
  active = false;
  closing = false;
  queue: Uint8Array = new Uint8Array(0);
  count = 0;
  head = 0;
  received = 0;
  receiveSize = 0;
  line: SerialLine = NOTHING;
  /** When the byte being sent is gone, in milliseconds; 0 when the line is idle. */
  sending = 0;
  timer: any = null;

  constructor(id: number) {
    this.id = id;
  }

  get baud() {
    return this.dcb[1] | (this.dcb[2] << 8);
  }

  /** How long a character takes on the line, in milliseconds. */
  get characterTime() {
    const divisor = divisorOf(this.baud) || 12;
    const size = this.dcb[3];
    const stop = this.dcb[5] === 0 ? 1 : this.dcb[5] === 1 ? 1.5 : 2;
    const bits = 1 + size + (this.dcb[4] ? 1 : 0) + stop;

    return (bits * 1000 * divisor) / 115200;
  }
}

export class LptPort {
  readonly id: number;
  dcb = new Uint8Array(DCB_SIZE);
  error = 0;
  base = 0;

  constructor(id: number) {
    this.id = id;
  }
}

interface CommState {
  com: ComPort[];
  lpt: LptPort[];
  /** COMM's data segment, where each port's event word is, as a far pointer. */
  data: number;
}

export function commOf(system: any): CommState {
  return (system._comm ??= {
    com: [0, 1, 2, 3].map((id) => new ComPort(id)),
    lpt: [0, 1, 2].map((id) => new LptPort(0x80 + id)),
    data: 0,
  });
}

/** The port an id names, or none: COM1 to COM4, 0 to 3, and LPT1 to LPT3, 80h to 82h (COMM seg2 `0ab5`). */
export function portOf(system: any, id: number): ComPort | LptPort | null {
  const comm = commOf(system);

  if (id & 0x80) {
    return comm.lpt[id & 0x7f] && id - 0x80 < 3 ? comm.lpt[id - 0x80] : null;
  }

  return comm.com[id] ?? null;
}

function core(system: any) {
  return system.machine.cpu.core;
}

/** COMM's data segment, made when first wanted. */
function dataOf(system: any) {
  const comm = commOf(system);

  if (!comm.data) {
    const block = GlobalAlloc.call(system, 0x0042, DATA_SIZE);

    comm.data = GlobalLock.call(system, block) >>> 0;
  }

  return comm.data;
}

function eventWordAt(system: any, port: ComPort) {
  const data = dataOf(system);

  return { segment: data >>> 16, offset: (data & 0xffff) + port.id * PORT_SIZE + EVENT_WORD };
}

function readEvents(system: any, port: ComPort) {
  const { segment, offset } = eventWordAt(system, port);

  return core(system).read16(segment, offset);
}

function writeEvents(system: any, port: ComPort, value: number) {
  const { segment, offset } = eventWordAt(system, port);

  core(system).write16(segment, offset, value & 0xffff);
}

/** The divisor a baud rate or index gives the UART, or nought for none (COMM seg2 `09b2`). */
export function divisorOf(baud: number) {
  if (baud >= 0xff10) {
    return INDEXED_DIVISORS[baud - 0xff10] ?? 0;
  }

  return baud < 2 ? 0 : Math.floor(115200 / baud) & 0xffff;
}

/**
 * The error bits a printer's status gives (COMM seg2 `1274`, `11e3`): the
 * status port's top five bits, with acknowledge and error turned, read as
 * timeout 100h, I/O error 400h, not selected 800h and out of paper 1000h.
 */
function printerError(status: number, timedOut = false) {
  const value = ((status & 0xf8) ^ 0x48) & 0x39;
  const high = ((value >> 1) + ((value | (timedOut ? 1 : 0)) & 1)) ^ 0x08;

  return (high & 0xff) << 8;
}

/**
 * Looks up a serial port's address and interrupt, as its first open and
 * `EscapeCommFunction`'s 10 and 11 do (COMM seg2 `0bd1`): true when it has both.
 */
async function lookUp(system: any, port: ComPort) {
  if (port.base) {
    return true;
  }

  const n = port.id + 1;
  const profile = await readProfile(system, 'system.ini');
  let base = BIOS_COM[port.id];

  if (!base) {
    base = parseInt((profile.get('386Enh', `COM${n}Base`) ?? '').slice(0, 4), 16) || 0;
  }

  if (!base && port.id === 2) {
    base = 0x3e8;
  }

  if (!base) {
    return false;
  }

  const irqText = profile.get('386Enh', `COM${n}Irq`);
  const irq = irqText == null ? DEFAULT_IRQ[port.id] : parseInt(irqText, 10) || 0;

  if (irq === 0 || irq > 15) {
    return false;
  }

  port.base = base;
  port.irq = irq;

  if (parseInt(profile.get('386Enh', `COM${n}ForceDSR`) ?? '0', 10)) {
    port.flags |= FORCE_DSR;
  }

  return true;
}

/** SETQUE: the queues USER made for a serial port. */
export function setQueues(system: any, id: number, receiveSize: number, transmitSize: number) {
  const port = portOf(system, id);

  if (port instanceof ComPort) {
    port.receiveSize = receiveSize;
    port.received = 0;
    port.queue = new Uint8Array(transmitSize);
    port.count = 0;
    port.head = 0;
  }
}

/** INICOM: readies a port for the DCB given, its Id naming it; nought, or an error (COMM seg2 `03eb`). */
export async function initialise(system: any, dcb: Uint8Array): Promise<number> {
  const port = portOf(system, dcb[0]);

  if (!port) {
    return -1;
  }

  if (port instanceof LptPort) {
    const index = port.id - 0x80;
    const base = BIOS_LPT[index];

    if (!base) {
      return -10;
    }

    if (base < 0x100 || (index > 0 && BIOS_LPT[index - 1] === base)) {
      return -1;
    }

    port.base = base;
    port.dcb.set(dcb);

    return 0;
  }

  if (!(await lookUp(system, port))) {
    return -10;
  }

  port.ier = 0;
  port.active = false;
  port.mcr &= 3;
  port.count = 0;
  port.head = 0;
  port.received = 0;
  port.handshake = 0;
  port.closing = false;
  port.receiveTrigger = 0xffff;
  port.transmitTrigger = 0;
  writeEvents(system, port, 0);

  const answer = setState(system, dcb);

  if (answer) {
    return answer;
  }

  port.flags &= ~0xf0;
  port.error = 0;

  return 0;
}

/** SETCOM: a port's new state, its Id naming it; nought, or an error, with nothing changed (COMM seg2 `07e9`). */
export function setState(system: any, dcb: Uint8Array): number {
  const port = portOf(system, dcb[0]);

  if (!port) {
    return -1;
  }

  if (port instanceof LptPort) {
    port.dcb.set(dcb);

    return 0;
  }

  const baud = dcb[1] | (dcb[2] << 8);
  const size = dcb[3];
  const parity = dcb[4];
  const stop = dcb[5];

  if (!divisorOf(baud)) {
    return -12;
  }

  if (parity > 4) {
    return -5;
  }

  if (size < 5 || size > 8) {
    return -11;
  }

  if (stop !== 0 && stop !== 2 && !(stop === 1 && size === 5)) {
    return -5;
  }

  port.ier = 0;
  port.active = false;
  port.dcb.set(dcb);

  if (!parity) {
    port.dcb[12] &= ~0x04;
  }

  const flags = port.dcb[12];

  port.mcr = 0x08 | (flags & 0x80 ? 0 : 0x01) | (flags & 0x02 ? 0 : 0x02);
  port.needed = (flags & 0x08 ? MSR_CTS : 0) | (flags & 0x10 ? MSR_DSR : 0);

  const present = port.line.modemStatus;

  if (port.needed & ~present) {
    if (
      port.needed === (MSR_CTS | MSR_DSR) &&
      (present & (MSR_CTS | MSR_DSR)) === MSR_CTS &&
      !(port.flags & FORCE_DSR)
    ) {
      port.needed = MSR_CTS;
    } else {
      port.handshake |= HELD_LINES | LINES_MISSING;
    }
  }

  port.active = true;
  port.ier = 0x0d;

  return 0;
}

/** GETDCB: the DCB a port has. */
export function stateOf(system: any, id: number) {
  return portOf(system, id)?.dcb ?? null;
}

/** When the port next sends, and its transmit interrupt. */
function schedule(system: any, port: ComPort) {
  if (port.timer) {
    return;
  }

  const wait = Math.max(1, port.sending - performance.now());

  port.timer = setTimeout(() => {
    port.timer = null;
    transmitInterrupt(system, port);
  }, wait);
  port.timer.unref?.();
}

/** Starts the transmitter: its interrupt enabled, and taken at once if the line is idle (COMM seg2 `0f28`). */
function kick(system: any, port: ComPort) {
  port.ier |= IER_THRE;

  if (!port.active) {
    return;
  }

  if (performance.now() >= port.sending) {
    transmitInterrupt(system, port);
  } else {
    schedule(system, port);
  }
}

/** A byte gone to the line, which is busy until it is sent. */
function send(port: ComPort, byte: number) {
  port.line.send(byte);
  port.sending = Math.max(port.sending, performance.now()) + port.characterTime;
}

/**
 * The transmitter's interrupts from the last up to now, each when the
 * byte before has gone (COMM seg3 `03c6`), and the end of each: the event
 * word kept to the mask, and a notification of new events (seg3 `0223`).
 */
function transmitInterrupt(system: any, port: ComPort) {
  while (port.active && port.ier & IER_THRE && performance.now() >= port.sending) {
    const before = readEvents(system, port);
    let events = before;

    if (port.handshake & (HELD_LINES | HELD_BREAK)) {
      port.ier &= ~IER_THRE;
    } else if (port.handshake & SEND_XON && !(port.dcb[12] & 0x60)) {
      port.handshake &= ~SEND_XON;
      send(port, port.dcb[14]);
    } else if (port.handshake & 0x6d) {
      port.ier &= ~IER_THRE;
    } else if (port.flags & IMMEDIATE) {
      port.flags &= ~IMMEDIATE;
      send(port, port.immediate);
    } else if (!port.count) {
      events |= EV_TXEMPTY;
      port.ier &= ~IER_THRE;
    } else {
      send(port, port.queue[port.head]);
      port.head = (port.head + 1) % port.queue.length;
      port.count--;

      if (port.count < port.transmitTrigger) {
        if (!(port.notify & CN_TRANSMIT)) {
          notify(system, port, CN_TRANSMIT);
        }
      } else {
        port.notify &= ~CN_TRANSMIT;
      }
    }

    events &= port.eventMask;
    writeEvents(system, port, events);

    if (port.notify & 0x40 && events & ~before) {
      notify(system, port, CN_EVENT);
    }
  }

  if (port.active && port.ier & IER_THRE) {
    schedule(system, port);
  }
}

/** WM_COMMNOTIFY to the port's window, with the id and what happened (COMM seg3 `0528`). */
function notify(system: any, port: ComPort, bits: number) {
  if (bits !== CN_EVENT) {
    port.notify |= bits;
  }

  if (port.hwnd) {
    PostMessage.call(system, port.hwnd, WM_COMMNOTIFY, port.id, bits);
  }
}

/**
 * COMMWRITESTRING: queues bytes to send, or for a parallel port sends them;
 * how many (COMM seg2 `0e79`, `1220`).
 */
export function writeString(system: any, id: number, bytes: Uint8Array) {
  if (!bytes.length) {
    return 0;
  }

  const port = portOf(system, id);

  if (!port) {
    return 0;
  }

  if (port instanceof LptPort) {
    /* Each byte waits on the printer's status, which here always says it
     * cannot take one. */
    port.error |= printerError(NO_PRINTER_STATUS);

    return 0;
  }

  /* A line with a timeout is waited on while it is low; with nothing to
   * raise it, the wait ends as it would. */
  const low = ~port.line.modemStatus;
  const timeouts: [number, number, number][] = [
    [6, MSR_DCD, CE_RLSDTO],
    [8, MSR_CTS, CE_CTSTO],
    [10, MSR_DSR, CE_DSRTO],
  ];

  for (const [at, line, bit] of timeouts) {
    if (port.dcb[at] | (port.dcb[at + 1] << 8) && low & line) {
      port.error |= bit;

      return 0;
    }
  }

  const free = port.queue.length - port.count;

  if (free <= 0) {
    port.error |= CE_TXFULL;
    kick(system, port);

    return 0;
  }

  const n = Math.min(bytes.length, free);

  for (let i = 0; i < n; i++) {
    port.queue[(port.head + port.count + i) % port.queue.length] = bytes[i];
  }

  port.count += n;

  if (n < bytes.length) {
    port.error |= CE_TXFULL;
  }

  kick(system, port);

  return n;
}

/** READCOMMSTRING: what has been received; nothing is (COMM seg2 `0d25`). */
export function readString(system: any, id: number, _size: number) {
  const port = portOf(system, id);

  if (!(port instanceof ComPort) || port.error) {
    return new Uint8Array(0);
  }

  return new Uint8Array(0);
}

/** CTX: a byte to send before the queue; nought, 4000h if one is waiting, or 8000h (COMM seg2 `0e01`). */
export function transmitCharacter(system: any, id: number, character: number) {
  const port = portOf(system, id);

  if (!port) {
    return BAD_ID;
  }

  if (port instanceof LptPort) {
    port.error |= printerError(NO_PRINTER_STATUS);

    return 0x4000;
  }

  if (port.flags & IMMEDIATE) {
    return 0x4000;
  }

  port.immediate = character & 0xff;
  port.flags |= IMMEDIATE;
  kick(system, port);

  return 0;
}

/**
 * STACOM: the error word, cleared, and the port's state as a COMSTAT --
 * what holds it, and its queues' counts (COMM seg2 `0fea`); or 8000h.
 */
export function status(system: any, id: number) {
  const port = portOf(system, id);

  if (!port) {
    return { answer: BAD_ID, stat: null };
  }

  const answer = port.error;
  const stat = new Uint8Array(5);

  port.error = 0;

  if (port instanceof ComPort) {
    const low = ~port.line.modemStatus;

    stat[0] =
      (port.needed & MSR_CTS & low ? 0x01 : 0) |
      (port.needed & MSR_DSR & low ? 0x02 : 0) |
      (port.handshake & HELD_XOFF ? 0x08 : 0) |
      (port.handshake & 0x10 ? 0x10 : 0) |
      (port.flags & EOF_SEEN ? 0x20 : 0) |
      (port.flags & IMMEDIATE ? 0x40 : 0);
    stat[1] = port.received & 0xff;
    stat[2] = port.received >> 8;
    stat[3] = port.count & 0xff;
    stat[4] = port.count >> 8;
  }

  return { answer, stat };
}

/** CEVT: the events to keep, and the event word's far pointer; nought for none (COMM seg2 `0fbc`). */
export function setEventMask(system: any, id: number, mask: number) {
  const port = portOf(system, id);

  if (!(port instanceof ComPort)) {
    return 0;
  }

  port.eventMask = mask & 0xffff;

  const { segment, offset } = eventWordAt(system, port);

  return ((segment << 16) | offset) >>> 0;
}

/** CEVTGET: the event word, the events asked for cleared from it (COMM seg2 `0fd2`). */
export function takeEvents(system: any, id: number, mask: number) {
  const port = portOf(system, id);

  if (!port) {
    return 0;
  }

  /* A parallel port has no event word: what is in AX, the low byte of COMM's data segment. */
  if (port instanceof LptPort) {
    return (dataOf(system) >>> 16) & 0xff;
  }

  const events = readEvents(system, port);

  writeEvents(system, port, events & ~mask);

  return events;
}

/** CSETBRK and CCLRBRK: a break on the line or not, holding output; the error word (COMM seg2 `1035`). */
export function setBreak(system: any, id: number, on: boolean) {
  const port = portOf(system, id);

  if (!port) {
    return BAD_ID;
  }

  if (port instanceof ComPort) {
    if (on) {
      port.handshake |= HELD_BREAK;
    } else {
      port.handshake &= ~HELD_BREAK;
    }
  }

  return port.error;
}

/** CFLUSH: 0 empties the transmit queue, anything else the receive queue; the error word (COMM seg2 `0ef6`). */
export function flush(system: any, id: number, queue: number) {
  const port = portOf(system, id);

  if (!port) {
    return BAD_ID;
  }

  if (port instanceof ComPort) {
    if (queue & 0xff) {
      port.received = 0;
    } else {
      port.count = 0;
      port.head = 0;
    }
  }

  return port.error;
}

/**
 * CEXTFCN: `EscapeCommFunction`, by the low byte of its code; DX:AX (COMM
 * seg2 `107a`).
 */
export async function escape(system: any, id: number, code: number) {
  const port = portOf(system, id);

  if (!port) {
    return BAD_ID;
  }

  const function_ = code & 0xff;

  if (port instanceof LptPort) {
    if (function_ === 7) {
      port.error |= printerError(NO_PRINTER_STATUS);
    }

    return port.error;
  }

  switch (function_) {
    case 1:
      port.handshake |= HELD_XOFF;
      break;
    case 2:
      port.handshake &= ~HELD_XOFF;
      kick(system, port);
      break;
    case 3:
      port.mcr |= 0x02;
      break;
    case 4:
      port.mcr &= ~0x02;
      break;
    case 5:
      port.mcr |= 0x01;
      break;
    case 6:
      port.mcr &= ~0x01;
      break;
    case 7:
      /* A printer's reset, on the UART: what reads back from its interrupt
       * enable register, taken as a printer's status. */
      port.error |= printerError(port.base ? port.ier : NO_PRINTER_STATUS);
      break;
    case 8:
      return 0x82;
    case 9:
      return 3;
    case 10:
    case 11:
      return (await lookUp(system, port)) ? ((port.irq << 16) | port.base) >>> 0 : 0xffffffff;
    default:
      break;
  }

  return port.error;
}

/**
 * TRMCOM: closes a port, when what is queued has gone -- or has made no
 * progress for 30 seconds, answering -2, as it does at once when a line
 * output needed was missing (COMM seg2 `05f9`).
 */
export async function terminate(system: any, id: number) {
  const port = portOf(system, id);

  if (!port) {
    return BAD_ID;
  }

  if (port instanceof LptPort) {
    return 0;
  }

  port.closing = true;
  port.error = 0;
  port.received = 0;

  let answer = 0;

  if (port.handshake & LINES_MISSING) {
    answer = -2;
  } else {
    let last = port.count;
    let since = performance.now();

    while (port.count) {
      await new Promise((resolve) => setTimeout(resolve, 10));

      if (port.count !== last) {
        last = port.count;
        since = performance.now();
      } else if (performance.now() - since >= 30000) {
        answer = -2;
        break;
      }
    }
  }

  port.ier = 0;
  port.active = false;
  port.mcr &= 3;
  clearTimeout(port.timer);
  port.timer = null;

  return answer;
}

/**
 * ENABLENOTIFICATION: which window hears of a port, and when; 1, or nought
 * for no port (COMM seg2 `0747`).
 */
export function enableNotification(
  system: any,
  id: number,
  hwnd: number,
  receiveTrigger: number,
  transmitTrigger: number
) {
  const port = portOf(system, id);

  if (!port) {
    return 0;
  }

  if (port instanceof LptPort) {
    return 1;
  }

  let receive = receiveTrigger & 0xffff;
  let transmit = transmitTrigger & 0xffff;

  if (receive !== 0xffff && receive >= port.receiveSize) {
    receive = (port.receiveSize - 10) & 0xffff;
  }

  if (transmit !== 0xffff && transmit >= port.queue.length) {
    transmit = (port.queue.length - 10) & 0xffff;
  }

  if (hwnd) {
    port.notify = 0x40;
  } else {
    receive = 0xffff;
    transmit = 0;
    port.notify = 0;
  }

  port.hwnd = hwnd;
  port.receiveTrigger = receive;
  port.transmitTrigger = transmit;
  port.notify |= CN_TRANSMIT;

  return 1;
}
