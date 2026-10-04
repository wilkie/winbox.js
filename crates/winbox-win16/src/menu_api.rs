//! USER's calls on a menu as data: making one, filling it, asking about its
//! items and changing them, and taking it apart. Each finds an item by its
//! command identifier, looking into the pop-ups a menu opens, or by its
//! position when `MF_BYPOSITION` says so. Showing a menu -- a window's bar,
//! a pop-up tracked -- is a window's, and not here.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Stop};
use crate::handles::Object;
use crate::menus::MenuItem;
use crate::system::System;

pub const MF_GRAYED: u16 = 0x0001;
pub const MF_DISABLED: u16 = 0x0002;
pub const MF_BITMAP: u16 = 0x0004;
pub const MF_CHECKED: u16 = 0x0008;
pub const MF_POPUP: u16 = 0x0010;
pub const MF_HILITE: u16 = 0x0080;
pub const MF_OWNERDRAW: u16 = 0x0100;
pub const MF_BYPOSITION: u16 = 0x0400;
pub const MF_SEPARATOR: u16 = 0x0800;

/// `ChangeMenu`'s own operations, which share their bits with the flags of
/// an item: `MF_CHANGE` is `MF_HILITE`'s, `MF_APPEND` `MF_OWNERDRAW`'s.
const MF_CHANGE: u16 = 0x0080;
const MF_APPEND: u16 = 0x0100;
const MF_DELETE: u16 = 0x0200;
const MF_REMOVE: u16 = 0x1000;

/// The display driver's check mark, which a menu's item shows checked.
const OBM_CHECK: u16 = 32760;

/// The size of a menu's check mark where the display driver has not been
/// read: the VGA's, 14 by 14 (**recorded** by `userwin`, `e000e`).
const CHECK_SIZE: u16 = 14;

/// The most bytes of a string argument the TypeScript engine reads
/// (`readCString`'s limit): a longer string is cut there.
const ARGUMENT_STRING_MOST: u32 = 1000;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "CreateMenu" | "CreatePopupMenu" => create_menu,
        "DestroyMenu" => destroy_menu,
        "AppendMenu" => append_menu,
        "InsertMenu" => insert_menu,
        "ModifyMenu" => modify_menu,
        "ChangeMenu" => change_menu,
        "RemoveMenu" => remove_menu,
        "DeleteMenu" => delete_menu,
        "GetMenuItemCount" => get_menu_item_count,
        "GetMenuItemId" => get_menu_item_id,
        "GetSubMenu" => get_sub_menu,
        "CheckMenuItem" => check_menu_item,
        "EnableMenuItem" => enable_menu_item,
        "GetMenuState" => get_menu_state,
        "GetMenuString" => get_menu_string,
        "HiliteMenuItem" => hilite_menu_item,
        "LoadMenuIndirect" => load_menu_indirect,
        "IsMenu" => is_menu,
        "GetMenuCheckmarkDimensions" => get_menu_check_mark_dimensions,
        "SetMenuItemBitmaps" => set_menu_item_bitmaps,
        _ => return None,
    }))
}

/// An item's text as a program passes it, the way the TypeScript engine
/// reads a string argument: a null pointer is none; one whose segment is
/// nought is a number -- a bitmap's handle, an owner-drawn item's data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemText {
    Null,
    Number(u16),
    Text(Vec<u8>),
}

impl System {
    /// Whether a string can be read to its nought through its selector,
    /// without leaving the segment, as the argument check of USER's calls
    /// asks: one that cannot turns the call away, answering nought
    /// (**recorded** by `badarg`).
    pub(crate) fn readable_string(&self, far: u32) -> bool {
        let selector = (far >> 16) as u16;
        let offset = far & 0xffff;

        if !self.loads(selector) || selector & 0xfffc == 0 {
            return false;
        }

        let mut at = offset;

        loop {
            if !self.reaches(selector, at, false) {
                return false;
            }

            if self.read_far(u32::from(selector) << 16 | at, 1)[0] == 0 {
                return true;
            }

            if at == offset.wrapping_sub(1) & 0xffff {
                return false;
            }

            at = (at + 1) & 0xffff;
        }
    }

    /// A string argument read: `None` for one that cannot be, which turns
    /// the call away.
    fn item_text(&self, far: u32) -> Option<ItemText> {
        Some(match (far >> 16, far & 0xffff) {
            (0, 0) => ItemText::Null,
            (0, number) => ItemText::Number(number as u16),
            _ if !self.readable_string(far) => return None,
            _ => ItemText::Text(self.argument_string(far)),
        })
    }

    /// A string argument's bytes as the TypeScript engine reads them, once
    /// its check has passed: on from where the pointer points in memory,
    /// past the segment's end rather than back to its start, and no more
    /// than `ARGUMENT_STRING_MOST` of them.
    pub(crate) fn argument_string(&self, far: u32) -> Vec<u8> {
        let start = self.linear(far);

        (0..ARGUMENT_STRING_MOST)
            .map(|step| self.cpu.bus.read8(start.wrapping_add(step)))
            .take_while(|&byte| byte != 0)
            .collect()
    }

    /// The menu a handle is, by its index.
    pub fn menu_of(&self, handle: u16) -> Option<usize> {
        match self.handles.resolve(handle)? {
            Object::Menu(menu) => Some(menu),
            _ => None,
        }
    }

    /// A menu's handle, given one if it has none: a pop-up read from a
    /// resource has none until a program asks for it.
    pub fn menu_handle_of(&mut self, menu: usize) -> u16 {
        if self.menus[menu].handle == 0 {
            self.menu_handle(menu)
        } else {
            self.menus[menu].handle
        }
    }

    /// An item, by its position in a menu or by its command identifier in
    /// the menu or any it opens, as `MF_BYPOSITION` in `flags` says: the menu
    /// it is in and its place there. A separator has no command.
    pub fn find_menu_item(
        &self,
        menu: usize,
        key: u16,
        flags: u16,
    ) -> Result<Option<(usize, usize)>, Stop> {
        self.find_from(menu, key, flags, 0)
    }

    fn find_from(
        &self,
        menu: usize,
        key: u16,
        flags: u16,
        depth: usize,
    ) -> Result<Option<(usize, usize)>, Stop> {
        let items = &self.menus[menu].items;

        if flags & MF_BYPOSITION != 0 {
            return Ok((usize::from(key) < items.len()).then_some((menu, usize::from(key))));
        }

        // A menu that opens itself is searched without end by the
        // TypeScript engine, until its stack runs out; that is a stop here.
        if depth > self.menus.len() {
            return Err(Stop::Unsupported("a menu that opens itself"));
        }

        for (position, item) in items.iter().enumerate() {
            if let Some(popup) = item.popup {
                if let Some(found) = self.find_from(popup, key, flags, depth + 1)? {
                    return Ok(Some(found));
                }
            } else if item.id == key && item.flags & MF_SEPARATOR == 0 {
                return Ok(Some((menu, position)));
            }
        }

        Ok(None)
    }

    /// An item as `AppendMenu` and `InsertMenu` make one. Only a string
    /// item's text is kept: a bitmap's or an owner-drawn item's is not a
    /// string. A number given for text -- a pointer whose segment is nought
    /// -- is kept as its decimal digits, as the TypeScript engine has it.
    /// A pop-up item's identifier is the handle of the menu it opens; one
    /// that is some other object's handle opens nothing and has command
    /// nought.
    fn menu_item(&self, flags: u16, id: u16, text: &ItemText) -> MenuItem {
        let text = if flags & (MF_BITMAP | MF_OWNERDRAW | MF_SEPARATOR) != 0 {
            None
        } else {
            match text {
                ItemText::Null => None,
                ItemText::Number(number) => Some(number.to_string()),
                ItemText::Text(bytes) => Some(bytes.iter().map(|&byte| char::from(byte)).collect()),
            }
        };
        let opened = if flags & MF_POPUP == 0 {
            None
        } else {
            self.handles.resolve(id)
        };

        MenuItem {
            flags,
            id: if opened.is_some() { 0 } else { id },
            text,
            popup: match opened {
                Some(Object::Menu(menu)) => Some(menu),
                _ => None,
            },
            bitmaps: None,
        }
    }

    /// `AppendMenu`: an item put at the end of a menu.
    pub fn append_menu(&mut self, handle: u16, flags: u16, id: u16, text: &ItemText) -> bool {
        let Some(menu) = self.menu_of(handle) else {
            return false;
        };
        let item = self.menu_item(flags, id, text);

        self.menus[menu].items.push(item);
        true
    }

    /// `InsertMenu`: an item put before another -- the one at a position,
    /// with `MF_BYPOSITION`, or the one with a command, in this menu or any
    /// it opens. A position of -1, or past the end, is the end; a command no
    /// menu has, a failure.
    pub fn insert_menu(
        &mut self,
        handle: u16,
        at: u16,
        flags: u16,
        id: u16,
        text: &ItemText,
    ) -> Result<bool, Stop> {
        let Some(menu) = self.menu_of(handle) else {
            return Ok(false);
        };
        let item = self.menu_item(flags & !MF_BYPOSITION, id, text);

        if flags & MF_BYPOSITION != 0 {
            let items = &mut self.menus[menu].items;
            let place = if at == 0xffff {
                items.len()
            } else {
                usize::from(at).min(items.len())
            };

            items.insert(place, item);
            return Ok(true);
        }

        let Some((found, position)) = self.find_menu_item(menu, at, 0)? else {
            return Ok(false);
        };

        self.menus[found].items.insert(position, item);
        Ok(true)
    }

    /// `ModifyMenu`: an item changed where it is, by its command or, with
    /// `MF_BYPOSITION`, its place -- made anew, as `InsertMenu` makes one.
    pub fn modify_menu(
        &mut self,
        handle: u16,
        at: u16,
        flags: u16,
        id: u16,
        text: &ItemText,
    ) -> Result<bool, Stop> {
        let Some(menu) = self.menu_of(handle) else {
            return Ok(false);
        };
        let item = self.menu_item(flags & !MF_BYPOSITION, id, text);

        if flags & MF_BYPOSITION != 0 {
            let items = &mut self.menus[menu].items;

            if usize::from(at) >= items.len() {
                return Ok(false);
            }

            items[usize::from(at)] = item;
            return Ok(true);
        }

        let Some((found, position)) = self.find_menu_item(menu, at, 0)? else {
            return Ok(false);
        };

        self.menus[found].items[position] = item;
        Ok(true)
    }

    /// An item taken out of its menu (`RemoveMenu`), and a pop-up's menu
    /// destroyed with it where `destroy` says (`DeleteMenu`): its handle names
    /// no menu after (`minis`: `other-gone`).
    pub fn take_out_menu_item(
        &mut self,
        handle: u16,
        key: u16,
        flags: u16,
        destroy: bool,
    ) -> Result<bool, Stop> {
        let Some(menu) = self.menu_of(handle) else {
            return Ok(false);
        };
        let Some((found, position)) = self.find_menu_item(menu, key, flags)? else {
            return Ok(false);
        };
        let item = self.menus[found].items.remove(position);

        if destroy && let Some(popup) = item.popup {
            let handle = self.menus[popup].handle;

            if handle != 0 {
                self.handles.free(handle);
            }
        }

        Ok(true)
    }

    /// `ChangeMenu`, the menu call of Windows 2, which the others replaced:
    /// one of them, as its flags say. **Read out** of `USER.EXE` (seg9
    /// `01a8`) and **recorded** by `minis2`:
    ///
    /// * No menu is a failure. No text makes the item a separator; a
    ///   separator for command nought, changing nothing, is appended.
    /// * `MF_REMOVE` removes by place, whatever the flags say: the command
    ///   given is taken as a position. `MF_DELETE` deletes, `MF_CHANGE`
    ///   modifies with the flags masked by 4C7Fh, and `MF_APPEND` appends;
    ///   anything else inserts before `cmd`.
    pub fn change_menu(
        &mut self,
        handle: u16,
        cmd: u16,
        text: &ItemText,
        insert: u16,
        flags: u16,
    ) -> Result<bool, Stop> {
        let mut flags = flags;

        if handle == 0 {
            return Ok(false);
        }

        if flags & MF_SEPARATOR != 0 && cmd == 0 && flags & MF_CHANGE == 0 {
            flags |= MF_APPEND;
        }

        if *text == ItemText::Null {
            flags |= MF_SEPARATOR;
        }

        if flags & MF_REMOVE != 0 {
            return self.take_out_menu_item(
                handle,
                cmd,
                (flags & !MF_REMOVE) | MF_BYPOSITION,
                false,
            );
        }

        if flags & MF_DELETE != 0 {
            return self.take_out_menu_item(handle, cmd, flags & !MF_DELETE, true);
        }

        if flags & MF_CHANGE != 0 {
            return self.modify_menu(handle, cmd, flags & 0x4c7f, insert, text);
        }

        if flags & MF_APPEND != 0 {
            return Ok(self.append_menu(handle, flags & !MF_APPEND, insert, text));
        }

        self.insert_menu(handle, cmd, flags, insert, text)
    }

    /// A menu read from a template in memory (`LoadMenuIndirect`): its
    /// handle, nought for a null pointer.
    pub fn load_menu_template(&mut self, far: u32) -> Result<u16, Stop> {
        if far == 0 {
            return Ok(0);
        }

        let length = (0x10000 - (far & 0xffff)).min(0x4000) as usize;

        // The TypeScript engine reads the header's second word whatever the
        // length, and throws where the segment's end leaves no room for it.
        if length < 4 {
            return Err(Stop::Unsupported(
                "a menu template too near its segment's end for its header",
            ));
        }

        let data = self.read_far(far, length);
        let menu = self.parse_menu(&data);

        Ok(self.menu_handle(menu))
    }

    /// `GetMenuState`: an item's flags -- a separator's with `MF_DISABLED`
    /// as well; a pop-up's low byte with the count of its items in the high
    /// byte; -1 for no such item (`minis`).
    pub fn menu_state(&self, handle: u16, key: u16, flags: u16) -> Result<u16, Stop> {
        let Some(menu) = self.menu_of(handle) else {
            return Ok(0xffff);
        };
        let Some((found, position)) = self.find_menu_item(menu, key, flags)? else {
            return Ok(0xffff);
        };
        let item = &self.menus[found].items[position];

        Ok(match item.popup {
            Some(popup) => ((self.menus[popup].items.len() as u16) << 8) | (item.flags & 0xff),
            None if item.flags & MF_SEPARATOR != 0 => item.flags | MF_DISABLED,
            None => item.flags,
        })
    }
}

fn word(answer: bool) -> Result<Answer, Stop> {
    Ok(Answer::Word(u16::from(answer)))
}

/// `CreateMenu` and `CreatePopupMenu`: an empty menu, to be filled with
/// `AppendMenu`. A menu is a menu: which kind it is shows only in where it
/// goes.
fn create_menu(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let menu = system.new_menu();

    Ok(Answer::Word(system.menu_handle(menu)))
}

/// `DestroyMenu`: a menu's handle let go; it is no menu's after
/// (`queries`: `IsMenu` of it is nought). Its pop-ups are documented as
/// destroyed with it, which is not recorded, and are left.
fn destroy_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    if system.menu_of(handle).is_none() {
        return word(false);
    }

    system.handles.free(handle);
    word(true)
}

/// `AppendMenu`: an item put at the end of a menu.
fn append_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let flags = args.word(system);
    let id = args.word(system);
    let far = args.dword(system);
    let Some(text) = system.item_text(far) else {
        return word(false);
    };

    word(system.append_menu(handle, flags, id, &text))
}

/// `InsertMenu`: an item put before another.
fn insert_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let at = args.word(system);
    let flags = args.word(system);
    let id = args.word(system);
    let far = args.dword(system);
    let Some(text) = system.item_text(far) else {
        return word(false);
    };

    word(system.insert_menu(handle, at, flags, id, &text)?)
}

/// `ModifyMenu`: an item made anew where it is.
fn modify_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let at = args.word(system);
    let flags = args.word(system);
    let id = args.word(system);
    let far = args.dword(system);
    let Some(text) = system.item_text(far) else {
        return word(false);
    };

    word(system.modify_menu(handle, at, flags, id, &text)?)
}

/// `ChangeMenu`: one of the calls above, as its flags say.
fn change_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let cmd = args.word(system);
    let far = args.dword(system);
    let insert = args.word(system);
    let flags = args.word(system);
    let Some(text) = system.item_text(far) else {
        return word(false);
    };

    word(system.change_menu(handle, cmd, &text, insert, flags)?)
}

/// `RemoveMenu`: an item taken out of a menu, by command in the menu or any
/// it opens, or by position; a pop-up's menu is kept, to be used again
/// (`minis`: `popup-kept`).
fn remove_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let flags = args.word(system);

    word(system.take_out_menu_item(handle, key, flags, false)?)
}

/// `DeleteMenu`: as `RemoveMenu`, and a pop-up's menu is destroyed.
fn delete_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let flags = args.word(system);

    word(system.take_out_menu_item(handle, key, flags, true)?)
}

/// `GetMenuItemCount`: how many items a menu has, or -1 for no menu
/// (`minis`).
fn get_menu_item_count(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(
        system
            .menu_of(handle)
            .map_or(0xffff, |menu| system.menus[menu].items.len() as u16),
    ))
}

/// `GetMenuItemID`: the command identifier of the item at a position: 0
/// for a separator, and -1 for a pop-up or a position past the end
/// (`minis`).
fn get_menu_item_id(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let position = args.word(system);
    let item = system
        .menu_of(handle)
        .and_then(|menu| system.menus[menu].items.get(usize::from(position)));

    Ok(Answer::Word(match item {
        None => 0xffff,
        Some(item) if item.popup.is_some() => 0xffff,
        Some(item) if item.flags & MF_SEPARATOR != 0 => 0,
        Some(item) => item.id,
    }))
}

/// `GetSubMenu`: the pop-up the item at a position opens, given a handle
/// if it has none yet; nought if it opens none.
fn get_sub_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let position = args.signed(system);
    let popup = system
        .menu_of(handle)
        .zip(usize::try_from(position).ok())
        .and_then(|(menu, position)| system.menus[menu].items.get(position))
        .and_then(|item| item.popup);

    Ok(Answer::Word(
        popup.map_or(0, |popup| system.menu_handle_of(popup)),
    ))
}

/// `CheckMenuItem`: an item checked or not; whether it was before,
/// `MF_CHECKED` or 0, or -1 for no such item.
fn check_menu_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let check = args.word(system);

    changed(system, handle, key, check, MF_CHECKED)
}

/// `EnableMenuItem`: an item enabled, disabled or grayed; its state before,
/// `MF_GRAYED`, `MF_DISABLED` or 0, or -1 for no such item.
fn enable_menu_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let enable = args.word(system);

    changed(system, handle, key, enable, MF_GRAYED | MF_DISABLED)
}

/// The flags of `mask` set on an item as `flags` has them: what they were.
fn changed(
    system: &mut System,
    handle: u16,
    key: u16,
    flags: u16,
    mask: u16,
) -> Result<Answer, Stop> {
    let Some(menu) = system.menu_of(handle) else {
        return Ok(Answer::Word(0xffff));
    };
    let Some((found, position)) = system.find_menu_item(menu, key, flags)? else {
        return Ok(Answer::Word(0xffff));
    };
    let item = &mut system.menus[found].items[position];
    let was = item.flags & mask;

    item.flags = (item.flags & !mask) | (flags & mask);
    Ok(Answer::Word(was))
}

/// `GetMenuState`: an item's flags.
fn get_menu_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let flags = args.word(system);

    Ok(Answer::Word(system.menu_state(handle, key, flags)?))
}

/// `GetMenuString`: an item's text, `&` and all, into a buffer of
/// `nMaxCount` bytes, cut to fit with its nought; the count copied. The
/// buffer is emptied first, so a separator or an item there is not leaves
/// it empty and answers 0 (`minis`).
fn get_menu_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let flags = args.word(system);

    if buffer == 0 || size <= 0 {
        return Ok(Answer::Word(0));
    }

    let found = match system.menu_of(handle) {
        Some(menu) => system.find_menu_item(menu, key, flags)?,
        None => None,
    };
    let text: Vec<u8> = found
        .and_then(|(menu, position)| system.menus[menu].items[position].text.as_ref())
        .map(|text| text.chars().map(|c| c as u8).collect())
        .unwrap_or_default();
    let count = system.copy_text(&text, buffer, size as usize);

    Ok(Answer::Word(count as u16))
}

/// `HiliteMenuItem`: an item of a window's menu bar lit or put out;
/// `GetMenuState` has `MF_HILITE`, 80h, while it is lit (`userwin`).
/// Answers TRUE. The TypeScript engine paints the window's frame again
/// after; no window is drawn here yet.
fn hilite_menu_item(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let handle = args.word(system);
    let key = args.word(system);
    let hilite = args.word(system);
    let Some(menu) = system.menu_of(handle) else {
        return word(false);
    };
    let Some((found, position)) = system.find_menu_item(menu, key, hilite & MF_BYPOSITION)? else {
        return word(false);
    };
    let item = &mut system.menus[found].items[position];

    item.flags = (item.flags & !MF_HILITE) | (hilite & MF_HILITE);

    // The window's frame drawn again.
    if let Some(index) = system.window_named(hwnd) {
        system.paint_frame(index);
    }

    word(true)
}

/// `LoadMenuIndirect`: a menu from a template in memory, laid out as a
/// menu resource is: as much of the segment as there is from the template,
/// up to 16 KiB, read as `LoadMenu` reads a resource (`userwin`).
fn load_menu_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    Ok(Answer::Word(system.load_menu_template(far)?))
}

/// `IsMenu`: whether a handle is a menu's -- not a window's, and not one
/// destroyed (`queries`).
fn is_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    word(handle != 0 && system.menu_of(handle).is_some())
}

/// `GetMenuCheckMarkDimensions`: the size of a menu's check mark, the
/// display driver's `OBM_CHECK`, the height in the high word: 14 by 14 on
/// the VGA (`userwin`), and 14 by 14 too where the driver has not been read
/// or has no such bitmap.
fn get_menu_check_mark_dimensions(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.raster();

    let (width, height) = system
        .driver
        .as_ref()
        .and_then(|driver| driver.bitmap_sizes.get(&OBM_CHECK).copied())
        .unwrap_or((CHECK_SIZE, CHECK_SIZE));

    Ok(Answer::Dword(u32::from(width) | u32::from(height) << 16))
}

/// `SetMenuItemBitmaps`: the bitmaps an item shows unchecked and checked,
/// in place of the check mark; neither, the check mark again (`menubmp`).
/// Answers TRUE (`userwin`).
fn set_menu_item_bitmaps(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let key = args.word(system);
    let flags = args.word(system);
    let unchecked = args.word(system);
    let checked = args.word(system);
    let Some(menu) = system.menu_of(handle) else {
        return word(false);
    };
    let Some((found, position)) = system.find_menu_item(menu, key, flags & MF_BYPOSITION)? else {
        return word(false);
    };

    system.menus[found].items[position].bitmaps = Some((unchecked, checked));
    word(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(text: &str) -> ItemText {
        ItemText::Text(text.as_bytes().to_vec())
    }

    fn new_menu(system: &mut System) -> u16 {
        let menu = system.new_menu();

        system.menu_handle(menu)
    }

    fn count(system: &System, handle: u16) -> i32 {
        system
            .menu_of(handle)
            .map_or(-1, |menu| system.menus[menu].items.len() as i32)
    }

    /// `minis`'s menu: a command, a separator, a pop-up of two commands and
    /// a command; and another pop-up of one.
    fn minis(system: &mut System) -> (u16, u16, u16) {
        let menu = new_menu(system);
        let popup = new_menu(system);
        let other = new_menu(system);

        system.append_menu(popup, 0, 20, &text("&Inner"));
        system.append_menu(popup, MF_CHECKED, 21, &text("Second"));
        system.append_menu(menu, 0, 10, &text("&First"));
        system.append_menu(menu, MF_SEPARATOR, 0, &ItemText::Null);
        system.append_menu(menu, MF_POPUP, popup, &text("&Pop"));
        system.append_menu(menu, MF_GRAYED, 11, &text("Last"));
        system.append_menu(other, 0, 30, &text("Other"));
        (menu, popup, other)
    }

    fn string(system: &System, handle: u16, key: u16, flags: u16) -> Option<String> {
        let menu = system.menu_of(handle)?;
        let (found, position) = system.find_menu_item(menu, key, flags).ok()??;

        system.menus[found].items[position].text.clone()
    }

    #[test]
    fn answers_as_minis_recorded() {
        let mut system = System::new();
        let (menu, popup, other) = minis(&mut system);

        assert_eq!(count(&system, menu), 4);
        assert_eq!(count(&system, popup), 2);
        assert_eq!(system.menu_state(menu, 0, MF_BYPOSITION), Ok(0));
        assert_eq!(system.menu_state(menu, 1, MF_BYPOSITION), Ok(2050));
        assert_eq!(system.menu_state(menu, 2, MF_BYPOSITION), Ok(528));
        assert_eq!(system.menu_state(menu, 3, MF_BYPOSITION), Ok(1));
        assert_eq!(system.menu_state(menu, 21, 0), Ok(8));
        assert_eq!(system.menu_state(menu, 99, 0), Ok(0xffff));
        assert_eq!(
            string(&system, menu, 0, MF_BYPOSITION).as_deref(),
            Some("&First")
        );
        assert_eq!(string(&system, menu, 1, MF_BYPOSITION), None);
        assert_eq!(string(&system, menu, 20, 0).as_deref(), Some("&Inner"));

        assert_eq!(system.take_out_menu_item(menu, 20, 0, true), Ok(true));
        assert_eq!(count(&system, popup), 1);
        assert_eq!(system.take_out_menu_item(menu, 99, 0, true), Ok(false));
        assert_eq!(
            system.take_out_menu_item(menu, 2, MF_BYPOSITION, false),
            Ok(true)
        );
        assert_eq!(count(&system, menu), 3);
        assert_eq!(count(&system, popup), 1);
        system.append_menu(menu, MF_POPUP, other, &text("Other"));
        assert_eq!(
            system.take_out_menu_item(menu, 3, MF_BYPOSITION, true),
            Ok(true)
        );
        assert_eq!(count(&system, menu), 3);
        assert_eq!(count(&system, other), -1);
        assert_eq!(
            system.take_out_menu_item(menu, 9, MF_BYPOSITION, false),
            Ok(false)
        );
        assert_eq!(system.menus[system.menu_of(menu).unwrap()].items[2].id, 11);
    }

    /// The items of a menu as `minis2` writes them: each one's text and
    /// command.
    fn listed(system: &System, handle: u16) -> String {
        system.menus[system.menu_of(handle).unwrap()]
            .items
            .iter()
            .map(|item| format!("{}={}", item.text.clone().unwrap_or_default(), item.id))
            .collect::<Vec<_>>()
            .join(",")
    }

    #[test]
    fn changes_as_minis2_recorded() {
        let mut system = System::new();
        let menu = new_menu(&mut system);

        assert_eq!(
            system.change_menu(menu, 0, &text("One"), 101, MF_APPEND),
            Ok(true)
        );
        assert_eq!(
            system.change_menu(menu, 0, &text("Two"), 102, MF_APPEND),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "One=101,Two=102");
        assert_eq!(
            system.change_menu(menu, 101, &text("Zero"), 100, 0),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "Zero=100,One=101,Two=102");
        assert_eq!(
            system.change_menu(menu, 102, &text("Deux"), 202, MF_CHANGE),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "Zero=100,One=101,Deux=202");
        assert_eq!(
            system.change_menu(menu, 1, &ItemText::Null, 0, MF_DELETE | MF_BYPOSITION),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "Zero=100,Deux=202");
        // `MF_REMOVE` takes the command as a position: there is no 202nd.
        assert_eq!(
            system.change_menu(menu, 202, &ItemText::Null, 0, MF_REMOVE),
            Ok(false)
        );
        assert_eq!(
            system.change_menu(menu, 999, &ItemText::Null, 0, MF_DELETE),
            Ok(false)
        );
        assert_eq!(listed(&system, menu), "Zero=100,Deux=202");
        assert_eq!(
            system.change_menu(0, 0, &text("x"), 1, MF_APPEND),
            Ok(false)
        );
    }

    #[test]
    fn inserts_at_a_position_or_before_a_command() {
        let mut system = System::new();
        let menu = new_menu(&mut system);
        let popup = new_menu(&mut system);

        system.append_menu(popup, 0, 7, &text("Seven"));
        system.append_menu(menu, MF_POPUP, popup, &text("Pop"));
        assert_eq!(
            system.insert_menu(menu, 0xffff, MF_BYPOSITION, 1, &text("End")),
            Ok(true)
        );
        assert_eq!(
            system.insert_menu(menu, 50, MF_BYPOSITION, 2, &text("Past")),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "Pop=0,End=1,Past=2");
        assert_eq!(system.insert_menu(menu, 7, 0, 6, &text("Six")), Ok(true));
        assert_eq!(listed(&system, popup), "Six=6,Seven=7");
        assert_eq!(system.insert_menu(menu, 99, 0, 6, &text("No")), Ok(false));
        assert_eq!(
            system.modify_menu(menu, 3, MF_BYPOSITION, 4, &text("No")),
            Ok(false)
        );
        // A number for text is kept as its digits.
        assert_eq!(
            system.modify_menu(menu, 1, MF_BYPOSITION, 4, &ItemText::Number(12)),
            Ok(true)
        );
        assert_eq!(listed(&system, menu), "Pop=0,12=4,Past=2");
    }

    #[test]
    fn reads_text_as_the_argument_check_does() {
        let mut system = System::new();

        system.cpu.protected = true;

        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 32, 0)
            .unwrap();
        let far = u32::from(winbox_machine::segment_selector(index)) << 16;

        system.write_far(far, b"&Open\0");
        assert_eq!(system.item_text(0), Some(ItemText::Null));
        assert_eq!(
            system.item_text(0x0000_1234),
            Some(ItemText::Number(0x1234))
        );
        assert_eq!(system.item_text(far), Some(text("&Open")));
        // A selector no descriptor stands for turns the call away.
        assert_eq!(system.item_text(0xfff7_0000), None);
    }

    #[test]
    fn a_menu_that_opens_itself_stops() {
        let mut system = System::new();
        let menu = new_menu(&mut system);

        system.append_menu(menu, MF_POPUP, menu, &text("Me"));
        assert!(system.menu_state(menu, 5, 0).is_err());
    }

    #[test]
    fn reads_a_template_as_a_resource() {
        let mut system = System::new();
        // A header, `&File` opening a pop-up of `&Open` and `E&xit`.
        let mut data = vec![0, 0, 0, 0];

        data.extend_from_slice(&[0x90, 0]);
        data.extend_from_slice(b"&File\0");
        data.extend_from_slice(&[0, 0, 1, 0]);
        data.extend_from_slice(b"&Open\0");
        data.extend_from_slice(&[0x80, 0, 2, 0]);
        data.extend_from_slice(b"E&xit\0");

        let menu = system.parse_menu(&data);
        let handle = system.menu_handle(menu);

        assert_eq!(count(&system, handle), 1);
        assert_eq!(system.menu_state(handle, 0, MF_BYPOSITION), Ok(0x210));
        assert_eq!(string(&system, handle, 2, 0).as_deref(), Some("E&xit"));
    }

    #[test]
    fn measures_the_drivers_check_mark() {
        let mut system = System::new();
        let mut args = Args::repeat(0);

        assert_eq!(
            get_menu_check_mark_dimensions(&mut system, &mut args),
            Ok(Answer::Dword(0x000e_000e))
        );

        let mut driver = crate::icons::DriverResources::default();

        driver.bitmap_sizes.insert(OBM_CHECK, (16, 15));
        system.driver = Some(driver);
        assert_eq!(
            get_menu_check_mark_dimensions(&mut system, &mut args),
            Ok(Answer::Dword(0x000f_0010))
        );

        // A driver read without the bitmap: the VGA's again.
        system.driver = Some(crate::icons::DriverResources::default());
        assert_eq!(
            get_menu_check_mark_dimensions(&mut system, &mut args),
            Ok(Answer::Dword(0x000e_000e))
        );
    }

    #[test]
    fn reads_a_string_argument_on_past_its_segment_to_a_thousand_bytes() {
        let mut system = System::new();

        system.cpu.protected = true;

        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 32, 0)
            .unwrap();
        let selector = u32::from(winbox_machine::segment_selector(index)) << 16;
        let base = system.linear(selector);

        // At FFFEh the string goes on at 10000h, not back at nought.
        system.cpu.bus.write8(base, b'X');
        system.cpu.bus.write8(base + 1, 0);
        system.cpu.bus.write8(base + 0xfffe, b'A');
        system.cpu.bus.write8(base + 0xffff, b'B');
        system.cpu.bus.write8(base + 0x10000, b'C');
        system.cpu.bus.write8(base + 0x10001, 0);
        assert_eq!(system.argument_string(selector | 0xfffe), b"ABC");

        // A thousand bytes and no more.
        for at in 2..1200 {
            system.cpu.bus.write8(base + at, b'x');
        }

        assert_eq!(system.argument_string(selector | 2).len(), 1000);
    }

    #[test]
    fn a_template_at_its_segments_end_stops() {
        let mut system = System::new();

        assert_eq!(system.load_menu_template(0), Ok(0));
        assert!(system.load_menu_template(0x1000_fffd).is_err());
        assert!(system.load_menu_template(0x1000_fffc).is_ok());
    }
}
