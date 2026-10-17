//! COMMDLG's calls into USER, GDI and KERNEL made as COMMDLG makes them:
//! the arguments pushed on the program's stack below where it is, each
//! structure given as a far pointer to bytes laid out there too, and the
//! export's own function run on them -- the very one a program's call
//! reaches. What COMMDLG's code does is then followed call for call.

use winbox_cpu::{SP, SS};

use crate::call::{Args, Implementation, Stop};
use crate::engine::Engine;
use crate::system::System;

/// An argument as COMMDLG pushes it.
#[derive(Debug, Clone, Copy)]
pub(crate) enum A {
    /// A word.
    W(u16),
    /// A doubleword or far pointer.
    D(u32),
    /// A far pointer to one of the call's structures, by its index.
    S(usize),
}

/// A call to make: the export, its arguments and the structures they point
/// to, which are read back after.
pub(crate) struct Call<'s> {
    pub module: &'static str,
    pub name: &'static str,
    pub args: &'s [A],
    pub structs: Vec<Vec<u8>>,
}

/// An export of USER's, GDI's or KERNEL's called with plain arguments: its
/// answer, DX:AX, nought for none.
pub(crate) async fn api(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[A],
) -> Result<u32, Stop> {
    Ok(call(
        engine,
        Call {
            module,
            name,
            args,
            structs: Vec::new(),
        },
    )
    .await?
    .0)
}

/// A call with structures: its answer and each structure as it was left.
pub(crate) async fn call(engine: &Engine, call: Call<'_>) -> Result<(u32, Vec<Vec<u8>>), Stop> {
    let implementation =
        crate::call::implementation(call.module, call.name).ok_or(Stop::Missing {
            module: call.module,
            name: call.name,
        })?;
    let (arguments, saved, placed) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let base = system.cpu.segments[SS].base;
        let selector = system.cpu.segments[SS].selector;
        let mut at = saved;
        let mut placed = Vec::new();

        // The structures first, each on a word's boundary.
        for bytes in &call.structs {
            at = at.wrapping_sub((bytes.len() as u16 + 1) & !1);
            system.write_far(u32::from(selector) << 16 | u32::from(at), bytes);
            placed.push(at);
        }

        let words: Vec<u16> = call
            .args
            .iter()
            .flat_map(|arg| match *arg {
                A::W(word) => vec![word],
                A::D(long) => vec![(long >> 16) as u16, long as u16],
                A::S(index) => vec![selector, placed[index]],
            })
            .collect();
        let top = at;

        for word in &words {
            at = at.wrapping_sub(2);
            system.cpu.bus.write16(base + u32::from(at), *word);
        }

        // Below them, a return address.
        system.cpu.regs[SP] = at.wrapping_sub(4);

        (
            Args::after_first(
                words.first().copied().unwrap_or(0),
                base,
                u32::from(top) - 2,
            ),
            saved,
            placed,
        )
    };
    let answer = match implementation {
        Implementation::Sync(answer) => answer(&mut engine.system(), &mut { arguments }),
        Implementation::Async(answer) => answer(engine, arguments).await,
    };
    let mut system = engine.system();
    let selector = system.cpu.segments[SS].selector;
    let structs = call
        .structs
        .iter()
        .zip(&placed)
        .map(|(bytes, &at)| system.read_far(u32::from(selector) << 16 | u32::from(at), bytes.len()))
        .collect();

    system.cpu.regs[SP] = saved;
    Ok((answer?.value().unwrap_or(0), structs))
}

/// A rectangle as the four words of a `RECT`.
pub(crate) fn rect_bytes(rect: [i16; 4]) -> Vec<u8> {
    rect.iter().flat_map(|side| side.to_le_bytes()).collect()
}

/// The four words of a `RECT`.
pub(crate) fn rect_of(bytes: &[u8]) -> [i16; 4] {
    std::array::from_fn(|at| i16::from_le_bytes([bytes[at * 2], bytes[at * 2 + 1]]))
}

// What the Find, Replace and Color dialogs ask of COMMDLG's own.

/// COMMDLG's extended error set.
pub(crate) fn set_extended_error(system: &mut System, code: u32) {
    super::set_error(system, code);
}

/// One of COMMDLG's strings, by its resource number: those its Find,
/// Replace and Color dialogs load.
pub(crate) fn string(id: u16) -> Option<Vec<u8>> {
    match id {
        0x40d => Some(b"Close".to_vec()),
        _ => None,
    }
}

/// A registered message by its name, registered now if it is not yet.
pub(crate) fn registered_message(engine: &Engine, name: &str) -> u16 {
    super::message(&mut engine.system(), name)
}

/// The far address of one of COMMDLG's exports, WinBox's own.
pub(crate) fn export_address(engine: &Engine, ordinal: u16) -> u32 {
    super::proc_address(&mut engine.system(), ordinal)
}

/// COMMDLG's instance.
pub(crate) fn instance(engine: &Engine) -> u16 {
    super::instance(&engine.system())
}

/// A hook called as COMMDLG calls one: `words` the window, the message,
/// `wParam` and `lParam`'s high and low words.
pub(crate) async fn call_hook(engine: &Engine, hook: u32, words: &[u16; 5]) -> Result<u16, Stop> {
    let lparam = u32::from(words[3]) << 16 | u32::from(words[4]);

    super::call_hook(engine, hook, words[0], words[1], words[2], lparam).await
}

/// The hourglass, or the arrow.
pub(crate) fn wait_cursor(engine: &Engine, busy: bool) {
    super::wait_cursor(&mut engine.system(), busy);
}

/// A number for a dialog's data, put under its property A000h where
/// COMMDLG puts the handle of its local memory: never nought.
pub(crate) fn next_number(engine: &Engine) -> u16 {
    let mut system = engine.system();
    let state = &mut system.commdlg;

    state.next = state.next.wrapping_add(1).max(1);
    state.next
}

/// A window's text set from bytes of COMMDLG's own.
pub(crate) async fn set_window_text(engine: &Engine, hwnd: u16, text: &[u8]) -> Result<(), Stop> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    call(
        engine,
        Call {
            module: "USER",
            name: "SetWindowText",
            args: &[A::W(hwnd), A::S(0)],
            structs: vec![bytes],
        },
    )
    .await?;
    Ok(())
}

/// One of COMMDLG's templates put in global memory, as its resource is
/// loaded: the handle.
pub(crate) async fn own_template(engine: &Engine, hex: &str) -> Result<u16, Stop> {
    let bytes = super::templates::bytes(hex);
    let handle = api(
        engine,
        "KERNEL",
        "GlobalAlloc",
        &[A::W(0x0002), A::D(bytes.len() as u32)],
    )
    .await? as u16;

    if handle == 0 {
        return Ok(0);
    }

    let far = api(engine, "KERNEL", "GlobalLock", &[A::W(handle)]).await?;

    engine.system().write_far(far, &bytes);
    api(engine, "KERNEL", "GlobalUnlock", &[A::W(handle)]).await?;
    Ok(handle)
}

/// A template of COMMDLG's let go.
pub(crate) async fn free_template(engine: &Engine, handle: u16) -> Result<(), Stop> {
    api(engine, "KERNEL", "GlobalFree", &[A::W(handle)]).await?;
    Ok(())
}
