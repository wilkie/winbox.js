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

const RT_ACCELERATOR: u16 = 9;

const FVIRTKEY: u8 = 0x01;
const FSHIFT: u8 = 0x04;
const FCONTROL: u8 = 0x08;
const FALT: u8 = 0x10;
const LAST: u8 = 0x80;

const WM_COMMAND: u16 = 0x0111;
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
/// command: `WM_COMMAND` with 1 in the high word of `lParam`, straight to
/// the window's procedure. Not when the command is a grayed or disabled
/// item of the window's menu -- the key is then taken and nothing is sent.
/// (The `WM_INITMENU` Windows sends first, and the menu bar item it
/// flashes, are not done in the TypeScript engine either.)
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
                .map_or(0, |window| window.menu);
            let item = match system.handles.resolve(menu) {
                Some(Object::Menu(menu)) => system.find_menu_item(menu, entry.command, 0)?,
                _ => None,
            };
            let disabled = item.is_some_and(|(menu, position)| {
                system.menus[menu].items[position].flags & (MF_GRAYED | MF_DISABLED) != 0
            });

            (hwnd, entry.command, disabled)
        };
        let (hwnd, command, disabled) = found;

        if !disabled {
            engine
                .send_message(hwnd, WM_COMMAND, command, &mut Param::Value(1 << 16))
                .await?;
        }

        Ok(Answer::Word(1))
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
