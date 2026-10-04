//! A window's system menu, as data: the standard one, made the first time
//! it is asked for, or the one a program changed; `GetSystemMenu` hands it
//! out, or puts the standard one back.
//!
//! Showing it -- the menu opened from the system menu box -- is the
//! desktop's, and not here.

use crate::call::{Answer, Args, Stop};
use crate::menu_api::{MF_GRAYED, MF_SEPARATOR};
use crate::menus::MenuItem;
use crate::system::System;

pub const SC_SIZE: u16 = 0xf000;
pub const SC_MOVE: u16 = 0xf010;
pub const SC_MINIMIZE: u16 = 0xf020;
pub const SC_MAXIMIZE: u16 = 0xf030;
pub const SC_CLOSE: u16 = 0xf060;
pub const SC_RESTORE: u16 = 0xf120;
pub const SC_TASKLIST: u16 = 0xf130;

const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

/// The standard system menu's items: each command and its text, or a
/// separator.
const STANDARD: [(u16, Option<&str>); 9] = [
    (SC_RESTORE, Some("&Restore")),
    (SC_MOVE, Some("&Move")),
    (SC_SIZE, Some("&Size")),
    (SC_MINIMIZE, Some("Mi&nimize")),
    (SC_MAXIMIZE, Some("Ma&ximize")),
    (0, None),
    (SC_CLOSE, Some("&Close\tAlt+F4")),
    (0, None),
    (SC_TASKLIST, Some("S&witch To...\tCtrl+Esc")),
];

impl System {
    /// A window's system menu, by its index among the menus: the one a
    /// program changed, or the standard one, made now if it has none. Its
    /// items are grayed by what the window can do now: restored, it cannot
    /// be restored; without a thick frame it cannot be sized; without its
    /// boxes, minimized or maximized.
    pub fn system_menu_of(&mut self, index: usize) -> Result<usize, Stop> {
        let menu = if let Some(&menu) = self.user_calls.system_menus.get(&index) {
            menu
        } else {
            let menu = self.new_menu();

            self.menus[menu].items = STANDARD
                .iter()
                .map(|&(id, text)| MenuItem {
                    flags: if text.is_none() { MF_SEPARATOR } else { 0 },
                    id,
                    text: text.map(str::to_string),
                    popup: None,
                    bitmaps: None,
                })
                .collect();
            self.user_calls.system_menus.insert(index, menu);
            menu
        };
        let style = self.windows[index]
            .as_ref()
            .map_or(0, |window| window.style);

        for (id, grayed) in [
            (SC_RESTORE, true),
            (SC_SIZE, style & WS_THICKFRAME == 0),
            (SC_MINIMIZE, style & WS_MINIMIZEBOX == 0),
            (SC_MAXIMIZE, style & WS_MAXIMIZEBOX == 0),
        ] {
            if let Some((found, position)) = self.find_menu_item(menu, id, 0)? {
                let item = &mut self.menus[found].items[position];

                item.flags = (item.flags & !MF_GRAYED) | if grayed { MF_GRAYED } else { 0 };
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
        system.user_calls.system_menus.remove(&index);
        return Ok(Answer::Word(0));
    }

    let menu = system.system_menu_of(index)?;

    Ok(Answer::Word(system.menu_handle_of(menu)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_standard_menu_is_grayed_by_the_style() {
        let mut system = System::new();

        system.windows.push(Some(crate::windows::Window {
            style: WS_MINIMIZEBOX,
            ..crate::windows::Window::default()
        }));

        let menu = system.system_menu_of(0).unwrap();
        let items = &system.menus[menu].items;

        assert_eq!(items.len(), 9);
        assert_eq!(items[0].flags, MF_GRAYED);
        assert_eq!(items[2].flags, MF_GRAYED);
        assert_eq!(items[3].flags, 0);
        assert_eq!(items[4].flags, MF_GRAYED);
        assert_eq!(items[5].flags, MF_SEPARATOR);
        assert_eq!(items[6].text.as_deref(), Some("&Close\tAlt+F4"));
        assert_eq!(system.system_menu_of(0).unwrap(), menu);
    }
}
