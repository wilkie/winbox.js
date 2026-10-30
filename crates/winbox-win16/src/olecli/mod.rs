//! `OLECLI`, OLE 1.0's client library, as WinBox's own: written from OLE
//! 1.0's documented interface and from the probes `olestat` and `olemem`,
//! not from the code of `OLECLI.DLL` (`kb/topics/ole.md`). As
//! `src/win16/olecli/`.
//!
//! Kept as `DDEML` is (`own_modules.rs`): with `OLECLI.DLL` on the drive,
//! a program that imports it gets the file's library, and each import of
//! an export answered here is linked to WinBox's stub, as `GetProcAddress`
//! answers it; with none, WinBox's is found by its file's name. It is kept
//! only once a program loads it (`crate::kept::ON_LOAD`), so a session with
//! no OLE is as it was. What its file does as it is loaded is done as a
//! program first calls it (`start.rs`).

pub(crate) mod api;
pub(crate) mod core;
pub(crate) mod docs;
pub(crate) mod draw;
pub(crate) mod kinds;
pub(crate) mod methods;
pub(crate) mod objects;
pub(crate) mod start;
pub(crate) mod streams;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::system::{STEP, System};

use self::core::{CLIENT_VERSION, Method, OLE_ERROR_ADDRESS, OLE_ERROR_HANDLE, Ole, R};
use self::objects::MethodArg::{D, W};

pub use self::core::State;

/// The module's name.
pub const NAME: &str = "OLECLI";

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

/// The far address of one of `OLECLI`'s exports: its stub.
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
async fn ready(ole: &Ole<'_>) -> R<()> {
    let instance = instance(&ole.e.system());

    start::start(ole, instance).await
}

macro_rules! export {
    ($name:ident, $shape:literal, |$o:ident, $a:ident| $body:expr) => {
        fn $name(engine: &Engine, mut args: Args) -> Later<'_> {
            Box::pin(async move {
                let $a = read(engine, &mut args, $shape);
                let $o = Ole::new(engine);

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

/// The far address of an entry of `OLECLI.DLL`'s, where the file is
/// loaded; nought where it is not.
fn file_entry(engine: &Engine, ordinal: u16) -> u32 {
    let system = engine.system();

    system
        .module_named(NAME)
        .and_then(|index| system.modules[index].lookup(ordinal))
        .map_or(0, |(segment, offset)| {
            u32::from(winbox_machine::segment_selector(segment)) << 16 | u32::from(offset)
        })
}

/// What WinBox's `OLECLI` does not do yet -- embedded and linked objects,
/// which need a server -- left to the file's code where the file is on the
/// drive, as it was before WinBox's own: the calls that make such an
/// object or talk to its server, where `wanted` says the arguments ask for
/// one. The object the file makes is used through its own table
/// thereafter, as any object is (`objects::call_method`), in a document
/// of WinBox's, whose block the file lays out as WinBox does (`olemem`).
/// Else WinBox's own answer. As `index.ts`'s `fileFirst`.
async fn or_file(
    o: &Ole<'_>,
    ordinal: u16,
    shape: &[u8],
    a: &[u32],
    wanted: bool,
    mine: impl Future<Output = R<u16>>,
) -> R<u16> {
    let address = if wanted { file_entry(o.e, ordinal) } else { 0 };

    if address == 0 {
        return mine.await;
    }

    let args: Vec<GuestArg> = shape
        .iter()
        .zip(a)
        .map(|(kind, value)| match kind {
            b'w' => GuestArg::Word(*value as u16),
            _ => GuestArg::Long(*value),
        })
        .collect();

    Ok(o.call_far(address, &args).await? as u16)
}

/// Whether a protocol argument is `StdFileEditing`.
fn std(o: &Ole<'_>, at: u32) -> bool {
    api::protocol_of(o, at) == Some(api::Protocol::Std)
}

/// The method of an object called, the answer a word.
async fn call(o: &Ole<'_>, object: u32, method: Method, args: &[objects::MethodArg]) -> R<u16> {
    api::method(o, object, method, args).await
}

export!(ole_delete, b"d", |o, a| word(
    call(&o, a[0], Method::Delete, &[]).await
));
export!(ole_release, b"d", |o, a| word(
    call(&o, a[0], Method::Release, &[]).await
));
export!(ole_save_to_stream, b"dd", |o, a| word(
    api::save_to_stream(&o, a[0], a[1]).await
));
export!(ole_load_from_stream, b"dddddd", |o, a| word(
    or_file(
        &o,
        4,
        b"dddddd",
        &a,
        std(&o, a[1]),
        api::load_from_stream(&o, a[0], a[1], a[2], a[3], a[4], a[5])
    )
    .await
));
export!(ole_clone, b"ddddd", |o, a| word(
    api::clone(&o, a[0], a[1], a[2], a[3], a[4]).await
));
export!(ole_copy_from_link, b"dddddd", |o, a| word(
    api::copy_from_link(&o, a[0], a[2], a[3], a[4], a[5]).await
));
export!(ole_equal, b"dd", |o, a| word(
    api::equal(&o, a[0], a[1]).await
));
export!(ole_query_link_from_clip, b"dww", |o, a| word(
    or_file(
        &o,
        9,
        b"dww",
        &a,
        std(&o, a[0]),
        api::query_from_clip(&o, a[0], a[1] as u16, a[2] as u16, true)
    )
    .await
));
export!(ole_query_create_from_clip, b"dww", |o, a| word(
    or_file(
        &o,
        10,
        b"dww",
        &a,
        std(&o, a[0]),
        api::query_from_clip(&o, a[0], a[1] as u16, a[2] as u16, false)
    )
    .await
));
export!(ole_create_link_from_clip, b"dddddww", |o, a| word(
    or_file(&o, 11, b"dddddww", &a, std(&o, a[0]), async {
        Ok(api::create_link_from_clip(&o, a[0], a[2], a[3], a[4]))
    })
    .await
));
export!(ole_create_from_clip, b"dddddww", |o, a| word(
    or_file(
        &o,
        12,
        b"dddddww",
        &a,
        std(&o, a[0]),
        api::create_from_clip(&o, a[0], a[1], a[2], a[3], a[4], a[5] as u16, a[6] as u16)
    )
    .await
));
export!(ole_copy_to_clipboard, b"d", |o, a| word(
    call(&o, a[0], Method::CopyToClipboard, &[]).await
));
export!(ole_query_type, b"dd", |o, a| word(
    call(&o, a[0], Method::QueryType, &[D(a[1])]).await
));
export!(ole_set_host_names, b"ddd", |o, a| word(
    call(&o, a[0], Method::SetHostNames, &[D(a[1]), D(a[2])]).await
));
export!(ole_set_target_device, b"dw", |o, a| word(
    call(&o, a[0], Method::SetTargetDevice, &[W(a[1] as u16)]).await
));
export!(ole_set_bounds, b"dd", |o, a| word(
    api::method_with_out(&o, a[0], Method::SetBounds, a[1], 8, &[D(a[1])]).await
));
export!(ole_query_bounds, b"dd", |o, a| word(
    api::method_with_out(&o, a[0], Method::QueryBounds, a[1], 8, &[D(a[1])]).await
));
export!(ole_draw, b"dwddw", |o, a| word(
    api::method_with_out(
        &o,
        a[0],
        Method::Draw,
        a[2],
        8,
        &[W(a[1] as u16), D(a[2]), D(a[3]), W(a[4] as u16)]
    )
    .await
));
export!(ole_query_open, b"d", |o, a| word(
    call(&o, a[0], Method::QueryOpen, &[]).await
));
export!(ole_activate, b"dwwwwd", |o, a| word(
    call(
        &o,
        a[0],
        Method::Activate,
        &[
            W(a[1] as u16),
            W(a[2] as u16),
            W(a[3] as u16),
            W(a[4] as u16),
            D(a[5])
        ]
    )
    .await
));
export!(ole_update, b"d", |o, a| word(
    call(&o, a[0], Method::Update, &[]).await
));
export!(ole_reconnect, b"d", |o, a| word(
    call(&o, a[0], Method::Reconnect, &[]).await
));
export!(ole_get_link_update_options, b"dd", |o, a| word(
    call(&o, a[0], Method::GetLinkUpdateOptions, &[D(a[1])]).await
));
export!(ole_set_link_update_options, b"dw", |o, a| word(
    call(&o, a[0], Method::SetLinkUpdateOptions, &[W(a[1] as u16)]).await
));
export!(ole_enum_formats, b"dw", |o, a| word(
    api::enum_formats(&o, a[0], a[1] as u16).await
));
export!(ole_close, b"d", |o, a| word(
    call(&o, a[0], Method::Close, &[]).await
));
export!(ole_get_data, b"dwd", |o, a| word(
    api::method_with_out(
        &o,
        a[0],
        Method::GetData,
        a[2],
        2,
        &[W(a[1] as u16), D(a[2])]
    )
    .await
));
export!(ole_set_data, b"dww", |o, a| word(
    call(&o, a[0], Method::SetData, &[W(a[1] as u16), W(a[2] as u16)]).await
));
export!(ole_query_protocol, b"dd", |o, a| dword(
    api::query_protocol(&o, a[0], a[1]).await
));
export!(ole_query_out_of_date, b"d", |o, a| word(
    call(&o, a[0], Method::QueryOutOfDate, &[]).await
));
export!(ole_object_convert, b"dddddd", |o, a| word(
    api::object_convert(&o, a[0], a[1], a[2], a[3], a[4], a[5]).await
));
export!(ole_create_from_template, b"ddddddww", |o, a| word(
    or_file(
        &o,
        33,
        b"ddddddww",
        &a,
        std(&o, a[0]),
        api::create_by_class(&o, a[0], 0, a[3], a[4], a[5])
    )
    .await
));
export!(ole_create, b"ddddddww", |o, a| word(
    or_file(
        &o,
        34,
        b"ddddddww",
        &a,
        std(&o, a[0]),
        api::create_by_class(&o, a[0], a[2], a[3], a[4], a[5])
    )
    .await
));
export!(ole_query_release_status, b"d", |o, a| word(
    call(&o, a[0], Method::QueryReleaseStatus, &[]).await
));
export!(ole_query_release_error, b"d", |o, a| word(
    call(&o, a[0], Method::QueryReleaseError, &[]).await
));
export!(ole_query_release_method, b"d", |o, a| word(
    call(&o, a[0], Method::QueryReleaseMethod, &[]).await
));
export!(ole_create_from_file, b"dddddddww", |o, a| word(
    or_file(
        &o,
        38,
        b"dddddddww",
        &a,
        std(&o, a[0]),
        api::create_by_class(&o, a[0], a[2], a[4], a[5], a[6])
    )
    .await
));
export!(ole_create_link_from_file, b"ddddddddww", |o, a| word(
    or_file(
        &o,
        39,
        b"ddddddddww",
        &a,
        std(&o, a[0]),
        api::create_by_class(&o, a[0], a[2], a[5], a[6], a[7])
    )
    .await
));
export!(ole_register_client_doc, b"dddd", |o, a| word(
    docs::register_client_doc(&o, a[0], a[1], a[3]).await
));
export!(ole_revoke_client_doc, b"d", |o, a| word(
    docs::revoke_client_doc(&o, a[0]).await
));
export!(ole_rename_client_doc, b"dd", |o, a| word(
    docs::rename_client_doc(&o, a[0], a[1]).await
));
export!(ole_revert_client_doc, b"d", |o, a| word(Ok(
    docs::saved_client_doc(&o, a[0])
)));
export!(ole_saved_client_doc, b"d", |o, a| word(Ok(
    docs::saved_client_doc(&o, a[0])
)));
export!(ole_rename, b"dd", |o, a| word(
    call(&o, a[0], Method::Rename, &[D(a[1])]).await
));
export!(ole_enum_objects, b"dd", |o, a| word(Ok(
    docs::enum_objects(&o, a[0], a[1])
)));
export!(ole_query_name, b"ddd", |o, a| word(
    if objects::is_object(&o, a[0])
        && (!objects::writable(&o, a[2], 2) || !objects::writable(&o, a[1], 1))
    {
        Ok(OLE_ERROR_ADDRESS)
    } else {
        call(&o, a[0], Method::QueryName, &[D(a[1]), D(a[2])]).await
    }
));
export!(ole_set_color_scheme, b"dd", |o, a| word(
    call(&o, a[0], Method::SetColorScheme, &[D(a[1])]).await
));
export!(ole_request_data, b"dw", |o, a| word(
    api::request_data(&o, a[0], a[1] as u16).await
));
export!(ole_lock_server, b"dd", |o, a| word(
    or_file(
        &o,
        54,
        b"dd",
        &a,
        objects::is_object(&o, a[0]) && objects::kind_of(&o, a[0]).is_none(),
        async { Ok(api::lock_server(&o, a[0])) }
    )
    .await
));
export!(ole_unlock_server, b"d", |o, a| word(
    or_file(&o, 55, b"d", &a, true, async { Ok(OLE_ERROR_HANDLE) }).await
));
export!(ole_query_size, b"dd", |o, a| word(
    api::method_with_out(&o, a[0], Method::QuerySize, a[1], 4, &[D(a[1])]).await
));
export!(ole_execute, b"dww", |o, a| word(
    call(&o, a[0], Method::Execute, &[W(a[1] as u16), W(a[2] as u16)]).await
));
export!(ole_create_invisible, b"ddddddwww", |o, a| word(
    or_file(
        &o,
        58,
        b"ddddddwww",
        &a,
        std(&o, a[0]),
        api::create_by_class(&o, a[0], a[2], a[3], a[4], a[5])
    )
    .await
));
export!(ole_query_client_version, b"", |_o, _a| dword(Ok(
    CLIENT_VERSION
)));
export!(ole_is_dc_meta, b"w", |o, a| word(
    draw::is_dc_meta(&o, a[0] as u16).await
));
export!(mf_callback_func, b"wddwd", |o, a| word(
    draw::mf_callback(&o, a[0] as u16, a[1], a[2], a[3] as u16, a[4]).await
));

/// `WEP`: 1, as a library's is.
#[allow(clippy::unnecessary_wraps)]
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// A method export of a kind's: its arguments read as `OLEOBJECTVTBL`
/// declares its method's (ole.h), and answered by WinBox's method.
fn method_export(engine: &Engine, mut args: Args, ordinal: u16) -> Later<'_> {
    Box::pin(async move {
        let shape = method_shape(ordinal);
        let values = read(engine, &mut args, shape);
        let ole = Ole::new(engine);

        ready(&ole).await?;

        let answer = methods::call_own_method(&ole, ordinal, &values).await?;

        if ordinal == 712 {
            Ok(Answer::Dword(answer))
        } else {
            Ok(Answer::Word(answer as u16))
        }
    })
}

/// A method export's arguments, the object first.
const fn method_shape(ordinal: u16) -> &'static [u8] {
    match ordinal {
        // Release, Delete, CopyToClipboard, Close, Update, Reconnect,
        // QueryOpen, QueryOutOfDate, QueryRelease*.
        300 | 305 | 400 | 405 | 500 | 505 | 600 | 606 | 707 | 709..=711 | 713 | 1027 => b"d",
        // GetData; ObjectLong.
        301 | 401 | 501 | 601 | 718 => b"dwd",
        // SetData; Execute.
        602 | 702 | 717 => b"dww",
        // SaveToStream, Equal, QueryBounds, QueryType, QuerySize, Rename,
        // SetBounds, GetLinkUpdateOptions, SetColorScheme, QueryProtocol.
        302
        | 304
        | 307
        | 402
        | 404
        | 407
        | 502
        | 504
        | 507
        | 603
        | 605
        | 608
        | 705
        | 712
        | 715
        | 911..=913
        | 1028
        | 1030 => b"dd",
        // Clone; CopyFromLink.
        303 | 403 | 503 | 604 | 706 => b"ddddd",
        // Draw.
        308 | 408 | 508 | 609 => b"dwddw",
        // EnumFormats; Show; SetTargetDevice; SetLinkUpdateOptions;
        // RequestData.
        309 | 409 | 509 | 610 | 701 | 704 | 716 | 1026 => b"dw",
        // ChangeData.
        310 | 410 | 510 | 611 => b"dwdw",
        // SetHostNames; QueryName.
        703 | 910 => b"ddd",
        // Activate.
        708 => b"dwwwwd",
        // ObjectConvert.
        714 => b"dddddd",
        // DoVerb.
        1029 => b"dwww",
        _ => b"",
    }
}

macro_rules! methods {
    ($($ordinal:literal => $name:ident),* $(,)?) => {
        $(
            fn $name(engine: &Engine, args: Args) -> Later<'_> {
                method_export(engine, args, $ordinal)
            }
        )*

        /// The method export of a name, the `OLECLI` file's or WinBox's
        /// for an entry it gives none.
        fn method_named(name: &str) -> Option<Implementation> {
            Some(match name {
                $(stringify!($name) => Implementation::Async($name),)*
                _ => return None,
            })
        }
    };
}

#[allow(non_snake_case)]
mod method_names {
    use super::{Engine, Implementation, Later, method_export};
    use crate::call::Args;

    methods! {
        300 => MFRELEASE, 301 => MFGETDATA, 302 => MFSAVETOSTREAM, 303 => MFCLONE,
        304 => MFEQUAL, 305 => MFCOPY, 307 => MFQUERYBOUNDS, 308 => MFDRAW,
        309 => MFENUMFORMAT, 310 => MFCHANGEDATA,
        400 => BMRELEASE, 401 => BMGETDATA, 402 => BMSAVETOSTREAM, 403 => BMCLONE,
        404 => BMEQUAL, 405 => BMCOPY, 407 => BMQUERYBOUNDS, 408 => BMDRAW,
        409 => BMENUMFORMAT, 410 => BMCHANGEDATA,
        500 => DIBRELEASE, 501 => DIBGETDATA, 502 => DIBSAVETOSTREAM, 503 => DIBCLONE,
        504 => DIBEQUAL, 505 => DIBCOPY, 507 => DIBQUERYBOUNDS, 508 => DIBDRAW,
        509 => DIBENUMFORMAT, 510 => DIBCHANGEDATA,
        600 => GENRELEASE, 601 => GENGETDATA, 602 => GENSETDATA, 603 => GENSAVETOSTREAM,
        604 => GENCLONE, 605 => GENEQUAL, 606 => GENCOPY, 608 => GENQUERYBOUNDS,
        609 => GENDRAW, 610 => GENENUMFORMAT, 611 => GENCHANGEDATA,
        701 => ERRSHOW, 702 => ERRSETDATA, 703 => ERRSETHOSTNAMES, 704 => ERRSETTARGETDEVICE,
        705 => ERRSETBOUNDS, 706 => ERRCOPYFROMLINK, 707 => ERRQUERYOPEN, 708 => ERRACTIVATE,
        709 => ERRCLOSE, 710 => ERRUPDATE, 711 => ERRRECONNECT, 712 => ERRQUERYPROTOCOL,
        713 => ERRQUERYOUTOFDATE, 714 => ERROBJECTCONVERT, 715 => ERRGETUPDATEOPTIONS,
        716 => ERRSETUPDATEOPTIONS, 717 => ERREXECUTE, 718 => ERROBJECTLONG,
        910 => OBJQUERYNAME, 911 => OBJRENAME, 912 => OBJQUERYTYPE, 913 => OBJQUERYSIZE,
        1026 => Ordinal1026, 1027 => Ordinal1027, 1028 => Ordinal1028, 1029 => Ordinal1029,
        1030 => Ordinal1030,
    }

    pub(super) fn named(name: &str) -> Option<Implementation> {
        method_named(name)
    }
}

/// The function that answers an export WinBox has made its own.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "OleDelete" => Implementation::Async(ole_delete),
        "OleSaveToStream" => Implementation::Async(ole_save_to_stream),
        "OleLoadFromStream" => Implementation::Async(ole_load_from_stream),
        "OleClone" => Implementation::Async(ole_clone),
        "OleCopyFromLink" => Implementation::Async(ole_copy_from_link),
        "OleEqual" => Implementation::Async(ole_equal),
        "OleQueryLinkFromClip" => Implementation::Async(ole_query_link_from_clip),
        "OleQueryCreateFromClip" => Implementation::Async(ole_query_create_from_clip),
        "OleCreateLinkFromClip" => Implementation::Async(ole_create_link_from_clip),
        "OleCreateFromClip" => Implementation::Async(ole_create_from_clip),
        "OleCopyToClipboard" => Implementation::Async(ole_copy_to_clipboard),
        "OleQueryType" => Implementation::Async(ole_query_type),
        "OleSetHostNames" => Implementation::Async(ole_set_host_names),
        "OleSetTargetDevice" => Implementation::Async(ole_set_target_device),
        "OleSetBounds" => Implementation::Async(ole_set_bounds),
        "OleQueryBounds" => Implementation::Async(ole_query_bounds),
        "OleDraw" => Implementation::Async(ole_draw),
        "OleQueryOpen" => Implementation::Async(ole_query_open),
        "OleActivate" => Implementation::Async(ole_activate),
        "OleUpdate" => Implementation::Async(ole_update),
        "OleReconnect" => Implementation::Async(ole_reconnect),
        "OleGetLinkUpdateOptions" => Implementation::Async(ole_get_link_update_options),
        "OleSetLinkUpdateOptions" => Implementation::Async(ole_set_link_update_options),
        "OleEnumFormats" => Implementation::Async(ole_enum_formats),
        "OleClose" => Implementation::Async(ole_close),
        "OleGetData" => Implementation::Async(ole_get_data),
        "OleSetData" => Implementation::Async(ole_set_data),
        "OleQueryProtocol" => Implementation::Async(ole_query_protocol),
        "OleQueryOutOfDate" => Implementation::Async(ole_query_out_of_date),
        "OleObjectConvert" => Implementation::Async(ole_object_convert),
        "OleCreateFromTemplate" => Implementation::Async(ole_create_from_template),
        "OleCreate" => Implementation::Async(ole_create),
        "OleQueryReleaseStatus" => Implementation::Async(ole_query_release_status),
        "OleQueryReleaseError" => Implementation::Async(ole_query_release_error),
        "OleQueryReleaseMethod" => Implementation::Async(ole_query_release_method),
        "OleCreateFromFile" => Implementation::Async(ole_create_from_file),
        "OleCreateLinkFromFile" => Implementation::Async(ole_create_link_from_file),
        "OleRelease" => Implementation::Async(ole_release),
        "OleRegisterClientDoc" => Implementation::Async(ole_register_client_doc),
        "OleRevokeClientDoc" => Implementation::Async(ole_revoke_client_doc),
        "OleRenameClientDoc" => Implementation::Async(ole_rename_client_doc),
        "OleRevertClientDoc" => Implementation::Async(ole_revert_client_doc),
        "OleSavedClientDoc" => Implementation::Async(ole_saved_client_doc),
        "OleRename" => Implementation::Async(ole_rename),
        "OleEnumObjects" => Implementation::Async(ole_enum_objects),
        "OleQueryName" => Implementation::Async(ole_query_name),
        "OleSetColorScheme" => Implementation::Async(ole_set_color_scheme),
        "OleRequestData" => Implementation::Async(ole_request_data),
        "OleLockServer" => Implementation::Async(ole_lock_server),
        "OleUnlockServer" => Implementation::Async(ole_unlock_server),
        "OleQuerySize" => Implementation::Async(ole_query_size),
        "OleExecute" => Implementation::Async(ole_execute),
        "OleCreateInvisible" => Implementation::Async(ole_create_invisible),
        "OleQueryClientVersion" => Implementation::Async(ole_query_client_version),
        "OleIsDcMeta" => Implementation::Async(ole_is_dc_meta),
        "MFCALLBACKFUNC" => Implementation::Async(mf_callback_func),
        _ => return method_names::named(name),
    })
}
