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
//! `--screen FILE` saves the screen as the run left it as a PNG; with
//! `--boxes N`, up to N of USER's boxes that let no program run are
//! answered with Enter, each saved as it came up (`FILE.box1.png`).
//! `--calls N` stops the run as the program makes its call after the
//! Nth, where it has not stopped before.

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

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::sys_error_box::{BoxHand, BoxInput};

const VK_RETURN: u16 = 0x0d;

/// A screen kept: its width, its height, a pixel a word.
type Shot = (usize, usize, Vec<u32>);

/// USER's boxes that let no program run, up to `boxes` of them, answered
/// with Enter as they come up, each kept as it came up, as the TypeScript
/// engine's survey answers and keeps them (`boxKeys`).
fn answer_boxes(system: &mut System, boxes: usize) -> Rc<RefCell<Vec<Shot>>> {
    let shots = Rc::new(RefCell::new(Vec::new()));

    if boxes == 0 {
        return shots;
    }

    let taken = Rc::clone(&shots);
    let mut left = boxes;
    let mut pressed = false;

    system.box_hand = Some(BoxHand(Box::new(move |system: &System, shown: bool| {
        if shown {
            pressed = false;

            if let Some(shot) = system.screen_rgb_bare() {
                taken.borrow_mut().push(shot);
            }
        }

        if pressed || left == 0 {
            return None;
        }

        pressed = true;
        left -= 1;
        Some(BoxInput::Key(VK_RETURN))
    })));

    shots
}

/// Each call the program made, as it was answered, and why the run
/// stopped and where.
fn print_trace(system: &System, stop: &winbox_win16::Stop) {
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
}

/// The screen as the run left it, the cursor over it, and each box kept
/// beside it.
fn save_screens(system: &mut System, screen: &Path, shots: &[Shot]) {
    let (width, height, pixels) = system.screen_rgb();

    save_png(screen, width, height, &pixels);

    for (at, (width, height, pixels)) in shots.iter().enumerate() {
        save_png(
            &screen.with_extension(format!("box{}.png", at + 1)),
            *width,
            *height,
            pixels,
        );
    }
}

/// A screen saved as a PNG, a pixel a word `0x00RRGGBB`, as the
/// TypeScript engine's survey saves its own.
fn save_png(file: &Path, width: usize, height: usize, pixels: &[u32]) {
    let Ok(out) = std::fs::File::create(file) else {
        eprintln!("cannot write {}", file.display());
        return;
    };
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(out), width as u32, height as u32);

    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);

    let bytes: Vec<u8> = pixels
        .iter()
        .flat_map(|&pixel| [(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8])
        .collect();

    if let Ok(mut writer) = encoder.write_header() {
        let _ = writer.write_image_data(&bytes);
    }
}

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
    screen: Option<PathBuf>,
    boxes: usize,
    calls: Option<usize>,
}

fn options() -> Options {
    let mut arguments = std::env::args().skip(1);
    let mut options = Options {
        file: None,
        drive: None,
        path: None,
        windows: None,
        oracle_drives: false,
        screen: None,
        boxes: 0,
        calls: None,
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
            "--screen" => options.screen = arguments.next().map(PathBuf::from),
            "--calls" => options.calls = arguments.next().and_then(|n| n.parse().ok()),
            "--boxes" => {
                options.boxes = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(options.boxes);
            }
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
        screen,
        boxes,
        calls,
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
    system.calls_until = calls;

    // Started in its own folder, as Program Manager starts a program whose
    // item's working directory is where the program is.
    if let Some((folder, _)) = path.rsplit_once('\\')
        && folder.len() > 2
    {
        system.files.set_path(folder);
    }

    let shots = answer_boxes(&mut system, boxes);
    let engine = winbox_win16::Engine::new(system);
    let stop = engine.run(budget, seconds);
    let mut system = engine.into_system();

    if let Some(screen) = &screen {
        save_screens(&mut system, screen, &shots.borrow());
    }

    print_trace(&system, &stop);

    for folder in made {
        let _ = std::fs::remove_dir_all(folder);
    }
}
