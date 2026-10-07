//! COMM, the serial and parallel ports' driver, as winbox.js keeps it: what
//! USER's comm functions reach (`user_comm.rs`). **Read out** of `COMM.DRV`
//! (seg2, seg3) and **recorded** by `comms`.
//!
//! The machine's ports are those DOSBox's BIOS lists, where the recordings
//! were made: COM1 at 3F8h and COM2 at 2F8h, and LPT1 at 378h. Nothing is
//! connected to any of them. A serial port with nothing connected shows every
//! modem line low (**recorded**: a write waiting on any of DCD, CTS or DSR
//! times out, and a flow flag holds output), sends what it is given into
//! nothing, and receives nothing. The parallel port answers every status
//! read with an I/O error and not selected (**recorded**: a write stops at
//! once with error bits 0C00h).
//!
//! * A port's address comes from the BIOS, or else `SYSTEM.INI`'s `[386Enh]`
//!   `COMnBASE`; COM3 has 3E8h when neither gives one, and the other ports
//!   none. Its interrupt comes from `COMnIRQ`, 4, 3, 4, 3 when not given. It
//!   is looked up at the port's first open, and kept.
//! * The transmitter sends a byte at once when started with nothing in
//!   hand, and each next byte when the one before has gone, at the port's
//!   baud rate: **recorded**, the queue shows four of five bytes just after
//!   they are written, and none a second later.
//! * A flow flag whose line is low holds output from `SetCommState` on until
//!   the line rises, which with nothing connected is never. Restoring the
//!   state does not release it (**recorded**).
//!
//! The time a byte takes on the line is kept on the machine's clock, as the
//! TypeScript engine keeps it too (`comm.ts`); on the host's own, as that
//! engine once kept it, how much had gone after the program's own waits
//! hung on the host's speed and load. Here a run does the same whatever the
//! host, as every other time of the machine's does. The transmitter's
//! interrupt is looked for where MMSYSTEM's timer events are (`interrupts.rs`,
//! `engine.rs`): between slices of the task's instructions, and as time
//! passes while it waits.
//!
//! Not followed: the 16550's FIFO, and the writes `RESETDEV` makes to its
//! control register; the 200 ms `SetCommState` spends reading and dropping
//! what arrives; the waits of a write on a handshake line, and of a parallel
//! port on a busy printer, answered at once since nothing will change;
//! enhanced mode's contention with DOS programs; and receiving, since
//! nothing is connected to send anything.

use std::fmt::Debug;

use winbox_machine::TimerId;

use crate::engine::Engine;
use crate::system::System;

/// A DCB's size: `GetCommState` copies this much.
pub const DCB_SIZE: usize = 0x19;

/// The id `COMM` answers with for an id it has no port for, and several calls return.
pub const BAD_ID: u16 = 0x8000;

const CE_TXFULL: u16 = 0x0100;
const CE_CTSTO: u16 = 0x0020;
const CE_DSRTO: u16 = 0x0040;
const CE_RLSDTO: u16 = 0x0080;

const EV_TXEMPTY: u16 = 0x0004;

const CN_TRANSMIT: u8 = 0x02;
const CN_EVENT: u8 = 0x04;
const WM_COMMNOTIFY: u16 = 0x0044;

// The modem status register's lines.
const MSR_CTS: u8 = 0x10;
const MSR_DSR: u8 = 0x20;
const MSR_DCD: u8 = 0x80;

// The interrupt enable register's bits.
const IER_THRE: u8 = 0x02;

// The handshake state's bits (COMM seg3).
const HELD_XOFF: u8 = 0x08;
const HELD_LINES: u8 = 0x20;
const HELD_BREAK: u8 = 0x40;
const LINES_MISSING: u8 = 0x80;
const SEND_XON: u8 = 0x04;

// The port's other flags.
const FORCE_DSR: u8 = 0x01;
const EOF_SEEN: u8 = 0x20;
const IMMEDIATE: u8 = 0x40;

/// Each port's structure in COMM's data, where the event word lives.
const PORT_SIZE: u32 = 0xa6;
const EVENT_WORD: u32 = 0x2e;
const DATA_SIZE: u32 = 0x318;

/// The divisors of the baud rates given as indices, `FF10h` on (COMM seg2 `0992`).
const INDEXED_DIVISORS: [u16; 16] = [1047, 384, 192, 96, 48, 24, 12, 9, 6, 0, 0, 3, 0, 0, 0, 2];

/// The BIOS's ports: COM1 to COM4, then LPT1 to LPT3.
const BIOS_COM: [i32; 4] = [0x3f8, 0x2f8, 0, 0];
const BIOS_LPT: [u16; 3] = [0x378, 0, 0];

const DEFAULT_IRQ: [i32; 4] = [4, 3, 4, 3];

/// What a parallel port with no printer answers at its status port.
const NO_PRINTER_STATUS: u8 = 0x00;

/// How long `CloseComm` waits between looks at a queue still going out,
/// and how long one may go without progress before it gives up, in
/// milliseconds.
const CLOSE_STEP: f64 = 10.0;
const CLOSE_PATIENCE: f64 = 30000.0;

/// What is connected to a serial port: nothing, unless something is given.
pub trait SerialLine: Debug {
    /// The modem status register's lines, CTS 10h, DSR 20h, RI 40h, DCD 80h.
    fn modem_status(&self) -> u8;
    /// A byte the port sent.
    fn send(&mut self, byte: u8);
}

/// Nothing connected: every line low, and what is sent gone.
#[derive(Debug)]
struct Nothing;

impl SerialLine for Nothing {
    fn modem_status(&self) -> u8 {
        0
    }

    fn send(&mut self, _: u8) {}
}

/// A serial port, as COMM keeps it.
#[derive(Debug)]
pub struct ComPort {
    pub id: u8,
    pub dcb: [u8; DCB_SIZE],
    pub error: u16,
    /// The port's address and interrupt, as `SYSTEM.INI` may give them:
    /// signed, since a minus read there is kept, and nought until looked up.
    pub base: i32,
    pub irq: i32,
    pub hwnd: u16,
    pub notify: u8,
    pub receive_trigger: u16,
    pub transmit_trigger: u16,
    pub event_mask: u16,
    pub flags: u8,
    pub handshake: u8,
    /// The lines output needs, and those with a timeout, as the modem
    /// status's bits.
    pub needed: u8,
    pub immediate: u8,
    pub ier: u8,
    pub mcr: u8,
    pub active: bool,
    pub closing: bool,
    pub queue: Vec<u8>,
    pub count: usize,
    pub head: usize,
    pub received: u16,
    pub receive_size: u16,
    pub line: Box<dyn SerialLine>,
    /// When the byte being sent is gone, in the clock's milliseconds; 0
    /// when the line is idle.
    pub sending: f64,
    /// The transmitter's next interrupt: the clock's timer, which wakes a
    /// task that waits, and when it is due.
    timer: Option<(TimerId, f64)>,
}

impl ComPort {
    fn new(id: u8) -> Self {
        Self {
            id,
            dcb: [0; DCB_SIZE],
            error: 0,
            base: 0,
            irq: 0,
            hwnd: 0,
            notify: 0,
            receive_trigger: 0xffff,
            transmit_trigger: 0,
            event_mask: 0,
            flags: 0,
            handshake: 0,
            needed: 0,
            immediate: 0,
            ier: 0,
            mcr: 0,
            active: false,
            closing: false,
            queue: Vec::new(),
            count: 0,
            head: 0,
            received: 0,
            receive_size: 0,
            line: Box::new(Nothing),
            sending: 0.0,
            timer: None,
        }
    }

    pub fn baud(&self) -> u16 {
        u16::from_le_bytes([self.dcb[1], self.dcb[2]])
    }

    /// How long a character takes on the line, in milliseconds.
    pub fn character_time(&self) -> f64 {
        let divisor = match divisor_of(self.baud()) {
            0 => 12,
            divisor => divisor,
        };
        let size = f64::from(self.dcb[3]);
        let stop = match self.dcb[5] {
            0 => 1.0,
            1 => 1.5,
            _ => 2.0,
        };
        let bits = 1.0 + size + if self.dcb[4] == 0 { 0.0 } else { 1.0 } + stop;

        (bits * 1000.0 * f64::from(divisor)) / 115_200.0
    }
}

/// A parallel port, as COMM keeps it.
#[derive(Debug)]
pub struct LptPort {
    pub id: u8,
    pub dcb: [u8; DCB_SIZE],
    pub error: u16,
    pub base: u16,
}

impl LptPort {
    fn new(id: u8) -> Self {
        Self {
            id,
            dcb: [0; DCB_SIZE],
            error: 0,
            base: 0,
        }
    }
}

/// What COMM keeps: its ports, and its data segment, where each port's
/// event word is, as a far pointer once made.
#[derive(Debug)]
pub struct Comm {
    pub com: Vec<ComPort>,
    pub lpt: Vec<LptPort>,
    data: u32,
}

impl Default for Comm {
    fn default() -> Self {
        Self {
            com: (0..4).map(ComPort::new).collect(),
            lpt: (0..3).map(|id| LptPort::new(0x80 + id)).collect(),
            data: 0,
        }
    }
}

/// The port an id names: COM1 to COM4, 0 to 3, and LPT1 to LPT3, 80h to
/// 82h (COMM seg2 `0ab5`), by its place in COMM's lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Port {
    Com(usize),
    Lpt(usize),
}

pub fn port_of(id: u16) -> Option<Port> {
    if id & 0x80 != 0 {
        let index = usize::from(id - 0x80);

        return (index < 3).then_some(Port::Lpt(index));
    }

    (id < 4).then_some(Port::Com(usize::from(id)))
}

/// The divisor a baud rate or index gives the UART, or nought for none (COMM seg2 `09b2`).
pub fn divisor_of(baud: u16) -> u16 {
    if baud >= 0xff10 {
        return INDEXED_DIVISORS
            .get(usize::from(baud - 0xff10))
            .copied()
            .unwrap_or(0);
    }

    if baud < 2 {
        0
    } else {
        (115_200 / u32::from(baud)) as u16
    }
}

/// The error bits a printer's status gives (COMM seg2 `1274`, `11e3`): the
/// status port's top five bits, with acknowledge and error turned, read as
/// timeout 100h, I/O error 400h, not selected 800h and out of paper 1000h.
pub fn printer_error(status: u8, timed_out: bool) -> u16 {
    let value = ((status & 0xf8) ^ 0x48) & 0x39;
    let high = ((value >> 1) + ((value | u8::from(timed_out)) & 1)) ^ 0x08;

    u16::from(high) << 8
}

/// A number at the start of some text, as JavaScript's `parseInt` reads
/// one: blanks skipped, a sign, `0x` before hexadecimal; `None` for no
/// digits.
fn parse_int(text: &[u8], radix: u32) -> Option<i64> {
    let mut rest = &text[text
        .iter()
        .position(|&byte| !crate::profile::js_space(byte))
        .unwrap_or(text.len())..];
    let negative = rest.first() == Some(&b'-');

    if matches!(rest.first(), Some(b'-' | b'+')) {
        rest = &rest[1..];
    }

    if radix == 16 && rest.len() >= 2 && rest[0] == b'0' && matches!(rest[1], b'x' | b'X') {
        rest = &rest[2..];
    }

    let digits: Vec<i64> = rest
        .iter()
        .map_while(|&byte| char::from(byte).to_digit(radix).map(i64::from))
        .collect();

    if digits.is_empty() {
        return None;
    }

    let value = digits.iter().fold(0i64, |value, digit| {
        value.saturating_mul(i64::from(radix)) + digit
    });

    Some(if negative { -value } else { value })
}

impl System {
    /// The clock's milliseconds, which the transmitter keeps its time by.
    fn comm_now(&self) -> f64 {
        self.clock.now(self.instructions)
    }

    /// COMM's data segment, made when first wanted.
    fn comm_data(&mut self) -> u32 {
        if self.comm.data == 0 {
            self.comm.data = self.scratch_block(DATA_SIZE).1;
        }

        self.comm.data
    }

    /// A serial port's event word in COMM's data, as a far pointer.
    fn event_word_at(&mut self, index: usize) -> u32 {
        let data = self.comm_data();
        let id = u32::from(self.comm.com[index].id);

        (data & 0xffff_0000) | ((data & 0xffff) + id * PORT_SIZE + EVENT_WORD)
    }

    fn read_events(&mut self, index: usize) -> u16 {
        let far = self.event_word_at(index);
        let bytes = self.read_far(far, 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    fn write_events(&mut self, index: usize, value: u16) {
        let far = self.event_word_at(index);

        self.write_far(far, &value.to_le_bytes());
    }

    /// Looks up a serial port's address and interrupt, as its first open and
    /// `EscapeCommFunction`'s 10 and 11 do (COMM seg2 `0bd1`): true when it
    /// has both.
    fn look_up(&mut self, index: usize) -> bool {
        if self.comm.com[index].base != 0 {
            return true;
        }

        let n = index + 1;
        let profile = self.read_profile(b"system.ini");
        let entry = |name: &str| profile.get(b"386Enh", format!("COM{n}{name}").as_bytes(), true);
        let mut base = BIOS_COM[index];

        if base == 0 {
            let text = entry("Base").unwrap_or_default();

            // Four characters at most: from -FFFh to FFFFh, a minus kept.
            base = parse_int(&text[..text.len().min(4)], 16).map_or(0, |value| value as i32);
        }

        if base == 0 && index == 2 {
            base = 0x3e8;
        }

        if base == 0 {
            return false;
        }

        let irq = match entry("Irq") {
            None => i64::from(DEFAULT_IRQ[index]),
            Some(text) => parse_int(&text, 10).unwrap_or(0),
        };

        if irq == 0 || irq > 15 {
            return false;
        }

        let force = entry("ForceDSR").unwrap_or_else(|| b"0".to_vec());
        let port = &mut self.comm.com[index];

        port.base = base;
        // Neither nought nor past 15, a minus included, it is kept, as
        // JavaScript's `<<` takes it to 32 bits when it is answered.
        port.irq = irq as i32;

        if parse_int(&force, 10).is_some_and(|value| value != 0) {
            port.flags |= FORCE_DSR;
        }

        true
    }

    /// SETQUE: the queues USER made for a serial port.
    pub fn comm_set_queues(&mut self, id: u16, receive_size: u16, transmit_size: u16) {
        if let Some(Port::Com(index)) = port_of(id) {
            let port = &mut self.comm.com[index];

            port.receive_size = receive_size;
            port.received = 0;
            port.queue = vec![0; usize::from(transmit_size)];
            port.count = 0;
            port.head = 0;
        }
    }

    /// INICOM: readies a port for the DCB given, its Id naming it; nought,
    /// or an error (COMM seg2 `03eb`).
    pub fn comm_initialise(&mut self, dcb: &[u8; DCB_SIZE]) -> i16 {
        let index = match port_of(u16::from(dcb[0])) {
            None => return -1,
            Some(Port::Lpt(index)) => {
                let base = BIOS_LPT[index];

                if base == 0 {
                    return -10;
                }

                if base < 0x100 || (index > 0 && BIOS_LPT[index - 1] == base) {
                    return -1;
                }

                let port = &mut self.comm.lpt[index];

                port.base = base;
                port.dcb = *dcb;
                return 0;
            }
            Some(Port::Com(index)) => index,
        };

        if !self.look_up(index) {
            return -10;
        }

        let port = &mut self.comm.com[index];

        port.ier = 0;
        port.active = false;
        port.mcr &= 3;
        port.count = 0;
        port.head = 0;
        port.received = 0;
        port.handshake = 0;
        port.closing = false;
        port.receive_trigger = 0xffff;
        port.transmit_trigger = 0;
        self.write_events(index, 0);

        let answer = self.comm_set_state(dcb);

        if answer != 0 {
            return answer;
        }

        let port = &mut self.comm.com[index];

        port.flags &= !0xf0;
        port.error = 0;
        0
    }

    /// SETCOM: a port's new state, its Id naming it; nought, or an error,
    /// with nothing changed (COMM seg2 `07e9`).
    pub fn comm_set_state(&mut self, dcb: &[u8; DCB_SIZE]) -> i16 {
        let index = match port_of(u16::from(dcb[0])) {
            None => return -1,
            Some(Port::Lpt(index)) => {
                self.comm.lpt[index].dcb = *dcb;
                return 0;
            }
            Some(Port::Com(index)) => index,
        };
        let baud = u16::from_le_bytes([dcb[1], dcb[2]]);
        let size = dcb[3];
        let parity = dcb[4];
        let stop = dcb[5];

        if divisor_of(baud) == 0 {
            return -12;
        }

        if parity > 4 {
            return -5;
        }

        if !(5..=8).contains(&size) {
            return -11;
        }

        if stop != 0 && stop != 2 && !(stop == 1 && size == 5) {
            return -5;
        }

        let port = &mut self.comm.com[index];

        port.ier = 0;
        port.active = false;
        port.dcb = *dcb;

        if parity == 0 {
            port.dcb[12] &= !0x04;
        }

        let flags = port.dcb[12];

        port.mcr = 0x08 | u8::from(flags & 0x80 == 0) | u8::from(flags & 0x02 == 0) << 1;
        port.needed = if flags & 0x08 == 0 { 0 } else { MSR_CTS }
            | if flags & 0x10 == 0 { 0 } else { MSR_DSR };

        let present = port.line.modem_status();

        if port.needed & !present != 0 {
            if port.needed == (MSR_CTS | MSR_DSR)
                && present & (MSR_CTS | MSR_DSR) == MSR_CTS
                && port.flags & FORCE_DSR == 0
            {
                port.needed = MSR_CTS;
            } else {
                port.handshake |= HELD_LINES | LINES_MISSING;
            }
        }

        port.active = true;
        port.ier = 0x0d;
        0
    }

    /// GETDCB: the DCB a port has.
    pub fn comm_state_of(&self, id: u16) -> Option<[u8; DCB_SIZE]> {
        match port_of(id)? {
            Port::Com(index) => Some(self.comm.com[index].dcb),
            Port::Lpt(index) => Some(self.comm.lpt[index].dcb),
        }
    }

    /// When the port next sends, and its transmit interrupt: on the clock,
    /// a millisecond on at the least.
    fn comm_schedule(&mut self, index: usize) {
        if self.comm.com[index].timer.is_some() {
            return;
        }

        let wait = (self.comm.com[index].sending - self.comm_now()).max(1.0);
        let due = self.comm_now() + wait;
        let timer = self.clock.after(self.instructions, wait);

        self.comm.com[index].timer = Some((timer, due));
    }

    /// The transmitter's interrupt let go, as `clearTimeout` lets it go.
    fn comm_unschedule(&mut self, index: usize) {
        if let Some((timer, _)) = self.comm.com[index].timer.take() {
            self.clock.cancel(timer);
        }
    }

    /// Starts the transmitter: its interrupt enabled, and taken at once if
    /// the line is idle (COMM seg2 `0f28`).
    fn comm_kick(&mut self, index: usize) {
        let port = &mut self.comm.com[index];

        port.ier |= IER_THRE;

        if !port.active {
            return;
        }

        if self.comm_now() >= self.comm.com[index].sending {
            self.transmit_interrupt(index);
        } else {
            self.comm_schedule(index);
        }
    }

    /// A byte gone to the line, which is busy until it is sent.
    fn comm_send(&mut self, index: usize, byte: u8) {
        let now = self.comm_now();
        let port = &mut self.comm.com[index];

        port.line.send(byte);
        port.sending = port.sending.max(now) + port.character_time();
    }

    /// The transmitter's interrupts from the last up to now, each when the
    /// byte before has gone (COMM seg3 `03c6`), and the end of each: the
    /// event word kept to the mask, and a notification of new events (seg3
    /// `0223`).
    fn transmit_interrupt(&mut self, index: usize) {
        loop {
            let port = &self.comm.com[index];

            if !(port.active && port.ier & IER_THRE != 0 && self.comm_now() >= port.sending) {
                break;
            }

            let before = self.read_events(index);
            let mut events = before;
            let port = &mut self.comm.com[index];

            if port.handshake & (HELD_LINES | HELD_BREAK) != 0 {
                port.ier &= !IER_THRE;
            } else if port.handshake & SEND_XON != 0 && port.dcb[12] & 0x60 == 0 {
                port.handshake &= !SEND_XON;

                let xon = port.dcb[14];

                self.comm_send(index, xon);
            } else if port.handshake & 0x6d != 0 {
                port.ier &= !IER_THRE;
            } else if port.flags & IMMEDIATE != 0 {
                port.flags &= !IMMEDIATE;

                let immediate = port.immediate;

                self.comm_send(index, immediate);
            } else if port.count == 0 {
                events |= EV_TXEMPTY;
                port.ier &= !IER_THRE;
            } else {
                let byte = port.queue[port.head];

                port.head = (port.head + 1) % port.queue.len();
                port.count -= 1;
                self.comm_send(index, byte);

                let port = &mut self.comm.com[index];

                if port.count < usize::from(port.transmit_trigger) {
                    if port.notify & CN_TRANSMIT == 0 {
                        self.comm_notify(index, CN_TRANSMIT);
                    }
                } else {
                    port.notify &= !CN_TRANSMIT;
                }
            }

            events &= self.comm.com[index].event_mask;
            self.write_events(index, events);

            if self.comm.com[index].notify & 0x40 != 0 && events & !before != 0 {
                self.comm_notify(index, CN_EVENT);
            }
        }

        let port = &self.comm.com[index];

        if port.active && port.ier & IER_THRE != 0 {
            self.comm_schedule(index);
        }
    }

    /// What of the transmitters' interrupts has come due, taken: looked at
    /// between slices of the task's instructions, and as time passes while
    /// it waits, as the TypeScript engine's `setTimeout` comes between its
    /// slices.
    pub(crate) fn poll_comm(&mut self) {
        for index in 0..self.comm.com.len() {
            let Some((_, due)) = self.comm.com[index].timer else {
                continue;
            };

            if due > self.comm_now() {
                continue;
            }

            self.comm_unschedule(index);
            self.transmit_interrupt(index);
        }
    }

    /// `WM_COMMNOTIFY` to the port's window, with the id and what happened
    /// (COMM seg3 `0528`).
    fn comm_notify(&mut self, index: usize, bits: u8) {
        let port = &mut self.comm.com[index];

        if bits != CN_EVENT {
            port.notify |= bits;
        }

        let (hwnd, id) = (port.hwnd, port.id);

        if hwnd != 0 {
            self.post_message(hwnd, WM_COMMNOTIFY, u16::from(id), u32::from(bits));
        }
    }

    /// COMMWRITESTRING: queues bytes to send, or for a parallel port sends
    /// them; how many (COMM seg2 `0e79`, `1220`).
    pub fn comm_write_string(&mut self, id: u16, bytes: &[u8]) -> usize {
        if bytes.is_empty() {
            return 0;
        }

        let index = match port_of(id) {
            None => return 0,
            // Each byte waits on the printer's status, which here always
            // says it cannot take one.
            Some(Port::Lpt(index)) => {
                self.comm.lpt[index].error |= printer_error(NO_PRINTER_STATUS, false);
                return 0;
            }
            Some(Port::Com(index)) => index,
        };
        let port = &mut self.comm.com[index];
        // A line with a timeout is waited on while it is low; with nothing
        // to raise it, the wait ends as it would.
        let low = !port.line.modem_status();
        let timeouts = [
            (6, MSR_DCD, CE_RLSDTO),
            (8, MSR_CTS, CE_CTSTO),
            (10, MSR_DSR, CE_DSRTO),
        ];

        for (at, line, bit) in timeouts {
            if (port.dcb[at] != 0 || port.dcb[at + 1] != 0) && low & line != 0 {
                port.error |= bit;
                return 0;
            }
        }

        let length = port.queue.len();
        let free = length - port.count;

        if free == 0 {
            port.error |= CE_TXFULL;
            self.comm_kick(index);
            return 0;
        }

        let n = bytes.len().min(free);

        for (i, &byte) in bytes[..n].iter().enumerate() {
            port.queue[(port.head + port.count + i) % length] = byte;
        }

        port.count += n;

        if n < bytes.len() {
            port.error |= CE_TXFULL;
        }

        self.comm_kick(index);
        n
    }

    /// READCOMMSTRING: what has been received; nothing is (COMM seg2 `0d25`).
    pub fn comm_read_string(&self, _id: u16, _size: u16) -> Vec<u8> {
        Vec::new()
    }

    /// CTX: a byte to send before the queue; nought, 4000h if one is
    /// waiting, or 8000h (COMM seg2 `0e01`).
    pub fn comm_transmit_character(&mut self, id: u16, character: u16) -> u16 {
        let index = match port_of(id) {
            None => return BAD_ID,
            Some(Port::Lpt(index)) => {
                self.comm.lpt[index].error |= printer_error(NO_PRINTER_STATUS, false);
                return 0x4000;
            }
            Some(Port::Com(index)) => index,
        };
        let port = &mut self.comm.com[index];

        if port.flags & IMMEDIATE != 0 {
            return 0x4000;
        }

        port.immediate = character as u8;
        port.flags |= IMMEDIATE;
        self.comm_kick(index);
        0
    }

    /// STACOM: the error word, cleared, and the port's state as a COMSTAT
    /// -- what holds it, and its queues' counts (COMM seg2 `0fea`); or
    /// 8000h and none.
    pub fn comm_status(&mut self, id: u16) -> (u16, Option<[u8; 5]>) {
        let mut stat = [0u8; 5];
        let answer = match port_of(id) {
            None => return (BAD_ID, None),
            Some(Port::Lpt(index)) => std::mem::take(&mut self.comm.lpt[index].error),
            Some(Port::Com(index)) => {
                let port = &mut self.comm.com[index];
                let answer = std::mem::take(&mut port.error);
                let low = !port.line.modem_status();
                let bit = |on: bool, bit: u8| if on { bit } else { 0 };

                stat[0] = bit(port.needed & MSR_CTS & low != 0, 0x01)
                    | bit(port.needed & MSR_DSR & low != 0, 0x02)
                    | bit(port.handshake & HELD_XOFF != 0, 0x08)
                    | bit(port.handshake & 0x10 != 0, 0x10)
                    | bit(port.flags & EOF_SEEN != 0, 0x20)
                    | bit(port.flags & IMMEDIATE != 0, 0x40);
                stat[1..3].copy_from_slice(&port.received.to_le_bytes());
                stat[3..5].copy_from_slice(&(port.count as u16).to_le_bytes());
                answer
            }
        };

        (answer, Some(stat))
    }

    /// CEVT: the events to keep, and the event word's far pointer; nought
    /// for none (COMM seg2 `0fbc`).
    pub fn comm_set_event_mask(&mut self, id: u16, mask: u16) -> u32 {
        let Some(Port::Com(index)) = port_of(id) else {
            return 0;
        };

        self.comm.com[index].event_mask = mask;
        self.event_word_at(index)
    }

    /// CEVTGET: the event word, the events asked for cleared from it (COMM
    /// seg2 `0fd2`).
    pub fn comm_take_events(&mut self, id: u16, mask: u16) -> u16 {
        match port_of(id) {
            None => 0,
            // A parallel port has no event word: what is in AX, the low
            // byte of COMM's data segment.
            Some(Port::Lpt(_)) => ((self.comm_data() >> 16) & 0xff) as u16,
            Some(Port::Com(index)) => {
                let events = self.read_events(index);

                self.write_events(index, events & !mask);
                events
            }
        }
    }

    /// CSETBRK and CCLRBRK: a break on the line or not, holding output; the
    /// error word (COMM seg2 `1035`).
    pub fn comm_set_break(&mut self, id: u16, on: bool) -> u16 {
        match port_of(id) {
            None => BAD_ID,
            Some(Port::Lpt(index)) => self.comm.lpt[index].error,
            Some(Port::Com(index)) => {
                let port = &mut self.comm.com[index];

                if on {
                    port.handshake |= HELD_BREAK;
                } else {
                    port.handshake &= !HELD_BREAK;
                }

                port.error
            }
        }
    }

    /// CFLUSH: 0 empties the transmit queue, anything else the receive
    /// queue; the error word (COMM seg2 `0ef6`).
    pub fn comm_flush(&mut self, id: u16, queue: u16) -> u16 {
        match port_of(id) {
            None => BAD_ID,
            Some(Port::Lpt(index)) => self.comm.lpt[index].error,
            Some(Port::Com(index)) => {
                let port = &mut self.comm.com[index];

                if queue as u8 == 0 {
                    port.count = 0;
                    port.head = 0;
                } else {
                    port.received = 0;
                }

                port.error
            }
        }
    }

    /// CEXTFCN: `EscapeCommFunction`, by the low byte of its code; DX:AX
    /// (COMM seg2 `107a`).
    pub fn comm_escape(&mut self, id: u16, code: u16) -> u32 {
        let function = code & 0xff;
        let index = match port_of(id) {
            None => return u32::from(BAD_ID),
            Some(Port::Lpt(index)) => {
                let port = &mut self.comm.lpt[index];

                if function == 7 {
                    port.error |= printer_error(NO_PRINTER_STATUS, false);
                }

                return u32::from(port.error);
            }
            Some(Port::Com(index)) => index,
        };

        match function {
            1 => self.comm.com[index].handshake |= HELD_XOFF,
            2 => {
                self.comm.com[index].handshake &= !HELD_XOFF;
                self.comm_kick(index);
            }
            3 => self.comm.com[index].mcr |= 0x02,
            4 => self.comm.com[index].mcr &= !0x02,
            5 => self.comm.com[index].mcr |= 0x01,
            6 => self.comm.com[index].mcr &= !0x01,
            // A printer's reset, on the UART: what reads back from its
            // interrupt enable register, taken as a printer's status.
            7 => {
                let port = &mut self.comm.com[index];
                let status = if port.base == 0 {
                    NO_PRINTER_STATUS
                } else {
                    port.ier
                };

                port.error |= printer_error(status, false);
            }
            8 => return 0x82,
            9 => return 3,
            10 | 11 => {
                return if self.look_up(index) {
                    let port = &self.comm.com[index];

                    // As JavaScript's `|` makes it: a minus base fills the
                    // high word.
                    ((port.irq << 16) | port.base) as u32
                } else {
                    0xffff_ffff
                };
            }
            _ => {}
        }

        u32::from(self.comm.com[index].error)
    }

    /// ENABLENOTIFICATION: which window hears of a port, and when; 1, or
    /// nought for no port (COMM seg2 `0747`).
    pub fn comm_enable_notification(
        &mut self,
        id: u16,
        hwnd: u16,
        receive_trigger: u16,
        transmit_trigger: u16,
    ) -> u16 {
        let index = match port_of(id) {
            None => return 0,
            Some(Port::Lpt(_)) => return 1,
            Some(Port::Com(index)) => index,
        };
        let port = &mut self.comm.com[index];
        let mut receive = receive_trigger;
        let mut transmit = transmit_trigger;

        if receive != 0xffff && receive >= port.receive_size {
            receive = port.receive_size.wrapping_sub(10);
        }

        if transmit != 0xffff && usize::from(transmit) >= port.queue.len() {
            transmit = (port.queue.len() as u16).wrapping_sub(10);
        }

        if hwnd == 0 {
            receive = 0xffff;
            transmit = 0;
            port.notify = 0;
        } else {
            port.notify = 0x40;
        }

        port.hwnd = hwnd;
        port.receive_trigger = receive;
        port.transmit_trigger = transmit;
        port.notify |= CN_TRANSMIT;
        1
    }
}

impl Engine {
    /// TRMCOM: closes a port, when what is queued has gone -- or has made
    /// no progress for 30 seconds, answering -2, as it does at once when a
    /// line output needed was missing (COMM seg2 `05f9`). Waits a hundredth
    /// of a second at a time, with the processor given up.
    pub async fn comm_terminate(&self, id: u16) -> i32 {
        let index = match port_of(id) {
            None => return i32::from(BAD_ID),
            Some(Port::Lpt(_)) => return 0,
            Some(Port::Com(index)) => index,
        };
        let missing = {
            let mut system = self.system();
            let port = &mut system.comm.com[index];

            port.closing = true;
            port.error = 0;
            port.received = 0;
            port.handshake & LINES_MISSING != 0
        };
        let mut answer = 0;

        if missing {
            answer = -2;
        } else {
            let (mut last, mut since) = {
                let system = self.system();

                (system.comm.com[index].count, system.comm_now())
            };

            loop {
                if self.system().comm.com[index].count == 0 {
                    break;
                }

                self.wait_for_wake(Some(CLOSE_STEP)).await;

                let system = self.system();
                let count = system.comm.com[index].count;

                if count != last {
                    last = count;
                    since = system.comm_now();
                } else if system.comm_now() - since >= CLOSE_PATIENCE {
                    answer = -2;
                    break;
                }
            }
        }

        let mut system = self.system();
        let port = &mut system.comm.com[index];

        port.ier = 0;
        port.active = false;
        port.mcr &= 3;
        system.comm_unschedule(index);
        answer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baud_rates_give_their_divisors() {
        assert_eq!(divisor_of(0), 0);
        assert_eq!(divisor_of(1), 0);
        assert_eq!(divisor_of(110), 1047);
        assert_eq!(divisor_of(9600), 12);
        assert_eq!(divisor_of(12345), 9);
        assert_eq!(divisor_of(57600), 2);
        // CBR_9600, an index.
        assert_eq!(divisor_of(0xff12), 192);
        // CBR_256000, past the table.
        assert_eq!(divisor_of(0xff27), 0);
        // Under the indices, a rate.
        assert_eq!(divisor_of(0xff00), 1);
    }

    #[test]
    fn a_missing_printer_is_an_io_error_and_not_selected() {
        // **Recorded**: a write to LPT1 leaves 0C00h.
        assert_eq!(printer_error(NO_PRINTER_STATUS, false), 0x0c00);
        // **Recorded**: escape 7 on COM1, its interrupts enabled 0Dh, 800h.
        assert_eq!(printer_error(0x0d, false), 0x0800);
        assert_eq!(printer_error(0x00, true), 0x0d00);
    }

    #[test]
    fn ids_name_four_serial_ports_and_three_parallel() {
        assert_eq!(port_of(0), Some(Port::Com(0)));
        assert_eq!(port_of(3), Some(Port::Com(3)));
        assert_eq!(port_of(4), None);
        assert_eq!(port_of(0x80), Some(Port::Lpt(0)));
        assert_eq!(port_of(0x82), Some(Port::Lpt(2)));
        assert_eq!(port_of(0x83), None);
    }

    #[test]
    fn integers_are_read_as_javascript_reads_them() {
        assert_eq!(parse_int(b"3F8", 16), Some(0x3f8));
        assert_eq!(parse_int(b" 0x2e8", 16), Some(0x2e8));
        assert_eq!(parse_int(b"4h", 10), Some(4));
        assert_eq!(parse_int(b"-1", 10), Some(-1));
        assert_eq!(parse_int(b"x", 10), None);
        assert_eq!(parse_int(b"", 16), None);
    }

    #[test]
    fn a_character_takes_its_bits_at_the_baud_rate() {
        let mut port = ComPort::new(1);

        // 110 baud, seven bits, even parity, one stop bit: ten bits.
        port.dcb[1..6].copy_from_slice(&[110, 0, 7, 2, 0]);
        assert!((port.character_time() - 10.0 * 1000.0 * 1047.0 / 115_200.0).abs() < 1e-9);
        // No rate: 9600's divisor.
        port.dcb[1..3].copy_from_slice(&[0, 0]);
        assert!((port.character_time() - 10.0 * 1000.0 * 12.0 / 115_200.0).abs() < 1e-9);
    }

    /// A DCB for COM2 as `OpenComm` gives one, `COM1:9600,E,7,1`, at a rate.
    fn com2_at(baud: u16) -> [u8; DCB_SIZE] {
        let mut dcb = [0u8; DCB_SIZE];

        dcb[0] = 1;
        dcb[1..3].copy_from_slice(&baud.to_le_bytes());
        dcb[3] = 7;
        dcb[4] = 2;
        dcb[12] = 0x01;
        dcb
    }

    /// The clock moved on, and the transmitter's interrupt looked for.
    fn later(system: &mut System, ms: f64) {
        let instructions = system.instructions;

        system.clock.advance(instructions, ms);
        system.poll_comm();
    }

    #[test]
    fn output_drains_at_the_baud_rate_on_the_clock() {
        let mut system = System::new();

        system.comm_set_queues(1, 256, 256);
        assert_eq!(system.comm_initialise(&com2_at(110)), 0);
        assert_ne!(system.comm_set_event_mask(1, EV_TXEMPTY), 0);
        assert_eq!(system.comm_write_string(1, b"hello"), 5);
        // **Recorded**: four of five bytes queued just after the write.
        assert_eq!(system.comm_status(1), (0, Some([0, 0, 0, 4, 0])));

        // A byte goes about every 91 ms at 110 baud.
        later(&mut system, 50.0);
        assert_eq!(system.comm_status(1), (0, Some([0, 0, 0, 4, 0])));
        later(&mut system, 50.0);
        assert_eq!(system.comm_status(1), (0, Some([0, 0, 0, 3, 0])));

        for _ in 0..4 {
            later(&mut system, 100.0);
        }

        // **Recorded**: none a second on, and the queue's emptying an event.
        assert_eq!(system.comm_status(1), (0, Some([0, 0, 0, 0, 0])));
        assert_eq!(system.comm_take_events(1, 0xffff), EV_TXEMPTY);
        assert_eq!(system.comm_take_events(1, 0xffff), 0);
    }

    #[test]
    fn a_flow_flag_on_a_low_line_holds_output() {
        let mut system = System::new();

        system.comm_set_queues(1, 256, 256);
        assert_eq!(system.comm_initialise(&com2_at(9600)), 0);

        // **Recorded**: CTS flow, 09h, with nothing connected.
        let mut dcb = com2_at(9600);

        dcb[12] = 0x09;
        assert_eq!(system.comm_set_state(&dcb), 0);
        assert_eq!(system.comm_write_string(1, b"a"), 1);
        assert_eq!(system.comm_status(1), (0, Some([0x01, 0, 0, 1, 0])));

        // **Recorded**: a timeout on a low line answers a write with
        // nothing, and its error.
        assert_eq!(system.comm_flush(1, 0), 0);
        dcb = com2_at(9600);
        dcb[8] = 50;
        assert_eq!(system.comm_set_state(&dcb), 0);
        assert_eq!(system.comm_write_string(1, b"a"), 0);
        assert_eq!(system.comm_status(1).0, CE_CTSTO);
    }

    #[test]
    fn an_address_and_interrupt_read_with_a_minus_are_kept_signed() {
        let mut system = System::new();

        system.profiles.insert(
            b"SYSTEM.INI".to_vec(),
            crate::profile::Profile::new(b"[386Enh]\r\nCOM4Base=-3F8\r\nCOM4Irq=-2\r\n"),
        );
        // `((irq << 16) | base) >>> 0`: the base's minus fills the high
        // word too.
        assert_eq!(system.comm_escape(3, 10), 0xffff_fc08);
        system.comm.com[3].base = 0x2e8;
        assert_eq!(system.comm_escape(3, 11), 0xfffe_02e8);
        // COM1 from the BIOS, its interrupt by default.
        assert_eq!(system.comm_escape(0, 10), 0x0004_03f8);
    }

    #[test]
    fn a_parallel_port_with_no_printer_takes_nothing() {
        let mut system = System::new();
        let mut dcb = [0u8; DCB_SIZE];

        dcb[0] = 0x80;
        assert_eq!(system.comm_initialise(&dcb), 0);
        assert_eq!(system.comm_write_string(0x80, b"hello"), 0);
        // **Recorded**: 0C00h, and nothing queued.
        assert_eq!(system.comm_status(0x80), (0x0c00, Some([0; 5])));
        dcb[0] = 0x81;
        assert_eq!(system.comm_initialise(&dcb), -10);
    }
}
