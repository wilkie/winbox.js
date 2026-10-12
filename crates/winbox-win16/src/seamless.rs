//! Seamless mode's hooks for a native front end, which shows each window at
//! the top as a window of the host's and no desktop
//! (`kb/guides/seamless-windows.md`). This is presenting, not Windows' API:
//! the engine draws its one screen as it always does, and the front end
//! reads the windows at the top off it here, each with its place, its
//! place in the order of windows, its owner and whether it is minimized.
//!
//! Nothing here runs unless the front end turns seamless mode on
//! (`System::set_seamless`): with `System::seamless` none, as it is for
//! every probe, the corpus and every session, no list is made, no request
//! is taken and `DefWindowProc`'s loop of moving and sizing is USER's own.
//!
//! What the host does is put into the engine by the paths Windows' own
//! input takes, none invented:
//!
//! - **Activated by the host** (its task bar, its Alt and Tab), a window is
//!   switched to as the end of Alt and Tab's loop switches (`switch_loop.rs`,
//!   `USER.EXE` seg23 `0868`-`0915`): brought to the top with `SetWindowPos`,
//!   which makes it active, and, minimized, restored by `WM_SYSCOMMAND`
//!   with `SC_RESTORE` posted to it. A disabled window gives the switch to
//!   the window a press on it would bring up (`owned_to_bring_up`, seg1
//!   `5745`). Like a press (seg1 `2939`), nothing is activated while a
//!   window has the mouse's capture: the request waits.
//! - **Minimized by the host**, a window is sent `WM_SYSCOMMAND` with
//!   `SC_MINIMIZE`, as the system menu's Minimize sends it; **closed** (the
//!   task bar's Close), `SC_CLOSE`.
//! - **Its icon**, for the host's task bar: the class's icon the window was
//!   made with, or else what `WM_QUERYDRAGICON` answers, as Alt and Tab's
//!   box asks (seg23 `07f7`-`083a`) -- asked only of a window minimized
//!   that has no class icon. Drawn with the engine's own icon drawing
//!   (`draw_icon_at`) over black and over white, to tell what is clear.
//! - **Moved or sized by the host's drag**: where the mouse would begin
//!   USER's loop, `track_loop.rs` hands the drag to the host instead and
//!   places the window where the host let it go (`HostDrag`).

use winbox_raster::DeviceBitmap;

use crate::call::Stop;
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;
use crate::windows::Placement;

const WS_POPUP: u32 = 0x8000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;

const WM_SYSCOMMAND: u16 = 0x0112;
const WM_QUERYDRAGICON: u16 = 0x0037;
const SC_MINIMIZE: u16 = 0xf020;
const SC_CLOSE: u16 = 0xf060;
const SC_RESTORE: u16 = 0xf120;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const HWND_TOP: u16 = 0;

/// The hit-test code of a caption, which moves a window.
pub const HTCAPTION: u16 = 2;

/// What a window at the top is, for the host to make a window of its own
/// that behaves like it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopKind {
    /// A window with no `WS_POPUP`: an application's main window.
    Overlapped,
    /// A pop-up: a dialog, a box, a program's own pop-up.
    Popup,
    /// USER's own `#32768`, a pop-up menu's window.
    Menu,
    /// A combo box's list dropped down (`ComboLBox`).
    DropDown,
    /// Alt and Tab's switch window.
    Switch,
}

/// A window at the top -- one with no parent -- as the front end shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
// Each is a yes or no of the window's, as USER keeps it.
#[allow(clippy::struct_excessive_bools)]
pub struct TopWindow {
    /// Its index among the windows, which names it for as long as it lives:
    /// a pop-up menu's window has no handle.
    pub index: usize,
    pub hwnd: u16,
    /// Where it is on the screen: left, top, width, height. Minimized,
    /// where it goes back to (`restore`) is what the host shows.
    pub rect: [i32; 4],
    /// Where a minimized or maximized window goes back to.
    pub restore: Option<[i32; 4]>,
    /// Its place in the order of windows, nought in front.
    pub z: usize,
    /// The window at the top that owns it.
    pub owner: Option<usize>,
    /// The task it belongs to.
    pub task: u16,
    pub visible: bool,
    pub placement: Placement,
    pub caption: String,
    pub kind: TopKind,
    /// Whether it is the active window.
    pub active: bool,
    /// Whether it has a caption, and a sizing frame.
    pub captioned: bool,
    pub sizable: bool,
    pub disabled: bool,
}

/// A drag the host is asked to carry out: the window, the hit-test code it
/// was pressed on -- `HTCAPTION` to move it, a frame's edge or corner to
/// size it -- where it is, and the least and the most it may be sized to,
/// as it answered `WM_GETMINMAXINFO` as the loop began.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostDrag {
    pub index: usize,
    pub hwnd: u16,
    pub hit: u16,
    pub rect: [i32; 4],
    pub limits: Option<[(i32, i32); 2]>,
}

/// What the host asks of a window, carried out by the next task to look
/// for a message while nothing has the mouse's capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostRequest {
    /// Switched to, as Alt and Tab switches; `restore`: restored too where
    /// it is minimized.
    Activate {
        hwnd: u16,
        restore: bool,
    },
    Minimize {
        hwnd: u16,
    },
    Close {
        hwnd: u16,
    },
    /// `WM_QUERYDRAGICON` asked, for a window with no class icon.
    Icon {
        hwnd: u16,
    },
}

/// An icon's pixels, red, green, blue and alpha, a byte each, row by row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconRgba {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// What seamless mode keeps.
#[derive(Debug, Default)]
pub struct Seamless {
    /// Whether the host carries out the mouse's moves and sizes.
    pub host_drags: bool,
    /// The drag the host is to carry out, until it takes it.
    drag: Option<HostDrag>,
    /// The window USER's loop is waiting on the host's drag for.
    dragging: Option<u16>,
    /// Where the host's drag has the window now.
    placed: Option<[i32; 4]>,
    requests: Vec<HostRequest>,
    /// Counts the changes of the list of windows at the top.
    generation: u64,
    last: Vec<TopWindow>,
    /// What `WM_QUERYDRAGICON` answered, by window; nought while asked.
    dragged_icons: Vec<(u16, u16)>,
}

impl System {
    /// Seamless mode turned on: `host_drags`, the host carries out the
    /// mouse's moves and sizes.
    pub fn set_seamless(&mut self, host_drags: bool) {
        self.seamless = Some(Seamless {
            host_drags,
            ..Seamless::default()
        });
    }

    /// The windows at the top, front to back, the hidden among them: every
    /// window with no parent but the titles of icons, which the desktop
    /// draws.
    pub fn top_windows(&self) -> Vec<TopWindow> {
        let active = self.active_top();
        let mut tops = Vec::new();

        for &index in &self.z_order {
            let Some(window) = self.windows[index].as_ref() else {
                continue;
            };

            if window.parent.is_some() || window.title_of.is_some() {
                continue;
            }

            let kind = if window.popup.is_some() {
                TopKind::Menu
            } else if window.switch_bits.is_some() {
                TopKind::Switch
            } else if window.class.eq_ignore_ascii_case("ComboLBox") {
                TopKind::DropDown
            } else if window.style & WS_POPUP != 0 {
                TopKind::Popup
            } else {
                TopKind::Overlapped
            };

            tops.push(TopWindow {
                index,
                hwnd: window.hwnd,
                rect: [window.left, window.top, window.width, window.height],
                restore: window.restore_rect,
                z: tops.len(),
                owner: window.owner,
                task: window.task,
                visible: window.visible,
                placement: window.placement,
                caption: window.title.clone(),
                kind,
                active: active == Some(index),
                captioned: window.style & WS_CAPTION == WS_CAPTION,
                sizable: window.style & WS_THICKFRAME != 0,
                disabled: window.style & WS_DISABLED != 0,
            });
        }

        tops
    }

    /// A count that changes whenever the windows at the top do: none
    /// outside seamless mode.
    pub fn top_windows_generation(&mut self) -> u64 {
        let tops = self.top_windows();
        let Some(seamless) = self.seamless.as_mut() else {
            return 0;
        };

        if seamless.last != tops {
            seamless.last = tops;
            seamless.generation += 1;
        }

        seamless.generation
    }

    /// The drag the host is to carry out, taken.
    pub fn take_host_drag(&mut self) -> Option<HostDrag> {
        self.seamless.as_mut()?.drag.take()
    }

    /// The window whose move or size waits on the host's drag.
    pub fn host_dragging(&self) -> Option<u16> {
        self.seamless.as_ref()?.dragging
    }

    /// Where the host's drag has put the window: left, top, width, height
    /// on the screen. Placed there when the drag lets go.
    pub fn host_drag_to(&mut self, hwnd: u16, rect: [i32; 4]) {
        if let Some(seamless) = self.seamless.as_mut()
            && seamless.dragging == Some(hwnd)
        {
            seamless.placed = Some(rect);
        }
    }

    /// Something the host asks of a window, for a task to carry out: the
    /// window's task woken to.
    pub fn host_request(&mut self, request: HostRequest) {
        let hwnd = match request {
            HostRequest::Activate { hwnd, .. }
            | HostRequest::Minimize { hwnd }
            | HostRequest::Close { hwnd }
            | HostRequest::Icon { hwnd } => hwnd,
        };
        let Some(seamless) = self.seamless.as_mut() else {
            return;
        };

        if !seamless.requests.contains(&request) {
            seamless.requests.push(request);
        }

        if let Some(slot) = self.window_slot(hwnd).or_else(|| self.lone_slot()) {
            self.signal_slot(slot);
        }
    }

    /// Whether a request waits, to be carried out now: none while anything
    /// has the mouse's capture, as a press activates nothing then.
    fn host_requests_due(&self) -> bool {
        self.task.is_some()
            && self.capture.is_none()
            && self
                .seamless
                .as_ref()
                .is_some_and(|seamless| !seamless.requests.is_empty())
    }

    /// A window's icon for the host: its class's, else what it answered
    /// `WM_QUERYDRAGICON` with -- asked, once it is minimized, where it has
    /// not been yet.
    pub fn window_icon_rgba(&mut self, hwnd: u16) -> Option<IconRgba> {
        let index = self.window_named(hwnd)?;
        let window = self.windows[index].as_ref()?;
        let minimized = window.placement == Placement::Minimized;
        let icon = if let Some(icon) = window.icon.clone() {
            icon
        } else {
            let asked = self
                .seamless
                .as_ref()?
                .dragged_icons
                .iter()
                .find(|(one, _)| *one == hwnd)
                .map(|&(_, handle)| handle);

            match asked {
                Some(handle) if handle != 0 => self.minimized_icon_of(handle)?,
                Some(_) => return None,
                None => {
                    if minimized {
                        self.host_request(HostRequest::Icon { hwnd });
                    }

                    return None;
                }
            }
        };

        Some(self.icon_rgba(&icon))
    }

    /// An icon drawn as the screen draws it, over black and over white: a
    /// pixel the same over both is the icon's; black over black and white
    /// over white is clear; else it inverts what is under it, and is shown
    /// as it shows over black.
    fn icon_rgba(&mut self, icon: &winbox_raster::IconData) -> IconRgba {
        let screen = self.screen_bitmap();
        let (width, height) = (icon.width as i32, icon.height as i32);
        let white = u8::try_from((1u32 << screen.depth.min(8)) - 1).unwrap_or(u8::MAX);
        let over = |under: u8| {
            let scratch = DeviceBitmap::new(
                width,
                height,
                screen.depth,
                None,
                Some(screen.device_palette.clone()),
            );

            for y in 0..height {
                for x in 0..width {
                    scratch.put(x, y, under);
                }
            }

            crate::desktop_paint::draw_icon_at(&scratch, 0, 0, icon);
            scratch
        };
        let (black, light) = (over(0), over(white));
        let colours = self.shown_lookup(&screen);
        let colour = |index: u8| colours.get(usize::from(index)).copied().unwrap_or(0);
        let mut rgba = Vec::with_capacity(icon.width * icon.height * 4);

        for y in 0..height {
            for x in 0..width {
                let a = black.index_at(x, y).unwrap_or(0);
                let b = light.index_at(x, y).unwrap_or(0);
                let clear = a == 0 && b == white;
                let pixel = colour(a);

                rgba.extend_from_slice(&[
                    (pixel >> 16) as u8,
                    (pixel >> 8) as u8,
                    pixel as u8,
                    if clear { 0 } else { 0xff },
                ]);
            }
        }

        IconRgba {
            width: icon.width as u32,
            height: icon.height as u32,
            rgba,
        }
    }
}

impl Engine {
    /// The host's drag asked for, in place of USER's loop: in seamless mode
    /// alone, with the host carrying out drags, and only for the mouse.
    pub(crate) fn host_drag_begin(&self, drag: HostDrag) -> bool {
        let mut system = self.system();
        let Some(seamless) = system.seamless.as_mut() else {
            return false;
        };

        if !seamless.host_drags {
            return false;
        }

        seamless.drag = Some(drag);
        seamless.dragging = Some(drag.hwnd);
        seamless.placed = None;
        true
    }

    /// Where the host let the window go, if it moved it; the drag over.
    pub(crate) fn host_drag_end(&self, finished: bool) -> Option<[i32; 4]> {
        let mut system = self.system();
        let seamless = system.seamless.as_mut()?;
        let placed = seamless.placed.take();

        if finished {
            seamless.drag = None;
            seamless.dragging = None;
        }

        placed
    }

    /// What the host asked, carried out by the task looking for a message,
    /// while nothing has the mouse's capture.
    pub(crate) async fn host_requests(&self) -> Result<(), Stop> {
        let requests = {
            let mut system = self.system();

            if !system.host_requests_due() {
                return Ok(());
            }

            std::mem::take(&mut system.seamless.as_mut().expect("seamless").requests)
        };

        for request in requests {
            match request {
                HostRequest::Activate { hwnd, restore } => {
                    self.host_activate(hwnd, restore).await?;
                }
                HostRequest::Minimize { hwnd } => {
                    self.send_message(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, &mut Param::Value(0))
                        .await?;
                }
                HostRequest::Close { hwnd } => {
                    self.send_message(hwnd, WM_SYSCOMMAND, SC_CLOSE, &mut Param::Value(0))
                        .await?;
                }
                HostRequest::Icon { hwnd } => {
                    let handle = self
                        .send_message(hwnd, WM_QUERYDRAGICON, 0, &mut Param::Value(0))
                        .await? as u16;
                    let mut system = self.system();

                    if let Some(seamless) = system.seamless.as_mut() {
                        seamless.dragged_icons.retain(|(one, _)| *one != hwnd);
                        seamless.dragged_icons.push((hwnd, handle));
                    }
                }
            }
        }

        Ok(())
    }

    /// A window switched to as Alt and Tab's loop switches to it.
    async fn host_activate(&self, hwnd: u16, restore: bool) -> Result<(), Stop> {
        let target = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let index = if system.disabled(index) {
                match system.owned_to_bring_up(index) {
                    Some((owned, _)) => owned,
                    None => return Ok(()),
                }
            } else {
                index
            };
            let window = system.windows[index].as_ref().expect("a window");

            (index, window.hwnd, window.placement == Placement::Minimized)
        };
        let (index, target, minimized) = target;

        self.position_raster(target, index, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE)
            .await?;

        if restore && minimized {
            self.system()
                .post_message(target, WM_SYSCOMMAND, SC_RESTORE, 0);
        }

        Ok(())
    }
}
