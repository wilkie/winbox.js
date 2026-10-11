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
const WM_INITMENU: u16 = 0x0116;
const WM_INITMENUPOPUP: u16 = 0x0117;
const WS_CHILD: u32 = 0x4000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WM_CHAR: u16 = 0x0102;
const WM_SYSCHAR: u16 = 0x0106;
const VK_SHIFT: usize = 0x10;
const VK_CONTROL: usize = 0x11;
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

/// A key message that is one of a table's accelerators, sent on as the
/// command, as `USER.EXE` sends it (seg19 `0792`): the first entry for the
/// key, and the answer TRUE whatever becomes of it. Where the window -- not
/// a child -- has a menu with the command, the window is told first, as a
/// menu about to be used is: `WM_INITMENU` with the menu, and where the
/// command is in a pop-up, `WM_INITMENUPOPUP` with the pop-up of the bar
/// it is under and its place there (`06d2`). The item is looked at after
/// that, as the window has left it -- Paintbrush enables Paste only as its
/// Edit pop-up is told -- and grayed or disabled, or under a grayed pop-up,
/// or the window disabled or minimized, nothing is sent (`08f5`). Else
/// `WM_COMMAND` with 1 in the high word of `lParam`, straight to the
/// window's procedure; a command no menu has is sent whatever the window
/// is. **Recorded** by `accinit`. A command in the window's system menu,
/// which Windows sends as `WM_SYSCOMMAND` (`08c2`), is not looked for.
pub fn translate_accelerator(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let found = {
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

            let alt = message == WM_SYSKEYDOWN || message == WM_SYSCHAR;
            let down = |key: usize| system.user_state.key_states[key] & 0x80 != 0;
            let entry = system.accelerators[table].iter().copied().find(|entry| {
                if (entry.flags & FVIRTKEY != 0) != virtual_key || entry.key != wparam {
                    return false;
                }

                if virtual_key {
                    (entry.flags & FSHIFT != 0) == down(VK_SHIFT)
                        && (entry.flags & FCONTROL != 0) == down(VK_CONTROL)
                        && (entry.flags & FALT != 0) == alt
                } else {
                    (entry.flags & FALT != 0) == alt
                }
            });
            let Some(entry) = entry else {
                return Ok(Answer::Word(0));
            };
            let menu = system
                .window_named(hwnd)
                .and_then(|index| system.windows[index].as_ref())
                .filter(|window| window.style & WS_CHILD == 0)
                .map_or(0, |window| window.menu);
            let bar = match system.handles.resolve(menu) {
                Some(Object::Menu(bar)) => Some(bar),
                _ => None,
            };
            let place = match bar {
                Some(bar) => system
                    .find_menu_item(bar, entry.command, 0)?
                    .map(|(found, _)| (bar, top_place(&system, bar, found))),
                None => None,
            };

            (hwnd, entry.command, menu, place)
        };
        let (hwnd, command, menu, place) = found;
        let mut send = true;

        if let Some((bar, top)) = place {
            engine
                .send_message(hwnd, WM_INITMENU, menu, &mut Param::Value(0))
                .await?;

            // The bar as the window has left it, still the menu it was.
            let popup = top.and_then(|(position, popup)| {
                let mut system = engine.system();
                let still = matches!(
                    system.handles.resolve(menu),
                    Some(Object::Menu(found)) if found == bar
                );

                still.then(|| (position, system.menu_handle_of(popup)))
            });

            if let Some((position, popup)) = popup {
                engine
                    .send_message(
                        hwnd,
                        WM_INITMENUPOPUP,
                        popup,
                        &mut Param::Value(position as u32),
                    )
                    .await?;
            }

            // As the window left the menu: gone, the command is sent as
            // one no menu has (`0716`).
            let system = engine.system();

            if matches!(system.handles.resolve(menu), Some(Object::Menu(found)) if found == bar) {
                let under = top.is_some_and(|(position, _)| {
                    system.menus[bar].items[position].flags & (MF_GRAYED | MF_DISABLED) != 0
                });
                let item = system.find_menu_item(bar, command, 0)?;
                let grayed = item.is_some_and(|(found, position)| {
                    system.menus[found].items[position].flags & (MF_GRAYED | MF_DISABLED) != 0
                });
                let held = system
                    .window_named(hwnd)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| {
                        window.style & WS_DISABLED != 0 || window.placement == Placement::Minimized
                    });

                send = item.is_none() || !(grayed || under || held);
            }
        }

        if send {
            engine
                .send_message(hwnd, WM_COMMAND, command, &mut Param::Value(1 << 16))
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
