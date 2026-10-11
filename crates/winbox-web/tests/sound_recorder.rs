//! Sound Recorder opening a waveform file, playing it, changing it and
//! saving it, through MMSYSTEM's `mmio` functions (`mmsystem/mmio.rs`)
//! and WinBox's own sound card. Each session is held to what shows and to
//! the bytes it wrote.
//!
//! The host's time is the test's own, as in `accessories.rs`.

use std::cell::Cell;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use winbox_machine::Change;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
}

fn host_ms() -> f64 {
    NOW.with(|now| {
        now.set(now.get() + 0.01);
        now.get()
    })
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder put on drive C: at `dos`, in the order of the names.
fn hold(session: &mut Session, folder: &Path, dos: &str) {
    let mut entries: Vec<_> = std::fs::read_dir(folder).unwrap().flatten().collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            assert!(session.add_folder('C', &named, 0));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), 0));
        }
    }
}

/// A waveform file of eight-bit mono samples at 11,025 a second: a RIFF
/// `WAVE` with its `fmt ` and `data` chunks.
fn wave(samples: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let data = u32::try_from(samples.len()).unwrap();

    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data + (data & 1)).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&[1, 0, 1, 0]);
    bytes.extend_from_slice(&11_025u32.to_le_bytes());
    bytes.extend_from_slice(&11_025u32.to_le_bytes());
    bytes.extend_from_slice(&[1, 0, 8, 0]);
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data.to_le_bytes());
    bytes.extend_from_slice(samples);

    if data & 1 != 0 {
        bytes.push(0);
    }

    bytes
}

/// Half a second of a tone: a triangle of 50 samples, from 40h to C0h.
fn tone() -> Vec<u8> {
    (0..5512)
        .map(|at: usize| {
            let phase = at % 50;
            let rise = if phase < 25 { phase } else { 50 - phase };

            u8::try_from(0x40 + rise * 5).unwrap()
        })
        .collect()
}

/// A fresh machine with the sound card installed, Windows staying up, the
/// installation on C: (held in memory, so nothing the run writes reaches
/// the oracle's build), a waveform file at `C:\TONE.WAV`, and Sound
/// Recorder started; none where the oracle's build is not here.
fn started() -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS").join("SOUNDREC.EXE").is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    NOW.with(|now| now.set(0.0));

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: host_ms,
        wall: || 0,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    hold(&mut session, &windows, "");
    assert!(session.add_file('C', "\\TONE.WAV", wave(&tone()), 0));
    session.mark_planned();
    assert!(session.install_sound());
    session.start("C:\\WINDOWS\\SOUNDREC.EXE").unwrap();
    frames(&mut session, 150);
    Some(session)
}

/// So many of the page's frames.
fn frames(session: &mut Session, count: usize) {
    for frame in 0..count {
        let slice = [4.0, 16.0, 12.0][frame % 3];
        let state = session.step(host_ms() + slice);

        NOW.with(|now| now.set(now.get() + slice));

        if state == State::Idle {
            let wake = session.wake_at();

            NOW.with(|now| now.set(now.get().max(wake)));
        }

        assert_ne!(state, State::Stopped, "{:?}", session.stop());
    }
}

fn key(code: &str, name: &str, alt: bool) -> Key {
    Key {
        code: code.to_string(),
        key: name.to_string(),
        repeat: false,
        alt,
    }
}

/// The key a character is typed with, what it types, and whether Shift is
/// held for it.
fn key_of(character: char) -> (String, String, bool) {
    let plain = |code: &str| (code.to_string(), character.to_string(), false);
    let shifted = |code: &str| (code.to_string(), character.to_string(), true);

    match character {
        'a'..='z' => (
            format!("Key{}", character.to_ascii_uppercase()),
            character.to_string(),
            false,
        ),
        'A'..='Z' => (format!("Key{character}"), character.to_string(), true),
        '0'..='9' => (format!("Digit{character}"), character.to_string(), false),
        '.' => plain("Period"),
        '\\' => plain("Backslash"),
        ':' => shifted("Semicolon"),
        _ => panic!("no key for {character:?}"),
    }
}

/// Text typed, a key at a time.
fn type_text(session: &mut Session, text: &str) {
    for character in text.chars() {
        let (code, name, shift) = key_of(character);

        if shift {
            session.key(true, &key("ShiftLeft", "Shift", false));
        }

        session.key(true, &key(&code, &name, false));
        session.key(false, &key(&code, &name, false));

        if shift {
            session.key(false, &key("ShiftLeft", "Shift", false));
        }

        frames(session, 3);
    }

    frames(session, 20);
}

/// A key pressed and let go, with Control, Shift or Alt held where one is
/// named, and the run let take it.
fn press(session: &mut Session, held: Option<&str>, code: &str, name: &str) {
    let modifier = held.map(|held| match held {
        "Control" => ("ControlLeft", "Control"),
        "Shift" => ("ShiftLeft", "Shift"),
        _ => ("AltLeft", "Alt"),
    });
    let alt = held == Some("Alt");

    if let Some((code, name)) = modifier {
        session.key(true, &key(code, name, alt));
    }

    session.key(true, &key(code, name, alt));
    session.key(false, &key(code, name, alt));

    if let Some((code, name)) = modifier {
        session.key(false, &key(code, name, false));
    }

    frames(session, 40);
}

/// A menu's item chosen by the keys: Alt with the menu's letter, then the
/// item's.
fn menu(session: &mut Session, menu: char, item: char) {
    let (code, name, _) = key_of(menu);

    press(session, Some("Alt"), &code, &name);

    let (code, name, _) = key_of(item);

    press(session, None, &code, &name);
    frames(session, 40);
}

/// The left button pressed and let go at a point of the screen, and the
/// run let take it.
fn click(session: &mut Session, x: i16, y: i16) {
    session.pointer(pointer_of(0, x, y, 0, 0, false));
    session.pointer(pointer_of(1, x, y, 0, 1, false));
    session.pointer(pointer_of(2, x, y, 0, 0, false));
    frames(session, 60);
}

/// The first window shown with a title, or of a class.
fn shown(session: &Session, named: &str) -> Option<usize> {
    let system = session.system();

    system.windows.iter().position(|window| {
        window.as_ref().is_some_and(|window| {
            window.visible && (window.title == named || window.class == named)
        })
    })
}

/// A file's bytes as a program left it on C:, where it wrote one.
fn written(session: &Session, path: &str) -> Option<Vec<u8>> {
    session
        .changes('C')
        .into_iter()
        .find_map(|change| match change {
            Change::File { path: at, data, .. } if at.eq_ignore_ascii_case(path) => {
                Some(data.to_vec())
            }
            _ => None,
        })
}

/// The screen as a PPM picture, for a session followed by eye.
fn picture(session: &mut Session) -> Vec<u8> {
    let (width, height) = session.size();
    let mut out = format!("P6 {width} {height} 255\n").into_bytes();

    for pixel in session.present().chunks(4) {
        out.extend_from_slice(&pixel[..3]);
    }

    out
}

/// The windows shown, a line each: index, parent, class, identifier, place
/// and text.
fn listing(session: &Session) -> String {
    let system = session.system();
    let mut out = String::new();

    for (index, window) in system.windows.iter().enumerate() {
        let Some(window) = window else { continue };

        if !window.visible {
            continue;
        }

        let text = window
            .control
            .as_ref()
            .map_or_else(|| window.title.clone(), |control| control.text.clone());

        let _ = writeln!(
            out,
            "{index:3} p{:?} {} id={} ({},{} {}x{}) s={:x} {:?}",
            window.parent,
            window.class,
            window.control_id,
            window.left,
            window.top,
            window.width,
            window.height,
            window.style,
            text,
        );
    }

    out
}

/// The text of Sound Recorder's control with an identifier: 200 its
/// status, 201 its position, 202 its length.
fn text_of(session: &Session, id: u16) -> String {
    let parent = shown(session, "SoundRec").expect("Sound Recorder's window");
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.control_id == id)
        .map(|window| {
            window
                .control
                .as_ref()
                .map_or_else(|| window.title.clone(), |control| control.text.clone())
        })
        .unwrap_or_default()
}

fn title(session: &Session) -> String {
    let at = shown(session, "SoundRec").expect("Sound Recorder's window");

    session.system().windows[at].as_ref().unwrap().title.clone()
}

/// `C:\TONE.WAV` opened through File Open, its name typed.
fn open_tone(session: &mut Session) {
    menu(session, 'f', 'o');
    frames(session, 60);
    type_text(session, "c:\\tone.wav");
    press(session, None, "Enter", "Enter");
    frames(session, 120);
}

/// The samples the sound card played since last asked, as one run.
fn played(session: &Session) -> Vec<u8> {
    session
        .take_sound()
        .into_iter()
        .filter_map(|sound| match sound {
            winbox_win16::audio::Sound::Samples { samples, .. } => Some(samples),
            _ => None,
        })
        .flatten()
        .collect()
}

/// Once, Sound Recorder said there was not enough disk space to open a
/// file: MMSYSTEM's `mmio` functions were stubs. A file opens through
/// them now: its name in the title, its length half a second; and Play
/// plays its samples on the card, to the end, where it stops.
#[test]
fn sound_recorder_opens_a_file_and_plays_it() {
    let Some(mut session) = started() else {
        return;
    };

    open_tone(&mut session);
    assert_eq!(title(&session), "Sound Recorder - TONE.WAV");
    assert_eq!(text_of(&session, 202), "0.50 sec.");
    assert_eq!(text_of(&session, 200), "Stopped");
    played(&session);

    // Play, at the middle of its button, given only a few frames.
    session.pointer(pointer_of(0, 159, 151, 0, 0, false));
    session.pointer(pointer_of(1, 159, 151, 0, 1, false));
    session.pointer(pointer_of(2, 159, 151, 0, 0, false));
    frames(&mut session, 6);
    assert_eq!(text_of(&session, 200), "Playing");

    frames(&mut session, 200);
    assert_eq!(text_of(&session, 200), "Stopped");
    assert_eq!(text_of(&session, 201), "0.50 sec.");

    let samples = played(&session);
    let tone = tone();

    assert!(samples.len() >= tone.len(), "{} played", samples.len());
    assert_eq!(&samples[..tone.len()], &tone[..]);
}

/// Effects' Reverse, then Save As: the file written through `mmio` --
/// `mmioCreateChunk`, `mmioWrite`, `mmioAscend` -- a RIFF `WAVE` whose
/// sizes are filled in, its samples the other way round. The `sndrec`
/// probe holds Windows' own Sound Recorder's saves to the byte.
#[test]
fn sound_recorder_reverses_a_file_and_saves_it() {
    let Some(mut session) = started() else {
        return;
    };

    open_tone(&mut session);
    menu(&mut session, 's', 'r');
    frames(&mut session, 60);
    menu(&mut session, 'f', 'a');
    frames(&mut session, 60);
    type_text(&mut session, "c:\\out.wav");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 200);
    assert_eq!(title(&session), "Sound Recorder - OUT.WAV");

    let saved = written(&session, "OUT.WAV").expect("OUT.WAV written");
    let mut reversed = tone();

    reversed.reverse();
    assert_eq!(saved, wave(&reversed));
}

/// A session followed by eye: `SOUNDREC_SCRIPT` names a file of commands,
/// a line each, `SOUNDREC_OUT` where pictures and files go.
#[test]
#[ignore = "a session followed by eye"]
fn explore() {
    let Ok(script) = std::env::var("SOUNDREC_SCRIPT") else {
        return;
    };
    let out = PathBuf::from(std::env::var("SOUNDREC_OUT").unwrap_or_else(|_| ".".into()));
    let script = std::fs::read_to_string(script).unwrap();
    let Some(mut session) = started() else {
        return;
    };

    for line in script.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (command, rest) = line.split_once(' ').unwrap_or((line, ""));
        let numbers: Vec<i16> = rest
            .split_whitespace()
            .filter_map(|word| word.parse().ok())
            .collect();

        match command {
            "click" => click(&mut session, numbers[0], numbers[1]),
            "type" => type_text(&mut session, rest),
            "key" => {
                let mut words = rest.split_whitespace();
                let code = words.next().unwrap();
                let held = words.next();

                press(&mut session, held, code, code);
            }
            "menu" => {
                let mut words = rest.chars().filter(|c| !c.is_whitespace());

                menu(&mut session, words.next().unwrap(), words.next().unwrap());
            }
            "frames" => frames(&mut session, usize::try_from(numbers[0]).unwrap()),
            "shot" => {
                let path = out.join(format!("{rest}.ppm"));

                std::fs::write(&path, picture(&mut session)).unwrap();
                println!("shot {}", path.display());
            }
            "list" => println!("{}", listing(&session)),
            "changes" => {
                for change in session.changes('C') {
                    match change {
                        Change::File { path, data, .. } => println!("file {path} {}", data.len()),
                        Change::Folder { path, .. } => println!("folder {path}"),
                        Change::Removed { path } => println!("removed {path}"),
                    }
                }
            }
            "save" => {
                let mut words = rest.split_whitespace();
                let dos = words.next().unwrap();
                let host = out.join(words.next().unwrap());

                match written(&session, dos) {
                    Some(bytes) => {
                        std::fs::write(&host, bytes).unwrap();
                        println!("saved {}", host.display());
                    }
                    None => println!("{dos}: not written"),
                }
            }
            "stop" => println!("{:?}", session.stop()),
            _ => panic!("no command {command}"),
        }
    }

    let _ = shown(&session, "Sound Recorder");
}
