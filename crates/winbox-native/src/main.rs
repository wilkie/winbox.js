//! winbox.js's Windows 3.1 run natively: a program loaded, linked and run
//! on the Rust engine, its screen shown in a window of the host's and the
//! host's mouse and keyboard handed to its windows, as the page does with
//! its canvas.
//!
//! `winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR] [--display
//! vga|ega|hercules|svga|vga256] [--path C:\PROGRAM.EXE] [--shot FILE [--shot-seconds N]]`
//!
//! `--windows` is an installed Windows 3.1 directory, read and never
//! written, beneath drive C: (`oracle/build/drive-c`): its display driver
//! and fonts draw the screen. `--drive` is the host directory that is drive
//! C: itself, else one made for the run, and removed after it, with a copy
//! of the program's folder where `--path` puts it -- `C:\` and its file's
//! name by default. `--shot` saves the screen as it shows five seconds in,
//! a binary PPM, or `--shot-seconds` in.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use softbuffer::{Context, Surface};
use winbox_machine::{Clock, HostDrive};
use winbox_ne::Executable;
use winbox_win16::System;
use winbox_win16::host::{Host, HostSlot};
use winbox_win16::key_input::Key;
use winbox_win16::raster_input::{Pointer, PointerKind};
use winit::application::ApplicationHandler;
use winit::dpi::{LogicalSize, PhysicalPosition};
use winit::event::{ElementState, KeyEvent, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{Key as LogicalKey, ModifiersState, NamedKey, PhysicalKey};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowId};

/// How close in time and place a second press must be to make a double
/// click, as a page's `detail` of 2 says one is: Windows' own 500
/// milliseconds and four pixels.
const DOUBLE_CLICK: Duration = Duration::from_millis(500);
const DOUBLE_CLICK_DISTANCE: i32 = 4;

/// What the command line asks for.
struct Options {
    file: PathBuf,
    drive: Option<PathBuf>,
    path: Option<String>,
    windows: Option<PathBuf>,
    display: String,
    shot: Option<PathBuf>,
    shot_seconds: u64,
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
            "winbox-native PROGRAM.EXE [--drive DIR] [--windows DIR] [--display MODE] [--path C:\\PROGRAM.EXE]"
        );
        std::process::exit(2);
    };

    Options { file, ..options }
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

/// The last press, for the next to be a double click of.
#[derive(Clone, Copy)]
struct Press {
    button: u8,
    x: i32,
    y: i32,
    at: Instant,
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
    /// Where the pointer is on the screen, and the buttons down: left 1,
    /// right 2, middle 4.
    pointer: (i16, i16),
    buttons: u8,
    modifiers: ModifiersState,
    last_press: Option<Press>,
    /// What happened since the machine was last given them.
    input: Vec<Input>,
    closing: bool,
}

/// One thing the host's mouse or keyboard did.
enum Input {
    Pointer(Pointer),
    Key(bool, Key),
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

    fn pointer(&mut self, kind: PointerKind, button: u8, double: bool) {
        self.input.push(Input::Pointer(Pointer {
            kind,
            x: self.pointer.0,
            y: self.pointer.1,
            button,
            buttons: self.buttons,
            double,
        }));
    }

    fn button(&mut self, state: ElementState, button: MouseButton) {
        // The button changed as a page numbers it -- 0 left, 1 middle, 2
        // right -- and as a bit of those down.
        let (number, bit) = match button {
            MouseButton::Left => (0, 1),
            MouseButton::Right => (2, 2),
            MouseButton::Middle => (1, 4),
            _ => return,
        };

        if state == ElementState::Pressed {
            let (x, y) = (i32::from(self.pointer.0), i32::from(self.pointer.1));
            let double = self.last_press.is_some_and(|press| {
                press.button == number
                    && press.at.elapsed() < DOUBLE_CLICK
                    && (press.x - x).abs() <= DOUBLE_CLICK_DISTANCE
                    && (press.y - y).abs() <= DOUBLE_CLICK_DISTANCE
            });

            // A third press starts again, as a page's `detail` counts on.
            self.last_press = (!double).then_some(Press {
                button: number,
                x,
                y,
                at: Instant::now(),
            });
            self.buttons |= bit;
            self.pointer(PointerKind::Down, number, double);
        } else {
            self.buttons &= !bit;
            self.pointer(PointerKind::Up, number, false);
        }
    }

    fn key(&mut self, event: &KeyEvent) {
        // winit names a key as a page does: `KeyA`, `Enter`, `ShiftLeft`.
        let PhysicalKey::Code(code) = event.physical_key else {
            return;
        };
        // What it types, as a page's `key` gives it: the space bar is a
        // character there, where winit names it.
        let text = match &event.logical_key {
            LogicalKey::Character(text) => text.to_string(),
            LogicalKey::Named(NamedKey::Space) => " ".to_string(),
            _ => String::new(),
        };

        self.input.push(Input::Key(
            event.state == ElementState::Pressed,
            Key {
                code: format!("{code:?}"),
                key: text,
                repeat: event.repeat,
                alt: self.modifiers.alt_key(),
            },
        ));
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
                self.pointer = self.on_screen(position);
                self.pointer(PointerKind::Move, 0, false);
            }
            WindowEvent::MouseInput { state, button, .. } => self.button(state, button),
            WindowEvent::ModifiersChanged(modifiers) => self.modifiers = modifiers.state(),
            WindowEvent::KeyboardInput { event, .. } => self.key(&event),
            _ => {}
        }
    }
}

impl Host for Native {
    fn frame(&mut self, system: &mut System) -> bool {
        let status = self
            .events
            .pump_app_events(Some(Duration::ZERO), &mut self.app);

        if matches!(status, PumpStatus::Exit(_)) || self.app.closing {
            return false;
        }

        for input in std::mem::take(&mut self.app.input) {
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

fn main() {
    let Options {
        file,
        drive,
        path,
        windows,
        display,
        shot,
        shot_seconds,
    } = options();
    let bytes = std::fs::read(&file).expect("the program's file");
    let executable = Executable::parse(bytes).expect("a New Executable");
    let name = file.file_name().map_or(String::new(), |name| {
        name.to_string_lossy().to_ascii_uppercase()
    });
    let path = path.unwrap_or_else(|| format!("C:\\{name}"));
    let mut system = System::new();

    system.display = winbox_win16::display::mode(&display).expect("a display mode winbox.js knows");
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
    let events = EventLoop::new().expect("the host's event loop");
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
    })));

    let engine = winbox_win16::Engine::new(system);
    let stop = engine.run(u64::MAX / 2, f64::INFINITY);

    eprintln!("stopped: {stop:?}");

    if let Some(made) = made {
        let _ = std::fs::remove_dir_all(made);
    }
}
