//! Windows made: `CreateWindow` and `CreateWindowEx`, and USER's own
//! hidden windows made as the first program starts. A window's place, its
//! frame's geometry and its family are kept here; it is not yet drawn.

use winbox_machine::{handle_for, segment_selector};

use crate::call::{Answer, Args, Later, Stop};
use crate::classes::{CONTROL_CLASSES, HostProc, WindowClass, WndProc};
use crate::engine::Engine;
use crate::handles::{Kind, Object};
use crate::menu_bar::bar_layout;
use crate::menus::MenuName;
use crate::messages::{
    Param, WM_CREATE, WM_GETMINMAXINFO, WM_MOVE, WM_NCCALCSIZE, WM_NCCREATE, WM_NCDESTROY,
    WM_PARENTNOTIFY, WM_SIZE,
};
use crate::system::System;
use crate::windows::{Placement, Rect, Window};

pub const WS_POPUP: u32 = 0x8000_0000;
pub const WS_CHILD: u32 = 0x4000_0000;
pub const WS_MINIMIZE: u32 = 0x2000_0000;
pub const WS_VISIBLE: u32 = 0x1000_0000;
pub const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
pub const WS_MAXIMIZE: u32 = 0x0100_0000;
pub const WS_CAPTION: u32 = 0x00c0_0000;
pub const WS_BORDER: u32 = 0x0080_0000;
pub const WS_DLGFRAME: u32 = 0x0040_0000;
pub const WS_VSCROLL: u32 = 0x0020_0000;
pub const WS_HSCROLL: u32 = 0x0010_0000;
pub const WS_THICKFRAME: u32 = 0x0004_0000;

const WS_EX_DLGMODALFRAME: u32 = 0x0001;
const WS_EX_TOPMOST: u32 = 0x0008;

const SM_CXSCREEN: i16 = 0;
const SM_CYSCREEN: i16 = 1;
const SM_CXVSCROLL: i16 = 2;
const SM_CYHSCROLL: i16 = 3;
const SM_CYCAPTION: i16 = 4;
const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXDLGFRAME: i16 = 7;
const SM_CYDLGFRAME: i16 = 8;
const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;
const SM_CXMIN: i16 = 28;
const SW_SHOW: u16 = 5;
const SM_CYMENU: i16 = 15;
const SM_CYMIN: i16 = 29;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;
const SM_CXMINTRACK: i16 = 34;
const SM_CYMINTRACK: i16 = 35;
const SM_CYICONSPACING: i16 = 39;

/// USER's own hidden windows at the top, made by the first `InitApp`:
/// **recorded** by `hidwnd`, front to back the task list's (topmost), the
/// one with a caption, and the menus'. Made in this order.
const USER_WINDOWS: [(&str, u32, u32, i32, i32); 3] = [
    ("#32768", 0x8400_0000, 0, 100, 100),
    ("#42", 0x04c0_0000, 0, 102, 26),
    ("#32771", 0x8c00_0000, WS_EX_TOPMOST, 10, 10),
];

/// Whether a place or a size is `CW_USEDEFAULT`, its low word: asked of
/// it as the defaults leave it, not as it was given.
fn unset(value: i32) -> bool {
    value & 0xffff == 0x8000
}

/// A window's name as `CreateWindow` is given it.
#[derive(Debug, Clone)]
pub enum WindowName {
    None,
    /// A program's string, by its far pointer, and its text.
    Given(u32, String),
    /// Text USER gives it itself, copied into a block of its own.
    Own(String),
}

/// What a window is made with.
#[derive(Debug, Clone)]
pub struct Creation {
    pub ex_style: u32,
    /// Its class's name, and the far pointer it was given by -- nought for
    /// USER's own.
    pub class: String,
    pub class_far: u32,
    pub name: WindowName,
    pub style: u32,
    pub x: i16,
    pub y: i16,
    pub width: i16,
    pub height: i16,
    pub parent: u16,
    pub menu: u16,
    pub instance: u16,
    pub param: u32,
}

impl System {
    pub(crate) fn metric(&self, index: i16) -> i32 {
        let display = &self.display;
        let metrics = &display.metrics;

        i32::from(match index {
            0 | 16 => display.width,
            1 => display.height,
            17 => display.height - metrics.caption_height,
            _ => match display.metrics_by_index.get(&index.to_string()) {
                Some(&recorded) => recorded,
                None => match index {
                    4 => metrics.caption_height,
                    15 => metrics.menu_height,
                    5 => metrics.border_width,
                    6 => metrics.border_height,
                    32 => metrics.frame_width,
                    33 => metrics.frame_height,
                    11 => metrics.icon_width,
                    12 => metrics.icon_height,
                    _ => 0,
                },
            },
        })
    }

    /// A window's client area, as its frame leaves it (`paintFrame`'s
    /// geometry): within a thick frame, a dialog frame or a border; below
    /// its caption and its menu bar's rows; beside its scroll bars. An icon
    /// is all client area.
    pub fn client_of(&self, window: &Window) -> Result<Rect, Stop> {
        let (width, height) = (window.width, window.height);

        if window.placement == Placement::Minimized {
            return Ok(Rect {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            });
        }

        let style = window.style;
        let has_caption = style & WS_CAPTION == WS_CAPTION;
        let thick = style & WS_THICKFRAME != 0;
        let modal = window.modal_frame && !thick;
        let dialog = modal || (!has_caption && style & WS_DLGFRAME != 0);
        let bordered = has_caption || style & WS_BORDER != 0;
        let (inset, inset_y) = if thick {
            (self.metric(SM_CXFRAME), self.metric(SM_CYFRAME))
        } else if dialog {
            (
                self.metric(SM_CXDLGFRAME) + 1,
                self.metric(SM_CYDLGFRAME) + 1,
            )
        } else if bordered {
            (1, 1)
        } else {
            (0, 0)
        };
        let mut client = Rect {
            left: inset,
            top: inset_y,
            right: width - inset,
            bottom: height - inset_y,
        };

        if has_caption {
            let caption_top = if thick || modal { inset_y - 1 } else { 0 };

            client.top = caption_top + self.metric(SM_CYCAPTION);
        }

        // The menu bar's rows, a pixel taller than the bar each, the line
        // under the last (`menuhelp`).
        if let Some(Object::Menu(menu)) = self.handles.resolve(window.menu) {
            if self.desktop_font.is_none() {
                return Err(Stop::Unsupported("a menu bar before the raster desktop"));
            }

            let labels = self.menus[menu].labels();
            let measure = |line: &str| self.system_text_width(line).unwrap_or(0);
            let (_, rows) = bar_layout(&labels, measure, inset, width - inset);

            client.top += rows * (self.metric(SM_CYMENU) + 1);
        }

        let overlap = i32::from(inset > 0 || inset_y > 0);

        if style & WS_VSCROLL != 0 {
            client.right -= self.metric(SM_CXVSCROLL) - overlap;
        }

        if style & WS_HSCROLL != 0 {
            client.bottom -= self.metric(SM_CYHSCROLL) - overlap;
        }

        Ok(client)
    }

    /// Where a window at the top goes in the order: at the front of its
    /// kind, the topmost first.
    fn front(&self, topmost: bool) -> usize {
        if topmost {
            return 0;
        }

        self.z_order
            .iter()
            .position(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_none_or(|other| !other.topmost)
            })
            .unwrap_or(self.z_order.len())
    }

    /// The `MINMAXINFO` a window is asked with: its reserved point, the
    /// size and place it is maximized to, and its tracking sizes.
    fn min_max_info(&self, style: u32) -> Vec<u8> {
        let thick = style & WS_THICKFRAME != 0;
        let (bx, by) = (self.metric(SM_CXBORDER), self.metric(SM_CYBORDER));
        let (fx, fy) = (self.metric(SM_CXFRAME), self.metric(SM_CYFRAME));
        let (sx, sy) = (self.metric(SM_CXSCREEN), self.metric(SM_CYSCREEN));
        let points = [
            (
                self.metric(SM_CXICON) + 4 * bx,
                self.metric(SM_CYICON) + 4 * by,
            ),
            if thick {
                (sx + 2 * fx, sy + 2 * fy)
            } else {
                (sx + 4 * bx, sy + 4 * by)
            },
            if thick { (-fx, -fy) } else { (-bx, -by) },
            if style & WS_CAPTION == WS_CAPTION {
                (self.metric(SM_CXMINTRACK), self.metric(SM_CYMINTRACK))
            } else {
                (bx, by)
            },
            (sx + 2 * fx, sy + 2 * fy),
        ];

        points
            .iter()
            .flat_map(|&(x, y)| [(x as i16).to_le_bytes(), (y as i16).to_le_bytes()])
            .flatten()
            .collect()
    }

    /// A window's size no less than the least it may be: an overlapped
    /// window's `SM_CXMIN` by `SM_CYMIN` (`minsize`).
    fn least_size(&self, style: u32, cx: i32, cy: i32) -> (i32, i32) {
        if style & (WS_POPUP | WS_CHILD) == 0 {
            return (cx.max(self.metric(SM_CXMIN)), cy.max(self.metric(SM_CYMIN)));
        }

        (cx, cy)
    }

    /// The instance of the program that has the processor: its data
    /// segment's selector less one.
    fn program_instance(&self) -> u16 {
        self.task
            .as_ref()
            .and_then(|task| self.modules[task.program].data())
            .map_or(0, |data| segment_selector(data) - 1)
    }

    /// Text copied into a block of its own, as USER copies a name it gives
    /// a window itself: its handle and a far pointer to it.
    fn name_block(&mut self, text: &str) -> (u16, u32) {
        let Some(index) = self.global.allocate(
            &mut self.cpu.bus,
            &mut self.descriptors,
            text.len() as u32 + 1,
            0x42,
        ) else {
            return (0, 0);
        };
        let mut bytes = text.as_bytes().to_vec();

        bytes.push(0);
        self.cpu.bus.write((index as u32) << 16, &bytes);
        (handle_for(index), u32::from(segment_selector(index)) << 16)
    }
}

/// The window an index of the windows names.
fn window(system: &System, index: usize) -> &Window {
    system.windows[index]
        .as_ref()
        .expect("a window not destroyed")
}

impl Engine {
    /// A window made, as `CreateWindow` makes one: its handle, nought for
    /// none.
    #[allow(clippy::too_many_lines)]
    pub async fn create_window(&self, mut made: Creation) -> Result<u16, Stop> {
        let (index, hwnd, child, create_struct) = {
            let mut system = self.system();
            let parent = if made.parent == 0 {
                None
            } else {
                match system.handles.resolve(made.parent) {
                    Some(Object::Window(index)) => Some(index),
                    // The desktop as a parent: a window at the top.
                    Some(Object::Desktop) => None,
                    _ => return Ok(0),
                }
            };

            // A window is USER's own, drawn on the raster desktop. Without
            // one -- no Windows installation to draw it with -- there is no
            // window.
            if !system.raster() {
                return Ok(0);
            }

            let child = made.style & WS_CHILD != 0 && parent.is_some();
            let class_name = made.class.to_ascii_uppercase();

            if CONTROL_CLASSES.contains(&class_name.as_str()) {
                return Err(Stop::Unsupported("a control"));
            }

            if class_name == "MDICLIENT" {
                return Err(Stop::Unsupported("an MDI client"));
            }

            // A class nobody registered makes no window.
            let Some(class) = system.class_named(&made.class) else {
                return Ok(0);
            };
            let class: WindowClass = system.classes[class].clone();
            let (mut x, mut y, mut width, mut height) = (
                i32::from(made.x),
                i32::from(made.y),
                i32::from(made.width),
                i32::from(made.height),
            );
            let menu = if child {
                0
            } else if made.menu != 0 {
                made.menu
            } else {
                class.menu
            };
            // The style as the program asked, which `CREATESTRUCT` carries;
            // then a window not a child kept from drawing over its siblings
            // (`hidwnd`), and an overlapped one always captioned (`ovlstyle`).
            let asked = made.style;

            if made.style & WS_CHILD == 0 {
                made.style |= WS_CLIPSIBLINGS;
            }

            if made.style & (WS_CHILD | WS_POPUP) == 0 {
                made.style |= WS_CAPTION;
            }

            // CW_USEDEFAULT: a pop-up at nought, nought big; an overlapped
            // window the next step of a cascade, to the screen's right edge
            // less a frame and down to the icons (`usedef`), and no smaller
            // than the least (`minsize`).
            if !child && made.style & WS_CHILD == 0 {
                if made.style & WS_POPUP != 0 {
                    if unset(x) {
                        (x, y) = (0, 0);
                    }

                    if unset(width) {
                        (width, height) = (0, 0);
                    }
                } else {
                    if unset(x) {
                        let step = system.cascade_step;

                        x = step * (system.metric(SM_CXSIZE) + system.metric(SM_CXFRAME));
                        y = step * (system.metric(SM_CYSIZE) + system.metric(SM_CYFRAME));
                        system.cascade_step = step + 1;
                    }

                    if unset(width) {
                        width = system.metric(SM_CXSCREEN) - system.metric(SM_CXFRAME) - x;
                        height = system.metric(SM_CYSCREEN) - system.metric(SM_CYICONSPACING) - y;
                    }

                    (width, height) = system.least_size(made.style, width, height);
                }
            }

            let (offset_x, offset_y) = parent.filter(|_| child).map_or((0, 0), |parent| {
                let parent = window(&system, parent);

                (
                    parent.left + parent.client.left,
                    parent.top + parent.client.top,
                )
            });
            let title = match &made.name {
                WindowName::None => String::new(),
                WindowName::Given(_, text) | WindowName::Own(text) => text.clone(),
            };
            let mut shown = Window {
                left: if unset(x) { 0 } else { x + offset_x },
                top: if unset(x) { 0 } else { y + offset_y },
                width: if unset(width) { 0 } else { width },
                height: if unset(width) { 0 } else { height },
                style: made.style,
                ex_style: made.ex_style,
                title,
                class: made.class.clone(),
                menu,
                parent: parent.filter(|_| child),
                control_id: if child { made.menu } else { 0 },
                modal_frame: made.ex_style & WS_EX_DLGMODALFRAME != 0,
                ..Window::default()
            };

            shown.client = system.client_of(&shown)?;

            // A window at the top given a parent is owned, by the window at
            // the top the parent is in (`owners`).
            if !child && let Some(mut top) = parent {
                while let Some(above) = window(&system, top).parent {
                    top = above;
                }

                shown.owner = Some(top);
            }

            let index = system.windows.len();

            system.windows.push(Some(shown));

            // Above its parent, below its older siblings; a window at the
            // top at the front of its kind.
            let at = match parent.filter(|_| child) {
                Some(parent) => system
                    .z_order
                    .iter()
                    .position(|&other| other == parent)
                    .unwrap_or(0),
                None => system.front(false),
            };

            system.z_order.insert(at, index);

            let hwnd = system
                .handles
                .allocate(Kind::Window, Object::Window(index))
                .unwrap_or(0);
            let task = system.task_handle;
            let instance = if made.instance != 0 {
                made.instance
            } else {
                system.program_instance()
            };
            let shown = system.windows[index].as_mut().expect("the window made");

            shown.hwnd = hwnd;
            shown.task = task;
            shown.instance = instance;
            shown.extra = vec![0; usize::try_from(class.wnd_extra).unwrap_or(0)];

            // The class's icon is what the window shows minimized.
            let icon = if class.icon == 0 {
                None
            } else {
                system.icon_of(class.icon)
            };

            system.windows[index]
                .as_mut()
                .expect("the window made")
                .icon = icon;

            // The name as `CREATESTRUCT` carries it: the program's string, or
            // a name USER gave copied into a block of its own, freed with the
            // window.
            let name = match &made.name {
                WindowName::None => 0,
                WindowName::Given(far, _) => *far,
                WindowName::Own(text) => {
                    let text = text.clone();
                    let (block, far) = system.name_block(&text);

                    if let Some(shown) = system.windows[index].as_mut() {
                        shown.name_block = block;
                    }

                    far
                }
            };
            // The place USER chose for a default one; the size as asked,
            // CW_USEDEFAULT and all, but a pop-up's (`usedef`).
            let popup = !child && made.style & WS_POPUP != 0;
            let cy = if popup { height as i16 } else { made.height };
            let cx = if popup { width as i16 } else { made.width };
            let place_x = if child { made.x } else { x as i16 };
            let place_y = if child { made.y } else { y as i16 };
            let mut bytes = Vec::with_capacity(30);

            bytes.extend_from_slice(&made.param.to_le_bytes());
            bytes.extend_from_slice(&instance.to_le_bytes());
            bytes.extend_from_slice(&made.menu.to_le_bytes());
            bytes.extend_from_slice(&made.parent.to_le_bytes());

            for value in [cy, cx, place_y, place_x] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }

            bytes.extend_from_slice(&asked.to_le_bytes());
            bytes.extend_from_slice(&name.to_le_bytes());
            bytes.extend_from_slice(&made.class_far.to_le_bytes());
            bytes.extend_from_slice(&made.ex_style.to_le_bytes());

            (index, hwnd, child, bytes)
        };

        // What a window is sent as it is made (`showseq`): an overlapped
        // window `WM_GETMINMAXINFO` first; then `WM_NCCREATE`, `WM_NCCALCSIZE`
        // with its rectangle on the screen, and `WM_CREATE`.
        if made.style & (WS_CHILD | WS_POPUP) == 0 {
            let mut info = Param::Struct(self.system().min_max_info(made.style));

            self.send_message(hwnd, WM_GETMINMAXINFO, 0, &mut info)
                .await?;
        }

        let mut create = Param::Struct(create_struct);
        let accepted = self.send_message(hwnd, WM_NCCREATE, 0, &mut create).await?;

        // Answered nought, the window is not made: sent `WM_NCDESTROY` and
        // nothing more; its handle free for the next (`showsq2`).
        if accepted as u16 == 0 {
            self.send_message(hwnd, WM_NCDESTROY, 0, &mut Param::Value(0))
                .await?;

            let mut guard = self.system();
            let system = &mut *guard;
            let block = window(system, index).name_block;

            if block != 0 {
                let index = winbox_machine::index_for(block);

                system
                    .global
                    .free(&mut system.cpu.bus, &mut system.descriptors, index);
            }

            system.z_order.retain(|&other| other != index);
            system.windows[index] = None;
            system.handles.free(hwnd);
            return Ok(0);
        }

        let frame = {
            let system = self.system();
            let shown = window(&system, index);
            let mut bytes = Vec::with_capacity(8);

            for value in [
                shown.left,
                shown.top,
                shown.left + shown.width,
                shown.top + shown.height,
            ] {
                bytes.extend_from_slice(&(value as i16).to_le_bytes());
            }

            bytes
        };

        self.send_message(hwnd, WM_NCCALCSIZE, 0, &mut Param::Struct(frame))
            .await?;
        self.send_message(hwnd, WM_CREATE, 0, &mut create).await?;

        // A child or a pop-up is told its size and place at once; an
        // overlapped window is owed them until it is first shown.
        if made.style & (WS_CHILD | WS_POPUP) != 0 {
            self.notify_size(hwnd, index).await?;
        } else if let Some(shown) = self.system().windows[index].as_mut() {
            shown.owes_size = true;
        }

        // A child's parent is told of it (`showseq`).
        if child && made.parent != 0 {
            let lparam = u32::from(hwnd) | u32::from(made.menu) << 16;

            self.send_message(
                made.parent,
                WM_PARENTNOTIFY,
                WM_CREATE,
                &mut Param::Value(lparam),
            )
            .await?;
        }

        if made.style & (WS_MAXIMIZE | WS_MINIMIZE) != 0 && made.style & (WS_CHILD | WS_POPUP) == 0
        {
            return Err(Stop::Unsupported("a window made maximized or minimized"));
        }

        // A window made visible shows at once, a top-level one active, as
        // `ShowWindow` shows it; an overlapped window given `CW_USEDEFAULT`
        // for its place is shown as its `y` says -- `SW_HIDE`, nought, not
        // at all (`showseq`).
        if made.style & WS_VISIBLE != 0 {
            let command = if made.style & (WS_CHILD | WS_POPUP) == 0 && unset(i32::from(made.x)) {
                made.y as u16
            } else {
                SW_SHOW
            };

            if command != crate::window_state::SW_HIDE {
                self.show_raster(hwnd, index, command, true, true).await?;
            }
        }

        // A window at the top with no owner would be told to the shell hooks
        // (`shlhook`): none can be set yet.
        Ok(hwnd)
    }

    /// A window told its size and place: `WM_SIZE` with its client area's,
    /// and `WM_MOVE` with where its client area is in its parent's, or on
    /// the screen.
    pub async fn notify_size(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let (kind, size, origin) = self.system().size_and_origin(index);

        self.send_message(hwnd, WM_SIZE, kind, &mut Param::Value(size))
            .await?;
        self.send_message(hwnd, WM_MOVE, 0, &mut Param::Value(origin))
            .await?;
        Ok(())
    }
}

impl System {
    /// A window's state, client size and client origin in its parent, as
    /// `WM_SIZE` and `WM_MOVE` carry them.
    pub fn size_and_origin(&self, index: usize) -> (u16, u32, u32) {
        {
            let system = self;
            let shown = window(system, index);
            let kind: u16 = match shown.placement {
                Placement::Maximized => 2,
                Placement::Minimized => 1,
                Placement::Normal => 0,
            };
            let size = (shown.client_width() as u32 & 0xffff)
                | (shown.client_height() as u32 & 0xffff) << 16;
            let (x, y) = match shown.parent {
                Some(parent) => {
                    let parent = window(system, parent);

                    (
                        shown.left - parent.left - parent.client.left + shown.client.left,
                        shown.top - parent.top - parent.client.top + shown.client.top,
                    )
                }
                None => (shown.left + shown.client.left, shown.top + shown.client.top),
            };

            (kind, size, (x as u32 & 0xffff) | (y as u32 & 0xffff) << 16)
        }
    }
}

impl Engine {
    /// USER's own hidden windows, made by the first task's `InitApp` on a
    /// desktop with an installation to draw it: their classes registered,
    /// `DefWindowProc` theirs, and each made with no title.
    pub async fn make_user_windows(&self) -> Result<(), Stop> {
        {
            let mut system = self.system();

            if system.user_windows_made || system.driver.is_none() {
                return Ok(());
            }

            system.raster();
            system.user_windows_made = true;
        }

        for (name, style, ex_style, width, height) in USER_WINDOWS {
            {
                let mut system = self.system();

                if system.handles.retrieve(name).is_none() {
                    system.register_class(WindowClass {
                        style: 0,
                        proc: WndProc::Host(HostProc::DefWindow),
                        cls_extra: 0,
                        wnd_extra: 0,
                        instance: 0,
                        icon: 0,
                        cursor: 0,
                        background: 0,
                        menu_name: None,
                        name: name.to_string(),
                        menu: 0,
                        extra: Vec::new(),
                    });
                }
            }

            self.create_window_ex(Creation {
                ex_style,
                class: name.to_string(),
                class_far: 0,
                name: WindowName::Own(String::new()),
                style,
                x: 0,
                y: 0,
                width: width as i16,
                height: height as i16,
                parent: 0,
                menu: 0,
                instance: 0,
                param: 0,
            })
            .await?;
        }

        Ok(())
    }

    /// `CreateWindowEx`'s window: as `CreateWindow` makes it, its extended
    /// style kept, and one at the top with `WS_EX_TOPMOST` moved to the
    /// front, kept above every window that is not.
    pub async fn create_window_ex(&self, made: Creation) -> Result<u16, Stop> {
        let ex_style = made.ex_style;
        let hwnd = self.create_window(made).await?;
        let mut system = self.system();

        if let Some(Object::Window(index)) = system.handles.resolve(hwnd) {
            let top = window(&system, index).parent.is_none();

            if ex_style & WS_EX_TOPMOST != 0 && top {
                if let Some(shown) = system.windows[index].as_mut() {
                    shown.topmost = true;
                }

                system.z_order.retain(|&other| other != index);

                let at = system.front(true);

                system.z_order.insert(at, index);
            }
        }

        Ok(hwnd)
    }
}

/// A name or a class as `CreateWindow` is given one: a string, or a number
/// in a pointer's place, its digits.
fn name_arg(system: &System, far: u32) -> Option<String> {
    MenuName::read(system, far).map(|name| match name {
        MenuName::Number(number) => number.to_string(),
        MenuName::Text(text) => text,
    })
}

fn creation(system: &System, args: &mut Args, ex_style: u32) -> Creation {
    let class_far = args.dword(system);
    let name_far = args.dword(system);
    let style = args.dword(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let width = args.signed(system);
    let height = args.signed(system);
    let parent = args.word(system);
    let menu = args.word(system);
    let instance = args.word(system);
    let param = args.dword(system);
    let name = match (name_far >> 16, name_far & 0xffff) {
        (0, 0) => WindowName::None,
        // A number in a pointer's place is a name USER gives, as digits.
        (0, number) => WindowName::Own(number.to_string()),
        _ => WindowName::Given(name_far, name_arg(system, name_far).unwrap_or_default()),
    };

    Creation {
        ex_style,
        class: name_arg(system, class_far).unwrap_or_default(),
        // A class given as a number has no string to point to.
        class_far: if class_far >> 16 == 0 { 0 } else { class_far },
        name,
        style,
        x,
        y,
        width,
        height,
        parent,
        menu,
        instance,
        param,
    }
}

pub fn create_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let made = creation(&engine.system(), &mut args, 0);

        Ok(Answer::Word(engine.create_window(made).await?))
    })
}

pub fn create_window_ex(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let made = {
            let system = engine.system();
            let ex_style = args.dword(&system);

            creation(&system, &mut args, ex_style)
        };

        Ok(Answer::Word(engine.create_window_ex(made).await?))
    })
}

impl System {
    /// Whether there is a raster desktop -- an installation's display
    /// driver to draw it with -- made the first time it is asked after, as
    /// the TypeScript engine makes it: whatever asks first, `InitApp`, a
    /// standard cursor or icon, a message's point, makes it.
    pub fn raster(&mut self) -> bool {
        if self.driver.is_none() {
            return false;
        }

        self.raster_desktop();
        true
    }

    /// The raster desktop made, the first time it is wanted: the System
    /// font it hands out, and the font an icon's title is in -- MS Sans
    /// Serif, eight points on the display's vertical resolution, normal
    /// weight (`sizing`: -11 on the VGA, -8 on the EGA, 400). Each is
    /// realized in a device context of its own, made and let go, which
    /// leaves nothing behind here.
    fn raster_desktop(&mut self) {
        if self.icon_title_font.is_some() {
            return;
        }

        crate::gdi::objects::stock_font_handle(self, crate::fonts::SYSTEM_FONT as i16);
        self.desktop_font = crate::fonts::stock_font(self.fonts(), crate::fonts::SYSTEM_FONT);

        let logical = crate::fonts::Device::of(&self.display).log_pixels_y;
        let height = -((8.0 * f64::from(logical)) / 72.0).round() as i16;
        let font = crate::gdi::objects::create_font_indirect(
            self,
            crate::fonts::LogFont {
                height,
                weight: 400,
                face_name: "MS Sans Serif".to_string(),
                ..crate::fonts::LogFont::default()
            },
        );

        self.icon_title_font = Some(font);
    }
}
