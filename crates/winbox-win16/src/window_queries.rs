//! What a program asks of a window: its rectangles, its family, its
//! class's name, whether it is visible or enabled, its text, and its words
//! and longs -- and its class's -- as winbox.js answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::classes::WndProc;
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::{Param, WM_GETTEXT, WM_GETTEXTLENGTH, WM_SETTEXT};
use crate::system::System;
use crate::windows::Window;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WM_ENABLE: u16 = 0x000a;
const WM_CANCELMODE: u16 = 0x001f;

const GWL_WNDPROC: i16 = -4;
const GWW_HINSTANCE: i16 = -6;
const GWW_HWNDPARENT: i16 = -8;
const GWW_ID: i16 = -12;
const GWL_STYLE: i16 = -16;
const GWL_EXSTYLE: i16 = -20;

const GCL_MENUNAME: i16 = -8;
const GCW_HBRBACKGROUND: i16 = -10;
const GCW_HCURSOR: i16 = -12;
const GCW_HICON: i16 = -14;
const GCW_HMODULE: i16 = -16;
const GCW_CBWNDEXTRA: i16 = -18;
const GCW_CBCLSEXTRA: i16 = -20;
const GCL_WNDPROC: i16 = -24;
const GCW_STYLE: i16 = -26;

/// How far apart USER's procedures' thunks are.
const SLOT: u16 = 8;

/// What a handle names: the desktop, a window, or neither.
enum Named {
    Desktop,
    Window(usize),
    Nothing,
}

impl System {
    fn named(&self, hwnd: u16) -> Named {
        match self.handles.resolve(hwnd) {
            Some(Object::Desktop) => Named::Desktop,
            Some(Object::Window(index)) if self.windows[index].is_some() => Named::Window(index),
            _ => Named::Nothing,
        }
    }

    fn window(&self, index: usize) -> &Window {
        self.windows[index]
            .as_ref()
            .expect("a window not destroyed")
    }

    fn window_mut(&mut self, index: usize) -> &mut Window {
        self.windows[index]
            .as_mut()
            .expect("a window not destroyed")
    }

    /// A window's place and size, the desktop's the screen's.
    fn place_of(&self, hwnd: u16) -> Option<(i32, i32, i32, i32)> {
        match self.named(hwnd) {
            Named::Desktop => Some((
                0,
                0,
                i32::from(self.display.width),
                i32::from(self.display.height),
            )),
            Named::Window(index) => {
                let window = self.window(index);

                Some((window.left, window.top, window.width, window.height))
            }
            Named::Nothing => None,
        }
    }

    /// Where a window's client area is on the screen.
    fn client_origin(&self, hwnd: u16) -> Option<(i32, i32)> {
        match self.named(hwnd) {
            Named::Desktop => Some((0, 0)),
            Named::Window(index) => {
                let window = self.window(index);

                Some((
                    window.left + window.client.left,
                    window.top + window.client.top,
                ))
            }
            Named::Nothing => None,
        }
    }

    /// A procedure as the program gives one: USER's own, where it is one of
    /// USER's thunks' addresses, else the program's.
    pub fn proc_of(&self, far: u32) -> WndProc {
        if let Some(index) = self.proc_segment
            && far >> 16 == u32::from(segment_selector(index))
            && (far as u16).is_multiple_of(SLOT)
            && let Some(host) = self.proc_tokens.get(usize::from(far as u16 / SLOT))
        {
            return WndProc::Host(host.clone());
        }

        WndProc::Guest(far)
    }

    /// The windows at the top, front to back, but icons' titles.
    pub fn top_level(&self) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&index| {
                self.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none() && window.hwnd != 0)
            })
            .collect()
    }

    /// A window's siblings, front to back.
    fn siblings(&self, index: usize) -> Vec<usize> {
        let parent = self.window(index).parent;

        self.z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|other| other.parent == parent && other.hwnd != 0)
            })
            .collect()
    }

    /// A window's first child, front to back.
    fn first_child(&self, index: usize) -> u16 {
        self.z_order
            .iter()
            .filter_map(|&other| self.windows[other].as_ref())
            .find(|other| other.parent == Some(index) && other.hwnd != 0)
            .map_or(0, |child| child.hwnd)
    }
}

/// A rectangle written where a far pointer points, left, top, right and
/// bottom.
fn write_rect(system: &mut System, far: u32, [left, top, right, bottom]: [i32; 4]) {
    if far == 0 {
        return;
    }

    let bytes: Vec<u8> = [left, top, right, bottom]
        .iter()
        .flat_map(|&value| (value as i16).to_le_bytes())
        .collect();

    system.write_far(far, &bytes);
}

pub fn get_window_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);

    if let Some((left, top, width, height)) = system.place_of(hwnd) {
        write_rect(system, far, [left, top, left + width, top + height]);
    }

    Ok(Answer::Nothing)
}

/// A window's client area, from nought; not a window, nothing written.
pub fn get_client_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let size = match system.named(hwnd) {
        Named::Desktop => Some((
            i32::from(system.display.width),
            i32::from(system.display.height),
        )),
        Named::Window(index) => {
            let window = system.window(index);

            Some((window.client_width(), window.client_height()))
        }
        Named::Nothing => None,
    };

    if let Some((width, height)) = size {
        write_rect(system, far, [0, 0, width, height]);
    }

    Ok(Answer::Nothing)
}

fn move_point(system: &mut System, args: &mut Args, sign: i32) {
    let hwnd = args.word(system);
    let far = args.dword(system);

    let Some((x, y)) = system.client_origin(hwnd) else {
        return;
    };

    if far == 0 {
        return;
    }

    let bytes = system.read_far(far, 4);
    let px = i32::from(i16::from_le_bytes([bytes[0], bytes[1]])) + sign * x;
    let py = i32::from(i16::from_le_bytes([bytes[2], bytes[3]])) + sign * y;
    let mut out = (px as i16).to_le_bytes().to_vec();

    out.extend_from_slice(&(py as i16).to_le_bytes());
    system.write_far(far, &out);
}

pub fn client_to_screen(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    move_point(system, args, 1);
    Ok(Answer::Nothing)
}

pub fn screen_to_client(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    move_point(system, args, -1);
    Ok(Answer::Nothing)
}

/// USER's own classes' names as `GetClassName` and `FindWindow` show them.
fn shown_class(name: &str) -> String {
    match name.to_ascii_uppercase().as_str() {
        "BUTTON" => "Button".into(),
        "STATIC" => "Static".into(),
        "EDIT" => "Edit".into(),
        "LISTBOX" => "ListBox".into(),
        "SCROLLBAR" => "ScrollBar".into(),
        "COMBOBOX" => "ComboBox".into(),
        "COMBOLBOX" => "ComboLBox".into(),
        _ => name.to_string(),
    }
}

/// A window at the top by its class and its title, front to back (**read
/// out** of `USER.EXE` seg6 `0000`): a class by its name or its atom, a
/// title without regard to case.
pub fn find_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let class_far = args.dword(system);
    let title_far = args.dword(system);
    let text = |system: &System, far: u32| system.read_string(far);
    let (class_atom, wanted_class) = match (class_far >> 16, class_far & 0xffff) {
        (0, 0) => (None, None),
        (0, atom) => (Some(atom), None),
        _ => (None, Some(text(system, class_far).to_ascii_uppercase())),
    };
    let title = match (title_far >> 16, title_far & 0xffff) {
        (0, 0) => None,
        (0, number) => Some(number.to_string().into_bytes()),
        _ => Some(text(system, title_far)),
    };

    for index in system.top_level() {
        let window = system.window(index);
        let shown = shown_class(&window.class).to_ascii_uppercase();

        if wanted_class
            .as_ref()
            .is_some_and(|wanted| shown.as_bytes() != wanted.as_slice())
        {
            continue;
        }

        if class_atom.is_some_and(|atom| shown != format!("#{atom}")) {
            continue;
        }

        if let Some(title) = &title {
            let lower = |bytes: &[u8]| {
                bytes
                    .iter()
                    .map(|&byte| crate::profile::lower(byte))
                    .collect::<Vec<u8>>()
            };

            if lower(window.title.as_bytes()) != lower(title) {
                continue;
            }
        }

        return Ok(Answer::Word(window.hwnd));
    }

    Ok(Answer::Word(0))
}

const GW_HWNDFIRST: u16 = 0;
const GW_HWNDLAST: u16 = 1;
const GW_HWNDNEXT: u16 = 2;
const GW_HWNDPREV: u16 = 3;
const GW_OWNER: u16 = 4;
const GW_CHILD: u16 = 5;

fn related(system: &System, hwnd: u16, relation: u16) -> u16 {
    // The desktop's first child is the top window of the screen.
    if relation == GW_CHILD && matches!(system.named(hwnd), Named::Desktop) {
        return top_window(system, 0);
    }

    let Named::Window(index) = system.named(hwnd) else {
        return 0;
    };

    match relation {
        GW_CHILD => system.first_child(index),
        GW_OWNER => system
            .window(index)
            .owner
            .map_or(0, |owner| system.window(owner).hwnd),
        GW_HWNDFIRST | GW_HWNDLAST | GW_HWNDNEXT | GW_HWNDPREV => {
            let list = system.siblings(index);
            let at = list.iter().position(|&other| other == index);
            let pick = match relation {
                GW_HWNDFIRST => list.first().copied(),
                GW_HWNDLAST => list.last().copied(),
                GW_HWNDNEXT => at.and_then(|at| list.get(at + 1).copied()),
                _ => at.filter(|&at| at > 0).map(|at| list[at - 1]),
            };

            pick.map_or(0, |other| system.window(other).hwnd)
        }
        _ => 0,
    }
}

fn top_window(system: &System, hwnd: u16) -> u16 {
    if hwnd == 0 {
        return system
            .top_level()
            .first()
            .map_or(0, |&index| system.window(index).hwnd);
    }

    related(system, hwnd, GW_CHILD)
}

pub fn get_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let relation = args.word(system);

    Ok(Answer::Word(related(system, hwnd, relation)))
}

pub fn get_next_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let flag = args.word(system);

    Ok(Answer::Word(related(
        system,
        hwnd,
        if flag == GW_HWNDPREV {
            GW_HWNDPREV
        } else {
            GW_HWNDNEXT
        },
    )))
}

pub fn get_top_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    // With no window, the screen's: the raster desktop asked of.
    if hwnd == 0 {
        system.raster();
    }

    Ok(Answer::Word(top_window(system, hwnd)))
}

pub fn get_class_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let size = args.signed(system);
    let name = match system.named(hwnd) {
        Named::Window(index) => shown_class(&system.window(index).class),
        _ => String::new(),
    };

    Ok(Answer::Word(if size > 0 {
        system.copy_text(name.as_bytes(), far, size as usize) as u16
    } else {
        0
    }))
}

/// Whether a handle is a window's: the desktop's is not, here.
pub fn is_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(u16::from(
        hwnd != 0 && matches!(system.named(hwnd), Named::Window(_)),
    )))
}

/// Whether a window and each it is in is visible.
pub fn is_window_visible(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(match system.named(hwnd) {
        Named::Desktop => 1,
        Named::Nothing => 0,
        Named::Window(index) => {
            let mut at = Some(index);
            let mut visible = 1;

            while let Some(index) = at {
                let window = system.window(index);

                if !window.visible {
                    visible = 0;
                    break;
                }

                at = window.parent;
            }

            visible
        }
    }))
}

pub fn is_window_enabled(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(match system.named(hwnd) {
        Named::Desktop => 1,
        Named::Nothing => 0,
        Named::Window(index) => u16::from(system.window(index).style & WS_DISABLED == 0),
    }))
}

/// A window enabled or disabled, told `WM_ENABLE` where that changes it:
/// whether it was disabled.
pub fn enable_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, enable) = {
            let system = engine.system();

            (args.word(&system), args.word(&system) != 0)
        };

        Ok(Answer::Word(u16::from(
            engine.enable_window(hwnd, enable).await?,
        )))
    })
}

impl Engine {
    /// A window enabled or disabled, told so with `WM_ENABLE` if that
    /// changed it; whether it was disabled before (`USER.EXE` seg1
    /// `6f28`).
    ///
    /// A window disabled, whether or not it was already, is first sent
    /// `WM_CANCELMODE` (`6f63`), which `DefWindowProc` answers by letting
    /// the capture go if the window has it (`def_window.rs`). Then, if it
    /// has the focus, it loses it, with `WM_KILLFOCUS` naming no window, as
    /// `SetFocus(NULL)` takes it (`6f71`), before it is marked disabled: a
    /// button losing it so is let go and clicked if it was pushed
    /// (`btnkeys`, `space-disabled`). Any window, not only a control.
    ///
    /// **Recorded** by `btnmore`: a push button and a window of the
    /// probe's own class, each disabled with the focus, the capture, both
    /// and neither -- `WM_CANCELMODE`, `WM_KILLFOCUS` with the focus, then
    /// `WM_ENABLE`, and neither the focus nor the capture kept.
    pub async fn enable_window(&self, hwnd: u16, enable: bool) -> Result<bool, Stop> {
        let (index, was) = {
            let mut system = self.system();
            let Named::Window(index) = system.named(hwnd) else {
                return Ok(false);
            };

            (index, system.window_mut(index).style & WS_DISABLED != 0)
        };
        let changed = was == enable;

        if !enable {
            self.send_message(hwnd, WM_CANCELMODE, 0, &mut Param::Value(0))
                .await?;

            if self.system().focus == Some(index) {
                self.focus_nothing().await?;
            }
        }

        if changed && let Some(window) = self.system().windows[index].as_mut() {
            if enable {
                window.style &= !WS_DISABLED;
            } else {
                window.style |= WS_DISABLED;
            }
        }

        if changed {
            self.send_message(hwnd, WM_ENABLE, u16::from(enable), &mut Param::Value(0))
                .await?;
        }

        Ok(was)
    }
}

/// A child's parent; a pop-up's owner; nought for any other. A child with
/// no parent here is a child of the desktop window, as a combo box's list
/// is, and its parent is the desktop window (`comboact`).
pub fn get_parent(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let Named::Window(index) = system.named(hwnd) else {
        return Ok(Answer::Word(0));
    };
    let window = system.window(index);

    Ok(Answer::Word(match (window.parent, window.owner) {
        (Some(parent), _) => system.window(parent).hwnd,
        (None, _) if window.style & (WS_CHILD | WS_POPUP) == WS_CHILD => {
            system.handles.lookup(Object::Desktop).unwrap_or(0)
        }
        (None, Some(owner)) if window.style & WS_POPUP != 0 => system.window(owner).hwnd,
        _ => 0,
    }))
}

pub fn is_child(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let parent = args.word(system);
    let hwnd = args.word(system);
    let (Named::Window(index), Named::Window(parent)) = (system.named(hwnd), system.named(parent))
    else {
        return Ok(Answer::Word(0));
    };
    let mut at = system.window(index).parent;

    while let Some(above) = at {
        if above == parent {
            return Ok(Answer::Word(1));
        }

        at = system.window(above).parent;
    }

    Ok(Answer::Word(0))
}

/// The task a window is of; the desktop's, the first program's.
pub fn get_window_task(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    Ok(Answer::Word(match system.named(hwnd) {
        Named::Desktop => system.task_handle,
        Named::Window(index) => system.window(index).task,
        Named::Nothing => 0,
    }))
}

pub fn get_window_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };
        let answer = engine
            .send_message(hwnd, WM_GETTEXT, count, &mut Param::Value(far))
            .await?;

        Ok(Answer::Word(answer as u16))
    })
}

pub fn get_window_text_length(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());
        let answer = engine
            .send_message(hwnd, WM_GETTEXTLENGTH, 0, &mut Param::Value(0))
            .await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// A window's text set, as Windows sets it: `WM_SETTEXT` to the window.
pub fn set_window_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        if matches!(engine.system().named(hwnd), Named::Window(_)) {
            engine
                .send_message(hwnd, WM_SETTEXT, 0, &mut Param::Value(far))
                .await?;
        }

        Ok(Answer::Nothing)
    })
}

/// Bytes of an extra area read: nought past its end.
fn read_extra(bytes: &[u8], at: i16, size: usize) -> u32 {
    let Ok(at) = usize::try_from(at) else {
        return 0;
    };

    if at + size > bytes.len() {
        return 0;
    }

    bytes[at..at + size]
        .iter()
        .rev()
        .fold(0, |value, &byte| value << 8 | u32::from(byte))
}

/// Bytes of an extra area written: what they were, nought past its end.
fn write_extra(bytes: &mut [u8], at: i16, size: usize, value: u32) -> u32 {
    let previous = read_extra(bytes, at, size);
    let Ok(at) = usize::try_from(at) else {
        return 0;
    };

    if at + size > bytes.len() {
        return 0;
    }

    for (step, byte) in bytes[at..at + size].iter_mut().enumerate() {
        *byte = (value >> (8 * step)) as u8;
    }

    previous
}

pub fn get_window_word(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let Named::Window(index) = system.named(hwnd) else {
        return Ok(Answer::Word(0));
    };
    let window = system.window(index);
    let value = match offset {
        GWW_HINSTANCE => window.instance,
        GWW_HWNDPARENT => window
            .parent
            .or(window.owner)
            .map_or(0, |other| system.window(other).hwnd),
        GWW_ID => window.control_id,
        _ => read_extra(&window.extra, offset, 2) as u16,
    };

    Ok(Answer::Word(value))
}

pub fn set_window_word(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let value = args.word(system);
    let Named::Window(index) = system.named(hwnd) else {
        return Ok(Answer::Word(0));
    };
    let window = system.window_mut(index);
    let previous = match offset {
        GWW_ID => std::mem::replace(&mut window.control_id, value),
        GWW_HINSTANCE => std::mem::replace(&mut window.instance, value),
        _ => write_extra(&mut window.extra, offset, 2, u32::from(value)) as u16,
    };

    Ok(Answer::Word(previous))
}

pub(crate) fn window_long(system: &mut System, index: usize, offset: i16) -> u32 {
    match offset {
        GWL_WNDPROC => {
            let window = system.window(index);
            let proc = window.proc.clone().or_else(|| {
                system
                    .class_named(&window.class)
                    .map(|class| system.classes[class].proc.clone())
            });

            proc.map_or(0, |proc| system.proc_token(&proc))
        }
        GWL_STYLE => style_shown(system.window(index)),
        GWL_EXSTYLE => system.window(index).ex_style,
        _ => read_extra(&system.window(index).extra, offset, 4),
    }
}

/// A window's style as `GetWindowLong` reads it: `WS_VISIBLE` is whether
/// it is shown, which `ShowWindow` sets and clears. **Recorded** by
/// `comboact`: a combo box's list, made with `WS_VISIBLE` and hidden at
/// once, reads without it.
fn style_shown(window: &Window) -> u32 {
    if window.visible {
        window.style | WS_VISIBLE
    } else {
        window.style & !WS_VISIBLE
    }
}

pub fn get_window_long(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let Named::Window(index) = system.named(hwnd) else {
        return Ok(Answer::Dword(0));
    };

    Ok(Answer::Dword(window_long(system, index, offset)))
}

/// A window's long set: its procedure subclassed, its style, or its extra
/// bytes; what it was.
pub fn set_window_long(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let value = args.dword(system);
    let Named::Window(index) = system.named(hwnd) else {
        return Ok(Answer::Dword(0));
    };

    Ok(Answer::Dword(match offset {
        GWL_WNDPROC => {
            let previous = window_long(system, index, offset);
            let proc = system.proc_of(value);

            system.window_mut(index).proc = Some(proc);
            previous
        }
        GWL_STYLE => {
            let previous = style_shown(system.window(index));

            system.window_mut(index).style = value;
            previous
        }
        _ => write_extra(&mut system.window_mut(index).extra, offset, 4, value),
    }))
}

/// A window's class's field or extra bytes, read or written.
fn class_value(system: &mut System, hwnd: u16, offset: i16, size: usize, new: Option<u32>) -> u32 {
    let Named::Window(index) = system.named(hwnd) else {
        return 0;
    };
    let Some(class) = system.class_named(&system.window(index).class) else {
        return 0;
    };
    // Its extra bytes made, noughts, the first time they are asked for.
    {
        let class = &mut system.classes[class];

        if class.extra.is_empty() {
            class.extra = vec![0; usize::try_from(class.cls_extra).unwrap_or(0)];
        }
    }

    let current = {
        let index = class;
        let class = &system.classes[index];

        match offset {
            GCL_MENUNAME => match &class.menu_name {
                Some(crate::menus::MenuName::Number(number)) => u32::from(*number),
                _ => 0,
            },
            GCW_HBRBACKGROUND => u32::from(class.background),
            GCW_HCURSOR => u32::from(class.cursor),
            GCW_HICON => u32::from(class.icon),
            GCW_HMODULE => u32::from(class.instance),
            GCW_CBWNDEXTRA => u32::from(class.wnd_extra as u16),
            GCW_CBCLSEXTRA => u32::from(class.cls_extra as u16),
            GCL_WNDPROC => {
                let proc = class.proc.clone();

                system.proc_token(&proc)
            }
            GCW_STYLE => u32::from(class.style),
            _ => read_extra(&class.extra, offset, size),
        }
    };

    if let Some(value) = new {
        let proc = (offset == GCL_WNDPROC).then(|| system.proc_of(value));
        let class = &mut system.classes[class];

        match offset {
            GCL_MENUNAME => class.menu_name = Some(crate::menus::MenuName::Number(value as u16)),
            GCW_HBRBACKGROUND => class.background = value as u16,
            GCW_HCURSOR => class.cursor = value as u16,
            GCW_HICON => class.icon = value as u16,
            GCW_HMODULE => class.instance = value as u16,
            GCW_CBWNDEXTRA => class.wnd_extra = value as i16,
            GCW_CBCLSEXTRA => class.cls_extra = value as i16,
            GCL_WNDPROC => class.proc = proc.expect("the procedure"),
            GCW_STYLE => class.style = value as u16,
            _ => {
                write_extra(&mut class.extra, offset, size, value);
            }
        }
    }

    current
}

pub fn get_class_word(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);

    Ok(Answer::Word(
        class_value(system, hwnd, offset, 2, None) as u16
    ))
}

pub fn set_class_word(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let value = args.word(system);

    Ok(Answer::Word(
        class_value(system, hwnd, offset, 2, Some(u32::from(value))) as u16,
    ))
}

pub fn get_class_long(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);

    Ok(Answer::Dword(class_value(system, hwnd, offset, 4, None)))
}

pub fn set_class_long(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let offset = args.signed(system);
    let value = args.dword(system);

    Ok(Answer::Dword(class_value(
        system,
        hwnd,
        offset,
        4,
        Some(value),
    )))
}

/// A window procedure called with a message, as a subclass passes on what
/// it does not handle.
pub fn call_window_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (proc, hwnd, message, wparam, lparam) = {
            let system = engine.system();
            let far = args.dword(&system);

            (
                system.proc_of(far),
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        if proc == WndProc::Guest(0) {
            return Ok(Answer::Dword(0));
        }

        Ok(Answer::Dword(
            engine
                .call_proc(&proc, hwnd, message, wparam, &mut Param::Value(lparam))
                .await?,
        ))
    })
}

/// `DefWindowProc` called by a program, for what its procedure does not
/// handle.
pub fn def_window_proc(engine: &Engine, mut args: Args) -> Later<'_> {
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
                .def_window_proc(hwnd, message, wparam, &mut Param::Value(lparam))
                .await?,
        ))
    })
}
