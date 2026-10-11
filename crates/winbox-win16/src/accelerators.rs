//! Accelerator tables: keys that stand for commands, as winbox.js's
//! `accelerators.ts` keeps them. A table is a resource of five-byte entries
//! -- a flag byte, the key and the command -- the last with bit 80h of its
//! flags set. With `FVIRTKEY` the key is a virtual key, pressed with the
//! shift keys the flags name; without it, a character, as `WM_CHAR` carries
//! it.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::{Kind, Object};
use crate::menus::MenuName;
use crate::messages::Param;
use crate::queue::{WM_KEYDOWN, WM_SYSKEYDOWN};
use crate::system::System;
use crate::windows::Placement;

const RT_ACCELERATOR: u16 = 9;

const FVIRTKEY: u8 = 0x01;
const FSHIFT: u8 = 0x04;
const FCONTROL: u8 = 0x08;
const FALT: u8 = 0x10;
const LAST: u8 = 0x80;

const WM_COMMAND: u16 = 0x0111;
const WM_SYSCOMMAND: u16 = 0x0112;
const WM_INITMENU: u16 = 0x0116;
const WM_INITMENUPOPUP: u16 = 0x0117;
const WS_CHILD: u32 = 0x4000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WM_CHAR: u16 = 0x0102;
const WM_SYSCHAR: u16 = 0x0106;
const VK_SHIFT: usize = 0x10;
const VK_CONTROL: usize = 0x11;
const VK_MENU: usize = 0x12;
const MF_GRAYED: u16 = 0x0001;
const MF_DISABLED: u16 = 0x0002;

/// One accelerator: its flags, its key and its command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Accelerator {
    pub flags: u8,
    pub key: u16,
    pub command: u16,
}

/// A table read from its resource, as far as its last entry.
pub fn parse_accelerators(data: &[u8]) -> Vec<Accelerator> {
    let mut entries = Vec::new();

    for entry in data.chunks_exact(5) {
        entries.push(Accelerator {
            flags: entry[0],
            key: u16::from_le_bytes([entry[1], entry[2]]),
            command: u16::from_le_bytes([entry[3], entry[4]]),
        });

        if entry[0] & LAST != 0 {
            break;
        }
    }

    entries
}

/// A module's accelerator table, by its name or number; nought where there
/// is none.
pub fn load_accelerators(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let far = args.dword(system);
    let Some(name) = MenuName::read(system, far) else {
        return Ok(Answer::Word(0));
    };
    let Some(executable) = system.executable_of(instance) else {
        return Ok(Answer::Word(0));
    };
    let Some(data) = crate::resources::find_by(&executable, RT_ACCELERATOR, &name) else {
        return Ok(Answer::Word(0));
    };
    let table = parse_accelerators(data);

    system.accelerators.push(table);

    let index = system.accelerators.len() - 1;

    Ok(Answer::Word(
        system
            .handles
            .allocate(Kind::Atom, Object::Accelerators(index))
            .unwrap_or(0),
    ))
}

/// Whether a menu has a command, the window told as a menu about to be used
/// is, as `USER.EXE` tells it (seg19 `06d2`): nought where the menu does not
/// have the command, else `WM_INITMENU` with the menu and, where the command
/// is under one of its pop-ups, `WM_INITMENUPOPUP` with that pop-up and its
/// place, nought in the high word even for the system menu (`accsys`). Then
/// the item is looked at as the window has left it: 3 where it or the
/// pop-up it is under is grayed or disabled, 2 where it is not, and nought
/// where the window destroyed the menu meanwhile (`0716`, `0750`).
async fn tell(engine: &Engine, hwnd: u16, handle: u16, command: u16) -> Result<u16, Stop> {
    let still = |engine: &Engine, menu: usize| matches!(engine.system().handles.resolve(handle), Some(Object::Menu(found)) if found == menu);
    let (menu, top) = {
        let system = engine.system();
        let Some(Object::Menu(menu)) = system.handles.resolve(handle) else {
            return Ok(0);
        };
        let Some((found, _)) = system.find_menu_item(menu, command, 0)? else {
            return Ok(0);
        };

        (menu, top_place(&system, menu, found))
    };

    engine
        .send_message(hwnd, WM_INITMENU, handle, &mut Param::Value(0))
        .await?;

    if !still(engine, menu) {
        return Ok(0);
    }

    if let Some((position, popup)) = top {
        let popup = engine.system().menu_handle_of(popup);

        engine
            .send_message(
                hwnd,
                WM_INITMENUPOPUP,
                popup,
                &mut Param::Value(position as u32),
            )
            .await?;

        if !still(engine, menu) {
            return Ok(0);
        }
    }

    let system = engine.system();
    let under = top.is_some_and(|(position, _)| {
        system.menus[menu]
            .items
            .get(position)
            .is_some_and(|item| item.flags & (MF_GRAYED | MF_DISABLED) != 0)
    });
    let grayed = system
        .find_menu_item(menu, command, 0)?
        .is_some_and(|(found, position)| {
            system.menus[found].items[position].flags & (MF_GRAYED | MF_DISABLED) != 0
        });

    Ok(if grayed || under { 3 } else { 2 })
}

/// A key message that is one of a table's accelerators, sent on as the
/// command, as `USER.EXE` sends it (seg19 `0792`). The first entry for the
/// key is taken -- a virtual key from `WM_KEYDOWN` or `WM_SYSKEYDOWN`, a
/// character from `WM_CHAR` or `WM_SYSCHAR`, with Shift and Control for a
/// virtual key and Alt for either as `GetKeyState` has them, not as the
/// message says (`0825`-`088c`; `accsys`) -- and the answer is TRUE
/// whatever becomes of it.
///
/// The window's menu bar, where it is not a child, is told first (see
/// `tell`); where the bar has not the command, the window's system menu
/// is: its own, or where it has none and `WS_SYSMENU`, the one every such
/// window shows, brought up to the window's state first (`08c2`-`08f0`,
/// seg9 `0d8b`). A command found grayed is not sent; nor one found while a
/// window has the mouse captured or this window is disabled, nor one of
/// the bar's while it is minimized (`08f5`-`0922`). Else it is sent
/// straight to the window's procedure, `WM_SYSCOMMAND` for the system
/// menu's and `WM_COMMAND` for any other, a command no menu has among
/// them, with 1 in the high word of `lParam` (`0939`). Nothing on the bar
/// is flashed. **Recorded** by `accinit` and `accsys`.
pub fn translate_accelerator(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, command) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let table = args.word(&system);
            let far = args.dword(&system);
            let Some(Object::Accelerators(table)) = system.handles.resolve(table) else {
                return Ok(Answer::Word(0));
            };
            let bytes = system.read_far(far, 6);
            let message = u16::from_le_bytes([bytes[2], bytes[3]]);
            let wparam = u16::from_le_bytes([bytes[4], bytes[5]]);
            let virtual_key = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            let character = message == WM_CHAR || message == WM_SYSCHAR;

            if !virtual_key && !character {
                return Ok(Answer::Word(0));
            }

            let down = |key: usize| system.user_state.key_states[key] & 0x80 != 0;
            let entry = system.accelerators[table].iter().copied().find(|entry| {
                if (entry.flags & FVIRTKEY != 0) != virtual_key || entry.key != wparam {
                    return false;
                }

                if virtual_key
                    && ((entry.flags & FSHIFT != 0) != down(VK_SHIFT)
                        || (entry.flags & FCONTROL != 0) != down(VK_CONTROL))
                {
                    return false;
                }

                (entry.flags & FALT != 0) == down(VK_MENU)
            });
            let Some(entry) = entry else {
                return Ok(Answer::Word(0));
            };

            (hwnd, entry.command)
        };
        let style = |engine: &Engine| {
            let system = engine.system();

            system
                .window_named(hwnd)
                .and_then(|index| system.windows[index].as_ref())
                .map(|window| (window.style, window.menu, window.placement))
        };
        let mut told = 0;
        let mut from_system_menu = false;

        if command != 0 {
            if let Some((window_style, menu, _)) = style(engine)
                && window_style & WS_CHILD == 0
            {
                told = tell(engine, hwnd, menu, command).await?;
            }

            if told == 0 {
                let holder = {
                    let mut system = engine.system();

                    match system.window_named(hwnd) {
                        Some(index) if system.own_system_menu(index).is_some() => {
                            let holder = system.system_menu_holder(index);

                            Some(system.menu_handle_of(holder))
                        }
                        Some(index)
                            if system.windows[index]
                                .as_ref()
                                .is_some_and(|window| window.style & WS_SYSMENU != 0) =>
                        {
                            system.system_menu_brought_up(index)?;

                            let holder = system.system_menu_holder(index);

                            Some(system.menu_handle_of(holder))
                        }
                        _ => None,
                    }
                };

                if let Some(holder) = holder {
                    told = tell(engine, hwnd, holder, command).await?;
                    from_system_menu = told != 0;
                }
            }
        }

        let captured = engine.system().capture.is_some();
        let held = told == 3
            || (told != 0
                && (captured
                    || style(engine).is_some_and(|(window_style, _, placement)| {
                        window_style & WS_DISABLED != 0
                            || (!from_system_menu && placement == Placement::Minimized)
                    })));

        if !held {
            let message = if from_system_menu {
                WM_SYSCOMMAND
            } else {
                WM_COMMAND
            };

            engine
                .send_message(hwnd, message, command, &mut Param::Value(1 << 16))
                .await?;
        }

        Ok(Answer::Word(1))
    })
}

/// The place in the bar of the pop-up a command found in `found` is under,
/// and that pop-up; none where the command is the bar's own (seg19 `05ee`:
/// the bar's items from the last, each pop-up searched through).
fn top_place(system: &System, bar: usize, found: usize) -> Option<(usize, usize)> {
    fn holds(system: &System, menu: usize, found: usize, depth: usize) -> bool {
        menu == found
            || (depth <= system.menus.len()
                && system.menus[menu]
                    .items
                    .iter()
                    .filter_map(|item| item.popup)
                    .any(|popup| holds(system, popup, found, depth + 1)))
    }

    if found == bar {
        return None;
    }

    system.menus[bar]
        .items
        .iter()
        .enumerate()
        .rev()
        .find_map(|(position, item)| {
            item.popup
                .filter(|&popup| holds(system, popup, found, 0))
                .map(|popup| (position, popup))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_table_to_its_last_entry() {
        let data = [
            0x01,
            0x70,
            0x00,
            0x65,
            0x00, // F1, virtual: 101
            0x80 | 0x18,
            0x41,
            0x00,
            0x66,
            0x00, // last
            0x01,
            0x71,
            0x00,
            0x67,
            0x00, // past the last
        ];
        let table = parse_accelerators(&data);

        assert_eq!(table.len(), 2);
        assert_eq!(
            table[1],
            Accelerator {
                flags: 0x98,
                key: 0x41,
                command: 0x66
            }
        );
    }
}
