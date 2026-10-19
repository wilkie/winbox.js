//! `DDEML`, the DDE Management Library, as WinBox's own: every routine of
//! `DDEML.DLL` followed as it is read out (`kb/ddeml`,
//! `kb/topics/ddeml-transactions.md`, `kb/topics/dynamic-data-exchange.md`).
//! As `src/win16/ddeml/`.
//!
//! DDEML keeps everything a program could find in guest memory, where
//! `DDEML.DLL` keeps it: its own data -- the instances, the classes'
//! names, its default context, its time-outs -- in WinBox's data segment
//! for the module, laid out as the file's is and given a local heap as the
//! file's entry gives one; each instance's handles, conversations, links
//! and queued callbacks in a heap of 4 KB of its own; the queues of posts
//! and asynchronous transactions each in a heap of theirs; the data in
//! `GMEM_DDESHARE` blocks. Its windows are USER's, of DDEML's six classes,
//! whose procedures are its own exports; its string handles are USER's
//! global atoms; its time-outs USER's timers. Every call into KERNEL,
//! USER, GDI and KEYBOARD is made as the file makes it (`core.rs`), so the
//! atoms counted, the windows made and the messages sent and posted are
//! the file's, in its order.
//!
//! It is kept as `COMMDLG`, `VER` and `LZEXPAND` are (`own_modules.rs`):
//! with `DDEML.DLL` on the drive, a program that imports it gets the
//! file's library, each import of an export linked to WinBox's stub; with
//! none, WinBox's stubs throughout. Its dialog, `TermDialog`, is WinBox's
//! own data (`resources.rs`).

pub(crate) mod conv;
pub(crate) mod core;
pub(crate) mod data;
pub(crate) mod instance;
pub(crate) mod monitor;
pub mod resources;
pub(crate) mod xact;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::system::{STEP, System};

use self::core::{Dd, R, far};

/// The module's name, and its file's.
pub const NAME: &str = "DDEML";

// DDEML's data, as `DDEML.DLL`'s data segment lays it out (seg3).

/// DDEML's instance (`LibMain`'s `hInstance`).
pub(crate) const D_HINSTANCE: u16 = 0x16;
/// The data segment's own heap's handle, set by the first `DdeInitialize`.
pub(crate) const D_HEAP: u16 = 0x18;
/// The first instance.
pub(crate) const D_INSTANCES: u16 = 0x1a;
/// DDEML's arrays of the application's blocks and of transactions sent
/// and no longer waited for.
pub(crate) const D_ARRAY_OWNED: u16 = 0x1c;
pub(crate) const D_ARRAY_SENT: u16 = 0x20;
/// The serial that numbers instances, conversations and lists.
pub(crate) const D_SERIAL: u16 = 0x24;
/// The default `CONVCONTEXT`: 16 bytes, code page `CP_WINANSI`.
pub(crate) const D_CONTEXT: u16 = 0x26;
/// An empty string, the windows' names.
pub(crate) const D_EMPTY: u16 = 0x36;
/// How many monitors.
pub(crate) const D_MONITORS: u16 = 0x38;
/// The hook before DDEML's.
pub(crate) const D_HOOK: u16 = 0x3a;
/// The classes' names.
pub(crate) const D_CLASS_FRAME: u16 = 0x3e;
pub(crate) const D_CLASS_DMG: u16 = 0x48;
pub(crate) const D_CLASS_CLIENT: u16 = 0x52;
pub(crate) const D_CLASS_SERVER: u16 = 0x62;
pub(crate) const D_CLASS_MONITOR: u16 = 0x72;
pub(crate) const D_CLASS_HOLDING: u16 = 0x82;
/// The atom `Progman` added by the first `DdeInitialize`.
pub(crate) const D_PROGMAN: u16 = 0xa4;
/// The profile's strings.
pub(crate) const D_TEXT_3000: u16 = 0xe6;
pub(crate) const D_TEXT_SHUTDOWN: u16 = 0xeb;
pub(crate) const D_TEXT_DDEML: u16 = 0xfb;
pub(crate) const D_TEXT_30000: u16 = 0x101;
pub(crate) const D_TEXT_RETRY: u16 = 0x107;
pub(crate) const D_TEXT_PROGMAN: u16 = 0x122;
/// `Who`, `Made me?` and the answer, kept scrambled with 25h until the first
/// `DdeInitialize`; then the first two's atoms in their first words.
pub(crate) const D_WHO: u16 = 0x13e;
pub(crate) const D_MADE_ME: u16 = 0x142;
pub(crate) const D_TEXT_STAAB: u16 = 0x14b;
/// The transaction parameters a conversation points to with none of its
/// own: a result of `FFFFFFFFh` far at 16Ah (its selector relocated at
/// 170h), and `wType` 1062h, `wFmt` 1.
pub(crate) const D_XPARAMS: u16 = 0x16e;
/// `ShutdownRetryTimeout` and `ShutdownTimeout`, doublewords, and the
/// profile's buffer.
pub(crate) const D_RETRY: u16 = 0x240;
pub(crate) const D_SHUTDOWN: u16 = 0x244;
pub(crate) const D_PROFILE: u16 = 0x248;

/// The local heap the file's entry makes (seg2 `0095`): `LocalInit` of its
/// data segment, sized as KERNEL sizes it (25Ch bytes of data, 2000h of
/// heap, two bytes more, in paragraphs), with nought for its start.
const HEAP_START: u32 = 0x25f;
const HEAP_END: u32 = 0x225f;

/// What WinBox keeps of DDEML's beyond its data segment.
#[derive(Debug, Default, Clone)]
pub struct State {
    /// Whether its data segment holds the file's data and its heap.
    pub ready: bool,
}

/// DDEML's data segment's selector: WinBox's own, whether or not the file
/// is loaded, made the file's data the first time.
pub(crate) fn data_selector(system: &System) -> u16 {
    system.kept_named(NAME).map_or(0, |kept| {
        winbox_machine::segment_selector(system.kept[kept].data)
    })
}

/// DDEML's instance: the file's library's while the file is loaded,
/// WinBox's own otherwise.
pub(crate) fn instance(system: &System) -> u16 {
    if let Some(library) = system.module_named(NAME) {
        return system.modules[library].instance;
    }

    system
        .kept_named(NAME)
        .map_or(0, |kept| system.kept[kept].instance())
}

/// DDEML's data made as the file's is as it loads, the first time any of
/// its exports is called: its initialized data, the selector the file's
/// relocation gives at 170h, its local heap, its instance.
fn ready(system: &mut System) {
    if system.ddeml.ready {
        return;
    }

    let Some(kept) = system.kept_named(NAME) else {
        return;
    };
    let index = system.kept[kept].data;
    let selector = winbox_machine::segment_selector(index);

    system.ddeml.ready = true;
    system.write_far(far(selector, 0), resources::DATA);
    system.write_far(far(selector, 0x170), &selector.to_le_bytes());
    system.local_init(index, HEAP_START, HEAP_END);

    let hinstance = instance(system);

    system.write_far(far(selector, D_HINSTANCE), &hinstance.to_le_bytes());
}

/// The far address of one of DDEML's exports: its stub, which USER calls
/// as it calls any procedure, and which lands in `implementation`'s
/// function. DDEML hands out its own exports so: its window procedures to
/// `RegisterClass`, its hooks, `INITENUM` and `TERMDLGPROC`.
pub(crate) fn export_address(d: &Dd<'_>, ordinal: u16) -> u32 {
    let mut system = d.e.system();
    let Some(kept) = system.kept_named(NAME) else {
        return 0;
    };
    let stubs = system.stubs(kept);

    u32::from(winbox_machine::segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

/// The function that answers an export: the registration point. Every
/// export is WinBox's.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "DdeInitialize" => Implementation::Async(dde_initialize),
        "DdeUninitialize" => Implementation::Async(dde_uninitialize),
        "DdeConnectList" => Implementation::Async(dde_connect_list),
        "DdeQueryNextServer" => Implementation::Async(dde_query_next_server),
        "DdeDisconnectList" => Implementation::Async(dde_disconnect_list),
        "DdeConnect" => Implementation::Async(dde_connect),
        "DdeDisconnect" => Implementation::Async(dde_disconnect),
        "DdeQueryConvInfo" => Implementation::Async(dde_query_conv_info),
        "DdeSetUserHandle" => Implementation::Async(dde_set_user_handle),
        "DdeClientTransaction" => Implementation::Async(dde_client_transaction),
        "DdeAbandonTransaction" => Implementation::Async(dde_abandon_transaction),
        "DdePostAdvise" => Implementation::Async(dde_post_advise),
        "DdeCreateDataHandle" => Implementation::Async(dde_create_data_handle),
        "DdeAddData" => Implementation::Async(dde_add_data),
        "DdeGetData" => Implementation::Async(dde_get_data),
        "DdeAccessData" => Implementation::Async(dde_access_data),
        "DdeUnaccessData" => Implementation::Async(dde_unaccess_data),
        "DdeFreeDataHandle" => Implementation::Async(dde_free_data_handle),
        "DdeGetLastError" => Implementation::Async(dde_get_last_error),
        "DdeCreateStringHandle" => Implementation::Async(dde_create_string_handle),
        "DdeFreeStringHandle" => Implementation::Async(dde_free_string_handle),
        "DdeQueryString" => Implementation::Async(dde_query_string),
        "DdeKeepStringHandle" => Implementation::Async(dde_keep_string_handle),
        "DdeEnableCallback" => Implementation::Async(dde_enable_callback),
        "DdeNameService" => Implementation::Async(dde_name_service),
        "CLIENTWNDPROC" => Implementation::Async(client_wnd_proc),
        "SERVERWNDPROC" => Implementation::Async(server_wnd_proc),
        "SUBFRAMEWNDPROC" => Implementation::Async(subframe_wnd_proc),
        "DMGWNDPROC" => Implementation::Async(dmg_wnd_proc),
        "CONVLISTWNDPROC" => Implementation::Async(convlist_wnd_proc),
        "MONITORWNDPROC" => Implementation::Async(monitor_wnd_proc),
        "DDESENDHOOKPROC" => Implementation::Async(dde_send_hook_proc),
        "DDEPOSTHOOKPROC" => Implementation::Async(dde_post_hook_proc),
        "DdeCmpStringHandles" => Implementation::Sync(dde_cmp_string_handles),
        "DdeReconnect" => Implementation::Async(dde_reconnect),
        "INITENUM" => Implementation::Async(init_enum),
        "TERMDLGPROC" => Implementation::Async(term_dlg_proc),
        _ => return None,
    })
}

/// `WEP` (seg2 `002c`): 1 for `WEP_FREE_DLL` and `WEP_SYSTEM_EXIT`,
/// nought and 1; for anything else what AX held as it was called, which
/// the entry's prologue loads with DDEML's data segment: the file's, while
/// the file is loaded, as KERNEL patched it (`KRNL386.EXE` seg1 `7bac`);
/// else WinBox's own, which stands for it (`data_selector`). It does
/// nothing else: no instance still open is ended. **Recorded** by
/// `ddewep`: 1, 1, and one more than `LoadLibrary`'s answer, a library's
/// instance being its data segment's handle (`library_instance`). As
/// `exports.ts`'s `WEP`.
#[allow(clippy::unnecessary_wraps)]
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let code = args.word(system);

    if code <= 1 {
        return Ok(Answer::Word(1));
    }

    let file = system
        .module_named(NAME)
        .and_then(|library| system.modules[library].data());

    Ok(Answer::Word(file.map_or_else(
        || data_selector(system),
        winbox_machine::segment_selector,
    )))
}

/// DDEML's file let go, its library gone: its data segment goes with it,
/// and the file loaded again starts from its data again, as the first time
/// (**recorded** by `ddewep`: an instance made after has the serial the
/// first instance of all had). WinBox's own data is made the file's again
/// at the next export called (`ready`), its local heap with it. As
/// `exports.ts`'s `freed`.
pub(crate) fn freed(system: &mut System) {
    if !system.ddeml.ready {
        return;
    }

    system.ddeml.ready = false;

    if let Some(kept) = system.kept_named(NAME) {
        let index = system.kept[kept].data;

        system.heaps.remove(&index);
    }
}

/// `DdeCmpStringHandles` (`1bb0`).
#[allow(clippy::unnecessary_wraps)]
fn dde_cmp_string_handles(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let first = args.dword(system);
    let second = args.dword(system);

    Ok(Answer::Word(instance::cmp_string_handles(first, second)))
}

/// An export's arguments read, in order, as words (`w`) and doublewords
/// (`d`), DDEML's data made ready first.
fn read(engine: &Engine, args: &mut Args, shape: &[u8]) -> Vec<u32> {
    let mut system = engine.system();

    ready(&mut system);
    shape
        .iter()
        .map(|kind| match kind {
            b'w' => u32::from(args.word(&system)),
            _ => args.dword(&system),
        })
        .collect()
}

/// An export answering a word.
fn word(answer: R<u16>) -> Result<Answer, Stop> {
    Ok(Answer::Word(answer?))
}

/// An export answering a doubleword.
fn dword(answer: R<u32>) -> Result<Answer, Stop> {
    Ok(Answer::Dword(answer?))
}

macro_rules! export {
    ($name:ident, $shape:literal, |$d:ident, $a:ident| $body:expr) => {
        fn $name(engine: &Engine, mut args: Args) -> Later<'_> {
            Box::pin(async move {
                let $a = read(engine, &mut args, $shape);
                let $d = Dd::new(engine);

                $body
            })
        }
    };
}

export!(dde_initialize, b"dddd", |d, a| word(
    instance::initialize(&d, a[0], a[1], a[2], a[3]).await
));
export!(dde_uninitialize, b"d", |d, a| word(
    instance::uninitialize(&d, a[0]).await
));
export!(dde_connect_list, b"ddddd", |d, a| dword(
    conv::connect_list(&d, a[0], a[1], a[2], a[3], a[4]).await
));
export!(dde_query_next_server, b"dd", |d, a| dword(
    conv::query_next_server(&d, a[0], a[1]).await
));
export!(dde_disconnect_list, b"d", |d, a| word(
    conv::disconnect_list(&d, a[0]).await
));
export!(dde_connect, b"dddd", |d, a| dword(
    conv::connect(&d, a[0], a[1], a[2], a[3]).await
));
export!(dde_disconnect, b"d", |d, a| word(
    conv::disconnect(&d, a[0]).await
));
export!(dde_query_conv_info, b"ddd", |d, a| word(
    conv::query_conv_info(&d, a[0], a[1], a[2]).await
));
export!(dde_set_user_handle, b"ddd", |d, a| word(
    conv::set_user_handle(&d, a[0], a[1], a[2]).await
));
export!(dde_client_transaction, b"ddddwwdd", |d, a| dword(
    xact::client_transaction(
        &d,
        a[0],
        a[1],
        a[2],
        a[3],
        a[4] as u16,
        a[5] as u16,
        a[6],
        a[7]
    )
    .await
));
export!(dde_abandon_transaction, b"ddd", |d, a| word(
    xact::abandon(&d, a[0], a[1], a[2]).await
));
export!(dde_post_advise, b"ddd", |d, a| word(
    xact::post_advise(&d, a[0], a[1], a[2]).await
));
export!(dde_create_data_handle, b"dddddww", |d, a| dword(
    data::create_data_handle(&d, a[0], a[1], a[2], a[3], a[4], a[5] as u16, a[6] as u16).await
));
export!(dde_add_data, b"dddd", |d, a| dword(
    data::add_data(&d, a[0], a[1], a[2], a[3]).await
));
export!(dde_get_data, b"dddd", |d, a| dword(
    data::get_data(&d, a[0], a[1], a[2], a[3]).await
));
export!(dde_access_data, b"dd", |d, a| dword(
    data::access_data(&d, a[0], a[1]).await
));
export!(dde_unaccess_data, b"d", |d, a| word(
    data::unaccess_data(&d, a[0]).await
));
export!(dde_free_data_handle, b"d", |d, a| word(
    data::free_data_handle(&d, a[0]).await
));
export!(dde_get_last_error, b"d", |d, a| word(Ok(
    instance::get_last_error(&d, a[0])
)));
export!(dde_create_string_handle, b"ddw", |d, a| dword(
    instance::create_string_handle(&d, a[0], a[1], a[2] as u16).await
));
export!(dde_free_string_handle, b"dd", |d, a| word(
    instance::free_string_handle(&d, a[0], a[1]).await
));
export!(dde_query_string, b"ddddw", |d, a| dword(
    instance::query_string(&d, a[0], a[1], a[2], a[3], a[4] as u16).await
));
export!(dde_keep_string_handle, b"dd", |d, a| word(
    instance::keep_string_handle(&d, a[0], a[1]).await
));
export!(dde_enable_callback, b"ddw", |d, a| word(
    instance::enable_callback(&d, a[0], a[1], a[2] as u16).await
));
export!(dde_name_service, b"dddw", |d, a| dword(
    instance::name_service(&d, a[0], a[1], a[2], a[3] as u16).await
));
export!(client_wnd_proc, b"wwwd", |d, a| dword(
    conv::client_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(server_wnd_proc, b"wwwd", |d, a| dword(
    conv::server_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(subframe_wnd_proc, b"wwwd", |d, a| dword(
    conv::subframe_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(dmg_wnd_proc, b"wwwd", |d, a| dword(
    instance::dmg_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(convlist_wnd_proc, b"wwwd", |d, a| dword(
    conv::convlist_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(monitor_wnd_proc, b"wwwd", |d, a| dword(
    monitor::monitor_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16, a[3]).await
));
export!(dde_send_hook_proc, b"wwd", |d, a| dword(
    monitor::send_hook(&d, a[0] as u16, a[1] as u16, a[2]).await
));
export!(dde_post_hook_proc, b"wwd", |d, a| dword(
    monitor::post_hook(&d, a[0] as u16, a[1] as u16, a[2]).await
));
export!(dde_reconnect, b"d", |d, a| dword(
    conv::reconnect(&d, a[0]).await
));
export!(init_enum, b"wd", |d, a| word(
    conv::init_enum(&d, a[0] as u16, a[1]).await
));
export!(term_dlg_proc, b"wwwd", |d, a| dword(
    instance::term_dlg_proc(&d, a[0] as u16, a[1] as u16, a[2] as u16).await
));

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::Kept;

    /// Each export WinBox answers here is one the TypeScript engine
    /// answers, and no other: its table is `kept.rs`'s.
    #[test]
    fn ours_agree() {
        let kept = Kept::named(NAME).expect("DDEML kept");

        for export in kept.exports.iter().flatten() {
            assert_eq!(
                implementation(export.name).is_some(),
                !export.stub,
                "{} answered by one engine only",
                export.name
            );
        }
    }

    #[test]
    fn the_time_outs_read_as_atol() {
        assert_eq!(core::atol(b" 3000"), 3000);
        assert_eq!(core::atol(b"-5x"), (-5i32) as u32);
        assert_eq!(core::atol(b""), 0);
    }
}
