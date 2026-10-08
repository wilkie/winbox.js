//! The multiple document interface: a frame window, an `MDIClient` window
//! filling its client area, and document windows inside that --
//! winbox.js's `mdi.ts`.
//!
//! **Read out of `USER.EXE`**, segment 15 for the client and the default
//! procedures and segment 20 for the Window menu. Not measured.
//!
//! The client keeps its children, the active one, the maximized one, the
//! Window menu and the first child's identifier (from its
//! `CLIENTCREATESTRUCT`). A child is made through it with `WM_MDICREATE`,
//! given the identifier after the last, and listed in the Window menu: a
//! separator, then "&1 Title" and on, the active one checked, "&More
//! Windows..." after nine. `DefFrameProc` keeps the client the size of the
//! frame's client area and hands it the Window menu's commands;
//! `DefMDIChildProc` activates a child as it is clicked or focused, closes
//! it through the client, and maximizes it to the client's area.
//!
//! The client's scroll bars are `mdi_scroll.rs`. Not followed, as the
//! TypeScript engine does not follow them: a maximized child's system menu
//! and restore button in the frame's menu bar, and the frame's title while
//! one is; the "More Windows" dialog; arranging minimized children's icons;
//! and `WM_MENUCHAR`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::classes::{HostProc, WindowClass, WndProc};
use crate::control_host::text_of;
use crate::create::{Creation, WindowName};
use crate::engine::Engine;
use crate::mdi_scroll::{ClientScroll, WM_MDIRECALC};
use crate::menus::MenuItem;
use crate::messages::Param;
use crate::system::System;
use crate::user_calls::system_menu::SystemMenuKind;
use crate::windows::Placement;

pub const WM_MDICREATE: u16 = 0x0220;
pub const WM_MDIDESTROY: u16 = 0x0221;
pub const WM_MDIACTIVATE: u16 = 0x0222;
pub const WM_MDIRESTORE: u16 = 0x0223;
pub const WM_MDINEXT: u16 = 0x0224;
pub const WM_MDIMAXIMIZE: u16 = 0x0225;
pub const WM_MDITILE: u16 = 0x0226;
pub const WM_MDICASCADE: u16 = 0x0227;
pub const WM_MDIICONARRANGE: u16 = 0x0228;
pub const WM_MDIGETACTIVE: u16 = 0x0229;
pub const WM_MDISETMENU: u16 = 0x0230;

const WM_CREATE: u16 = 0x0001;
const WM_MOVE: u16 = 0x0003;
const WM_SIZE: u16 = 0x0005;
const WM_SETFOCUS: u16 = 0x0007;
const WM_SETTEXT: u16 = 0x000c;
const WM_CLOSE: u16 = 0x0010;
const WM_CHILDACTIVATE: u16 = 0x0022;
const WM_GETMINMAXINFO: u16 = 0x0024;
const WM_NCACTIVATE: u16 = 0x0086;
const WM_KEYDOWN: u16 = 0x0100;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_COMMAND: u16 = 0x0111;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_HSCROLL: u16 = 0x0114;
const WM_VSCROLL: u16 = 0x0115;
const WM_MENUCHAR: u16 = 0x0120;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_PARENTNOTIFY: u16 = 0x0210;

const SC_SIZE: u16 = 0xf000;
const SC_MOVE: u16 = 0xf010;
const SC_MINIMIZE: u16 = 0xf020;
const SC_MAXIMIZE: u16 = 0xf030;
const SC_NEXTWINDOW: u16 = 0xf040;
const SC_PREVWINDOW: u16 = 0xf050;
const SC_CLOSE: u16 = 0xf060;
const SC_KEYMENU: u16 = 0xf100;
const SC_RESTORE: u16 = 0xf120;

const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;
const SW_SHOWMINIMIZED: u16 = 2;
const SW_SHOWMAXIMIZED: u16 = 3;
const SW_SHOWMINNOACTIVE: u16 = 7;

const SIZE_MINIMIZED: u16 = 1;
const SIZE_MAXIMIZED: u16 = 2;

const WS_CHILD: u32 = 0x4000_0000;
const WS_MINIMIZE: u32 = 0x2000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
const WS_MAXIMIZE: u32 = 0x0100_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;

const MF_BITMAP: u16 = 0x0004;
const MF_CHECKED: u16 = 0x0008;
const MF_POPUP: u16 = 0x0010;
const MF_HELP: u16 = 0x4000;
const WS_SYSMENU: u32 = 0x0008_0000;

/// The bitmaps of USER's own that a maximized child's items in the frame's
/// bar show, by the handles they are given: its system menu box, and its
/// restore box (seg20 `011a`-`0142`).
pub const MDI_SYSTEM_BITMAP: u16 = 1;
pub const MDI_RESTORE_BITMAP: u16 = 2;
const MF_SEPARATOR: u16 = 0x0800;

const VK_TAB: u16 = 0x09;
const VK_SHIFT: usize = 0x10;
const VK_CONTROL: usize = 0x11;
const VK_MENU: usize = 0x12;
const VK_F4: u16 = 0x73;
const VK_F6: u16 = 0x75;

/// `SWP_NOZORDER | SWP_NOACTIVATE`: `MoveWindow`'s.
const MOVED: u16 = 0x0004 | 0x0010;

/// The class's name, as USER registers it.
const MDI_CLIENT: &str = "MDIClient";

const MORE_WINDOWS: &str = "&More Windows...";

/// What an MDI client keeps.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Client {
    /// Its children made through it, in the order they were made: the
    /// Window menu's order, and their identifiers'.
    pub children: Vec<u16>,
    pub active: u16,
    pub maxed: u16,
    pub window_menu: u16,
    /// The first child's identifier.
    pub first: u16,
    /// The next step of the cascade a child made with no place takes.
    pub cascade: i32,
    pub scroll: ClientScroll,
    /// The frame's own title, which a maximized child's is put after
    /// (seg15 `1135`-`113e`).
    pub title: String,
}

/// A window's handle, its index, if it is one.
fn named(system: &System, hwnd: u16) -> Option<usize> {
    if hwnd == 0 {
        None
    } else {
        system.window_named(hwnd)
    }
}

impl System {
    /// The `MDIClient` class, registered the first time a window of it is
    /// asked for (seg3 `1595`): sixteen extra bytes a window, the
    /// application workspace's colour behind it.
    pub(crate) fn mdi_client_class(&mut self) {
        if self.class_named(MDI_CLIENT).is_some() {
            return;
        }

        self.register_class(WindowClass {
            style: 0,
            proc: WndProc::Host(HostProc::MdiClient),
            cls_extra: 0,
            wnd_extra: 0x10,
            instance: 0,
            icon: 0,
            cursor: 0,
            background: 0x0d,
            menu_name: None,
            name: MDI_CLIENT.to_string(),
            menu: 0,
            extra: Vec::new(),
        });
    }

    /// A frame's menu bar shown again as its menu now is, as `DrawMenuBar`
    /// shows it.
    fn redraw_frame_bar(&mut self, frame: usize) -> Result<(), Stop> {
        let menu = self.windows[frame].as_ref().map_or(0, |window| window.menu);

        if let Some(found) = self.menu_of(menu) {
            let labels = self.menus[found].labels();
            let grayed = self.menus[found].grayed();

            self.set_bar(frame, Some(labels), Some(grayed))?;
        }

        Ok(())
    }

    /// The frame a client is in, by its index.
    fn frame_of_client(&self, client: u16) -> Option<usize> {
        named(self, client).and_then(|index| self.windows[index].as_ref()?.parent)
    }

    /// A maximized child's system menu put first in the frame's bar, a
    /// pop-up showing its box, and its restore box last, at the bar's right,
    /// `SC_RESTORE`; the child's own system menu box taken from its style,
    /// and its menu brought up to its state (`USER.EXE` seg20 `00fe`;
    /// `mdisys`). Only a child with a system menu of its own, which every
    /// child the client makes has, and a frame with a bar.
    fn mdi_merge(&mut self, client: u16, child: u16) -> Result<(), Stop> {
        let (Some(frame), Some(index)) = (self.frame_of_client(client), named(self, child)) else {
            return Ok(());
        };
        let bar = self.windows[frame].as_ref().map_or(0, |window| window.menu);
        let (Some(bar), Some(menu)) = (self.menu_of(bar), self.own_system_menu(index)) else {
            return Ok(());
        };

        self.menus[bar].items.insert(
            0,
            MenuItem {
                flags: MF_POPUP | MF_BITMAP,
                id: 0,
                text: None,
                popup: Some(menu),
                bitmaps: None,
                bitmap: Some(MDI_SYSTEM_BITMAP),
            },
        );
        self.menus[bar].items.push(MenuItem {
            flags: MF_HELP | MF_BITMAP,
            id: SC_RESTORE,
            text: None,
            popup: None,
            bitmaps: None,
            bitmap: Some(MDI_RESTORE_BITMAP),
        });
        self.system_menu_brought_up(index)?;

        if let Some(window) = self.windows[index].as_mut() {
            window.style &= !WS_SYSMENU;
        }

        self.redraw_frame_bar(frame)
    }

    /// A child's items taken out of the frame's bar again, if its last is
    /// the restore box, and its system menu box given back (seg20 `0176`).
    fn mdi_unmerge(&mut self, client: u16, child: u16) -> Result<(), Stop> {
        let Some(frame) = self.frame_of_client(client) else {
            return Ok(());
        };
        let bar = self.windows[frame].as_ref().map_or(0, |window| window.menu);
        let Some(bar) = self.menu_of(bar) else {
            return Ok(());
        };
        let last = self.menus[bar].items.last().cloned();

        if !last.is_some_and(|item| item.popup.is_none() && item.id == SC_RESTORE) {
            return Ok(());
        }

        if let Some(window) = named(self, child).and_then(|index| self.windows[index].as_mut()) {
            window.style |= WS_SYSMENU;
        }

        self.menus[bar].items.pop();

        if !self.menus[bar].items.is_empty() {
            self.menus[bar].items.remove(0);
        }

        self.redraw_frame_bar(frame)
    }

    /// The frame's title: its own, and a maximized child's after it as
    /// " - [title]" (seg15 `0000`; `mdisys`: "F - [B]").
    fn mdi_title(&mut self, client: u16) {
        let Some(state) = self.mdi(client).cloned() else {
            return;
        };
        let Some(frame) = self.frame_of_client(client) else {
            return;
        };
        let child = named(self, state.maxed)
            .and_then(|index| self.windows[index].as_ref())
            .map(|window| window.title.clone())
            .filter(|title| !title.is_empty());
        let title = match child {
            Some(child) => format!("{} - [{child}]", state.title),
            None => state.title,
        };

        if let Some(window) = self.windows[frame].as_mut()
            && window.title != title
        {
            window.title = title;
            self.paint_frame(frame);
        }
    }

    /// What an MDI client keeps, by its handle.
    pub(crate) fn mdi(&self, hwnd: u16) -> Option<&Client> {
        named(self, hwnd).and_then(|index| self.windows[index].as_ref()?.mdi.as_ref())
    }

    pub(crate) fn mdi_mut(&mut self, hwnd: u16) -> Option<&mut Client> {
        named(self, hwnd).and_then(|index| self.windows[index].as_mut()?.mdi.as_mut())
    }

    /// The item for a child in a client's Window menu, checked or not: the
    /// Window menu the client keeps, whichever window the child's parent now
    /// is.
    fn check_item(&mut self, client: u16, child: u16, checked: bool) {
        let Some(menu) = self
            .mdi(client)
            .and_then(|state| self.menu_of(state.window_menu))
        else {
            return;
        };
        let Some(index) = named(self, child) else {
            return;
        };
        let id = self.windows[index].as_ref().expect("a window").control_id;

        if let Some(item) = self.menus[menu].items.iter_mut().find(|item| item.id == id) {
            item.flags = if checked {
                item.flags | MF_CHECKED
            } else {
                item.flags & !MF_CHECKED
            };
        }
    }

    /// `DefWindowProc` asked to make a child of a window of the `MDIClient`
    /// class, as a program's own procedure on a client may ask it. The
    /// TypeScript engine's `DefWindowProc` makes one there from the
    /// `MDICREATESTRUCT`, with no identifier and nothing of the client's
    /// bookkeeping; that is not followed, and stops rather than answer
    /// nought.
    pub(crate) fn refuse_mdi_create_default(&self, index: usize, message: u16) -> Result<(), Stop> {
        if message != WM_MDICREATE {
            return Ok(());
        }

        let client = self.windows[index].as_ref().is_some_and(|window| {
            self.class_named(&window.class)
                .is_some_and(|class| self.classes[class].name.eq_ignore_ascii_case(MDI_CLIENT))
        });

        if client {
            return Err(Stop::Unsupported("DefWindowProc making an MDI child"));
        }

        Ok(())
    }

    /// `WM_MDISETMENU` (seg20 `02f9`): the frame's menu and the Window menu
    /// set, the list of children written into the Window menu again after
    /// its last separator. Answers the old menus.
    fn set_mdi_menu(&mut self, hwnd: u16, refresh: bool, frame_menu: u16, window_menu: u16) -> u32 {
        let Some(client) = named(self, hwnd) else {
            return 0;
        };
        let Some(state) = self.windows[client]
            .as_ref()
            .and_then(|window| window.mdi.clone())
        else {
            return 0;
        };
        let frame = self.windows[client]
            .as_ref()
            .and_then(|window| window.parent);
        let old_frame = frame
            .and_then(|frame| self.windows[frame].as_ref())
            .map_or(0, |window| window.menu);
        let old = u32::from(old_frame) | u32::from(state.window_menu) << 16;

        if !refresh
            && frame_menu != 0
            && frame_menu != old_frame
            && let (Some(frame), Some(menu)) = (frame, self.menu_of(frame_menu))
        {
            let labels = self.menus[menu].labels();
            let grayed = self.menus[menu].grayed();
            let window = self.windows[frame].as_mut().expect("a window");

            window.menu = frame_menu;
            window.bar = Some(labels);
            window.bar_grayed = Some(grayed);
        }

        if !refresh && window_menu == state.window_menu {
            return old;
        }

        // The list taken out of the old Window menu, from its last separator.
        if let Some(previous) = self.menu_of(state.window_menu) {
            let items = &mut self.menus[previous].items;

            if let Some(last) = items
                .iter()
                .rposition(|item| item.flags & MF_SEPARATOR != 0)
                && items
                    .get(last + 1)
                    .is_some_and(|item| item.id == state.first)
            {
                items.truncate(last);
            }
        }

        let window_menu = if refresh {
            state.window_menu
        } else {
            window_menu
        };

        if let Some(mdi) = self.windows[client]
            .as_mut()
            .and_then(|window| window.mdi.as_mut())
        {
            mdi.window_menu = window_menu;
        }

        if let Some(menu) = self.menu_of(window_menu) {
            let listed: Vec<(u16, String)> = state
                .children
                .iter()
                .filter_map(|&child| {
                    let window = self.windows[named(self, child)?].as_ref()?;

                    (window.style & WS_DISABLED == 0).then(|| (child, window.title.clone()))
                })
                .take(10)
                .collect();

            for (index, (child, title)) in listed.into_iter().enumerate() {
                if index == 0 {
                    self.menus[menu].items.push(MenuItem {
                        flags: MF_SEPARATOR,
                        id: 0,
                        text: None,
                        popup: None,
                        bitmaps: None,
                        bitmap: None,
                    });
                }

                let title: String = title.replace('&', "&&").chars().take(0x9f).collect();
                let text = if index < 9 {
                    format!("&{} {title}", index + 1)
                } else {
                    MORE_WINDOWS.to_string()
                };

                self.menus[menu].items.push(MenuItem {
                    flags: if child == state.active && index < 9 {
                        MF_CHECKED
                    } else {
                        0
                    },
                    // The identifier as a word: one past 0xffff wraps
                    // round, where the TypeScript engine's number would
                    // match no child at all.
                    id: state.first.wrapping_add(index as u16),
                    text: Some(text),
                    popup: None,
                    bitmaps: None,
                    bitmap: None,
                });
            }
        }

        old
    }
}

/// The calls answered here.
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "DefFrameProc" => Implementation::Async(def_frame_proc),
        "DefMDIChildProc" => Implementation::Async(def_mdi_child_proc),
        "TranslateMDISysAccel" => Implementation::Async(translate_mdi_sys_accel),
        "CalcChildScroll" => Implementation::Async(crate::mdi_scroll::calc_child_scroll),
        "ScrollChildren" => Implementation::Async(crate::mdi_scroll::scroll_children),
        _ => return None,
    })
}

/// A message's `lParam` as a value: nought for a structure.
fn value(lparam: &Param) -> u32 {
    match lparam {
        Param::Value(value) => *value,
        Param::Struct(_) => 0,
    }
}

impl Engine {
    /// A window shown as `ShowWindow` shows it.
    async fn mdi_show(&self, hwnd: u16, show: u16) -> Result<(), Stop> {
        let Some(index) = named(&self.system(), hwnd) else {
            return Ok(());
        };

        self.show_raster(hwnd, index, show, true, false).await?;
        Ok(())
    }

    /// A window moved as `MoveWindow` moves it.
    async fn mdi_move(&self, hwnd: u16, place: [i32; 4]) -> Result<(), Stop> {
        let Some(index) = named(&self.system(), hwnd) else {
            return Ok(());
        };
        let [x, y, cx, cy] = place.map(|value| value as i16);

        self.position_raster(hwnd, index, 0, x, y, cx, cy, MOVED)
            .await
    }

    /// The MDI client's window procedure.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn mdi_client_proc(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        match message {
            WM_CREATE => {
                // The `CLIENTCREATESTRUCT` the `CREATESTRUCT` points at: the
                // Window menu and the first child's identifier (seg15
                // `10ff`). Only the structure USER sends is read, as the
                // TypeScript engine reads it: a pointer handed on by a
                // program's own procedure reads as none.
                let mut guard = self.system();
                let system = &mut *guard;
                let far = match lparam {
                    Param::Struct(bytes) if bytes.len() >= 4 => {
                        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
                    }
                    _ => 0,
                };
                let (window_menu, first) = if far == 0 {
                    (0, 0)
                } else {
                    let bytes = system.read_far(far, 4);

                    (
                        u16::from_le_bytes([bytes[0], bytes[1]]),
                        u16::from_le_bytes([bytes[2], bytes[3]]),
                    )
                };
                let Some(index) = named(system, hwnd) else {
                    return Ok(0);
                };
                // The frame's title kept, and the frame given a system menu
                // of its own (seg15 `1135`-`116e`).
                let frame = system.windows[index].as_ref().and_then(|w| w.parent);
                let title = frame
                    .and_then(|frame| system.windows[frame].as_ref())
                    .map(|window| window.title.clone())
                    .unwrap_or_default();

                if let Some(frame) = frame {
                    system.system_menu_of(frame)?;
                }

                let window = system.windows[index].as_mut().expect("a window");
                let style = window.style;

                window.mdi = Some(Client {
                    window_menu,
                    first,
                    title,
                    scroll: ClientScroll {
                        bars: u8::from(style & WS_VSCROLL != 0)
                            | u8::from(style & WS_HSCROLL != 0) << 1,
                        busy: false,
                        pending: false,
                    },
                    ..Client::default()
                });

                // The scroll bars start hidden, shown only when the children
                // reach past the client's edges (`mdi_scroll.rs`).
                if style & (WS_VSCROLL | WS_HSCROLL) != 0 {
                    window.style &= !(WS_VSCROLL | WS_HSCROLL);

                    let (left, top, width, height) =
                        (window.left, window.top, window.width, window.height);

                    system.place_window(index, left, top, width, height)?;
                }

                Ok(0)
            }
            WM_SETFOCUS => {
                let active = {
                    let system = self.system();

                    system
                        .mdi(hwnd)
                        .map(|client| client.active)
                        .filter(|&active| {
                            named(&system, active).is_some_and(|index| {
                                system.windows[index].as_ref().expect("a window").placement
                                    != Placement::Minimized
                            })
                        })
                };

                if let Some(active) = active {
                    self.set_focus(active).await?;
                }

                Ok(0)
            }
            WM_NCACTIVATE => {
                let active = self.system().mdi(hwnd).map_or(0, |client| client.active);

                if active != 0 {
                    self.send_message(active, WM_NCACTIVATE, wparam, lparam)
                        .await?;
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            WM_SIZE => {
                let maxed = self.system().mdi(hwnd).map(|client| client.maxed);

                match maxed {
                    Some(maxed) if maxed != 0 => self.fit_maximized(hwnd, maxed).await?,
                    _ => self.system().post_recalc(hwnd),
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            // Its bars scrolled: the children moved, with nothing posted for
            // it.
            WM_HSCROLL | WM_VSCROLL => {
                if self.system().mdi(hwnd).is_some() {
                    self.set_busy(hwnd, true);
                    self.scroll_children(hwnd, message, wparam, value(lparam))
                        .await?;
                    self.set_busy(hwnd, false);
                }

                Ok(0)
            }
            WM_MDIRECALC => {
                self.recalc_client(hwnd).await?;
                Ok(0)
            }
            // A press on a child that is not the active one activates it.
            WM_PARENTNOTIFY => {
                if wparam == WM_LBUTTONDOWN {
                    let hit = {
                        let system = self.system();
                        let lparam = value(lparam);
                        let (x, y) = (
                            i32::from(lparam as u16 as i16),
                            i32::from((lparam >> 16) as u16 as i16),
                        );

                        named(&system, hwnd).and_then(|index| {
                            let client = system.windows[index].as_ref().expect("a window");
                            let state = client.mdi.as_ref()?;
                            let (x, y) = (
                                client.left + client.client.left + x,
                                client.top + client.client.top + y,
                            );
                            let hit = state.children.iter().copied().find(|&child| {
                                named(&system, child)
                                    .and_then(|index| system.windows[index].as_ref())
                                    .is_some_and(|w| {
                                        w.visible
                                            && x >= w.left
                                            && x < w.left + w.width
                                            && y >= w.top
                                            && y < w.top + w.height
                                    })
                            })?;

                            (hit != state.active).then_some(hit)
                        })
                    };

                    if let Some(hit) = hit {
                        self.mdi_activate(hwnd, hit).await?;
                    }
                }

                Ok(0)
            }
            WM_MDICREATE => Ok(u32::from(self.mdi_create(hwnd, value(lparam)).await?)),
            WM_MDIDESTROY => {
                self.mdi_destroy(hwnd, wparam).await?;
                self.system().post_recalc(hwnd);
                Ok(0)
            }
            WM_MDIACTIVATE => {
                let active = self.system().mdi(hwnd).map(|client| client.active);

                if wparam != 0 && Some(wparam) != active {
                    self.mdi_activate(hwnd, wparam).await?;
                }

                Ok(0)
            }
            WM_MDIRESTORE => {
                self.mdi_show(wparam, SW_SHOWNORMAL).await?;
                Ok(0)
            }
            WM_MDIMAXIMIZE => {
                self.mdi_show(wparam, SW_SHOWMAXIMIZED).await?;
                Ok(0)
            }
            WM_MDINEXT => {
                self.mdi_next(hwnd, wparam, value(lparam) != 0).await?;
                Ok(0)
            }
            WM_MDITILE | WM_MDICASCADE => {
                self.set_busy(hwnd, true);

                let answer = if message == WM_MDITILE {
                    self.mdi_tile(hwnd, wparam).await
                } else {
                    self.mdi_cascade(hwnd).await
                };

                self.set_busy(hwnd, false);
                answer
            }
            WM_MDIICONARRANGE => {
                self.system().post_recalc(hwnd);
                Ok(0)
            }
            WM_MDIGETACTIVE => {
                let system = self.system();

                Ok(system.mdi(hwnd).map_or(0, |client| {
                    u32::from(client.active) | u32::from(client.maxed != 0) << 16
                }))
            }
            WM_MDISETMENU => {
                let lparam = value(lparam);

                Ok(self.system().set_mdi_menu(
                    hwnd,
                    wparam != 0,
                    lparam as u16,
                    (lparam >> 16) as u16,
                ))
            }
            _ => self.def_window_proc(hwnd, message, wparam, lparam).await,
        }
    }

    /// The client scrolling or arranging, or done.
    fn set_busy(&self, hwnd: u16, busy: bool) {
        if let Some(client) = self.system().mdi_mut(hwnd) {
            client.scroll.busy = busy;
        }
    }

    /// `WM_MDICREATE` (seg15 `0ddb`): the child made and activated; its
    /// window, or nought.
    ///
    /// Its class and title are handed to `CreateWindow` as text, as the
    /// TypeScript engine hands them: the `CREATESTRUCT` the child is sent
    /// carries no pointer to its class, and its title copied into a block of
    /// USER's own.
    #[allow(clippy::too_many_lines)]
    async fn mdi_create(&self, hwnd: u16, far: u32) -> Result<u16, Stop> {
        let (made, maxed) = {
            let system = self.system();
            let Some(client) = named(&system, hwnd) else {
                return Ok(0);
            };
            let Some(state) = system.windows[client].as_ref().and_then(|w| w.mdi.as_ref()) else {
                return Ok(0);
            };

            if far == 0 {
                return Ok(0);
            }

            let bytes = system.read_far(far, 22);
            let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
            let dword = |at: usize| u32::from(word(at)) | u32::from(word(at + 2)) << 16;
            let class_far = dword(0);
            let class = if class_far >> 16 == 0 {
                class_far.to_string()
            } else {
                text_of(&system.read_string(class_far))
            };
            let title_far = dword(4);
            let title = if title_far == 0 {
                String::new()
            } else {
                text_of(&system.read_string(title_far))
            };

            // The styles a document window always has, whatever it asked
            // for, but for those it keeps (seg15 `0ddb`).
            let style = dword(18) | WS_CHILD | WS_CLIPSIBLINGS;
            let high = (style >> 16) & 0x2b30 | 0x54cf;
            let style = high << 16 | style & 0xffff;

            // The next step of the cascade, for what it did not say (seg15
            // `0d72`, `0746`), as `CascadeChildWindows` steps.
            let place = system.cascade_rect(client, state.cascade);
            let (mut x, mut y, mut cx, mut cy) = (
                i32::from(word(10) as i16),
                i32::from(word(12) as i16),
                i32::from(word(14) as i16),
                i32::from(word(16) as i16),
            );

            if cx & 0xffff == 0x8000 || cx == 0 {
                cx = place[2];
            }

            if cy & 0xffff == 0x8000 || cy == 0 {
                cy = place[3];
            }

            if x & 0xffff == 0x8000 {
                x = place[0];
                y = place[1];
            }

            (
                Creation {
                    ex_style: 0,
                    class,
                    class_far: 0,
                    name: WindowName::Own(title),
                    style,
                    x: x as i16,
                    y: y as i16,
                    width: cx as i16,
                    height: cy as i16,
                    parent: hwnd,
                    menu: state.first.wrapping_add(state.children.len() as u16),
                    instance: word(8),
                    param: far,
                },
                state.maxed,
            )
        };
        let style = made.style;

        // A maximized child gives way to the new one.
        if maxed != 0 && named(&self.system(), maxed).is_some() {
            self.mdi_show(maxed, SW_SHOWNORMAL).await?;
        }

        let child = self
            .create_window(Creation {
                style: style & !WS_VISIBLE,
                ..made
            })
            .await?;

        if child == 0 {
            return Ok(0);
        }

        // A system menu of its own, a document window's (seg15 `0e48`).
        {
            let mut system = self.system();

            if let Some(index) = named(&system, child)
                && style & WS_SYSMENU != 0
            {
                system.give_system_menu(index, SystemMenuKind::Document);
            }
        }

        let (count, active) = {
            let mut system = self.system();
            let Some(state) = system.mdi_mut(hwnd) else {
                return Ok(child);
            };

            state.children.push(child);
            state.cascade = if state.cascade >= 0x7ffe {
                0
            } else {
                state.cascade + 1
            };
            (state.children.len(), state.active)
        };

        if style & WS_VISIBLE != 0 && style & WS_DISABLED == 0 && count <= 10 {
            self.system().set_mdi_menu(hwnd, true, 0, 0);
        }

        if style & WS_VISIBLE != 0 {
            if style & WS_MINIMIZE != 0 && active != 0 {
                self.mdi_show(child, SW_SHOWMINNOACTIVE).await?;
            } else {
                let show = if style & WS_MAXIMIZE != 0 {
                    SW_SHOWMAXIMIZED
                } else if style & WS_MINIMIZE != 0 {
                    SW_SHOWMINIMIZED
                } else {
                    SW_SHOWNORMAL
                };

                self.mdi_show(child, show).await?;
                self.mdi_activate(hwnd, child).await?;
            }
        }

        Ok(child)
    }

    /// `WM_MDIDESTROY` (seg15 `0fd7`).
    async fn mdi_destroy(&self, hwnd: u16, child: u16) -> Result<(), Stop> {
        let active = {
            let mut guard = self.system();
            let system = &mut *guard;
            let Some(state) = system.mdi_mut(hwnd) else {
                return Ok(());
            };
            let Some(at) = state.children.iter().position(|&each| each == child) else {
                return Ok(());
            };

            // The identifiers after it close up, and it takes the last.
            state.children.remove(at);

            let (children, first, active) = (state.children.clone(), state.first, state.active);

            for (index, each) in children.into_iter().enumerate() {
                if let Some(window) = named(system, each).and_then(|at| system.windows[at].as_mut())
                {
                    window.control_id = first.wrapping_add(index as u16);
                }
            }

            active
        };

        if active == child {
            self.mdi_next(hwnd, child, false).await?;

            let still = self
                .system()
                .mdi(hwnd)
                .is_some_and(|state| state.active == child);

            if still {
                self.mdi_show(child, SW_HIDE).await?;

                if let Some(state) = self.system().mdi_mut(hwnd) {
                    state.active = 0;
                }
            }
        }

        {
            let mut system = self.system();

            if let Some(state) = system.mdi_mut(hwnd)
                && state.maxed == child
            {
                state.maxed = 0;
                system.mdi_unmerge(hwnd, child)?;
                system.mdi_title(hwnd);
            }

            system.set_mdi_menu(hwnd, true, 0, 0);
        }

        self.destroy_window(child).await?;
        Ok(())
    }

    /// A child made the active one (seg15 `0b01`): the one before told it
    /// is not, this one brought to the top of its siblings, its caption
    /// drawn active while the frame is, the focus handed to it, and it
    /// told.
    pub(crate) async fn mdi_activate(&self, hwnd: u16, child: u16) -> Result<(), Stop> {
        let (old, frame_active, target) = {
            let system = self.system();
            let Some(client) = named(&system, hwnd) else {
                return Ok(());
            };
            let window = system.windows[client].as_ref().expect("a window");
            let Some(state) = window.mdi.as_ref() else {
                return Ok(());
            };

            if child == state.active {
                return Ok(());
            }

            let target = named(&system, child);

            if target.is_some_and(|target| {
                system.windows[target].as_ref().expect("a window").style & WS_DISABLED != 0
            }) {
                return Ok(());
            }

            let frame_active = window
                .parent
                .and_then(|frame| system.windows[frame].as_ref())
                .is_some_and(|frame| frame.active);

            (state.active, frame_active, target)
        };
        let told = u32::from(child) | u32::from(old) << 16;

        if old != 0 {
            {
                let mut system = self.system();

                if let Some(was) = named(&system, old) {
                    system.windows[was].as_mut().expect("a window").active = false;
                    system.paint_frame(was);
                }
            }

            self.send_message(old, WM_MDIACTIVATE, 0, &mut Param::Value(told))
                .await?;
            self.system().check_item(hwnd, old, false);
        }

        // The maximized child as it is now: the one before, told, may have
        // been restored or another maximized.
        let maxed = self.system().mdi(hwnd).map_or(0, |state| state.maxed);

        if maxed != 0 && maxed != child && child != 0 {
            if let Some(state) = self.system().mdi_mut(hwnd) {
                state.active = child;
            }

            self.mdi_show(child, SW_SHOWMAXIMIZED).await?;
        }

        if let Some(state) = self.system().mdi_mut(hwnd) {
            state.active = child;
        }

        let Some(target) = target else {
            if frame_active {
                self.set_focus(hwnd).await?;
            }

            return Ok(());
        };

        {
            let mut system = self.system();

            system.check_item(hwnd, child, true);

            if system.windows[target].is_some() {
                system.show_on_top(target);
            }
        }

        if frame_active {
            {
                let mut system = self.system();

                if let Some(window) = system.windows[target].as_mut() {
                    window.active = true;
                    system.paint_frame(target);
                }
            }

            // The focus to the client, which hands it on; where the client
            // has it already, as when the child before was an icon, it is
            // not told again, and the child is given it (`mdisys`: B
            // focused once made active after an icon).
            let client_focused = {
                let system = self.system();

                named(&system, hwnd).is_some_and(|client| system.focus == Some(client))
            };

            if client_focused {
                self.set_focus(child).await?;
            } else {
                self.set_focus(hwnd).await?;
            }
        }

        self.send_message(child, WM_MDIACTIVATE, 1, &mut Param::Value(told))
            .await?;
        Ok(())
    }

    /// `WM_MDINEXT` (seg15 `0c7f`): the next child, or the one before, that
    /// is enabled and shows.
    async fn mdi_next(&self, hwnd: u16, from: u16, back: bool) -> Result<(), Stop> {
        let found = {
            let system = self.system();
            let Some(state) = system.mdi(hwnd) else {
                return Ok(());
            };

            if state.children.is_empty() {
                return Ok(());
            }

            let start = if from != 0 { from } else { state.active };
            let order = &state.children;
            let count = order.len() as i64;
            let mut at = order
                .iter()
                .position(|&child| child == start)
                .map_or(-1, |at| at as i64);
            let mut found = None;

            for _ in 0..count {
                at = (at + if back { -1 } else { 1 } + count).rem_euclid(count);

                let candidate = order[at as usize];
                let shows = named(&system, candidate)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| window.visible && window.style & WS_DISABLED == 0);

                if shows && candidate != start {
                    found = Some(candidate);
                    break;
                }
            }

            found
        };

        if let Some(next) = found {
            self.mdi_activate(hwnd, next).await?;
        }

        Ok(())
    }

    /// The children that tiling and cascading move (seg15 `06de`): those
    /// shown, neither minimized nor maximized, in the order they were made.
    fn mdi_arrangeable(&self, hwnd: u16, skip_disabled: bool) -> Vec<u16> {
        let system = self.system();

        system.mdi(hwnd).map_or_else(Vec::new, |state| {
            state
                .children
                .iter()
                .copied()
                .filter(|&child| {
                    named(&system, child)
                        .and_then(|index| system.windows[index].as_ref())
                        .is_some_and(|window| {
                            window.visible
                                && window.placement == Placement::Normal
                                && !(skip_disabled && window.style & WS_DISABLED != 0)
                        })
                })
                .collect()
        })
    }

    /// Both of the client's bars hidden, and a maximized child restored,
    /// before an arrangement. Nothing is posted while it arranges (the client
    /// is busy): the bars stay hidden until something else asks.
    async fn mdi_before_arranging(&self, hwnd: u16) -> Result<Option<usize>, Stop> {
        let (client, style) = {
            let system = self.system();
            let Some(client) = named(&system, hwnd) else {
                return Ok(None);
            };
            let window = system.windows[client].as_ref().expect("a window");

            if window.mdi.is_none() {
                return Ok(None);
            }

            (client, window.style)
        };

        self.change_frame(hwnd, style & !(WS_VSCROLL | WS_HSCROLL))
            .await?;

        // The maximized child as the frame's change left it: the messages it
        // sends may have restored one or maximized another.
        let maxed = self.system().mdi(hwnd).map_or(0, |state| state.maxed);

        if maxed != 0 {
            self.mdi_show(maxed, SW_SHOWNORMAL).await?;
        }

        Ok(Some(client))
    }

    /// `WM_MDICASCADE` (seg15 `0875`): the bottom child first, each a step
    /// down and in, as `CascadeChildWindows` steps them.
    async fn mdi_cascade(&self, hwnd: u16) -> Result<u32, Stop> {
        let Some(client) = self.mdi_before_arranging(hwnd).await? else {
            return Ok(0);
        };
        let mut children = self.mdi_arrangeable(hwnd, false);

        children.reverse();
        crate::user_calls::arrange::cascade_all(self, client, children).await?;
        Ok(1)
    }

    /// `WM_MDITILE` (seg15 `0956`): rows and columns, the last columns a row
    /// longer, as `TileChildWindows` tiles them; children disabled left
    /// where they are with `MDITILE_SKIPDISABLED`.
    async fn mdi_tile(&self, hwnd: u16, how: u16) -> Result<u32, Stop> {
        let Some(client) = self.mdi_before_arranging(hwnd).await? else {
            return Ok(0);
        };
        let children = self.mdi_arrangeable(hwnd, how & 2 != 0);

        if children.is_empty() {
            return Ok(1);
        }

        let (width, height) = {
            let system = self.system();
            let window = system.windows[client].as_ref().expect("a window");

            (window.client_width(), window.client_height())
        };

        if width <= 0 || height <= 0 {
            return Ok(0);
        }

        let moves = crate::user_calls::arrange::tiles(children.len() as i32, how, width, height)
            .into_iter()
            .zip(children)
            .map(|(place, child)| (child, place))
            .collect();

        crate::user_calls::arrange::move_each(self, moves).await?;
        Ok(1)
    }

    /// A child maximized to the client's area, its frame and caption just
    /// outside it.
    async fn fit_maximized(&self, hwnd: u16, child: u16) -> Result<(), Stop> {
        let place = {
            let system = self.system();
            let (Some(client), Some(target)) = (named(&system, hwnd), named(&system, child)) else {
                return Ok(());
            };
            let style = system.windows[target].as_ref().expect("a window").style;
            let [left, top, right, bottom] =
                system.frame_insets(style & !(WS_VSCROLL | WS_HSCROLL), false, false)?;
            let client = system.windows[client].as_ref().expect("a window");

            [
                -left,
                -top,
                client.client_width() + left + right,
                client.client_height() + top + bottom,
            ]
        };

        self.mdi_move(child, place).await
    }

    /// `DefFrameProc` (seg15 `147c`): the client kept to the frame's client
    /// area, the focus handed to it, and the Window menu's commands, and a
    /// maximized child's system commands, handed on.
    #[allow(clippy::too_many_lines)]
    async fn def_frame(
        &self,
        hwnd: u16,
        client: u16,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let Some(state) = self.system().mdi(client).cloned() else {
            return self
                .def_window_proc(hwnd, message, wparam, &mut Param::Value(lparam))
                .await;
        };

        match message {
            WM_SIZE if wparam != SIZE_MINIMIZED => {
                self.mdi_move(
                    client,
                    [
                        0,
                        0,
                        i32::from(lparam as u16),
                        i32::from((lparam >> 16) as u16),
                    ],
                )
                .await?;
            }
            WM_SETFOCUS => {
                self.set_focus(client).await?;
                return Ok(0);
            }
            WM_NCACTIVATE => {
                self.send_message(client, WM_NCACTIVATE, wparam, &mut Param::Value(lparam))
                    .await?;
            }
            // The frame's own title kept, a maximized child's put after it
            // (seg15 `154d`).
            WM_SETTEXT => {
                let answer = self
                    .def_window_proc(hwnd, message, wparam, &mut Param::Value(lparam))
                    .await?;
                let mut system = self.system();
                let title = named(&system, hwnd)
                    .and_then(|index| system.windows[index].as_ref())
                    .map(|window| window.title.clone())
                    .unwrap_or_default();

                if let Some(state) = system.mdi_mut(client) {
                    state.title = title;
                }

                system.mdi_title(client);
                return Ok(answer);
            }
            // The hyphen, which no item of the frame's bar has: a maximized
            // child's system menu, the bar's first item, carried out; else
            // the active child's, `SC_KEYMENU` posted to it and the frame's
            // menu closed (seg15 `1642`-`167f`; `mdisys`).
            WM_MENUCHAR if wparam == 0x2d => {
                let minimized = {
                    let system = self.system();

                    named(&system, hwnd)
                        .and_then(|index| system.windows[index].as_ref())
                        .is_some_and(|window| window.placement == Placement::Minimized)
                };

                if !minimized {
                    if state.maxed != 0 {
                        return Ok(0x0002_0000);
                    }

                    if state.active != 0 {
                        self.system()
                            .post_message(state.active, WM_SYSCOMMAND, SC_KEYMENU, 0x2d);
                        return Ok(0x0001_0000);
                    }
                }
            }
            WM_COMMAND => {
                let id = wparam;
                let count = state.children.len() as u32;
                let first = u32::from(state.first);

                if u32::from(id) >= first
                    && u32::from(id) < first + count
                    && u32::from(id) < first + 9
                {
                    let child = state.children[usize::from(id - state.first)];

                    self.send_message(client, WM_MDIACTIVATE, child, &mut Param::Value(0))
                        .await?;

                    let minimized = {
                        let system = self.system();

                        named(&system, child)
                            .and_then(|index| system.windows[index].as_ref())
                            .is_some_and(|window| window.placement == Placement::Minimized)
                    };

                    if minimized {
                        self.mdi_show(child, SW_SHOWNORMAL).await?;
                    }

                    return Ok(0);
                }

                let system_commands = [
                    SC_SIZE,
                    SC_MOVE,
                    SC_MINIMIZE,
                    SC_MAXIMIZE,
                    SC_NEXTWINDOW,
                    SC_PREVWINDOW,
                    SC_CLOSE,
                    SC_RESTORE,
                ];

                if state.maxed != 0 && system_commands.contains(&(id & 0xfff0)) {
                    return self
                        .send_message(state.maxed, WM_SYSCOMMAND, id, &mut Param::Value(lparam))
                        .await;
                }
            }
            _ => {}
        }

        self.def_window_proc(hwnd, message, wparam, &mut Param::Value(lparam))
            .await
    }

    /// `DefMDIChildProc` (seg15 `187a`): closing through the client,
    /// activating as it is focused, the client's area as its maximized
    /// size, and the maximized child kept track of.
    #[allow(clippy::too_many_lines)]
    async fn def_mdi_child(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let found = {
            let system = self.system();

            named(&system, hwnd)
                .and_then(|index| system.windows[index].as_ref()?.parent)
                .and_then(|client| {
                    let window = system.windows[client].as_ref()?;

                    Some((window.hwnd, client, window.parent, window.mdi.clone()?))
                })
        };
        let Some((client, client_index, frame, state)) = found else {
            return self.def_window_proc(hwnd, message, wparam, lparam).await;
        };
        let frame_hwnd = {
            let system = self.system();

            frame
                .and_then(|frame| system.windows[frame].as_ref())
                .map_or(0, |frame| frame.hwnd)
        };

        match message {
            WM_CLOSE => {
                self.send_message(client, WM_MDIDESTROY, hwnd, &mut Param::Value(0))
                    .await?;
                Ok(0)
            }
            WM_SETTEXT => {
                let answer = self.def_window_proc(hwnd, message, wparam, lparam).await?;
                let mut system = self.system();

                system.set_mdi_menu(client, true, 0, 0);

                if state.maxed == hwnd {
                    system.mdi_title(client);
                }

                Ok(answer)
            }
            // Moved, the client's bars worked out again, unless it is
            // maximized.
            WM_MOVE => {
                if state.maxed != hwnd {
                    self.system().post_recalc(client);
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            // Sized, likewise, except maximized again.
            WM_SIZE => {
                // Its system menu brought up to its state at every size
                // (seg15 `1781`).
                {
                    let mut system = self.system();

                    if let Some(index) = named(&system, hwnd) {
                        system.system_menu_brought_up(index)?;
                    }
                }

                if !(state.maxed == hwnd && wparam == SIZE_MAXIMIZED) {
                    self.system().post_recalc(client);
                }

                // No longer maximized: its items out of the frame's bar, the
                // frame's title its own again (seg15 `1787`-`17b0`).
                if state.maxed == hwnd && wparam != SIZE_MAXIMIZED {
                    let mut system = self.system();

                    if let Some(state) = system.mdi_mut(client) {
                        state.maxed = 0;
                    }

                    system.mdi_unmerge(client, hwnd)?;
                    system.mdi_title(client);
                }

                // Maximized: the one maximized before gives up its items and
                // is restored, and this one's go in the frame's bar, its
                // title after the frame's (`17b3`-`1821`).
                if wparam == SIZE_MAXIMIZED && state.maxed != hwnd {
                    let old = state.maxed;

                    {
                        let mut system = self.system();

                        if old != 0 {
                            system.mdi_unmerge(client, old)?;
                        }

                        if let Some(state) = system.mdi_mut(client) {
                            state.maxed = hwnd;
                        }

                        system.mdi_merge(client, hwnd)?;
                        system.mdi_title(client);
                    }

                    if old != 0 {
                        self.mdi_show(old, SW_SHOWNORMAL).await?;
                    }
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            WM_SETFOCUS => {
                if state.active != hwnd {
                    self.mdi_activate(client, hwnd).await?;
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            WM_CHILDACTIVATE => {
                self.mdi_activate(client, hwnd).await?;
                Ok(0)
            }
            // Maximized to the client's area, frame and caption outside it
            // (seg15 `16ef`). Only a structure USER sends is written, as the
            // TypeScript engine writes it: a program's pointer is left alone.
            WM_GETMINMAXINFO => {
                if let Param::Struct(bytes) = lparam
                    && bytes.len() >= 12
                {
                    let system = self.system();
                    let index = named(&system, hwnd).expect("the window");
                    let style = system.windows[index].as_ref().expect("a window").style;
                    let [left, top, right, bottom] =
                        system.frame_insets(style & !(WS_VSCROLL | WS_HSCROLL), false, false)?;
                    let shown = system.windows[client_index].as_ref().expect("a window");
                    let words = [
                        (4, shown.client_width() + left + right),
                        (6, shown.client_height() + top + bottom),
                        (8, -left),
                        (10, -top),
                    ];

                    for (at, word) in words {
                        bytes[at..at + 2].copy_from_slice(&(word as i16).to_le_bytes());
                    }
                }

                Ok(0)
            }
            WM_SYSCOMMAND => {
                let command = wparam & 0xfff0;
                let maximized = state.maxed == hwnd;

                if (command == SC_SIZE || command == SC_MOVE) && maximized {
                    return Ok(0);
                }

                if command == SC_MAXIMIZE && maximized {
                    return if frame_hwnd == 0 {
                        Ok(0)
                    } else {
                        self.send_message(frame_hwnd, WM_SYSCOMMAND, wparam, lparam)
                            .await
                    };
                }

                if command == SC_NEXTWINDOW || command == SC_PREVWINDOW {
                    self.send_message(
                        client,
                        WM_MDINEXT,
                        hwnd,
                        &mut Param::Value(u32::from(command == SC_PREVWINDOW)),
                    )
                    .await?;
                    return Ok(0);
                }

                self.def_window_proc(hwnd, message, wparam, lparam).await
            }
            WM_MENUCHAR => {
                if frame_hwnd != 0 {
                    self.system().post_message(
                        frame_hwnd,
                        WM_SYSCOMMAND,
                        SC_KEYMENU,
                        u32::from(wparam),
                    );
                }

                Ok(0x10000)
            }
            _ => self.def_window_proc(hwnd, message, wparam, lparam).await,
        }
    }
}

/// `DefFrameProc` called by a program: the frame, its MDI client, and the
/// message.
fn def_frame_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, client, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            engine
                .def_frame(hwnd, client, message, wparam, lparam)
                .await?,
        ))
    })
}

/// `DefMDIChildProc` called by a program.
fn def_mdi_child_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            engine
                .def_mdi_child(hwnd, message, wparam, &mut Param::Value(lparam))
                .await?,
        ))
    })
}

/// `TranslateMDISysAccel` (seg15 `01d1`): Ctrl+F4 closes the active child,
/// Ctrl+F6 or Ctrl+Tab goes to the next, with Shift the one before; not
/// with Alt, and not for a child disabled. Whether the key was taken.
fn translate_mdi_sys_accel(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let found = {
            let system = engine.system();
            let client = args.word(&system);
            let far = args.dword(&system);
            let active = system.mdi(client).map_or(0, |state| state.active);

            if active == 0 || far == 0 {
                return Ok(Answer::Word(0));
            }

            let bytes = system.read_far(far, 6);
            let message = u16::from_le_bytes([bytes[2], bytes[3]]);
            let key = u16::from_le_bytes([bytes[4], bytes[5]]);

            if message != WM_KEYDOWN && message != WM_SYSKEYDOWN {
                return Ok(Answer::Word(0));
            }

            let keys = &system.user_state.key_states;
            let down = |key: usize| keys[key] & 0x80 != 0;
            let disabled = named(&system, active)
                .and_then(|index| system.windows[index].as_ref())
                .is_some_and(|window| window.style & WS_DISABLED != 0);

            if !down(VK_CONTROL) || down(VK_MENU) || disabled {
                return Ok(Answer::Word(0));
            }

            let command = match key {
                VK_F4 => SC_CLOSE,
                VK_F6 | VK_TAB if down(VK_SHIFT) => SC_PREVWINDOW,
                VK_F6 | VK_TAB => SC_NEXTWINDOW,
                _ => return Ok(Answer::Word(0)),
            };

            (active, command, key)
        };
        let (active, command, key) = found;

        engine
            .send_message(
                active,
                WM_SYSCOMMAND,
                command,
                &mut Param::Value(u32::from(key)),
            )
            .await?;
        Ok(Answer::Word(1))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handles::{Kind, Object};
    use crate::windows::Window;

    /// A window added to the system, a child of `parent` if given: its
    /// index and handle.
    fn add(system: &mut System, parent: Option<usize>, title: &str) -> (usize, u16) {
        let index = system.windows.len();

        system.windows.push(Some(Window {
            parent,
            title: title.to_string(),
            visible: true,
            ..Window::default()
        }));

        let hwnd = system
            .handles
            .allocate(Kind::Window, Object::Window(index))
            .unwrap();

        system.windows[index].as_mut().unwrap().hwnd = hwnd;
        system.z_order.push(index);
        (index, hwnd)
    }

    /// A client with a Window menu holding one item of the program's, and
    /// children made through it with their identifiers from `first`.
    fn client_with(first: u16, titles: &[&str]) -> (System, u16, usize, Vec<u16>) {
        let mut system = System::new();
        let (client, hwnd) = add(&mut system, None, "");
        let menu = system.new_menu();
        let handle = system.menu_handle(menu);

        system.menus[menu].items.push(MenuItem {
            flags: 0,
            id: 100,
            text: Some("&Tile".to_string()),
            popup: None,
            bitmaps: None,
            bitmap: None,
        });

        let children: Vec<u16> = titles
            .iter()
            .enumerate()
            .map(|(at, title)| {
                let (index, child) = add(&mut system, Some(client), title);

                system.windows[index].as_mut().unwrap().control_id = first.wrapping_add(at as u16);
                child
            })
            .collect();

        system.windows[client].as_mut().unwrap().mdi = Some(Client {
            children: children.clone(),
            active: children[0],
            window_menu: handle,
            first,
            ..Client::default()
        });
        (system, hwnd, menu, children)
    }

    #[test]
    fn lists_the_children_after_a_separator_the_active_one_checked() {
        let (mut system, hwnd, menu, children) = client_with(0x100, &["One & Two", "Three"]);

        system.set_mdi_menu(hwnd, true, 0, 0);

        let items = &system.menus[menu].items;
        let texts: Vec<Option<&str>> = items.iter().map(|item| item.text.as_deref()).collect();

        assert_eq!(
            texts,
            [Some("&Tile"), None, Some("&1 One && Two"), Some("&2 Three")]
        );
        assert_eq!(items[1].flags, MF_SEPARATOR);
        assert_eq!((items[2].id, items[2].flags), (0x100, MF_CHECKED));
        assert_eq!((items[3].id, items[3].flags), (0x101, 0));

        // Listed again, the old list is taken out first.
        system.set_mdi_menu(hwnd, true, 0, 0);
        assert_eq!(system.menus[menu].items.len(), 4);

        // Checked as the client's Window menu keeps it.
        system.check_item(hwnd, children[0], false);
        system.check_item(hwnd, children[1], true);
        assert_eq!(system.menus[menu].items[2].flags, 0);
        assert_eq!(system.menus[menu].items[3].flags, MF_CHECKED);
    }

    #[test]
    fn identifiers_past_the_last_word_wrap_round() {
        let (mut system, hwnd, menu, _) = client_with(0xfffe, &["a", "b", "c"]);

        system.set_mdi_menu(hwnd, true, 0, 0);

        let ids: Vec<u16> = system.menus[menu].items[2..]
            .iter()
            .map(|item| item.id)
            .collect();

        assert_eq!(ids, [0xfffe, 0xffff, 0]);
    }

    #[test]
    fn checks_in_the_window_menu_of_the_client_it_is_told() {
        let (mut system, hwnd, menu, children) = client_with(0x100, &["a", "b"]);

        system.set_mdi_menu(hwnd, true, 0, 0);

        // The child taken to another parent is still checked in this
        // client's Window menu, as the client's own bookkeeping names it.
        let (other, _) = add(&mut system, None, "");
        let child = system.window_named(children[1]).unwrap();

        system.windows[child].as_mut().unwrap().parent = Some(other);
        system.check_item(hwnd, children[1], true);
        assert_eq!(system.menus[menu].items[3].flags, MF_CHECKED);
    }

    #[test]
    fn def_window_proc_makes_no_mdi_child() {
        let mut system = System::new();

        system.mdi_client_class();

        let (client, _) = add(&mut system, None, "");
        let (plain, _) = add(&mut system, None, "");

        system.windows[client].as_mut().unwrap().class = "mdiclient".to_string();
        system.windows[plain].as_mut().unwrap().class = "Plain".to_string();

        assert_eq!(
            system.refuse_mdi_create_default(client, WM_MDICREATE),
            Err(Stop::Unsupported("DefWindowProc making an MDI child"))
        );
        assert_eq!(
            system.refuse_mdi_create_default(client, WM_MDIACTIVATE),
            Ok(())
        );
        assert_eq!(
            system.refuse_mdi_create_default(plain, WM_MDICREATE),
            Ok(())
        );
    }
}
