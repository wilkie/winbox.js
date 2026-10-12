//! winbox.js's Windows 3.1 run natively: a program loaded, linked and run
//! on the Rust engine, its screen shown in a window of the host's and the
//! host's mouse and keyboard handed to its windows, as the page does with
//! its canvas.
//!
//! `winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR] [--display
//! vga|ega|hercules|svga|vga256|8514|xga256] [--path C:\PROGRAM.EXE] [--shot FILE [--shot-seconds N]]
//! [--sound] [--seamless [--scale N] [--seamless-shots DIR] [--script FILE]]`
//!
//! Desktop mode, the default, shows the whole screen, desktop and all, in
//! one window. `--seamless` shows each window at the top as a window of
//! the host's and no desktop (`seamless_host.rs`;
//! `kb/guides/seamless-windows.md`): the engine draws exactly as in
//! desktop mode, and each host's window shows its window's rectangle of
//! that one screen. The screen is the host's desktop -- one rectangle
//! around every monitor's work area, read before the program starts -- each
//! pixel `--scale` of the host's square (the primary monitor's own scale,
//! rounded, by default), the program seeing it as WinBox's seamless screen
//! of that size over the display mode (`System::set_screen_size`). On Windows the host's drag moves and sizes the
//! windows; on X, USER's own loop does. `--seamless-shots` saves each
//! host's window's pixels, from this program's own buffers, and a
//! `windows.json` of where each is, `--shot-seconds` in and at a script's
//! `shots`; `--script` plays steps at set times (`script.rs`).
//!
//! `--windows` is an installed Windows 3.1 directory, read and never
//! written, beneath drive C: (`oracle/build/drive-c`): its display driver
//! and fonts draw the screen. `--drive` is the host directory that is drive
//! C: itself, else one made for the run, and removed after it, with a copy
//! of the program's folder where `--path` puts it -- `C:\` and its file's
//! name by default. `--shot` saves the screen as it shows five seconds in,
//! a binary PPM, or `--shot-seconds` in. `--sound` installs winbox.js's
//! own sound card driver, writing `C:\WINDOWS\SYSTEM.INI` with it named in
//! `[drivers]` onto the drive, and the MIDI Mapper's setups in
//! `C:\WINDOWS\SYSTEM\MIDIMAP.CFG`, "Ad Lib", Windows' default, current,
//! where the drive has none of its own, and plays what the card plays
//! through the host's speakers (`speaker.rs`).
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
mod script;
mod seamless;
mod seamless_host;
mod speaker;

use softbuffer::{Context, Surface};
use winbox_machine::{Clock, HostDrive};
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::host::{Host, HostSlot};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalPosition};
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowId};

use input::{Input, Inputs};

/// What the command line asks for.
struct Options {
    file: PathBuf,
    drive: Option<PathBuf>,
    path: Option<String>,
    windows: Option<PathBuf>,
    display: String,
    shot: Option<PathBuf>,
    shot_seconds: u64,
    sound: bool,
    /// Seamless mode: a window of the host's for each window at the top,
    /// each pixel of the screen `scale` of the host's square; its windows'
    /// pixels and places saved into `seamless_shots`, and a `script` run.
    seamless: bool,
    scale: Option<u32>,
    seamless_shots: Option<PathBuf>,
    script: Option<PathBuf>,
}

fn options() -> Options {
    let mut arguments = std::env::args().skip(1);
    let mut file = None;
    let mut options = Options {
        file: PathBuf::new(),
        drive: None,
        path: None,
        windows: None,
        display: "vga".to_string(),
        shot: None,
        shot_seconds: 5,
        sound: false,
        seamless: false,
        scale: None,
        seamless_shots: None,
        script: None,
    };

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--drive" => options.drive = arguments.next().map(PathBuf::from),
            "--path" => options.path = arguments.next(),
            "--windows" => options.windows = arguments.next().map(PathBuf::from),
            "--shot" => options.shot = arguments.next().map(PathBuf::from),
            "--shot-seconds" => {
                options.shot_seconds = arguments
                    .next()
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(options.shot_seconds);
            }
            "--sound" => options.sound = true,
            "--seamless" => options.seamless = true,
            "--scale" => options.scale = arguments.next().and_then(|n| n.parse().ok()),
            "--seamless-shots" => options.seamless_shots = arguments.next().map(PathBuf::from),
            "--script" => options.script = arguments.next().map(PathBuf::from),
            "--display" => {
                if let Some(display) = arguments.next() {
                    options.display = display;
                }
            }
            _ => file = Some(PathBuf::from(argument)),
        }
    }

    let Some(file) = file else {
        eprintln!(
            "winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR] [--display MODE] [--path C:\\PROGRAM.EXE] [--shot FILE] [--sound] [--seamless [--scale N] [--seamless-shots DIR] [--script FILE]]"
        );
        std::process::exit(2);
    };

    Options { file, ..options }
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
    /// The screen's size, as the window was made for it.
    screen: (u32, u32),
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

        let attributes = Window::default_attributes()
            .with_title("winbox")
            .with_inner_size(LogicalSize::new(self.screen.0, self.screen.1));
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

#[allow(clippy::too_many_lines)]
fn main() {
    let Options {
        file,
        drive,
        path,
        windows,
        display,
        shot,
        shot_seconds,
        sound,
        seamless,
        scale,
        seamless_shots,
        script,
    } = options();
    let bytes = std::fs::read(&file).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = path.unwrap_or_else(|| format!("C:\\{name}"));
    let mut system = System::new();

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");

    let mut events = event_loop();
    // Seamless mode's screen is the host's desktop, sized before the
    // program starts and sees it.
    let host_screen = seamless.then(|| {
        let screen = seamless_host::host_screen(
            &mut events,
            scale,
            (system.display.width, system.display.height),
        );

        system.set_screen_size(screen.size.0, screen.size.1);
        screen
    });
    // The host's own time: a program runs as fast as the host runs it, and
    // its timers come due as the host's clock passes them.
    system.clock = Clock::real();

    // Drive C:, the directory given, else one made for the run with the
    // program's folder where its path puts it.
    let mut made = None;
    let root = drive.unwrap_or_else(|| {
        let root = std::env::temp_dir().join(format!("winbox-native-{}", std::process::id()));
        let folders: Vec<&str> = path.split('\\').skip(1).collect();
        let (last, parents) = folders[..folders.len() - 1].split_last().unzip();
        let parent = parents
            .unwrap_or_default()
            .iter()
            .fold(root.clone(), |at, part| at.join(part));

        std::fs::create_dir_all(&parent).expect("the run's drive");

        if let Some(folder) = file.parent() {
            let folder = std::fs::canonicalize(folder).expect("the program's folder");

            match last {
                Some(last) => copy_folder(&folder, &parent.join(last)),
                None => copy_folder(&folder, &parent),
            }
        }

        made = Some(root.clone());
        root
    });
    if sound {
        install_sound(&root, windows.as_deref());
    }

    let c = match &windows {
        Some(installed) => HostDrive::over(root.clone(), installed.clone()),
        None => HostDrive::new(root.clone()),
    };

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
            shot_seconds,
            sound.then(speaker::Speaker::open),
            script,
        ))));
    } else {
        let app = App {
            screen,
            ..App::default()
        };

        system.host = Some(HostSlot::new(Box::new(Native {
            events,
            app,
            shot,
            shot_seconds,
            started: Instant::now(),
            speaker: sound.then(speaker::Speaker::open),
        })));
    }

    let engine = winbox_win16::Engine::new(system);
    let stop = engine.run(u64::MAX / 2, f64::INFINITY);

    eprintln!("stopped: {stop:?}");

    if let Some(made) = made {
        let _ = std::fs::remove_dir_all(made);
    }
}
