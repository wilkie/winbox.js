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
//! Nth, where it has not stopped before. `--marks REPORT.json` presses the
//! keys and keeps the screens a TypeScript engine's survey report says it
//! did, where it did (`stepMarks`). `--input SEED` gives the run made-up
//! keys and clicks every second and a half of its clock, the same for the
//! same seed (`scripted_input`); given with `--marks`, only after the
//! report's last key, and the report's screens not kept. `--summary` prints how many calls there
//! were and only the last twenty.
//!
//! The run itself is the survey's (`winbox_win16::survey`), as a browser's
//! page and the tests make it; here are only the host's files.

use std::path::{Path, PathBuf};

use winbox_machine::HostDrive;
use winbox_ne::Executable;
use winbox_win16::survey::{Screen, Survey};

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

/// The screen as the run left it, the cursor over it, and each box kept
/// beside it; or, where screens were kept at marks, each of those, as the
/// TypeScript engine's survey names them: the first as asked, the rest
/// `-2`, `-3` and on.
fn save_screens(screen: &Path, screens: &[Screen], boxes: &[Screen]) {
    for (at, kept) in screens.iter().enumerate() {
        let file = if at == 0 {
            screen.to_path_buf()
        } else {
            let stem = screen
                .file_stem()
                .map_or(String::new(), |stem| stem.to_string_lossy().into_owned());

            screen.with_file_name(format!("{stem}-{}.png", at + 1))
        };

        save_png(&file, kept);
    }

    for (at, kept) in boxes.iter().enumerate() {
        save_png(&screen.with_extension(format!("box{}.png", at + 1)), kept);
    }
}

/// A screen saved as a PNG, in the colours it showed, as the TypeScript
/// engine's survey saves its own.
fn save_png(file: &Path, screen: &Screen) {
    let Ok(out) = std::fs::File::create(file) else {
        eprintln!("cannot write {}", file.display());
        return;
    };
    let mut encoder = png::Encoder::new(
        std::io::BufWriter::new(out),
        screen.width as u32,
        screen.height as u32,
    );

    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);

    let bytes: Vec<u8> = screen
        .rgb()
        .iter()
        .flat_map(|&pixel| [(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8])
        .collect();

    if let Ok(mut writer) = encoder.write_header() {
        let _ = writer.write_image_data(&bytes);
    }
}

/// What the command line asks for: the host's files, and the survey.
struct Options {
    file: Option<PathBuf>,
    drive: Option<PathBuf>,
    path: Option<String>,
    windows: Option<PathBuf>,
    oracle_drives: bool,
    screen: Option<PathBuf>,
    marks: Option<PathBuf>,
    survey: Survey,
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
        marks: None,
        survey: Survey::default(),
    };
    let survey = &mut options.survey;

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--drive" => options.drive = arguments.next().map(PathBuf::from),
            "--path" => options.path = arguments.next(),
            "--windows" => options.windows = arguments.next().map(PathBuf::from),
            "--oracle-drives" => options.oracle_drives = true,
            "--screen" => options.screen = arguments.next().map(PathBuf::from),
            "--calls" => survey.calls = arguments.next().and_then(|n| n.parse().ok()),
            "--marks" => options.marks = arguments.next().map(PathBuf::from),
            "--input" => survey.input = arguments.next().and_then(|n| n.parse().ok()),
            "--summary" => survey.summary = true,
            "--boxes" => {
                survey.boxes = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(survey.boxes);
            }
            "--budget" => {
                survey.budget = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(survey.budget);
            }
            "--seconds" => {
                survey.seconds = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(survey.seconds);
            }
            "--display" => {
                if let Some(display) = arguments.next() {
                    survey.display = display;
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
        screen,
        marks,
        mut survey,
    } = options();
    let file = file.expect("a program's file");
    let bytes = std::fs::read(&file).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = path.unwrap_or_else(|| format!("C:\\{name}"));

    survey.marks = marks.map(|report| std::fs::read_to_string(report).unwrap_or_default());
    survey.screens = screen.is_some();
    // The instructions run at each call, to set beside the TypeScript
    // engine's where the two clocks part.
    survey.counts = std::env::var_os("WINBOX_TRACE_INSTRUCTIONS").is_some();

    let mut system = survey.system().expect("a display mode winbox.js knows");
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

    winbox_win16::survey::start(&mut system, executable, &path).expect("the program's registers");

    let surveyed = survey.run(system);

    if let Some(screen) = &screen {
        save_screens(screen, &surveyed.screens, &surveyed.boxes);
    }

    print!("{}", surveyed.report);

    for folder in made {
        let _ = std::fs::remove_dir_all(folder);
    }
}
