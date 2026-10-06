//! The machine driven as the page drives it (`src/run/engines/rust.ts`):
//! between each step and the next, the input queued handed in, then the
//! screen taken, the windows' tree, the calls, the codes of the programs
//! that ended and the sound; what differs on C: told, as the page keeps it
//! every few seconds; and programs started while others run, and after the
//! last has ended, Windows staying up. Each of these looks into the system
//! the run is stepping, between two steps, and none may find it still held
//! by the step before. Only a call that never came back leaves it held -- as
//! a browser leaves one it stops the page's script in the middle of -- and
//! the page asks nothing more of such a module (`Lost` in `rust.ts`).
//!
//! The host's time is the test's own: it runs on a little each time it is
//! read, and leaps now and then, as a busy page's frames come late, so that
//! the steps end at every kind of place -- a slice of a program's
//! instructions, a call waiting for a message, time waiting to pass, a
//! sound playing out -- and the run is the same however fast the host is.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::host_seconds;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

const WM_CLOSE: u16 = 0x0010;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
    /// How many times it has been read.
    static READS: Cell<u64> = const { Cell::new(0) };
}

/// The host's time: on by a hundredth of a millisecond each time it is
/// read, and by a third of a second every ten thousandth, as a frame comes
/// late.
fn host_ms() -> f64 {
    let reads = READS.with(|reads| {
        reads.set(reads.get() + 1);
        reads.get()
    });
    let step = if reads.is_multiple_of(10_000) {
        300.0
    } else {
        0.01
    };

    NOW.with(|now| {
        now.set(now.get() + step);
        now.get()
    })
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder put on drive C: at `dos`, every file in it, and its
/// folders' too.
fn hold(session: &mut Session, folder: &Path, dos: &str) {
    for entry in std::fs::read_dir(folder).unwrap().flatten() {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            assert!(session.add_folder('C', &named, host_seconds()));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), host_seconds()));
        }
    }
}

/// A machine as the page makes one with Sound ticked, Windows staying up:
/// the installation on C:, the probes named in `C:\ORACLE`, the drive
/// marked as planned and the sound card named in `SYSTEM.INI`. None where
/// the oracle's build is not here.
fn machine(probes: &[&str]) -> Option<Session> {
    let built = root().join("oracle/build/probes");
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS/SYSTEM.INI").is_file()
        || !windows.join("WINDOWS/CLOCK.EXE").is_file()
        || probes.iter().any(|name| !built.join(name).is_file())
    {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: host_ms,
        wall: host_seconds,
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    session.drive('C');
    hold(&mut session, &windows, "");
    session.add_folder('C', "ORACLE", host_seconds());

    for name in probes {
        assert!(session.add_file(
            'C',
            &format!("ORACLE\\{name}"),
            std::fs::read(built.join(name)).unwrap(),
            host_seconds()
        ));
    }

    session.mark_planned();
    assert!(session.install_sound());
    // Before any program, what differs is the drive as the page fills it.
    assert!(session.changes('C').is_empty());
    Some(session)
}

/// What the page takes, and tells, between one step and the next; and
/// what it keeps, now and then.
#[derive(Debug, Default)]
struct Frames {
    count: usize,
    exits: Vec<u8>,
    sounds: usize,
    calls: usize,
}

impl Frames {
    /// A frame of the page's: the input handed in, the run stepped for the
    /// frame's slice, and everything taken that the page takes.
    fn frame(&mut self, session: &mut Session, input: &[Input]) -> State {
        for event in input {
            event.hand(session);
        }

        // Slices of every length the page gives, from none at all.
        let slice = [0.0, 0.05, 1.0, 12.0][self.count % 4];
        let state = session.step(host_ms() + slice);

        self.count += 1;
        assert!(!session.present().is_empty());
        assert!(session.accessible_tree().starts_with('{'));
        self.calls += session
            .take_calls(self.count.is_multiple_of(2))
            .lines()
            .count();
        self.exits.extend(session.take_exits());
        self.sounds += session.take_sound().len();
        assert_eq!(session.size(), (640, 480));

        if state == State::Idle {
            assert!(session.wake_at().is_finite());
        }

        // What programs wrote, kept every few frames.
        if self.count.is_multiple_of(7) {
            session.changes('C');
        }

        state
    }

    /// Frames until `done` says so, the run stops, or it waits for a
    /// program; the input handed in at each. What the last came to.
    fn until(
        &mut self,
        session: &mut Session,
        input: &[Input],
        mut done: impl FnMut(&Session) -> bool,
    ) -> State {
        for _ in 0..20_000 {
            let state = self.frame(session, input);

            if matches!(state, State::Stopped | State::Waiting) || done(session) {
                return state;
            }
        }

        panic!("never done: {:?}", session.stop());
    }
}

/// The page's input, handed in at the start of a frame.
#[derive(Debug, Clone, Copy)]
enum Input {
    /// The mouse moved, over the desktop's corner.
    Move,
    /// A key pressed and let go that a program makes nothing of.
    Shift,
}

impl Input {
    fn hand(self, session: &Session) {
        match self {
            Input::Move => session.pointer(pointer_of(0, 630, 470, 0, 0, false)),
            Input::Shift => {
                let key = Key {
                    code: "ShiftLeft".to_string(),
                    key: "Shift".to_string(),
                    repeat: false,
                    alt: false,
                };

                session.key(true, &key);
                session.key(false, &key);
            }
        }
    }
}

/// The windows at the top with a title, as USER has them.
fn windows(session: &Session, title: &str) -> Vec<u16> {
    let system = session.system();

    system
        .top_level()
        .into_iter()
        .filter_map(|index| system.windows[index].as_ref())
        .filter(|window| window.title == title)
        .map(|window| window.hwnd)
        .collect()
}

/// Every window at the top asked to close, as its Close is chosen.
fn close(session: &Session, title: &str) {
    for hwnd in windows(session, title) {
        session.system().post_message(hwnd, WM_CLOSE, 0, 0);
    }
}

#[test]
fn programs_started_and_ended_between_the_pages_frames() {
    let Some(mut session) = machine(&["ADLIBMAP.EXE"]) else {
        return;
    };
    let mut frames = Frames::default();
    let input = [Input::Move, Input::Shift];

    // Nothing started, the machine waits.
    assert_eq!(frames.frame(&mut session, &input), State::Waiting);

    session.start("C:\\WINDOWS\\CLOCK.EXE").unwrap();
    frames.until(&mut session, &input, |session| {
        !windows(session, "Clock").is_empty()
    });

    // Started while Clock runs, between two frames: Notepad, twice.
    session.start("C:\\WINDOWS\\NOTEPAD.EXE").unwrap();
    frames.frame(&mut session, &input);
    session.start("C:\\WINDOWS\\NOTEPAD.EXE").unwrap();
    frames.until(&mut session, &input, |session| {
        windows(session, "Notepad - (Untitled)").len() == 2
    });
    assert_eq!(windows(&session, "Clock").len(), 1);

    // Each closed in turn, a frame apart; the last to end leaves Windows
    // up, the machine waiting for the next.
    close(&session, "Clock");
    frames.frame(&mut session, &input);
    close(&session, "Notepad - (Untitled)");

    assert_eq!(
        frames.until(&mut session, &input, |_| false),
        State::Waiting
    );
    assert_eq!(frames.exits, [0, 0, 0], "{frames:?}");
    assert_eq!(session.stop(), None);
    assert!(windows(&session, "Clock").is_empty());

    // Waiting, every look between frames goes on as before, and the next
    // runs on the same machine.
    assert_eq!(frames.frame(&mut session, &input), State::Waiting);
    session.start("C:\\WINDOWS\\CLOCK.EXE").unwrap();
    frames.until(&mut session, &input, |session| {
        !windows(session, "Clock").is_empty()
    });

    // Beside it, the probe that plays MIDI through the MIDI Mapper to the
    // FM chip: the page hears the chip, and the probe, as the oracle's
    // probes end, exits Windows, which ends the run.
    session.start("C:\\ORACLE\\ADLIBMAP.EXE").unwrap();

    let sounds = frames.sounds;

    assert_eq!(
        frames.until(&mut session, &input, |_| false),
        State::Stopped
    );
    assert_eq!(session.stop(), Some(&winbox_win16::Stop::Ended));
    assert!(frames.sounds > sounds, "{frames:?}");
    assert!(frames.calls > 0);

    // Over, the page still shows the screen and tells what was written.
    assert_eq!(frames.frame(&mut session, &input), State::Stopped);
    assert!(session.start("C:\\WINDOWS\\CLOCK.EXE").is_err());
}
