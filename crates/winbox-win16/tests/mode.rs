//! A machine's mode, standard or 386 enhanced (`kb/guides/enhanced-mode.md`,
//! phases 1 and 2): what Windows answers by it, as `winflags` and `galimit`
//! recorded it in each mode. INT 2Fh and DPMI's version are held to
//! `dpmiver` in both modes by the replay (`conformance.rs`'s `enhanced/dpmiver`).
//! As `test/win16/mode_test.ts`.

use winbox_machine::Figures;
use winbox_win16::{Mode, System};

#[test]
fn a_machine_is_standard_unless_made_enhanced() {
    assert_eq!(System::new().mode, Mode::Standard);
    assert_eq!(Mode::named("enhanced"), Some(Mode::Enhanced));
    assert_eq!(Mode::named("standard"), Some(Mode::Standard));
    assert_eq!(Mode::named("real"), None);
    assert_eq!(Mode::Enhanced.name(), "enhanced");
}

#[test]
fn get_win_flags_says_the_mode() {
    for (mode, coprocessor, flags) in [
        (Mode::Standard, true, 0x0419),
        (Mode::Enhanced, true, 0x0c29),
        (Mode::Standard, false, 0x0019),
        (Mode::Enhanced, false, 0x0829),
    ] {
        let mut system = System::new();

        system.mode = mode;
        system.coprocessor = coprocessor;
        assert_eq!(system.win_flags(), flags, "{mode:?}");
    }
}

#[test]
fn enhanced_mode_has_more_memory_within_the_limit() {
    let mut system = System::new();

    assert_eq!(system.memory_figures(), Figures::STANDARD);
    system.mode = Mode::Enhanced;

    let figures = system.memory_figures();

    assert_eq!(figures.free, 0x038f_5c60);
    assert!(figures.largest >= 0x00ff_0000);
    assert!(figures.compact >= 0x00ff_0000);
}
