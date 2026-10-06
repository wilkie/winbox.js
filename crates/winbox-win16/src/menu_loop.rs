//! A menu, open, as winbox.js's `menu-loop.ts` runs it: what
//! `DefWindowProc` does when a window's menu bar or system menu box is
//! pressed, or `WM_SYSCOMMAND` asks for its menu from the keyboard, and
//! what `TrackPopupMenu` does.
//!
//! As in Windows, a menu is modal. The loop takes the program's messages
//! itself until the menu closes: the mouse and the keys drive the menu, and
//! everything else -- timers, paints -- is sent to its window as the
//! program's own loop would. When an item is chosen, its command is sent
//! once the menu is closed: `WM_COMMAND`, or `WM_SYSCOMMAND` from the
//! system menu.
//!
//! How the menu is drawn open is measured (see `menu_popup.rs`); how it is
//! driven from the keyboard, as far as `WM_MENUSELECT` and Escape, is
//! `altchild`'s; from the mouse, not yet. Where a submenu opens, and how a
//! menu that would leave the screen is moved, are the TypeScript engine's.

use std::collections::HashMap;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::menu_popup::{MF_DISABLED, MF_GRAYED, MF_SEPARATOR};
use crate::menus::MenuItem;
use crate::messages::Param;
use crate::queue::{Message, WM_KEYDOWN, WM_KEYUP, WM_MOUSEMOVE, WM_SYSKEYDOWN, WM_SYSKEYUP};
use crate::raster_input::HTCAPTION;
use crate::user_calls::system_menu::SC_RESTORE;
use crate::windows::Placement;

const WM_SETCURSOR: u16 = 0x0020;
const WM_COMMAND: u16 = 0x0111;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_INITMENU: u16 = 0x0116;
const WM_INITMENUPOPUP: u16 = 0x0117;
const WM_MENUSELECT: u16 = 0x011f;
const WM_ENTERIDLE: u16 = 0x0121;

const MF_POPUP: u16 = 0x0010;
const MF_HILITE: u16 = 0x0080;
const MF_SYSMENU: u16 = 0x2000;
const WM_CHAR: u16 = 0x0102;
const WM_SYSCHAR: u16 = 0x0106;
const WM_NCMOUSEMOVE: u16 = 0x00a0;
const WM_NCLBUTTONDOWN: u16 = 0x00a1;
const WM_NCLBUTTONUP: u16 = 0x00a2;
const WM_NCLBUTTONDBLCLK: u16 = 0x00a3;
const WM_NCRBUTTONDOWN: u16 = 0x00a4;
const WM_NCRBUTTONUP: u16 = 0x00a5;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const WM_RBUTTONDOWN: u16 = 0x0204;
const WM_RBUTTONUP: u16 = 0x0205;

/// What a message filter is told a message came from: a menu's loop.
pub const MSGF_MENU: i16 = 2;

const VK_RETURN: u16 = 0x0d;
const VK_MENU: u16 = 0x12;
const VK_ESCAPE: u16 = 0x1b;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;
const VK_F10: u16 = 0x79;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "TrackPopupMenu" => Implementation::Async(track_popup_menu),
        _ => return None,
    })
}

/// What USER keeps while a menu is open, and of the keys that open one.
#[derive(Debug, Clone, Default)]
pub struct MenuLoopState {
    /// The window whose menu is open, while one is.
    pub owner: Option<usize>,
    /// Set by `WM_CANCELMODE` to the menu's window: the open menu ends.
    pub cancelled: bool,
    /// Alt pressed with nothing after it, as `DefWindowProc` keeps it
    /// (`USER.EXE` `1d0`; `menu_default.rs`).
    pub alt_alone: bool,
    /// F10 pressed (`USER.EXE` `352`; `menu_default.rs`).
    pub f10: bool,
    /// Each window's system menu's holder, by the window's index: the menu
    /// `WM_INITMENU` names as the system menu opens.
    holders: HashMap<usize, usize>,
}

/// Where a menu starts: an item of the bar, the system menu, or a pop-up at
/// a place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuStart {
    Bar {
        index: usize,
        keyboard: bool,
        open: bool,
    },
    System {
        keyboard: bool,
    },
    Popup {
        menu: usize,
        x: i32,
        y: i32,
    },
}

/// A pop-up open: its menu, and its window.
#[derive(Debug, Clone, Copy)]
struct Level {
    menu: usize,
    window: usize,
}

/// A menu running.
struct Run<'a> {
    engine: &'a Engine,
    hwnd: u16,
    window: usize,
    start: MenuStart,
    bar_menu: Option<usize>,
    levels: Vec<Level>,
    bar: i32,
    keyboard: bool,
    chosen: u16,
    from_system: bool,
    done: bool,
    /// How many pop-ups it put up.
    put_up: u16,
}

/// A non-client mouse message as the client-area one it stands for here;
/// any other as itself.
fn client_form(message: u16) -> u16 {
    match message {
        WM_NCMOUSEMOVE => WM_MOUSEMOVE,
        WM_NCLBUTTONDOWN => WM_LBUTTONDOWN,
        WM_NCLBUTTONUP => WM_LBUTTONUP,
        WM_NCRBUTTONDOWN => WM_RBUTTONDOWN,
        WM_NCRBUTTONUP => WM_RBUTTONUP,
        _ => message,
    }
}

/// A character upper-cased as a string's `toUpperCase` does it, which may
/// make more than one.
fn upper(c: char) -> String {
    c.to_uppercase().collect()
}

/// The letter after an item's `&`, upper case.
fn mnemonic(text: Option<&str>) -> String {
    let chars: Vec<char> = text.unwrap_or("").chars().collect();

    match chars.iter().position(|&c| c == '&') {
        Some(at) if at + 1 < chars.len() => upper(chars[at + 1]),
        _ => String::new(),
    }
}

/// The item a key names by its mnemonic, the first that is not a
/// separator. The key is the whole `wParam`, as `String.fromCharCode` takes
/// it in the TypeScript engine: a code past 0xff is its own character, not
/// its low byte's, and a lone surrogate, which no item's text holds, names
/// none.
fn item_by_letter(items: &[MenuItem], code: u16) -> Option<usize> {
    let letter = upper(char::from_u32(u32::from(code))?);

    items
        .iter()
        .position(|item| mnemonic(item.text.as_deref()) == letter && item.flags & MF_SEPARATOR == 0)
}

/// The next item from `from` in a direction that is not a separator,
/// wrapping; -1 for none.
fn first_selectable(items: &[MenuItem], from: i32, step: i32) -> i32 {
    let count = items.len() as i32;

    for tried in 1..=count {
        let index = ((from + step * tried) % count + count) % count;

        if items[index as usize].flags & MF_SEPARATOR == 0 {
            return index;
        }
    }

    -1
}

impl crate::system::System {
    /// What `WM_INITMENU` names as a system menu opens: not the menu
    /// `GetSystemMenu` answers, which is the pop-up `WM_INITMENUPOPUP`
    /// names, but one that holds it (`iconclk`).
    fn system_menu_holder(&mut self, window: usize) -> Result<usize, Stop> {
        let menu = self.system_menu_of(window)?;
        let holder = if let Some(&holder) = self.menu_loop.holders.get(&window) {
            holder
        } else {
            let holder = self.new_menu();

            self.menus[holder].items.push(MenuItem {
                flags: 0,
                id: 0,
                text: Some(String::new()),
                popup: None,
                bitmaps: None,
            });
            self.menu_loop.holders.insert(window, holder);
            holder
        };

        self.menus[holder].items[0].popup = Some(menu);
        Ok(holder)
    }
}

impl Engine {
    /// A message the menu does not take, sent on to its window's procedure.
    async fn menu_dispatch(&self, message: &Message) -> Result<(), Stop> {
        let window = {
            let system = self.system();

            matches!(
                system.handles.resolve(message.hwnd),
                Some(Object::Window(index)) if system.windows[index].is_some()
            )
        };

        if window {
            self.send_message(
                message.hwnd,
                message.message,
                message.wparam,
                &mut Param::Value(message.lparam),
            )
            .await?;
        }

        Ok(())
    }

    /// The release of a press the menu ended on, taken with it: its window
    /// is not sent it, though it may lie there once the menu's command is
    /// done (`iconclk`: an icon restored by a double click gets no
    /// `WM_NCLBUTTONUP`). Waited for if the button is still down.
    async fn take_release(&self) -> Result<(), Stop> {
        loop {
            for form in [WM_NCLBUTTONUP, WM_LBUTTONUP] {
                if self
                    .take_message_from(false, Some((form, form)))
                    .await?
                    .is_some()
                {
                    return Ok(());
                }
            }

            if self.system().mouse_buttons & 1 == 0 {
                return Ok(());
            }

            let Some(message) = self.take_message_from(true, None).await? else {
                return Ok(());
            };

            if message.message == WM_NCLBUTTONUP || message.message == WM_LBUTTONUP {
                return Ok(());
            }

            self.menu_dispatch(&message).await?;
        }
    }

    /// Runs a menu to its end, and sends its command. Answers the command
    /// chosen, or 0.
    pub async fn track_menu(&self, hwnd: u16, start: MenuStart) -> Result<u16, Stop> {
        let (window, bar_menu) = {
            let system = self.system();
            let Some(window) = system.window_named(hwnd) else {
                return Ok(0);
            };
            let menu = system.windows[window].as_ref().map_or(0, |w| w.menu);
            let bar_menu = match start {
                MenuStart::Bar { .. } if menu != 0 => system.menu_of(menu),
                _ => None,
            };

            (window, bar_menu)
        };
        let mut run = Run {
            engine: self,
            hwnd,
            window,
            start,
            bar_menu,
            levels: Vec::new(),
            bar: match start {
                MenuStart::Bar { index, .. } => index as i32,
                _ => -1,
            },
            keyboard: match start {
                MenuStart::Bar { keyboard, .. } | MenuStart::System { keyboard } => keyboard,
                MenuStart::Popup { .. } => false,
            },
            chosen: 0,
            from_system: matches!(start, MenuStart::System { .. }),
            done: false,
            put_up: 0,
        };

        Box::pin(run.run()).await
    }
}

impl Run<'_> {
    async fn send(&self, message: u16, wparam: u16, lparam: u32) -> Result<u32, Stop> {
        self.engine
            .send_message(self.hwnd, message, wparam, &mut Param::Value(lparam))
            .await
    }

    fn top(&self) -> Option<Level> {
        self.levels.last().copied()
    }

    fn selected(&self) -> i32 {
        self.top().map_or(-1, |level| {
            self.engine.system().windows[level.window]
                .as_ref()
                .and_then(|window| window.popup.as_ref())
                .map_or(-1, |popup| popup.selected)
        })
    }

    /// The window's frame drawn again, its selection or its system menu box
    /// as they are now.
    fn paint_frame(&self) {
        let mut system = self.engine.system();

        if system.windows[self.window].is_some() {
            system.paint_frame(self.window);
        }
    }

    /// The bar's item shown selected, or none.
    fn set_selected(&self, selected: Option<usize>) {
        if let Some(window) = self.engine.system().windows[self.window].as_mut() {
            window.menu_selected = selected;
        }
    }

    /// The system menu box shown open, or not.
    fn set_system_open(&self, open: bool) {
        if let Some(window) = self.engine.system().windows[self.window].as_mut() {
            window.system_menu_open = open;
        }
    }

    async fn select(&mut self, index: i32) -> Result<(), Stop> {
        let Some(level) = self.top() else {
            return Ok(());
        };

        if self.selected() == index {
            return Ok(());
        }

        let message = {
            let mut system = self.engine.system();

            if let Some(popup) = system.windows[level.window]
                .as_mut()
                .and_then(|window| window.popup.as_mut())
            {
                popup.selected = index;
            }

            system.paint_popup(level.window);

            let item = usize::try_from(index)
                .ok()
                .and_then(|index| system.menus[level.menu].items.get(index).cloned());

            item.map(|item| self.menu_select_of(&mut system, &item, level.menu))
        };

        if let Some((wparam, lparam)) = message {
            self.send(WM_MENUSELECT, wparam, lparam).await?;
        }

        Ok(())
    }

    /// `WM_MENUSELECT`'s parameters for an item selected: a pop-up's handle
    /// or the item's id, its flags as it has them, highlighted, and
    /// `MF_SYSMENU` in the system menu, with the menu it is in (`USER.EXE`
    /// seg10 `0000`-`0091`: the flags masked with `5fff`, `MF_SYSMENU` added
    /// while the system menu is tracked; `altchild`: `90` for File selected
    /// on the bar, `80` for its first item, `2090` and `2080` for the
    /// system menu and its first).
    fn menu_select_of(
        &self,
        system: &mut crate::system::System,
        item: &MenuItem,
        menu: usize,
    ) -> (u16, u32) {
        let wparam = match item.popup {
            Some(popup) => system.menu_handle_of(popup),
            None => item.id,
        };
        let popup = if item.popup.is_some() { MF_POPUP } else { 0 };
        let system_menu = if self.from_system { MF_SYSMENU } else { 0 };
        let flags = ((item.flags | popup | MF_HILITE) & 0x5fff) | system_menu;

        (
            wparam,
            u32::from(flags) | u32::from(system.menu_handle_of(menu)) << 16,
        )
    }

    /// The bar's item selected, nothing below it open: `WM_MENUSELECT` for
    /// it (`altchild`).
    async fn select_bar(&mut self, index: usize) -> Result<(), Stop> {
        let message = {
            let mut system = self.engine.system();

            self.bar_menu.and_then(|menu| {
                let item = system.menus[menu].items.get(index).cloned()?;

                Some(self.menu_select_of(&mut system, &item, menu))
            })
        };

        if let Some((wparam, lparam)) = message {
            self.send(WM_MENUSELECT, wparam, lparam).await?;
        }

        Ok(())
    }

    async fn open(
        &mut self,
        menu: usize,
        x: i32,
        y: i32,
        index: usize,
        system_menu: bool,
    ) -> Result<(), Stop> {
        let handle = self.engine.system().menu_handle_of(menu);

        self.send(
            WM_INITMENUPOPUP,
            handle,
            (index as u32 & 0xffff) | if system_menu { 1 << 16 } else { 0 },
        )
        .await?;

        self.put_up = self.put_up.saturating_add(1);

        {
            let mut system = self.engine.system();
            let popup = system.open_popup(menu, x, y, -1);
            let (screen_width, screen_height) = (
                i32::from(system.display.width),
                i32::from(system.display.height),
            );
            let (left, top, width, height) = {
                let shown = system.windows[popup].as_ref().expect("a pop-up");

                (shown.left, shown.top, shown.width, shown.height)
            };

            // Kept on the screen: moved left, or up, as far as it has to be.
            let moved_left = left.min(screen_width - width).max(0);
            let moved_top = top.min(screen_height - height).max(0);

            let window = if moved_left != left || moved_top != top {
                system.close_popup(popup);
                system.open_popup(menu, moved_left, moved_top, -1)
            } else {
                popup
            };

            self.levels.push(Level { menu, window });
        }

        if self.keyboard {
            let first = {
                let system = self.engine.system();

                first_selectable(&system.menus[menu].items, -1, 1)
            };

            self.select(first).await?;
        }

        Ok(())
    }

    /// Each pop-up closed as `SetWindowPos` hides a window: what it
    /// covered, if its bits could not be put back, and whatever else is due
    /// an erase, drawn at once (`menuinv`).
    async fn close_to(&mut self, depth: usize) -> Result<(), Stop> {
        while self.levels.len() > depth {
            let level = self.levels.pop().expect("a pop-up open");

            self.engine.system().close_popup(level.window);
            self.engine.erase_due().await?;
        }

        Ok(())
    }

    async fn open_bar(&mut self, index: usize) -> Result<(), Stop> {
        let already = self.engine.system().windows[self.window]
            .as_ref()
            .is_some_and(|window| window.menu_selected == Some(index));

        self.close_to(0).await?;
        self.bar = index as i32;
        self.set_selected(Some(index));
        self.paint_frame();

        // The item selected on the bar first, unless it was already
        // (`altchild`: Alt and F is File selected, then opened; Alt alone,
        // then F, opens the File already selected).
        if !already {
            self.select_bar(index).await?;
        }

        let place = {
            let system = self.engine.system();
            let popup = self
                .bar_menu
                .and_then(|menu| system.menus[menu].items.get(index))
                .and_then(|item| item.popup);

            popup.map(|popup| {
                let place = system
                    .menu_bar_items(self.window)
                    .get(index)
                    .copied()
                    .unwrap_or_default();

                (popup, place)
            })
        };

        if let Some((popup, place)) = place {
            self.open(popup, place[0], place[3], index, false).await?;
        }

        Ok(())
    }

    async fn open_system(&mut self) -> Result<(), Stop> {
        self.close_to(0).await?;
        self.bar = -1;
        self.set_selected(None);
        self.set_system_open(true);
        self.from_system = true;
        self.paint_frame();

        // The system menu selected as the one item of the menu
        // `WM_INITMENU` named, its pop-up `2090`: under a handle that is not
        // the one `GetSystemMenu` answers (`altchild`), here the holder's
        // own.
        let holder = {
            let mut system = self.engine.system();
            let holder = system.system_menu_holder(self.window)?;

            system.menu_handle_of(holder)
        };

        self.send(
            WM_MENUSELECT,
            holder,
            u32::from(MF_SYSMENU | MF_HILITE | MF_POPUP) | u32::from(holder) << 16,
        )
        .await?;

        let (menu, (x, y)) = {
            let mut system = self.engine.system();

            (
                system.system_menu_of(self.window)?,
                system.system_menu_place(self.window),
            )
        };

        self.open(menu, x, y, 0, true).await
    }

    /// An item chosen: a pop-up opens, a grayed item does nothing, anything
    /// else is the command.
    async fn choose(&mut self, index: i32) -> Result<(), Stop> {
        let Some(level) = self.top() else {
            return Ok(());
        };
        let (item, place, corner) = {
            let system = self.engine.system();
            let item = usize::try_from(index)
                .ok()
                .and_then(|at| system.menus[level.menu].items.get(at).cloned());
            let place = usize::try_from(index)
                .ok()
                .and_then(|at| system.popup_places(level.window).get(at).copied());
            let corner = system.windows[level.window]
                .as_ref()
                .map_or((0, 0), |window| (window.left + window.width, window.top));

            (item, place, corner)
        };
        let Some(item) = item else {
            return Ok(());
        };

        if item.flags & MF_SEPARATOR != 0 {
            return Ok(());
        }

        if let Some(popup) = item.popup {
            let top = place.map_or(0, |place| place.top);

            self.select(index).await?;
            self.open(
                popup,
                corner.0 - 2,
                corner.1 + top - 1,
                index as usize,
                false,
            )
            .await?;
            return Ok(());
        }

        if item.flags & (MF_GRAYED | MF_DISABLED) == 0 {
            self.chosen = item.id;
        }

        self.done = true;
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    async fn run(&mut self) -> Result<u16, Stop> {
        let engine = self.engine;
        let hwnd = self.hwnd;

        // Into the menu.
        let previous_capture = {
            let mut system = engine.system();
            let previous = system.capture;

            system.capture = Some(self.window);
            system.menu_loop.owner = Some(self.window);
            system.menu_loop.cancelled = false;
            previous
        };

        // The mouse taken, the window asked for the cursor as over its
        // caption, with no mouse message: the arrow, from `DefWindowProc`
        // (`USER.EXE` seg17 `0199`; `titledis`, `curerr`).
        self.send(WM_SETCURSOR, hwnd, u32::from(HTCAPTION)).await?;

        if let Some(menu) = self.bar_menu {
            let handle = engine.system().menu_handle_of(menu);

            self.send(WM_INITMENU, handle, 0).await?;
        }

        match self.start {
            MenuStart::Bar { index, open, .. } => {
                if open {
                    self.open_bar(index).await?;
                } else {
                    self.set_selected(Some(index));
                    self.paint_frame();
                    self.select_bar(index).await?;
                }
            }
            MenuStart::System { .. } => {
                let handle = {
                    let mut system = engine.system();
                    let holder = system.system_menu_holder(self.window)?;

                    system.menu_handle_of(holder)
                };

                self.send(WM_INITMENU, handle, 0).await?;
                self.open_system().await?;
            }
            MenuStart::Popup { menu, x, y } => {
                // Put up with no button down, the menu is driven from the
                // keyboard, its first item selected: the `menus` probe's
                // pop-up, shown by a program with the mouse at rest, has it.
                self.keyboard = engine.system().mouse_buttons == 0;

                // `TrackPopupMenu`'s menu is named in `WM_INITMENU` too, as
                // a menu starts (`USER.EXE` seg17 `0213`; `curerr`).
                let handle = engine.system().menu_handle_of(menu);

                self.send(WM_INITMENU, handle, 0).await?;
                self.open(menu, x, y, 0, false).await?;
            }
        }

        // The message filters are told of the menu, as a `WM_MENUSELECT`,
        // as it starts and as it ends: `hooks` recorded one each side of its
        // messages.
        let told = Message {
            hwnd,
            message: WM_MENUSELECT,
            wparam: 0,
            lparam: 0,
            time: 0,
            pt: (0, 0),
            serial: 0,
        };

        engine.message_filter(&told, MSGF_MENU).await?;

        while !self.done && !engine.system().menu_loop.cancelled {
            let mut message = engine.take_message_from(false, None).await?;

            // Nothing waiting: its window is told the menu is idle, and may
            // end it with `WM_CANCELMODE` (`iconclk`). A pop-up's window has
            // no handle, so nought is named.
            if message.is_none() {
                let idle = self.top().map_or(0, |level| {
                    engine.system().windows[level.window]
                        .as_ref()
                        .map_or(0, |window| window.hwnd)
                });

                self.send(WM_ENTERIDLE, MSGF_MENU as u16, u32::from(idle))
                    .await?;

                if engine.system().menu_loop.cancelled {
                    break;
                }

                message = engine.take_message_from(true, None).await?;
            }

            let Some(message) = message else {
                break;
            };

            // An icon's system menu, the icon clicked twice: the window
            // restored (`iconclk`).
            let minimized = engine.system().windows[self.window]
                .as_ref()
                .is_some_and(|window| window.placement == Placement::Minimized);

            if (message.message == WM_NCLBUTTONDBLCLK || message.message == WM_LBUTTONDBLCLK)
                && self.from_system
                && minimized
                && message.hwnd == hwnd
            {
                self.chosen = SC_RESTORE;
                self.done = true;
                engine.take_release().await?;
                continue;
            }

            // The message filters first: one that takes the message ends
            // it.
            if engine.message_filter(&message, MSGF_MENU).await? {
                continue;
            }

            if message.message == WM_KEYDOWN || message.message == WM_SYSKEYDOWN {
                self.keyboard = true;
                self.key(message.wparam).await?;
                continue;
            }

            // The pointer, in either form: the page posts each mouse event
            // as it happens, hit-tested then, so what came before this loop
            // took the capture -- the release of the press that opened the
            // menu -- is still the non-client message it was posted as.
            // Windows hit-tests when a message is taken, and has no such
            // case.
            let pointed = client_form(message.message);

            if matches!(
                pointed,
                WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP
            ) {
                self.keyboard = false;
                self.pointer(&message, pointed).await?;
                continue;
            }

            if matches!(
                message.message,
                WM_KEYUP | WM_SYSKEYUP | WM_CHAR | WM_SYSCHAR
            ) {
                continue;
            }

            engine.menu_dispatch(&message).await?;
        }

        engine.message_filter(&told, MSGF_MENU).await?;

        // Out of it: everything it opened closed, its window drawn as it
        // was.
        self.close_to(0).await?;
        self.set_selected(None);
        self.set_system_open(false);
        engine.system().menu_loop.owner = None;
        self.paint_frame();
        engine.system().capture = previous_capture;

        // A pop-up gone from the screen is a window hidden: USER makes the
        // mouse move where it is, and the window under it hears of it
        // (`curerr`; `mouse-input`).
        if self.put_up > 0 {
            engine.system().nudge()?;
        }

        self.send(WM_MENUSELECT, 0, 0xffff).await?;

        if self.chosen != 0 {
            let command = if self.from_system {
                WM_SYSCOMMAND
            } else {
                WM_COMMAND
            };

            self.send(command, self.chosen, 0).await?;
        }

        Ok(self.chosen)
    }

    #[allow(clippy::too_many_lines)]
    async fn key(&mut self, code: u16) -> Result<(), Stop> {
        let level = self.top();
        let is_bar = matches!(self.start, MenuStart::Bar { .. });

        match code {
            // A pop-up closed, back to what opened it; from the bar, or the
            // system menu Alt+Space opened, the menu stays with that
            // selected, told so again, until a second Escape ends it
            // (`altchild`: File's `90` again; the system menu as
            // `GetSystemMenu` answers it, `2010`).
            VK_ESCAPE => {
                let system_box = matches!(self.start, MenuStart::System { keyboard: true });

                if self.levels.len() > 1 || (self.levels.len() == 1 && (is_bar || system_box)) {
                    self.close_to(self.levels.len() - 1).await?;

                    if self.levels.is_empty() && self.from_system {
                        let (menu, holder) = {
                            let mut system = self.engine.system();
                            let menu = system.system_menu_of(self.window)?;
                            let holder = system.system_menu_holder(self.window)?;

                            (system.menu_handle_of(menu), system.menu_handle_of(holder))
                        };

                        self.send(
                            WM_MENUSELECT,
                            menu,
                            u32::from(MF_SYSMENU | MF_POPUP) | u32::from(holder) << 16,
                        )
                        .await?;
                    } else if self.levels.is_empty() && self.bar >= 0 {
                        self.select_bar(self.bar as usize).await?;
                    }
                } else {
                    self.done = true;
                }

                return Ok(());
            }
            VK_MENU | VK_F10 => {
                self.done = true;
                return Ok(());
            }
            VK_DOWN | VK_UP => {
                if level.is_none() && self.bar >= 0 {
                    self.open_bar(self.bar as usize).await?;
                    return Ok(());
                }

                if level.is_none() && self.from_system {
                    self.open_system().await?;
                    return Ok(());
                }

                if let Some(level) = level {
                    let selected = self.selected();
                    let next = first_selectable(
                        &self.engine.system().menus[level.menu].items,
                        selected,
                        if code == VK_DOWN { 1 } else { -1 },
                    );

                    self.select(next).await?;
                }

                return Ok(());
            }
            VK_RIGHT | VK_LEFT => {
                let selected = self.selected();
                let opens = level.is_some_and(|level| {
                    usize::try_from(selected).ok().is_some_and(|at| {
                        self.engine.system().menus[level.menu]
                            .items
                            .get(at)
                            .is_some_and(|item| item.popup.is_some())
                    })
                });

                if code == VK_RIGHT && opens {
                    self.choose(selected).await?;
                    return Ok(());
                }

                if code == VK_LEFT && self.levels.len() > 1 {
                    self.close_to(self.levels.len() - 1).await?;
                    return Ok(());
                }

                let count = self.bar_menu.map_or(0, |menu| {
                    self.engine.system().menus[menu].items.len() as i32
                });

                if count != 0 {
                    let step = if code == VK_RIGHT { 1 } else { -1 };
                    let next = ((self.bar.max(0) + step + count) % count) as usize;
                    let was_open = !self.levels.is_empty();

                    self.set_system_open(false);
                    self.from_system = false;

                    if was_open {
                        self.open_bar(next).await?;
                    } else {
                        self.bar = next as i32;
                        self.set_selected(Some(next));
                        self.paint_frame();
                        self.select_bar(next).await?;
                    }
                }

                return Ok(());
            }
            VK_RETURN => {
                if level.is_some() {
                    self.choose(self.selected()).await?;
                } else if self.bar >= 0 {
                    self.open_bar(self.bar as usize).await?;
                } else if self.from_system {
                    self.open_system().await?;
                }

                return Ok(());
            }
            _ => {}
        }

        // A letter: the item whose mnemonic it is.
        let index = {
            let system = self.engine.system();
            let items = match level {
                Some(level) => system.menus[level.menu].items.as_slice(),
                None => self
                    .bar_menu
                    .map_or(&[][..], |menu| system.menus[menu].items.as_slice()),
            };

            item_by_letter(items, code)
        };
        let Some(index) = index else {
            return Ok(());
        };

        if level.is_some() {
            self.select(index as i32).await?;
            self.choose(index as i32).await?;
        } else {
            self.open_bar(index).await?;
        }

        Ok(())
    }

    async fn pointer(&mut self, message: &Message, kind: u16) -> Result<(), Stop> {
        let (x, y) = (i32::from(message.pt.0), i32::from(message.pt.1));

        // Over an open pop-up, the deepest first.
        for depth in (0..self.levels.len()).rev() {
            let level = self.levels[depth];
            let place = self.engine.system().windows[level.window]
                .as_ref()
                .map(|window| (window.left, window.top, window.width, window.height));
            let Some((left, top, width, height)) = place else {
                continue;
            };
            let inside = x >= left && y >= top && x < left + width - 1 && y < top + height - 1;

            if !inside {
                continue;
            }

            self.close_to(depth + 1).await?;

            let index = {
                let system = self.engine.system();

                system
                    .popup_places(level.window)
                    .iter()
                    .position(|place| y - top >= place.top && y - top < place.top + place.height)
                    .filter(|&at| system.menus[level.menu].items[at].flags & MF_SEPARATOR == 0)
            };

            if let Some(index) = index {
                self.select(index as i32).await?;

                if kind == WM_LBUTTONUP {
                    self.choose(index as i32).await?;
                }
            }

            return Ok(());
        }

        // Over the menu bar.
        if self.bar_menu.is_some() {
            let found = self
                .engine
                .system()
                .menu_bar_items(self.window)
                .iter()
                .position(|item| x >= item[0] && x < item[1] && y >= item[2] && y < item[3]);

            if let Some(index) = found {
                if index as i32 != self.bar || (kind == WM_LBUTTONDOWN && self.levels.is_empty()) {
                    self.open_bar(index).await?;
                } else if kind == WM_LBUTTONDOWN && !self.levels.is_empty() {
                    self.done = true;
                }

                return Ok(());
            }
        }

        // Anywhere else, a press closes the menu.
        if kind == WM_LBUTTONDOWN || kind == WM_RBUTTONDOWN {
            self.done = true;
        }

        Ok(())
    }
}

/// `TrackPopupMenu`: a pop-up menu shown with its top left at a point of
/// the screen, run until it closes, and the command chosen sent to the
/// window given, as `WM_COMMAND`. Only `TPM_LEFTALIGN` is placed as asked;
/// the other alignments are not done yet, as in the TypeScript engine.
/// Whether the menu was shown.
pub fn track_popup_menu(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, menu, x, y) = {
            let mut system = engine.system();
            let hmenu = args.word(&system);
            let _flags = args.word(&system);
            let x = args.word(&system) as i16;
            let y = args.word(&system) as i16;
            let _reserved = args.word(&system);
            let hwnd = args.word(&system);
            let _rect = args.dword(&system);

            system.raster();

            let menu = system.menu_of(hmenu);
            let window = system.window_named(hwnd);

            match (menu, window) {
                (Some(menu), Some(_)) => (hwnd, menu, x, y),
                _ => return Ok(Answer::Word(0)),
            }
        };

        engine
            .track_menu(
                hwnd,
                MenuStart::Popup {
                    menu,
                    x: i32::from(x),
                    y: i32::from(y),
                },
            )
            .await?;

        Ok(Answer::Word(1))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(flags: u16, text: Option<&str>) -> MenuItem {
        MenuItem {
            flags,
            id: 0,
            text: text.map(str::to_string),
            popup: None,
            bitmaps: None,
        }
    }

    #[test]
    fn the_next_item_passes_separators_and_wraps() {
        let items = [
            item(0, Some("&New")),
            item(MF_SEPARATOR, None),
            item(0, Some("E&xit")),
        ];

        assert_eq!(first_selectable(&items, -1, 1), 0);
        assert_eq!(first_selectable(&items, 0, 1), 2);
        assert_eq!(first_selectable(&items, 2, 1), 0);
        assert_eq!(first_selectable(&items, 0, -1), 2);
        assert_eq!(first_selectable(&[item(MF_SEPARATOR, None)], -1, 1), -1);
    }

    #[test]
    fn a_mnemonic_is_the_letter_after_the_ampersand() {
        assert_eq!(mnemonic(Some("E&xit")), "X");
        assert_eq!(mnemonic(Some("Exit&")), "");
        assert_eq!(mnemonic(None), "");
        assert_eq!(client_form(WM_NCLBUTTONUP), WM_LBUTTONUP);
    }

    #[test]
    fn a_key_names_an_item_by_its_whole_code() {
        let items = [
            item(MF_SEPARATOR, Some("&Apart")),
            item(0, Some("&Apple")),
            item(0, Some("&\u{e9}t\u{e9}")),
        ];

        assert_eq!(item_by_letter(&items, 0x41), Some(1));
        assert_eq!(item_by_letter(&items, 0x61), Some(1));
        assert_eq!(item_by_letter(&items, 0xe9), Some(2));
        // 0x141 is `Ł`, not `A`: its low byte is not the letter.
        assert_eq!(item_by_letter(&items, 0x141), None);
        assert_eq!(item_by_letter(&items, 0xd841), None);
    }
}
