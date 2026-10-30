//! What WinBox's `OLESVR` stands on: `OLECLI`'s routines for guest memory
//! and for calls into KERNEL, USER and GDI (`olecli/core.rs`), with its own
//! data segment and its own state. As `src/win16/olesvr/core.ts`.
//!
//! Written from OLE 1.0's documented interface (`ole.h`, the OLE 1.0
//! programmer's reference: the server API and the DDE protocol) and from
//! what the probe `olesrv` measured under DOSBox; nothing here is taken
//! from the code of `OLESVR.DLL` (`kb/topics/ole.md`).

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
/// A `DDEADVISE`'s `fAckReq`.
pub(crate) const ADVISE_ACK_REQ: u16 = 0x8000;

pub(crate) const CF_TEXT: u16 = 1;
pub(crate) const CF_BITMAP: u16 = 2;
pub(crate) const CF_METAFILEPICT: u16 = 3;
pub(crate) const CF_PALETTE: u16 = 9;

pub(crate) const GMEM_MOVEABLE: u16 = 0x0002;
pub(crate) const GMEM_DDESHARE: u16 = 0x2000;
pub(crate) const HKEY_CLASSES_ROOT: u32 = 1;
pub(crate) const WS_CHILD: u32 = 0x4000_0000;

/// Where WinBox's `OLESVR` keeps its own in its data segment, each laid
/// out here: the method table of the `OLECLIENT` it gives a server's
/// object (its one method, `CallBack`, a far pointer to `ITEMCALLBACK`);
/// the name of a window class as it is registered or a window made; the
/// strings and out-pointers a server's methods are given, each in a slot
/// of its own taken in turn; a `RECT` a document's dimensions are given
/// in; where a class's value in the registration database is read, and
/// its size; and the `OLECLIENT`s themselves, one for each object a
/// server gives, each a far pointer to the table.
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
pub(crate) const CLIENTS: u16 = 0x1000;
pub(crate) const CLIENT_SIZE: u16 = 4;
pub(crate) const CLIENT_SLOTS: u16 = 0x400;

/// One object a server's document gave, by its item.
#[derive(Debug, Clone, Default)]
pub struct SvrObject {
    pub item: Vec<u8>,
    /// The `LPOLEOBJECT` its document gave.
    pub object: u32,
    /// The `LPOLECLIENT` WinBox gave for it.
    pub client: u32,
    /// Whether the target device poked to its document has been given it.
    pub targeted: bool,
    /// The clients' windows of the conversations it was given in.
    pub convs: Vec<u16>,
}

/// What one conversation advised of one object: its formats in the order
/// first advised, and when.
#[derive(Debug, Clone, Default)]
pub struct Advise {
    pub conv: u16,
    /// The object's client, which names it.
    pub client: u32,
    pub formats: Vec<u16>,
    pub whens: Vec<Vec<u8>>,
}

/// A document: its window is its handle, `LHSERVERDOC`.
#[derive(Debug, Clone, Default)]
pub struct SvrDoc {
    pub hwnd: u16,
    pub server: u16,
    pub name: Vec<u8>,
    /// The `LPOLESERVERDOC`.
    pub doc: u32,
    /// The clients' windows of its conversations.
    pub convs: Vec<u16>,
    pub objects: Vec<SvrObject>,
    pub advises: Vec<Advise>,
    /// The conversations that advised `StdDocumentName`.
    pub named: Vec<u16>,
    /// A target device poked, its bytes; given each object before its
    /// first data.
    pub target: Option<Vec<u8>>,
    /// Revoked, waiting for its conversations to end.
    pub revoking: bool,
}

/// A server: its window is its handle, `LHSERVER`.
#[derive(Debug, Clone, Default)]
pub struct Server {
    pub hwnd: u16,
    pub class: Vec<u8>,
    /// The `LPOLESERVER`.
    pub pointer: u32,
    pub multi: bool,
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
    pub free_clients: std::collections::VecDeque<u16>,
    pub next_client: u16,
    /// The conversations WinBox ended and waits to hear end: window and
    /// client.
    pub terminating: HashSet<(u16, u16)>,
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

    /// An `OLECLIENT` for an object, its table WinBox's: its far pointer.
    pub(crate) fn new_client(&self) -> u32 {
        let slot = {
            let mut state = self.svr();

            if let Some(slot) = state.free_clients.pop_front() {
                slot
            } else {
                let slot = state.next_client % CLIENT_SLOTS;

                state.next_client = state.next_client.wrapping_add(1);
                slot
            }
        };
        let at = self.near(CLIENTS + slot * CLIENT_SIZE);

        self.w32(at, self.near(CLIENT_VTBL));
        at
    }

    pub(crate) fn free_client(&self, client: u32) {
        let mut state = self.svr();

        state.clients.remove(&client);
        state
            .free_clients
            .push_back(((client as u16).wrapping_sub(CLIENTS)) / CLIENT_SIZE);
    }
}
