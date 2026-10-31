//! `OLESVR`, OLE 1.0's server library, as WinBox's own: written from OLE
//! 1.0's documented interface and protocol and from the probe `olesrv`,
//! not from the code of `OLESVR.DLL` (`kb/topics/ole.md`). As
//! `src/win16/olesvr/`.
//!
//! Kept as `OLECLI` is (`own_modules.rs`): with `OLESVR.DLL` on the drive,
//! a program that imports it gets the file's library, and each import of
//! an export answered here is linked to WinBox's stub, as `GetProcAddress`
//! answers it; with none, WinBox's is found by its file's name. It is kept
//! only once a program loads it (`crate::kept::ON_LOAD`). What its file
//! does as it is loaded is done as a program first calls it
//! (`server::start`).

pub(crate) mod core;
pub(crate) mod server;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::system::{STEP, System};

use self::core::{R, SERVER_VERSION, Svr};

pub use self::core::State;

/// The module's name.
pub const NAME: &str = "OLESVR";

/// Its data segment's selector.
pub(crate) fn data_selector(system: &System) -> u16 {
    system.kept_named(NAME).map_or(0, |kept| {
        winbox_machine::segment_selector(system.kept[kept].data)
    })
}

/// Its instance, WinBox's module's: the classes it registers are its.
fn instance(system: &System) -> u16 {
    system
        .kept_named(NAME)
        .map_or(0, |kept| system.kept[kept].instance())
}

/// The far address of one of `OLESVR`'s exports: its stub.
pub(crate) fn export_address(engine: &Engine, ordinal: u16) -> u32 {
    let mut system = engine.system();
    let Some(kept) = system.kept_named(NAME) else {
        return 0;
    };
    let stubs = system.stubs(kept);

    u32::from(winbox_machine::segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

/// An export's arguments read, in order, as words (`w`) and doublewords
/// (`d`).
fn read(engine: &Engine, args: &mut Args, shape: &[u8]) -> Vec<u32> {
    let system = engine.system();

    shape
        .iter()
        .map(|kind| match kind {
            b'w' => u32::from(args.word(&system)),
            _ => args.dword(&system),
        })
        .collect()
}

/// What its file does as it loads, done as a program first calls it.
async fn ready(svr: &Svr<'_>) -> R<()> {
    let instance = instance(&svr.e.system());

    server::start(svr, instance).await
}

macro_rules! export {
    ($name:ident, $shape:literal, |$o:ident, $a:ident| $body:expr) => {
        fn $name(engine: &Engine, mut args: Args) -> Later<'_> {
            Box::pin(async move {
                let $a = read(engine, &mut args, $shape);
                let $o = Svr::new(engine);

                ready(&$o).await?;
                $body
            })
        }
    };
}

fn word(answer: R<u16>) -> Result<Answer, Stop> {
    Ok(Answer::Word(answer?))
}

fn dword(answer: R<u32>) -> Result<Answer, Stop> {
    Ok(Answer::Dword(answer?))
}

export!(ole_register_server, b"dddww", |o, a| word(
    server::register_server(&o, a[0], a[1], a[2], a[4] as u16).await
));
export!(ole_revoke_server, b"d", |o, a| word(
    server::revoke_server(&o, a[0]).await
));
export!(ole_block_server, b"d", |o, a| word(Ok(
    server::block_server(&o, a[0])
)));
export!(ole_unblock_server, b"dd", |o, a| word(
    server::unblock_server(&o, a[0], a[1]).await
));
export!(ole_register_server_doc, b"dddd", |o, a| word(
    server::register_server_doc(&o, a[0], a[1], a[2], a[3]).await
));
export!(ole_revoke_server_doc, b"d", |o, a| word(
    server::revoke_server_doc(&o, a[0]).await
));
export!(ole_rename_server_doc, b"dd", |o, a| word(
    server::rename_server_doc(&o, a[0], a[1]).await
));
export!(ole_revert_server_doc, b"d", |o, a| word(Ok(
    server::revert_server_doc(&o, a[0])
)));
export!(ole_saved_server_doc, b"d", |o, a| word(
    server::saved_server_doc(&o, a[0]).await
));
export!(ole_revoke_object, b"d", |o, a| word(
    server::revoke_object(&o, a[0]).await
));
export!(ole_query_server_version, b"", |_o, _a| dword(Ok(
    SERVER_VERSION
)));
export!(srvr_wnd_proc, b"wwwd", |o, a| dword(
    server::srvr_wnd_proc(&o, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(doc_wnd_proc, b"wwwd", |o, a| dword(
    server::doc_wnd_proc(&o, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(item_wnd_proc, b"wwwd", |o, a| dword(
    server::item_wnd_proc(&o, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(item_callback, b"dwd", |o, a| word(
    server::item_callback(&o, a[0], a[1] as u16).await
));

/// `WEP`: 1, as a library's is.
#[allow(clippy::unnecessary_wraps)]
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// The function that answers an export WinBox has made its own.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "OleRegisterServer" => Implementation::Async(ole_register_server),
        "OleRevokeServer" => Implementation::Async(ole_revoke_server),
        "OleBlockServer" => Implementation::Async(ole_block_server),
        "OleUnblockServer" => Implementation::Async(ole_unblock_server),
        "OleRegisterServerDoc" => Implementation::Async(ole_register_server_doc),
        "OleRevokeServerDoc" => Implementation::Async(ole_revoke_server_doc),
        "OleRenameServerDoc" => Implementation::Async(ole_rename_server_doc),
        "OleRevertServerDoc" => Implementation::Async(ole_revert_server_doc),
        "OleSavedServerDoc" => Implementation::Async(ole_saved_server_doc),
        "OleRevokeObject" => Implementation::Async(ole_revoke_object),
        "OleQueryServerVersion" => Implementation::Async(ole_query_server_version),
        "SRVRWNDPROC" => Implementation::Async(srvr_wnd_proc),
        "DOCWNDPROC" => Implementation::Async(doc_wnd_proc),
        "ITEMWNDPROC" => Implementation::Async(item_wnd_proc),
        "ITEMCALLBACK" => Implementation::Async(item_callback),
        _ => return None,
    })
}
