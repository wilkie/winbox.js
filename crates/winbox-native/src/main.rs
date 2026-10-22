//! winbox.js's Windows 3.1 run natively: a program loaded, linked and run
//! on the Rust engine, its screen shown in a window of the host's and the
//! host's mouse and keyboard handed to its windows, as the page does with
//! its canvas.
//!
//! `winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR | --assets FILE.zip|DIR] [--display
//! vga|ega|hercules|svga|vga256|8514|8514s|xga256|xga256s|xga640] [--resolution WxH] [--scale N]
//! [--path C:\PROGRAM.EXE] [--shot FILE [--shot-seconds N]] [--sound [--sound-dump FILE.wav]]
//! [--seamless [--seamless-shots DIR] [--seamless-log FILE] [--script FILE]]`
//!
//! `winbox-native --program NAME [C:\PATH.EXE] (--windows DIR | --assets FILE.zip|DIR) [...]`,
//! `--install NAME MEDIA [SETUP.EXE] (...) [--keep]`, `--layer-from DIR|LAYER.zip NAME (...)`:
//! programs kept as layers of drive C: (`programs.rs`, `kb/formats/layer.md`).
//!
//! Desktop mode, the default, shows the whole screen, desktop and all, in
//! one window. `--seamless` shows each window at the top as a window of
//! the host's and no desktop (`seamless_host.rs`;
//! `kb/guides/seamless-windows.md`): the engine draws exactly as in
//! desktop mode, and each host's window shows its window's rectangle of
//! that one screen. The screen is the host's desktop -- one rectangle
//! around every monitor's work area, read before the program starts --
//! divided by a whole scale, rounded down: `--scale`, else the one whose
//! width comes nearest `--resolution`'s, else the smallest keeping the
//! screen within 2048 a side and at least the monitor's own scale. The
//! program sees a WinBox screen of that size over the display mode
//! (`System::set_screen_size`). In desktop mode `--resolution` makes the
//! screen exactly that size, and `--scale` enlarges the window; without
//! them it is the display's own size, as always. On Windows the host's drag
//! moves and sizes the windows; on X, USER's own loop does. `--seamless-shots` saves each
//! host's window's pixels, from this program's own buffers, and a
//! `windows.json` of where each is, `--shot-seconds` in and at a script's
//! `shots`; `--seamless-log` writes what was done with the host's windows,
//! frame by frame; `--script` plays steps at set times (`script.rs`).
//!
//! `--windows` is an installed Windows 3.1 directory, read and never
//! written, beneath drive C: (`oracle/build/drive-c`): its display driver
//! and fonts draw the screen. `--assets` is WinBox's asset bundle in its
//! place, `winbox-assets.zip` or the folder it was unpacked into
//! (`kb/topics/asset-bundle.md`): the base of C: it composes for the
//! display is written once into the host's cache folder, `winbox/base-<id>-<display>`,
//! and is beneath C: as an installation is; the display driver's, USER's
//! and SHELL's resources are read from its modules. The two are not given
//! together. `--drive` is the host directory that is drive
//! C: itself, else one made for the run, and removed after it, with a copy
//! of the program's folder where `--path` puts it -- `C:\` and its file's
//! name by default. A `--drive` over a base keeps what is deleted of the
//! base from run to run, in the cache folder's `winbox/drives/<sha256 of
//! its path>.removed` (`HostDrive::keeping_removed`).
//!
//! `--program NAME` runs a program kept: drive C: is its base, its layers
//! over it, each materialised once into `winbox/layer-<stack id>`, and its
//! user's layer, `winbox/users/NAME/C`, on top, what it deletes beneath kept
//! in `removed` beside it; the `.EXE` named, else the program's only one.
//! Its display is its own; another is refused, as is another base.
//! `--install NAME MEDIA` runs an installer -- `SETUP.EXE`, or the one
//! named, in the media, a folder or a zip archive, put at `C:\WBSETUP` --
//! over the program's stack (none yet: the base) beneath an empty top in
//! `winbox/staging`; as the run ends, `--keep` or the console keeps what
//! it left, all of the media's path dropped, as a layer of the program, made in
//! turn over its layers. `--layer-from` puts a layer of the user's own
//! files, laid out as C: has them, or a layer's exchange zip, on a
//! program's stack. `--shot` saves the screen as it shows five seconds in,
//! a binary PPM, or `--shot-seconds` in. `--sound` installs winbox.js's
//! own sound card driver, writing `C:\WINDOWS\SYSTEM.INI` with it named in
//! `[drivers]` onto the drive, and the MIDI Mapper's setups in
//! `C:\WINDOWS\SYSTEM\MIDIMAP.CFG`, "Ad Lib", Windows' default, current,
//! where the drive has none of its own, and plays what the card plays
//! through the host's speakers (`speaker.rs`), naming the device on the
//! standard error; `--sound-dump` keeps what the speakers are handed, as a
//! WAV file, and implies `--sound`.
//!
//! Under WSL the window is opened on X, not Wayland (`event_loop`), which
//! needs `libxkbcommon-x11-0` installed.
//!
//! It is built for Windows as well, `--target x86_64-pc-windows-gnu` with
//! MinGW-w64's linker (`pnpm build:native:windows`): an `.exe` that imports
//! only Windows' own DLLs.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

mod host_os;
mod input;
mod programs;
mod script;
mod seamless;
mod seamless_host;
mod speaker;

use softbuffer::{Context, Surface};
use winbox_machine::{Body, Clock, HostDrive, Volume};
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::host::{Host, HostSlot};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowId};

use input::{Input, Inputs};

/// What a run is of: a program's file of the host's, a program kept, an
/// installer run into a layer, or a layer made and kept.
enum Mode {
    /// `PROGRAM.EXE`: a file of the host's, put on C: for the run.
    File(PathBuf),
    /// `--program NAME [C:\PATH.EXE]`: a program kept, on its stack.
    Program { name: String, exe: Option<String> },
    /// `--install NAME MEDIA [SETUP.EXE]`: an installer run over a
    /// program's stack, what it left kept as a layer of it.
    Install {
        name: String,
        media: PathBuf,
        setup: Option<String>,
    },
    /// `--layer-from DIR|ZIP NAME`: a layer of the user's own files, or an
    /// exchange zip, put on a program's stack.
    LayerFrom { from: PathBuf, name: String },
}

/// What the command line asks for.
struct Options {
    mode: Mode,
    drive: Option<PathBuf>,
    path: Option<String>,
    windows: Option<PathBuf>,
    /// The asset bundle, `winbox-assets.zip` or the folder it was unpacked
    /// into, in the installation's place.
    assets: Option<PathBuf>,
    /// The display mode; a kept program's own where none is given.
    display: Option<String>,
    /// What an installer left kept without asking.
    keep: bool,
    shot: Option<PathBuf>,
    shot_seconds: u64,
    sound: bool,
    /// Where to keep what the host's speakers are handed (`speaker.rs`).
    sound_dump: Option<PathBuf>,
    /// Seamless mode: a window of the host's for each window at the top,
    /// each pixel of the screen `scale` of the host's square; its windows'
    /// pixels and places saved into `seamless_shots`, and a `script` run.
    seamless: bool,
    scale: Option<u32>,
    /// The screen's size: desktop mode's exactly, seamless mode's width
    /// the one its scale is chosen to come nearest.
    resolution: Option<(i16, i16)>,
    seamless_shots: Option<PathBuf>,
    /// What seamless mode did with the host's windows, frame by frame.
    seamless_log: Option<PathBuf>,
    script: Option<PathBuf>,
}

const USAGE: &str = r"winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR | --assets FILE.zip|DIR] [--display MODE] [--resolution WxH] [--scale N] [--path C:\PROGRAM.EXE] [--shot FILE] [--sound [--sound-dump FILE.wav]] [--seamless [--seamless-shots DIR] [--seamless-log FILE] [--script FILE]]
winbox-native --program NAME [C:\PATH.EXE] (--windows DIR | --assets FILE.zip|DIR) [--display MODE] [and a run's switches]
winbox-native --install NAME MEDIA [SETUP.EXE] (--windows DIR | --assets FILE.zip|DIR) [--display MODE] [--keep] [and a run's switches]
winbox-native --layer-from DIR|LAYER.zip NAME (--windows DIR | --assets FILE.zip|DIR) [--display MODE]";

fn usage() -> ! {
    eprintln!("{USAGE}");
    std::process::exit(2);
}

/// Said, and the run ended.
fn refuse(what: &str) -> ! {
    eprintln!("{what}");
    std::process::exit(2);
}

#[allow(clippy::too_many_lines)]
fn options() -> Options {
    let mut arguments = std::env::args().skip(1).peekable();
    let mut file = None;
    let mut mode = None;
    let mut options = Options {
        mode: Mode::File(PathBuf::new()),
        drive: None,
        path: None,
        windows: None,
        assets: None,
        display: None,
        keep: false,
        shot: None,
        shot_seconds: 5,
        sound: false,
        sound_dump: None,
        seamless: false,
        scale: None,
        resolution: None,
        seamless_shots: None,
        seamless_log: None,
        script: None,
    };

    while let Some(argument) = arguments.next() {
        // An argument that follows, where it is not a switch.
        let mut operand = || arguments.next_if(|argument| !argument.starts_with("--"));

        match argument.as_str() {
            "--program" => {
                let name = operand().unwrap_or_else(|| usage());
                let exe = operand();

                mode = Some(Mode::Program { name, exe });
            }
            "--install" => {
                let name = operand().unwrap_or_else(|| usage());
                let media = operand().unwrap_or_else(|| usage());
                let setup = operand();

                mode = Some(Mode::Install {
                    name,
                    media: PathBuf::from(media),
                    setup,
                });
            }
            "--layer-from" => {
                let from = operand().unwrap_or_else(|| usage());
                let name = operand().unwrap_or_else(|| usage());

                mode = Some(Mode::LayerFrom {
                    from: PathBuf::from(from),
                    name,
                });
            }
            "--keep" => options.keep = true,
            "--drive" => options.drive = arguments.next().map(PathBuf::from),
            "--path" => options.path = arguments.next(),
            "--windows" => options.windows = arguments.next().map(PathBuf::from),
            "--assets" => options.assets = arguments.next().map(PathBuf::from),
            "--shot" => options.shot = arguments.next().map(PathBuf::from),
            "--shot-seconds" => {
                options.shot_seconds = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(options.shot_seconds);
            }
            "--sound" => options.sound = true,
            "--sound-dump" => {
                options.sound = true;
                options.sound_dump = arguments.next().map(PathBuf::from);
            }
            "--seamless" => options.seamless = true,
            "--scale" => options.scale = arguments.next().and_then(|n| n.parse().ok()),
            "--resolution" => {
                options.resolution = arguments.next().and_then(|size| {
                    let (width, height) = size.split_once(['x', 'X'])?;

                    Some((width.parse().ok()?, height.parse().ok()?))
                });
            }
            "--seamless-shots" => options.seamless_shots = arguments.next().map(PathBuf::from),
            "--seamless-log" => options.seamless_log = arguments.next().map(PathBuf::from),
            "--script" => options.script = arguments.next().map(PathBuf::from),
            "--display" => options.display = arguments.next(),
            _ => file = Some(PathBuf::from(argument)),
        }
    }

    if options.windows.is_some() && options.assets.is_some() {
        refuse("--windows and --assets each give drive C: its base: give one, not both");
    }

    let mode = match (mode, file) {
        (Some(_), Some(file)) => refuse(&format!(
            "{}: a kept program is run, an installer run or a layer made without a program's file",
            file.display()
        )),
        (Some(mode), None) => mode,
        (None, Some(file)) => Mode::File(file),
        (None, None) => usage(),
    };

    if !matches!(mode, Mode::File(_)) {
        if options.drive.is_some() || options.path.is_some() {
            refuse("--drive and --path are for a program's file: a kept program's C: is its stack");
        }

        if options.windows.is_none() && options.assets.is_none() {
            refuse("a kept program's layers lie over a base: give --assets or --windows");
        }
    }

    Options { mode, ..options }
}

/// A question answered on the console: yes or no, else `default`, as it
/// is where nothing can be read.
fn ask(question: &str, default: bool) -> bool {
    use std::io::Write as _;

    eprint!("{question} [{}] ", if default { "Y/n" } else { "y/N" });
    let _ = std::io::stderr().flush();

    let mut line = String::new();

    match std::io::stdin().read_line(&mut line) {
        Ok(0) | Err(_) => default,
        Ok(_) => match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => true,
            "n" | "no" => false,
            _ => default,
        },
    }
}

/// The host's event loop: under WSL, on X -- WSLg's XWayland -- even where
/// Wayland is offered, as WSLg's own compositor (Weston, with its RDP shell)
/// has been seen to crash a second after a winit window of ours is shown on
/// it, which a client sees as its connection reset. X needs
/// `libxkbcommon-x11` (`libxkbcommon-x11-0`).
fn event_loop() -> EventLoop<()> {
    let mut builder = EventLoop::builder();

    #[cfg(target_os = "linux")]
    if std::env::var_os("WSL_DISTRO_NAME").is_some() && std::env::var_os("DISPLAY").is_some() {
        winit::platform::x11::EventLoopBuilderExtX11::with_x11(&mut builder);
    }

    builder.build().expect("the host's event loop")
}

/// A folder copied where the drive's folder is, and every folder in it.
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

/// The host: a window of the host's showing the screen, and its events
/// handed in as Windows' input.
struct Native {
    events: EventLoop<()>,
    app: App,
    /// Where to save the screen, how many seconds in, and when the run
    /// started.
    shot: Option<PathBuf>,
    shot_seconds: u64,
    started: Instant,
    /// The host's speakers, where the run has a sound card.
    speaker: Option<speaker::Speaker>,
}

/// The screen saved as a binary PPM.
fn save_shot(file: &Path, width: usize, height: usize, pixels: &[u32]) {
    let mut bytes = format!("P6\n{width} {height}\n255\n").into_bytes();

    for &pixel in pixels {
        bytes.extend_from_slice(&[(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8]);
    }

    if let Err(error) = std::fs::write(file, bytes) {
        eprintln!("the shot: {error}");
    }
}

/// What winit's events are handed to.
#[derive(Default)]
struct App {
    window: Option<Rc<Window>>,
    surface: Option<Surface<Rc<Window>, Rc<Window>>>,
    /// The screen's size, as the window was made for it, and the window's
    /// in the host's pixels where `--scale` gives it.
    screen: (u32, u32),
    window_size: Option<(u32, u32)>,
    /// The window's size, in its pixels.
    size: (u32, u32),
    /// The mouse and keyboard, and what they did since the machine was
    /// last given them.
    inputs: Inputs,
    closing: bool,
}

impl App {
    /// A point of the window as a point of the screen, however large the
    /// window is drawn.
    fn on_screen(&self, position: PhysicalPosition<f64>) -> (i16, i16) {
        let (width, height) = (f64::from(self.size.0.max(1)), f64::from(self.size.1.max(1)));
        let x = (position.x * f64::from(self.screen.0) / width).floor();
        let y = (position.y * f64::from(self.screen.1) / height).floor();

        (x as i16, y as i16)
    }

    /// The screen's pixels put in the window, each as large as the window
    /// makes it.
    fn show(&mut self, width: usize, height: usize, pixels: &[u32]) {
        let Some(surface) = self.surface.as_mut() else {
            return;
        };
        let (Some(out_width), Some(out_height)) =
            (NonZeroU32::new(self.size.0), NonZeroU32::new(self.size.1))
        else {
            return;
        };

        if surface.resize(out_width, out_height).is_err() {
            return;
        }

        let Ok(mut buffer) = surface.buffer_mut() else {
            return;
        };
        let (out_width, out_height) = (self.size.0 as usize, self.size.1 as usize);

        for row in 0..out_height {
            let from = (row * height / out_height) * width;

            for column in 0..out_width {
                buffer[row * out_width + column] = pixels[from + column * width / out_width];
            }
        }

        let _ = buffer.present();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let attributes = Window::default_attributes().with_title("winbox");
        let attributes = match self.window_size {
            Some((width, height)) => attributes.with_inner_size(PhysicalSize::new(width, height)),
            None => attributes.with_inner_size(LogicalSize::new(self.screen.0, self.screen.1)),
        };
        let Ok(window) = event_loop.create_window(attributes) else {
            self.closing = true;
            return;
        };
        let window = Rc::new(window);

        // Windows draws its own cursor on the screen.
        window.set_cursor_visible(false);

        let size = window.inner_size();

        self.size = (size.width, size.height);
        self.surface = Context::new(window.clone())
            .and_then(|context| Surface::new(&context, window.clone()))
            .ok();
        self.window = Some(window);
    }

    fn window_event(&mut self, _: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => self.closing = true,
            WindowEvent::Resized(size) => self.size = (size.width, size.height),
            WindowEvent::CursorMoved { position, .. } => {
                let at = self.on_screen(position);

                self.inputs.moved(at);
            }
            WindowEvent::MouseInput { state, button, .. } => self.inputs.button(state, button),
            WindowEvent::ModifiersChanged(modifiers) => {
                self.inputs.modifiers = modifiers.state();
            }
            WindowEvent::KeyboardInput { event, .. } => self.inputs.key(&event),
            _ => {}
        }
    }
}

impl Host for Native {
    fn sound(&mut self, sound: &winbox_win16::audio::Sound) {
        if let Some(speaker) = self.speaker.as_mut() {
            speaker.play(sound);
        }
    }

    fn frame(&mut self, system: &mut System) -> bool {
        let status = self
            .events
            .pump_app_events(Some(Duration::ZERO), &mut self.app);

        if matches!(status, PumpStatus::Exit(_)) || self.app.closing {
            return false;
        }

        for input in std::mem::take(&mut self.app.inputs.input) {
            match input {
                Input::Pointer(pointer) => system.pointer_event(pointer),
                Input::Key(down, key) => system.key_event(down, &key),
            }
        }

        let (width, height, pixels) = system.screen_rgb();

        if self.started.elapsed() >= Duration::from_secs(self.shot_seconds)
            && let Some(file) = self.shot.take()
        {
            save_shot(&file, width, height, &pixels);
        }

        self.app.show(width, height, &pixels);
        true
    }
}

/// The sound card installed on the drive rooted at `root`, over the
/// installation at `windows`: its driver named in `SYSTEM.INI`, as Control
/// Panel names a card's -- the installation's file, changed, on the drive
/// -- and the MIDI Mapper's setups naming the card's devices, "Ad Lib",
/// Windows' default, current; where the drive has its own `MIDIMAP.CFG` already, a
/// setup made current in Control Panel's MIDI Mapper on a run before, it is
/// kept.
fn install_sound(root: &Path, windows: Option<&Path>) {
    let installed = windows
        .and_then(|windows| std::fs::read(windows.join("WINDOWS").join("SYSTEM.INI")).ok())
        .or_else(|| std::fs::read(root.join("WINDOWS").join("SYSTEM.INI")).ok());

    match installed {
        Some(text) => {
            let _ = std::fs::create_dir_all(root.join("WINDOWS"));

            if let Err(error) = std::fs::write(
                root.join("WINDOWS").join("SYSTEM.INI"),
                winbox_win16::wbsound::install(&text),
            ) {
                eprintln!("the sound driver: {error}");
            }
        }
        None => eprintln!("the sound driver: no SYSTEM.INI to name it in"),
    }

    let setups = root.join("WINDOWS").join("SYSTEM").join("MIDIMAP.CFG");
    let installation = windows.and_then(|windows| {
        std::fs::read(windows.join("WINDOWS").join("SYSTEM").join("MIDIMAP.CFG")).ok()
    });

    if !setups.exists()
        && let Some(installed) =
            installation.and_then(|bytes| winbox_win16::wbsound::install_setups(&bytes))
    {
        let _ = std::fs::create_dir_all(root.join("WINDOWS").join("SYSTEM"));

        if let Err(error) = std::fs::write(&setups, installed) {
            eprintln!("the MIDI Mapper's setups: {error}");
        }
    }
}

/// Where WinBox keeps what it makes once and reads again: the host's
/// cache folder's `winbox`.
fn cache_folder() -> PathBuf {
    let cache = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
    };

    cache.unwrap_or_else(std::env::temp_dir).join("winbox")
}

/// The asset bundle at `path` read, where it serves the display.
fn open_assets(path: &Path, display: &str) -> Result<winbox_win16::assets::Assets, String> {
    let assets = winbox_win16::assets::Assets::open(path)?;

    if !assets.displays.iter().any(|served| served == display) {
        return Err(format!(
            "it serves the displays {}, not {display}",
            assets.displays.join(", ")
        ));
    }

    Ok(assets)
}

/// The cache folder, made where it is not there.
fn made_cache() -> PathBuf {
    let cache = cache_folder();

    if let Err(error) = std::fs::create_dir_all(&cache) {
        refuse(&format!("{}: {error}", cache.display()));
    }

    cache
}

/// A path on C: as a drive takes it: its names beneath the root.
fn parts_of(path: &str) -> Vec<String> {
    winbox_machine::Files::parse(path).parts
}

/// A file written on a drive through the drive, as a program would write
/// it: a lower layer's copied up, its folders' stamps kept.
fn write_on(c: &mut HostDrive, path: &str, bytes: &[u8]) {
    match c.create(&parts_of(path)) {
        Some(Body::Host(mut file)) => {
            file.write(bytes);
        }
        _ => eprintln!("{path}: could not be written"),
    }
}

/// `install_sound` on a drive of layers, through the drive: `SYSTEM.INI`
/// as the drive has it, with the card named; the MIDI Mapper's setups
/// where the drive's own folder has none of its own, from those beneath.
fn install_sound_on(c: &mut HostDrive) {
    let ini = r"WINDOWS\SYSTEM.INI";
    let cfg = r"WINDOWS\SYSTEM\MIDIMAP.CFG";

    match c.read(&parts_of(ini)) {
        Some(text) => {
            let installed = winbox_win16::wbsound::install(&text);

            if installed != text {
                write_on(c, ini, &installed);
            }
        }
        None => eprintln!("the sound driver: no SYSTEM.INI to name it in"),
    }

    let own = ["WINDOWS", "SYSTEM", "MIDIMAP.CFG"]
        .iter()
        .fold(c.root.clone(), |at, name| at.join(name));

    if !own.exists()
        && let Some(installed) = c
            .read(&parts_of(cfg))
            .and_then(|bytes| winbox_win16::wbsound::install_setups(&bytes))
    {
        write_on(c, cfg, &installed);
    }
}

/// The base a kept program's stack is put on: the asset bundle's for the
/// display, its store given to the system, or the installation's folder.
fn kept_base(
    assets: Option<&Path>,
    windows: Option<&Path>,
    display: &str,
    system: Option<&mut System>,
) -> programs::Base {
    let base = match (assets, windows) {
        (Some(assets), _) => {
            let assets = open_assets(assets, display)
                .unwrap_or_else(|error| refuse(&format!("the asset bundle: {error}")));
            let base = programs::Base::of_assets(&assets, display, &made_cache());

            if let Some(system) = system {
                system.assets = Some(Rc::new(assets));
            }

            base
        }
        (None, Some(windows)) => programs::Base::of_folder(windows, display),
        (None, None) => unreachable!("refused with the options"),
    };

    base.unwrap_or_else(|error| refuse(&format!("the base: {error}")))
}

/// The display a kept program runs on: its own, refused where another is
/// given; a new program's the one given, else the VGA.
fn kept_display(program: Option<&programs::Program>, given: Option<&String>) -> String {
    match (program, given) {
        (Some(program), Some(given)) if *given != program.display => refuse(&format!(
            "{} was installed on the {} display, and its layers are bound to it: run it with --display {}",
            program.name, program.display, program.display
        )),
        (Some(program), _) => program.display.clone(),
        (None, given) => given.cloned().unwrap_or_else(|| "vga".to_string()),
    }
}

/// `--layer-from`: a layer of the user's own files, or an exchange zip,
/// put on a program's stack, the program made where it is not kept.
fn layer_from(options: &Options, from: &Path, name: &str) {
    let store = programs::Store::new(made_cache());
    let kept = store.program(name).unwrap_or_else(|error| refuse(&error));
    let display = kept_display(kept.as_ref(), options.display.as_ref());
    let base = kept_base(
        options.assets.as_deref(),
        options.windows.as_deref(),
        &display,
        None,
    );
    let mut program = kept.unwrap_or_else(|| programs::Program::new(name, &base));
    let stack = store
        .stack(&base, &program)
        .unwrap_or_else(|error| refuse(&error));
    let layer = if from.is_dir() {
        programs::layer_of_folder(from, &stack)
    } else {
        std::fs::read(from)
            .map_err(|error| format!("{}: {error}", from.display()))
            .and_then(|bytes| winbox_win16::layers::Layer::from_zip(&bytes))
    }
    .unwrap_or_else(|error| refuse(&error));

    store
        .add_layer(&mut program, &stack, &layer)
        .unwrap_or_else(|error| refuse(&error));
    eprintln!(
        "layer {} put on {} ({} entries); its programs: {}",
        layer.manifest.id,
        program.name,
        layer.manifest.entries.len(),
        program.exes.join(" ")
    );
}

/// An installer's run, to be kept or not as it ends.
struct Installing {
    store: programs::Store,
    program: programs::Program,
    stack: Vec<winbox_win16::layers::Layer>,
    lowers: Vec<winbox_machine::HostLayer>,
    staging: programs::Staging,
}

impl Installing {
    /// What the installer left: kept as a layer of the program where
    /// `--keep` says so or the console does, the staging let go of.
    fn end(mut self, keep: bool) {
        match programs::installed(&self.staging, &self.stack, self.lowers.clone()) {
            Ok(None) => eprintln!("{} left nothing to keep", self.staging.setup),
            Ok(Some(installed)) => {
                let layer = installed.layer;
                let files = layer
                    .manifest
                    .entries
                    .iter()
                    .filter(|entry| matches!(entry, winbox_win16::layers::LayerEntry::File { .. }))
                    .count();

                eprintln!(
                    "{} left {files} files, {} entries in all",
                    self.staging.setup,
                    layer.manifest.entries.len()
                );

                if !installed.dropped.is_empty() {
                    eprintln!(
                        "{} entries of the media at C:\\{} dropped: they are discarded after installing",
                        installed.dropped.len(),
                        self.staging.media
                    );
                }

                // What the installer wrote that names the media is told,
                // not rewritten, as the page's status line tells it.
                for reference in &installed.references {
                    eprintln!("names the media: {}: {}", reference.path, reference.line);
                }

                if keep
                    || ask(
                        &format!(
                            "Keep what it installed as a layer of {}?",
                            self.program.name
                        ),
                        false,
                    )
                {
                    match self.store.add_layer(&mut self.program, &self.stack, &layer) {
                        Ok(()) => eprintln!(
                            "kept layer {}; {}'s programs: {}",
                            layer.manifest.id,
                            self.program.name,
                            self.program.exes.join(" ")
                        ),
                        Err(error) => eprintln!("not kept: {error}"),
                    }
                } else {
                    eprintln!("not kept");
                }
            }
            Err(error) => eprintln!("what the installer left: {error}"),
        }

        self.staging.discard();
    }
}

/// Drive C: of a kept program: its user's layer over its stack. Where its
/// layers have changed since that was made, the console is asked whether
/// to put it on the new stack, else it is set aside.
fn program_drive(
    options: &Options,
    name: &str,
    exe: Option<&String>,
    system: &mut System,
) -> (HostDrive, String) {
    let store = programs::Store::new(made_cache());
    let program = store
        .program(name)
        .unwrap_or_else(|error| refuse(&error))
        .unwrap_or_else(|| {
            let kept: Vec<String> = store
                .programs()
                .into_iter()
                .map(|program| format!("{} ({})", program.name, program.display))
                .collect();

            refuse(&format!(
                "no program {name} is kept: --install or --layer-from keeps one; kept: {}",
                if kept.is_empty() {
                    "none".to_string()
                } else {
                    kept.join(", ")
                }
            ))
        });
    let display = kept_display(Some(&program), options.display.as_ref());

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");

    let base = kept_base(
        options.assets.as_deref(),
        options.windows.as_deref(),
        &display,
        Some(system),
    );
    let stack = store
        .stack(&base, &program)
        .unwrap_or_else(|error| refuse(&error));
    let lowers = store
        .lowers(&base, &stack)
        .unwrap_or_else(|error| refuse(&error));

    if let programs::UserLayer::Other(_) = store.user_layer(&program)
        && !ask(
            &format!(
                "{name}'s layers have changed since what it wrote was kept. Put what it wrote on them?"
            ),
            true,
        )
    {
        match store.set_user_aside(name) {
            Ok(aside) => eprintln!("what {name} wrote is set aside in {}", aside.display()),
            Err(error) => refuse(&error),
        }
    }

    let mut c = store
        .user_drive(&program, lowers)
        .unwrap_or_else(|error| refuse(&error));

    if options.sound {
        install_sound_on(&mut c);
    }

    let path = match (exe, program.exes.as_slice()) {
        (Some(exe), _) => exe.clone(),
        (None, [only]) => only.clone(),
        (None, []) => refuse(&format!("{name} has no program: name one, C:\\PATH.EXE")),
        (None, exes) => refuse(&format!("{name} has programs {}: name one", exes.join(" "))),
    };

    (c, path)
}

/// Drive C: of an installer's run: an empty top over its media, laid at
/// `C:\<NAME>`, over the program's stack -- a program not kept yet, the
/// base alone.
fn install_drive(
    options: &Options,
    name: &str,
    media: &Path,
    setup: Option<&String>,
    system: &mut System,
) -> (HostDrive, String, Installing) {
    let store = programs::Store::new(made_cache());
    let kept = store.program(name).unwrap_or_else(|error| refuse(&error));
    let display = kept_display(kept.as_ref(), options.display.as_ref());

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");

    let base = kept_base(
        options.assets.as_deref(),
        options.windows.as_deref(),
        &display,
        Some(system),
    );
    let program = kept.unwrap_or_else(|| programs::Program::new(name, &base));
    let stack = store
        .stack(&base, &program)
        .unwrap_or_else(|error| refuse(&error));
    let lowers = store
        .lowers(&base, &stack)
        .unwrap_or_else(|error| refuse(&error));
    // An installer named alone is in its media's folder.
    let is_exe = media
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"));
    let (media, setup) = match (is_exe, setup) {
        (true, None) => (
            media.parent().unwrap_or(Path::new(".")).to_path_buf(),
            media
                .file_name()
                .map(|name| name.to_string_lossy().to_string()),
        ),
        (_, setup) => (media.to_path_buf(), setup.cloned()),
    };
    let media = if media.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        media
    };
    let staging = store
        .stage(name, &media, setup.as_deref())
        .unwrap_or_else(|error| refuse(&error));
    let c = staging
        .drive(lowers.clone())
        .unwrap_or_else(|error| refuse(&error));

    if options.sound {
        eprintln!(
            "--sound is not used while installing: the driver's SYSTEM.INI would be kept in the program's layer"
        );
    }

    let path = staging.setup.clone();

    eprintln!(
        "installing {name}: its media at C:\\{}, run as {path}",
        staging.media
    );

    (
        c,
        path,
        Installing {
            store,
            program,
            stack,
            lowers,
            staging,
        },
    )
}

#[allow(clippy::too_many_lines)]
fn main() {
    let options = options();

    if let Mode::LayerFrom { from, name } = &options.mode {
        layer_from(&options, from, name);
        return;
    }

    let mut system = System::new();
    let mut made = None;
    let mut installing = None;
    let (c, path) = match &options.mode {
        Mode::File(file) => {
            let (c, path, root) = file_drive(&options, file, &mut system);

            made = root;
            (c, path)
        }
        Mode::Program { name, exe } => program_drive(&options, name, exe.as_ref(), &mut system),
        Mode::Install { name, media, setup } => {
            let (c, path, install) =
                install_drive(&options, name, media, setup.as_ref(), &mut system);

            installing = Some(install);
            (c, path)
        }
        Mode::LayerFrom { .. } => unreachable!("made above"),
    };
    // A program's file is read where it is on the host; a kept program's
    // where its stack has it.
    let bytes = match &options.mode {
        Mode::File(file) => std::fs::read(file).expect("the program's file"),
        _ => c
            .read(&parts_of(&path))
            .unwrap_or_else(|| refuse(&format!("{path}: not on drive C:"))),
    };
    let executable = Executable::parse(bytes).expect("a New Executable");
    let Options {
        keep,
        shot,
        shot_seconds,
        sound,
        sound_dump,
        seamless,
        scale,
        resolution,
        seamless_shots,
        seamless_log,
        script,
        ..
    } = options;
    let mut events = event_loop();
    // Seamless mode's screen is the host's desktop, divided by a whole
    // scale; desktop mode's is `--resolution` where it is given, else the
    // display's own. Either is sized before the program starts and sees it.
    let host_screen = seamless.then(|| {
        seamless_host::host_screen(
            &mut events,
            scale,
            resolution,
            (system.display.width, system.display.height),
        )
    });
    let size = host_screen.map(|screen| screen.size).or(resolution);

    if let Some((width, height)) = size {
        system.set_screen_size(width, height);

        let tried = winbox_win16::display::SCREEN_TRIED;

        if system.display.width > tried || system.display.height > tried {
            eprintln!(
                "the screen is {}x{}: programs of Windows 3.1's time were rarely run past {tried} pixels a side",
                system.display.width, system.display.height
            );
        }
    }
    // The host's own time: a program runs as fast as the host runs it, and
    // its timers come due as the host's clock passes them.
    system.clock = Clock::real();
    system.files.mount('C', c);

    let (program, libraries) = system.load(executable, &path);

    system.link(program);
    system
        .start(program, libraries, "")
        .expect("the program's registers");

    // Started in its own folder, as Program Manager starts a program whose
    // item's working directory is where the program is.
    if let Some((folder, _)) = path.rsplit_once('\\')
        && folder.len() > 2
    {
        system.files.set_path(folder);
    }

    let screen = (
        u32::try_from(system.display.width).unwrap_or(640),
        u32::try_from(system.display.height).unwrap_or(480),
    );
    // `--scale` enlarges desktop mode's window, each pixel of the screen a
    // square of the host's that many pixels.
    let window_size = scale.map(|scale| (screen.0 * scale.max(1), screen.1 * scale.max(1)));
    if let Some(host_screen) = host_screen {
        let script = match script.as_deref().map(script::Script::read) {
            Some(Ok(script)) => script,
            Some(Err(error)) => {
                eprintln!("the script: {error}");
                std::process::exit(2);
            }
            None => script::Script::default(),
        };

        // The host carries out the mouse's moves and sizes where winit can
        // have it do them; under X the window manager would, but the
        // button's release is its, and never comes back, so USER's own loop
        // moves the window there.
        system.set_seamless(cfg!(windows));
        system.host = Some(HostSlot::new(Box::new(seamless_host::Seamless::new(
            events,
            host_screen,
            seamless_shots,
            seamless_log,
            shot_seconds,
            sound.then(|| speaker::Speaker::open(sound_dump.as_deref())),
            script,
        ))));
    } else {
        let app = App {
            screen,
            window_size,
            ..App::default()
        };

        system.host = Some(HostSlot::new(Box::new(Native {
            events,
            app,
            shot,
            shot_seconds,
            started: Instant::now(),
            speaker: sound.then(|| speaker::Speaker::open(sound_dump.as_deref())),
        })));
    }

    let engine = winbox_win16::Engine::new(system);
    let stop = engine.run(u64::MAX / 2, f64::INFINITY);

    eprintln!("stopped: {stop:?}");
    // The window and the engine let go of before the console is asked.
    drop(engine);

    if let Some(made) = made {
        let _ = std::fs::remove_dir_all(made);
    }

    if let Some(installing) = installing {
        installing.end(keep);
    }
}

/// Drive C: of a program's file: the directory given, else one made for
/// the run with the program's folder where its path puts it, over the
/// installation or the asset bundle's base; the folder made, to be let go
/// of after the run. A directory given keeps what is deleted of the base
/// from run to run (`programs::drive_removed`).
fn file_drive(
    options: &Options,
    file: &Path,
    system: &mut System,
) -> (HostDrive, String, Option<PathBuf>) {
    let display = options.display.clone().unwrap_or_else(|| "vga".to_string());
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = options
        .path
        .clone()
        .unwrap_or_else(|| format!("C:\\{name}"));

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");

    // The asset bundle in the installation's place: the base it composes
    // for the display written once into the cache, beneath drive C: as an
    // installation is, and its modules the store behind it.
    let windows = match &options.assets {
        Some(assets) => {
            let assets = open_assets(assets, &display)
                .unwrap_or_else(|error| refuse(&format!("the asset bundle: {error}")));
            let base = assets
                .base_in(&made_cache(), &display)
                .unwrap_or_else(|error| refuse(&format!("the asset bundle: {error}")));

            system.assets = Some(Rc::new(assets));
            Some(base)
        }
        None => options.windows.clone(),
    };

    // Drive C:, the directory given, else one made for the run with the
    // program's folder where its path puts it.
    let mut made = None;
    let given = options.drive.clone();
    let root = given.clone().unwrap_or_else(|| {
        let root = std::env::temp_dir().join(format!("winbox-native-{}", std::process::id()));
        let folders: Vec<&str> = path.split('\\').skip(1).collect();
        let (last, parents) = folders[..folders.len() - 1].split_last().unzip();
        let parent = parents
            .unwrap_or_default()
            .iter()
            .fold(root.clone(), |at, part| at.join(part));

        std::fs::create_dir_all(&parent).expect("the run's drive");

        if let Some(folder) = file.parent() {
            // A file named alone is in the current folder.
            let folder = if folder.as_os_str().is_empty() {
                Path::new(".")
            } else {
                folder
            };
            let folder = std::fs::canonicalize(folder).expect("the program's folder");

            match last {
                Some(last) => copy_folder(&folder, &parent.join(last)),
                None => copy_folder(&folder, &parent),
            }
        }

        made = Some(root.clone());
        root
    });
    if options.sound {
        install_sound(&root, windows.as_deref());
    }

    let c = match &windows {
        Some(installed) => {
            let c = HostDrive::over(root.clone(), installed.clone());

            // The user's own drive keeps what is deleted of the base from
            // run to run, as one folder would; a drive made for the run
            // is let go of after it.
            match given {
                Some(given) => {
                    let removed = programs::drive_removed(&made_cache(), &given);

                    c.keeping_removed(removed.clone())
                        .unwrap_or_else(|error| refuse(&format!("{}: {error}", removed.display())))
                }
                None => c,
            }
        }
        None => HostDrive::new(root.clone()),
    };

    (c, path, made)
}
