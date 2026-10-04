//! USER's comm functions, which keep a table of the ports open and pass the
//! rest to COMM (`comm.rs`). **Read out** of `USER.EXE` (seg40) and
//! **recorded** by `comms`.
//!
//! * USER keeps 13 ports: COM1 to COM10, ids 0 to 9, and LPT1 to LPT3, ids
//!   80h to 82h. For each, whether it is open, a character put back, and the
//!   task that opened it. `ReadComm`, `UngetCommChar`, `WriteComm` and
//!   `CloseComm` check an id is one of these; the state calls look it up
//!   whatever it is; the rest pass it to COMM, open or not.
//! * An id whose high byte is not nought is refused before anything:
//!   `GetCommError`, `GetCommEventMask` and `EnableCommNotification` answer
//!   nought, `SetCommEventMask` a null pointer, the rest -1.
//!
//! Not followed: closing a task's serial ports when it ends, which USER does
//! -- its parallel ports it never closes; and queues in memory below 1 MB,
//! where USER puts them in standard mode for the driver's interrupts.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::comm::{BAD_ID, DCB_SIZE};
use crate::engine::Engine;
use crate::system::System;

const COM_DEFAULT: &[u8] = b"COM1:9600,E,7,1";

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "OpenComm" => Implementation::Sync(open_comm),
        "CloseComm" => Implementation::Async(close_comm),
        "BuildCommDCB" => Implementation::Sync(build_comm_dcb),
        "SetCommState" => Implementation::Sync(set_comm_state),
        "GetCommState" => Implementation::Sync(get_comm_state),
        "ReadComm" => Implementation::Sync(read_comm),
        "UngetCommChar" => Implementation::Sync(unget_comm_char),
        "WriteComm" => Implementation::Sync(write_comm),
        "GetCommError" => Implementation::Sync(get_comm_error),
        "TransmitCommChar" => Implementation::Sync(transmit_comm_char),
        "SetCommEventMask" => Implementation::Sync(set_comm_event_mask),
        "GetCommEventMask" => Implementation::Sync(get_comm_event_mask),
        "SetCommBreak" => Implementation::Sync(set_comm_break),
        "ClearCommBreak" => Implementation::Sync(clear_comm_break),
        "FlushComm" => Implementation::Sync(flush_comm),
        "EscapeCommFunction" => Implementation::Sync(escape_comm_function),
        "EnableCommNotification" => Implementation::Sync(enable_comm_notification),
        _ => return None,
    })
}

/// A port in USER's table.
#[derive(Debug, Clone, Copy, Default)]
pub struct Slot {
    pub open: bool,
    /// A character put back, if `ungot`.
    pub ungot: bool,
    pub character: u8,
    pub owner: u16,
}

/// USER's table of ports.
#[derive(Debug, Default)]
pub struct Slots(pub [Slot; 13]);

/// An id's place in USER's table, or none past it (seg40 `082b`).
fn slot_index(id: u16) -> Option<usize> {
    let index = if id & 0x80 == 0 {
        usize::from(id)
    } else {
        10 + usize::from(id & 0x7f)
    };

    (index < 13).then_some(index)
}

fn slot_of(system: &mut System, id: u16) -> Option<&mut Slot> {
    slot_index(id).map(|index| &mut system.comm_slots.0[index])
}

/// Whether an id is one USER's table has, as the calls that check it do.
fn in_range(id: u16) -> bool {
    (id & 0x7f) <= if id & 0x80 == 0 { 9 } else { 2 }
}

/// A character upper-cased as USER does, anything 61h to 7Fh (seg40 `09c8`).
fn fold(code: u8) -> u8 {
    if (0x61..=0x7f).contains(&code) {
        code - 0x20
    } else {
        code
    }
}

/// A port's name as its id: `COMn` is n - 1, `LPTn` 80h + n - 1, AUX COM1 and
/// PRN LPT1, each with a colon after it or not, and nothing more; -1 for
/// any other (seg40 `073c`). The digit is not checked: `COM:` is COM10.
pub fn port_named(name: &[u8]) -> i16 {
    let codes: Vec<u8> = name.iter().map(|&code| fold(code)).collect();
    let (text, base, required): (&[u8], i16, bool) = match codes.first() {
        Some(0x43) => (b"COM", 0, true),
        Some(0x4c) => (b"LPT", 0x80, true),
        Some(0x41) => (b"AUX", 0, false),
        Some(0x50) => (b"PRN", 0x80, false),
        _ => return -1,
    };

    if codes.get(1..3) != Some(&text[1..3]) {
        return -1;
    }

    let mut at = 3;
    let index = if !required && matches!(codes.get(at), None | Some(0x3a)) {
        0
    } else {
        let index = i16::from(codes.get(at).copied().unwrap_or(0)) - 0x31;

        at += 1;
        index
    };

    if codes.get(at) == Some(&0x3a) {
        at += 1;
    }

    if codes.get(at).is_some() || index < 0 || index > if base == 0 { 9 } else { 2 } {
        return -1;
    }

    base + index
}

/// The baud rates `BuildCommDCB` knows, by their first two digits (seg40 `048f`).
fn baud_of(digits: &[u8]) -> Option<u16> {
    Some(match digits {
        b"11" => 110,
        b"12" => 1200,
        b"15" => 150,
        b"19" => 19200,
        b"24" => 2400,
        b"30" => 300,
        b"48" => 4800,
        b"60" => 600,
        b"96" => 9600,
        _ => return None,
    })
}

/// The fields of `BuildCommDCB`'s string, read one at a time.
struct Fields<'a> {
    text: &'a [u8],
    at: usize,
    token: Vec<u8>,
}

impl Fields<'_> {
    /// The next field into `token`; false when there was nothing more.
    fn fetch(&mut self) -> bool {
        let text = self.text;

        if self.at >= text.len() {
            return false;
        }

        self.token.clear();

        while self.at < text.len() && !b" :,".contains(&text[self.at]) {
            self.token.push(fold(text[self.at]));
            self.at += 1;
        }

        if self.at >= text.len() {
            return true;
        }

        self.at += 1;

        while text.get(self.at) == Some(&b' ') {
            self.at += 1;
        }

        self.at < text.len()
    }

    fn first(&self) -> Option<u8> {
        self.token.first().copied()
    }
}

/// `BuildCommDCB`'s reading of a string: nought and the DCB, or -1 and the
/// DCB as far as it got (seg40 `048f`, `06b8`).
///
/// The fields are split at a space, a colon or a comma, spaces after it
/// skipped. A field is used only if there is more after it, but for the
/// baud rate's: so a field with a separator and nothing after it is dropped,
/// and the baud rate, when it is missing, is read from the name.
pub fn build_dcb(text: &[u8]) -> (i16, [u8; DCB_SIZE]) {
    let mut dcb = [0u8; DCB_SIZE];
    let mut fields = Fields {
        text,
        at: 0,
        token: Vec::new(),
    };

    fields.fetch();

    let id = port_named(&fields.token);

    if id < 0 {
        return (-1, dcb);
    }

    dcb[0] = id as u8;

    if id & 0x80 != 0 {
        return (0, dcb);
    }

    let more = fields.fetch();
    let baud = fields.token.get(..2).and_then(baud_of);
    let Some(baud) = baud else {
        return (-1, dcb);
    };

    dcb[1..3].copy_from_slice(&baud.to_le_bytes());
    dcb[16..18].copy_from_slice(&10u16.to_le_bytes());
    dcb[18..20].copy_from_slice(&10u16.to_le_bytes());
    dcb[12] = 0x01;
    dcb[14] = 0x11;
    dcb[15] = 0x13;

    if !more || !fields.fetch() {
        return (0, dcb);
    }

    dcb[4] = match fields.first() {
        None | Some(b'E') => 2,
        Some(b'M') => 3,
        Some(b'N') => 0,
        Some(b'O') => 1,
        Some(b'S') => 4,
        _ => return (-1, dcb),
    };

    if !fields.fetch() {
        return (0, dcb);
    }

    dcb[3] = match fields.first() {
        None | Some(b'7') => 7,
        Some(b'8') => 8,
        _ => return (-1, dcb),
    };

    if !fields.fetch() {
        return (0, dcb);
    }

    dcb[5] = match fields.first() {
        None if baud == 110 => 2,
        None | Some(b'1') => 0,
        Some(b'2') => 2,
        _ => return (-1, dcb),
    };

    if !fields.fetch() {
        return (0, dcb);
    }

    if fields.first() != Some(b'P') {
        return (-1, dcb);
    }

    dcb[6..12].fill(0xff);
    (0, dcb)
}

/// A string argument as the TypeScript engine reads one, a null pointer
/// read as nothing.
fn text_argument(system: &System, far: u32) -> Vec<u8> {
    crate::drivers::lpcstr(system, far).unwrap_or_default()
}

fn read_dcb(system: &System, far: u32) -> [u8; DCB_SIZE] {
    let mut dcb = [0u8; DCB_SIZE];

    dcb.copy_from_slice(&system.read_far(far, DCB_SIZE));
    dcb
}

/// Whether an id is refused before anything: its high byte not nought.
fn refused(id: u16) -> bool {
    id & 0xff00 != 0
}

fn int(value: i16) -> Result<Answer, Stop> {
    Ok(Answer::Word(value as u16))
}

/// Opens a port by name, with queues of the sizes given; its id, or an
/// error. **Read out** (seg40 `0000`): a serial port opens as
/// `COM1:9600,E,7,1` would make it, since a name it takes is never one
/// `BuildCommDCB` can read -- not as `WIN.INI`'s `[ports]` says. Both queues
/// nought is -4; -1 for no such port, -2 for one open, -10 for one the
/// machine does not have.
fn open_comm(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name_far = args.dword(system);
    let receive_size = args.word(system);
    let transmit_size = args.word(system);
    let name = text_argument(system, name_far);
    let id = port_named(&name);

    if id < 0 {
        return int(-1);
    }

    let id = id as u16;

    if slot_of(system, id).is_some_and(|slot| slot.open) {
        return int(-2);
    }

    let mut dcb = [0u8; DCB_SIZE];

    if id & 0x80 == 0 {
        if receive_size == 0 && transmit_size == 0 {
            return int(-4);
        }

        let built = if name.len() >= 4 {
            build_dcb(&name)
        } else {
            (-1, dcb)
        };

        dcb = if built.0 == 0 {
            built.1
        } else {
            build_dcb(COM_DEFAULT).1
        };
        system.comm_set_queues(id, receive_size, transmit_size);
    }

    dcb[0] = id as u8;

    let answer = system.comm_initialise(&dcb);

    if answer != 0 {
        return int(answer);
    }

    let task = system.task_handle;

    if let Some(slot) = slot_of(system, id) {
        slot.open = true;
        slot.owner = task;
    }

    Ok(Answer::Word(id))
}

/// Closes a port, once what is queued has gone. **Read out** (seg40
/// `03a5`): a character put back is kept, for the port's next open. Nought;
/// -2 when what was queued could not go, the port closed nonetheless; -1
/// for a port not open.
fn close_comm(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let id = {
            let mut system = engine.system();
            let id = args.word(&system);

            if refused(id)
                || !in_range(id)
                || !slot_of(&mut system, id).is_some_and(|slot| slot.open)
            {
                return int(-1);
            }

            id
        };
        let answer = engine.comm_terminate(id).await;

        if answer == i32::from(BAD_ID) {
            return int(-1);
        }

        let mut system = engine.system();

        if let Some(slot) = slot_of(&mut system, id) {
            slot.open = false;
        }

        system.comm_set_queues(id, 0, 0);
        int(answer as i16)
    })
}

/// Makes a string of a port's settings a DCB. **Read out** (seg40
/// `048f`): the baud rate by its first two digits; parity E, M, N, O or S;
/// seven or eight bits; one stop bit or two; and a last field that must be
/// `P`, for timeouts of `FFFFh` -- so `WIN.INI`'s `x` is refused. Nought, or
/// -1.
fn build_comm_dcb(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let text_far = args.dword(system);
    let far = args.dword(system);
    let (answer, dcb) = build_dcb(&text_argument(system, text_far));

    system.write_far(far, &dcb);
    int(answer)
}

/// A port's new settings, the DCB's Id naming it. **Read out** (COMM seg2
/// `07e9`): checked as baud rate, parity, byte size and stop bits, in that
/// order, and nothing is changed if one is wrong. Nought; -3 for a port not
/// open; -12 for the baud rate, -11 the byte size, -5 the parity or stop
/// bits.
fn set_comm_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let dcb = read_dcb(system, far);

    if !slot_of(system, u16::from(dcb[0])).is_some_and(|slot| slot.open) {
        return int(-3);
    }

    int(system.comm_set_state(&dcb))
}

/// A copy of a port's settings: nought, or -3 for a port not open.
fn get_comm_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let far = args.dword(system);

    if refused(id) {
        return int(-1);
    }

    if !slot_of(system, id).is_some_and(|slot| slot.open) {
        return int(-3);
    }

    let Some(dcb) = system.comm_state_of(id) else {
        return int(-1);
    };

    system.write_far(far, &dcb);
    int(0)
}

/// What has been received: how many were read. **Read out** (seg40
/// `01d7`): a character put back comes first, and is not counted; and
/// nothing is read while an error is waiting for `GetCommError`.
fn read_comm(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let mut far = args.dword(system);
    let size = args.word(system);

    if refused(id) {
        return int(-1);
    }

    if size == 0 || !in_range(id) {
        return int(0);
    }

    let Some(slot) = slot_of(system, id) else {
        return int(0);
    };

    if !slot.open {
        return int(0);
    }

    if slot.ungot {
        slot.ungot = false;

        let character = slot.character;

        system.write_far(far, &[character]);
        far = (far & 0xffff_0000) | (far.wrapping_add(1) & 0xffff);
    }

    let bytes = system.comm_read_string(id, size);

    system.write_far(far, &bytes);
    int(bytes.len() as i16)
}

/// A character put back, for the next read: nought, or -1 when one is
/// already back or the port is not open.
fn unget_comm_char(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let character = args.word(system);

    if refused(id) {
        return int(-1);
    }

    if !in_range(id) {
        return int(0);
    }

    let Some(slot) = slot_of(system, id) else {
        return int(0);
    };

    if slot.ungot || !slot.open {
        return int(-1);
    }

    slot.ungot = true;
    slot.character = character as u8;
    int(0)
}

/// Queues bytes to send. **Recorded**: as many as there is room for, and
/// minus that when not all of them; -1 for a port not open.
fn write_comm(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let far = args.dword(system);
    let size = args.word(system);

    if refused(id) {
        return int(-1);
    }

    if !in_range(id) {
        return int(0);
    }

    if !slot_of(system, id).is_some_and(|slot| slot.open) {
        return int(-1);
    }

    let bytes = system.read_far(far, usize::from(size));
    let n = system.comm_write_string(id, &bytes);
    let answer = n as i16;

    int(if n < usize::from(size) {
        answer.wrapping_neg()
    } else {
        answer
    })
}

/// The port's errors since last asked, cleared, and its state in the
/// COMSTAT given, if one is.
fn get_comm_error(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let far = args.dword(system);

    if refused(id) {
        return int(0);
    }

    let (answer, stat) = system.comm_status(id);
    let Some(mut stat) = stat else {
        return Ok(Answer::Word(answer));
    };

    if answer == BAD_ID {
        return Ok(Answer::Word(answer));
    }

    if far != 0 {
        if slot_of(system, id).is_some_and(|slot| slot.ungot) {
            let count = u16::from_le_bytes([stat[1], stat[2]]).wrapping_add(1);

            stat[1..3].copy_from_slice(&count.to_le_bytes());
        }

        system.write_far(far, &stat);
    }

    Ok(Answer::Word(answer))
}

/// A character to send before what is queued: nought, or 4000h when one is
/// already waiting.
fn transmit_comm_char(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let character = args.word(system);

    if refused(id) {
        return int(-1);
    }

    Ok(Answer::Word(system.comm_transmit_character(id, character)))
}

/// The events a port keeps: the port's event word, or null. **Read out**
/// (COMM seg2 `0fbc`): the mask is kept across a close.
fn set_comm_event_mask(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let mask = args.word(system);

    if refused(id) {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(system.comm_set_event_mask(id, mask)))
}

/// A port's events before, those asked for cleared.
fn get_comm_event_mask(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let clear = args.word(system);

    if refused(id) {
        return int(0);
    }

    Ok(Answer::Word(system.comm_take_events(id, clear)))
}

/// A break on the line, holding output: the errors, not cleared.
fn set_comm_break(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);

    if refused(id) {
        return int(-1);
    }

    Ok(Answer::Word(system.comm_set_break(id, true)))
}

/// The break ended: the errors, not cleared.
fn clear_comm_break(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);

    if refused(id) {
        return int(-1);
    }

    Ok(Answer::Word(system.comm_set_break(id, false)))
}

/// Empties a queue, 0 the transmit queue, anything else the receive queue:
/// the errors, not cleared.
fn flush_comm(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let queue = args.word(system);

    if refused(id) {
        return int(-1);
    }

    Ok(Answer::Word(system.comm_flush(id, queue)))
}

/// Something done to a port's lines, or asked of it: the errors, not
/// cleared, or the answer asked for. **Read out** (COMM seg2 `107a`), by
/// the code's low byte: 1 to 6 set XOFF, XON, RTS and DTR or clear them; 7
/// resets a printer, and on a serial port reads the UART as one; 8 answers
/// 82h and 9 answers 3, on a serial port; 10 and 11 answer its interrupt
/// and address.
fn escape_comm_function(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let code = args.word(system);

    if refused(id) {
        return Ok(Answer::Dword(0xffff_ffff));
    }

    Ok(Answer::Dword(system.comm_escape(id, code)))
}

/// Which window hears of a port with `WM_COMMNOTIFY`, and when: received
/// bytes to be told at, and queued bytes to be told under. 1, or nought for
/// no such port or window.
fn enable_comm_notification(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let hwnd = args.word(system);
    let receive_trigger = args.word(system);
    let transmit_trigger = args.word(system);

    if refused(id) {
        return int(0);
    }

    if hwnd != 0
        && crate::window_queries::is_window(system, &mut Args::repeat(hwnd))? == Answer::Word(0)
    {
        return int(0);
    }

    Ok(Answer::Word(system.comm_enable_notification(
        id,
        hwnd,
        receive_trigger,
        transmit_trigger,
    )))
}

#[cfg(test)]
mod tests {
    use std::fmt::Write;

    use super::*;

    /// `BuildCommDCB`'s records in `comms`: the string, the answer, and the
    /// DCB after, which the probe filled with `AAh` first: every byte of it
    /// is written.
    const RECORDED_BUILD: &[(&str, &str)] = &[
        (
            "COM1:9600,n,8,1",
            "0:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,N,8,1,x",
            "-1:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,n,8,1,p",
            "0:008025080000ffffffffffff010011130a000a000000000000",
        ),
        (
            "COM2:1200,e,7,2",
            "0:01b004070202000000000000010011130a000a000000000000",
        ),
        (
            "COM1:96,n,8,1",
            "0:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:19200,o,7,1.5",
            "0:00004b070100000000000000010011130a000a000000000000",
        ),
        (
            "COM1:110,m,5,1",
            "-1:006e00000300000000000000010011130a000a000000000000",
        ),
        (
            "COM1:300,s,6,2",
            "-1:002c01000400000000000000010011130a000a000000000000",
        ),
        (
            "COM1: 9600, n, 8, 1",
            "0:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600",
            "0:008025000000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,n",
            "0:008025000000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,n,8",
            "0:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
        (
            "COM1:",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
        (
            "COM3:2400,n,8,1",
            "0:026009080000000000000000010011130a000a000000000000",
        ),
        (
            "LPT1:9600,n,8,1",
            "0:80000000000000000000000000000000000000000000000000",
        ),
        (
            "COM1:12345,n,8,1",
            "0:00b004080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,q,8,1",
            "-1:008025000000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,n,9,1",
            "-1:008025000000000000000000010011130a000a000000000000",
        ),
        (
            "COM1:9600,n,8,3",
            "-1:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "9600,n,8,1",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
        (
            "com1:9600,n,8,1",
            "0:008025080000000000000000010011130a000a000000000000",
        ),
        (
            "COM1=9600,n,8,1",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
        (
            "COM1:14400,n,8,1",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
        (
            "COM1:57600,n,8,1",
            "-1:00000000000000000000000000000000000000000000000000",
        ),
    ];

    #[test]
    fn build_comm_dcb_reads_as_recorded() {
        for &(text, expected) in RECORDED_BUILD {
            let (answer, dcb) = build_dcb(text.as_bytes());
            let hex = dcb.iter().fold(String::new(), |mut hex, byte| {
                write!(hex, "{byte:02x}").unwrap();
                hex
            });

            assert_eq!(format!("{answer}:{hex}"), expected, "{text}");
        }
    }

    #[test]
    fn port_names_are_read_as_recorded() {
        for (name, id) in [
            ("COM1", 0),
            ("com1", 0),
            ("COM1:", 0),
            ("COM1 ", -1),
            ("COM1:9600", -1),
            ("COM2", 1),
            ("COM5", 4),
            ("COM9", 8),
            ("COM10", -1),
            ("COM0", -1),
            ("COM", -1),
            ("COM:", 9),
            ("AUX", 0),
            ("AUX:", 0),
            ("LPT1", 0x80),
            ("lpt1:", 0x80),
            ("LPT3", 0x82),
            ("LPT4", -1),
            ("PRN", 0x80),
            ("XYZ", -1),
            ("", -1),
        ] {
            assert_eq!(port_named(name.as_bytes()), id, "{name}");
        }
    }

    #[test]
    fn the_table_has_ten_serial_ports_and_three_parallel() {
        assert_eq!(slot_index(9), Some(9));
        assert_eq!(slot_index(0x82), Some(12));
        assert_eq!(slot_index(0x83), None);
        assert_eq!(slot_index(99), None);
        assert!(in_range(9) && !in_range(10));
        assert!(in_range(0x82) && !in_range(0x83));
    }
}
