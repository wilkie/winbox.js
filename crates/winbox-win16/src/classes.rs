//! Window classes: a program's, registered from its `WNDCLASS`, and USER's
//! own -- the controls, the dialog's, its hidden windows' -- made the first
//! time they are asked for. A class's procedure is the program's, a far
//! pointer, or USER's, which a program is handed as the address of a thunk
//! that calls back to the engine (`INT 84h`).

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::menus::MenuName;
use crate::system::System;

/// A window procedure of USER's own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostProc {
    /// The procedure of one of USER's own classes -- its hidden windows',
    /// an icon's title's -- which answers as `DefWindowProc` does: one for
    /// each class, by its name, as the TypeScript engine makes each a
    /// function of its own, and so a thunk of its own (`starmerc` asks).
    DefWindow(String),
    Dialog,
    /// A control's, by its class, upper case.
    Control(String),
    /// The MDI client's (`mdi.rs`).
    MdiClient,
}

/// A window procedure: a program's, by its far pointer, or USER's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WndProc {
    Guest(u32),
    Host(HostProc),
}

/// A window class.
#[derive(Debug, Clone)]
pub struct WindowClass {
    pub style: u16,
    pub proc: WndProc,
    pub cls_extra: i16,
    pub wnd_extra: i16,
    pub instance: u16,
    pub icon: u16,
    pub cursor: u16,
    pub background: u16,
    pub menu_name: Option<MenuName>,
    pub name: String,
    /// The class's menu, loaded as it was registered: its handle.
    pub menu: u16,
    /// Its extra bytes, as many as it asks for, noughts to begin with.
    pub extra: Vec<u8>,
}

impl WindowClass {
    /// A class of USER's own: the style USER registers it with, and no
    /// background or extra bytes but where it says.
    fn own(name: &str, proc: HostProc) -> Self {
        Self {
            style: own_style(name),
            proc: WndProc::Host(proc),
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
        }
    }
}

/// USER's own controls' classes.
pub const CONTROL_CLASSES: [&str; 7] = [
    "BUTTON",
    "STATIC",
    "EDIT",
    "LISTBOX",
    "SCROLLBAR",
    "COMBOBOX",
    "COMBOLBOX",
];

/// The dialog's class.
pub const DIALOG_CLASS: &str = "#32770";

/// The style each of USER's own classes is registered with, **read out** of
/// `USER.EXE`, whose seg3 fills a `WNDCLASS` for each and registers it:
/// `Button` at `15fa`, `Static` `165b`, `#32770` `1547`, `Edit` `16bc`,
/// `ListBox` `171d`, `ScrollBar` `177e`, `ComboLBox` `1809` and `ComboBox`
/// `186a`. What `GetClassInfo` answers of them agrees, as `classinf`
/// recorded it. Each but `Static` has `CS_DBLCLKS`, so a second press on a
/// list box comes to it as `WM_LBUTTONDBLCLK` (`mouse_scan.rs`).
const OWN_STYLES: [(&str, u16); 8] = [
    ("BUTTON", 0x8b),
    ("EDIT", 0x88),
    ("STATIC", 0x80),
    ("LISTBOX", 0x88),
    ("SCROLLBAR", 0x8b),
    ("COMBOBOX", 0x88),
    ("COMBOLBOX", 0x808),
    (DIALOG_CLASS, 0x2808),
];

/// The style USER registers one of its own classes with.
fn own_style(name: &str) -> u16 {
    OWN_STYLES
        .iter()
        .find(|(own, _)| own.eq_ignore_ascii_case(name))
        .map_or(0, |&(_, style)| style)
}

/// What `GetClassInfo` answers of USER's classes: their style, their
/// windows' extra bytes, and their cursor.
const USER_CLASSES: [(&str, u16, i16, u16); 7] = [
    ("BUTTON", 0x8b, 3, 32512),
    ("EDIT", 0x88, 6, 32513),
    ("STATIC", 0x80, 6, 32512),
    ("LISTBOX", 0x88, 2, 32512),
    ("SCROLLBAR", 0x8b, 10, 32512),
    ("COMBOBOX", 0x88, 2, 32512),
    (DIALOG_CLASS, 0x2808, 30, 32512),
];

/// How far apart USER's procedures' thunks are.
const SLOT: u16 = 8;

impl System {
    /// A class registered: its atom, from the atoms' range, under its name.
    pub fn register_class(&mut self, class: WindowClass) -> u16 {
        let name = class.name.clone();
        let index = self.classes.len();

        self.classes.push(class);

        let handle = self
            .handles
            .allocate(Kind::Atom, Object::Class(index))
            .unwrap_or(0);

        if handle != 0 {
            self.handles.register(handle, &name);
        }

        handle
    }

    /// The class registered under a name.
    pub fn class_named(&self, name: &str) -> Option<usize> {
        match self.handles.resolve(self.handles.retrieve(name)?)? {
            Object::Class(index) => Some(index),
            _ => None,
        }
    }

    /// A control's class, registered the first time it is asked for.
    pub fn system_class(&mut self, name: &str) -> Option<usize> {
        let kind = name.to_ascii_uppercase();

        if !CONTROL_CLASSES.contains(&kind.as_str()) {
            return None;
        }

        if let Some(found) = self.class_named(&kind) {
            return Some(found);
        }

        self.register_class(WindowClass::own(&kind, HostProc::Control(kind.clone())));
        self.class_named(&kind)
    }

    /// The dialog's class: its windows' 30 extra bytes, its background the
    /// window colour.
    pub fn dialog_class(&mut self) -> usize {
        if let Some(found) = self.class_named(DIALOG_CLASS) {
            return found;
        }

        let mut class = WindowClass::own(DIALOG_CLASS, HostProc::Dialog);

        class.wnd_extra = 30;
        class.background = 5 + 1;
        self.register_class(class);
        self.class_named(DIALOG_CLASS).expect("the dialog's class")
    }

    /// A procedure as a program is handed it: its own as it is, USER's as
    /// its thunk's address, `MOV AX, n; INT 84h; RETF 10`, in a segment of
    /// them made the first time.
    pub fn proc_token(&mut self, proc: &WndProc) -> u32 {
        let host = match proc {
            WndProc::Guest(far) => return *far,
            WndProc::Host(host) => host.clone(),
        };

        if self.proc_segment.is_none() {
            let index = self
                .descriptors
                .find(1, 1)
                .expect("a descriptor for USER's thunks");

            self.descriptors
                .map(&mut self.cpu.bus, index, &vec![0; 0x10000], true);
            self.proc_segment = Some(index);
        }

        let index = self.proc_segment.expect("USER's thunks");
        let at = if let Some(at) = self.proc_tokens.iter().position(|token| *token == host) {
            at
        } else {
            {
                self.proc_tokens.push(host);

                let at = self.proc_tokens.len() - 1;
                let [low, high] = (at as u16).to_le_bytes();

                self.cpu.bus.write(
                    ((index as u32) << 16) + u32::from(at as u16 * SLOT),
                    &[0xb8, low, high, 0xcd, 0x84, 0xca, 0x0a, 0x00],
                );
                at
            }
        };

        u32::from(segment_selector(index)) << 16 | u32::from(at as u16 * SLOT)
    }

    /// The class atom `GetClassInfo` answers: 8002h for the dialog's; else
    /// one from C100h, in the order they are first asked for.
    fn class_atom(&mut self, name: &str) -> u16 {
        if name == DIALOG_CLASS {
            return 0x8002;
        }

        let count = self.class_atoms.len();

        *self
            .class_atoms
            .entry(name.to_string())
            .or_insert(0xc000 + count as u16 + 0x100)
    }

    /// Text copied into a block of its own: a far pointer to it.
    pub fn string_block(&mut self, text: &str) -> u32 {
        let Some(index) = self.global.allocate(
            &mut self.cpu.bus,
            &mut self.descriptors,
            text.len() as u32 + 1,
            0x42,
        ) else {
            return 0;
        };
        let mut bytes = text.as_bytes().to_vec();

        bytes.push(0);
        self.cpu.bus.write((index as u32) << 16, &bytes);
        u32::from(segment_selector(index)) << 16
    }
}

/// A `WNDCLASS` read, as USER's structure reader reads one: a null string
/// leaves its field nought, a segment of nought is a number.
fn read_wndclass(system: &System, far: u32) -> WindowClass {
    let bytes = system.read_far(far, 26);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let long = |at: usize| u32::from(word(at)) | u32::from(word(at + 2)) << 16;
    let name = match MenuName::read(system, long(22)) {
        Some(MenuName::Text(text)) => text,
        Some(MenuName::Number(number)) => number.to_string(),
        None => String::new(),
    };

    WindowClass {
        style: word(0),
        proc: WndProc::Guest(long(2)),
        cls_extra: word(6) as i16,
        wnd_extra: word(8) as i16,
        instance: word(10),
        icon: word(12),
        cursor: word(14),
        background: word(16),
        menu_name: MenuName::read(system, long(18)),
        name,
        menu: 0,
        extra: Vec::new(),
    }
}

/// A class registered, its menu loaded where it names one: its atom.
pub fn register_class(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let mut class = read_wndclass(system, far);

    // A name of no text is no menu.
    if let Some(name) = class
        .menu_name
        .clone()
        .filter(|name| *name != MenuName::Text(String::new()))
    {
        class.menu = system.load_menu(class.instance, &name);
    }

    Ok(Answer::Word(system.register_class(class)))
}

/// A class of the instance's let go, if no window of it is left.
pub fn unregister_class(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let instance = args.word(system);

    // A class named by its atom is not looked for.
    let Some(MenuName::Text(name)) = MenuName::read(system, far) else {
        return Ok(Answer::Word(0));
    };
    let Some(handle) = system.handles.retrieve(&name) else {
        return Ok(Answer::Word(0));
    };
    let Some(Object::Class(index)) = system.handles.resolve(handle) else {
        return Ok(Answer::Word(0));
    };
    let class = &system.classes[index];

    if class.instance == 0 || class.instance != instance {
        return Ok(Answer::Word(0));
    }

    if system.windows.iter().any(|window| {
        window
            .as_ref()
            .is_some_and(|window| window.class.eq_ignore_ascii_case(&name))
    }) {
        return Ok(Answer::Word(0));
    }

    system.handles.free(handle);
    Ok(Answer::Word(1))
}

/// What a class is, as its `WNDCLASS` has it, written out -- USER's own
/// classes with no instance, a program's with its instance -- and its
/// atom; nought for none.
pub fn get_class_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let given = args.dword(system);
    let out = args.dword(system);
    let Some(asked) = MenuName::read(system, given).filter(|_| out != 0) else {
        return Ok(Answer::Word(0));
    };
    let name = match &asked {
        MenuName::Number(0x8002) => DIALOG_CLASS.to_string(),
        MenuName::Number(number) => format!("#{number}"),
        MenuName::Text(text) => text.to_ascii_uppercase(),
    };
    let fields: [u32; 9] = if instance == 0 {
        let Some(&(_, style, extra, cursor)) = USER_CLASSES.iter().find(|(own, ..)| *own == name)
        else {
            return Ok(Answer::Word(0));
        };
        let class = if name == DIALOG_CLASS {
            Some(system.dialog_class())
        } else {
            system.system_class(&name)
        };
        // The class made, its cursor loaded, then its procedure's address.
        let cursor = crate::icons::standard_cursor_handle(system, cursor);
        let proc = class.map(|class| system.classes[class].proc.clone());
        let proc = proc.map_or(0, |proc| system.proc_token(&proc));
        let user = system
            .kept_named("USER")
            .map_or(1, |user| system.kept[user].instance());

        [
            u32::from(style),
            proc,
            0,
            u32::from(extra as u16),
            u32::from(user),
            0,
            u32::from(cursor),
            0,
            0,
        ]
    } else {
        let Some(index) = system.class_named(&name) else {
            return Ok(Answer::Word(0));
        };
        let class = system.classes[index].clone();

        if class.instance == 0 || class.instance != instance {
            return Ok(Answer::Word(0));
        }

        let menu = match &class.menu_name {
            Some(MenuName::Number(number)) => u32::from(*number),
            Some(MenuName::Text(text)) if !text.is_empty() => system.string_block(text),
            _ => 0,
        };

        [
            u32::from(class.style),
            system.proc_token(&class.proc),
            u32::from(class.cls_extra as u16),
            u32::from(class.wnd_extra as u16),
            u32::from(class.instance),
            u32::from(class.icon),
            u32::from(class.cursor),
            u32::from(class.background),
            menu,
        ]
    };
    let mut bytes = Vec::with_capacity(26);
    let mut word = |value: u32| bytes.extend_from_slice(&(value as u16).to_le_bytes());

    word(fields[0]);
    word(fields[1]);
    word(fields[1] >> 16);

    for field in &fields[2..8] {
        word(*field);
    }

    word(fields[8]);
    word(fields[8] >> 16);
    word(given);
    word(given >> 16);
    system.write_far(out, &bytes);

    Ok(Answer::Word(system.class_atom(&name)))
}
