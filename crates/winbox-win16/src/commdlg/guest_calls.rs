//! What the Find, Replace and Color dialogs ask of COMMDLG's own, and
//! their calls into USER, GDI and KERNEL in the shape they make them: each
//! made through `api.rs`, which calls an export as a program's call reaches
//! it, the arguments and structures laid below the stack.

use super::api::{Arg, api as call_api};
use crate::call::Stop;
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

/// A call with structures, through `api.rs`: its answer and each structure
/// as it was left.
pub(crate) async fn call(engine: &Engine, call: Call<'_>) -> Result<(u32, Vec<Vec<u8>>), Stop> {
    let mut order = Vec::new();
    let args: Vec<Arg> = call
        .args
        .iter()
        .map(|arg| match *arg {
            A::W(word) => Arg::W(word),
            A::D(long) => Arg::D(long),
            A::S(index) => {
                order.push(index);
                Arg::B(call.structs[index].clone())
            }
        })
        .collect();
    let called = call_api(engine, call.module, call.name, &args).await?;
    let mut structs = call.structs.clone();

    for (buffer, index) in called.buffers.into_iter().zip(order) {
        structs[index] = buffer;
    }

    Ok((called.value, structs))
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
    super::resources::string(id).map(|text| text.as_bytes().to_vec())
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
