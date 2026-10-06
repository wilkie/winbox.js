//! A program loaded, linked and run to its first call, natively.

use winbox_cpu::{BX, CS, CX, DS, Exit, SP, SS};
use winbox_machine::{index_for, segment_selector};
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::system::STEP;

/// A program of two segments: code that far-calls KERNEL's ordinal 91
/// (`InitTask`) through a relocation and halts, and its data.
fn program() -> Vec<u8> {
    // CALL FAR, the pointer's chain ending where it is, then HLT; a far
    // pointer at 1, KERNEL's ordinal 91.
    program_with(
        &[0x9a, 0xff, 0xff, 0x00, 0x00, 0xf4],
        &[[3, 1, 1, 0, 1, 0, 91, 0]],
    )
}

/// The same program with code of its own, 16 bytes at most, and its own
/// relocation records, two at most.
fn program_with(code: &[u8], relocations: &[[u8; 8]]) -> Vec<u8> {
    let mut file = vec![0u8; 0x140];
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
    // Code at 100h, 16 bytes, with relocations; data at 130h, 16 bytes.
    for (at, value) in [(0x40, 0x10), (0x42, 16), (0x44, 0x100), (0x46, 16)] {
        put(&mut file, ne + at, value);
    }
    for (at, value) in [(0x48, 0x13), (0x4a, 16), (0x4c, 0x0001), (0x4e, 16)] {
        put(&mut file, ne + at, value);
    }
    put(&mut file, ne + 0x52, 1);
    file[ne + 0x55] = 6;
    file[ne + 0x56..ne + 0x5c].copy_from_slice(b"KERNEL");
    file[0x100..0x100 + code.len()].copy_from_slice(code);
    file[0x110] = relocations.len() as u8;
    for (n, record) in relocations.iter().enumerate() {
        file[0x112 + 8 * n..0x11a + 8 * n].copy_from_slice(record);
    }
    file
}

#[test]
fn runs_a_program_to_its_first_call() {
    let executable = Executable::parse(program()).unwrap();
    let mut system = System::new();
    let (index, libraries) = system.load(executable, "C:\\FIRST.EXE");

    assert!(libraries.is_empty());
    system.link(index);
    system.start(index, libraries, "").unwrap();

    let (ran, exit) = system.cpu.run(100);

    assert_eq!((ran, exit), (1, Exit::Unimplemented(0xcd)));

    let cpu = &system.cpu;
    let kept = system
        .kept_at(index_for(cpu.segments[CS].selector))
        .unwrap();

    assert_eq!(kept.module.name, "KERNEL");
    assert_eq!(
        kept.module.export(cpu.ip / STEP - 1).unwrap().name,
        "InitTask"
    );
    // Programs' segments from descriptor 1, its data the second.
    assert_eq!(cpu.segments[DS].selector, segment_selector(2));
    assert_eq!(cpu.segments[SS].selector, segment_selector(2));
    // The stack above the data's 16 bytes, the return address on it.
    assert_eq!(cpu.regs[SP], 0x410 - 4);
    assert_eq!(cpu.bus.read16((2 << 16) + 0x40c), 5);
    assert_eq!(cpu.bus.read16((2 << 16) + 0x40e), segment_selector(1));
    assert_eq!((cpu.regs[BX], cpu.regs[CX]), (0x400, 0x100));
    // The local heap after the stack.
    let heap = &system.heaps[&2];

    assert_eq!((heap.offset(), heap.size()), (0x410, 0x100));
}

/// Where the TypeScript engine has them, from descriptor 4: each handle 32
/// or more (`modhand`), a fixed module's instance its data's selector, a
/// moveable one's one below.
#[test]
fn keeps_modules_where_the_typescript_engine_does() {
    let system = System::new();
    let kernel = &system.kept[system.kept_named("kernel").unwrap()];

    assert_eq!((kernel.handle(), kernel.instance()), (0x27, 0x2f));

    let gdi = &system.kept[system.kept_named("GDI").unwrap()];

    assert_eq!((gdi.handle(), gdi.instance()), (0x37, 0x3e));
}

#[test]
fn calls_a_procedure_of_the_program() {
    let executable = Executable::parse(program()).unwrap();
    let mut system = System::new();
    let (index, libraries) = system.load(executable, "C:\\FIRST.EXE");

    system.link(index);
    system.start(index, libraries, "").unwrap();

    // MOV AX, 1234h; MOV DX, 5678h; RETF 4 -- at 1:10h.
    system.cpu.bus.write(
        (1 << 16) + 0x10,
        &[0xb8, 0x34, 0x12, 0xba, 0x78, 0x56, 0xca, 0x04, 0x00],
    );

    let sp = system.cpu.regs[SP];
    let engine = winbox_win16::Engine::new(system);
    let answer = engine.call(u32::from(segment_selector(1)) << 16 | 0x10, &[1, 2], &[]);
    let system = engine.into_system();

    assert_eq!(answer, Ok(0x5678_1234));
    assert_eq!(system.cpu.regs[SP], sp);
    assert_eq!(system.depth, 0);
}

/// ADDITIVE (4) is a bit of its own for any kind of relocation, as the NE
/// format has it: an import by ordinal with it (5) adds to what its site
/// holds, as Catz's CATZ.WAD imports CATZDLL's variables, an offset fixup
/// added to the field's offset in the code (`mov [es:0x2],dx`); and an OS
/// fixup with it (7) is applied, a lone `FWAIT` made `INT 3Dh`.
#[test]
fn applies_a_relocation_additive_whatever_its_kind() {
    // An offset of 2 in a word, then `NOP`, `FWAIT`.
    let code = [0x02, 0x00, 0x90, 0x9b, 0xf4];
    // KERNEL's ordinal 113, `__AHSHIFT` (3), added at 0; an OS fixup of
    // type 6 at 2.
    let relocations = [[5, 5, 0, 0, 1, 0, 113, 0], [0, 7, 2, 0, 6, 0, 0, 0]];
    let executable = Executable::parse(program_with(&code, &relocations)).unwrap();
    let mut system = System::new();
    let (index, _) = system.load(executable, "C:\\FIRST.EXE");

    system.link(index);

    let added = system.cpu.bus.read16(1 << 16);
    let fixed = system.cpu.bus.read16((1 << 16) + 2);

    assert_eq!((added, fixed), (5, 0x3dcd));
}
