//! A machine as a browser's page runs it, in Rust alone, so that it can be
//! tested natively: its drives held in memory, filled from the page before
//! the program starts; the program run a step at a time, between the
//! page's frames, on the host's own clock, never blocking; the screen made
//! into the RGBA bytes a canvas takes; what the sound card does, and the
//! calls the program made, kept for the page to take. And the corpus's
//! survey, on the virtual clock, as the trace example runs it.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::rc::Rc;

use winbox_machine::{Change, Clock, HostTime, MemoryDrive, WallTime};
use winbox_ne::Executable;
use winbox_win16::audio::Sound;
use winbox_win16::engine::{EngineRun, Pace, Step};
use winbox_win16::host::{Host, HostSlot};
use winbox_win16::key_input::Key;
use winbox_win16::raster_input::{Pointer, PointerKind};
use winbox_win16::survey::{self, Screen, Survey};
use winbox_win16::tasks::Launch;
use winbox_win16::{Engine, Stop, System};

/// The host as the page is to the machine: it shows the screen when it
/// asks for it (`Session::present`), between steps, and hands in its input
/// there too, so a frame has nothing to do but say the machine goes on;
/// what the sound card does is kept for the page to sound.
struct WebHost {
    sounds: Rc<RefCell<VecDeque<Sound>>>,
}

impl Host for WebHost {
    fn frame(&mut self, _: &mut System) -> bool {
        true
    }

    fn sound(&mut self, sound: &Sound) {
        self.sounds.borrow_mut().push_back(sound.clone());
    }
}

/// Where a run stepped is, as the page is told it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// The step's deadline came with the run going on: step it again.
    Busy = 0,
    /// Everything waits for the host's time: step it again at `wake_at`.
    Idle = 1,
    /// The run is over (`Session::stop`).
    Stopped = 2,
    /// No program has started; or, with Windows staying up
    /// (`Session::stay_up`), every program has ended, and the machine waits
    /// for the next (`Session::start`).
    Waiting = 3,
}

/// How the machine is made: its display, as winbox.js names it, whether
/// it has a coprocessor, and the host's clocks.
#[derive(Debug, Clone, Copy)]
pub struct Made<'a> {
    pub display: &'a str,
    pub coprocessor: bool,
    /// The host's time in milliseconds, from a start of its own.
    pub host: HostTime,
    /// The host's time in seconds since 1970, which a file written is
    /// stamped with.
    pub wall: WallTime,
    /// When the machine's clock begins, in local milliseconds since 1970.
    pub epoch_ms: i64,
}

/// A kept screen of the survey's, and whether it is a box of USER's.
#[derive(Debug, Clone)]
pub struct Kept {
    pub screen: Screen,
    pub is_box: bool,
}

/// A machine as a page runs it.
pub struct Session {
    engine: Rc<Engine>,
    run: Option<EngineRun>,
    /// The drives as the page fills them, by letter: mounted as they are
    /// when the program starts, and for each survey.
    drives: BTreeMap<char, MemoryDrive>,
    /// The drives as the page planned them, before it put back what was
    /// written on them before (`mark_planned`): what a drive's changes
    /// are told against (`changes`).
    planned: BTreeMap<char, MemoryDrive>,
    made: (String, bool, HostTime, WallTime),
    /// The screen as RGBA bytes, as the page last asked for it.
    rgba: Vec<u8>,
    sounds: Rc<RefCell<VecDeque<Sound>>>,
    /// How many of the calls logged the page has looked at.
    read: usize,
    /// Those looked at that waited to be answered, to be taken once they
    /// are: one task's wait for a message holds back no other's calls.
    unanswered: Vec<usize>,
    /// The tasks whose end the page has been told of, by their slots.
    told: BTreeSet<usize>,
    /// When the run, all waiting, is to be stepped again, in the host's
    /// milliseconds.
    wake_at: f64,
    stop: Option<Stop>,
    /// The last survey's screens.
    kept: Vec<Kept>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Session")
            .field("drives", &self.drives.keys().collect::<Vec<_>>())
            .field("stop", &self.stop)
            .finish_non_exhaustive()
    }
}

/// A DOS path's drive's letter, upper case, and the rest of it.
fn split_path(path: &str) -> Option<(char, &str)> {
    let mut chars = path.chars();
    let letter = chars.next()?.to_ascii_uppercase();

    (letter.is_ascii_alphabetic() && chars.next() == Some(':')).then(|| (letter, &path[2..]))
}

impl Session {
    /// A machine on the display named; none where winbox.js knows no such
    /// display.
    pub fn new(made: Made<'_>) -> Option<Self> {
        let mut system = System::new();
        let sounds = Rc::default();

        system.display = winbox_win16::display::mode(made.display)?;
        system.coprocessor = made.coprocessor;
        // The host's own time: a program runs as fast as the page runs it,
        // and its timers come due as the host's clock passes them.
        system.clock = Clock::real_with(made.host);
        system.epoch_ms = made.epoch_ms;
        // A host there, as a page is: a box of USER's then takes the
        // page's input (`sys_error_box.rs`).
        system.host = Some(HostSlot::new(Box::new(WebHost {
            sounds: Rc::clone(&sounds),
        })));

        let engine = Rc::new(Engine::new(system));

        engine.set_pace(Pace::Yielding);

        Some(Self {
            engine,
            run: None,
            drives: BTreeMap::new(),
            planned: BTreeMap::new(),
            made: (
                made.display.to_string(),
                made.coprocessor,
                made.host,
                made.wall,
            ),
            rgba: Vec::new(),
            sounds,
            read: 0,
            unanswered: Vec::new(),
            told: BTreeSet::new(),
            wake_at: 0.0,
            stop: None,
            kept: Vec::new(),
        })
    }

    /// Windows kept up once the last program has ended, as the page keeps
    /// it: the last ends as the others do, its windows taken away as
    /// Windows takes a task's away as it ends it, its code told with
    /// theirs (`take_exits`); and the run waits (`State::Waiting`) for the
    /// next started, which runs on the same machine. As the TypeScript
    /// engine's `Win16` stays, with its desktop, once its last task has
    /// ended. Without it, as the trace and the survey run a program, the
    /// run is over with the last (`stop`), its last screen kept.
    pub fn stay_up(&mut self) {
        self.engine.system().stays_up = true;
    }

    /// A drive, made empty where there is none yet: A: and B: removable,
    /// as floppies are.
    pub fn drive(&mut self, letter: char) -> &mut MemoryDrive {
        let letter = letter.to_ascii_uppercase();
        let wall = self.made.3;

        self.drives.entry(letter).or_insert_with(|| {
            let mut drive = if matches!(letter, 'A' | 'B') {
                MemoryDrive::removable()
            } else {
                MemoryDrive::new()
            };

            drive.set_clock(wall);
            drive
        })
    }

    /// A file put on a drive, as a DOS path names it there, last written
    /// at `modified`, seconds since 1970. False where a folder is in the
    /// way.
    pub fn add_file(&mut self, letter: char, path: &str, data: Vec<u8>, modified: i64) -> bool {
        self.drive(letter).add_file(path, data, modified)
    }

    /// A folder put on a drive, last written at `modified`.
    pub fn add_folder(&mut self, letter: char, path: &str, modified: i64) -> bool {
        self.drive(letter).add_folder(path, modified)
    }

    /// A file or a folder, with everything in it, let go of from a drive;
    /// false where nothing is there.
    pub fn remove(&mut self, letter: char, path: &str) -> bool {
        self.drive(letter).remove(path)
    }

    /// The drives as they are filled now kept as the page planned them:
    /// what each drive's changes are told against from now on
    /// (`changes`). The page marks them once it has put on them what was
    /// dropped, before it puts back what programs wrote before.
    pub fn mark_planned(&mut self) {
        self.planned = self.drives.clone();
    }

    /// What differs on a drive from the drive as planned (`mark_planned`):
    /// once a program has started, the drive it writes; until then, the
    /// drive as the page fills it. A file a program has open is told as it
    /// stands.
    pub fn changes(&self, letter: char) -> Vec<Change> {
        let letter = letter.to_ascii_uppercase();
        let empty = MemoryDrive::new();
        let planned = self.planned.get(&letter).unwrap_or(&empty);

        if self.run.is_some() {
            let system = self.engine.system();

            return system
                .files
                .memory(letter)
                .map_or_else(Vec::new, |drive| drive.changes_from(planned));
        }

        self.drives
            .get(&letter)
            .map_or_else(Vec::new, |drive| drive.changes_from(planned))
    }

    /// WinBox's own sound driver named in `C:\WINDOWS\SYSTEM.INI`'s
    /// `[drivers]`, as Control Panel names a card's. False where there is
    /// no `SYSTEM.INI` to name it in. The card is the machine's, as the
    /// page sets it, and not a program's change: it is named in the
    /// planned drive's too, so the file is told as changed only where a
    /// program has written it as well.
    pub fn install_sound(&mut self) -> bool {
        const PATH: &str = "WINDOWS\\SYSTEM.INI";

        let drive = self.drive('C');
        let Some(text) = drive.data(PATH) else {
            return false;
        };
        let modified = (self.made.3)();

        if let Some(planned) = self.planned.get_mut(&'C')
            && let Some(was) = planned.data(PATH)
        {
            planned.add_file(PATH, winbox_win16::wbsound::install(&was), modified);
        }

        self.drive('C')
            .add_file(PATH, winbox_win16::wbsound::install(&text), modified)
    }

    /// A program's file, by its DOS path, parsed.
    fn executable(&self, path: &str) -> Result<Executable, String> {
        let (letter, rest) = split_path(path).ok_or_else(|| format!("no drive in {path}"))?;
        let bytes = self
            .drives
            .get(&letter)
            .and_then(|drive| drive.data(rest))
            .ok_or_else(|| format!("no file {path}"))?;

        Executable::parse(bytes.as_ref().clone())
            .map_err(|error| format!("{path} is not a New Executable: {error:?}"))
    }

    /// The drives mounted on a system, each sharing the page's files until
    /// the program writes one.
    fn mount(&self, system: &mut System) {
        for (&letter, drive) in &self.drives {
            system.files.mount(letter, drive.clone());
        }
    }

    /// The program at `path`, as DOS names it, loaded, linked and started
    /// in its own folder, its calls logged, and its run begun: stepped
    /// from now on (`step`). The drives are mounted as they are now. Once
    /// a program has started, another is started beside it (`launch`).
    pub fn start(&mut self, path: &str) -> Result<(), String> {
        if self.run.is_some() {
            return self.launch(path).map(|_| ());
        }

        let executable = self.executable(path)?;

        {
            let mut system = self.engine.system();

            self.mount(&mut system);
            system.log = Some(Vec::new());
            survey::start(&mut system, executable, path)
                .map_err(|exit| format!("the program's registers: {exit:?}"))?;
        }

        self.run = Some(self.engine.begin(u64::MAX / 2, f64::INFINITY));
        Ok(())
    }

    /// The program at `path` started on the machine running, beside the
    /// programs there, as Program Manager starts one (`System::launch`):
    /// a task of its own, sharing USER, GDI and the drives with the others
    /// -- a second instance of a program given the first as its previous
    /// one -- and taken up by the run as the next step begins. The run
    /// goes on until every task has ended. Its task's handle.
    pub fn launch(&mut self, path: &str) -> Result<u16, String> {
        if self.run.is_none() {
            return Err("no program has started".to_string());
        }

        if self.stop.is_some() {
            return Err("the run is over".to_string());
        }

        self.engine
            .system()
            .launch(path)
            .map_err(|launch| match launch {
                Launch::First => "no program has started".to_string(),
                Launch::Dos(2) => format!("no file {path}"),
                Launch::Dos(11) => format!("{path} is not a New Executable"),
                Launch::Dos(error) => format!("DOS error {error}"),
                Launch::Stopped(stop) => format!("the program's registers: {stop:?}"),
            })
    }

    /// The codes the tasks gave DOS as they ended, each told once, since
    /// this was last asked -- 255 for one that faulted: those that ended
    /// with others left to run on, and, with Windows staying up
    /// (`stay_up`), the last too. Otherwise the last's end is the run's
    /// (`stop`, `exit_code`).
    pub fn take_exits(&mut self) -> Vec<u8> {
        let system = self.engine.system();
        let mut codes = Vec::new();

        for (slot, task) in system.scheduler.slots.iter().enumerate() {
            if let Some(code) = task.exit_code
                && task.ended
                && self.told.insert(slot)
            {
                codes.push(code);
            }
        }

        codes
    }

    /// The run, until the host's time reaches `deadline`, in its
    /// milliseconds; or until everything waits for the host's time; or
    /// until it is over.
    pub fn step(&mut self, deadline: f64) -> State {
        let Some(run) = self.run.as_mut() else {
            return State::Waiting;
        };

        match run.step(deadline) {
            Step::Busy => State::Busy,
            Step::Idle { wake_at } if wake_at.is_infinite() => State::Waiting,
            Step::Idle { wake_at } => {
                self.wake_at = wake_at;
                State::Idle
            }
            Step::Stopped(stop) => {
                self.stop = Some(stop);
                State::Stopped
            }
        }
    }

    /// The system, for as long as this is held, as a test looks into it.
    pub fn system(&self) -> std::cell::RefMut<'_, System> {
        self.engine.system()
    }

    /// When an idle run is to be stepped again, in the host's milliseconds.
    pub fn wake_at(&self) -> f64 {
        self.wake_at
    }

    /// Why the run stopped, once it has.
    pub fn stop(&self) -> Option<&Stop> {
        self.stop.as_ref()
    }

    /// The code the program gave DOS as it ended, once it has.
    pub fn exit_code(&self) -> Option<u8> {
        self.engine.system().exit_code
    }

    /// The mouse, as the page's pointer events give it.
    pub fn pointer(&self, pointer: Pointer) {
        self.engine.system().pointer_event(pointer);
    }

    /// A key, as the page's keyboard events give it.
    pub fn key(&self, down: bool, key: &Key) {
        self.engine.system().key_event(down, key);
    }

    /// The screen's size, in pixels.
    pub fn size(&self) -> (usize, usize) {
        let system = self.engine.system();

        (
            usize::try_from(system.display.width).unwrap_or(0),
            usize::try_from(system.display.height).unwrap_or(0),
        )
    }

    /// The screen as it shows now, the cursor over it: four bytes a pixel,
    /// red, green, blue and an opaque alpha, row by row, as a canvas's
    /// `ImageData` takes them.
    pub fn present(&mut self) -> &[u8] {
        let (_, _, pixels) = self.engine.system().screen_rgb();

        self.rgba.clear();
        self.rgba.extend(
            pixels
                .iter()
                .flat_map(|&pixel| [(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8, 0xff]),
        );
        &self.rgba
    }

    /// The screen as it shows now: its palette indices, the cursor over
    /// them, and the colour each index shows, a word `0x00RRGGBB` an index.
    pub fn shown(&self) -> Screen {
        let mut system = self.engine.system();
        let screen = system.screen_bitmap();
        let indices = screen.indices.borrow().clone();

        Screen::shown(&mut system, &indices)
    }

    /// USER's windows as an accessibility tree, as JSON, as the TypeScript
    /// engine's `accessibleTree` is written (`accessible_tree.rs`).
    pub fn accessible_tree(&self) -> String {
        self.engine.system().accessible_tree_json()
    }

    /// What the sound card has done since this was last asked.
    pub fn take_sound(&self) -> Vec<Sound> {
        self.sounds.borrow_mut().drain(..).collect()
    }

    /// The calls the programs have made since this was last asked, a line
    /// each, as the trace prints them, each once it is answered: one that
    /// waits -- for a message, say -- is taken when it returns, and those
    /// made meanwhile, by its task or another, are taken before it. Once
    /// the run is over, every call is taken.
    pub fn take_calls(&mut self, counts: bool) -> String {
        let system = self.engine.system();
        let Some(log) = system.log.as_deref() else {
            return String::new();
        };
        let over = self.stop.is_some();
        let mut out = String::new();
        let waited = std::mem::take(&mut self.unanswered);

        for at in waited.into_iter().chain(self.read..log.len()) {
            let call = &log[at];

            if call.answered || over {
                out.push_str(&survey::call_line(call, counts));
                out.push('\n');
            } else {
                self.unanswered.push(at);
            }
        }

        self.read = log.len();
        out
    }

    /// The program at `path` surveyed, as the trace example surveys it: a
    /// machine of its own, on the virtual clock, its drives the page's as
    /// they are now, run to its end. Its file is `program`, where given,
    /// as the trace example reads it from the host's, which need not be on
    /// the drive; else the drive's at `path`. What the trace prints; the
    /// screens it kept are kept until the next (`kept`).
    pub fn survey(
        &mut self,
        asked: &Survey,
        path: &str,
        program: Option<Vec<u8>>,
    ) -> Result<String, String> {
        let executable = match program {
            Some(bytes) => Executable::parse(bytes)
                .map_err(|error| format!("{path} is not a New Executable: {error:?}"))?,
            None => self.executable(path)?,
        };
        let mut system = asked
            .system()
            .ok_or_else(|| format!("no display {}", asked.display))?;

        system.coprocessor = self.made.1;
        // The virtual clock never reads the host's time; what reads it is
        // given the page's, as no other can be read here.
        system.clock.set_host(self.made.2);
        self.mount(&mut system);
        survey::start(&mut system, executable, path)
            .map_err(|exit| format!("the program's registers: {exit:?}"))?;

        let surveyed = asked.run(system);

        self.kept = surveyed
            .screens
            .into_iter()
            .map(|screen| Kept {
                screen,
                is_box: false,
            })
            .chain(surveyed.boxes.into_iter().map(|screen| Kept {
                screen,
                is_box: true,
            }))
            .collect();
        Ok(surveyed.report)
    }

    /// The last survey's screens: those it kept, then each box of USER's
    /// as it came up.
    pub fn kept(&self) -> &[Kept] {
        &self.kept
    }
}

/// A pointer event, its kind as a number: 0 a move, 1 a press, 2 a
/// release.
pub fn pointer_of(kind: u8, x: i16, y: i16, button: u8, buttons: u8, double: bool) -> Pointer {
    Pointer {
        kind: match kind {
            1 => PointerKind::Down,
            2 => PointerKind::Up,
            _ => PointerKind::Move,
        },
        x,
        y,
        button,
        buttons,
        double,
    }
}
