//! OLE 1.0's server library as WinBox's own: the server's side of the DDE
//! conversations a client's `OLECLI` holds with it, over the methods of
//! the server's `OLESERVER`, `OLESERVERDOC` and `OLEOBJECT` tables.
//! Written from OLE 1.0's documented interface and protocol and from what
//! the probe `olesrv` measured under DOSBox -- the messages on the wire and
//! the methods the server is called with, in their order -- not from the
//! code of `OLESVR.DLL` (`kb/topics/ole.md`). As
//! `src/win16/olesvr/server.ts`.

use crate::commdlg::api::{Arg, text};
use crate::engine::GuestArg;
use crate::olecli::core::{R, plus};

use super::core::{
    ACK, ADVISE_ACK_REQ, Advise, CF_BITMAP, CF_METAFILEPICT, CF_PALETTE, CF_TEXT, CLASS_NAME,
    CLIENT_VTBL, DATA_ADVISED, DATA_RESPONSE, GMEM_DDESHARE, GMEM_MOVEABLE, HKEY_CLASSES_ROOT,
    NACK, OLE_CHANGED, OLE_CLOSED, OLE_ERROR_ADDRESS, OLE_ERROR_CLASS, OLE_ERROR_HANDLE, OLE_OK,
    OLE_RENAMED, OLE_SAVED, OLE_SERVER_MULTI, OLE_WAIT_FOR_RELEASE, RECT_AT, REG_SIZE, REG_VALUE,
    Server, Svr, SvrDoc, SvrObject, WM_DDE_ACK, WM_DDE_ADVISE, WM_DDE_DATA, WM_DDE_EXECUTE,
    WM_DDE_INITIATE, WM_DDE_POKE, WM_DDE_REQUEST, WM_DDE_TERMINATE, WM_DDE_UNADVISE, WS_CHILD,
};

/// The methods of `OLESERVERVTBL` (ole.h), by their slots.
mod server_slot {
    pub const OPEN: u16 = 0;
    pub const CREATE: u16 = 1;
    pub const CREATE_FROM_TEMPLATE: u16 = 2;
    pub const EDIT: u16 = 3;
    pub const EXIT: u16 = 4;
    pub const RELEASE: u16 = 5;
    pub const EXECUTE: u16 = 6;
}

/// The methods of `OLESERVERDOCVTBL` (ole.h), by their slots.
mod doc_slot {
    pub const CLOSE: u16 = 1;
    pub const SET_HOST_NAMES: u16 = 2;
    pub const SET_DOC_DIMENSIONS: u16 = 3;
    pub const GET_OBJECT: u16 = 4;
    pub const RELEASE: u16 = 5;
    pub const SET_COLOR_SCHEME: u16 = 6;
    pub const EXECUTE: u16 = 7;
}

/// The methods of `OLEOBJECTVTBL` (ole.h) a server's object is called by,
/// by their slots.
mod object_slot {
    pub const RELEASE: u16 = 1;
    pub const SHOW: u16 = 2;
    pub const DO_VERB: u16 = 3;
    pub const GET_DATA: u16 = 4;
    pub const SET_DATA: u16 = 5;
    pub const SET_TARGET_DEVICE: u16 = 6;
    pub const ENUM_FORMATS: u16 = 8;
}

const fn long(low: u16, high: u16) -> u32 {
    (high as u32) << 16 | low as u32
}

fn same(a: &[u8], b: &[u8]) -> bool {
    a.eq_ignore_ascii_case(b)
}

fn word(value: u16) -> [u8; 2] {
    value.to_le_bytes()
}

/// A method of a table, called far: its answer, AX.
async fn method(svr: &Svr<'_>, this: u32, slot: u16, args: &[GuestArg]) -> R<u16> {
    let table = svr.r32(this);
    let procedure = svr.r32(plus(table, slot * 4));
    let mut all = vec![GuestArg::Long(this)];

    all.extend_from_slice(args);
    svr.call_far(procedure, &all).await
}

// What the library does as it starts.

/// The formats it registers, in its order (as WinBox runs `OLESVR.DLL`,
/// each call it makes logged).
const FORMATS: [&str; 4] = ["Native", "Binary", "ObjectLink", "OwnerLink"];
const BINARY: usize = 1;
const OBJECT_LINK: usize = 2;

/// The atoms it adds, in its order: the protocol's commands, topics,
/// items and options.
const ATOMS: [&str; 21] = [
    "StdExit",
    "StdNewDocument",
    "StdOpenDocument",
    "StdEditDocument",
    "StdNewfromTemplate",
    "StdCloseDocument",
    "StdShowItem",
    "StdDoVerbItem",
    "System",
    "OLEsystem",
    "StdDocumentName",
    "Protocols",
    "Topics",
    "Formats",
    "Status",
    "EditEnvItems",
    "True",
    "False",
    "Change",
    "Save",
    "Close",
];

/// Its window classes: a server's, a document's, an item's -- eight,
/// eight and four bytes of window words, style nought -- by the ordinal
/// of the export that is each one's procedure.
const CLASSES: [(&str, u16, u16); 3] = [
    ("SrvrWndClass", 21, 8),
    ("DocWndClass", 22, 8),
    ("ItemWndClass", 23, 4),
];

fn wndclass(procedure: u32, extra: u16, instance: u16, name: u32) -> Vec<u8> {
    [
        0,
        procedure as u16,
        (procedure >> 16) as u16,
        0,
        extra,
        instance,
        0,
        0,
        0,
        0,
        0,
        name as u16,
        (name >> 16) as u16,
    ]
    .iter()
    .flat_map(|word| word.to_le_bytes())
    .collect()
}

/// The registrations made once a session, as a program first calls it:
/// its atoms, formats and classes, and the table of the `OLECLIENT` it
/// gives each object, `ITEMCALLBACK` its one method.
pub(crate) async fn start(svr: &Svr<'_>, instance: u16) -> R<()> {
    if svr.svr().started {
        return Ok(());
    }

    svr.svr().started = true;
    svr.svr().instance = instance;

    for name in ATOMS {
        svr.add_atom_text(name.as_bytes()).await?;
    }

    let mut formats = Vec::new();

    for name in FORMATS {
        formats.push(
            svr.user("RegisterClipboardFormat", &[text(name.as_bytes())])
                .await? as u16,
        );
    }

    svr.svr().formats = formats;

    for (name, ordinal, extra) in CLASSES {
        let at = svr.near(CLASS_NAME);
        let mut bytes = name.as_bytes().to_vec();

        bytes.push(0);
        svr.write(at, &bytes);

        let procedure = super::export_address(svr.e, ordinal);

        svr.user(
            "RegisterClass",
            &[Arg::B(wndclass(procedure, extra, instance, at))],
        )
        .await?;
    }

    let callback = super::export_address(svr.e, 26);

    svr.w32(svr.near(CLIENT_VTBL), callback);
    Ok(())
}

fn format(svr: &Svr<'_>, index: usize) -> u16 {
    svr.svr().formats.get(index).copied().unwrap_or(0)
}

// Windows and messages.

async fn make_window(svr: &Svr<'_>, class: &str, style: u32, parent: u16) -> R<u16> {
    let at = svr.near(CLASS_NAME);
    let mut bytes = class.as_bytes().to_vec();

    bytes.push(0);
    svr.write(at, &bytes);

    let instance = svr.svr().instance;

    Ok(svr
        .user(
            "CreateWindow",
            &[
                Arg::D(at),
                text(b""),
                Arg::D(style),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(0),
                Arg::W(parent),
                Arg::W(0),
                Arg::W(instance),
                Arg::D(0),
            ],
        )
        .await? as u16)
}

async fn post(svr: &Svr<'_>, to: u16, message: u16, from: u16, l_param: u32) -> R<()> {
    svr.user(
        "PostMessage",
        &[Arg::W(to), Arg::W(message), Arg::W(from), Arg::D(l_param)],
    )
    .await?;
    Ok(())
}

async fn atom_text(svr: &Svr<'_>, atom: u16) -> R<Vec<u8>> {
    if atom == 0 {
        return Ok(Vec::new());
    }

    let called = svr
        .call_b(
            "USER",
            "GlobalGetAtomName",
            &[Arg::W(atom), Arg::B(vec![0; 256]), Arg::W(256)],
        )
        .await?;

    Ok(called.string(0))
}

/// A block of `GMEM_DDESHARE` holding bytes: its handle.
async fn shared(svr: &Svr<'_>, bytes: &[u8]) -> R<u16> {
    let handle = svr
        .global_alloc(GMEM_MOVEABLE | GMEM_DDESHARE, bytes.len() as u32)
        .await?;
    let at = svr.global_lock(handle).await?;

    svr.write(at, bytes);
    svr.global_unlock(handle).await?;
    Ok(handle)
}

/// A block's bytes, as many as its size.
async fn block_bytes(svr: &Svr<'_>, handle: u16) -> R<Vec<u8>> {
    let size = svr.global_size(handle).await?;
    let at = svr.global_lock(handle).await?;
    let bytes = if at == 0 {
        Vec::new()
    } else {
        svr.read(at, size as usize)
    };

    svr.global_unlock(handle).await?;
    Ok(bytes)
}

// The protocol's commands.

struct Command {
    name: Vec<u8>,
    args: Vec<Vec<u8>>,
}

/// An execute's commands, each `[name(args)]`, an argument quoted or not,
/// separated by commas; none where the text is not so.
fn parse(bytes: &[u8]) -> Option<Vec<Command>> {
    let at = |i: usize| bytes.get(i).copied().unwrap_or(0);
    let space = |i: &mut usize| {
        while at(*i) == b' ' {
            *i += 1;
        }
    };
    let mut commands = Vec::new();
    let mut i = 0;

    space(&mut i);

    if at(i) != b'[' {
        return None;
    }

    while i < bytes.len() {
        space(&mut i);

        if at(i) != b'[' {
            return None;
        }

        i += 1;

        let mut name = Vec::new();

        while i < bytes.len() && at(i) != b'(' && at(i) != b']' {
            name.push(at(i));
            i += 1;
        }

        let mut args = Vec::new();

        if at(i) == b'(' {
            i += 1;

            loop {
                space(&mut i);

                let mut arg = Vec::new();

                if at(i) == b'"' {
                    i += 1;

                    while i < bytes.len() && at(i) != b'"' {
                        arg.push(at(i));
                        i += 1;
                    }

                    i += 1;
                } else {
                    while i < bytes.len() && at(i) != b',' && at(i) != b')' {
                        arg.push(at(i));
                        i += 1;
                    }

                    while arg.last() == Some(&b' ') {
                        arg.pop();
                    }
                }

                args.push(arg);
                space(&mut i);

                if at(i) == b',' {
                    i += 1;
                    continue;
                }

                if at(i) != b')' {
                    return None;
                }

                i += 1;
                break;
            }
        }

        space(&mut i);

        if at(i) != b']' {
            return None;
        }

        i += 1;
        name.retain(|&byte| byte != b' ');
        commands.push(Command { name, args });
        space(&mut i);
    }

    Some(commands)
}

fn is_std(command: &Command) -> bool {
    command.name.len() >= 3 && same(&command.name[..3], b"Std")
}

fn named(command: &Command, name: &str) -> bool {
    same(&command.name, name.as_bytes())
}

/// An argument as a truth: `TRUE` or `FALSE`, else a number.
fn truth(arg: Option<&Vec<u8>>) -> u16 {
    let Some(arg) = arg else {
        return 0;
    };

    if same(arg, b"TRUE") {
        return 1;
    }

    if same(arg, b"FALSE") {
        return 0;
    }

    String::from_utf8_lossy(arg)
        .trim()
        .parse::<i32>()
        .map_or(0, |value| value as u16)
}

async fn command_text(svr: &Svr<'_>, handle: u16) -> R<Vec<u8>> {
    let at = svr.global_lock(handle).await?;
    let bytes = if at == 0 { Vec::new() } else { svr.string(at) };

    svr.global_unlock(handle).await?;
    Ok(bytes)
}

// Servers and documents.

fn server_of(svr: &Svr<'_>, handle: u32) -> Option<Server> {
    if handle >> 16 != 0 {
        return None;
    }

    svr.svr().servers.get(&(handle as u16)).cloned()
}

fn doc_of(svr: &Svr<'_>, handle: u32) -> Option<SvrDoc> {
    if handle >> 16 != 0 {
        return None;
    }

    svr.svr().docs.get(&(handle as u16)).cloned()
}

fn with_server<T>(svr: &Svr<'_>, hwnd: u16, change: impl FnOnce(&mut Server) -> T) -> Option<T> {
    svr.svr().servers.get_mut(&hwnd).map(change)
}

fn with_doc<T>(svr: &Svr<'_>, hwnd: u16, change: impl FnOnce(&mut SvrDoc) -> T) -> Option<T> {
    svr.svr().docs.get_mut(&hwnd).map(change)
}

/// `OleRegisterServer`: a class of the registration database's served,
/// its window made.
pub(crate) async fn register_server(
    svr: &Svr<'_>,
    class: u32,
    server: u32,
    out: u32,
    use_: u16,
) -> R<u16> {
    let name = svr.string(class);
    let value = svr.near(REG_VALUE);
    let size = svr.near(REG_SIZE);

    svr.w32(size, 0x80);

    if svr
        .call(
            "SHELL",
            "RegQueryValue",
            &[
                Arg::D(HKEY_CLASSES_ROOT),
                text(&name),
                Arg::D(value),
                Arg::D(size),
            ],
        )
        .await?
        != 0
    {
        return Ok(OLE_ERROR_CLASS);
    }

    let hwnd = make_window(svr, "SrvrWndClass", 0, 0).await?;

    svr.svr().servers.insert(
        hwnd,
        Server {
            hwnd,
            class: name,
            pointer: server,
            multi: use_ == OLE_SERVER_MULTI,
            ..Server::default()
        },
    );
    svr.w32(out, u32::from(hwnd));
    Ok(OLE_OK)
}

/// A document's window made, the document to be kept as the server's.
async fn new_doc(svr: &Svr<'_>, server: u16, name: Vec<u8>) -> R<SvrDoc> {
    let hwnd = make_window(svr, "DocWndClass", WS_CHILD, server).await?;

    Ok(SvrDoc {
        hwnd,
        server,
        name,
        ..SvrDoc::default()
    })
}

fn keep_doc(svr: &Svr<'_>, doc: SvrDoc) {
    let (hwnd, server) = (doc.hwnd, doc.server);
    let mut state = svr.svr();

    state.docs.insert(hwnd, doc);

    if let Some(server) = state.servers.get_mut(&server) {
        server.docs.push(hwnd);
    }
}

/// `OleRegisterServerDoc`: a document the server opened itself.
pub(crate) async fn register_server_doc(
    svr: &Svr<'_>,
    handle: u32,
    name: u32,
    doc_pointer: u32,
    out: u32,
) -> R<u16> {
    let Some(server) = server_of(svr, handle) else {
        return Ok(OLE_ERROR_HANDLE);
    };
    let mut doc = new_doc(svr, server.hwnd, svr.string(name)).await?;

    doc.doc = doc_pointer;

    let hwnd = doc.hwnd;

    keep_doc(svr, doc);
    svr.w32(out, u32::from(hwnd));
    Ok(OLE_OK)
}

/// A document let go: its `Release` called, its window destroyed; its
/// server's, if it waits.
async fn release_doc(svr: &Svr<'_>, hwnd: u16) -> R<()> {
    let (doc, server) = {
        let mut state = svr.svr();
        let Some(doc) = state.docs.remove(&hwnd) else {
            return Ok(());
        };
        let server = state.servers.get_mut(&doc.server).map(|server| {
            server.docs.retain(|&each| each != hwnd);
            (server.hwnd, server.revoking)
        });

        (doc, server)
    };

    method(svr, doc.doc, doc_slot::RELEASE, &[]).await?;
    svr.user("DestroyWindow", &[Arg::W(hwnd)]).await?;

    if let Some((server, true)) = server {
        finish_server(svr, server).await?;
    }

    Ok(())
}

/// An object let go: its `Release` called, its client and advises
/// forgotten.
async fn release_object(svr: &Svr<'_>, doc: u16, client: u32) -> R<()> {
    let object = with_doc(svr, doc, |doc| {
        let object = doc
            .objects
            .iter()
            .position(|each| each.client == client)
            .map(|index| doc.objects.remove(index));

        doc.advises.retain(|advise| advise.client != client);
        object
    })
    .flatten();

    if let Some(object) = object {
        svr.free_client(client);
        method(svr, object.object, object_slot::RELEASE, &[]).await?;
    }

    Ok(())
}

/// A document revoked: each object let go in the order given, each of its
/// conversations ended; let go itself at once where it has none, else as
/// the last ends (**recorded** by `olesrv`).
async fn revoke_doc(svr: &Svr<'_>, hwnd: u16) -> R<u16> {
    let clients: Vec<u32> = doc_of(svr, u32::from(hwnd))
        .map(|doc| doc.objects.iter().map(|object| object.client).collect())
        .unwrap_or_default();

    for client in clients {
        release_object(svr, hwnd, client).await?;
    }

    let convs = with_doc(svr, hwnd, |doc| {
        doc.revoking = true;
        doc.convs.clone()
    })
    .unwrap_or_default();

    if convs.is_empty() {
        release_doc(svr, hwnd).await?;
        return Ok(OLE_OK);
    }

    for conv in convs {
        post(svr, conv, WM_DDE_TERMINATE, hwnd, 0).await?;
    }

    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `OleRevokeServerDoc`.
pub(crate) async fn revoke_server_doc(svr: &Svr<'_>, handle: u32) -> R<u16> {
    match doc_of(svr, handle) {
        Some(doc) if !doc.revoking => revoke_doc(svr, doc.hwnd).await,
        _ => Ok(OLE_ERROR_HANDLE),
    }
}

/// A server let go once nothing of it is left: its `Release`, its window.
async fn finish_server(svr: &Svr<'_>, hwnd: u16) -> R<()> {
    let server = {
        let mut state = svr.svr();

        match state.servers.get(&hwnd) {
            Some(server) if server.convs.is_empty() && server.docs.is_empty() => {
                state.servers.remove(&hwnd)
            }
            _ => None,
        }
    };

    if let Some(server) = server {
        method(svr, server.pointer, server_slot::RELEASE, &[]).await?;
        svr.user("DestroyWindow", &[Arg::W(hwnd)]).await?;
    }

    Ok(())
}

/// `OleRevokeServer`: each document revoked in the order made, each
/// system conversation ended; the server let go at once where nothing is
/// left, else as the last conversation ends (**recorded** by `olesrv`).
pub(crate) async fn revoke_server(svr: &Svr<'_>, handle: u32) -> R<u16> {
    let Some(server) = server_of(svr, handle).filter(|server| !server.revoking) else {
        return Ok(OLE_ERROR_HANDLE);
    };

    for doc in server.docs.clone() {
        if doc_of(svr, u32::from(doc)).is_some_and(|doc| !doc.revoking) {
            revoke_doc(svr, doc).await?;
        }
    }

    let (convs, docs) = with_server(svr, server.hwnd, |server| {
        server.revoking = true;
        (server.convs.clone(), server.docs.len())
    })
    .unwrap_or_default();

    if convs.is_empty() && docs == 0 {
        finish_server(svr, server.hwnd).await?;
        return Ok(OLE_OK);
    }

    for conv in convs {
        post(svr, conv, WM_DDE_TERMINATE, server.hwnd, 0).await?;
    }

    Ok(OLE_WAIT_FOR_RELEASE)
}

/// `OleBlockServer`: what clients post queued until it is unblocked.
pub(crate) fn block_server(svr: &Svr<'_>, handle: u32) -> u16 {
    let Some(server) = server_of(svr, handle) else {
        return OLE_ERROR_HANDLE;
    };

    with_server(svr, server.hwnd, |server| server.blocked = true);
    OLE_OK
}

/// `OleUnblockServer`: the first message queued handled, and whether more
/// wait; with none left the server is no longer blocked (**recorded** by
/// `olesrv`: a message posted after it is answered at once).
pub(crate) async fn unblock_server(svr: &Svr<'_>, handle: u32, out: u32) -> R<u16> {
    let Some(server) = server_of(svr, handle) else {
        return Ok(OLE_ERROR_HANDLE);
    };
    let next = with_server(svr, server.hwnd, |server| {
        let next = server.queue.pop_front();

        if server.queue.is_empty() {
            server.blocked = false;
        }

        next
    })
    .flatten();

    if let Some((hwnd, message, w_param, l_param)) = next {
        handle_message(svr, hwnd, message, w_param, l_param).await?;
    }

    if out != 0 {
        let more =
            with_server(svr, server.hwnd, |server| !server.queue.is_empty()).unwrap_or(false);

        svr.w16(out, u16::from(more));
    }

    Ok(OLE_OK)
}

/// `OleRenameServerDoc`: its name changed, and told to each conversation
/// that advised `StdDocumentName`.
pub(crate) async fn rename_server_doc(svr: &Svr<'_>, handle: u32, name: u32) -> R<u16> {
    let Some(doc) = doc_of(svr, handle) else {
        return Ok(OLE_ERROR_HANDLE);
    };
    let name = svr.string(name);

    with_doc(svr, doc.hwnd, |doc| doc.name.clone_from(&name));
    tell_name(svr, doc.hwnd, &name).await?;
    Ok(OLE_OK)
}

/// `OleRevertServerDoc`: nothing seen (**recorded** by `olesrv`).
pub(crate) fn revert_server_doc(svr: &Svr<'_>, handle: u32) -> u16 {
    if doc_of(svr, handle).is_some() {
        OLE_OK
    } else {
        OLE_ERROR_HANDLE
    }
}

/// `OleSavedServerDoc`: each object's `/Save` advises told, in the order
/// the objects were given.
pub(crate) async fn saved_server_doc(svr: &Svr<'_>, handle: u32) -> R<u16> {
    let Some(doc) = doc_of(svr, handle) else {
        return Ok(OLE_ERROR_HANDLE);
    };

    for object in &doc.objects {
        tell(svr, doc.hwnd, object.client, b"Save").await?;
    }

    Ok(OLE_OK)
}

/// The document and object of an `OLECLIENT` WinBox gave.
fn object_of_client(svr: &Svr<'_>, client: u32) -> Option<(u16, SvrObject)> {
    let doc = *svr.svr().clients.get(&client)?;
    let object = svr
        .svr()
        .docs
        .get(&doc)?
        .objects
        .iter()
        .find(|object| object.client == client)
        .cloned()?;

    Some((doc, object))
}

/// `OleRevokeObject`: the object let go, and each conversation it was
/// given in ended (**recorded** by `olesrv`); a pointer that is no
/// object's `OLECLIENT`, `OLE_ERROR_ADDRESS`.
pub(crate) async fn revoke_object(svr: &Svr<'_>, client: u32) -> R<u16> {
    let Some((doc, object)) = object_of_client(svr, client) else {
        return Ok(OLE_ERROR_ADDRESS);
    };
    let mut given = object.convs.clone();

    if let Some(doc) = doc_of(svr, u32::from(doc)) {
        for advise in doc.advises.iter().filter(|advise| advise.client == client) {
            if !given.contains(&advise.conv) {
                given.push(advise.conv);
            }
        }
    }

    release_object(svr, doc, client).await?;

    for conv in given {
        if doc_of(svr, u32::from(doc)).is_some_and(|doc| doc.convs.contains(&conv)) {
            post(svr, conv, WM_DDE_TERMINATE, doc, 0).await?;
            svr.svr().terminating.insert((doc, conv));
        }
    }

    Ok(OLE_OK)
}

/// `ITEMCALLBACK`, the method of the `OLECLIENT` an object is given: what
/// its server tells of it sent to the conversations that advised it.
pub(crate) async fn item_callback(svr: &Svr<'_>, client: u32, what: u16) -> R<u16> {
    let Some((doc, object)) = object_of_client(svr, client) else {
        return Ok(OLE_OK);
    };

    match what {
        OLE_CHANGED => tell(svr, doc, client, b"Change").await?,
        OLE_SAVED => tell(svr, doc, client, b"Save").await?,
        OLE_CLOSED => tell(svr, doc, client, b"Close").await?,
        OLE_RENAMED => {
            let link = format(svr, OBJECT_LINK);

            if enumerates(svr, &object, link).await? {
                let handle = get_data(svr, doc, client, link).await?;

                if handle != 0 {
                    let bytes = block_bytes(svr, handle).await?;
                    let first = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                    let rest = bytes.get(first + 1..).unwrap_or_default();
                    let name = rest[..rest.iter().position(|&b| b == 0).unwrap_or(0)].to_vec();

                    svr.global_free(handle).await?;
                    with_doc(svr, doc, |doc| doc.name.clone_from(&name));
                    tell_name(svr, doc, &name).await?;
                }
            }
        }
        _ => {}
    }

    Ok(OLE_OK)
}

/// A document's name sent to each conversation that advised
/// `StdDocumentName`: `Binary`, the name and its nought.
async fn tell_name(svr: &Svr<'_>, doc: u16, name: &[u8]) -> R<()> {
    let named = doc_of(svr, u32::from(doc))
        .map(|doc| doc.named)
        .unwrap_or_default();

    for conv in named {
        let mut bytes = word(DATA_ADVISED).to_vec();

        bytes.extend_from_slice(&word(format(svr, BINARY)));
        bytes.extend_from_slice(name);
        bytes.push(0);

        let block = shared(svr, &bytes).await?;
        let atom = svr.add_atom_text(b"StdDocumentName").await?;

        post(svr, conv, WM_DDE_DATA, doc, long(block, atom)).await?;
    }

    Ok(())
}

/// What a conversation advised of an object for a time -- `Change`,
/// `Save` or `Close` -- sent: every format it advised of the object, each
/// asked of it in turn, the item named as it was advised (**recorded** by
/// `olesrv`: an item advised for a change in two formats and for a save
/// in one is sent in both when saved).
async fn tell(svr: &Svr<'_>, doc: u16, client: u32, when: &[u8]) -> R<()> {
    let Some(found) = doc_of(svr, u32::from(doc)) else {
        return Ok(());
    };
    let Some(object) = found.objects.iter().find(|o| o.client == client).cloned() else {
        return Ok(());
    };
    let advises: Vec<Advise> = found
        .advises
        .iter()
        .filter(|advise| {
            advise.client == client && advise.whens.iter().any(|each| same(each, when))
        })
        .cloned()
        .collect();

    for advise in advises {
        for format in advise.formats {
            let data = data_block(svr, doc, client, format, DATA_ADVISED).await?;

            if data == 0 {
                continue;
            }

            let mut item = object.item.clone();

            if !same(when, b"Change") {
                item.push(b'/');
                item.extend_from_slice(when);
            }

            let atom = svr.add_atom_text(&item).await?;

            post(svr, advise.conv, WM_DDE_DATA, doc, long(data, atom)).await?;
        }
    }

    Ok(())
}

// What a server's object is asked.

/// An object of a document by its item, asked for once (**recorded** by
/// `olesrv`); none where its document refuses.
async fn object_of(svr: &Svr<'_>, doc: u16, item: &[u8], conv: u16) -> R<Option<SvrObject>> {
    let Some(found) = doc_of(svr, u32::from(doc)) else {
        return Ok(None);
    };
    let mut object = found.objects.iter().find(|o| same(&o.item, item)).cloned();

    if object.is_none() {
        let client = svr.new_client();
        let out = svr.out_arg();
        let item_at = svr.string_arg(item);
        let status = method(
            svr,
            found.doc,
            doc_slot::GET_OBJECT,
            &[
                GuestArg::Long(item_at),
                GuestArg::Long(out),
                GuestArg::Long(client),
            ],
        )
        .await?;

        if status != OLE_OK || svr.r32(out) == 0 {
            svr.free_client(client);
            return Ok(None);
        }

        let made = SvrObject {
            item: item.to_vec(),
            object: svr.r32(out),
            client,
            ..SvrObject::default()
        };

        with_doc(svr, doc, |doc| doc.objects.push(made.clone()));
        svr.svr().clients.insert(client, doc);
        object = Some(made);
    }

    let Some(object) = object else {
        return Ok(None);
    };

    Ok(with_doc(svr, doc, |doc| {
        let held = doc.objects.iter_mut().find(|o| o.client == object.client)?;

        if !held.convs.contains(&conv) {
            held.convs.push(conv);
        }

        Some(held.clone())
    })
    .flatten())
}

/// Whether an object enumerates a format: its formats asked from the first
/// until it is found or they end.
async fn enumerates(svr: &Svr<'_>, object: &SvrObject, format: u16) -> R<bool> {
    let mut at = 0;

    for _ in 0..0x100 {
        at = method(
            svr,
            object.object,
            object_slot::ENUM_FORMATS,
            &[GuestArg::Word(at)],
        )
        .await?;

        if at == 0 {
            return Ok(false);
        }

        if at == format {
            return Ok(true);
        }
    }

    Ok(false)
}

/// An object's data in a format: the handle it gave, or nought. The
/// target device poked given it first, once.
async fn get_data(svr: &Svr<'_>, doc: u16, client: u32, format: u16) -> R<u16> {
    let Some(found) = doc_of(svr, u32::from(doc)) else {
        return Ok(0);
    };
    let Some(object) = found.objects.iter().find(|o| o.client == client).cloned() else {
        return Ok(0);
    };

    if let Some(target) = found.target.as_ref().filter(|_| !object.targeted) {
        with_doc(svr, doc, |doc| {
            if let Some(held) = doc.objects.iter_mut().find(|o| o.client == client) {
                held.targeted = true;
            }
        });

        let block = shared(svr, target).await?;

        method(
            svr,
            object.object,
            object_slot::SET_TARGET_DEVICE,
            &[GuestArg::Word(block)],
        )
        .await?;
    }

    let out = svr.out_arg();
    let status = method(
        svr,
        object.object,
        object_slot::GET_DATA,
        &[GuestArg::Word(format), GuestArg::Long(out)],
    )
    .await?;

    Ok(if status == OLE_OK { svr.r16(out) } else { 0 })
}

/// Formats whose data is a handle, handed on: a picture, a bitmap, a
/// palette.
const BY_HANDLE: [u16; 3] = [CF_METAFILEPICT, CF_BITMAP, CF_PALETTE];

/// A `DDEDATA` block of an object's data in a format, with the flags
/// given; nought where it gives none.
async fn data_block(svr: &Svr<'_>, doc: u16, client: u32, format: u16, flags: u16) -> R<u16> {
    let handle = get_data(svr, doc, client, format).await?;

    if handle == 0 {
        return Ok(0);
    }

    let mut bytes = word(flags).to_vec();

    bytes.extend_from_slice(&word(format));

    if BY_HANDLE.contains(&format) {
        bytes.extend_from_slice(&word(handle));
    } else {
        bytes.extend(block_bytes(svr, handle).await?);
        svr.global_free(handle).await?;
    }

    shared(svr, &bytes).await
}

// The windows' procedures.

async fn def_window_proc(svr: &Svr<'_>, hwnd: u16, message: u16, w: u16, l: u32) -> R<u32> {
    svr.user(
        "DefWindowProc",
        &[Arg::W(hwnd), Arg::W(message), Arg::W(w), Arg::D(l)],
    )
    .await
}

/// `SRVRWNDPROC` (21): a server's window, its system conversations and its
/// documents' initiates.
pub(crate) async fn srvr_wnd_proc(
    svr: &Svr<'_>,
    hwnd: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<u32> {
    let Some(server) = server_of(svr, u32::from(hwnd)) else {
        return def_window_proc(svr, hwnd, message, w_param, l_param).await;
    };

    if !(WM_DDE_INITIATE..=WM_DDE_EXECUTE).contains(&message) {
        return def_window_proc(svr, hwnd, message, w_param, l_param).await;
    }

    if message == WM_DDE_INITIATE {
        initiated(
            svr,
            &server,
            w_param,
            l_param as u16,
            (l_param >> 16) as u16,
        )
        .await?;
        return Ok(0);
    }

    if server.blocked {
        with_server(svr, hwnd, |server| {
            server.queue.push_back((hwnd, message, w_param, l_param));
        });
        return Ok(0);
    }

    handle_message(svr, hwnd, message, w_param, l_param).await?;
    Ok(0)
}

/// `DOCWNDPROC` (22): a document's window, its conversations.
pub(crate) async fn doc_wnd_proc(
    svr: &Svr<'_>,
    hwnd: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<u32> {
    let Some(doc) = doc_of(svr, u32::from(hwnd)) else {
        return def_window_proc(svr, hwnd, message, w_param, l_param).await;
    };

    if message <= WM_DDE_INITIATE || message > WM_DDE_EXECUTE {
        return def_window_proc(svr, hwnd, message, w_param, l_param).await;
    }

    let blocked = with_server(svr, doc.server, |server| {
        if server.blocked {
            server.queue.push_back((hwnd, message, w_param, l_param));
        }

        server.blocked
    })
    .unwrap_or(false);

    if !blocked {
        handle_message(svr, hwnd, message, w_param, l_param).await?;
    }

    Ok(0)
}

/// `ITEMWNDPROC` (23): an item's window, its class registered; its
/// messages `DefWindowProc`'s.
pub(crate) async fn item_wnd_proc(
    svr: &Svr<'_>,
    hwnd: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<u32> {
    def_window_proc(svr, hwnd, message, w_param, l_param).await
}

/// `WM_DDE_INITIATE` broadcast, which only a top-level window is sent: the
/// class's system topic answered by its server's window, `OLEsystem` and
/// not `System`, and only where it may take a document -- a server of
/// `OLE_SERVER_MULTI` with one takes no more; a document's name by the
/// document's window (**recorded** by `olesrv`).
async fn initiated(svr: &Svr<'_>, server: &Server, client: u16, app: u16, topic: u16) -> R<()> {
    let app_name = atom_text(svr, app).await?;
    let topic_name = atom_text(svr, topic).await?;

    if server.revoking || (app != 0 && !same(&app_name, &server.class)) {
        return Ok(());
    }

    let mut from = 0;

    if same(&topic_name, b"OLEsystem") {
        if !server.multi || server.docs.is_empty() {
            from = server.hwnd;
            with_server(svr, server.hwnd, |server| server.convs.push(client));
        }
    } else {
        let doc = server
            .docs
            .iter()
            .filter_map(|&hwnd| doc_of(svr, u32::from(hwnd)))
            .find(|doc| !doc.revoking && same(&doc.name, &topic_name));

        if let Some(doc) = doc {
            from = doc.hwnd;
            with_doc(svr, doc.hwnd, |doc| doc.convs.push(client));
        }
    }

    if from != 0 {
        let a = svr.add_atom_text(&server.class).await?;
        let t = svr.add_atom_text(&topic_name).await?;

        svr.user(
            "SendMessage",
            &[
                Arg::W(client),
                Arg::W(WM_DDE_ACK),
                Arg::W(from),
                Arg::D(long(a, t)),
            ],
        )
        .await?;
    }

    Ok(())
}

/// A message a client posted to a server's or a document's window,
/// handled.
async fn handle_message(
    svr: &Svr<'_>,
    hwnd: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<()> {
    let low = l_param as u16;
    let high = (l_param >> 16) as u16;

    if message == WM_DDE_TERMINATE {
        return terminated(svr, hwnd, w_param).await;
    }

    if let Some(server) = server_of(svr, u32::from(hwnd)) {
        match message {
            WM_DDE_EXECUTE => system_execute(svr, &server, w_param, high).await?,
            WM_DDE_REQUEST => system_request(svr, &server, w_param, low, high).await?,
            _ => {}
        }
    } else if doc_of(svr, u32::from(hwnd)).is_some() {
        match message {
            WM_DDE_EXECUTE => doc_execute(svr, hwnd, w_param, high).await?,
            WM_DDE_REQUEST => doc_request(svr, hwnd, w_param, low, high).await?,
            WM_DDE_ADVISE => doc_advise(svr, hwnd, w_param, low, high).await?,
            WM_DDE_UNADVISE => doc_unadvise(svr, hwnd, w_param, low, high).await?,
            WM_DDE_POKE => doc_poke(svr, hwnd, w_param, low, high).await?,
            _ => {}
        }
    }

    Ok(())
}

/// A client's `WM_DDE_TERMINATE`: answered unless it answers WinBox's, the
/// conversation forgotten.
async fn terminated(svr: &Svr<'_>, hwnd: u16, client: u16) -> R<()> {
    let ours = svr.svr().terminating.remove(&(hwnd, client));
    let server = server_of(svr, u32::from(hwnd));
    let doc = doc_of(svr, u32::from(hwnd));
    let revoking =
        server.as_ref().is_some_and(|s| s.revoking) || doc.as_ref().is_some_and(|d| d.revoking);

    if !ours && !revoking {
        post(svr, client, WM_DDE_TERMINATE, hwnd, 0).await?;
    }

    if server.is_some() {
        let revoking = with_server(svr, hwnd, |server| {
            server.convs.retain(|&conv| conv != client);
            server.revoking
        })
        .unwrap_or(false);

        if revoking {
            finish_server(svr, hwnd).await?;
        }
    }

    if doc.is_some() {
        let done = with_doc(svr, hwnd, |doc| {
            doc.convs.retain(|&conv| conv != client);
            doc.advises.retain(|advise| advise.conv != client);
            doc.named.retain(|&conv| conv != client);
            doc.revoking && doc.convs.is_empty()
        })
        .unwrap_or(false);

        if done {
            release_doc(svr, hwnd).await?;
        }
    }

    Ok(())
}

async fn ack(svr: &Svr<'_>, to: u16, from: u16, status: u16, high: u16) -> R<()> {
    post(svr, to, WM_DDE_ACK, from, long(status, high)).await
}

/// An execute on the system topic: `StdNewDocument(class,doc)`,
/// `StdEditDocument(doc)`, `StdOpenDocument(doc)`,
/// `StdNewFromTemplate(class,doc,template)` -- a document made by the
/// server's method, refused where it may take none -- and `StdExit`; any
/// other `Std` command, or text not in brackets, refused; anything else
/// the server's `Execute`, its answer the acknowledgement's (**recorded**
/// by `olesrv`).
async fn system_execute(svr: &Svr<'_>, server: &Server, client: u16, commands: u16) -> R<()> {
    let parsed = parse(&command_text(svr, commands).await?);
    let ok = match parsed.as_deref() {
        Some([first, ..]) if !is_std(first) => {
            method(
                svr,
                server.pointer,
                server_slot::EXECUTE,
                &[GuestArg::Word(commands)],
            )
            .await?
                == OLE_OK
        }
        Some([only]) => system_command(svr, server, only).await?,
        _ => false,
    };

    ack(
        svr,
        client,
        server.hwnd,
        if ok { ACK } else { NACK },
        commands,
    )
    .await
}

async fn system_command(svr: &Svr<'_>, server: &Server, command: &Command) -> R<bool> {
    let args = &command.args;

    if named(command, "StdExit") && args.is_empty() {
        return Ok(method(svr, server.pointer, server_slot::EXIT, &[]).await? == OLE_OK);
    }

    let shape = [
        ("StdNewDocument", 2, server_slot::CREATE),
        ("StdEditDocument", 1, server_slot::EDIT),
        ("StdOpenDocument", 1, server_slot::OPEN),
        ("StdNewFromTemplate", 3, server_slot::CREATE_FROM_TEMPLATE),
    ];
    let Some(&(_, _, slot)) = shape
        .iter()
        .find(|(name, count, _)| named(command, name) && args.len() == *count)
    else {
        return Ok(false);
    };
    let multi_full = with_server(svr, server.hwnd, |server| {
        server.multi && !server.docs.is_empty()
    })
    .unwrap_or(true);

    if multi_full {
        return Ok(false);
    }

    let doc_name = if slot == server_slot::OPEN || slot == server_slot::EDIT {
        args[0].clone()
    } else {
        args[1].clone()
    };
    let mut doc = new_doc(svr, server.hwnd, doc_name).await?;
    let out = svr.out_arg();
    let strings: Vec<Vec<u8>> = if slot == server_slot::OPEN {
        vec![args[0].clone()]
    } else if slot == server_slot::EDIT {
        vec![server.class.clone(), args[0].clone()]
    } else {
        args.clone()
    };
    let mut call = vec![GuestArg::Long(u32::from(doc.hwnd))];

    for bytes in &strings {
        call.push(GuestArg::Long(svr.string_arg(bytes)));
    }

    call.push(GuestArg::Long(out));

    let status = method(svr, server.pointer, slot, &call).await?;

    if status != OLE_OK || svr.r32(out) == 0 {
        svr.user("DestroyWindow", &[Arg::W(doc.hwnd)]).await?;
        return Ok(false);
    }

    doc.doc = svr.r32(out);
    keep_doc(svr, doc);
    Ok(true)
}

/// What the system topic answers: its topics, the formats, its status
/// (**recorded** by `olesrv`); any other item acknowledged with no data.
const SYSTEM_ITEMS: [(&str, &str); 3] = [
    ("Topics", "Doc"),
    ("Formats", "Picture\tBitmap"),
    ("Status", "Ready"),
];

async fn system_request(
    svr: &Svr<'_>,
    server: &Server,
    client: u16,
    format: u16,
    item: u16,
) -> R<()> {
    let name = atom_text(svr, item).await?;
    let Some((_, answer)) = SYSTEM_ITEMS
        .iter()
        .find(|(each, _)| same(&name, each.as_bytes()))
    else {
        return ack(svr, client, server.hwnd, ACK, item).await;
    };
    let mut bytes = word(DATA_RESPONSE).to_vec();

    bytes.extend_from_slice(&word(if format == 0 { CF_TEXT } else { format }));
    bytes.extend_from_slice(answer.as_bytes());
    bytes.push(0);

    let block = shared(svr, &bytes).await?;

    post(svr, client, WM_DDE_DATA, server.hwnd, long(block, item)).await
}

/// An execute on a document's topic: `StdShowItem(item[,focus])` -- the
/// object's `Show`, told to take the focus unless asked not to --,
/// `StdDoVerbItem(item,verb,show,focus)` -- its `DoVerb`, the focus as
/// `StdShowItem` turns it -- and `StdCloseDocument`, acknowledged before
/// the document's `Close`; anything else the document's `Execute`
/// (**recorded** by `olesrv`).
async fn doc_execute(svr: &Svr<'_>, doc: u16, client: u16, commands: u16) -> R<()> {
    let Some(found) = doc_of(svr, u32::from(doc)) else {
        return Ok(());
    };
    let parsed = parse(&command_text(svr, commands).await?);
    let command = match parsed.as_deref() {
        Some([only]) => Some(only),
        _ => None,
    };

    if command.is_some_and(|c| named(c, "StdCloseDocument")) {
        ack(svr, client, doc, ACK, commands).await?;
        method(svr, found.doc, doc_slot::CLOSE, &[]).await?;
        return Ok(());
    }

    let status = match command {
        Some(c) if named(c, "StdShowItem") && !c.args.is_empty() => {
            match object_of(svr, doc, &c.args[0], client).await? {
                Some(object) => {
                    let focus = u16::from(truth(c.args.get(1)) == 0);

                    method(
                        svr,
                        object.object,
                        object_slot::SHOW,
                        &[GuestArg::Word(focus)],
                    )
                    .await?
                }
                None => 1,
            }
        }
        Some(c) if named(c, "StdDoVerbItem") && !c.args.is_empty() => {
            match object_of(svr, doc, &c.args[0], client).await? {
                Some(object) => {
                    let focus = u16::from(truth(c.args.get(3)) == 0);

                    method(
                        svr,
                        object.object,
                        object_slot::DO_VERB,
                        &[
                            GuestArg::Word(truth(c.args.get(1))),
                            GuestArg::Word(truth(c.args.get(2))),
                            GuestArg::Word(focus),
                        ],
                    )
                    .await?
                }
                None => 1,
            }
        }
        _ => {
            method(
                svr,
                found.doc,
                doc_slot::EXECUTE,
                &[GuestArg::Word(commands)],
            )
            .await?
        }
    };

    ack(
        svr,
        client,
        doc,
        if status == OLE_OK { ACK } else { NACK },
        commands,
    )
    .await
}

/// An item of a document, as advised: its name, and when -- `Change`
/// where it names none.
fn item_when(name: &[u8]) -> (Vec<u8>, Vec<u8>) {
    match name.iter().rposition(|&b| b == b'/') {
        Some(slash) => (name[..slash].to_vec(), name[slash + 1..].to_vec()),
        None => (name.to_vec(), b"Change".to_vec()),
    }
}

/// A request of a document's item: its object's formats enumerated until
/// the one asked for, its data in `DDEDATA` as an answer; refused where
/// the document has no such item or it no such format (**recorded** by
/// `olesrv`).
async fn doc_request(svr: &Svr<'_>, doc: u16, client: u16, format: u16, item: u16) -> R<()> {
    let name = atom_text(svr, item).await?;
    let block = match object_of(svr, doc, &name, client).await? {
        Some(object) if enumerates(svr, &object, format).await? => {
            data_block(svr, doc, object.client, format, DATA_RESPONSE).await?
        }
        _ => 0,
    };

    if block == 0 {
        return ack(svr, client, doc, NACK, item).await;
    }

    post(svr, client, WM_DDE_DATA, doc, long(block, item)).await
}

/// An advise of a document's item: `StdDocumentName` kept; else the
/// object's formats enumerated until the one advised, and the format and
/// when kept. Acknowledged only where the advise asks its data be
/// acknowledged (**recorded** by `olesrv`: an advise without `fAckReq` is
/// answered with nothing); refused where there is no such item.
async fn doc_advise(svr: &Svr<'_>, doc: u16, client: u16, options: u16, item: u16) -> R<()> {
    let name = atom_text(svr, item).await?;
    let at = svr.global_lock(options).await?;
    let (flags, format) = if at == 0 {
        (0, 0)
    } else {
        (svr.r16(at), svr.r16(plus(at, 2)))
    };

    svr.global_unlock(options).await?;

    if same(&name, b"StdDocumentName") {
        with_doc(svr, doc, |doc| {
            if !doc.named.contains(&client) {
                doc.named.push(client);
            }
        });
    } else {
        let (base, when) = item_when(&name);
        let object = match object_of(svr, doc, &base, client).await? {
            Some(object) if enumerates(svr, &object, format).await? => object,
            _ => return ack(svr, client, doc, NACK, item).await,
        };

        with_doc(svr, doc, |doc| {
            let index = doc
                .advises
                .iter()
                .position(|a| a.conv == client && a.client == object.client)
                .unwrap_or_else(|| {
                    doc.advises.push(Advise {
                        conv: client,
                        client: object.client,
                        ..Advise::default()
                    });
                    doc.advises.len() - 1
                });
            let advise = &mut doc.advises[index];

            if !advise.formats.contains(&format) {
                advise.formats.push(format);
            }

            if !advise.whens.iter().any(|each| same(each, &when)) {
                advise.whens.push(when);
            }
        });
    }

    svr.global_free(options).await?;

    if flags & ADVISE_ACK_REQ != 0 {
        ack(svr, client, doc, ACK, item).await
    } else {
        svr.delete_atom(item).await?;
        Ok(())
    }
}

/// An unadvise: the format, or every format where it names none, no
/// longer sent.
async fn doc_unadvise(svr: &Svr<'_>, doc: u16, client: u16, format: u16, item: u16) -> R<()> {
    let name = atom_text(svr, item).await?;

    if same(&name, b"StdDocumentName") {
        with_doc(svr, doc, |doc| doc.named.retain(|&conv| conv != client));
    } else {
        let (base, _) = item_when(&name);

        with_doc(svr, doc, |doc| {
            let clients: Vec<u32> = doc
                .objects
                .iter()
                .filter(|o| same(&o.item, &base))
                .map(|o| o.client)
                .collect();

            for advise in &mut doc.advises {
                if advise.conv == client && clients.contains(&advise.client) {
                    if format == 0 {
                        advise.formats.clear();
                        advise.whens.clear();
                    } else {
                        advise.formats.retain(|&each| each != format);
                    }
                }
            }
        });
    }

    ack(svr, client, doc, ACK, item).await
}

/// A poke of a document's item: `StdHostNames` the document's
/// `SetHostNames`, `StdDocDimensions` its `SetDocDimensions` -- the first
/// width and height as a rectangle from nought, the height its top --,
/// `StdColorScheme` its `SetColorScheme`, `StdTargetDevice` kept for each
/// object's first data; any other item its object's `SetData`, a block of
/// the data alone (**recorded** by `olesrv`).
async fn doc_poke(svr: &Svr<'_>, doc: u16, client: u16, data: u16, item: u16) -> R<()> {
    let Some(found) = doc_of(svr, u32::from(doc)) else {
        return Ok(());
    };
    let name = atom_text(svr, item).await?;
    let at = svr.global_lock(data).await?;
    let (flags, format) = if at == 0 {
        (0, 0)
    } else {
        (svr.r16(at), svr.r16(plus(at, 2)))
    };
    let value = plus(at, 4);
    let size = svr.global_size(data).await?.saturating_sub(4);
    let status;

    if same(&name, b"StdHostNames") {
        let client_at = plus(value, 4 + svr.r16(value));
        let doc_at = plus(value, 4 + svr.r16(plus(value, 2)));

        status = method(
            svr,
            found.doc,
            doc_slot::SET_HOST_NAMES,
            &[GuestArg::Long(client_at), GuestArg::Long(doc_at)],
        )
        .await?;
    } else if same(&name, b"StdDocDimensions") {
        let rect = svr.near(RECT_AT);
        let width = svr.r16(value);
        let height = svr.r16(plus(value, 2));
        let mut bytes = Vec::new();

        for side in [0, height, width, 0] {
            bytes.extend_from_slice(&word(side));
        }

        svr.write(rect, &bytes);
        status = method(
            svr,
            found.doc,
            doc_slot::SET_DOC_DIMENSIONS,
            &[GuestArg::Long(rect)],
        )
        .await?;
    } else if same(&name, b"StdColorScheme") {
        status = method(
            svr,
            found.doc,
            doc_slot::SET_COLOR_SCHEME,
            &[GuestArg::Long(value)],
        )
        .await?;
    } else if same(&name, b"StdTargetDevice") {
        let bytes = svr.read(value, size as usize);

        with_doc(svr, doc, |doc| {
            doc.target = Some(bytes);

            for object in &mut doc.objects {
                object.targeted = false;
            }
        });
        status = OLE_OK;
    } else if let Some(object) = object_of(svr, doc, &name, client).await? {
        let copy = if BY_HANDLE.contains(&format) {
            svr.r16(value)
        } else {
            let bytes = svr.read(value, size as usize);

            shared(svr, &bytes).await?
        };

        status = method(
            svr,
            object.object,
            object_slot::SET_DATA,
            &[GuestArg::Word(format), GuestArg::Word(copy)],
        )
        .await?;
    } else {
        status = 1;
    }

    svr.global_unlock(data).await?;

    if status == OLE_OK && flags & 0x2000 != 0 {
        svr.global_free(data).await?;
    }

    ack(
        svr,
        client,
        doc,
        if status == OLE_OK { ACK } else { NACK },
        item,
    )
    .await
}
