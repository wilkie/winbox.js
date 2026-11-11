//! The instructions Windows runs for a call, as recordings at a fixed rate
//! have them: what a virtual clock charges a call when it charges calls as
//! recorded (`Clock::measured_calls`) rather than the survey's 15. The same
//! instructions whatever the clock's rate, as a slower processor takes
//! longer over the same code. See `kb/topics/timing.md`.
//!
//! Two sources:
//!
//! * `callcost`, `twrcost` and `twrcall`, timed with `GetTickCount` over
//!   batches of a hundred calls on DOSBox at a fixed 80,000 cycles a
//!   millisecond, each the middle of three runs: USER's and KERNEL's calls
//!   that do not draw, and the VGA's drawing. A call recorded only in a
//!   pair with another is charged half the pair [[inferred]].
//! * `adlibgap`, each part of `adlibout`'s steps between two reads of the
//!   OPL's status port, timed to the microsecond by DOSBox's traced build
//!   at a fixed 3,000 cycles a millisecond (`oracle/fixtures/opl/
//!   adlibgap-trace.json`): the time read, the records formatted, written
//!   and flushed. Each the part's time less the probe's own instructions
//!   in it, which WinBox runs itself, the middle of ten.
//! * `hdtime` and `cdread`, a file's reads and writes timed with
//!   `timeGetTime` over half a second or a second of them at a fixed
//!   80,000 a millisecond, in both modes: charged by their bytes, on that
//!   clock alone (`faithful`).
//!
//! A call recorded on neither: the middle of the 37 recorded alone, 154
//! [[inferred]]. The Super VGA's drawing and WinG are not here: only the
//! VGA's recordings are run on this clock.

use winbox_machine::FAITHFUL_INSTRUCTIONS_PER_MS;

use crate::system::System;

/// A call recorded on neither display: the middle of the 37 recorded
/// alone [[inferred]].
pub const UNRECORDED: f64 = 154.0;

/// USER's and KERNEL's calls that do not draw (`callcost`, `twrcost`,
/// `twrcall`, on the Super VGA), and those `adlibgap` timed.
const SYSTEM: &[(&str, &str, f64)] = &[
    ("USER", "GetTickCount", 11.0),
    ("USER", "SendMessage", 206.0),
    // Half of PostMessage and GetMessage.
    ("USER", "PostMessage", 243.0),
    ("USER", "GetMessage", 243.0),
    ("USER", "SetRect", 28.0),
    ("USER", "OffsetRect", 21.0),
    ("USER", "IntersectRect", 44.0),
    ("USER", "PtInRect", 34.0),
    ("USER", "EqualRect", 28.0),
    ("USER", "IsRectEmpty", 23.0),
    ("USER", "GetWindowRect", 46.0),
    ("USER", "GetClientRect", 47.0),
    ("USER", "IsIconic", 18.0),
    ("USER", "GetCursorPos", 41.0),
    ("USER", "ScreenToClient", 24.0),
    ("USER", "GetActiveWindow", 8.0),
    ("USER", "SetWindowPos", 1076.0),
    // LoadCursor and SetCursor, less SetCursor alone.
    ("USER", "LoadCursor", 776.0),
    ("USER", "SetCursor", 40.0),
    ("USER", "DefWindowProc", 173.0),
    ("USER", "DispatchMessage", 385.0),
    ("USER", "TranslateMessage", 187.0),
    ("USER", "TranslateAccelerator", 240.0),
    // Half of GetDC and ReleaseDC.
    ("USER", "GetDC", 445.0),
    ("USER", "ReleaseDC", 445.0),
    // Half of GlobalLock and GlobalUnlock.
    ("KERNEL", "GlobalLock", 43.0),
    ("KERNEL", "GlobalUnlock", 43.0),
    ("KERNEL", "GlobalHandle", 61.0),
    // Half of GlobalAlloc and GlobalFree.
    ("KERNEL", "GlobalAlloc", 478.0),
    ("KERNEL", "GlobalFree", 478.0),
    ("KERNEL", "FindResource", 154.0),
    // Half of LoadResource and FreeResource.
    ("KERNEL", "LoadResource", 106.0),
    ("KERNEL", "FreeResource", 106.0),
    // Half of LockResource and GlobalUnlock.
    ("KERNEL", "LockResource", 77.0),
    // `adlibgap`.
    ("MMSYSTEM", "timeGetTime", 212.0),
    ("KERNEL", "_lclose", 486.0),
    ("KERNEL", "_lopen", 1113.0),
    ("KERNEL", "_llseek", 490.0),
    ("MMSYSTEM", "midiOutPrepareHeader", 1566.0),
    ("MMSYSTEM", "midiOutUnprepareHeader", 1572.0),
    // A message's time, through MMSYSTEM to the driver and back, is the
    // driver's: WinBox's synthesizer and mapper charge it as they take the
    // message (`wbsound::synth::costs`, `wbmapper`), whatever the clock.
    ("MMSYSTEM", "midiOutShortMsg", 15.0),
    ("MMSYSTEM", "midiOutLongMsg", 15.0),
    ("MMSYSTEM", "midiOutReset", 15.0),
];

/// Drawing on the VGA (`callcost`).
const VGA: &[(&str, &str, f64)] = &[
    ("GDI", "SetPixel", 886.0),
    ("GDI", "BitBlt", 21700.0),
    ("GDI", "TextOut", 4447.0),
];

/// `PeekMessage` finding nothing on the VGA, with `PM_NOYIELD` and
/// without (`callcost`).
const PEEK: [f64; 2] = [122.0, 207.0];

const PM_NOYIELD: u16 = 0x0002;

/// `_lwrite`: so many instructions, and so many more a byte written
/// (`adlibgap`: 18 bytes 652, 40 bytes 737).
const LWRITE: (f64, f64) = (582.5, 3.86);

/// `wsprintf` (`adlibgap`, five formats and lengths): so many
/// instructions, so many more for each conversion, for each digit of a
/// number and for each character of a string. "%lu" of 0 took 275, of
/// 32153 357, "%u" of 0 274; "%d,%s" of 1 and "on,643c90" 537, of 123 and
/// "off-by-velocity,003e90" 757. Four figures fitted to five, each within
/// 2 [[inferred]].
const WSPRINTF: [f64; 4] = [117.0, 138.0, 20.5, 13.8];

/// A read from a file on a CD-ROM drive in 386 enhanced mode: so many
/// instructions, and so many more a byte, than the same read from the hard
/// disk (`cdread`, at a fixed 80,000 a millisecond: `mmioRead` of 2, 16, 32
/// and 64 KiB one after another for a second on each drive, the
/// difference between the drives at each size, at the rate the run
/// measured -- 7,405, 33,777, 52,220 and 105,520 -- fitted, each within
/// 3,500 [[inferred]]). In standard mode the two drives take the same.
const DISC_READ: (f64, f64) = (5459.0, 1.517);

/// A read of `bytes` from a file on a disc, charged as recorded where
/// calls are: what Windows in 386 enhanced mode spends on a disc's read
/// beyond the hard disk's, which a program that times its reads sees
/// (`cdread`). Nothing in standard mode, nor from any other drive.
pub fn disc_read(system: &mut System, disc: bool, bytes: usize) {
    if disc && system.clock.measured_calls && system.mode == crate::system::Mode::Enhanced {
        system.clock.charge(
            DISC_READ.0 + DISC_READ.1 * f64::from(u32::try_from(bytes).unwrap_or(u32::MAX)),
        );
    }
}

/// Whether the clock is the faithful one: calls charged as recorded, at
/// the recorder's fixed 80,000 a millisecond, where `hdtime`'s times hold.
/// A file's reads and writes are charged by `file_read`, `huge_read` and
/// `file_write` there, and as any other call on any other clock.
pub fn faithful(system: &System) -> bool {
    system.clock.measured_calls && system.clock.rate() == Some(FAITHFUL_INSTRUCTIONS_PER_MS)
}

/// The instructions DOSBox charges a read or write of DOS's of so many
/// bytes, as measured, at 80,000 a millisecond. [[read out]] Its function
/// 3Fh and 40h take 4 cycles a byte from the processor, but no more than
/// are left before its next event (`dos.cpp` `modify_cycles`, from
/// `DATA_TRANSFERS_TAKE_CYCLES`; `pic.cpp` `PIC_RunQueue`): the
/// millisecond's end, or sooner, a timer's or the display's. So 4 a byte
/// up to 1 KiB, and past 24 KiB some 55,000 whatever the size. Between,
/// [[measured]] by `hdtime`: DOS's read in standard mode at each size, less
/// Windows' own 728 (its time at 512 bytes and 1 KiB less 4 a byte), one
/// read after another; taken in a line between two sizes.
const TRANSFER: [(u32, f64); 10] = [
    (512, 2051.0),
    (1024, 4102.0),
    (2048, 7619.0),
    (4096, 14177.0),
    (8192, 24008.0),
    (16384, 35540.0),
    (24576, 54917.0),
    (32768, 55074.0),
    (49152, 54838.0),
    (65534, 55233.0),
];

/// DOSBox's charge for a transfer of `bytes`: 4 a byte under 512, then
/// `TRANSFER` in a line between its sizes.
fn transfer(bytes: u32) -> f64 {
    if bytes < TRANSFER[0].0 {
        return 4.0 * f64::from(bytes);
    }

    TRANSFER.windows(2).find(|pair| bytes <= pair[1].0).map_or(
        TRANSFER[TRANSFER.len() - 1].1,
        |pair| {
            let ((low, at_low), (high, at_high)) = (pair[0], pair[1]);

            at_low + (at_high - at_low) * f64::from(bytes - low) / f64::from(high - low)
        },
    )
}

/// Windows' own instructions for a read of DOS's in standard mode, beyond
/// DOSBox's charge for its bytes (`hdtime`: `_lread`, `_hread` and DOS's
/// 3Fh alike, 512 bytes and 1 KiB less 4 a byte, the middle 728).
const READ_STANDARD: f64 = 728.0;

/// A read of DOS's in 386 enhanced mode: so many instructions, and so many
/// more a byte (`hdtime`: the three ways at ten sizes fitted, each within
/// 130 [[inferred]]). DOSBox's charge for the bytes is not seen there: why
/// is not read out.
const READ_ENHANCED: (f64, f64) = (1116.0, 0.0657);

/// Windows' own instructions for a write of DOS's, beyond DOSBox's charge
/// for its bytes, in standard mode and in 386 enhanced mode (`hdtime`:
/// `_lwrite` and DOS's 40h of 512 bytes less 4 a byte).
const WRITE: [f64; 2] = [653.0, 941.0];

/// `_llseek` in standard mode and in 386 enhanced mode (`hdtime`).
const LLSEEK: [f64; 2] = [573.0, 496.0];

fn enhanced(system: &System) -> bool {
    system.mode == crate::system::Mode::Enhanced
}

/// One read of DOS's of `bytes`, from a file on any drive, on the faithful
/// clock: Windows' own time and DOSBox's for the bytes. A disc's read in
/// standard mode takes what the hard disk's does (`cdread`); in 386
/// enhanced mode `disc_read` charges what it takes beyond.
fn read_cost(system: &System, bytes: u32) -> f64 {
    if enhanced(system) {
        READ_ENHANCED.0 + READ_ENHANCED.1 * f64::from(bytes)
    } else {
        READ_STANDARD + transfer(bytes)
    }
}

fn write_cost(system: &System, bytes: u32) -> f64 {
    WRITE[usize::from(enhanced(system))] + transfer(bytes)
}

fn bytes_of(bytes: usize) -> u32 {
    u32::try_from(bytes).unwrap_or(u32::MAX)
}

/// A read of DOS's of `bytes` -- `_lread`'s, or DOS's 3Fh a program asks
/// for -- charged on the faithful clock.
pub fn file_read(system: &mut System, bytes: usize) {
    if faithful(system) {
        let cost = read_cost(system, bytes_of(bytes));

        system.clock.charge(cost);
    }
}

/// A write of DOS's of `bytes`, charged on the faithful clock.
pub fn file_write(system: &mut System, bytes: usize) {
    if faithful(system) {
        let cost = write_cost(system, bytes_of(bytes));

        system.clock.charge(cost);
    }
}

/// The reads or writes of DOS's that `_hread` and `_hwrite` make of
/// `asked` bytes at the buffer's `offset`, `done` of them made: [[read
/// out]] `KRNL286.EXE` seg1 `468c` and `KRNL386.EXE` seg1 `4dec`, each
/// piece 8000h bytes, or to the segment's end where the offset is past
/// 8000h, and no more than are left, until one makes fewer than it asked
/// or none are left. Nought bytes asked is one piece of nought.
pub fn pieces(offset: u16, asked: u32, done: u32) -> Vec<u32> {
    let mut pieces = Vec::new();
    let mut offset = u32::from(offset);
    let mut left = asked;
    let mut have = done;

    loop {
        let piece = if offset <= 0x8000 {
            0x8000
        } else {
            0x1_0000 - offset
        }
        .min(left);
        let made = piece.min(have);

        pieces.push(made);

        if made != piece || left == piece {
            return pieces;
        }

        left -= piece;
        have -= made;
        offset = (offset + piece) & 0xffff;
    }
}

/// `_hread`'s or `_hwrite`'s pieces charged on the faithful clock, as
/// [`pieces`] makes them.
pub fn huge_transfer(system: &mut System, write: bool, offset: u16, asked: u32, done: usize) {
    if faithful(system) {
        let cost = pieces(offset, asked, bytes_of(done))
            .into_iter()
            .map(|piece| {
                if write {
                    write_cost(system, piece)
                } else {
                    read_cost(system, piece)
                }
            })
            .sum();

        system.clock.charge(cost);
    }
}

/// The instructions Windows runs for a call as it is made, its arguments
/// on the stack at `stack` (the caller's return address first).
pub fn before(system: &System, module: &str, name: &str, stack: u32) -> f64 {
    match (module, name) {
        // Charged as their reads and writes are made, by their bytes.
        ("KERNEL", "_lread" | "_HREAD" | "_lwrite" | "_HWRITE") if faithful(system) => 0.0,
        ("KERNEL", "_llseek") if faithful(system) => LLSEEK[usize::from(enhanced(system))],
        ("USER", "PeekMessage") => {
            let flags = system.cpu.bus.read16(stack + 4);

            PEEK[usize::from(flags & PM_NOYIELD == 0)]
        }
        ("KERNEL", "_lwrite") => {
            let count = system.cpu.bus.read16(stack + 4);

            LWRITE.0 + LWRITE.1 * f64::from(count)
        }
        ("USER", "_WSPRINTF") => wsprintf(system, stack),
        _ => VGA
            .iter()
            .chain(SYSTEM)
            .find(|&&(each, call, _)| each == module && call == name)
            .map_or(UNRECORDED, |&(_, _, instructions)| instructions),
    }
}

/// `wsprintf`'s instructions: its format read, and its arguments, from the
/// stack (C's order: the output, the format, then each argument) -- each
/// conversion, each digit of a number, each character of a string.
// A format's lengths are far under 2^52.
#[allow(clippy::cast_precision_loss)]
fn wsprintf(system: &System, stack: u32) -> f64 {
    let bus = &system.cpu.bus;
    let far = |at: u32| u32::from(bus.read16(at)) | u32::from(bus.read16(at + 2)) << 16;
    let format = system.read_string(far(stack + 8));
    let mut argument = stack + 12;
    let [base, conversion, digit, character] = WSPRINTF;
    let mut cost = base;
    let mut at = 0;

    while at < format.len() {
        if format[at] != b'%' {
            at += 1;
            continue;
        }

        at += 1;

        while at < format.len() && b"-#0123456789.".contains(&format[at]) {
            at += 1;
        }

        let long = format
            .get(at)
            .is_some_and(|&byte| byte == b'l' || byte == b'L');

        if long {
            at += 1;
        }

        let Some(&kind) = format.get(at) else { break };

        at += 1;

        let value = if long {
            far(argument)
        } else {
            u32::from(bus.read16(argument))
        };

        match kind {
            b'd' | b'i' | b'u' | b'x' | b'X' => {
                let shown = match kind {
                    b'x' | b'X' => format!("{value:x}"),
                    b'u' => value.to_string(),
                    _ if long => (value as i32).to_string(),
                    _ => (value as u16 as i16).to_string(),
                };

                cost += conversion + digit * shown.len() as f64;
                argument += if long { 4 } else { 2 };
            }
            b's' => {
                cost += conversion + character * system.read_string(far(argument)).len() as f64;
                argument += 4;
            }
            b'c' => {
                cost += conversion + character;
                argument += 2;
            }
            _ => {}
        }
    }

    cost
}

#[cfg(test)]
mod tests {
    use winbox_machine::{Clock, FAITHFUL_INSTRUCTIONS_PER_MS};

    use super::{
        DISC_READ, LLSEEK, READ_ENHANCED, READ_STANDARD, TRANSFER, UNRECORDED, WRITE, before,
        disc_read, file_read, file_write, huge_transfer, pieces, transfer,
    };
    use crate::system::{Mode, System};

    /// A disc's read of 64 KiB costs what `cdread` measured beyond the hard
    /// disk's in 386 enhanced mode, where calls are charged as recorded;
    /// nothing in standard mode, from another drive, or on the survey's
    /// clock.
    #[test]
    fn a_disc_read_is_charged_in_enhanced_mode() {
        let charged = |mode, measured, disc| {
            let mut system = System::new();

            system.mode = mode;
            system.clock = Clock::virtual_at(FAITHFUL_INSTRUCTIONS_PER_MS);
            system.clock.measured_calls = measured;
            disc_read(&mut system, disc, 65535);
            system.clock.charged()
        };

        assert!(
            (charged(Mode::Enhanced, true, true) - (DISC_READ.0 + DISC_READ.1 * 65535.0)).abs()
                < 1e-6
        );
        assert!(charged(Mode::Enhanced, true, false) == 0.0);
        assert!(charged(Mode::Standard, true, true) == 0.0);
        assert!(charged(Mode::Enhanced, false, true) == 0.0);
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    /// What `charge` costs a system in `mode` on a clock at `rate`, calls
    /// charged as recorded or not.
    fn charged(mode: Mode, rate: f64, measured: bool, charge: impl FnOnce(&mut System)) -> f64 {
        let mut system = System::new();

        system.mode = mode;
        system.clock = Clock::virtual_at(rate);
        system.clock.measured_calls = measured;
        charge(&mut system);
        system.clock.charged()
    }

    /// DOSBox's charge for a transfer: 4 a byte under 512, each size
    /// `hdtime` measured as measured, and in a line between.
    #[test]
    fn a_transfer_is_four_a_byte_then_as_measured() {
        assert!(close(transfer(0), 0.0));
        assert!(close(transfer(400), 1600.0));
        assert!(close(transfer(768), (2051.0 + 4102.0) / 2.0));

        for (bytes, instructions) in TRANSFER {
            assert!(close(transfer(bytes), instructions));
        }

        assert!(close(transfer(20480), (35540.0 + 54917.0) / 2.0));
        assert!(close(transfer(65535), 55233.0));
    }

    /// `_hread`'s pieces, as `KRNL386.EXE` seg1 `4dec` makes them: 8000h
    /// at a time, or to the segment's end; stopped at a short one.
    #[test]
    fn a_huge_read_is_made_in_pieces_of_32_kib() {
        assert_eq!(pieces(0, 49152, 49152), [32768, 16384]);
        assert_eq!(pieces(0, 65534, 65534), [32768, 32766]);
        assert_eq!(pieces(0, 2048, 2048), [2048]);
        assert_eq!(pieces(0x9000, 0x10000, 0x10000), [0x7000, 0x8000, 0x1000]);
        assert_eq!(pieces(0x8000, 0x10000, 0x10000), [0x8000, 0x8000]);
        assert_eq!(pieces(0, 65534, 40000), [32768, 7232]);
        assert_eq!(pieces(0, 65534, 32768), [32768, 0]);
        assert_eq!(pieces(0, 0, 0), [0]);
    }

    /// A read from the hard disk on the faithful clock costs Windows' own
    /// time and DOSBox's for its bytes in standard mode, and the fit in
    /// 386 enhanced mode; `_hread` each of its pieces. Nothing on the
    /// survey's clock, nor at the sound card's 3,000 a millisecond, where
    /// calls are charged as recorded too.
    #[test]
    fn a_read_is_charged_on_the_faithful_clock() {
        let faithful = FAITHFUL_INSTRUCTIONS_PER_MS;
        let read = |mode, bytes| charged(mode, faithful, true, |s| file_read(s, bytes));
        let huge = |mode, bytes| {
            charged(mode, faithful, true, |s| {
                huge_transfer(s, false, 0, bytes, bytes as usize);
            })
        };

        assert!(close(read(Mode::Standard, 2048), READ_STANDARD + 7619.0));
        assert!(close(read(Mode::Standard, 65534), READ_STANDARD + 55233.0));
        assert!(close(
            read(Mode::Enhanced, 2048),
            READ_ENHANCED.0 + READ_ENHANCED.1 * 2048.0
        ));
        assert!(close(
            huge(Mode::Standard, 49152),
            2.0 * READ_STANDARD + 55074.0 + 35540.0
        ));
        assert!(close(
            huge(Mode::Enhanced, 65534),
            2.0 * READ_ENHANCED.0 + READ_ENHANCED.1 * 65534.0
        ));
        assert!(charged(Mode::Standard, faithful, false, |s| file_read(s, 2048)) == 0.0);
        assert!(charged(Mode::Standard, 3000.0, true, |s| file_read(s, 2048)) == 0.0);
    }

    /// A write costs Windows' own time for it in its mode and DOSBox's for
    /// its bytes, on the faithful clock only.
    #[test]
    fn a_write_is_charged_on_the_faithful_clock() {
        let faithful = FAITHFUL_INSTRUCTIONS_PER_MS;

        assert!(close(
            charged(Mode::Standard, faithful, true, |s| file_write(s, 512)),
            WRITE[0] + 2051.0
        ));
        assert!(close(
            charged(Mode::Enhanced, faithful, true, |s| file_write(s, 8192)),
            WRITE[1] + 24008.0
        ));
        assert!(close(
            charged(Mode::Enhanced, faithful, true, |s| {
                huge_transfer(s, true, 0, 65534, 65534);
            }),
            2.0 * WRITE[1] + transfer(32768) + transfer(32766)
        ));
        assert!(charged(Mode::Standard, 3000.0, true, |s| file_write(s, 512)) == 0.0);
    }

    /// On the faithful clock a read or write is charged by its bytes, not
    /// as the call is made, and `_llseek` as `hdtime` timed it; at the
    /// sound card's rate as before.
    #[test]
    fn the_file_calls_cost_by_clock() {
        let mut system = System::new();

        system.clock = Clock::virtual_at(FAITHFUL_INSTRUCTIONS_PER_MS);
        system.clock.measured_calls = true;

        for name in ["_lread", "_HREAD", "_lwrite", "_HWRITE"] {
            assert!(before(&system, "KERNEL", name, 0) == 0.0);
        }

        assert!(close(before(&system, "KERNEL", "_llseek", 0), LLSEEK[0]));
        system.mode = Mode::Enhanced;
        assert!(close(before(&system, "KERNEL", "_llseek", 0), LLSEEK[1]));
        system.clock = Clock::virtual_at(3000.0);
        system.clock.measured_calls = true;
        assert!(close(before(&system, "KERNEL", "_lread", 0), UNRECORDED));
        assert!(close(before(&system, "KERNEL", "_llseek", 0), 490.0));
    }
}
