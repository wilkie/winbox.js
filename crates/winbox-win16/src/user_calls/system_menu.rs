//! A window's system menu, as data: the one USER keeps for every window
//! that has none of its own, a window's own once `GetSystemMenu` is asked
//! for it or USER gives it one -- an MDI document window, at its making --
//! or the one a program changed; `GetSystemMenu` hands it out, or puts the
//! standard one back.
//!
//! Showing it -- the menu opened from the system menu box -- is the
//! desktop's, and not here.

use crate::call::{Answer, Args, Stop};
use crate::menu_api::{MF_DISABLED, MF_GRAYED, MF_SEPARATOR, separated};
use crate::menus::MenuItem;
use crate::system::System;
use crate::windows::Placement;

pub const SC_SIZE: u16 = 0xf000;
pub const SC_MOVE: u16 = 0xf010;
pub const SC_MINIMIZE: u16 = 0xf020;
pub const SC_MAXIMIZE: u16 = 0xf030;
pub const SC_NEXTWINDOW: u16 = 0xf040;
pub const SC_CLOSE: u16 = 0xf060;
pub const SC_RESTORE: u16 = 0xf120;
pub const SC_TASKLIST: u16 = 0xf130;

const WS_CHILD: u32 = 0x4000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_DLGFRAME: u32 = 0x0040_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_EX_DLGMODALFRAME: u32 = 0x0001;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

/// Which of USER's two system menus a window's is made from: its menu
/// resources 1 and 2, the second an MDI document window's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemMenuKind {
    Standard,
    Document,
}

/// The standard system menu's items, USER's menu resource 1: each command,
/// its flags and its text, or a separator.
const STANDARD: [(u16, u16, Option<&str>); 9] = [
    (SC_RESTORE, 0, Some("&Restore")),
    (SC_MOVE, 0, Some("&Move")),
    (SC_SIZE, 0, Some("&Size")),
    (SC_MINIMIZE, 0, Some("Mi&nimize")),
    (SC_MAXIMIZE, 0, Some("Ma&ximize")),
    (0, 0, None),
    (SC_CLOSE, 0, Some("&Close\tAlt+F4")),
    (0, 0, None),
    (SC_TASKLIST, 0, Some("S&witch To...\tCtrl+Esc")),
];

/// An MDI document window's, USER's menu resource 2: Minimize grayed as it
/// comes, Close with Ctrl+F4, and Next in place of Switch To (`mdisys`).
const DOCUMENT: [(u16, u16, Option<&str>); 9] = [
    (SC_RESTORE, 0, Some("&Restore")),
    (SC_MOVE, 0, Some("&Move")),
    (SC_SIZE, 0, Some("&Size")),
    (SC_MINIMIZE, MF_GRAYED, Some("Mi&nimize")),
    (SC_MAXIMIZE, 0, Some("Ma&ximize")),
    (0, 0, None),
    (SC_CLOSE, 0, Some("&Close\tCtrl+F4")),
    (0, 0, None),
    (SC_NEXTWINDOW, 0, Some("Nex&t\tCtrl+F6")),
];

impl System {
    /// One of USER's system menus loaded afresh, as its resource has it.
    fn load_system_menu(&mut self, kind: SystemMenuKind) -> usize {
        let menu = self.new_menu();
        let template = match kind {
            SystemMenuKind::Standard => &STANDARD,
            SystemMenuKind::Document => &DOCUMENT,
        };

        self.menus[menu].items = template
            .iter()
            .map(|&(id, flags, text)| MenuItem {
                flags: separated(flags | if text.is_none() { MF_SEPARATOR } else { 0 }),
                id,
                text: text.map(str::to_string),
                popup: None,
                bitmaps: None,
                bitmap: None,
            })
            .collect();

        if kind == SystemMenuKind::Document {
            self.user_calls.document_menus.insert(menu);
        }

        menu
    }

    /// A window's own system menu, if it has one.
    pub fn own_system_menu(&self, index: usize) -> Option<usize> {
        self.user_calls.system_menus.get(&index).copied()
    }

    /// A window given a system menu of its own, loaded afresh, as USER gives
    /// an MDI document window its kind at its making (`USER.EXE` seg15
    /// `0e48`-`0e5b`, `0f62`-`0f79`), unless it has one already.
    pub fn give_system_menu(&mut self, index: usize, kind: SystemMenuKind) -> usize {
        if let Some(menu) = self.own_system_menu(index) {
            return menu;
        }

        let menu = self.load_system_menu(kind);

        self.user_calls.system_menus.insert(index, menu);
        menu
    }

    /// A window's system menu as `GetSystemMenu` answers it: its own, made
    /// now from the standard one if it has none, as USER loads it, nothing
    /// grayed (`USER.EXE` seg9 `0f00`-`0f1e`; `menuenab`: Restore of a
    /// window that shows is not grayed until the menu opens). A menu of
    /// that window's open goes on with the new one (`0f21`-`0f41`;
    /// `altchild`).
    pub fn system_menu_of(&mut self, index: usize) -> Result<usize, Stop> {
        Ok(self.give_system_menu(index, SystemMenuKind::Standard))
    }

    /// The system menu a window shows: its own, or the one USER keeps for
    /// every window that has none (`USER.EXE` seg9 `0d6a`).
    pub fn displayed_system_menu(&mut self, index: usize) -> usize {
        if let Some(menu) = self.own_system_menu(index) {
            return menu;
        }

        if let Some(menu) = self.user_calls.default_system_menu {
            return menu;
        }

        let menu = self.load_system_menu(SystemMenuKind::Standard);

        self.user_calls.default_system_menu = Some(menu);
        menu
    }

    /// Whether a system menu is an MDI document window's.
    pub fn is_document_menu(&self, menu: usize) -> bool {
        self.user_calls.document_menus.contains(&menu)
    }

    /// A window's own system menu forgotten, as the window goes.
    pub(crate) fn forget_system_menu(&mut self, index: usize) {
        self.user_calls.system_menus.remove(&index);
    }

    /// The system menu a window shows brought up to the window's state, as
    /// USER brings it as a menu of the window starts and as an MDI document
    /// window is sized (`USER.EXE` seg9 `0d8b`, from seg17 `01ac` and seg15
    /// `1782`): Restore grayed unless it is minimized or
    /// maximized; Minimize without its box or minimized; Maximize without
    /// its box or maximized; Size without a thick frame, minimized or
    /// maximized; Move only when maximized and a child, or as large as the
    /// screen. A window with a dialog frame and no border, or
    /// `WS_EX_DLGMODALFRAME`, has only Move brought up. USER also grays
    /// Move while a state of its own holds (`[0E2h]` set and `[102h]`
    /// clear), not followed.
    pub fn system_menu_brought_up(&mut self, index: usize) -> Result<usize, Stop> {
        let menu = self.displayed_system_menu(index);
        let shared = self.own_system_menu(index).is_none();
        let Some(window) = self.windows[index].as_ref() else {
            return Ok(menu);
        };
        let style = window.style;
        let dialog_frame =
            style & WS_CAPTION == WS_DLGFRAME || window.ex_style & WS_EX_DLGMODALFRAME != 0;
        // As wide and as high as the screen, as USER measures it against
        // two sizes of its own (`[988h]`, `[98Ch]`), taken here for the
        // screen's.
        let covers = window.width >= i32::from(self.display.width)
            && window.height >= i32::from(self.display.height);
        let (mut restore, mut minimize, mut maximize, mut size, mut moving) =
            (true, false, false, false, false);

        if style & WS_MINIMIZEBOX == 0 {
            minimize = true;
        } else if window.placement == Placement::Minimized {
            restore = false;
            size = true;
            minimize = true;
        }

        if style & WS_MAXIMIZEBOX == 0 {
            maximize = true;
        } else if window.placement == Placement::Maximized {
            restore = false;
            moving = style & WS_CHILD != 0 || covers;
            size = true;
            maximize = true;
        }

        if style & WS_THICKFRAME == 0 {
            size = true;
        }

        let mut grays = vec![(SC_MOVE, moving)];

        // The menu every window shows that has none of its own has Close
        // and Switch To enabled as well (`0ead`-`0ec4`).
        if shared {
            grays.extend([(SC_CLOSE, false), (SC_TASKLIST, false)]);
        }

        if !dialog_frame {
            grays.extend([
                (SC_SIZE, size),
                (SC_MINIMIZE, minimize),
                (SC_MAXIMIZE, maximize),
                (SC_RESTORE, restore),
            ]);
        }

        for (id, grayed) in grays {
            if let Some((found, position)) = self.find_menu_item(menu, id, 0)? {
                let item = &mut self.menus[found].items[position];

                item.flags =
                    (item.flags & !(MF_GRAYED | MF_DISABLED)) | if grayed { MF_GRAYED } else { 0 };
            }
        }

        Ok(menu)
    }
}

/// A window's system menu, for a program to change: its handle. With
/// `fRevert`, the standard one is put back, and nought answered; nought too
/// for a handle that is no window.
pub(super) fn get_system_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let revert = args.word(system) != 0;
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Word(0));
    };

    if revert {
        system.forget_system_menu(index);
        return Ok(Answer::Word(0));
    }

    let menu = system.system_menu_of(index)?;

    Ok(Answer::Word(system.menu_handle_of(menu)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_standard_menu_is_grayed_by_the_style_as_it_opens() {
        let mut system = System::new();

        system.windows.push(Some(crate::windows::Window {
            style: WS_MINIMIZEBOX,
            ..crate::windows::Window::default()
        }));

        let menu = system.system_menu_of(0).unwrap();

        assert_eq!(system.menus[menu].items[0].flags, 0);
        assert_eq!(system.system_menu_brought_up(0).unwrap(), menu);
        let items = &system.menus[menu].items;

        assert_eq!(items.len(), 9);
        assert_eq!(items[0].flags, MF_GRAYED);
        assert_eq!(items[2].flags, MF_GRAYED);
        assert_eq!(items[3].flags, 0);
        assert_eq!(items[4].flags, MF_GRAYED);
        assert_eq!(items[5].flags, MF_SEPARATOR | MF_DISABLED);
        assert_eq!(items[6].text.as_deref(), Some("&Close\tAlt+F4"));
        assert_eq!(system.system_menu_of(0).unwrap(), menu);
    }
}
