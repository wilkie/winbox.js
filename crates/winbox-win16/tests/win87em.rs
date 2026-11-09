//! WIN87EM and the OS fixups: a program's floating-point instructions made
//! the emulator's or left the coprocessor's as they are linked, and the
//! emulator carrying them out. `__FPMATH`'s cases are `win87em.rs`'s own tests.
//!
//! An OS fixup is added where it is, a word at its offset and one at the
//! byte after (`linker.rs`'s `os_fixup`): without a coprocessor the `FWAIT`
//! and the escape become `INT 34h` to `INT 3Dh`, which WIN87EM's emulator
//! answers; with one, the `FWAIT` a `NOP`, but a lone `FWAIT` (fixup 6)
//! `INT 3Dh` still.

use winbox_cpu::ES;
use winbox_machine::segment_selector;
use winbox_ne::Executable;
use winbox_win16::{Engine, System};

/// A program of two segments, as `first_call.rs` makes one: code of its
/// own, 30h bytes at most, at 100h, with one relocation record where one is
/// given; and 16 bytes of data.
fn program(code: &[u8], relocation: Option<[u8; 8]>) -> Vec<u8> {
    let mut file = vec![0u8; 0x200];
    let ne = 0x80;
    let put = |file: &mut Vec<u8>, at: usize, value: u16| {
        file[at..at + 2].copy_from_slice(&value.to_le_bytes());
    };

    file[0..2].copy_from_slice(b"MZ");
    file[60] = ne as u8;
    file[ne..ne + 2].copy_from_slice(b"NE");
    put(&mut file, ne + 0x04, 0x60); // entry table, empty
    put(&mut file, ne + 0x0c, 0x0002); // multiple data: a program
    put(&mut file, ne + 0x0e, 2); // its data segment
    put(&mut file, ne + 0x10, 0x100); // heap
    put(&mut file, ne + 0x12, 0x400); // stack
    put(&mut file, ne + 0x16, 1); // CS:IP 1:0
    put(&mut file, ne + 0x1a, 2); // SS:SP 2:0
    put(&mut file, ne + 0x1c, 2); // segments
    put(&mut file, ne + 0x1e, 1); // module references
    put(&mut file, ne + 0x22, 0x40); // segment table
    put(&mut file, ne + 0x24, 0x50); // resource table, empty
    put(&mut file, ne + 0x26, 0x50); // resident names, empty
    put(&mut file, ne + 0x28, 0x52); // module references
    put(&mut file, ne + 0x2a, 0x54); // imported names
    put(&mut file, ne + 0x32, 4); // in units of 16 bytes
    // Code at 100h, 30h bytes, its relocations after; data at 140h.
    let flags = if relocation.is_some() { 0x100 } else { 0 };

    for (at, value) in [(0x40, 0x10), (0x42, 0x30), (0x44, flags), (0x46, 0x30)] {
        put(&mut file, ne + at, value);
    }
    for (at, value) in [(0x48, 0x14), (0x4a, 16), (0x4c, 0x0001), (0x4e, 16)] {
        put(&mut file, ne + at, value);
    }
    put(&mut file, ne + 0x52, 1);
    file[ne + 0x55] = 6;
    file[ne + 0x56..ne + 0x5c].copy_from_slice(b"KERNEL");
    file[0x100..0x100 + code.len()].copy_from_slice(code);

    if let Some(record) = relocation {
        file[0x130] = 1;
        file[0x132..0x13a].copy_from_slice(&record);
    }

    file
}

/// The site's bytes once linked, an OS fixup of `fixup` at its first.
fn site(coprocessor: bool, fixup: u8, bytes: &[u8]) -> Vec<u8> {
    let mut system = System::new();
    // An OS fixup: the record's kind 3, its type the first word.
    let record = [0, 3, 0, 0, fixup, 0, 0, 0];
    let (index, _) = system.load(
        Executable::parse(program(bytes, Some(record))).unwrap(),
        "C:\\FIXUP.EXE",
    );

    system.coprocessor = coprocessor;
    system.link(index);

    let code = (system.modules[index].segments[0] as u32) << 16;

    (0..bytes.len() as u32)
        .map(|at| system.cpu.bus.read8(code + at))
        .collect()
}

#[test]
fn an_os_fixup_makes_an_instruction_an_interrupt_without_a_coprocessor() {
    assert_eq!(site(false, 5, &[0x9b, 0xde, 0xc1]), [0xcd, 0x3a, 0xc1]);
    assert_eq!(
        site(false, 4, &[0x9b, 0x26, 0xd9, 0x1f]),
        [0xcd, 0x3c, 0xd9, 0x1f]
    );
    assert_eq!(
        site(false, 2, &[0x9b, 0x36, 0xd8, 0x00]),
        [0xcd, 0x3c, 0x58, 0x00]
    );
    assert_eq!(site(false, 6, &[0x90, 0x9b]), [0xcd, 0x3d]);
}

#[test]
fn an_os_fixup_makes_the_fwait_a_nop_with_one_and_a_lone_fwait_an_interrupt_still() {
    assert_eq!(site(true, 5, &[0x9b, 0xde, 0xc1]), [0x90, 0xde, 0xc1]);
    assert_eq!(
        site(true, 4, &[0x9b, 0x26, 0xd9, 0x1f]),
        [0x90, 0x26, 0xd9, 0x1f]
    );
    assert_eq!(site(true, 6, &[0x90, 0x9b]), [0xcd, 0x3d]);
}

/// Where `FSTP` writes, in the data segment.
const DATA: u16 = 0x100;

/// The program started with no coprocessor, `prepare` run on it, and run
/// a while: its code ends in `JMP $`, where it stays. The engine, to be
/// read.
fn emulated(code: &[u8], prepare: impl FnOnce(&mut System)) -> Engine {
    let mut system = System::new();

    system.coprocessor = false;

    let (index, libraries) = system.load(
        Executable::parse(program(code, None)).unwrap(),
        "C:\\EMULATE.EXE",
    );

    system.link(index);
    system.start(index, libraries, "").unwrap();
    prepare(&mut system);

    let engine = Engine::new(system);
    let stop = engine.run(10_000, 10.0);

    assert!(
        !matches!(stop, winbox_win16::Stop::Unsupported(_)),
        "{stop:?}"
    );
    engine
}

/// A double at a far place.
fn f64_at(system: &System, far: u32) -> f64 {
    let bytes: Vec<u8> = (0..8).map(|at| system.cpu.bus.read8(far + at)).collect();

    f64::from_le_bytes(bytes.try_into().unwrap())
}

/// WIN87EM's emulator carries out the instruction after its interrupt and
/// returns past it: `FLD1`, `FLD1`, `FADDP ST(1),ST`, `FWAIT`, `FSTP qword
/// DS:[DATA]`, each as its OS fixup left it.
#[test]
#[ignore = "finding: the Rust engine has no WIN87EM emulator; with the coprocessor off \
            (the page's switch), INT 34h-3Ch stop the run (`run.rs`, \
            Stop::Unsupported(\"the floating-point emulator\"))"]
fn the_emulator_carries_out_an_instruction_after_its_interrupt_and_returns_past_it() {
    let mut code = vec![
        0xcd, 0x35, 0xe8, // FLD1
        0xcd, 0x35, 0xe8, // FLD1
        0xcd, 0x3a, 0xc1, // FADDP ST(1),ST
        0xcd, 0x3d, // FWAIT
        0xcd, 0x3c, 0x1d, 0x1e, // FSTP qword DS:[DATA]
    ];

    code.extend(DATA.to_le_bytes());
    code.extend([0xeb, 0xfe]);

    let engine = emulated(&code, |_| ());
    let system = engine.system();
    let data = u32::from(system.cpu.segments[winbox_cpu::DS].selector);

    assert_eq!(system.cpu.ip, 17);
    assert_eq!(
        f64_at(&system, (data << 16) + u32::from(DATA)).to_bits(),
        2.0f64.to_bits()
    );
}

/// `INT 3Ch` is an instruction with a segment override: the byte after it
/// says which segment, here ES (`DDh` with ES's override bits), not DS.
#[test]
#[ignore = "finding: the Rust engine has no WIN87EM emulator (as above)"]
fn the_emulator_takes_the_segment_from_the_byte_after_int_3ch() {
    let mut code = vec![
        0xcd, 0x35, 0xe8, // FLD1
        0xcd, 0x3c, 0xdd, 0x1e, // FSTP qword ES:[DATA]
    ];

    code.extend(DATA.to_le_bytes());
    code.extend([0xeb, 0xfe]);

    let mut extra = 0;
    let engine = emulated(&code, |system| {
        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x200, 0x42)
            .unwrap();

        extra = index;
        system
            .cpu
            .load_segment(ES, segment_selector(index))
            .unwrap();
    });
    let system = engine.system();
    let data = u32::from(system.cpu.segments[winbox_cpu::DS].selector);

    assert_eq!(
        f64_at(&system, ((extra as u32) << 16) + u32::from(DATA)).to_bits(),
        1.0f64.to_bits()
    );
    assert_eq!(
        f64_at(&system, (data << 16) + u32::from(DATA)).to_bits(),
        0.0f64.to_bits()
    );
}

/// What it does not emulate it leaves, and marks: `FNOP` after `INT 35h`
/// passed over, 40h set in WIN87EM's status.
#[test]
#[ignore = "finding: the Rust engine has no WIN87EM emulator (as above)"]
fn the_emulator_leaves_what_it_does_not_emulate_and_marks_it() {
    let engine = emulated(&[0xcd, 0x35, 0xd0, 0xeb, 0xfe], |_| ());
    let system = engine.system();

    assert_eq!(system.cpu.ip, 3);
    assert_eq!(system.floating.status & 0x40, 0x40);
}
