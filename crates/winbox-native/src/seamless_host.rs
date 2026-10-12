//! Seamless mode's host (`--seamless`; `kb/guides/seamless-windows.md`):
//! a window of the host's for each window at the top of the emulated
//! screen, showing that window's rectangle of the one screen the engine
//! draws, and no desktop.
//!
//! - The host's windows are made, moved, sized, shown, hidden and taken
//!   away as the windows at the top are (`seamless.rs`'s `plan`), owned by
//!   their owners' (Windows: `with_owner_window`), and stacked as they are
//!   (`host_os.rs`). Only a window owned by nothing with a caption -- an
//!   application's own -- shows on the host's task bar.
//! - The emulated screen is the host's desktop -- one rectangle around
//!   every monitor's work area, its top left at the rectangle's -- each of
//!   its pixels `--scale` of the host's square (`seamless.rs`'s
//!   `host_screen`, sized before the program starts). A window partly off
//!   the emulated screen, past the rectangle, shows black there: nothing is
//!   drawn off the screen to show.
//! - The host's pointer and keys go in as the page's do, the pointer at the
//!   point of the emulated screen it is over.
//! - A window activated by the host -- its task bar, its own Alt and Tab --
//!   is switched to through the engine (`HostRequest::Activate`); a press
//!   on it activates it as any press does. The emulated active window
//!   changed, the host's is brought forward. While one of the windows has
//!   the host's foreground, its program's windows are laid in front of the
//!   host's others in the emulated order (`raised_group`).
//! - USER's loop of moving and sizing by the mouse is handed to the host's
//!   drag (`drag_window`, `drag_resize_window`), and the window placed
//!   where the host let it go.
//! - A window minimized is minimized on the host, with its class icon or
//!   what `WM_QUERYDRAGICON` answers; restored or minimized by the host, it
//!   is through `WM_SYSCOMMAND`.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use softbuffer::{Context, Surface};
use winbox_win16::System;
use winbox_win16::host::Host;
use winbox_win16::seamless::{HTCAPTION, HostDrag, HostRequest, IconRgba, TopKind, TopWindow};
use winbox_win16::windows::Placement;
use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Icon, ResizeDirection, Window, WindowId};

use crate::host_os;
use crate::input::{Input, Inputs};
use crate::script::{Script, Step};
use crate::seamless::{
    HostScreen, Made, Mapping, ScaleChoice, bounds, choose_scale, fit, plan, raised_group,
    shown_rect,
};

/// How long a minimize or restore the host made waits for the engine to
/// follow it before the engine's own state is put back on the host: a
/// program may refuse `SC_MINIMIZE`.
const HOST_CHANGE_WAIT: Duration = Duration::from_secs(2);

const HTLEFT: u16 = 10;
const HTRIGHT: u16 = 11;
const HTTOP: u16 = 12;
const HTTOPLEFT: u16 = 13;
const HTTOPRIGHT: u16 = 14;
const HTBOTTOM: u16 = 15;
const HTBOTTOMLEFT: u16 = 16;
const HTBOTTOMRIGHT: u16 = 17;

/// A host's window, and the window at the top it shows.
// Each is a yes or no of the host's window's.
#[allow(clippy::struct_excessive_bools)]
struct Shown {
    window: Rc<Window>,
    surface: Option<Surface<Rc<Window>, Rc<Window>>>,
    made: Made,
    hwnd: u16,
    /// Where the host has it, and how large, in its pixels.
    at: (i32, i32),
    size: (u32, u32),
    /// The emulated rectangle it was last put at.
    rect: [i32; 4],
    visible: bool,
    /// Minimized, as it was last made or seen; a change the host made that
    /// the engine is yet to follow, and since when.
    minimized: bool,
    pending: Option<(bool, Instant)>,
    title: String,
    resizable: bool,
    icon: bool,
    /// What it last showed, cut out of the screen, and from where.
    pixels: Vec<u32>,
    last_rect: [i32; 4],
    last_size: (u32, u32),
}

/// winit's events, and what is kept between frames.
#[derive(Default)]
struct App {
    mapping: Option<Mapping>,
    shown: Vec<Shown>,
    /// The windows at the top, front to back, and each shown window's
    /// rectangle of the screen and its pixels, as the frame found them.
    tops: Vec<TopWindow>,
    cuts: Vec<(usize, [i32; 4], Vec<u32>)>,
    screen_size: (i16, i16),
    /// The host's windows' order as last stacked, and the active window as
    /// last brought forward.
    order: Vec<usize>,
    active: Option<usize>,
    /// The window that has the host's foreground, where one of these has;
    /// and whether its program's windows are yet to be laid in front.
    host_focus: Option<usize>,
    raise: bool,
    inputs: Inputs,
    hovered: Option<usize>,
    /// The host's windows that gained the keyboard, and those pressed on,
    /// since the last frame.
    focused: Vec<usize>,
    pressed: Vec<usize>,
    /// The drag the engine handed over; the window the host is dragging,
    /// and where its drag has it.
    drag_start: Option<HostDrag>,
    dragging: Option<usize>,
    engine_dragging: Option<u16>,
    drag_rect: Option<(u16, [i32; 4])>,
    /// A drag a script does in place of the host's: how far.
    scripted_drag: Option<(i32, i32)>,
    requests: Vec<HostRequest>,
    icons: Vec<(usize, IconRgba)>,
    closing: bool,
}

impl std::fmt::Debug for App {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("App")
            .field("windows", &self.shown.len())
            .finish_non_exhaustive()
    }
}

/// Seamless mode's host.
pub struct Seamless {
    events: EventLoop<()>,
    app: App,
    shots: Option<PathBuf>,
    shot_seconds: u64,
    started: Instant,
    speaker: Option<crate::speaker::Speaker>,
    script: Script,
}

impl Seamless {
    pub fn new(
        events: EventLoop<()>,
        screen: HostScreen,
        shots: Option<PathBuf>,
        shot_seconds: u64,
        speaker: Option<crate::speaker::Speaker>,
        script: Script,
    ) -> Self {
        Self {
            events,
            app: App {
                mapping: Some(screen.mapping),
                ..App::default()
            },
            shots,
            shot_seconds,
            started: Instant::now(),
            speaker,
            script,
        }
    }
}

/// What the host's monitors are, read from a running loop, the only place
/// winit lists them.
#[derive(Default)]
struct Monitors {
    read: Option<(Vec<crate::seamless::Monitor>, f64)>,
}

impl ApplicationHandler for Monitors {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.read = Some(host_os::monitors(event_loop));
    }

    fn window_event(&mut self, _: &ActiveEventLoop, _: WindowId, _: WindowEvent) {}

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.read.is_none() {
            self.read = Some(host_os::monitors(event_loop));
        }
    }
}

/// The emulated screen as the host's desktop (`seamless.rs`'s
/// `host_screen`): the host's monitors read by pumping its loop, with no
/// window made, before the program starts; the rectangle around them
/// divided by a whole scale -- `--scale`, else the one `--resolution`'s
/// width picks, else the smallest that keeps the screen within
/// `SCREEN_TRIED` each way and is at least the primary monitor's own scale,
/// rounded. Read once: a monitor added or taken away later leaves the
/// screen as it is. `fallback`, the display's own size, with no monitor.
pub fn host_screen(
    events: &mut EventLoop<()>,
    scale: Option<u32>,
    resolution: Option<(i16, i16)>,
    fallback: (i16, i16),
) -> HostScreen {
    let mut monitors = Monitors::default();

    for _ in 0..10 {
        let _ = events.pump_app_events(Some(Duration::ZERO), &mut monitors);

        if monitors.read.is_some() {
            break;
        }
    }

    let (monitors, host_scale) = monitors.read.unwrap_or_default();
    let [left, top, right, bottom] = bounds(&monitors).unwrap_or([0, 0, 1, 1]);
    let choice = match (scale, resolution) {
        (Some(scale), _) => ScaleChoice::Given(scale),
        (None, Some((width, _))) => ScaleChoice::Resolution(i32::from(width)),
        (None, None) => ScaleChoice::Default {
            least: host_scale.round().max(1.0) as u32,
            tried: i32::from(winbox_win16::display::SCREEN_TRIED),
        },
    };
    let scale = choose_scale(right - left, bottom - top, choice);

    crate::seamless::host_screen(
        &monitors,
        scale,
        winbox_win16::display::SCREEN_MOST,
        fallback,
    )
}

fn direction(hit: u16) -> Option<ResizeDirection> {
    Some(match hit {
        HTLEFT => ResizeDirection::West,
        HTRIGHT => ResizeDirection::East,
        HTTOP => ResizeDirection::North,
        HTBOTTOM => ResizeDirection::South,
        HTTOPLEFT => ResizeDirection::NorthWest,
        HTTOPRIGHT => ResizeDirection::NorthEast,
        HTBOTTOMLEFT => ResizeDirection::SouthWest,
        HTBOTTOMRIGHT => ResizeDirection::SouthEast,
        _ => return None,
    })
}

/// A rectangle moved by a drag on `hit` as USER's loop moves it: the
/// caption moves it all, an edge or a corner its own sides.
fn dragged(rect: [i32; 4], hit: u16, dx: i32, dy: i32) -> [i32; 4] {
    let [left, top, width, height] = rect;

    if hit == HTCAPTION {
        return [left + dx, top + dy, width, height];
    }

    let (west, north, east, south) = match hit {
        HTLEFT => (true, false, false, false),
        HTRIGHT => (false, false, true, false),
        HTTOP => (false, true, false, false),
        HTBOTTOM => (false, false, false, true),
        HTTOPLEFT => (true, true, false, false),
        HTTOPRIGHT => (false, true, true, false),
        HTBOTTOMLEFT => (true, false, false, true),
        HTBOTTOMRIGHT => (false, false, true, true),
        _ => (false, false, false, false),
    };
    let (mut l, mut t, mut r, mut b) = (left, top, left + width, top + height);

    if west {
        l += dx;
    }

    if east {
        r += dx;
    }

    if north {
        t += dy;
    }

    if south {
        b += dy;
    }

    [l, t, r - l, b - t]
}

impl App {
    fn find(&self, index: usize) -> Option<usize> {
        self.shown
            .iter()
            .position(|shown| shown.made.index == index)
    }

    fn by_id(&self, id: WindowId) -> Option<usize> {
        self.shown.iter().position(|shown| shown.window.id() == id)
    }

    fn top(&self, index: usize) -> Option<&TopWindow> {
        self.tops.iter().find(|top| top.index == index)
    }

    /// The window the host's drag has now, as a rectangle of the emulated
    /// screen.
    fn drag_moved(&mut self, at: usize) {
        let Some(mapping) = self.mapping else {
            return;
        };
        let shown = &self.shown[at];

        if self.dragging == Some(shown.made.index) {
            self.drag_rect = Some((shown.hwnd, mapping.rect_to_emulated(shown.at, shown.size)));
        }
    }

    fn make(&mut self, event_loop: &ActiveEventLoop, made: Made) {
        let (Some(mapping), Some(top)) = (self.mapping, self.top(made.index).cloned()) else {
            return;
        };
        let rect = shown_rect(&top);
        let ((x, y), (width, height)) = mapping.rect_to_host(rect);
        let title = if top.caption.is_empty() {
            "WinBox".to_string()
        } else {
            top.caption.clone()
        };
        #[allow(unused_mut)]
        let mut attributes = Window::default_attributes()
            .with_title(&title)
            .with_decorations(false)
            .with_resizable(top.sizable)
            .with_visible(false)
            .with_active(top.active)
            .with_position(PhysicalPosition::new(x, y))
            .with_inner_size(PhysicalSize::new(width, height))
            .with_min_inner_size(PhysicalSize::new(1, 1));

        #[cfg(windows)]
        {
            use winit::platform::windows::{CornerPreference, WindowAttributesExtWindows};

            attributes = attributes
                .with_skip_taskbar(!made.task_bar)
                .with_corner_preference(CornerPreference::DoNotRound)
                .with_undecorated_shadow(false);

            if let Some(owner) = made
                .owner
                .and_then(|owner| self.find(owner))
                .and_then(|at| host_os::handle_of(&self.shown[at].window))
            {
                attributes = attributes.with_owner_window(owner);
            }
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        if matches!(top.kind, TopKind::Menu | TopKind::DropDown) {
            use winit::platform::x11::WindowAttributesExtX11;

            attributes = attributes.with_override_redirect(true);
        }

        let Ok(window) = event_loop.create_window(attributes) else {
            eprintln!("seamless: no window of the host's for {title}");
            return;
        };
        let window = Rc::new(window);

        // Windows draws its own cursor on the screen.
        window.set_cursor_visible(false);

        let surface = Context::new(window.clone())
            .and_then(|context| Surface::new(&context, window.clone()))
            .ok();

        self.shown.push(Shown {
            window,
            surface,
            made,
            hwnd: top.hwnd,
            at: (x, y),
            size: (width, height),
            rect,
            visible: false,
            minimized: false,
            pending: None,
            title: top.caption,
            resizable: top.sizable,
            icon: false,
            pixels: Vec::new(),
            last_rect: [0; 4],
            last_size: (0, 0),
        });
    }

    /// The host's windows made to match the windows at the top.
    #[allow(clippy::too_many_lines)]
    fn sync(&mut self, event_loop: &ActiveEventLoop) {
        let Some(mapping) = self.mapping else {
            return;
        };
        let made: Vec<Made> = self.shown.iter().map(|shown| shown.made).collect();
        let plan = plan(&made, &self.tops);

        for index in &plan.destroy {
            if let Some(at) = self.find(*index) {
                drop(self.shown.remove(at));
            }
        }

        for made in plan.create {
            self.make(event_loop, made);
        }

        // Activated by the host, not by a press, which activates through
        // the engine as any press does: switched to as Alt and Tab switches.
        let focused = std::mem::take(&mut self.focused);
        let pressed = std::mem::take(&mut self.pressed);

        for index in focused {
            if pressed.contains(&index) {
                continue;
            }

            let Some(top) = self.top(index) else {
                continue;
            };
            let family_active = self.tops.iter().any(|other| {
                let mut at = Some(other.index);
                let mut steps = 0;

                while let Some(one) = at {
                    if one == index {
                        return other.active;
                    }

                    at = self.top(one).and_then(|top| top.owner);
                    steps += 1;

                    if steps > self.tops.len() {
                        break;
                    }
                }

                false
            });

            if top.hwnd == 0
                || family_active
                || top.placement == Placement::Minimized
                || !matches!(top.kind, TopKind::Overlapped | TopKind::Popup)
            {
                continue;
            }

            self.requests.push(HostRequest::Activate {
                hwnd: top.hwnd,
                restore: false,
            });
        }

        let engine_dragging = self.engine_dragging;

        for at in 0..self.shown.len() {
            let Some(top) = self.top(self.shown[at].made.index).cloned() else {
                continue;
            };
            let dragging = self.dragging == Some(top.index)
                || (top.hwnd != 0 && engine_dragging == Some(top.hwnd));
            let shown = &mut self.shown[at];

            if !shown.visible {
                shown.window.set_visible(true);
                shown.visible = true;

                // The shell gives a window shown its button again; taken
                // away once more, as winit took it when it was made.
                #[cfg(windows)]
                {
                    use winit::platform::windows::WindowExtWindows;

                    shown.window.set_skip_taskbar(!shown.made.task_bar);
                }
            }

            if matches!(
                top.kind,
                TopKind::Menu | TopKind::DropDown | TopKind::Switch
            ) {
                host_os::never_activated(&shown.window);
            }

            if top.caption != shown.title {
                shown.window.set_title(if top.caption.is_empty() {
                    "WinBox"
                } else {
                    &top.caption
                });
                shown.title.clone_from(&top.caption);
            }

            if top.sizable != shown.resizable {
                shown.window.set_resizable(top.sizable);
                shown.resizable = top.sizable;
            }

            if !shown.icon
                && let Some((_, icon)) = self.icons.iter().find(|(index, _)| *index == top.index)
                && let Ok(made) = Icon::from_rgba(icon.rgba.clone(), icon.width, icon.height)
            {
                #[cfg(windows)]
                {
                    use winit::platform::windows::WindowExtWindows;

                    shown.window.set_taskbar_icon(Some(made.clone()));
                }

                shown.window.set_window_icon(Some(made));
                shown.icon = true;
            }

            // Minimized: as the engine has it, unless the host changed it,
            // which goes to the engine, and is waited on.
            let emulated = top.placement == Placement::Minimized;
            let host = shown.window.is_minimized().unwrap_or(shown.minimized);

            if host != shown.minimized {
                shown.minimized = host;

                if host != emulated && top.hwnd != 0 {
                    self.requests.push(if host {
                        HostRequest::Minimize { hwnd: top.hwnd }
                    } else {
                        HostRequest::Activate {
                            hwnd: top.hwnd,
                            restore: true,
                        }
                    });
                    shown.pending = Some((host, Instant::now()));
                }
            } else if let Some((wanted, since)) = shown.pending {
                if emulated == wanted || since.elapsed() > HOST_CHANGE_WAIT {
                    shown.pending = None;
                }
            } else if emulated != shown.minimized {
                shown.window.set_minimized(emulated);
                shown.minimized = emulated;
            }

            // Where it is: as the engine has it, but while it is dragged or
            // an icon. On Windows a move the host made of its own -- its
            // keys that snap a window to a side -- is put back, the engine's
            // place being the truth; an X window manager that places a
            // window elsewhere than asked is let be, not fought each frame.
            if !dragging && !shown.minimized {
                let rect = shown_rect(&top);
                let ((x, y), (width, height)) = mapping.rect_to_host(rect);
                let moved = rect != shown.rect || (cfg!(windows) && (x, y) != shown.at);

                if moved {
                    shown.window.set_outer_position(PhysicalPosition::new(x, y));
                    shown.at = (x, y);
                }

                if (width, height) != shown.size {
                    let _ = shown
                        .window
                        .request_inner_size(PhysicalSize::new(width, height));
                    shown.size = (width, height);
                }

                shown.rect = rect;
            }
        }

        // Stacked as the emulated windows are, front to back, and the active
        // one brought forward as it changes.
        let order: Vec<usize> = plan
            .order
            .iter()
            .copied()
            .filter(|&index| self.find(index).is_some_and(|at| !self.shown[at].minimized))
            .collect();

        let active = self.tops.iter().find(|top| top.active).map(|top| top.index);
        let changed = order != self.order || active != self.active;

        if active != self.active
            && let Some(at) = active.and_then(|index| self.find(index))
            && !self.shown[at].minimized
        {
            host_os::bring_forward(&self.shown[at].window);
        }

        // While one of the windows has the host's foreground, its program's
        // are laid in front of the host's others, in the emulated order;
        // else, and for other programs', only stacked among themselves.
        let focus = self.host_focus.filter(|&index| self.find(index).is_some());

        if let Some(focused) = focus
            && (self.raise || changed)
        {
            let made: Vec<Made> = self.shown.iter().map(|shown| shown.made).collect();
            let group = raised_group(&order, &self.tops, &made, focused);
            let windows: Vec<&Window> = group
                .iter()
                .filter_map(|&index| self.find(index))
                .map(|at| &*self.shown[at].window)
                .collect();

            host_os::raise(&windows);
        } else if order != self.order {
            let windows: Vec<&Window> = order
                .iter()
                .filter_map(|&index| self.find(index))
                .map(|at| &*self.shown[at].window)
                .collect();

            host_os::restack(&windows);
        }

        self.raise = false;
        self.order = order;
        self.active = active;

        self.start_drag();
        self.present();
    }

    /// The drag the engine handed over, begun on the host -- or, from a
    /// script, done at once.
    fn start_drag(&mut self) {
        let Some(drag) = self.drag_start.take() else {
            return;
        };
        let (Some(at), Some(mapping)) = (self.find(drag.index), self.mapping) else {
            return;
        };

        if let Some((dx, dy)) = self.scripted_drag.take() {
            let rect = dragged(drag.rect, drag.hit, dx, dy);
            let ((x, y), (width, height)) = mapping.rect_to_host(rect);
            let shown = &mut self.shown[at];

            shown.window.set_outer_position(PhysicalPosition::new(x, y));
            let _ = shown
                .window
                .request_inner_size(PhysicalSize::new(width, height));
            shown.at = (x, y);
            shown.size = (width, height);
            self.drag_rect = Some((drag.hwnd, rect));
            self.inputs
                .button(ElementState::Released, MouseButton::Left);
            return;
        }

        // Let go before the host could take it: the release ends USER's
        // loop, and there is nothing to drag.
        if self.inputs.buttons & 1 == 0 {
            return;
        }

        let shown = &self.shown[at];
        let started = if drag.hit == HTCAPTION {
            shown.window.drag_window()
        } else if let Some(direction) = direction(drag.hit) {
            // Held to what the window answered `WM_GETMINMAXINFO`, as USER's
            // loop holds it, for as long as the host sizes it.
            if let Some([least, most]) = drag.limits {
                let size = |(w, h): (i32, i32)| {
                    let (w, h) = (w.max(1), h.max(1));

                    PhysicalSize::new(
                        u32::try_from(w).unwrap_or(1) * mapping.scale,
                        u32::try_from(h).unwrap_or(1) * mapping.scale,
                    )
                };

                shown.window.set_min_inner_size(Some(size(least)));
                shown.window.set_max_inner_size(Some(size(most)));
            }

            shown.window.drag_resize_window(direction)
        } else {
            return;
        };

        match started {
            Ok(()) => self.dragging = Some(drag.index),
            Err(error) => eprintln!("seamless: the host's drag: {error}"),
        }
    }

    /// The host's drag let go.
    fn drag_over(&mut self) {
        if let Some(index) = self.dragging.take()
            && let Some(at) = self.find(index)
        {
            let window = &self.shown[at].window;

            window.set_min_inner_size(Some(PhysicalSize::new(1, 1)));
            window.set_max_inner_size(None::<PhysicalSize<u32>>);
        }
    }

    /// Each window's rectangle of the screen put in its host's window,
    /// where it changed.
    fn present(&mut self) {
        for shown in &mut self.shown {
            if shown.minimized || self.dragging == Some(shown.made.index) {
                continue;
            }

            let rect = shown.rect;
            // Its pixels as the frame cut them, at the rectangle it has now.
            let Some((_, _, cutout)) = self
                .cuts
                .iter()
                .find(|(index, at, _)| *index == shown.made.index && *at == rect)
            else {
                continue;
            };
            let size = shown.window.inner_size();
            let (out_width, out_height) = (size.width, size.height);

            if *cutout == shown.pixels
                && rect == shown.last_rect
                && (out_width, out_height) == shown.last_size
            {
                continue;
            }

            let (Some(surface), Some(w), Some(h)) = (
                shown.surface.as_mut(),
                std::num::NonZeroU32::new(out_width),
                std::num::NonZeroU32::new(out_height),
            ) else {
                continue;
            };

            if surface.resize(w, h).is_err() {
                continue;
            }

            let Ok(mut buffer) = surface.buffer_mut() else {
                continue;
            };
            let drawn = fit(
                rect[2].max(0) as usize,
                rect[3].max(0) as usize,
                cutout,
                out_width as usize,
                out_height as usize,
            );

            buffer.copy_from_slice(&drawn);

            if buffer.present().is_ok() {
                shown.pixels.clone_from(cutout);
                shown.last_rect = rect;
                shown.last_size = (out_width, out_height);
            }
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, _: &ActiveEventLoop) {}

    fn window_event(&mut self, _: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(at) = self.by_id(id) else {
            return;
        };
        let index = self.shown[at].made.index;

        match event {
            // The task bar's Close: the system menu's Close. Alt and F4 is
            // the engine's own, from the keys.
            WindowEvent::CloseRequested => {
                let hwnd = self.shown[at].hwnd;

                if hwnd != 0 && !self.inputs.modifiers.alt_key() {
                    self.requests.push(HostRequest::Close { hwnd });
                }
            }
            WindowEvent::Destroyed => drop(self.shown.remove(at)),
            WindowEvent::Moved(position) => {
                self.shown[at].at = (position.x, position.y);
                self.drag_moved(at);
            }
            WindowEvent::Resized(size) => {
                self.shown[at].size = (size.width, size.height);
                self.drag_moved(at);
            }
            WindowEvent::CursorMoved { position, .. } => {
                let Some(mapping) = self.mapping else {
                    return;
                };
                // The window shows its rectangle of the screen: a point of
                // it is that rectangle's, wherever the host has the window.
                let (x, y) = mapping.in_window(
                    self.shown[at].rect,
                    position.x.floor() as i32,
                    position.y.floor() as i32,
                );
                let clamp = |n: i32| n.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16;

                self.inputs.moved((clamp(x), clamp(y)));
            }
            WindowEvent::CursorEntered { .. } => self.hovered = Some(index),
            WindowEvent::CursorLeft { .. } if self.hovered == Some(index) => self.hovered = None,
            WindowEvent::MouseInput { state, button, .. } => {
                if state == ElementState::Pressed {
                    self.pressed.push(index);
                } else if button == MouseButton::Left {
                    self.drag_over();
                }

                self.inputs.button(state, button);
            }
            WindowEvent::Focused(true) => {
                self.focused.push(index);
                self.host_focus = Some(index);
                self.raise = true;
            }
            WindowEvent::Focused(false) if self.host_focus == Some(index) => {
                self.host_focus = None;
            }
            WindowEvent::ModifiersChanged(modifiers) => self.inputs.modifiers = modifiers.state(),
            WindowEvent::KeyboardInput { event, .. } => self.inputs.key(&event),
            WindowEvent::RedrawRequested => self.shown[at].pixels.clear(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.sync(event_loop);
    }
}

/// A PPM of a window's pixels.
fn save_ppm(file: &Path, width: usize, height: usize, pixels: &[u32]) {
    let mut bytes = format!("P6\n{width} {height}\n255\n").into_bytes();

    for &pixel in pixels {
        bytes.extend_from_slice(&[(pixel >> 16) as u8, (pixel >> 8) as u8, pixel as u8]);
    }

    if let Err(error) = std::fs::write(file, bytes) {
        eprintln!("seamless shots: {error}");
    }
}

fn quoted(text: &str) -> String {
    let mut out = String::from("\"");

    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }

    out.push('"');
    out
}

impl Seamless {
    /// Each host's window's pixels as it last showed them, at the emulated
    /// screen's size, and a JSON of where each window is, as the engine
    /// and the host each have it.
    fn save_shots(&self, folder: &Path) {
        if let Err(error) = std::fs::create_dir_all(folder) {
            eprintln!("seamless shots: {error}");
            return;
        }

        let app = &self.app;
        let mut entries = Vec::new();

        for shown in &app.shown {
            let Some(top) = app.top(shown.made.index) else {
                continue;
            };
            let name = format!("window-{}-{:04x}.ppm", top.index, top.hwnd);
            let [_, _, width, height] = shown.last_rect;

            if !shown.pixels.is_empty() {
                save_ppm(
                    &folder.join(&name),
                    width.max(0) as usize,
                    height.max(0) as usize,
                    &shown.pixels,
                );
            }

            let says = host_os::host_says(&shown.window);
            let host_at = shown.window.outer_position().ok();
            let host_size = shown.window.inner_size();
            let owner_handle = shown
                .made
                .owner
                .and_then(|owner| app.find(owner))
                .and_then(|at| host_os::handle_of(&app.shown[at].window));
            let rect = top.rect;

            entries.push(format!(
                concat!(
                    "  {{\"index\": {}, \"hwnd\": {}, \"caption\": {}, \"kind\": \"{:?}\", ",
                    "\"z\": {}, \"owner\": {}, \"active\": {}, \"placement\": \"{:?}\", ",
                    "\"rect\": [{}, {}, {}, {}], \"shown_rect\": [{}, {}, {}, {}], ",
                    "\"pixels\": {}, \"host\": {{\"x\": {}, \"y\": {}, \"width\": {}, ",
                    "\"height\": {}, \"minimized\": {}, \"visible\": {}, \"handle\": {}, ",
                    "\"order\": {}, \"owner\": {}, \"owner_expected\": {}, ",
                    "\"app_window\": {}, \"no_activate\": {}, \"foreground\": {}, \"icon\": {}}}}}"
                ),
                top.index,
                top.hwnd,
                quoted(&top.caption),
                top.kind,
                top.z,
                top.owner.map_or("null".into(), |owner| owner.to_string()),
                top.active,
                top.placement,
                rect[0],
                rect[1],
                rect[2],
                rect[3],
                shown.last_rect[0],
                shown.last_rect[1],
                shown.last_rect[2],
                shown.last_rect[3],
                if shown.pixels.is_empty() {
                    "null".into()
                } else {
                    quoted(&name)
                },
                host_at.map_or("null".into(), |at| at.x.to_string()),
                host_at.map_or("null".into(), |at| at.y.to_string()),
                host_size.width,
                host_size.height,
                shown
                    .window
                    .is_minimized()
                    .map_or("null".into(), |m| m.to_string()),
                shown
                    .window
                    .is_visible()
                    .map_or("null".into(), |v| v.to_string()),
                says.handle.map_or("null".into(), |h| h.to_string()),
                says.order.map_or("null".into(), |o| o.to_string()),
                says.owner.map_or("null".into(), |o| o.to_string()),
                owner_handle.map_or("null".into(), |o| o.to_string()),
                says.app_window,
                says.no_activate,
                says.foreground,
                shown.icon,
            ));
        }

        let mapping = app.mapping.unwrap_or(Mapping::new((0, 0), 1));
        let json = format!(
            "{{\"origin\": [{}, {}], \"scale\": {}, \"screen\": [{}, {}], \"seconds\": {:.2}, \"windows\": [\n{}\n]}}\n",
            mapping.origin.0,
            mapping.origin.1,
            mapping.scale,
            app.screen_size.0,
            app.screen_size.1,
            self.started.elapsed().as_secs_f64(),
            entries.join(",\n")
        );

        if let Err(error) = std::fs::write(folder.join("windows.json"), json) {
            eprintln!("seamless shots: {error}");
        }
    }

    fn title_window(&self, title: &str) -> Option<&Rc<Window>> {
        self.app
            .shown
            .iter()
            .find(|shown| shown.title == title)
            .map(|shown| &shown.window)
    }

    fn run_script(&mut self) {
        let steps = self.script.due(self.started.elapsed().as_secs_f64());

        for step in steps {
            let inputs = &mut self.app.inputs;

            match step {
                Step::Move(x, y) => inputs.moved((x, y)),
                Step::Press(x, y) => {
                    inputs.moved((x, y));
                    inputs.button(ElementState::Pressed, MouseButton::Left);
                }
                Step::Release(x, y) => {
                    inputs.moved((x, y));
                    inputs.button(ElementState::Released, MouseButton::Left);
                }
                Step::Click(x, y) => {
                    inputs.moved((x, y));
                    inputs.button(ElementState::Pressed, MouseButton::Left);
                    inputs.button(ElementState::Released, MouseButton::Left);
                }
                Step::Key(code) => {
                    inputs.named_key(true, &code);
                    inputs.named_key(false, &code);
                }
                Step::Down(code) => inputs.named_key(true, &code),
                Step::Up(code) => inputs.named_key(false, &code),
                Step::Drag(x, y, dx, dy) => {
                    inputs.moved((x, y));
                    inputs.button(ElementState::Pressed, MouseButton::Left);
                    self.app.scripted_drag = Some((dx, dy));
                }
                Step::Minimize(title) => {
                    if let Some(window) = self.title_window(&title) {
                        window.set_minimized(true);
                    }
                }
                Step::Restore(title) => {
                    if let Some(window) = self.title_window(&title) {
                        window.set_minimized(false);
                    }
                }
                Step::Activate(title) => {
                    if let Some(window) = self.title_window(&title) {
                        host_os::bring_forward(window);
                    }
                }
                Step::Lower => {
                    let windows: Vec<&Window> =
                        self.app.shown.iter().map(|shown| &*shown.window).collect();

                    host_os::lower(&windows);
                }
                Step::Shots(name) => match &self.shots {
                    Some(folder) => self.save_shots(&folder.join(name)),
                    None => eprintln!("seamless: `shots` needs --seamless-shots"),
                },
                Step::Quit => self.app.closing = true,
            }
        }
    }
}

impl Host for Seamless {
    fn sound(&mut self, sound: &winbox_win16::audio::Sound) {
        if let Some(speaker) = self.speaker.as_mut() {
            speaker.play(sound);
        }
    }

    fn frame(&mut self, system: &mut System) -> bool {
        let app = &mut self.app;

        app.tops = system.top_windows();
        app.screen_size = (system.display.width, system.display.height);

        // Each shown window's rectangle of the screen, and no more of it:
        // the screen is the host's desktop. The cursor is drawn only while
        // the pointer is over one of the windows, or a button is held:
        // elsewhere it is the host's.
        let cursor = app.hovered.is_some() || app.inputs.buttons != 0;

        app.cuts = app
            .tops
            .iter()
            .filter(|top| {
                top.placement != Placement::Minimized
                    && app.shown.iter().any(|shown| shown.made.index == top.index)
            })
            .map(|top| {
                let rect = shown_rect(top);

                (top.index, rect, system.screen_rgb_cut(rect, cursor))
            })
            .collect();

        if let Some(drag) = system.take_host_drag() {
            app.drag_start = Some(drag);
        }

        app.engine_dragging = system.host_dragging();

        for top in &app.tops {
            if top.visible
                && top.hwnd != 0
                && matches!(top.kind, TopKind::Overlapped | TopKind::Popup)
                && !app.icons.iter().any(|(index, _)| *index == top.index)
                && let Some(icon) = system.window_icon_rgba(top.hwnd)
            {
                app.icons.push((top.index, icon));
            }
        }

        self.run_script();

        let status = self
            .events
            .pump_app_events(Some(Duration::ZERO), &mut self.app);

        if matches!(status, PumpStatus::Exit(_)) || self.app.closing {
            return false;
        }

        let app = &mut self.app;

        if let Some((hwnd, rect)) = app.drag_rect.take() {
            system.host_drag_to(hwnd, rect);
        }

        for request in std::mem::take(&mut app.requests) {
            system.host_request(request);
        }

        for input in std::mem::take(&mut app.inputs.input) {
            match input {
                Input::Pointer(pointer) => system.pointer_event(pointer),
                Input::Key(down, key) => system.key_event(down, &key),
            }
        }

        if self.started.elapsed() >= Duration::from_secs(self.shot_seconds)
            && let Some(folder) = self.shots.clone()
            && !folder.join("windows.json").exists()
        {
            self.save_shots(&folder);
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drag_on_the_caption_moves_and_on_a_corner_sizes() {
        assert_eq!(
            dragged([10, 20, 100, 50], HTCAPTION, 5, -3),
            [15, 17, 100, 50]
        );
        assert_eq!(
            dragged([10, 20, 100, 50], HTBOTTOMRIGHT, 5, 7),
            [10, 20, 105, 57]
        );
        assert_eq!(
            dragged([10, 20, 100, 50], HTTOPLEFT, 5, 7),
            [15, 27, 95, 43]
        );
        assert_eq!(dragged([10, 20, 100, 50], HTLEFT, -4, 9), [6, 20, 104, 50]);
    }
}
