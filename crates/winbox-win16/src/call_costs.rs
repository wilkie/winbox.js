//! The instructions Windows runs for a call, as recordings at a fixed rate
//! have them: what a virtual clock charges a call when it charges calls as
//! recorded (`Clock::measured_calls`) rather than the survey's 15. The same
//! instructions whatever the clock's rate, as a slower processor takes
//! longer over the same code. WinBox's TypeScript engine has the same
//! table (`src/win16/call-costs.ts`); see `kb/topics/timing.md`.
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
//!
//! A call recorded on neither: the middle of the 37 recorded alone, 154
//! [[inferred]]. The Super VGA's drawing and WinG are not here: only the
//! VGA's recordings are run on this clock.

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

/// The instructions Windows runs for a call as it is made, its arguments
/// on the stack at `stack` (the caller's return address first).
pub fn before(system: &System, module: &str, name: &str, stack: u32) -> f64 {
    match (module, name) {
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
