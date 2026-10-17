//! `COMMDLG`'s calls into KERNEL, USER and GDI, made as `COMMDLG.DLL` makes
//! them: each through the function that answers a program's call, its
//! arguments pushed below the stack, its structures and strings laid out
//! below them and read back after. So WinBox's `COMMDLG` asks USER for
//! what the file would have asked, and is answered the same.
//!
//! Not logged, and not charged to the clock, as a call of the program's
//! is: they are `COMMDLG`'s own.

use winbox_cpu::{SP, SS};

use crate::call::{Args, Implementation, Stop};
use crate::engine::Engine;

/// An argument as `COMMDLG` pushes it.
#[derive(Debug, Clone)]
pub(crate) enum Arg {
    /// A word.
    W(u16),
    /// A doubleword: a long, or a far pointer given as it is.
    D(u32),
    /// Bytes laid out below the stack, given as a far pointer to them: a
    /// string with its nought, or a structure.
    B(Vec<u8>),
}

/// A string as an argument: its bytes and a nought.
pub(crate) fn text(bytes: &[u8]) -> Arg {
    let mut copy = bytes.to_vec();

    copy.push(0);
    Arg::B(copy)
}

/// A buffer of `size` noughts as an argument, to be written to.
pub(crate) fn buffer(size: usize) -> Arg {
    Arg::B(vec![0; size])
}

/// What a call answered: DX:AX, nought for nothing; and each `Arg::B` as
/// the function left it, in order.
#[derive(Debug, Clone, Default)]
pub(crate) struct Called {
    pub value: u32,
    pub buffers: Vec<Vec<u8>>,
}

impl Called {
    /// AX.
    pub(crate) fn word(&self) -> u16 {
        self.value as u16
    }

    /// A buffer's string, up to its nought.
    pub(crate) fn string(&self, index: usize) -> Vec<u8> {
        let bytes = self.buffers.get(index).map_or(&[][..], |b| &b[..]);
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());

        bytes[..end].to_vec()
    }
}

/// An export of a module WinBox keeps, called as `COMMDLG` calls it.
pub(crate) async fn api(
    engine: &Engine,
    module: &str,
    name: &str,
    args: &[Arg],
) -> Result<Called, Stop> {
    let implementation =
        crate::call::implementation(module, name).ok_or(Stop::Unsupported("COMMDLG's call"))?;
    let (arguments, saved, places) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let base = system.cpu.segments[SS].base;
        let selector = system.cpu.segments[SS].selector;
        let mut at = saved;
        let mut places = Vec::new();
        let mut words = Vec::new();

        for arg in args {
            match arg {
                Arg::W(word) => words.push(*word),
                Arg::D(long) => {
                    words.push((long >> 16) as u16);
                    words.push(*long as u16);
                }
                Arg::B(bytes) => {
                    at = at.wrapping_sub((bytes.len() as u16 + 1) & !1);
                    system.write_far(u32::from(selector) << 16 | u32::from(at), bytes);
                    places.push((at, bytes.len()));
                    words.push(selector);
                    words.push(at);
                }
            }
        }

        let first = at.wrapping_sub(2);

        for word in &words {
            at = at.wrapping_sub(2);
            system.cpu.bus.write16(base + u32::from(at), *word);
        }

        // Below them, a return address.
        system.cpu.regs[SP] = at.wrapping_sub(4);

        (
            Args::after_first(words.first().copied().unwrap_or(0), base, u32::from(first)),
            saved,
            places,
        )
    };
    let answer = match implementation {
        Implementation::Sync(answer) => answer(&mut engine.system(), &mut { arguments }),
        Implementation::Async(answer) => answer(engine, arguments).await,
    };
    let mut system = engine.system();
    let selector = system.cpu.segments[SS].selector;
    let buffers = places
        .iter()
        .map(|&(at, length)| system.read_far(u32::from(selector) << 16 | u32::from(at), length))
        .collect();

    system.cpu.regs[SP] = saved;

    Ok(Called {
        value: answer?.value().unwrap_or(0),
        buffers,
    })
}

/// A call's answer, AX, where nothing else is wanted of it.
pub(crate) async fn word(
    engine: &Engine,
    module: &str,
    name: &str,
    args: &[Arg],
) -> Result<u16, Stop> {
    Ok(api(engine, module, name, args).await?.word())
}

/// `SendMessage` with a value for `lParam`: its answer.
pub(crate) async fn send(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    Ok(api(
        engine,
        "USER",
        "SendMessage",
        &[
            Arg::W(hwnd),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await?
    .value)
}

/// `SendDlgItemMessage` with a value for `lParam`: its answer.
pub(crate) async fn send_item(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    Ok(api(
        engine,
        "USER",
        "SendDlgItemMessage",
        &[
            Arg::W(dialog),
            Arg::W(id),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await?
    .value)
}

/// `SendDlgItemMessage` with a string, or a buffer, for `lParam`: its
/// answer and the bytes as they were left.
pub(crate) async fn send_item_bytes(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: Arg,
) -> Result<Called, Stop> {
    api(
        engine,
        "USER",
        "SendDlgItemMessage",
        &[
            Arg::W(dialog),
            Arg::W(id),
            Arg::W(message),
            Arg::W(wparam),
            lparam,
        ],
    )
    .await
}

/// `SendMessage` with a string, or a buffer, for `lParam`.
pub(crate) async fn send_bytes(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: Arg,
) -> Result<Called, Stop> {
    api(
        engine,
        "USER",
        "SendMessage",
        &[Arg::W(hwnd), Arg::W(message), Arg::W(wparam), lparam],
    )
    .await
}

/// `GetDlgItem`.
pub(crate) async fn item(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    word(engine, "USER", "GetDlgItem", &[Arg::W(dialog), Arg::W(id)]).await
}

/// `GetDlgItemText`, of at most `size` bytes with its nought.
pub(crate) async fn item_text(
    engine: &Engine,
    dialog: u16,
    id: u16,
    size: u16,
) -> Result<Vec<u8>, Stop> {
    Ok(api(
        engine,
        "USER",
        "GetDlgItemText",
        &[
            Arg::W(dialog),
            Arg::W(id),
            buffer(usize::from(size)),
            Arg::W(size),
        ],
    )
    .await?
    .string(0))
}

/// `SetDlgItemText`.
pub(crate) async fn set_item_text(
    engine: &Engine,
    dialog: u16,
    id: u16,
    value: &[u8],
) -> Result<(), Stop> {
    api(
        engine,
        "USER",
        "SetDlgItemText",
        &[Arg::W(dialog), Arg::W(id), text(value)],
    )
    .await?;
    Ok(())
}

/// `PostMessage`.
pub(crate) async fn post(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<(), Stop> {
    api(
        engine,
        "USER",
        "PostMessage",
        &[
            Arg::W(hwnd),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await?;
    Ok(())
}

/// A list box's or combo box's item's text, by `LB_GETTEXT` or
/// `CB_GETLBTEXT`.
pub(crate) async fn list_text(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    index: u16,
) -> Result<Vec<u8>, Stop> {
    Ok(
        send_item_bytes(engine, dialog, id, message, index, buffer(256))
            .await?
            .string(0),
    )
}
