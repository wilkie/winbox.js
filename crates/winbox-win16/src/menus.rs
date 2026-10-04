//! Menus, as data: their items, each a command or a pop-up of its own,
//! as USER keeps them, and a menu resource read into them (`LoadMenu`).

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

const MF_POPUP: u16 = 0x0010;
const MF_END: u16 = 0x0080;
const MF_SEPARATOR: u16 = 0x0800;

/// `RT_MENU`.
const RT_MENU: u16 = 4;

/// An item of a menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub flags: u16,
    pub id: u16,
    /// Its text, `&` and all; `None` for a separator.
    pub text: Option<String>,
    /// The menu it opens, by its index, if it is a pop-up.
    pub popup: Option<usize>,
    /// The bitmaps it shows unchecked and checked in place of the check
    /// mark, as `SetMenuItemBitmaps` gave them.
    pub bitmaps: Option<(u16, u16)>,
}

/// A menu: its items, and its handle once it has one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MenuData {
    pub items: Vec<MenuItem>,
    pub handle: u16,
}

impl System {
    /// A menu resource read into menus, as `parseMenu` reads one: after its
    /// header, each item's flags, its identifier unless it is a pop-up, and
    /// its text; `MF_END` closing the menu it ends. The top menu's index.
    pub fn parse_menu(&mut self, data: &[u8]) -> usize {
        let word = |at: usize| {
            u16::from_le_bytes([
                data.get(at).copied().unwrap_or(0),
                data.get(at + 1).copied().unwrap_or(0),
            ])
        };
        let root = self.new_menu();
        let mut stack = vec![root];
        let mut position = 4 + usize::from(word(2));

        while position + 3 < data.len() && !stack.is_empty() {
            let flags = word(position);
            let mut id = 0;

            position += 2;

            if flags & MF_POPUP == 0 {
                id = word(position);
                position += 2;
            }

            let mut text = String::new();

            while position < data.len() && data[position] != 0 {
                text.push(char::from(data[position]));
                position += 1;
            }

            position += 1;

            let menu = *stack.last().expect("a menu open");
            let popup = (flags & MF_POPUP != 0).then(|| self.new_menu());
            // A separator is written as an item with no text and no identifier.
            let separator = popup.is_none() && id == 0 && text.is_empty();

            self.menus[menu].items.push(MenuItem {
                flags: (flags & !MF_END) | if separator { MF_SEPARATOR } else { 0 },
                id,
                text: (!separator).then_some(text),
                popup,
                bitmaps: None,
            });

            if flags & MF_END != 0 {
                stack.pop();
            }

            if let Some(popup) = popup {
                stack.push(popup);
            }
        }

        root
    }

    /// A menu with no items and no handle yet: its index.
    pub(crate) fn new_menu(&mut self) -> usize {
        self.menus.push(MenuData::default());
        self.menus.len() - 1
    }

    /// A menu given its handle: USER's, a multiple of four.
    pub fn menu_handle(&mut self, menu: usize) -> u16 {
        let handle = self
            .handles
            .allocate(Kind::Window, Object::Menu(menu))
            .unwrap_or(0);

        self.menus[menu].handle = handle;
        handle
    }

    /// A module's menu resource by its name or number, loaded: its handle,
    /// nought for none.
    pub fn load_menu(&mut self, instance: u16, name: &MenuName) -> u16 {
        let Some(executable) = self.executable_of(instance) else {
            return 0;
        };
        let data = crate::resources::find_by(&executable, RT_MENU, name).map(<[u8]>::to_vec);
        let Some(data) = data else {
            return 0;
        };
        let menu = self.parse_menu(&data);

        self.menu_handle(menu)
    }
}

/// A menu or a resource named as a program names one: a number, or text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuName {
    Number(u16),
    Text(String),
}

impl MenuName {
    /// A far pointer to a name, as USER reads one: a segment of nought is a
    /// number; `None` for a null pointer.
    pub fn read(system: &System, far: u32) -> Option<Self> {
        match (far >> 16, far & 0xffff) {
            (0, 0) => None,
            (0, number) => Some(Self::Number(number as u16)),
            _ => Some(Self::Text(
                system
                    .read_string(far)
                    .iter()
                    .map(|&byte| char::from(byte))
                    .collect(),
            )),
        }
    }
}

/// `LoadMenu`: a module's menu resource as a menu, its handle.
pub fn load_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let far = args.dword(system);
    let Some(name) = MenuName::read(system, far) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(system.load_menu(instance, &name)))
}
