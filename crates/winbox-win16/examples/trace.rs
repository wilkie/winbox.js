//! Loads a program, links it and runs it, printing each call it makes as
//! it is answered, until its task ends or it meets something the Rust
//! engine does not answer yet.
//!
//! `cargo run -p winbox-win16 --example trace -- PROGRAM.EXE [--drive DIR]
//! [--path C:\PROGRAM.EXE] [--budget INSTRUCTIONS] [--seconds SECONDS]
//! [--display vga|ega|hercules|svga|vga256]`
//!
//! `--drive` is the host directory that is drive C:, else one made for the
//! run, and removed after it, with a copy of the program's folder where
//! `--path` puts it; `--windows` an installed drive beneath it, read and
//! never written (`oracle/build/drive-c`); `--oracle-drives` adds the
//! oracle's A: and Z:, made for the run as well; `--path` is the program's
//! path, as DOS names it, `C:\` and its file's name by default.

use std::path::{Path, PathBuf};

/// A folder copied where the drive's folder is, and every folder in it, as
/// the TypeScript engine maps one onto its disk image: what the program
/// writes there stays with the run and never reaches the folder itself.
fn copy_folder(folder: &Path, at: &Path) {
    let _ = std::fs::create_dir_all(at);

    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        let to = at.join(entry.file_name());

        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            copy_folder(&entry.path(), &to);
        } else {
            let _ = std::fs::copy(entry.path(), to);
        }
    }
}

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::System;

/// What the command line asks for.
struct Options {
    file: Option<PathBuf>,
    drive: Option<PathBuf>,
    path: Option<String>,
    windows: Option<PathBuf>,
    oracle_drives: bool,
    budget: u64,
    seconds: f64,
    display: String,
}

fn options() -> Options {
    let mut arguments = std::env::args().skip(1);
    let mut options = Options {
        file: None,
        drive: None,
        path: None,
        windows: None,
        oracle_drives: false,
        budget: 100_000_000,
        // The survey's ten seconds on the clock.
        seconds: 10.0,
        display: "vga".to_string(),
    };

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--drive" => options.drive = arguments.next().map(PathBuf::from),
            "--path" => options.path = arguments.next(),
            "--windows" => options.windows = arguments.next().map(PathBuf::from),
            "--oracle-drives" => options.oracle_drives = true,
            "--budget" => {
                options.budget = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(options.budget);
            }
            "--seconds" => {
                options.seconds = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(options.seconds);
            }
            "--display" => {
                if let Some(display) = arguments.next() {
                    options.display = display;
                }
            }
            _ => options.file = Some(PathBuf::from(argument)),
        }
    }

    options
}

fn main() {
    let Options {
        file,
        drive,
        path,
        windows,
        oracle_drives,
        budget,
        seconds,
        display,
    } = options();
    let file = file.expect("a program's file");
    let bytes = std::fs::read(&file).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = path.unwrap_or_else(|| format!("C:\\{name}"));
    let mut system = System::new();

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");
    // Drive C:, the directory given, else one made for the run, with the
    // program's own folder where its path puts it, for its libraries.
    // The folders made for the run, removed after it.
    let mut made = Vec::new();
    let root = drive.unwrap_or_else(|| {
        let root = std::env::temp_dir().join(format!("winbox-trace-{}", std::process::id()));
        let folders: Vec<&str> = path.split('\\').skip(1).collect();
        let (last, parents) = folders[..folders.len() - 1].split_last().unzip();
        let parent = parents
            .unwrap_or_default()
            .iter()
            .fold(root.clone(), |at, part| at.join(part));

        std::fs::create_dir_all(&parent).expect("the run's drive");

        if let (Some(last), Some(folder)) = (last, file.parent()) {
            let folder = std::fs::canonicalize(folder).expect("the program's folder");

            copy_folder(&folder, &parent.join(last));
        }

        made.push(root.clone());
        root
    });
    // Windows installed beneath it, its files read and never written, where
    // an installation's drive is given.
    let c = match &windows {
        Some(installed) => HostDrive::over(root.clone(), installed.clone()),
        None => HostDrive::new(root.clone()),
    };

    system.files.mount('C', c);

    // The machine the oracle recorded on: A:, a floppy, and Z:, DOSBox's.
    if oracle_drives {
        for (letter, removable) in [('A', true), ('Z', false)] {
            let folder =
                std::env::temp_dir().join(format!("winbox-trace-{}-{letter}", std::process::id()));

            std::fs::create_dir_all(&folder).expect("a drive's folder");
            made.push(folder.clone());
            system.files.mount(
                letter,
                if removable {
                    HostDrive::removable(folder)
                } else {
                    HostDrive::new(folder)
                },
            );
        }
    }

    let (program, libraries) = system.load(executable, &path);

    system.link(program);
    system
        .start(program, libraries, "")
        .expect("the program's registers");
    system.log = Some(Vec::new());

    // Started in its own folder, as Program Manager starts a program whose
    // item's working directory is where the program is.
    if let Some((folder, _)) = path.rsplit_once('\\')
        && folder.len() > 2
    {
        system.files.set_path(folder);
    }

    let engine = winbox_win16::Engine::new(system);
    let stop = engine.run(budget, seconds);
    let system = engine.into_system();

    let counts = std::env::var_os("WINBOX_TRACE_INSTRUCTIONS").is_some();

    for call in system.log.iter().flatten() {
        let result = call.result.map_or(String::new(), |value| value.to_string());

        let stub = if call.stub { " stub" } else { "" };
        // The instructions run at each call, to set beside the TypeScript
        // engine's where the two clocks part.
        let counted = if counts {
            format!(" #{}", call.instructions)
        } else {
            String::new()
        };

        println!(
            "{}.{} = {}{stub} @{:x}:{:x}{counted}",
            call.module, call.name, result, call.caller.0, call.caller.1
        );
    }

    println!(
        "stopped: {stop:?} after {} instructions, AX={:04x} at {:04x}:{:04x}",
        system.instructions,
        system.cpu.regs[winbox_cpu::AX],
        system.cpu.segments[winbox_cpu::CS].selector,
        system.cpu.ip
    );

    if !system.unanswered_dos.is_empty() {
        println!("DOS functions not answered: {:04x?}", system.unanswered_dos);
    }

    let at = system.cpu.segments[winbox_cpu::CS].base + u32::from(system.cpu.ip);

    println!("bytes: {:02x?}", system.cpu.bus.read(at, 8));

    for folder in made {
        let _ = std::fs::remove_dir_all(folder);
    }
}
