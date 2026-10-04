//! Loads a program, links it and runs it, printing each call it makes as
//! it is answered, until its task ends or it meets something the Rust
//! engine does not answer yet.
//!
//! `cargo run -p winbox-win16 --example trace -- PROGRAM.EXE [--drive DIR]
//! [--path C:\PROGRAM.EXE] [--budget INSTRUCTIONS]`
//!
//! `--drive` is the host directory that is drive C:; `--path` the program's
//! path on it, as DOS names it, `C:\` and its file's name by default. Its
//! libraries are found beside it on the host.

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::system::Watch;

fn main() {
    let mut arguments = std::env::args().skip(1);
    let mut file = None;
    let mut drive = None;
    let mut path = None;
    let mut budget = 100_000_000u64;

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--drive" => drive = arguments.next().map(PathBuf::from),
            "--path" => path = arguments.next(),
            "--budget" => {
                budget = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(budget);
            }
            _ => file = Some(PathBuf::from(argument)),
        }
    }

    let file = file.expect("a program's file");
    let bytes = std::fs::read(&file).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = path.unwrap_or_else(|| format!("C:\\{name}"));
    let mut system = System::new();

    if let Some(root) = drive {
        system.files.mount('C', HostDrive { root });
    }

    let beside = file.parent().map(Path::to_path_buf);
    let directory = path
        .rsplit_once('\\')
        .map_or(String::new(), |(dir, _)| dir.to_string());
    // A library is looked for beside the program, by its name and `.DLL`.
    let mut find = |name: &str| {
        let wanted = format!("{name}.DLL");
        let entries = std::fs::read_dir(beside.as_ref()?).ok()?;
        let entry = entries.flatten().find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&wanted)
        })?;

        Some((
            format!("{directory}\\{wanted}"),
            std::fs::read(entry.path()).ok()?,
        ))
    };
    let (program, libraries) = system.load(executable, &path, &mut find);

    system.link(program);
    system
        .start(program, libraries, "")
        .expect("the program's registers");
    system.on_call = Some(Watch(Box::new(|call| {
        let result = call.result.map_or(String::new(), |value| value.to_string());

        println!(
            "{}.{} = {} @{:x}:{:x}",
            call.module, call.name, result, call.caller.0, call.caller.1
        );
    })));

    let stop = system.run(budget);

    println!(
        "stopped: {stop:?} after {} instructions, AX={:04x} at {:04x}:{:04x}",
        system.instructions,
        system.cpu.regs[winbox_cpu::AX],
        system.cpu.segments[winbox_cpu::CS].selector,
        system.cpu.ip
    );

    let at = system.cpu.segments[winbox_cpu::CS].base + u32::from(system.cpu.ip);

    println!("bytes: {:02x?}", system.cpu.bus.read(at, 8));
}
