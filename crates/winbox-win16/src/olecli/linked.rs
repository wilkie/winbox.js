//! Embedded and linked objects, WinBox's own: their blocks, their methods
//! (the `LE` exports, 200-230, and entries 1000-1005 of `OLECLI`'s), and
//! the DDE conversation each holds with its server, as OLE 1.0's protocol
//! has a client hold it -- `StdFileEditing` (the OLE 1.0 programmer's
//! reference) -- in the order and with the items, formats and data
//! **recorded** by the probes `oledde` (a server that writes down each
//! message it is sent), `olepbd` (the same server as the class `PBrush`)
//! and `olepbr` (Paintbrush). Nothing here is taken from the code of
//! `OLECLI.DLL`.
//!
//! An object's conversation is a list of steps: each posts one message and
//! waits for the server's answer -- `WM_DDE_ACK`, the data asked for, or
//! the terminate answering ours -- in a window of `OLECLI`'s classes, then
//! the next is taken. While steps are left the object is busy
//! (`OleQueryReleaseStatus` answers `OLE_BUSY`); the last tells its client
//! `OLE_RELEASE`, with the error that stopped it and the method that
//! began.

use std::collections::VecDeque;

use crate::commdlg::api::{Arg, text};
use crate::engine::GuestArg;

use super::core::{
    CF_BITMAP, CF_DIB, CF_METAFILEPICT, Conv, DIB_DATA, DOC_CLASS, DOC_NAME, GEN_CLASS, GEN_DATA,
    GEN_FORMAT, GEN_SIZE, GMEM_DDESHARE, GMEM_MOVEABLE, GMEM_ZEROINIT, Kind, Le, MM_ANISOTROPIC,
    OBJ_CLIENT, OBJ_HEIGHT, OBJ_MAPPING, OBJ_TYPE, OBJ_UNKNOWN_FFFF, OBJ_VTBL, OBJ_WIDTH,
    OLE_ERROR_FORMAT, OLE_ERROR_GENERIC, OLE_ERROR_MEMORY, OLE_ERROR_NOT_EQUAL, OLE_ERROR_OBJECT,
    OLE_ERROR_STREAM, OLE_OK, OLERENDER_DRAW, OLERENDER_FORMAT, OLERENDER_NONE, Ole, R, SCRATCH,
    SMALL_BLOCK, SRCCOPY, STREAM_VERSION, Step, plus,
};
use super::draw::draw;
use super::kinds::{
    block_of, class_of, clone as clone_static, copy_block, copy_to_clipboard as copy_static,
    format_of_kind, get_data as static_data, query_bounds as static_bounds,
    query_size as static_size, read_block, read_other, read_static, release as release_static,
    same_blocks, save_typed, static_from_clipboard,
};
use super::objects::{free_object, kind_of, new_object};
use super::start::FORMATS;
use super::streams::{get, get_long, put, put_long, put_name};

// DDE's messages (dde.h).
const WM_DDE_INITIATE: u16 = 0x3e0;
const WM_DDE_TERMINATE: u16 = 0x3e1;
const WM_DDE_ADVISE: u16 = 0x3e2;
const WM_DDE_ACK: u16 = 0x3e4;
const WM_DDE_DATA: u16 = 0x3e5;
const WM_DDE_REQUEST: u16 = 0x3e6;
const WM_DDE_POKE: u16 = 0x3e7;
const WM_DDE_EXECUTE: u16 = 0x3e8;
const HWND_BROADCAST: u16 = 0xffff;

/// A `DDEACK`'s and a `DDEDATA`'s flags (dde.h).
const ACK_POSITIVE: u16 = 0x8000;
const DATA_RESPONSE: u16 = 0x1000;
const DATA_RELEASE: u16 = 0x2000;
const DATA_ACK_REQ: u16 = 0x8000;
/// An advise's `fAckReq`: what `OLECLI` asks for (**recorded** by
/// `oledde`, `8000`).
const ADVISE_ACK_REQ: u16 = 0x8000;

/// `nCmdShow`s a server is launched with: shown where it is made or
/// activated, hidden to give data (**recorded** by `oledde`'s
/// `srv.start`).
const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;

/// `OLE_NOTIFICATION` (ole.h).
const OLE_CHANGED: u16 = 0;
const OLE_SAVED: u16 = 1;
const OLE_CLOSED: u16 = 2;
const OLE_RELEASE: u16 = 5;

/// `OLE_RELEASE_METHOD` (ole.h).
const OLE_DELETE: u16 = 1;
const OLE_RUN: u16 = 5;
const OLE_ACTIVATE: u16 = 6;
const OLE_UPDATE: u16 = 7;
const OLE_CLOSE: u16 = 8;
const OLE_RECONNECT: u16 = 9;
const OLE_SETDATA: u16 = 13;
const OLE_REQUESTDATA: u16 = 14;
const OLE_OTHER: u16 = 15;
const OLE_CREATE: u16 = 16;
const OLE_CREATELINKFROMFILE: u16 = 18;
const OLE_CREATEFROMFILE: u16 = 20;

/// `OLESTATUS` (ole.h) of the conversation.
pub(crate) const OLE_WAIT_FOR_RELEASE: u16 = 1;
pub(crate) const OLE_BUSY: u16 = 2;
pub(crate) const OLE_ERROR_BLANK: u16 = 7;
pub(crate) const OLE_ERROR_NOT_OPEN: u16 = 34;
pub(crate) const OLE_ERROR_LAUNCH: u16 = 35;
const OLE_ERROR_COMM: u16 = 36;
const OLE_ERROR_COMMAND: u16 = 38;
const OLE_ERROR_DOVERB: u16 = 40;
const OLE_ERROR_ADVISE_NATIVE: u16 = 41;
const OLE_ERROR_ADVISE_PICT: u16 = 42;
const OLE_ERROR_ADVISE_RENAME: u16 = 43;
const OLE_ERROR_POKE_NATIVE: u16 = 44;
const OLE_ERROR_REQUEST_NATIVE: u16 = 45;
const OLE_ERROR_REQUEST_PICT: u16 = 46;
const OLE_ERROR_NEW: u16 = 31;
const OLE_ERROR_EDIT: u16 = 32;
/// `OLE_WARN_DELETE_DATA` (ole.h): data made for the caller, the caller's
/// to let go (**recorded** by `olepbd`, a Paintbrush object's picture).
const OLE_WARN_DELETE_DATA: u16 = 1000;

/// Object types (ole.h).
const OT_LINK: u32 = 1;
const OT_EMBEDDED: u32 = 2;

/// The registration database's root, `HKEY_CLASSES_ROOT` (shellapi.h).
const HKEY_CLASSES_ROOT: u32 = 1;

/// An embedded or linked object's block: A0h bytes (**measured** by
/// `oleemb`'s `block` records); WinBox keeps the rest beside it.
pub(crate) const LE_BLOCK: u32 = 0xa0;
/// Where its method table is laid out in `OLECLI`'s data.
pub(crate) const LE_VTBL: u16 = 0x500;
/// Where a class's name is put for `CreateWindow`, and a server's command
/// line built.
const CONV_CLASS: u16 = 0x0a80;
const COMMAND_LINE: u16 = 0x0b00;
const COMMAND_SIZE: u32 = 0x100;
/// A presentation's type in a stream.
const PRESENTATION: u32 = 5;
/// A bitmap file's header, `BITMAPFILEHEADER`'s fourteen bytes.
const BITMAP_FILE_HEADER: u32 = 14;

/// An embedded or linked object's table: the `LE` exports, 200 on, and
/// the unnamed entries 1000-1005 (**measured** by `oleemb`'s `vtbl`
/// records).
pub(crate) const LE_TABLE: [u16; 39] = [
    221, 200, 201, 1005, 202, 203, 205, 206, 220, 1004, 200, 204, 207, 208, 209, 210, 211, 214,
    216, 228, 225, 218, 219, 223, 226, 227, 911, 910, 212, 213, 913, 215, 222, 1003, 1002, 1001,
    1000, 229, 224,
];

/// Paintbrush's table: an embedded or linked object's with five methods of
/// the `PB` exports in their slots -- `GetData` 811, `EnumFormats` 810,
/// `CopyToClipboard` 807, `Draw` 805, `QueryBounds` 806 (**measured** by
/// `olehnd`'s and `oleemb`'s `vtbl` records). `OLECLI`'s handler of the
/// class `PBrush` gives it an object with no picture, or whose
/// presentation is of another format than a picture's (`handlers.rs`).
pub(crate) const PB_VTBL: u16 = 0x600;
const PB_TABLE: [u16; 39] = [
    221, 200, 201, 1005, 811, 203, 205, 206, 810, 1004, 200, 204, 207, 208, 209, 210, 807, 805,
    216, 228, 225, 218, 219, 223, 226, 227, 911, 910, 212, 806, 913, 215, 222, 1003, 1002, 1001,
    1000, 229, 224,
];

/// A table laid out in `OLECLI`'s data the first time one is wanted.
fn table_at(ole: &Ole<'_>, at: u16, table: &[u16; 39]) -> u32 {
    let at = ole.near(at);

    if ole.r32(at) == 0 {
        for (index, ordinal) in table.iter().enumerate() {
            ole.w32(
                plus(at, index as u16 * 4),
                super::export_address(ole.e, *ordinal),
            );
        }
    }

    at
}

/// Its table laid out in `OLECLI`'s data the first time one is wanted.
fn vtbl(ole: &Ole<'_>) -> u32 {
    table_at(ole, LE_VTBL, &LE_TABLE)
}

/// Whether an object is an embedded or linked one of WinBox's: its table,
/// its kind's or Paintbrush's.
pub(crate) fn is_le(ole: &Ole<'_>, object: u32) -> bool {
    object != 0 && {
        let table = ole.r32(plus(object, OBJ_VTBL));

        table == ole.near(LE_VTBL) || table == ole.near(PB_VTBL)
    }
}

/// Whether an object holds Paintbrush's table.
pub(crate) fn is_pb(ole: &Ole<'_>, object: u32) -> bool {
    object != 0 && ole.r32(plus(object, OBJ_VTBL)) == ole.near(PB_VTBL)
}

/// What WinBox keeps of one, a copy.
fn le(ole: &Ole<'_>, object: u32) -> Option<Le> {
    ole.state().le.get(&object).cloned()
}

/// What WinBox keeps of one changed.
fn with<T>(ole: &Ole<'_>, object: u32, change: impl FnOnce(&mut Le) -> T) -> Option<T> {
    ole.state().le.get_mut(&object).map(change)
}

/// A format OLE's protocol registers, by its name.
fn cf(ole: &Ole<'_>, name: &str) -> u16 {
    let at = FORMATS.iter().position(|each| *each == name);

    at.and_then(|at| ole.state().formats.get(at).copied())
        .unwrap_or(0)
}

/// Whether a format is a presentation's: a picture, a bitmap, a DIB.
const fn is_picture(format: u16) -> bool {
    matches!(format, CF_METAFILEPICT | CF_BITMAP | CF_DIB)
}

const fn long(low: u16, high: u16) -> u32 {
    (high as u32) << 16 | low as u32
}

fn word(value: u16) -> [u8; 2] {
    value.to_le_bytes()
}

/// Whether an object is of the class `PBrush`, Paintbrush's: one `OLECLI`
/// keeps no picture of, its `Native` a bitmap file it draws itself -- only
/// `Native` advised and asked for, no presentation in its stream but a
/// link's `Native`, its bounds its bitmap's at its pixels to a metre, its
/// picture made as it is asked for (**recorded** by `olepbd`, whose server
/// is registered as `PBrush`, and `olepbr`, Paintbrush's own).
pub(crate) fn is_pbrush(le: &Le) -> bool {
    le.class.eq_ignore_ascii_case(b"PBrush")
}

// Objects.

async fn atom_text(ole: &Ole<'_>, atom: u16) -> R<Vec<u8>> {
    if atom == 0 {
        return Ok(Vec::new());
    }

    let at = ole.near(SCRATCH);

    ole.atom_name(atom, at, 0x100).await?;
    Ok(ole.string(at))
}

/// An embedded object's document as its server is told it: the client's
/// class, its document's file name without its path, the object's name and
/// its number, `OleDdeClient%OLEDDE.DOC%Obj1#001` (**recorded** by
/// `oledde`, each embedded object numbered as it is made, loaded, cloned
/// or pasted; links not).
async fn embedded_topic(ole: &Ole<'_>, doc: u32, name: &[u8]) -> R<Vec<u8>> {
    let class = atom_text(ole, ole.r16(plus(doc, DOC_CLASS))).await?;
    let path = atom_text(ole, ole.r16(plus(doc, DOC_NAME))).await?;
    let file = path
        .iter()
        .rposition(|byte| *byte == b'\\' || *byte == b':')
        .map_or(&path[..], |at| &path[at + 1..]);
    let serial = {
        let mut state = ole.state();

        state.serial += 1;
        state.serial
    };
    let mut topic = class;

    topic.push(b'%');
    topic.extend_from_slice(file);
    topic.push(b'%');
    topic.extend_from_slice(name);
    topic.extend_from_slice(format!("#{serial:03}").as_bytes());
    Ok(topic)
}

/// An object's block made, embedded or linked, and what WinBox keeps of
/// it.
#[allow(clippy::too_many_arguments)]
async fn new_le(
    ole: &Ole<'_>,
    kind: u32,
    client: u32,
    doc: u32,
    name: u32,
    class: Vec<u8>,
    topic: Option<Vec<u8>>,
    item: Vec<u8>,
    atom: u16,
) -> R<u32> {
    // Made as every object is, then its table its own.
    let object = new_object(ole, Kind::Gen, LE_BLOCK, client, doc, name).await?;

    if object == 0 {
        return Ok(0);
    }

    ole.w32(plus(object, OBJ_VTBL), vtbl(ole));
    ole.w32(plus(object, OBJ_TYPE), kind);
    ole.w16(plus(object, OBJ_MAPPING), 0);
    ole.w16(plus(object, OBJ_UNKNOWN_FFFF), 0);

    // A class's atom given is the object's own, let go with it (**measured**
    // by `olehnd`'s `atom` records: `DefLoadFromStream`'s object takes the
    // atom it is given); else it adds one. The class is spelled as its atom
    // is (**measured** by `olenet`).
    let class_atom = if atom == 0 {
        ole.add_atom_text(&class).await?
    } else {
        atom
    };
    let spelled = atom_text(ole, class_atom).await?;
    let topic = match topic {
        Some(topic) => topic,
        None => embedded_topic(ole, doc, &ole.string(name)).await?,
    };

    ole.state().le.insert(
        object,
        Le {
            kind,
            class: if spelled.is_empty() { class } else { spelled },
            class_atom,
            render: OLERENDER_DRAW,
            topic,
            item,
            ..Le::default()
        },
    );
    Ok(object)
}

/// Its presentation set: its bounds the object's.
fn set_picture(ole: &Ole<'_>, object: u32, picture: u32) {
    with(ole, object, |le| le.picture = picture);
    ole.state().owners.insert(picture, object);
    ole.w32(plus(object, OBJ_WIDTH), ole.r32(plus(picture, OBJ_WIDTH)));
    ole.w32(plus(object, OBJ_HEIGHT), ole.r32(plus(picture, OBJ_HEIGHT)));
}

async fn drop_picture(ole: &Ole<'_>, object: u32) -> R<()> {
    let picture = with(ole, object, |le| std::mem::take(&mut le.picture)).unwrap_or(0);

    if picture != 0 {
        ole.state().owners.remove(&picture);
        release_static(ole, kind_of(ole, picture).unwrap_or(Kind::Mf), picture).await?;
    }

    Ok(())
}

/// A presentation made from a handle of its format, its data copied: its
/// pointer, or nought.
async fn picture_from(ole: &Ole<'_>, object: u32, format: u16, handle: u16) -> R<u32> {
    let kind = match format {
        CF_METAFILEPICT => Kind::Mf,
        CF_BITMAP => Kind::Bm,
        _ => Kind::Dib,
    };
    let out = ole.near(SCRATCH + 0xf0);
    let client = ole.r32(plus(object, OBJ_CLIENT));

    ole.w32(out, 0);

    if static_from_clipboard(ole, kind, handle, client, 0, 0, out).await? != OLE_OK {
        return Ok(0);
    }

    Ok(ole.r32(out))
}

/// A Paintbrush object's bitmap file: an embedded one's `Native`, a link's
/// presentation's data.
fn bitmap_file(ole: &Ole<'_>, le: &Le) -> u16 {
    if le.kind == OT_EMBEDDED {
        return le.native;
    }

    if le.picture != 0 && kind_of(ole, le.picture) == Some(Kind::Gen) {
        ole.r16(plus(le.picture, GEN_DATA))
    } else {
        0
    }
}

/// A Paintbrush object's picture made again from its bitmap file: the DIB
/// after the file's header, its bounds the object's.
async fn refresh_view(ole: &Ole<'_>, object: u32) -> R<()> {
    let view = with(ole, object, |le| std::mem::take(&mut le.view)).unwrap_or(0);

    if view != 0 {
        ole.state().owners.remove(&view);
        release_static(ole, Kind::Dib, view).await?;
    }

    let Some(le) = le(ole, object) else {
        return Ok(());
    };
    let file = bitmap_file(ole, &le);

    if file == 0 {
        return Ok(());
    }

    let size = ole.global_size(file).await?;
    let dib = ole
        .global_alloc(GMEM_MOVEABLE, size - BITMAP_FILE_HEADER)
        .await?;
    let from = ole.global_lock(file).await?;
    let into = ole.global_lock(dib).await?;

    ole.copy(
        plus(from, BITMAP_FILE_HEADER as u16),
        into,
        size - BITMAP_FILE_HEADER,
    );
    ole.global_unlock(dib).await?;
    ole.global_unlock(file).await?;

    let view = picture_from(ole, object, CF_DIB, dib).await?;

    ole.global_free(dib).await?;

    // Its block keeps no bounds of it (**measured** by `oleemb`'s `obj` of
    // `bare`).
    if view != 0 {
        with(ole, object, |le| le.view = view);
        ole.state().owners.insert(view, object);
    }

    Ok(())
}

/// A Paintbrush object's picture made for its caller: a metafile that
/// stretches its DIB over its pixels, in a `METAFILEPICT` of
/// `MM_ANISOTROPIC` and its bounds.
async fn picture_of_view(ole: &Ole<'_>, view: u32) -> R<u16> {
    let dib = ole.r16(plus(view, DIB_DATA));
    let info = ole.global_lock(dib).await?;
    let width = ole.r16(plus(info, 4));
    let height = ole.r16(plus(info, 8));
    let bits = ole.r16(plus(info, 14));
    let used = ole.r32(plus(info, 32));
    let colours = if used != 0 {
        used
    } else if bits <= 8 {
        1 << bits
    } else {
        0
    };
    let meta = ole.gdi16("CreateMetafile", &[Arg::D(0)]).await?;

    ole.gdi("SetWindowOrg", &[Arg::W(meta), Arg::W(0), Arg::W(0)])
        .await?;
    ole.gdi(
        "SetWindowExt",
        &[Arg::W(meta), Arg::W(width), Arg::W(height)],
    )
    .await?;
    ole.gdi(
        "StretchDIBits",
        &[
            Arg::W(meta),
            Arg::W(0),
            Arg::W(0),
            Arg::W(width),
            Arg::W(height),
            Arg::W(0),
            Arg::W(0),
            Arg::W(width),
            Arg::W(height),
            Arg::D(plus(info, (ole.r32(info) + colours * 4) as u16)),
            Arg::D(info),
            Arg::W(0),
            Arg::D(SRCCOPY),
        ],
    )
    .await?;
    ole.global_unlock(dib).await?;

    let metafile = ole.gdi16("CloseMetafile", &[Arg::W(meta)]).await?;
    let handle = ole.global_alloc(GMEM_MOVEABLE | GMEM_DDESHARE, 8).await?;
    let at = ole.global_lock(handle).await?;

    ole.w16(at, MM_ANISOTROPIC);
    ole.w16(plus(at, 2), ole.r32(plus(view, OBJ_WIDTH)) as u16);
    ole.w16(
        plus(at, 4),
        (ole.r32(plus(view, OBJ_HEIGHT)) as u16).wrapping_neg(),
    );
    ole.w16(plus(at, 6), metafile);
    ole.global_unlock(handle).await?;
    Ok(handle)
}

/// A link's presentation of its class's `Native`: an object of another
/// class's, its data the block given.
async fn native_picture(ole: &Ole<'_>, object: u32, class: &[u8], block: u16) -> R<u32> {
    let client = ole.r32(plus(object, OBJ_CLIENT));
    let picture = new_object(ole, Kind::Gen, SMALL_BLOCK, client, 0, 0).await?;

    if picture == 0 {
        return Ok(0);
    }

    ole.w16(plus(picture, GEN_FORMAT), cf(ole, "Native"));
    ole.w16(plus(picture, GEN_CLASS), ole.add_atom_text(class).await?);
    ole.w32(plus(picture, GEN_SIZE), ole.global_size(block).await?);
    ole.w16(plus(picture, GEN_DATA), block);
    Ok(picture)
}

/// Everything an object holds let go, then its block.
async fn free_le(ole: &Ole<'_>, object: u32) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };

    for handle in [le.native, le.link, le.blank] {
        if handle != 0 {
            ole.global_free(handle).await?;
        }
    }

    drop_picture(ole, object).await?;

    if le.view != 0 {
        ole.state().owners.remove(&le.view);
        release_static(ole, Kind::Dib, le.view).await?;
    }

    for hwnd in [le.system, le.doc] {
        if hwnd != 0 {
            ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
        }
    }

    ole.delete_atom(le.class_atom).await?;
    ole.state().le.remove(&object);
    free_object(ole, object).await?;
    super::handlers::released(ole, object).await
}

// The client told.

/// Its client's `CallBack` called with a notification about it.
async fn tell(ole: &Ole<'_>, object: u32, what: u16) -> R<u32> {
    let client = ole.r32(plus(object, OBJ_CLIENT));
    let callback = ole.r32(ole.r32(client));

    ole.call_far(
        callback,
        &[
            GuestArg::Long(client),
            GuestArg::Word(what),
            GuestArg::Long(object),
        ],
    )
    .await
}

// Servers and conversations.

/// The server's command line the registration database gives a class:
/// `class\protocol\StdFileEditing\server`.
async fn server_of(ole: &Ole<'_>, class: &[u8]) -> R<Option<Vec<u8>>> {
    let mut key = class.to_vec();

    key.extend_from_slice(b"\\protocol\\StdFileEditing\\server");

    let at = ole.near(COMMAND_LINE);
    let size = ole.near(SCRATCH + 0xfc);

    ole.w32(size, COMMAND_SIZE);

    let found = ole
        .call(
            "SHELL",
            "RegQueryValue",
            &[
                Arg::D(HKEY_CLASSES_ROOT),
                text(&key),
                Arg::D(at),
                Arg::D(size),
            ],
        )
        .await?;

    Ok((found == 0).then(|| ole.string(at)))
}

/// Whether the registration database has a class.
pub(crate) async fn class_known(ole: &Ole<'_>, class: u32) -> R<bool> {
    let at = ole.near(COMMAND_LINE);
    let size = ole.near(SCRATCH + 0xfc);

    ole.w32(size, COMMAND_SIZE);

    Ok(ole
        .call(
            "SHELL",
            "RegQueryValue",
            &[
                Arg::D(HKEY_CLASSES_ROOT),
                Arg::D(class),
                Arg::D(at),
                Arg::D(size),
            ],
        )
        .await?
        == 0)
}

/// A class's server started: its command line, `-Embedding` and the file
/// it is to open, if any (**recorded** by `oledde`'s `srv.start`), by
/// `WinExec`. Whether it started.
async fn launch(ole: &Ole<'_>, le: &Le, show: u16, file: bool) -> R<bool> {
    let Some(mut line) = server_of(ole, &le.class).await? else {
        return Ok(false);
    };

    line.extend_from_slice(b" -Embedding ");

    if file {
        line.extend_from_slice(&le.topic);
    }

    Ok(ole.kernel("WinExec", &[text(&line), Arg::W(show)]).await? as u16 >= 32)
}

/// A window of one of `OLECLI`'s classes for a conversation, the object in
/// its window words.
async fn conv_window(ole: &Ole<'_>, class: &str, object: u32) -> R<u16> {
    let at = ole.near(CONV_CLASS);
    let mut bytes = class.as_bytes().to_vec();

    bytes.push(0);
    ole.write(at, &bytes);

    let instance = ole.state().instance;
    let hwnd = ole
        .user(
            "CreateWindow",
            &[
                Arg::D(at),
                text(b""),
                Arg::D(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(instance),
                Arg::D(0),
            ],
        )
        .await? as u16;

    if hwnd != 0 {
        ole.user("SetWindowLong", &[Arg::W(hwnd), Arg::W(0), Arg::D(object)])
            .await?;
    }

    Ok(hwnd)
}

/// `WM_DDE_INITIATE` sent to every top-level window on a class and a
/// topic, from a window of ours: the first server that answers, or nought.
/// The atoms named are deleted once it returns; those of the answer as it
/// comes.
async fn initiate(ole: &Ole<'_>, hwnd: u16, app: &[u8], topic: &[u8]) -> R<u16> {
    let a_app = ole.add_atom_text(app).await?;
    let a_topic = ole.add_atom_text(topic).await?;

    ole.state().initiating = Some((hwnd, 0));
    ole.user(
        "SendMessage",
        &[
            Arg::W(HWND_BROADCAST),
            Arg::W(WM_DDE_INITIATE),
            Arg::W(hwnd),
            Arg::D(long(a_app, a_topic)),
        ],
    )
    .await?;

    let server = ole
        .state()
        .initiating
        .take()
        .map_or(0, |(_, server)| server);

    ole.delete_atom(a_app).await?;
    ole.delete_atom(a_topic).await?;
    Ok(server)
}

/// The server's system topic reached: `OLEsystem`, then `System`; where
/// none answers and a server may be started, the class's server launched
/// and both asked again (**recorded** by `oledde`: a running server is
/// asked without a launch).
async fn connect_system(ole: &Ole<'_>, object: u32, show: Option<u16>) -> R<bool> {
    let hwnd = conv_window(ole, "OleSrvrWndClass", object).await?;
    let Some(le) = le(ole, object) else {
        return Ok(false);
    };

    for attempt in 0..2 {
        for topic in [&b"OLEsystem"[..], b"System"] {
            let server = initiate(ole, hwnd, &le.class, topic).await?;

            if server != 0 {
                with(ole, object, |le| {
                    le.system = hwnd;
                    le.system_server = server;
                });
                return Ok(true);
            }
        }

        let launched = match show {
            Some(show) if attempt == 0 => launch(ole, &le, show, false).await?,
            _ => false,
        };

        if !launched {
            break;
        }
    }

    ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
    Ok(false)
}

/// The object's document reached as a topic of its class; for a link, its
/// server launched with its file where none answers.
async fn connect_doc(ole: &Ole<'_>, object: u32, show: Option<u16>) -> R<bool> {
    let hwnd = conv_window(ole, "OleDocWndClass", object).await?;
    let Some(le) = le(ole, object) else {
        return Ok(false);
    };

    for attempt in 0..2 {
        let server = initiate(ole, hwnd, &le.class, &le.topic).await?;

        if server != 0 {
            with(ole, object, |le| {
                le.doc = hwnd;
                le.doc_server = server;
            });
            return Ok(true);
        }

        let launched = match show {
            Some(show) if attempt == 0 => launch(ole, &le, show, true).await?,
            _ => false,
        };

        if !launched {
            break;
        }
    }

    ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
    Ok(false)
}

const fn server_of_conv(le: &Le, conv: Conv) -> u16 {
    match conv {
        Conv::System => le.system_server,
        Conv::Doc => le.doc_server,
    }
}

const fn window_of_conv(le: &Le, conv: Conv) -> u16 {
    match conv {
        Conv::System => le.system,
        Conv::Doc => le.doc,
    }
}

async fn post(ole: &Ole<'_>, to: u16, message: u16, from: u16, lparam: u32) -> R<bool> {
    Ok(ole
        .user(
            "PostMessage",
            &[Arg::W(to), Arg::W(message), Arg::W(from), Arg::D(lparam)],
        )
        .await? as u16
        != 0)
}

/// A conversation's window let go, the conversation forgotten.
async fn end_conv(ole: &Ole<'_>, object: u32, conv: Conv) -> R<()> {
    let hwnd = with(ole, object, |le| match conv {
        Conv::System => {
            le.system_server = 0;
            std::mem::take(&mut le.system)
        }
        Conv::Doc => {
            le.doc_server = 0;
            std::mem::take(&mut le.doc)
        }
    })
    .unwrap_or(0);

    if hwnd != 0 {
        ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
    }

    Ok(())
}

/// A block of `GMEM_DDESHARE` holding bytes: its handle.
async fn shared_block(ole: &Ole<'_>, bytes: &[u8]) -> R<u16> {
    let handle = ole
        .global_alloc(GMEM_MOVEABLE | GMEM_DDESHARE, bytes.len() as u32)
        .await?;
    let at = ole.global_lock(handle).await?;

    ole.write(at, bytes);
    ole.global_unlock(handle).await?;
    Ok(handle)
}

// Steps.

/// A conversation begun: the object busy until its steps are done.
async fn begin(ole: &Ole<'_>, object: u32, steps: Vec<Step>) -> R<()> {
    with(ole, object, |le| {
        le.busy = true;
        le.error = 0;
        le.queue = VecDeque::from(steps);
        le.waiting = None;
    });
    advance(ole, object).await
}

/// The steps taken until one waits for its server, or none is left.
async fn advance(ole: &Ole<'_>, object: u32) -> R<()> {
    loop {
        let step = {
            let mut state = ole.state();
            let Some(le) = state.le.get_mut(&object) else {
                return Ok(());
            };

            if le.waiting.is_some() {
                return Ok(());
            }

            let Some(step) = le.queue.pop_front() else {
                return Ok(());
            };

            if le.error != 0
                && !matches!(
                    step,
                    Step::Terminate(_) | Step::Reply(_) | Step::Release { .. }
                )
            {
                continue;
            }

            step
        };

        take(ole, object, step).await?;
    }
}

fn set_error(ole: &Ole<'_>, object: u32, error: u16) {
    with(ole, object, |le| le.error = error);
}

fn wait(ole: &Ole<'_>, object: u32, step: Step) {
    with(ole, object, |le| le.waiting = Some(step));
}

#[allow(clippy::too_many_lines)]
async fn take(ole: &Ole<'_>, object: u32, step: Step) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };

    match step {
        Step::Execute {
            conv,
            text: command,
            error,
            ..
        } => {
            let mut bytes = command.clone();

            bytes.push(0);

            let handle = shared_block(ole, &bytes).await?;

            if !post(
                ole,
                server_of_conv(&le, conv),
                WM_DDE_EXECUTE,
                window_of_conv(&le, conv),
                long(0, handle),
            )
            .await?
            {
                ole.global_free(handle).await?;
                set_error(ole, object, error);
                return Ok(());
            }

            wait(
                ole,
                object,
                Step::Execute {
                    conv,
                    text: command,
                    error,
                    handle,
                },
            );
        }

        Step::Initiate => {
            if !connect_doc(ole, object, None).await? {
                set_error(ole, object, OLE_ERROR_COMM);
            }
        }

        Step::Poke {
            item,
            format,
            data,
            error,
            ..
        } => {
            let mut bytes = Vec::new();

            bytes.extend_from_slice(&word(0));
            bytes.extend_from_slice(&word(format));
            bytes.extend_from_slice(&data);

            let handle = shared_block(ole, &bytes).await?;
            let atom = ole.add_atom_text(&item).await?;

            if !post(ole, le.doc_server, WM_DDE_POKE, le.doc, long(handle, atom)).await? {
                ole.global_free(handle).await?;
                ole.delete_atom(atom).await?;
                set_error(ole, object, error);
                return Ok(());
            }

            wait(
                ole,
                object,
                Step::Poke {
                    item,
                    format,
                    data,
                    error,
                    handle,
                },
            );
        }

        Step::Advise {
            item,
            format,
            error,
            ..
        } => {
            let mut bytes = word(ADVISE_ACK_REQ).to_vec();

            bytes.extend_from_slice(&word(format));

            let handle = shared_block(ole, &bytes).await?;
            let atom = ole.add_atom_text(&item).await?;

            if !post(
                ole,
                le.doc_server,
                WM_DDE_ADVISE,
                le.doc,
                long(handle, atom),
            )
            .await?
            {
                ole.global_free(handle).await?;
                ole.delete_atom(atom).await?;
                set_error(ole, object, error);
                return Ok(());
            }

            wait(
                ole,
                object,
                Step::Advise {
                    item,
                    format,
                    error,
                    handle,
                },
            );
        }

        Step::Request {
            item,
            format,
            error,
        } => {
            let atom = ole.add_atom_text(&item).await?;

            if !post(
                ole,
                le.doc_server,
                WM_DDE_REQUEST,
                le.doc,
                long(format, atom),
            )
            .await?
            {
                ole.delete_atom(atom).await?;
                set_error(ole, object, error);
                return Ok(());
            }

            wait(
                ole,
                object,
                Step::Request {
                    item,
                    format,
                    error,
                },
            );
        }

        Step::Terminate(conv) => {
            if window_of_conv(&le, conv) == 0 {
                return Ok(());
            }

            if !post(
                ole,
                server_of_conv(&le, conv),
                WM_DDE_TERMINATE,
                window_of_conv(&le, conv),
                0,
            )
            .await?
            {
                end_conv(ole, object, conv).await?;
                return Ok(());
            }

            wait(ole, object, Step::Terminate(conv));
        }

        Step::Reply(conv) => {
            if window_of_conv(&le, conv) != 0 {
                post(
                    ole,
                    server_of_conv(&le, conv),
                    WM_DDE_TERMINATE,
                    window_of_conv(&le, conv),
                    0,
                )
                .await?;
                end_conv(ole, object, conv).await?;
            }
        }

        Step::Notify(what) => {
            tell(ole, object, what).await?;
        }

        Step::Release {
            method,
            free,
            silent,
        } => {
            with(ole, object, |le| {
                le.busy = false;
                le.method = method;
            });

            if !silent {
                tell(ole, object, OLE_RELEASE).await?;
            }

            set_error(ole, object, 0);

            if free {
                free_le(ole, object).await?;
            }
        }
    }

    Ok(())
}

/// A step's answer come: the step done, and the next taken.
async fn step_done(ole: &Ole<'_>, object: u32, error: u16) -> R<()> {
    with(ole, object, |le| {
        if error != 0 {
            le.error = error;
        }

        le.waiting = None;
    });
    advance(ole, object).await
}

// Data the server gives.

/// Data come from the server in a format: `Native` kept as the object's
/// (a block of what came, its size the block's less the `DDEDATA`
/// header's four bytes) or a link's presentation; a picture, a bitmap or
/// a DIB made the object's presentation.
async fn store(ole: &Ole<'_>, object: u32, format: u16, h_data: u16) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };
    let at = ole.global_lock(h_data).await?;
    let size = ole.global_size(h_data).await? - 4;

    if format == cf(ole, "Native") {
        let handle = ole
            .global_alloc(GMEM_MOVEABLE | GMEM_DDESHARE, size)
            .await?;
        let into = ole.global_lock(handle).await?;

        ole.copy(plus(at, 4), into, size);
        ole.global_unlock(handle).await?;

        if le.kind == OT_LINK {
            let picture = native_picture(ole, object, &le.class, handle).await?;

            if picture != 0 {
                drop_picture(ole, object).await?;
                set_picture(ole, object, picture);
            }
        } else {
            if le.native != 0 {
                ole.global_free(le.native).await?;
            }

            with(ole, object, |le| le.native = handle);
        }

        if is_pb(ole, object) {
            refresh_view(ole, object).await?;
        }
    } else if is_picture(format) {
        let handle = ole.r16(plus(at, 4));
        let picture = picture_from(ole, object, format, handle).await?;

        if picture != 0 {
            drop_picture(ole, object).await?;
            set_picture(ole, object, picture);
        }
    }

    ole.global_unlock(h_data).await?;
    Ok(())
}

/// What a server's data held let go: its picture's metafile, its block,
/// the data's block.
async fn free_data(ole: &Ole<'_>, format: u16, h_data: u16) -> R<()> {
    let at = ole.global_lock(h_data).await?;

    match format {
        CF_METAFILEPICT => {
            let picture = ole.r16(plus(at, 4));
            let inside = ole.global_lock(picture).await?;

            ole.gdi("DeleteMetafile", &[Arg::W(ole.r16(plus(inside, 6)))])
                .await?;
            ole.global_unlock(picture).await?;
            ole.global_free(picture).await?;
        }
        CF_BITMAP => {
            ole.gdi("DeleteObject", &[Arg::W(ole.r16(plus(at, 4)))])
                .await?;
        }
        CF_DIB => {
            ole.global_free(ole.r16(plus(at, 4))).await?;
        }
        _ => {}
    }

    ole.global_unlock(h_data).await?;
    ole.global_free(h_data).await?;
    Ok(())
}

// The window procedures.

/// `DOCWNDPROC` (100) and `SRVRWNDPROC` (101): a conversation's window,
/// a document's or a server's system topic's. What its server posts it is
/// the answer the object's step waits for, or the server telling it its
/// object changed, was saved or closed.
pub(crate) async fn conv_proc(
    ole: &Ole<'_>,
    hwnd: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<u32> {
    if !(WM_DDE_INITIATE..=WM_DDE_EXECUTE).contains(&message) {
        return ole
            .user(
                "DefWindowProc",
                &[
                    Arg::W(hwnd),
                    Arg::W(message),
                    Arg::W(w_param),
                    Arg::D(l_param),
                ],
            )
            .await;
    }

    let low = l_param as u16;
    let high = (l_param >> 16) as u16;
    let initiating = ole.state().initiating;

    if message == WM_DDE_ACK
        && let Some((from, server)) = initiating
        && from == hwnd
    {
        if server == 0 {
            ole.state().initiating = Some((from, w_param));
        }

        ole.delete_atom(low).await?;
        ole.delete_atom(high).await?;
        return Ok(0);
    }

    if ole.state().locks.contains_key(&hwnd) {
        if message == WM_DDE_TERMINATE {
            ole.state().locks.remove(&hwnd);
            ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
        }

        return Ok(0);
    }

    let object = ole
        .user("GetWindowLong", &[Arg::W(hwnd), Arg::W(0)])
        .await?;
    let conv = le(ole, object).and_then(|le| {
        if hwnd == le.system {
            Some(Conv::System)
        } else if hwnd == le.doc {
            Some(Conv::Doc)
        } else {
            None
        }
    });
    let Some(conv) = conv else {
        if message == WM_DDE_TERMINATE {
            ole.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
        }

        return Ok(0);
    };

    match message {
        WM_DDE_ACK => acked(ole, object, low, high).await?,
        WM_DDE_DATA => data(ole, object, conv, low, high).await?,
        WM_DDE_TERMINATE => terminated(ole, object, conv).await?,
        _ => {}
    }

    Ok(0)
}

/// `WM_DDE_ACK`: the step waiting answered, its blocks and atom let go.
async fn acked(ole: &Ole<'_>, object: u32, status: u16, high: u16) -> R<()> {
    let step = le(ole, object).and_then(|le| le.waiting);
    let positive = status & ACK_POSITIVE != 0;
    let failed = |error: u16| if positive { 0 } else { error };

    match step {
        Some(Step::Execute { handle, error, .. }) => {
            ole.global_free(handle).await?;
            step_done(ole, object, failed(error)).await
        }
        Some(Step::Poke { handle, error, .. }) => {
            ole.global_free(handle).await?;
            ole.delete_atom(high).await?;
            step_done(ole, object, failed(error)).await
        }
        Some(Step::Advise { handle, error, .. }) => {
            if !positive {
                ole.global_free(handle).await?;
            }

            ole.delete_atom(high).await?;
            step_done(ole, object, failed(error)).await
        }
        Some(Step::Request { error, .. }) => {
            ole.delete_atom(high).await?;
            step_done(ole, object, failed(error)).await
        }
        _ => {
            ole.delete_atom(high).await?;
            Ok(())
        }
    }
}

/// The format whose coming tells the client: the picture's, or a
/// Paintbrush object's `Native`.
fn notified(ole: &Ole<'_>, le: &Le) -> u16 {
    if is_pbrush(le) {
        cf(ole, "Native")
    } else {
        CF_METAFILEPICT
    }
}

/// `WM_DDE_DATA`: data asked for by the step waiting; or an item the
/// server was advised on -- `/Save` and `/Close` of an embedded object's,
/// a link's item and `StdDocumentName` -- each format kept, acknowledged
/// where it asks (but not as the server closes, `/Close`), and its client
/// told once its presentation comes: `OLE_SAVED` for `/Save`, else
/// `OLE_CHANGED`. Data of none (`hData` nought) is a change told with
/// nothing to keep (**recorded** by `oledde`).
async fn data(ole: &Ole<'_>, object: u32, conv: Conv, h_data: u16, atom: u16) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };
    let server = server_of_conv(&le, conv);
    let hwnd = window_of_conv(&le, conv);
    let (flags, format) = if h_data == 0 {
        (0, 0)
    } else {
        let at = ole.global_lock(h_data).await?;
        let read = (ole.r16(at), ole.r16(plus(at, 2)));

        ole.global_unlock(h_data).await?;
        read
    };

    if matches!(le.waiting, Some(Step::Request { .. })) && flags & DATA_RESPONSE != 0 {
        store(ole, object, format, h_data).await?;

        if flags & DATA_ACK_REQ != 0 {
            post(ole, server, WM_DDE_ACK, hwnd, long(ACK_POSITIVE, atom)).await?;
        } else {
            ole.delete_atom(atom).await?;
        }

        if flags & DATA_RELEASE != 0 {
            free_data(ole, format, h_data).await?;
        }

        return step_done(ole, object, 0).await;
    }

    let name = atom_text(ole, atom).await?;
    let when = name
        .iter()
        .position(|byte| *byte == b'/')
        .map_or_else(Vec::new, |at| name[at + 1..].to_ascii_lowercase());

    if h_data == 0 {
        ole.delete_atom(atom).await?;
        tell(ole, object, OLE_CHANGED).await?;
        return Ok(());
    }

    store(ole, object, format, h_data).await?;

    if flags & DATA_ACK_REQ != 0 && when != b"close" {
        post(ole, server, WM_DDE_ACK, hwnd, long(ACK_POSITIVE, atom)).await?;
    } else {
        ole.delete_atom(atom).await?;
    }

    if flags & DATA_RELEASE != 0 {
        free_data(ole, format, h_data).await?;
    }

    if format == notified(ole, &le) {
        let what = if when == b"save" {
            OLE_SAVED
        } else {
            OLE_CHANGED
        };

        tell(ole, object, what).await?;
    }

    Ok(())
}

/// `WM_DDE_TERMINATE`: the answer to the step's own, its window let go; or
/// the server ending the conversation. An embedded object's document so
/// ended tells its client `OLE_CLOSED`, then closes as `OleClose` does --
/// `[StdCloseDocument]`, its terminate answered, the system topic's ended
/// -- busy until done but telling no release; a link's is answered and
/// forgotten (**recorded** by `oledde`'s `server close`).
async fn terminated(ole: &Ole<'_>, object: u32, conv: Conv) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };

    if matches!(le.waiting, Some(Step::Terminate(waiting)) if waiting == conv) {
        end_conv(ole, object, conv).await?;
        return step_done(ole, object, 0).await;
    }

    if conv == Conv::Doc && le.kind == OT_EMBEDDED && !le.busy {
        tell(ole, object, OLE_CLOSED).await?;
        return begin(
            ole,
            object,
            vec![
                execute_step(Conv::Doc, b"[StdCloseDocument]", OLE_ERROR_COMMAND),
                Step::Reply(Conv::Doc),
                Step::Terminate(Conv::System),
                Step::Release {
                    method: OLE_CLOSE,
                    free: false,
                    silent: true,
                },
            ],
        )
        .await;
    }

    post(
        ole,
        server_of_conv(&le, conv),
        WM_DDE_TERMINATE,
        window_of_conv(&le, conv),
        0,
    )
    .await?;
    end_conv(ole, object, conv).await
}

// What each conversation is.

fn execute_step(conv: Conv, text: &[u8], error: u16) -> Step {
    Step::Execute {
        conv,
        text: text.to_vec(),
        error,
        handle: 0,
    }
}

const fn release_step(method: u16) -> Step {
    Step::Release {
        method,
        free: false,
        silent: false,
    }
}

fn advise(item: &[u8], format: u16, error: u16) -> Step {
    Step::Advise {
        item: item.to_vec(),
        format,
        error,
        handle: 0,
    }
}

fn request(item: &[u8], format: u16, error: u16) -> Step {
    Step::Request {
        item: item.to_vec(),
        format,
        error,
    }
}

fn quote(bytes: &[u8]) -> Vec<u8> {
    let mut out = vec![b'"'];

    out.extend_from_slice(bytes);
    out.push(b'"');
    out
}

const fn boolean(value: bool) -> &'static [u8] {
    if value { b"TRUE" } else { b"FALSE" }
}

/// The formats an embedded object is advised on, each on `/Save` and
/// `/Close`: `Native` and a picture, but for Paintbrush's (**recorded** by
/// `oledde` and `olepbd`).
fn embedded_advises(ole: &Ole<'_>, le: &Le) -> Vec<Step> {
    let mut steps = Vec::new();

    for when in [&b"/Save"[..], b"/Close"] {
        steps.push(advise(when, cf(ole, "Native"), OLE_ERROR_ADVISE_NATIVE));

        // A Paintbrush object's picture is its own (`is_pbrush`).
        if !is_pbrush(le) {
            steps.push(advise(when, CF_METAFILEPICT, OLE_ERROR_ADVISE_PICT));
        }
    }

    steps
}

/// What an embedded object's data is asked for in: `Native`, then a
/// picture but for Paintbrush's.
fn embedded_requests(ole: &Ole<'_>, le: &Le) -> Vec<Step> {
    let mut steps = vec![request(b"", cf(ole, "Native"), OLE_ERROR_REQUEST_NATIVE)];

    if !is_pbrush(le) {
        steps.push(request(b"", CF_METAFILEPICT, OLE_ERROR_REQUEST_PICT));
    }

    steps
}

/// The format a link's item is advised on and asked for: a picture, or a
/// Paintbrush link's `Native`.
fn link_format(ole: &Ole<'_>, le: &Le) -> u16 {
    if is_pbrush(le) {
        cf(ole, "Native")
    } else {
        CF_METAFILEPICT
    }
}

/// A link's item advised and `StdDocumentName` in `Binary`, then its
/// item asked for and its client told it changed.
fn link_advises(ole: &Ole<'_>, le: &Le) -> Vec<Step> {
    vec![
        advise(&le.item, link_format(ole, le), OLE_ERROR_ADVISE_PICT),
        advise(
            b"StdDocumentName",
            cf(ole, "Binary"),
            OLE_ERROR_ADVISE_RENAME,
        ),
        request(&le.item, link_format(ole, le), OLE_ERROR_REQUEST_PICT),
        Step::Notify(OLE_CHANGED),
    ]
}

/// What an embedded object's server is given as it is opened to edit: its
/// data, then what its client set (**recorded** by `oledde`, in this
/// order).
fn edits(ole: &Ole<'_>, le: &Le, data: Option<Vec<u8>>) -> Vec<Step> {
    let mut steps = Vec::new();
    let binary = cf(ole, "Binary");

    if let Some(data) = data {
        steps.push(Step::Poke {
            item: Vec::new(),
            format: cf(ole, "Native"),
            data,
            error: OLE_ERROR_POKE_NATIVE,
            handle: 0,
        });
    }

    for (item, bytes) in [
        (&b"StdHostNames"[..], &le.host_names),
        (b"StdTargetDevice", &le.target),
        (b"StdDocDimensions", &le.dims),
        (b"StdColorScheme", &le.scheme),
    ] {
        if let Some(bytes) = bytes {
            steps.push(Step::Poke {
                item: item.to_vec(),
                format: binary,
                data: bytes.clone(),
                error: OLE_ERROR_POKE_NATIVE,
                handle: 0,
            });
        }
    }

    steps
}

/// A block's bytes.
async fn block_bytes(ole: &Ole<'_>, handle: u16) -> R<Vec<u8>> {
    let size = ole.global_size(handle).await?;
    let at = ole.global_lock(handle).await?;
    let bytes = ole.read(at, size as usize);

    ole.global_unlock(handle).await?;
    Ok(bytes)
}

/// `[StdDoVerbItem("item",verb,show,!focus)]`: the fourth is TRUE where the
/// focus is not to be taken (**recorded** by `oledde`).
fn do_verb(le: &Le, verb: u16, show: u16, focus: u16) -> Vec<u8> {
    let mut out = b"[StdDoVerbItem(".to_vec();

    out.extend_from_slice(&quote(&le.item));
    out.push(b',');
    out.extend_from_slice(verb.to_string().as_bytes());
    out.push(b',');
    out.extend_from_slice(boolean(show != 0));
    out.push(b',');
    out.extend_from_slice(boolean(focus == 0));
    out.extend_from_slice(b")]");
    out
}

// Making them.

/// `DefCreate` (`OleCreate` with `StdFileEditing`): an embedded object of
/// the class, its server reached or launched shown, then
/// `[StdNewDocument("class","doc")]` on its system topic -- from a
/// template, the documented `StdNewFromTemplate` with the template's file
/// (the OLE 1.0 programmer's reference; `unrecorded` on the client's side,
/// the server's measured by `olesrv`) -- its document's conversation
/// begun, `/Save` and `/Close` advised, `[StdShowItem("")]`; released
/// `OLE_CREATE`. A server that cannot be started is `OLE_ERROR_LAUNCH`.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create(
    ole: &Ole<'_>,
    client: u32,
    class: Vec<u8>,
    doc: u32,
    name: u32,
    out: u32,
    activate: bool,
    render: u16,
    template: Option<Vec<u8>>,
) -> R<u16> {
    let object = new_le(
        ole,
        OT_EMBEDDED,
        client,
        doc,
        name,
        class,
        None,
        Vec::new(),
        0,
    )
    .await?;

    if object == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    with(ole, object, |le| le.render = render);
    ole.w32(out, object);

    if !activate {
        return Ok(OLE_OK);
    }

    if !connect_system(ole, object, Some(SW_SHOWNORMAL)).await? {
        free_le(ole, object).await?;
        ole.w32(out, 0);
        return Ok(OLE_ERROR_LAUNCH);
    }

    let le = le(ole, object).unwrap_or_default();
    let mut command = if template.is_some() {
        b"[StdNewFromTemplate(".to_vec()
    } else {
        b"[StdNewDocument(".to_vec()
    };

    command.extend_from_slice(&quote(&le.class));
    command.push(b',');
    command.extend_from_slice(&quote(&le.topic));

    if let Some(template) = template {
        command.push(b',');
        command.extend_from_slice(&quote(&template));
    }

    command.extend_from_slice(b")]");

    let mut steps = vec![
        execute_step(Conv::System, &command, OLE_ERROR_NEW),
        Step::Initiate,
    ];

    steps.extend(embedded_advises(ole, &le));
    steps.push(execute_step(
        Conv::Doc,
        b"[StdShowItem(\"\")]",
        OLE_ERROR_COMMAND,
    ));
    steps.push(release_step(OLE_CREATE));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `DefCreateFromFile` and `DefCreateLinkFromFile` (`OleCreateFromFile`
/// and `OleCreateLinkFromFile` with `StdFileEditing`): the file's document
/// reached as a topic of the class, its server launched hidden with the
/// file where none answers; an embedded object asks for its data, a link
/// advises its item and `StdDocumentName` and asks for its item; its client
/// told it changed, the conversation ended; released `OLE_CREATEFROMFILE`
/// or `OLE_CREATELINKFROMFILE` (**recorded** by `oledde`). An embedded
/// object is numbered only once it is reached (**measured** by `olehnd`:
/// one whose server cannot be started takes no number).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_from_file(
    ole: &Ole<'_>,
    client: u32,
    class: u32,
    file: u32,
    item: u32,
    doc: u32,
    name: u32,
    out: u32,
    linked: bool,
    render: u16,
) -> R<u16> {
    let object = new_le(
        ole,
        if linked { OT_LINK } else { OT_EMBEDDED },
        client,
        doc,
        name,
        ole.string(class),
        Some(ole.string(file)),
        if linked && item != 0 {
            ole.string(item)
        } else {
            Vec::new()
        },
        0,
    )
    .await?;

    if object == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    with(ole, object, |le| le.render = render);

    // An embedded object's server is told the file.
    if !connect_doc(ole, object, Some(SW_HIDE)).await? {
        free_le(ole, object).await?;
        return Ok(OLE_ERROR_LAUNCH);
    }

    if !linked {
        let topic = embedded_topic(ole, doc, &ole.string(name)).await?;

        with(ole, object, |le| le.topic = topic);
    }

    ole.w32(out, object);

    let le = le(ole, object).unwrap_or_default();
    let mut steps = if linked {
        link_advises(ole, &le)
    } else {
        let mut steps = embedded_requests(ole, &le);

        steps.push(Step::Notify(OLE_CHANGED));
        steps
    };

    steps.push(Step::Terminate(Conv::Doc));
    steps.push(release_step(if linked {
        OLE_CREATELINKFROMFILE
    } else {
        OLE_CREATEFROMFILE
    }));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// The class `OwnerLink` or `ObjectLink` on the clipboard names; none for
/// none.
pub(crate) async fn clip_class(ole: &Ole<'_>, linked: bool) -> R<Option<Vec<u8>>> {
    let format = cf(ole, if linked { "ObjectLink" } else { "OwnerLink" });
    let owner = ole.user("GetClipboardData", &[Arg::W(format)]).await? as u16;

    if owner == 0 {
        return Ok(None);
    }

    Ok(Some(link_parts(ole, owner).await?.0))
}

/// A clipboard's block of `OwnerLink` or `ObjectLink`: its class,
/// document and item.
async fn link_parts(ole: &Ole<'_>, handle: u16) -> R<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let at = ole.global_lock(handle).await?;
    let class = ole.string(at);
    let doc = ole.string(plus(at, class.len() as u16 + 1));
    let item = ole.string(plus(at, (class.len() + doc.len()) as u16 + 2));

    ole.global_unlock(handle).await?;
    Ok((class, doc, item))
}

/// `DefCreateFromClip` and `DefCreateLinkFromClip` (`OleCreateFromClip`
/// and `OleCreateLinkFromClip` with `StdFileEditing`): an embedded object
/// of `OwnerLink`'s class and item with the clipboard's `Native`, or a link
/// to `ObjectLink`'s document and item; each with the clipboard's first
/// picture, none where it is to render none, or the format it is to render
/// -- its class's `Native` a presentation of that format. No server is
/// asked (**recorded** by `oledde`'s `clip`, **measured** by `olehnd`'s
/// `clip none`; Paintbrush's handler asks a link for `Native` and an
/// embedded object for none, `OLECLI.DLL` seg7 `00ac`-`0176`).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn from_clip(
    ole: &Ole<'_>,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
    linked: bool,
    render: u16,
    format: u16,
) -> R<u16> {
    let owner_format = cf(ole, if linked { "ObjectLink" } else { "OwnerLink" });
    let owner = ole
        .user("GetClipboardData", &[Arg::W(owner_format)])
        .await? as u16;

    if owner == 0 {
        return Ok(OLE_ERROR_FORMAT);
    }

    let (class, file, item) = link_parts(ole, owner).await?;
    let object = new_le(
        ole,
        if linked { OT_LINK } else { OT_EMBEDDED },
        client,
        doc,
        name,
        class,
        linked.then_some(file),
        item,
        0,
    )
    .await?;

    if object == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    with(ole, object, |le| le.render = render);

    let native_format = cf(ole, "Native");

    if !linked {
        let native = ole
            .user("GetClipboardData", &[Arg::W(native_format)])
            .await? as u16;

        if native != 0 {
            let copy = copy_block(ole, native).await?;

            with(ole, object, |le| le.native = copy);
        }
    }

    let mut each = 0;

    if render == OLERENDER_FORMAT {
        each = format;
    } else if render != OLERENDER_NONE {
        loop {
            each = ole.user("EnumClipboardFormats", &[Arg::W(each)]).await? as u16;

            if each == 0 || is_picture(each) {
                break;
            }
        }
    }

    if each != 0 {
        let handle = ole.user("GetClipboardData", &[Arg::W(each)]).await? as u16;
        let picture = if handle == 0 {
            0
        } else if each == native_format {
            let copy = copy_block(ole, handle).await?;
            let class = le(ole, object).unwrap_or_default().class;

            native_picture(ole, object, &class, copy).await?
        } else if is_picture(each) {
            picture_from(ole, object, each, handle).await?
        } else {
            0
        };

        if picture != 0 {
            set_picture(ole, object, picture);
        }
    }

    ole.w32(out, object);
    Ok(OLE_OK)
}

// Streams.

/// A length and a string, or a length of nought for none.
async fn put_string(ole: &Ole<'_>, stream: u32, bytes: &[u8]) -> R<bool> {
    if bytes.is_empty() {
        put_long(ole, stream, 0).await
    } else {
        put_name(ole, stream, bytes).await
    }
}

async fn get_string(ole: &Ole<'_>, stream: u32) -> R<Option<Vec<u8>>> {
    let Some(length) = get_long(ole, stream).await? else {
        return Ok(None);
    };

    if length > 0x100 {
        return Ok(None);
    }

    if length == 0 {
        return Ok(Some(Vec::new()));
    }

    let at = ole.near(SCRATCH);

    Ok(get(ole, stream, at, length).await?.then(|| ole.string(at)))
}

/// `LESAVETOSTREAM` (207): 0501h, the type, the class, the document and
/// the item -- an embedded object's none -- then an embedded object's
/// `Native`, its size and bytes, or a link's network name (none), a
/// doubleword nought and its update option; then its presentation as a
/// static object's is written but of type 5, or 0501h and nought for none
/// (**recorded** by `oledde` and `olepbr`).
async fn save_to_stream(ole: &Ole<'_>, object: u32, stream: u32) -> R<u16> {
    let Some(le) = le(ole, object) else {
        return Ok(OLE_ERROR_OBJECT);
    };
    let embedded = le.kind == OT_EMBEDDED;
    let mut ok = put_long(ole, stream, STREAM_VERSION).await?
        && put_long(ole, stream, le.kind).await?
        && put_name(ole, stream, &le.class).await?
        && put_string(ole, stream, if embedded { &[] } else { &le.topic }).await?
        && put_string(ole, stream, &le.item).await?;

    if ok && embedded {
        let size = if le.native == 0 {
            0
        } else {
            ole.global_size(le.native).await?
        };

        ok = put_long(ole, stream, size).await?;

        if ok && size != 0 {
            let at = ole.global_lock(le.native).await?;

            ok = put(ole, stream, at, size).await?;
            ole.global_unlock(le.native).await?;
        }
    } else if ok {
        ok = put_string(ole, stream, &le.network).await?
            && put_long(ole, stream, 0).await?
            && put_long(ole, stream, u32::from(le.update)).await?;
    }

    if !ok {
        return Ok(OLE_ERROR_STREAM);
    }

    if le.picture == 0 {
        return Ok(
            if put_long(ole, stream, STREAM_VERSION).await? && put_long(ole, stream, 0).await? {
                OLE_OK
            } else {
                OLE_ERROR_STREAM
            },
        );
    }

    let kind = kind_of(ole, le.picture).unwrap_or(Kind::Mf);

    save_typed(ole, kind, le.picture, stream, PRESENTATION).await
}

/// A stream's class's name, read after its version and type:
/// `OleLoadFromStream` reads it before it finds the class's handler.
pub(crate) async fn get_class(ole: &Ole<'_>, stream: u32) -> R<Option<Vec<u8>>> {
    Ok(get_string(ole, stream)
        .await?
        .filter(|class| !class.is_empty()))
}

/// `DefLoadFromStream`: an embedded (2) or linked (1) object of the class
/// given, the stream read on from after its class's name -- what
/// `LESAVETOSTREAM` writes read back. An embedded object is numbered as it
/// is loaded. The class's atom given is the object's.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn load(
    ole: &Ole<'_>,
    stream: u32,
    kind: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
    class: Vec<u8>,
    atom: u16,
) -> R<u16> {
    let topic = get_string(ole, stream).await?;
    let item = match topic {
        Some(_) => get_string(ole, stream).await?,
        None => None,
    };
    let (Some(topic), Some(item)) = (topic, item) else {
        ole.delete_atom(atom).await?;
        return Ok(OLE_ERROR_STREAM);
    };

    if class.is_empty() {
        ole.delete_atom(atom).await?;
        return Ok(OLE_ERROR_STREAM);
    }

    let object = new_le(
        ole,
        kind,
        client,
        doc,
        name,
        class,
        (kind == OT_LINK).then_some(topic),
        item,
        atom,
    )
    .await?;

    if object == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    if !read_rest(ole, stream, kind, object).await? {
        free_le(ole, object).await?;
        return Ok(OLE_ERROR_STREAM);
    }

    ole.w32(out, object);
    Ok(OLE_OK)
}

/// The rest of an object's stream after its item: whether it all came.
async fn read_rest(ole: &Ole<'_>, stream: u32, kind: u32, object: u32) -> R<bool> {
    if kind == OT_EMBEDDED {
        let Some(size) = get_long(ole, stream).await? else {
            return Ok(false);
        };

        if size != 0 {
            let native = read_block(ole, stream, size).await?;

            if native == 0 {
                return Ok(false);
            }

            with(ole, object, |le| le.native = native);
        }
    } else {
        let Some(network) = get_string(ole, stream).await? else {
            return Ok(false);
        };

        if get_long(ole, stream).await?.is_none() {
            return Ok(false);
        }

        let Some(update) = get_long(ole, stream).await? else {
            return Ok(false);
        };

        with(ole, object, |le| {
            le.update = update as u16;
            le.network = network;
        });
    }

    if get_long(ole, stream).await?.is_none() {
        return Ok(false);
    }

    let Some(presentation) = get_long(ole, stream).await? else {
        return Ok(false);
    };

    if presentation == 0 {
        return Ok(true);
    }

    let Some(named) = get_string(ole, stream).await? else {
        return Ok(false);
    };

    if named.is_empty() {
        return Ok(false);
    }

    let which = [Kind::Mf, Kind::Bm, Kind::Dib]
        .into_iter()
        .find(|kind| class_of(*kind) == &named[..])
        .unwrap_or(Kind::Gen);
    let client = ole.r32(plus(object, OBJ_CLIENT));
    let picture = new_object(ole, which, block_of(which), client, 0, 0).await?;

    if picture == 0 {
        return Ok(false);
    }

    let read = if which == Kind::Gen {
        let atom = ole.add_atom_text(&named).await?;

        read_other(ole, picture, stream, atom).await?
    } else {
        read_static(ole, which, picture, stream).await?
    };

    if read != OLE_OK {
        release_static(ole, which, picture).await?;
        return Ok(false);
    }

    set_picture(ole, object, picture);
    Ok(true)
}

// The methods.

/// `OBJQUERYSIZE` (913) of one: what `LESAVETOSTREAM` would write; an
/// embedded object with no data `OLE_ERROR_BLANK` (**recorded** by
/// `oledde`).
pub(crate) async fn query_size(ole: &Ole<'_>, object: u32, out: u32) -> R<u16> {
    let Some(le) = le(ole, object) else {
        return Ok(OLE_ERROR_OBJECT);
    };
    let string = |bytes: &[u8]| 4 + if bytes.is_empty() { 0 } else { bytes.len() + 1 };

    if le.kind == OT_EMBEDDED && le.native == 0 {
        ole.w32(out, 0);
        return Ok(OLE_ERROR_BLANK);
    }

    let mut size = (8
        + string(&le.class)
        + string(if le.kind == OT_EMBEDDED {
            &[]
        } else {
            &le.topic
        })
        + string(&le.item)) as u32;

    size += if le.kind == OT_EMBEDDED {
        4 + ole.global_size(le.native).await?
    } else {
        string(&le.network) as u32 + 8
    };
    size += 8;

    if le.picture != 0 {
        // Its presentation's as a static object's stream, less what is said
        // before it.
        let at = ole.near(SCRATCH + 0xf0);

        static_size(
            ole,
            kind_of(ole, le.picture).unwrap_or(Kind::Mf),
            le.picture,
            at,
        )
        .await?;
        size += ole.r32(at) - 8;
    }

    ole.w32(out, size);
    Ok(OLE_OK)
}

fn blank_rect(ole: &Ole<'_>, rect: u32) -> u16 {
    for i in (0..8).step_by(2) {
        ole.w16(plus(rect, i), 0);
    }

    OLE_ERROR_BLANK
}

/// `LEQUERYBOUNDS` (213): its presentation's; none `OLE_ERROR_BLANK`,
/// noughts written.
fn query_bounds(ole: &Ole<'_>, le: &Le, rect: u32) -> u16 {
    if le.picture == 0 {
        return blank_rect(ole, rect);
    }

    static_bounds(
        ole,
        kind_of(ole, le.picture).unwrap_or(Kind::Mf),
        le.picture,
        rect,
    )
}

/// The formats it gives, in `OleEnumFormats`' order: `Native` and
/// `OwnerLink`, or `ObjectLink`, then its presentation's -- a picture where
/// it has none yet, nothing where it was made to render none (**measured**
/// by `olehnd`'s `clip none` and `le invisible none`).
fn formats(ole: &Ole<'_>, le: &Le) -> Vec<u16> {
    let mut list = if le.kind == OT_EMBEDDED {
        vec![cf(ole, "Native"), cf(ole, "OwnerLink")]
    } else {
        vec![cf(ole, "ObjectLink")]
    };

    if le.picture != 0 {
        list.push(format_of_kind(kind_of(ole, le.picture).unwrap_or(Kind::Mf)));
    } else if le.render != OLERENDER_NONE {
        list.push(CF_METAFILEPICT);
    }

    list
}

/// The format after the one given in a list, nought after the last; the
/// first for nought.
fn next_format(list: &[u16], format: u16) -> u16 {
    if format == 0 {
        return list.first().copied().unwrap_or(0);
    }

    list.iter()
        .position(|each| *each == format)
        .and_then(|at| list.get(at + 1).copied())
        .unwrap_or(0)
}

fn enum_format(ole: &Ole<'_>, le: &Le, format: u16) -> u16 {
    next_format(&formats(ole, le), format)
}

/// `OwnerLink`'s or `ObjectLink`'s bytes: its class, document and item,
/// each with its nought, and a nought.
fn link_bytes(le: &Le) -> Vec<u8> {
    let mut out = le.class.clone();

    out.push(0);
    out.extend_from_slice(&le.topic);
    out.push(0);
    out.extend_from_slice(&le.item);
    out.extend_from_slice(&[0, 0]);
    out
}

/// `Native`, `OwnerLink` or `ObjectLink`, as every embedded or linked
/// object gives them; none for another format.
async fn own_data(ole: &Ole<'_>, object: u32, le: &Le, format: u16, out: u32) -> R<Option<u16>> {
    if format == cf(ole, "Native") && le.kind == OT_EMBEDDED {
        if le.native == 0 {
            return Ok(Some(OLE_ERROR_FORMAT));
        }

        ole.w16(out, le.native);
        return Ok(Some(OLE_OK));
    }

    let own = cf(
        ole,
        if le.kind == OT_EMBEDDED {
            "OwnerLink"
        } else {
            "ObjectLink"
        },
    );

    if format == own {
        if le.link != 0 {
            ole.global_free(le.link).await?;
        }

        let block = shared_block(ole, &link_bytes(le)).await?;

        with(ole, object, |le| le.link = block);
        ole.w16(out, block);
        return Ok(Some(OLE_OK));
    }

    Ok(None)
}

/// `LEGETDATA` (202): `Native` where it has some, else `OLE_ERROR_FORMAT`;
/// `OwnerLink` or `ObjectLink` made of its class, document and item; its
/// presentation's; a picture where it has none, an empty `METAFILEPICT`
/// (**recorded** by `oledde`).
async fn get_data(ole: &Ole<'_>, object: u32, le: &Le, format: u16, out: u32) -> R<u16> {
    if let Some(answer) = own_data(ole, object, le, format, out).await? {
        return Ok(answer);
    }

    if le.picture != 0 {
        let kind = kind_of(ole, le.picture).unwrap_or(Kind::Mf);

        return static_data(ole, kind, le.picture, format, out).await;
    }

    if format != CF_METAFILEPICT {
        return Ok(OLE_ERROR_FORMAT);
    }

    let mut blank = le.blank;

    if blank == 0 {
        blank = ole.global_alloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 8).await?;
        with(ole, object, |le| le.blank = blank);
    }

    ole.w16(out, blank);
    Ok(OLE_OK)
}

/// `Native` and `OwnerLink` put on the clipboard, as every embedded or
/// linked object puts them.
async fn copy_own(ole: &Ole<'_>, le: &Le) -> R<()> {
    if le.kind == OT_EMBEDDED && le.native != 0 {
        let copy = copy_block(ole, le.native).await?;

        ole.user(
            "SetClipboardData",
            &[Arg::W(cf(ole, "Native")), Arg::W(copy)],
        )
        .await?;
    }

    let block = shared_block(ole, &link_bytes(le)).await?;

    ole.user(
        "SetClipboardData",
        &[Arg::W(cf(ole, "OwnerLink")), Arg::W(block)],
    )
    .await?;
    Ok(())
}

/// `LECOPY` (211): its data put on the clipboard: `Native`, `OwnerLink`
/// and its presentation; a link's `OwnerLink` and presentation
/// (**recorded** by `oledde`).
async fn copy_to_clipboard(ole: &Ole<'_>, le: &Le) -> R<u16> {
    copy_own(ole, le).await?;

    if le.picture != 0 {
        copy_static(
            ole,
            kind_of(ole, le.picture).unwrap_or(Kind::Mf),
            le.picture,
        )
        .await?;
    }

    Ok(OLE_OK)
}

// Paintbrush's methods, the `PB` exports its table holds in five slots.

/// `PBQUERYBOUNDS` (806): its bitmap's at its pixels to a metre; none
/// `OLE_ERROR_BLANK`, noughts written (**recorded** by `olepbd`,
/// **measured** by `olehnd`).
fn pb_query_bounds(ole: &Ole<'_>, le: &Le, rect: u32) -> u16 {
    if le.view == 0 {
        blank_rect(ole, rect)
    } else {
        static_bounds(ole, Kind::Dib, le.view, rect)
    }
}

/// `PBENUMFORMATS` (810): `Native`, `OwnerLink` and a picture; a link's
/// `ObjectLink`, its `Native` where its presentation is that, and a
/// picture (**measured** by `olehnd`'s `link native` and `link none`).
fn pb_enum_formats(ole: &Ole<'_>, le: &Le, format: u16) -> u16 {
    let list = if le.kind == OT_EMBEDDED {
        vec![cf(ole, "Native"), cf(ole, "OwnerLink"), CF_METAFILEPICT]
    } else if le.picture != 0 {
        vec![cf(ole, "ObjectLink"), cf(ole, "Native"), CF_METAFILEPICT]
    } else {
        vec![cf(ole, "ObjectLink"), CF_METAFILEPICT]
    };

    next_format(&list, format)
}

/// `PBGETDATA` (811): what every object gives; a link's `Native`, its
/// presentation's; a picture made from the bitmap for the caller to let
/// go, `OLE_WARN_DELETE_DATA`; none, `OLE_ERROR_MEMORY` (**recorded** by
/// `olepbd` and `olepbr`, **measured** by `olehnd`).
async fn pb_get_data(ole: &Ole<'_>, object: u32, le: &Le, format: u16, out: u32) -> R<u16> {
    if let Some(answer) = own_data(ole, object, le, format, out).await? {
        return Ok(answer);
    }

    if format == cf(ole, "Native") && le.picture != 0 {
        ole.w16(out, ole.r16(plus(le.picture, GEN_DATA)));
        return Ok(OLE_OK);
    }

    if format != CF_METAFILEPICT {
        return Ok(OLE_ERROR_FORMAT);
    }

    if le.view == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    ole.w16(out, picture_of_view(ole, le.view).await?);
    Ok(OLE_WARN_DELETE_DATA)
}

/// `PBCOPYTOCLIPBOARD` (807): `Native` and `OwnerLink`, and a picture made
/// from the bitmap (**measured** by `olehnd`).
async fn pb_copy_to_clipboard(ole: &Ole<'_>, le: &Le) -> R<u16> {
    copy_own(ole, le).await?;

    if le.view != 0 {
        let picture = picture_of_view(ole, le.view).await?;

        ole.user(
            "SetClipboardData",
            &[Arg::W(CF_METAFILEPICT), Arg::W(picture)],
        )
        .await?;
    }

    Ok(OLE_OK)
}

/// An object `OLECLI`'s handler of `PBrush` made, given Paintbrush's table
/// where it has no picture -- no presentation, or one of another format,
/// its class's `Native` -- and its picture made from its bitmap (**read
/// out**: `OLECLI.DLL` seg7 `052a`, the routine each `Pb` export calls
/// after its default, and seg7 `09ae`, which tells a presentation that is
/// no picture by its `QueryType`'s `OLE_ERROR_GENERIC`; the table it gives
/// is the object's with five methods changed, **measured** by `olehnd`).
pub(crate) async fn pb_table(ole: &Ole<'_>, object: u32) -> R<()> {
    let Some(le) = le(ole, object) else {
        return Ok(());
    };

    if le.picture != 0 && kind_of(ole, le.picture) != Some(Kind::Gen) {
        return Ok(());
    }

    ole.w32(plus(object, OBJ_VTBL), table_at(ole, PB_VTBL, &PB_TABLE));
    refresh_view(ole, object).await
}

/// `LECLONE` (208): another of the same in the document given, numbered
/// anew, its data and presentation copied; the copy holds its original's
/// table, Paintbrush's with its picture made again.
#[allow(clippy::too_many_arguments)]
async fn clone(
    ole: &Ole<'_>,
    object: u32,
    le: &Le,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let copy = new_le(
        ole,
        le.kind,
        client,
        doc,
        name,
        le.class.clone(),
        (le.kind == OT_LINK).then(|| le.topic.clone()),
        le.item.clone(),
        0,
    )
    .await?;

    if copy == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    let native = if le.native == 0 {
        0
    } else {
        copy_block(ole, le.native).await?
    };

    with(ole, copy, |made| {
        made.update = le.update;
        made.host_names.clone_from(&le.host_names);
        made.dims.clone_from(&le.dims);
        made.scheme.clone_from(&le.scheme);
        made.target.clone_from(&le.target);
        made.native = native;
    });

    if le.picture != 0 {
        let at = ole.near(SCRATCH + 0xf0);
        let kind = kind_of(ole, le.picture).unwrap_or(Kind::Mf);

        if clone_static(ole, kind, le.picture, client, 0, 0, at).await? == OLE_OK {
            set_picture(ole, copy, ole.r32(at));
        }
    }

    with(ole, copy, |made| {
        made.render = le.render;
        made.network.clone_from(&le.network);
        made.drive = le.drive;
    });

    if is_pb(ole, object) {
        ole.w32(plus(copy, OBJ_VTBL), table_at(ole, PB_VTBL, &PB_TABLE));
        refresh_view(ole, copy).await?;
    }

    ole.w32(out, copy);
    Ok(OLE_OK)
}

/// `LEEQUAL` (210): the same type, class, item and document, and an
/// embedded object's `Native` the same (**recorded** by `oledde`: a clone
/// equal, an embedded object and a link not).
async fn equal(ole: &Ole<'_>, one: &Le, b: u32) -> R<u16> {
    let Some(other) = le(ole, b) else {
        return Ok(OLE_ERROR_NOT_EQUAL);
    };

    if one.kind != other.kind
        || one.class != other.class
        || one.item != other.item
        || (one.kind == OT_LINK && one.topic != other.topic)
    {
        return Ok(OLE_ERROR_NOT_EQUAL);
    }

    if one.kind == OT_EMBEDDED && one.native != 0 && other.native != 0 {
        return same_blocks(ole, one.native, other.native).await;
    }

    Ok(if one.native != 0 || other.native != 0 {
        OLE_ERROR_NOT_EQUAL
    } else {
        OLE_OK
    })
}

/// Whether the object talks with its server: open.
const fn open(le: &Le) -> bool {
    le.doc != 0
}

/// Closing: an embedded object's `[StdCloseDocument]`, then each
/// conversation ended.
fn closing(le: &Le) -> Vec<Step> {
    if le.kind == OT_EMBEDDED {
        vec![
            execute_step(Conv::Doc, b"[StdCloseDocument]", OLE_ERROR_COMMAND),
            Step::Terminate(Conv::Doc),
            Step::Terminate(Conv::System),
        ]
    } else {
        vec![Step::Terminate(Conv::Doc)]
    }
}

/// `LERELEASE` (200), its `Delete` too: one not open let go at once; an
/// open one closed first -- `[StdCloseDocument]`, its conversations ended
/// -- its client told `OLE_RELEASE`, `OLE_DELETE`, and then let go
/// (**recorded** by `oledde`).
async fn release(ole: &Ole<'_>, object: u32, le: &Le) -> R<u16> {
    if le.busy {
        return Ok(OLE_BUSY);
    }

    if !open(le) {
        free_le(ole, object).await?;
        return Ok(OLE_OK);
    }

    let mut steps = closing(le);

    steps.push(Step::Release {
        method: OLE_DELETE,
        free: true,
        silent: false,
    });
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `LECLOSE` (225): one not open `OLE_OK`; else closed, released
/// `OLE_CLOSE`.
async fn close(ole: &Ole<'_>, object: u32, le: &Le) -> R<u16> {
    if le.busy {
        return Ok(OLE_BUSY);
    }

    if !open(le) {
        return Ok(OLE_OK);
    }

    let mut steps = closing(le);

    steps.push(release_step(OLE_CLOSE));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `LEACTIVATE` (216) and `DoVerb` (1005): open, `[StdDoVerbItem(...)]`
/// released `OLE_RUN`. An embedded object not open: its server reached or
/// launched shown, `[StdEditDocument("doc")]`, its document's
/// conversation begun, its `Native` and what its client set poked,
/// advised as at its making, the verb; a link: its file's document
/// reached or its server launched shown with it, advised and its item
/// asked for, the verb. Released `OLE_ACTIVATE` (**recorded** by
/// `oledde`).
async fn activate(ole: &Ole<'_>, object: u32, le: &Le, verb: u16, show: u16, focus: u16) -> R<u16> {
    let verb_step = execute_step(Conv::Doc, &do_verb(le, verb, show, focus), OLE_ERROR_DOVERB);

    if le.busy {
        return Ok(OLE_BUSY);
    }

    if open(le) {
        begin(ole, object, vec![verb_step, release_step(OLE_RUN)]).await?;
        return Ok(OLE_WAIT_FOR_RELEASE);
    }

    if le.kind == OT_LINK {
        if !connect_doc(ole, object, Some(SW_SHOWNORMAL)).await? {
            return Ok(OLE_ERROR_LAUNCH);
        }

        let mut steps = link_advises(ole, le);

        steps.push(verb_step);
        steps.push(release_step(OLE_ACTIVATE));
        begin(ole, object, steps).await?;
        return Ok(OLE_WAIT_FOR_RELEASE);
    }

    if !connect_system(ole, object, Some(SW_SHOWNORMAL)).await? {
        return Ok(OLE_ERROR_LAUNCH);
    }

    let native = if le.native == 0 {
        None
    } else {
        Some(block_bytes(ole, le.native).await?)
    };
    let mut command = b"[StdEditDocument(".to_vec();

    command.extend_from_slice(&quote(&le.topic));
    command.extend_from_slice(b")]");

    let mut steps = vec![
        execute_step(Conv::System, &command, OLE_ERROR_EDIT),
        Step::Initiate,
    ];

    steps.extend(edits(ole, le, native));
    steps.extend(embedded_advises(ole, le));
    steps.push(verb_step);
    steps.push(release_step(OLE_ACTIVATE));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// A poke while open, released as the method says; kept for the next
/// opening either way.
async fn set_and_poke(
    ole: &Ole<'_>,
    object: u32,
    item: &[u8],
    bytes: Vec<u8>,
    method: u16,
    format: u16,
) -> R<u16> {
    let Some(le) = le(ole, object) else {
        return Ok(OLE_ERROR_OBJECT);
    };

    if !open(&le) {
        return Ok(OLE_OK);
    }

    if le.busy {
        return Ok(OLE_BUSY);
    }

    begin(
        ole,
        object,
        vec![
            Step::Poke {
                item: item.to_vec(),
                format,
                data: bytes,
                error: OLE_ERROR_POKE_NATIVE,
                handle: 0,
            },
            release_step(method),
        ],
    )
    .await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `LESETHOSTNAMES` (204): the two names kept, after two offsets to them,
/// and poked as `StdHostNames` while open (**recorded** by `oledde`).
async fn set_host_names(ole: &Ole<'_>, object: u32, client: u32, doc: u32) -> R<u16> {
    // A link's server is not told host names: `OLE_ERROR_OBJECT`
    // (**measured** by `oleemb`).
    if le(ole, object).is_some_and(|le| le.kind == OT_LINK) {
        return Ok(OLE_ERROR_OBJECT);
    }

    let first = ole.string(client);
    let second = ole.string(doc);
    let mut bytes = word(0).to_vec();

    bytes.extend_from_slice(&word(first.len() as u16 + 1));
    bytes.extend_from_slice(&first);
    bytes.push(0);
    bytes.extend_from_slice(&second);
    bytes.push(0);
    with(ole, object, |le| le.host_names = Some(bytes.clone()));
    set_and_poke(
        ole,
        object,
        b"StdHostNames",
        bytes,
        OLE_OTHER,
        cf(ole, "Binary"),
    )
    .await
}

/// `LESETBOUNDS` (206): its width and height, twice, kept and poked as
/// `StdDocDimensions` (**recorded** by `oledde`: `0,0,1500,-750` poked as
/// 1500, 750, 1500, 750).
async fn set_bounds(ole: &Ole<'_>, object: u32, rect: u32) -> R<u16> {
    let left = ole.r16(rect);
    let top = ole.r16(plus(rect, 2));
    let right = ole.r16(plus(rect, 4));
    let bottom = ole.r16(plus(rect, 6));
    let width = word(right.wrapping_sub(left));
    let height = word(top.wrapping_sub(bottom));
    let bytes = [width, height, width, height].concat();

    with(ole, object, |le| le.dims = Some(bytes.clone()));
    set_and_poke(
        ole,
        object,
        b"StdDocDimensions",
        bytes,
        OLE_OTHER,
        cf(ole, "Binary"),
    )
    .await
}

/// `SetColorScheme` (1004): the `LOGPALETTE`, kept and poked as
/// `StdColorScheme`.
async fn set_color_scheme(ole: &Ole<'_>, object: u32, palette: u32) -> R<u16> {
    let count = ole.r16(plus(palette, 2));
    let bytes = ole.read(palette, 4 + usize::from(count) * 4);

    with(ole, object, |le| le.scheme = Some(bytes.clone()));
    set_and_poke(
        ole,
        object,
        b"StdColorScheme",
        bytes,
        OLE_OTHER,
        cf(ole, "Binary"),
    )
    .await
}

/// `LESETTARGETDEVICE` (205): the block's bytes, kept and poked as
/// `StdTargetDevice`.
async fn set_target_device(ole: &Ole<'_>, object: u32, device: u16) -> R<u16> {
    let bytes = block_bytes(ole, device).await?;

    with(ole, object, |le| le.target = Some(bytes.clone()));
    set_and_poke(
        ole,
        object,
        b"StdTargetDevice",
        bytes,
        OLE_OTHER,
        cf(ole, "Binary"),
    )
    .await
}

/// `LESETDATA` (203): `Native` copied in, its client told it changed, and
/// poked while open, released `OLE_SETDATA` (**recorded** by `oledde`).
async fn set_data(ole: &Ole<'_>, object: u32, le: &Le, format: u16, handle: u16) -> R<u16> {
    let native = cf(ole, "Native");

    if format != native {
        return Ok(OLE_ERROR_FORMAT);
    }

    if le.busy {
        return Ok(OLE_BUSY);
    }

    let copy = copy_block(ole, handle).await?;

    if le.native != 0 {
        ole.global_free(le.native).await?;
    }

    with(ole, object, |le| le.native = copy);

    if is_pb(ole, object) {
        refresh_view(ole, object).await?;
    }

    tell(ole, object, OLE_CHANGED).await?;

    let bytes = block_bytes(ole, handle).await?;

    set_and_poke(ole, object, b"", bytes, OLE_SETDATA, native).await
}

/// `LEEXECUTE` (228): the commands sent on its document, a copy of them,
/// released `OLE_OTHER`.
async fn execute(ole: &Ole<'_>, object: u32, le: &Le, commands: u16) -> R<u16> {
    if !open(le) {
        return Ok(OLE_ERROR_NOT_OPEN);
    }

    if le.busy {
        return Ok(OLE_BUSY);
    }

    let at = ole.global_lock(commands).await?;
    let command = ole.string(at);

    ole.global_unlock(commands).await?;
    begin(
        ole,
        object,
        vec![
            execute_step(Conv::Doc, &command, OLE_ERROR_COMMAND),
            release_step(OLE_OTHER),
        ],
    )
    .await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `LEUPDATE` (218): open, its data asked for, or a link's item; its client
/// told it changed; released `OLE_UPDATE`.
async fn update(ole: &Ole<'_>, object: u32, le: &Le) -> R<u16> {
    if le.busy {
        return Ok(OLE_BUSY);
    }

    if !open(le) {
        return Ok(OLE_OK);
    }

    let mut steps = if le.kind == OT_EMBEDDED {
        embedded_requests(ole, le)
    } else {
        vec![request(
            &le.item,
            link_format(ole, le),
            OLE_ERROR_REQUEST_PICT,
        )]
    };

    steps.push(Step::Notify(OLE_CHANGED));
    steps.push(release_step(OLE_UPDATE));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `RequestData` (1000): open, the format asked for, its client told it
/// changed; released `OLE_REQUESTDATA`; refused, `OLE_ERROR_REQUEST_PICT`
/// (**recorded** by `oledde`, `CF_TEXT`).
async fn request_data(ole: &Ole<'_>, object: u32, le: &Le, format: u16) -> R<u16> {
    if !open(le) {
        return Ok(OLE_ERROR_NOT_OPEN);
    }

    if le.busy {
        return Ok(OLE_BUSY);
    }

    let error = if format == cf(ole, "Native") {
        OLE_ERROR_REQUEST_NATIVE
    } else {
        OLE_ERROR_REQUEST_PICT
    };
    let item = if le.kind == OT_LINK {
        le.item.clone()
    } else {
        Vec::new()
    };

    begin(
        ole,
        object,
        vec![
            request(&item, format, error),
            Step::Notify(OLE_CHANGED),
            release_step(OLE_REQUESTDATA),
        ],
    )
    .await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `LERECONNECT` (219): a link not open connected to a server that has its
/// document, without launching one: advised, its item asked for; released
/// `OLE_RECONNECT`. None answering, `OLE_OK` (**recorded** by `oledde`).
async fn reconnect(ole: &Ole<'_>, object: u32, le: &Le) -> R<u16> {
    if le.kind != OT_LINK || open(le) {
        return Ok(OLE_OK);
    }

    if le.busy {
        return Ok(OLE_BUSY);
    }

    if !connect_doc(ole, object, None).await? {
        return Ok(OLE_OK);
    }

    let mut steps = link_advises(ole, le);

    steps.push(release_step(OLE_RECONNECT));
    begin(ole, object, steps).await?;
    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `OleLockServer` of an embedded or linked object: its class's server
/// reached on its system topic, or launched hidden; the handle given is
/// that conversation's window (**recorded** by `oledde`).
pub(crate) async fn lock_server(ole: &Ole<'_>, object: u32, out: u32) -> R<u16> {
    let Some(before) = le(ole, object) else {
        return Ok(OLE_ERROR_OBJECT);
    };

    if !connect_system(ole, object, Some(SW_HIDE)).await? {
        return Ok(OLE_ERROR_LAUNCH);
    }

    let (hwnd, server) = with(ole, object, |le| {
        let held = (le.system, le.system_server);

        le.system = before.system;
        le.system_server = before.system_server;
        held
    })
    .unwrap_or((0, 0));

    ole.state().locks.insert(hwnd, server);
    ole.w32(out, u32::from(hwnd));
    Ok(OLE_OK)
}

/// `OleUnlockServer`: its conversation ended, the window let go as the
/// server answers; a handle WinBox has not given, none.
pub(crate) async fn unlock_server(ole: &Ole<'_>, handle: u32) -> R<Option<u16>> {
    let hwnd = handle as u16;
    let Some(server) = ole.state().locks.get(&hwnd).copied() else {
        return Ok(None);
    };

    post(ole, server, WM_DDE_TERMINATE, hwnd, 0).await?;
    Ok(Some(OLE_WAIT_FOR_RELEASE))
}

/// The methods of the `LE` exports and the unnamed entries an embedded or
/// linked object's table holds, by ordinal; none for another ordinal.
#[allow(clippy::too_many_lines)]
pub(crate) async fn method(ole: &Ole<'_>, ordinal: u16, args: &[u32]) -> R<Option<u32>> {
    let arg = |at: usize| args.get(at).copied().unwrap_or(0);
    let object = arg(0);

    if !(200..=229).contains(&ordinal)
        && !(1000..=1005).contains(&ordinal)
        && !matches!(ordinal, 805..=807 | 810 | 811)
    {
        return Ok(None);
    }

    let Some(le) = le(ole, object) else {
        return Ok(Some(u32::from(OLE_ERROR_OBJECT)));
    };

    let answer = match ordinal {
        200 => release(ole, object, &le).await?,
        202 => get_data(ole, object, &le, arg(1) as u16, arg(2)).await?,
        203 => set_data(ole, object, &le, arg(1) as u16, arg(2) as u16).await?,
        204 => set_host_names(ole, object, arg(1), arg(2)).await?,
        205 => set_target_device(ole, object, arg(1) as u16).await?,
        206 => set_bounds(ole, object, arg(1)).await?,
        207 => save_to_stream(ole, object, arg(1)).await?,
        208 => clone(ole, object, &le, arg(1), arg(2), arg(3), arg(4)).await?,
        210 => equal(ole, &le, arg(1)).await?,
        211 => copy_to_clipboard(ole, &le).await?,
        212 => {
            ole.w32(arg(1), le.kind);
            OLE_OK
        }
        213 => query_bounds(ole, &le, arg(1)),
        // Paintbrush's: its bitmap drawn, none `OLE_ERROR_BLANK`.
        805 => {
            if le.view == 0 {
                OLE_ERROR_BLANK
            } else {
                draw(ole, Kind::Dib, le.view, arg(1) as u16, arg(2), arg(3)).await?
            }
        }
        806 => pb_query_bounds(ole, &le, arg(1)),
        807 => pb_copy_to_clipboard(ole, &le).await?,
        810 => pb_enum_formats(ole, &le, arg(1) as u16),
        811 => pb_get_data(ole, object, &le, arg(1) as u16, arg(2)).await?,
        214 => {
            if le.picture == 0 {
                OLE_ERROR_BLANK
            } else {
                let kind = kind_of(ole, le.picture).unwrap_or(Kind::Mf);

                draw(ole, kind, le.picture, arg(1) as u16, arg(2), arg(3)).await?
            }
        }
        215 => {
            if open(&le) {
                OLE_OK
            } else {
                OLE_ERROR_NOT_OPEN
            }
        }
        216 | 1005 => {
            activate(
                ole,
                object,
                &le,
                arg(1) as u16,
                arg(2) as u16,
                arg(3) as u16,
            )
            .await?
        }
        218 => update(ole, object, &le).await?,
        219 => reconnect(ole, object, &le).await?,
        220 => enum_format(ole, &le, arg(1) as u16),
        221 => 0,
        222 => OLE_OK,
        225 => close(ole, object, &le).await?,
        226 => {
            if le.kind == OT_LINK {
                ole.w16(arg(1), le.update);
                OLE_OK
            } else {
                OLE_ERROR_OBJECT
            }
        }
        227 => {
            if le.kind == OT_LINK {
                with(ole, object, |le| le.update = arg(1) as u16);
                OLE_OK
            } else {
                OLE_ERROR_OBJECT
            }
        }
        228 => execute(ole, object, &le, arg(1) as u16).await?,
        1000 => request_data(ole, object, &le, arg(1) as u16).await?,
        1001 => le.method,
        1002 => le.error,
        1003 => {
            if le.busy {
                OLE_BUSY
            } else {
                OLE_OK
            }
        }
        1004 => set_color_scheme(ole, object, arg(1)).await?,
        _ => OLE_ERROR_GENERIC,
    };

    Ok(Some(u32::from(answer)))
}

/// What WinBox keeps of an embedded or linked object, a copy; none for
/// another.
pub(crate) fn le_of(ole: &Ole<'_>, object: u32) -> Option<Le> {
    le(ole, object)
}

/// What WinBox keeps of one changed.
pub(crate) fn with_le<T>(
    ole: &Ole<'_>,
    object: u32,
    change: impl FnOnce(&mut Le) -> T,
) -> Option<T> {
    with(ole, object, change)
}
