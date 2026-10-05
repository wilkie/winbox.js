//! WinBox's Windows 3.1 in a browser's page: the Rust engine built for
//! WebAssembly, its machine handed to JavaScript (`Machine`). The page
//! fills the machine's drives, starts a program, and steps its run between
//! its frames, handing in the mouse and keyboard between steps and taking
//! the screen, the sound and the calls made; or surveys a program on the
//! virtual clock, as the trace example does, to the same report.
//!
//! What is done is done in `session.rs`, in Rust alone, so it is tested
//! natively; here are only the names JavaScript calls it by.

pub mod session;

use wasm_bindgen::prelude::*;
use winbox_win16::audio::{MidiOutput, Sound};
use winbox_win16::key_input::Key;
use winbox_win16::survey::Survey;

use crate::session::{Made, Session};

#[wasm_bindgen]
extern "C" {
    /// The page's time in milliseconds, from when it loaded.
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;

    /// A moment of the page's calendar.
    #[wasm_bindgen(js_name = Date)]
    type JsDate;

    #[wasm_bindgen(constructor, js_class = Date)]
    fn new() -> JsDate;

    /// The minutes local time is behind universal time.
    #[wasm_bindgen(method, js_class = Date, js_name = getTimezoneOffset)]
    fn timezone_offset(this: &JsDate) -> f64;

    /// Milliseconds since 1970, universal time.
    #[wasm_bindgen(static_method_of = JsDate, js_class = Date, js_name = now)]
    fn now() -> f64;

    /// Where a panic is told, before the module traps.
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// The host's time as seconds since 1970, which a file written is stamped
/// with.
fn wall_seconds() -> i64 {
    (JsDate::now() / 1000.0).floor() as i64
}

/// A panic told to the page's console, with where it was, before the
/// module traps: a trap says nothing of why.
#[wasm_bindgen(start)]
fn started() {
    std::panic::set_hook(Box::new(|info| {
        console_error(&format!("winbox-web: {info}"));
    }));
}

/// A machine, run from a page.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Machine {
    session: Session,
}

/// What the sound card did, for the page to sound: `kind` `samples`,
/// `midi` or `silence`; `at`, in the machine's milliseconds; for samples
/// their `rate` a second, and for MIDI its `output` -- `port` or
/// `synthesizer` -- and both their `bytes`.
#[wasm_bindgen]
#[derive(Debug)]
pub struct SoundEvent {
    kind: &'static str,
    at: f64,
    rate: f64,
    output: &'static str,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl SoundEvent {
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn at(&self) -> f64 {
        self.at
    }

    #[wasm_bindgen(getter)]
    pub fn rate(&self) -> f64 {
        self.rate
    }

    #[wasm_bindgen(getter)]
    pub fn output(&self) -> String {
        self.output.to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
}

impl From<Sound> for SoundEvent {
    fn from(sound: Sound) -> Self {
        let name = |output| match output {
            MidiOutput::Port => "port",
            MidiOutput::Synthesizer => "synthesizer",
        };

        match sound {
            Sound::Samples { at, rate, samples } => Self {
                kind: "samples",
                at,
                rate,
                output: "",
                bytes: samples,
            },
            Sound::Midi { at, output, bytes } => Self {
                kind: "midi",
                at,
                rate: 0.0,
                output: name(output),
                bytes,
            },
            Sound::Silence { at, output } => Self {
                kind: "silence",
                at,
                rate: 0.0,
                output: name(output),
                bytes: Vec::new(),
            },
        }
    }
}

/// A screen a survey kept: its size, whether it is a box of USER's as it
/// came up, its palette indices and the colour each shows.
#[wasm_bindgen]
#[derive(Debug)]
pub struct KeptScreen {
    kept: session::Kept,
}

#[wasm_bindgen]
impl KeptScreen {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.kept.screen.width as u32
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.kept.screen.height as u32
    }

    #[wasm_bindgen(getter)]
    pub fn is_box(&self) -> bool {
        self.kept.is_box
    }

    /// Its palette indices, a byte a pixel, row by row.
    pub fn indices(&self) -> Vec<u8> {
        self.kept.screen.indices.clone()
    }

    /// The colour each index shows, a word `0x00RRGGBB` an index.
    pub fn colours(&self) -> Vec<u32> {
        self.kept.screen.colours.clone()
    }

    /// Its pixels as three bytes each, red, green and blue, row by row.
    pub fn rgb(&self) -> Vec<u8> {
        self.kept
            .screen
            .rgb()
            .iter()
            .flat_map(|&pixel| [(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8])
            .collect()
    }
}

/// A DOS drive's letter, as the page names it.
fn letter(drive: &str) -> char {
    drive.chars().next().unwrap_or('C')
}

#[wasm_bindgen]
impl Machine {
    /// A machine on a display, as winbox.js names it (`vga`, `ega`,
    /// `hercules`, `svga`, `vga256`), with a coprocessor or without, on the
    /// page's own clock.
    #[wasm_bindgen(constructor)]
    pub fn new(display: &str, coprocessor: bool) -> Result<Machine, JsError> {
        // Local time, as DOS keeps it.
        let epoch_ms = (JsDate::now() - JsDate::new().timezone_offset() * 60_000.0) as i64;
        let session = Session::new(Made {
            display,
            coprocessor,
            host: performance_now,
            wall: wall_seconds,
            epoch_ms,
        })
        .ok_or_else(|| JsError::new(&format!("no display {display}")))?;

        Ok(Self { session })
    }

    /// A file put on a drive, made where there is none yet: its DOS path
    /// there, its bytes, and when it was last written, in seconds since
    /// 1970. False where a folder is in the way.
    pub fn add_file(
        &mut self,
        drive: &str,
        dos_path: &str,
        bytes: Vec<u8>,
        mtime_secs: f64,
    ) -> bool {
        self.session
            .add_file(letter(drive), dos_path, bytes, mtime_secs as i64)
    }

    /// A folder put on a drive, last written at `mtime_secs`.
    pub fn add_folder(&mut self, drive: &str, dos_path: &str, mtime_secs: f64) -> bool {
        self.session
            .add_folder(letter(drive), dos_path, mtime_secs as i64)
    }

    /// A drive made, empty, where there is none yet.
    pub fn add_drive(&mut self, drive: &str) {
        self.session.drive(letter(drive));
    }

    /// WinBox's own sound driver named in `C:\WINDOWS\SYSTEM.INI`.
    pub fn install_sound(&mut self) -> bool {
        self.session.install_sound()
    }

    /// The program at a DOS path started, to be stepped.
    pub fn start(&mut self, path: &str) -> Result<(), JsError> {
        self.session
            .start(path)
            .map_err(|error| JsError::new(&error))
    }

    /// The run stepped until the page's time (`performance.now`) reaches
    /// `deadline_ms`: 0 busy, to be stepped again; 1 idle, to be stepped at
    /// `wake_at`; 2 stopped (`stop_reason`); 3 not started.
    pub fn step(&mut self, deadline_ms: f64) -> u32 {
        self.session.step(deadline_ms) as u32
    }

    /// When an idle run is to be stepped again, in the page's time.
    pub fn wake_at(&self) -> f64 {
        self.session.wake_at()
    }

    /// Why the run stopped, once it has.
    pub fn stop_reason(&self) -> Option<String> {
        self.session.stop().map(|stop| format!("{stop:?}"))
    }

    /// The code the program gave DOS as it ended, once it has.
    pub fn exit_code(&self) -> Option<u8> {
        self.session.exit_code()
    }

    /// The mouse: `kind` 0 a move, 1 a press, 2 a release; where on the
    /// screen; the button changed, as a page numbers it -- 0 left, 1
    /// middle, 2 right -- and those down, left 1, right 2, middle 4; and
    /// whether a press is a double click.
    pub fn pointer(&self, kind: u8, x: i16, y: i16, button: u8, buttons: u8, double: bool) {
        self.session
            .pointer(session::pointer_of(kind, x, y, button, buttons, double));
    }

    /// A key pressed or let go, as a page's keyboard event names it: its
    /// `code`, the `key` it types, whether it repeats, and whether Alt is
    /// held.
    pub fn key(&self, down: bool, code: &str, key: &str, repeat: bool, alt: bool) {
        self.session.key(
            down,
            &Key {
                code: code.to_string(),
                key: key.to_string(),
                repeat,
                alt,
            },
        );
    }

    pub fn width(&self) -> u32 {
        self.session.size().0 as u32
    }

    pub fn height(&self) -> u32 {
        self.session.size().1 as u32
    }

    /// The screen as it shows now, the cursor over it, as RGBA bytes in
    /// the module's memory: where they start. There are four a pixel, row
    /// by row, as `ImageData` takes them, until the next call.
    pub fn present(&mut self) -> *const u8 {
        self.session.present().as_ptr()
    }

    /// The screen's palette indices as it shows now, the cursor over them.
    pub fn indices(&self) -> Vec<u8> {
        self.session.shown().indices
    }

    /// The colour each palette index shows now, a word `0x00RRGGBB` each.
    pub fn palette(&self) -> Vec<u32> {
        self.session.shown().colours
    }

    /// USER's windows as an accessibility tree, as JSON: the tree the
    /// TypeScript engine's `accessibleTree` makes, written as its
    /// `JSON.stringify` writes it, for a page's mirror to read.
    pub fn accessible_tree(&self) -> String {
        self.session.accessible_tree()
    }

    /// What the sound card has done since this was last asked.
    pub fn take_sound(&self) -> Vec<SoundEvent> {
        self.session
            .take_sound()
            .into_iter()
            .map(SoundEvent::from)
            .collect()
    }

    /// The calls made since this was last asked, a line each, as the
    /// trace prints them; with `counts`, the instructions run at each.
    pub fn take_calls(&mut self, counts: bool) -> String {
        self.session.take_calls(counts)
    }

    /// The program at a DOS path surveyed on a machine of its own, on the
    /// virtual clock, as the trace example surveys it: what the trace
    /// prints. The options are JSON, each field named as the survey's
    /// (`display`, `seconds`, `budget`, `calls`, `boxes`, `marks` -- a
    /// report's text --, `input`, `summary`, `counts`, `screens`). The
    /// program's file is `program`, where given, which need not be on the
    /// drive, as the trace example reads it from the host's.
    pub fn survey(
        &mut self,
        options_json: &str,
        program_path: &str,
        program: Option<Vec<u8>>,
    ) -> Result<String, JsError> {
        let asked: Survey =
            serde_json::from_str(options_json).map_err(|error| JsError::new(&error.to_string()))?;

        self.session
            .survey(&asked, program_path, program)
            .map_err(|error| JsError::new(&error))
    }

    /// The screens the last survey kept: the screen, or each kept at the
    /// report's marks, then each box of USER's as it came up.
    pub fn survey_screens(&self) -> Vec<KeptScreen> {
        self.session
            .kept()
            .iter()
            .map(|kept| KeptScreen { kept: kept.clone() })
            .collect()
    }
}
