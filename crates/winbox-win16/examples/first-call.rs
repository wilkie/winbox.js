//! Loads a program, links it and runs it to its first call into a module
//! winbox.js keeps, and prints the call and the registers it is made with.
//!
//! `cargo run -p winbox-win16 --example first-call -- PROGRAM.EXE`

use winbox_cpu::{AX, BP, BX, CS, CX, DI, DS, DX, ES, Exit, SI, SP, SS};
use winbox_machine::index_for;
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::system::STEP;

fn main() {
    let path = std::env::args().nth(1).expect("a program's path");
    let bytes = std::fs::read(&path).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let mut system = System::new();
    let beside = std::path::Path::new(&path)
        .parent()
        .map(std::path::Path::to_path_buf);
    // A library is looked for beside the program, by its name and `.DLL`.
    let mut find = |name: &str| {
        let wanted = format!("{name}.DLL");
        let entries = std::fs::read_dir(beside.as_ref()?).ok()?;

        entries
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&wanted)
            })
            .and_then(|entry| std::fs::read(entry.path()).ok())
    };
    let stem = std::path::Path::new(&path)
        .file_stem()
        .map_or(String::new(), |stem| {
            stem.to_string_lossy().to_ascii_uppercase()
        });
    let (program, libraries) = system.load(executable, &stem, &mut find);

    for library in &libraries {
        println!("library {}", system.modules[*library].name);
    }

    system.link(program);

    system.start(program, "").expect("the program's registers");

    let (ran, exit) = system.cpu.run(10_000_000);
    let cpu = &system.cpu;
    let cs = cpu.segments[CS].selector;

    match exit {
        Exit::Unimplemented(0xcd)
            if cpu.bus.read8(cpu.segments[CS].base + u32::from(cpu.ip) + 1) == 0x80 =>
        {
            let kept = system
                .kept_at(index_for(cs))
                .expect("a kept module's stubs");
            let ordinal = cpu.ip / STEP - 1;
            let name = kept
                .module
                .export(ordinal)
                .map_or("?", |export| export.name);
            let sp = u32::from(cpu.regs[SP]);
            let stack = cpu.segments[SS].base;
            let return_ip = cpu.bus.read16(stack + sp);
            let return_cs = cpu.bus.read16(stack + ((sp + 2) & 0xffff));

            println!("{ran} instructions");
            println!(
                "{}.{} ({}) from {:04x}:{:04x}",
                kept.module.name,
                name,
                ordinal,
                return_cs,
                return_ip.wrapping_sub(5)
            );
        }
        other => println!(
            "{ran} instructions, stopped: {other:?} at {cs:04x}:{:04x}",
            cpu.ip
        ),
    }

    let names = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"];

    for (name, register) in names.iter().zip([AX, CX, DX, BX, SP, BP, SI, DI]) {
        print!("{name}={:04x} ", cpu.regs[register]);
    }

    println!(
        "\nES={:04x} CS={:04x} SS={:04x} DS={:04x}",
        cpu.segments[ES].selector, cs, cpu.segments[SS].selector, cpu.segments[DS].selector
    );
}
