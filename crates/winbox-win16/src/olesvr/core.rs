//! What WinBox's `OLESVR` stands on: `OLECLI`'s routines for guest memory
//! and for calls into KERNEL, USER and GDI (`olecli/core.rs`), with its own
//! data segment and its own state. As `src/win16/olesvr/core.ts`.
//!
//! Written from OLE 1.0's documented interface (`ole.h`, the OLE 1.0
//! programmer's reference: the server API and the DDE protocol) and from
//! what the probes `olesrv` and `oleitem` measured under DOSBox; where a
//! read-out of `OLESVR.DLL` settled what no probe could, it is described
//! in prose and cited (`kb/topics/ole.md`).

use std::collections::{HashMap, HashSet};

use winbox_cpu::DS;

use crate::engine::{Engine, GuestArg, Register};
pub(crate) use crate::olecli::core::R;
use crate::olecli::core::{Ole, far};

/// `OLESTATUS` (ole.h).
pub(crate) const OLE_OK: u16 = 0;
pub(crate) const OLE_WAIT_FOR_RELEASE: u16 = 1;
pub(crate) const OLE_ERROR_ADDRESS: u16 = 16;
pub(crate) const OLE_ERROR_HANDLE: u16 = 18;
pub(crate) const OLE_ERROR_CLASS: u16 = 20;
/// `OLE_ERROR_CANT_UPDATE_CLIENT` (ole.h): an embedded document saved
/// where no client was sent its data.
pub(crate) const OLE_ERROR_CANT_UPDATE_CLIENT: u16 = 52;

/// `OleQueryServerVersion`'s answer, 1001h (**recorded** by `olesrv`).
pub(crate) const SERVER_VERSION: u32 = 0x1001;

/// `OLE_SERVER_USE` (ole.h): many instances, one document each.
pub(crate) const OLE_SERVER_MULTI: u16 = 0;

/// The notifications an object's client is told (ole.h).
pub(crate) const OLE_CHANGED: u16 = 0;
pub(crate) const OLE_SAVED: u16 = 1;
pub(crate) const OLE_CLOSED: u16 = 2;
pub(crate) const OLE_RENAMED: u16 = 3;

/// DDE's messages (dde.h).
pub(crate) const WM_DDE_INITIATE: u16 = 0x3e0;
pub(crate) const WM_DDE_TERMINATE: u16 = 0x3e1;
pub(crate) const WM_DDE_ADVISE: u16 = 0x3e2;
pub(crate) const WM_DDE_UNADVISE: u16 = 0x3e3;
pub(crate) const WM_DDE_ACK: u16 = 0x3e4;
pub(crate) const WM_DDE_DATA: u16 = 0x3e5;
pub(crate) const WM_DDE_REQUEST: u16 = 0x3e6;
pub(crate) const WM_DDE_POKE: u16 = 0x3e7;
pub(crate) const WM_DDE_EXECUTE: u16 = 0x3e8;

/// A `WM_DDE_ACK`'s status: positive, and negative.
pub(crate) const ACK: u16 = 0x8000;
pub(crate) const NACK: u16 = 0x0000;
/// A `DDEDATA`'s flags: an answer to a request, the client to free it;
/// data advised, the client to free it (**recorded** by `olesrv`).
pub(crate) const DATA_RESPONSE: u16 = 0x3000;
pub(crate) const DATA_ADVISED: u16 = 0x2000;
/// A `DDEADVISE`'s `fAckReq`, and its `fDeferUpd`.
pub(crate) const ADVISE_ACK_REQ: u16 = 0x8000;
pub(crate) const ADVISE_DEFER: u16 = 0x4000;

pub(crate) const CF_TEXT: u16 = 1;
pub(crate) const CF_BITMAP: u16 = 2;
pub(crate) const CF_METAFILEPICT: u16 = 3;
pub(crate) const CF_PALETTE: u16 = 9;

pub(crate) const GMEM_MOVEABLE: u16 = 0x0002;
pub(crate) const GMEM_DDESHARE: u16 = 0x2000;
pub(crate) const GMEM_ZEROINIT: u16 = 0x0040;
pub(crate) const HKEY_CLASSES_ROOT: u32 = 1;
pub(crate) const WS_CHILD: u32 = 0x4000_0000;

/// Where WinBox's `OLESVR` keeps its own in its data segment, each laid
/// out here: the method table of the `OLECLIENT` it gives a server's
/// object (its one method, `CallBack`, a far pointer to `ITEMCALLBACK`);
/// the name of a window class as it is registered or a window made; the
/// strings and out-pointers a server's methods are given, each in a slot
/// of its own taken in turn; a `RECT` a document's dimensions are given
/// in; where a class's value in the registration database is read, and
/// its size; what a client asked of an item, one block for each client
/// of each item, a word naming it kept as the client's property on the
/// item's window; and the records a server's and a document's window
/// words point at.
pub(crate) const CLIENT_VTBL: u16 = 0x100;
pub(crate) const CLASS_NAME: u16 = 0x180;
pub(crate) const STRINGS: u16 = 0x200;
pub(crate) const STRING_SLOTS: u16 = 8;
pub(crate) const STRING_SIZE: u16 = 0x100;
pub(crate) const OUTS: u16 = 0xa00;
pub(crate) const OUT_SLOTS: u16 = 16;
pub(crate) const RECT_AT: u16 = 0xa80;
pub(crate) const REG_VALUE: u16 = 0xb00;
pub(crate) const REG_SIZE: u16 = 0xbfc;

/// What a client asked of an item, as `OLESVR.DLL` keeps it: a block of
/// 0Eh bytes in its data segment, named by a word that is the datum of
/// the client's property on the item's window (**recorded** by `oleitem`:
/// a handle, not the client's window). Its fields, by the file's use of
/// them (read out, `OLESVR.DLL` seg3 `26d4`-`270f`, `2d74`-`2e73`): the
/// client's window; whether it advised native data; the one other format
/// it advised, the last; the times it advised, a bit for each (`Change`
/// 0, `Save` 1, `Close` 2); whether it wants data with them, the last
/// advise's say; a target device's block and whether it is new, which
/// WinBox keeps by the document instead (`SvrDoc::target`). WinBox's
/// blocks are slots of 10h bytes from `INFOS`, each named by its offset:
/// below 2000h, where no window's handle is, as the file's local handles
/// are none.
pub(crate) const INFOS: u16 = 0x1000;
pub(crate) const INFO_SIZE: u16 = 0x10;
pub(crate) const INFO_SLOTS: u16 = 0x100;
pub(crate) const INFO_CLIENT: u16 = 0;
pub(crate) const INFO_NATIVE: u16 = 2;
pub(crate) const INFO_FORMAT: u16 = 4;
pub(crate) const INFO_WHENS: u16 = 6;
pub(crate) const INFO_DATA: u16 = 8;
/// The times an item is advised for, by their bits in `INFO_WHENS`.
pub(crate) const WHENS: [&[u8]; 3] = [b"Change", b"Save", b"Close"];

/// The records a server's and a document's window words point at: the
/// program's `LPOLESERVER` or `LPOLESERVERDOC`, each in a slot of 4 bytes.
pub(crate) const RECORDS: u16 = 0x6000;
pub(crate) const RECORD_SIZE: u16 = 4;
pub(crate) const RECORD_SLOTS: u16 = 0x400;

/// An item's block, the `OLECLIENT` its object is given, as `OLESVR.DLL`
/// lays it out (**recorded** by `oleitem`, an item window's words
/// pointing at it): a block of 10h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT
/// | GMEM_DDESHARE`, locked; the client's method table; the object; the
/// block's handle; the item's atom, nought for the document itself; the
/// item's window.
pub(crate) const ITEM_SIZE: u32 = 0x10;
pub(crate) const ITEM_VTBL: u16 = 0;
pub(crate) const ITEM_OBJECT: u16 = 4;
pub(crate) const ITEM_HANDLE: u16 = 8;
pub(crate) const ITEM_ATOM: u16 = 0xa;
pub(crate) const ITEM_HWND: u16 = 0xc;

/// An item's window's and a document's window's texts (**recorded** by
/// `oleitem`).
pub(crate) const ITEM_TEXT: &str = "ITEM";
pub(crate) const DOC_TEXT: &str = "Doc";

/// `FINDITEMWND`'s requests, the high word of its `LPARAM` (read out,
/// `OLESVR.DLL` seg3 `22c9`-`22d8`).
pub(crate) const FIND_ITEM: u16 = 1;
pub(crate) const FORGET_CLIENT: u16 = 2;
pub(crate) const DESTROY_ITEM: u16 = 3;
pub(crate) const TELL_SAVED: u16 = 4;

/// WinBox's `OLESVR`'s exports it hands USER as procedures, by ordinal.
pub(crate) const SENDDATAMSG: u16 = 24;
pub(crate) const FINDITEMWND: u16 = 25;
pub(crate) const DELETECLIENTINFO: u16 = 29;

/// One object a server's document gave, by its item: its window holds
/// its clients.
#[derive(Debug, Clone, Default)]
pub struct SvrObject {
    pub item: Vec<u8>,
    /// The `LPOLEOBJECT` its document gave.
    pub object: u32,
    /// The `LPOLECLIENT` WinBox gave for it: its item's block, locked.
    pub client: u32,
    /// The block's handle, and the item's atom (nought for the document
    /// itself).
    pub handle: u16,
    pub atom: u16,
    /// The item's window, `ItemWndClass`, its document's child.
    pub hwnd: u16,
    /// Whether the target device poked to its document has been given it.
    pub targeted: bool,
    /// The clients' windows of the conversations it was given in.
    pub convs: Vec<u16>,
}

/// A document: its window is its handle, `LHSERVERDOC`.
#[derive(Debug, Clone, Default)]
pub struct SvrDoc {
    pub hwnd: u16,
    pub server: u16,
    pub name: Vec<u8>,
    /// The `LPOLESERVERDOC`.
    pub doc: u32,
    /// Its window words' record.
    pub record: u32,
    /// The clients' windows of its conversations.
    pub convs: Vec<u16>,
    pub objects: Vec<SvrObject>,
    /// The conversations that advised `StdDocumentName`.
    pub named: Vec<u16>,
    /// A target device poked, its bytes; given each object before its
    /// first data.
    pub target: Option<Vec<u8>>,
    /// Made by `StdNewDocument`, `StdEditDocument` or
    /// `StdNewFromTemplate`, and not renamed since.
    pub embedded: bool,
    /// Revoked, waiting for its conversations to end.
    pub revoking: bool,
}

/// A server: its window is its handle, `LHSERVER`.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Default)]
pub struct Server {
    pub hwnd: u16,
    pub class: Vec<u8>,
    /// The `LPOLESERVER`.
    pub pointer: u32,
    /// Its window words' record.
    pub record: u32,
    pub multi: bool,
    /// A document just made for a client, which has not yet begun a
    /// conversation: its server is not let go meanwhile.
    pub fresh: bool,
    /// Its documents' windows, in the order made.
    pub docs: Vec<u16>,
    /// The clients' windows of its system conversations.
    pub convs: Vec<u16>,
    pub blocked: bool,
    /// Messages posted while blocked: window, message, wParam, lParam.
    pub queue: std::collections::VecDeque<(u16, u16, u16, u32)>,
    /// Revoked, waiting for its conversations to end.
    pub revoking: bool,
}

/// What WinBox's `OLESVR` keeps beside guest memory.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Default)]
pub struct State {
    pub started: bool,
    pub instance: u16,
    /// `Native`, `Binary`, `ObjectLink`, `OwnerLink`, as registered.
    pub formats: Vec<u16>,
    pub servers: HashMap<u16, Server>,
    pub docs: HashMap<u16, SvrDoc>,
    /// Each object's document, by its `OLECLIENT`'s far pointer.
    pub clients: HashMap<u32, u16>,
    pub next_string: u16,
    pub next_out: u16,
    /// The clients' blocks in use, and those to take again.
    pub infos: HashSet<u16>,
    pub free_infos: std::collections::VecDeque<u16>,
    pub next_info: u16,
    pub free_records: std::collections::VecDeque<u16>,
    pub next_record: u16,
    /// The conversations WinBox ended and waits to hear end: window and
    /// client.
    pub terminating: HashSet<(u16, u16)>,
    /// What `SENDDATAMSG` sends: the time's bit, and whether any client
    /// was sent it.
    pub when: u16,
    pub sent: bool,
    /// The window `FINDITEMWND` found.
    pub found: u16,
    /// Whether every object saved was sent to a client
    /// (`OleSavedServerDoc`).
    pub saved: bool,
    /// Whether `DELETECLIENTINFO` ends a client's conversation with the
    /// document: set as an item is let go so.
    pub ending: bool,
    /// The item whose clients `ENUMFORTERMINATE` leaves be.
    pub spared: u16,
}

/// WinBox's `OLESVR` as it runs.
pub(crate) struct Svr<'e> {
    pub o: Ole<'e>,
}

impl<'e> std::ops::Deref for Svr<'e> {
    type Target = Ole<'e>;

    fn deref(&self) -> &Ole<'e> {
        &self.o
    }
}

impl<'e> Svr<'e> {
    pub(crate) fn new(e: &'e Engine) -> Self {
        Self { o: Ole::new(e) }
    }

    /// `OLESVR`'s data segment's selector.
    pub(crate) fn ds(&self) -> u16 {
        super::data_selector(&self.e.system())
    }

    pub(crate) fn near(&self, at: u16) -> u32 {
        far(self.ds(), at)
    }

    pub(crate) fn svr(&self) -> std::cell::RefMut<'_, State> {
        std::cell::RefMut::map(self.e.system(), |system| &mut system.olesvr)
    }

    /// A program's procedure called far with words and doublewords as
    /// given, with `OLESVR`'s DS: its answer, AX.
    pub(crate) async fn call_far(&self, procedure: u32, args: &[GuestArg]) -> R<u16> {
        let ds = self.ds();

        Ok(self
            .e
            .call_with(procedure, args, &[Register::Segment(DS, ds)])
            .await?
            .0 as u16)
    }

    /// A string written into the next of the slots for a method's
    /// arguments: its far pointer.
    pub(crate) fn string_arg(&self, bytes: &[u8]) -> u32 {
        let slot = {
            let mut state = self.svr();
            let slot = state.next_string % STRING_SLOTS;

            state.next_string = state.next_string.wrapping_add(1);
            slot
        };
        let at = self.near(STRINGS + slot * STRING_SIZE);
        let mut copy = bytes[..bytes.len().min(usize::from(STRING_SIZE) - 1)].to_vec();

        copy.push(0);
        self.write(at, &copy);
        at
    }

    /// The next of the slots a method writes a far pointer into, cleared:
    /// its far pointer.
    pub(crate) fn out_arg(&self) -> u32 {
        let slot = {
            let mut state = self.svr();
            let slot = state.next_out % OUT_SLOTS;

            state.next_out = state.next_out.wrapping_add(1);
            slot
        };
        let at = self.near(OUTS + slot * 4);

        self.w32(at, 0);
        at
    }

    /// A client's block for an item, cleared: the word naming it.
    pub(crate) fn new_info(&self) -> u16 {
        let handle = {
            let mut state = self.svr();
            let slot = if let Some(slot) = state.free_infos.pop_front() {
                slot
            } else {
                let slot = state.next_info % INFO_SLOTS;

                state.next_info = state.next_info.wrapping_add(1);
                slot
            };
            let handle = INFOS + slot * INFO_SIZE;

            state.infos.insert(handle);
            handle
        };

        self.write(self.near(handle), &[0; INFO_SIZE as usize]);
        handle
    }

    /// Whether a word names a client's block in use.
    pub(crate) fn is_info(&self, handle: u16) -> bool {
        self.svr().infos.contains(&handle)
    }

    pub(crate) fn info(&self, handle: u16, field: u16) -> u16 {
        self.r16(self.near(handle.wrapping_add(field)))
    }

    pub(crate) fn set_info(&self, handle: u16, field: u16, value: u16) {
        self.w16(self.near(handle.wrapping_add(field)), value);
    }

    pub(crate) fn free_info(&self, handle: u16) {
        let mut state = self.svr();

        if state.infos.remove(&handle) {
            state.free_infos.push_back((handle - INFOS) / INFO_SIZE);
        }
    }

    /// A record for a window's words, holding a program's pointer: its far
    /// pointer.
    pub(crate) fn new_record(&self, pointer: u32) -> u32 {
        let slot = {
            let mut state = self.svr();

            if let Some(slot) = state.free_records.pop_front() {
                slot
            } else {
                let slot = state.next_record % RECORD_SLOTS;

                state.next_record = state.next_record.wrapping_add(1);
                slot
            }
        };
        let at = self.near(RECORDS + slot * RECORD_SIZE);

        self.w32(at, pointer);
        at
    }

    pub(crate) fn free_record(&self, at: u32) {
        self.w32(at, 0);
        self.svr()
            .free_records
            .push_back((at as u16).wrapping_sub(RECORDS) / RECORD_SIZE);
    }
}
