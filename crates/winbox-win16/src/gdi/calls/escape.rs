//! A device's own function, by number, through its driver: `Escape`.
//! **Recorded** by `escapes` on four displays:
//!
//! * `QUERYESCSUPPORT` (8) answers what the driver says for the escape
//!   named by the word at `lpInData`: on the colour displays 1 for 5
//!   (`GETCOLORTABLE`) and 8, and -7 for `MOUSETRAILS` (39); on the
//!   Hercules, 1 for 5 and 8, and nought for the rest.
//! * `MOUSETRAILS` answers 7 on the colour displays, nought on the
//!   Hercules, and writes nothing.
//! * An escape the driver has not answers nought.
//! * A memory device context's driver is GDI's own for bitmaps, and
//!   answers nought to everything, `QUERYESCSUPPORT` too.
//!
//! **Read out** of GDI (`GDI.EXE` seg7 `0042`-`0526`): on a screen's
//! context every escape goes to the driver's `Control`, whose answer is the
//! answer -- but for 0Fh, which GDI answers nought, and 100h to `BFFh`,
//! which GDI keeps for itself: it calls the driver for those only where a
//! flag of the context's is set (byte 0Bh, bit 2, seg7 `04be`), and they
//! answer nought here as before. So an escape a driver has not got answers what its `Control`
//! does for one: nought on every driver but `8514.DRV`'s, which answers the
//! escape's own number (seg1 `1b28`-`1b35`; `control_answers_number`),
//! `MOUSETRAILS` among them.
//!
//! Not followed: what `GETCOLORTABLE` answers. A printer's device context
//! takes its own escapes (`gdi/printing.rs`), which answer the call before
//! the display's driver is asked.

use crate::handles::Object;
use crate::system::System;

const QUERYESCSUPPORT: i16 = 8;
const MOUSETRAILS: i16 = 39;

/// What the driver answers an escape, by its number, and the far pointer to
/// what it is given.
///
/// A handle that stands for anything but a memory device context is asked
/// of the display's driver, as the TypeScript engine asks: it looks only
/// for a memory context's mark on whatever the handle stands for, and a
/// window has none.
pub fn escape(system: &System, hdc: u16, number: i16, input: u32) -> i16 {
    match system.handles.resolve(hdc) {
        None => return 0,
        Some(Object::Dc(dc)) if system.gdi.dcs[dc].memory => return 0,
        Some(_) => {}
    }

    let escapes = &system.display.escapes;

    match number {
        QUERYESCSUPPORT if input == 0 => 0,
        QUERYESCSUPPORT => {
            let bytes = system.read_far(input, 2);
            let asked = i16::from_le_bytes([bytes[0], bytes[1]]);

            escapes.get(&asked.to_string()).copied().unwrap_or(0)
        }
        MOUSETRAILS
            if escapes
                .get(&MOUSETRAILS.to_string())
                .is_some_and(|&answer| answer != 0) =>
        {
            system.display.mouse_trails
        }
        _ => driver_answer(system, number),
    }
}

/// What GDI passes back of the driver's `Control` for an escape it has not
/// got.
fn driver_answer(system: &System, number: i16) -> i16 {
    let gdis = number == 0x0f || (0x100..=0xbff).contains(&number);

    if gdis
        || !system.display.control_answers_number
        || system.display.escapes.contains_key(&number.to_string())
    {
        return 0;
    }

    number
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system_on(display: &str) -> System {
        let mut system = System::new();

        system.display = crate::display::mode(display).expect("the display");
        system
    }

    #[test]
    fn the_colour_displays_have_mouse_trails_and_the_hercules_not() {
        for (display, trails, query) in [("vga", 7, -7), ("ega", 7, -7), ("hercules", 0, 0)] {
            let mut system = system_on(display);
            let hdc = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").expect("a context");
            let far = system.scratch_word(39);

            assert_eq!(escape(&system, hdc, MOUSETRAILS, 0), trails, "{display}");
            assert_eq!(
                escape(&system, hdc, QUERYESCSUPPORT, far),
                query,
                "{display}"
            );
            assert_eq!(escape(&system, hdc, QUERYESCSUPPORT, 0), 0, "{display}");

            let far = system.scratch_word(5);

            assert_eq!(escape(&system, hdc, QUERYESCSUPPORT, far), 1, "{display}");
            assert_eq!(escape(&system, hdc, 5, 0), 0, "{display}");
        }
    }

    /// `8514.DRV`'s `Control` answers an escape it has not got with its
    /// number, which GDI passes back but for 0Fh and 100h to `BFFh`; the
    /// XGA's answers nought (seg1 `1b28`, `XGA.DRV` seg1 `132c`).
    #[test]
    fn the_8514_answers_an_escape_it_has_not_got_with_its_number() {
        for display in ["8514", "8514s"] {
            let mut system = system_on(display);
            let hdc = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").expect("a context");
            let far = system.scratch_word(MOUSETRAILS);

            assert_eq!(
                escape(&system, hdc, MOUSETRAILS, 0),
                MOUSETRAILS,
                "{display}"
            );
            assert_eq!(escape(&system, hdc, QUERYESCSUPPORT, far), 0, "{display}");
            assert_eq!(escape(&system, hdc, 100, 0), 100, "{display}");
            assert_eq!(escape(&system, hdc, -3, 0), -3, "{display}");
            assert_eq!(escape(&system, hdc, 0x0f, 0), 0, "{display}");
            assert_eq!(escape(&system, hdc, 0x100, 0), 0, "{display}");
            assert_eq!(escape(&system, hdc, 0xc00, 0), 0xc00, "{display}");
            assert_eq!(escape(&system, hdc, 5, 0), 0, "{display}");
        }

        for display in ["xga256", "xga256s", "xga640", "vga", "vga256"] {
            let mut system = system_on(display);
            let hdc = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").expect("a context");

            assert_eq!(escape(&system, hdc, 100, 0), 0, "{display}");
        }
    }

    #[test]
    fn a_memory_context_answers_nought() {
        let mut system = system_on("vga");
        let hdc = crate::gdi::dc::create_compatible_dc(&mut system, 0);
        let far = system.scratch_word(5);

        assert_eq!(escape(&system, hdc, QUERYESCSUPPORT, far), 0);
        assert_eq!(escape(&system, 0x1234, QUERYESCSUPPORT, far), 0);
    }

    impl System {
        /// A word put in a block of global memory: its far pointer.
        fn scratch_word(&mut self, word: i16) -> u32 {
            let index = self
                .global
                .allocate(&mut self.cpu.bus, &mut self.descriptors, 16, 0x42)
                .expect("a block");
            let far = u32::from(winbox_machine::segment_selector(index)) << 16;

            self.write_far(far, &word.to_le_bytes());
            far
        }
    }
}
