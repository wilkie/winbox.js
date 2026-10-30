//! What every routine of WinBox's `OLECLI` stands on: guest memory, the
//! calls it makes into KERNEL, USER and GDI (through `commdlg/api.rs`, as a
//! program's call reaches them, unlogged), its own data segment, and the
//! layouts of the blocks a program holds pointers to. As
//! `src/win16/olecli/core.ts`.
//!
//! Written from OLE 1.0's documented interface (`ole.h`, the OLE 1.0
//! programmer's reference) and from what the probes measured under DOSBox:
//! `olestat` (answers, streams' bytes) and `olemem` (the blocks behind a
//! document's handle and an object's pointer, each method table, each
//! method called through its table). Nothing here is taken from the code of
//! `OLECLI.DLL`.

use crate::call::Stop;
use crate::commdlg::api::{self, Arg, Called, text};
use crate::engine::{Engine, GuestArg, Register};

use winbox_cpu::DS;

pub(crate) type R<T> = Result<T, Stop>;

pub(crate) const fn sel(far: u32) -> u16 {
    (far >> 16) as u16
}

pub(crate) const fn off(far: u32) -> u16 {
    far as u16
}

pub(crate) const fn far(selector: u16, offset: u16) -> u32 {
    (selector as u32) << 16 | offset as u32
}

pub(crate) const fn plus(at: u32, n: u16) -> u32 {
    far(sel(at), off(at).wrapping_add(n))
}

/// `OLESTATUS` (ole.h).
pub(crate) const OLE_OK: u16 = 0;
pub(crate) const OLE_ERROR_MEMORY: u16 = 4;
pub(crate) const OLE_ERROR_STREAM: u16 = 5;
pub(crate) const OLE_ERROR_STATIC: u16 = 6;
pub(crate) const OLE_ERROR_DRAW: u16 = 8;
pub(crate) const OLE_ERROR_ABORT: u16 = 10;
pub(crate) const OLE_ERROR_FORMAT: u16 = 12;
pub(crate) const OLE_ERROR_OBJECT: u16 = 13;
pub(crate) const OLE_ERROR_PROTOCOL: u16 = 15;
pub(crate) const OLE_ERROR_ADDRESS: u16 = 16;
pub(crate) const OLE_ERROR_NOT_EQUAL: u16 = 17;
pub(crate) const OLE_ERROR_HANDLE: u16 = 18;
pub(crate) const OLE_ERROR_GENERIC: u16 = 19;
pub(crate) const OLE_ERROR_CLASS: u16 = 20;
pub(crate) const OLE_ERROR_NOT_EMPTY: u16 = 25;
pub(crate) const OLE_ERROR_SIZE: u16 = 26;
pub(crate) const OLE_ERROR_NAME: u16 = 29;
pub(crate) const OLE_ERROR_STATIC_FROM_OTHER_OS: u16 = 55;

/// Object types (ole.h): what `OleQueryType` answers, and a stream's
/// second doubleword.
pub(crate) const OT_STATIC: u32 = 3;

/// `OLEOPT_RENDER` (ole.h).
pub(crate) const OLERENDER_DRAW: u16 = 1;
pub(crate) const OLERENDER_FORMAT: u16 = 2;

/// `OleQueryClientVersion`'s answer: 1001h, **recorded** by `olestat`.
pub(crate) const CLIENT_VERSION: u32 = 0x1001;

/// A stream's first doubleword: OLE's version 0501h, and the system that
/// wrote it, nought for Windows (**recorded** by `olestat`'s streams).
pub(crate) const STREAM_VERSION: u32 = 0x0501;

/// Clipboard formats.
pub(crate) const CF_BITMAP: u16 = 2;
pub(crate) const CF_METAFILEPICT: u16 = 3;
pub(crate) const CF_DIB: u16 = 8;

/// GDI's and KERNEL's numbers OLECLI's calls use.
pub(crate) const GMEM_MOVEABLE: u16 = 0x0002;
pub(crate) const GMEM_ZEROINIT: u16 = 0x0040;
pub(crate) const GMEM_DDESHARE: u16 = 0x2000;
pub(crate) const TECHNOLOGY: u16 = 2;
pub(crate) const DT_METAFILE: i16 = 5;
pub(crate) const LOGPIXELSX: u16 = 88;
pub(crate) const LOGPIXELSY: u16 = 90;
pub(crate) const MM_TEXT: u16 = 1;
pub(crate) const MM_ANISOTROPIC: u16 = 8;
pub(crate) const SRCCOPY: u32 = 0x00cc_0020;
pub(crate) const DEFAULT_PALETTE: u16 = 15;

/// A client document's block, `GMEM_MOVEABLE | GMEM_ZEROINIT |
/// GMEM_DDESHARE`, 18h bytes, its handle the far pointer to it
/// (**measured** by `olemem`, word by word): the signature `CD`, the first
/// and last of its objects, the class's and the document's atoms, the
/// block's own handle, and the documents before and after it, each a far
/// pointer.
pub(crate) const DOC_SIZE: u32 = 0x18;
pub(crate) const DOC_SIGNATURE: u16 = 0x4443;
pub(crate) const DOC_FIRST: u16 = 2;
pub(crate) const DOC_LAST: u16 = 6;
pub(crate) const DOC_CLASS: u16 = 10;
pub(crate) const DOC_NAME: u16 = 12;
pub(crate) const DOC_HANDLE: u16 = 14;
pub(crate) const DOC_PREVIOUS: u16 = 16;
pub(crate) const DOC_NEXT: u16 = 20;

/// An object's block, `GMEM_MOVEABLE | GMEM_ZEROINIT`, the far pointer to
/// it the `LPOLEOBJECT` (**measured** by `olemem`): its method table, as
/// `OLEOBJECT` has it (ole.h); the signature `LE`; its block's handle; its
/// client; its type; its width and height in `MM_HIMETRIC`, the height
/// negative; a word 8 for a picture and 1 for the others; a word `FFFFh`;
/// its name's atom; its document; the objects before and after it in the
/// document; and from 30h what its kind keeps.
pub(crate) const OBJ_VTBL: u16 = 0;
pub(crate) const OBJ_SIGNATURE: u16 = 4;
pub(crate) const OBJ_HANDLE: u16 = 6;
pub(crate) const OBJ_CLIENT: u16 = 8;
pub(crate) const OBJ_TYPE: u16 = 12;
pub(crate) const OBJ_WIDTH: u16 = 16;
pub(crate) const OBJ_HEIGHT: u16 = 20;
pub(crate) const OBJ_MAPPING: u16 = 24;
pub(crate) const OBJ_UNKNOWN_FFFF: u16 = 28;
pub(crate) const OBJ_NAME: u16 = 30;
pub(crate) const OBJ_DOC: u16 = 32;
pub(crate) const OBJ_PREVIOUS: u16 = 36;
pub(crate) const OBJ_NEXT: u16 = 40;
pub(crate) const OBJ_SIGNATURE_LE: u16 = 0x454c;
/// A picture's size, its `METAFILEPICT`'s mode, extents and metafile, and
/// the `METAFILEPICT` `OleGetData` handed out.
pub(crate) const MF_SIZE: u16 = 0x30;
pub(crate) const MF_MM: u16 = 0x34;
pub(crate) const MF_XEXT: u16 = 0x36;
pub(crate) const MF_YEXT: u16 = 0x38;
pub(crate) const MF_METAFILE: u16 = 0x3a;
pub(crate) const MF_PICTURE: u16 = 0x3c;
pub(crate) const MF_BLOCK: u32 = 0x48;
/// A bitmap's size (its `BITMAP`'s 14 bytes and its bits), width, height
/// and bitmap.
pub(crate) const BM_SIZE: u16 = 0x30;
pub(crate) const BM_WIDTH: u16 = 0x34;
pub(crate) const BM_HEIGHT: u16 = 0x36;
pub(crate) const BM_BITMAP: u16 = 0x38;
/// A DIB's size (its block's) and its block.
pub(crate) const DIB_SIZE: u16 = 0x30;
pub(crate) const DIB_DATA: u16 = 0x38;
/// Another class's object: its format, its class's atom, its data's size
/// and its data.
pub(crate) const GEN_FORMAT: u16 = 0x30;
pub(crate) const GEN_CLASS: u16 = 0x32;
pub(crate) const GEN_SIZE: u16 = 0x34;
pub(crate) const GEN_DATA: u16 = 0x38;
pub(crate) const SMALL_BLOCK: u32 = 0x3a;

/// The 39 methods of `OLEOBJECTVTBL`, in ole.h's order: an object's table
/// holds a far pointer to each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Every slot named, those WinBox calls through no `Ole` function too: a
// method's slot is its place in the table.
#[allow(dead_code, clippy::enum_variant_names)]
pub(crate) enum Method {
    QueryProtocol,
    Release,
    Show,
    DoVerb,
    GetData,
    SetData,
    SetTargetDevice,
    SetBounds,
    EnumFormats,
    SetColorScheme,
    Delete,
    SetHostNames,
    SaveToStream,
    Clone,
    CopyFromLink,
    Equal,
    CopyToClipboard,
    Draw,
    Activate,
    Execute,
    Close,
    Update,
    Reconnect,
    ObjectConvert,
    GetLinkUpdateOptions,
    SetLinkUpdateOptions,
    Rename,
    QueryName,
    QueryType,
    QueryBounds,
    QuerySize,
    QueryOpen,
    QueryOutOfDate,
    QueryReleaseStatus,
    QueryReleaseError,
    QueryReleaseMethod,
    RequestData,
    ObjectLong,
    ChangeData,
}

/// The four kinds of WinBox's objects: a picture, a bitmap, a DIB, and
/// another class's data read from a stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Mf,
    Bm,
    Dib,
    Gen,
}

impl Kind {
    pub(crate) const ALL: [Self; 4] = [Self::Mf, Self::Bm, Self::Dib, Self::Gen];

    /// Where its method table is in `OLECLI`'s data segment.
    pub(crate) const fn vtbl_at(self) -> u16 {
        match self {
            Self::Mf => 0x100,
            Self::Bm => 0x200,
            Self::Dib => 0x300,
            Self::Gen => 0x400,
        }
    }

    /// Its table, as the ordinal of the `OLECLI` export each method is, in
    /// `Method`'s order (**measured** by `olemem`, the address in each
    /// slot found by `GetProcAddress`): the methods that refuse are the
    /// `ERR` exports, 700 on; 1026 to 1030 are entries with no name.
    pub(crate) fn table(self) -> [u16; 39] {
        let base = match self {
            Self::Mf => 300,
            Self::Bm => 400,
            Self::Dib => 500,
            Self::Gen => 600,
        };

        if self == Self::Gen {
            return [
                712, 600, 701, 1029, 601, 602, 704, 705, 610, 1028, 600, 703, 603, 604, 706, 605,
                606, 609, 708, 717, 709, 710, 711, 714, 715, 716, 911, 910, 1030, 608, 913, 707,
                713, 1027, 1027, 1027, 1026, 718, 611,
            ];
        }

        [
            712,
            base,
            701,
            1029,
            base + 1,
            702,
            704,
            705,
            base + 9,
            1028,
            base,
            703,
            base + 2,
            base + 3,
            706,
            base + 4,
            base + 5,
            base + 8,
            708,
            717,
            709,
            710,
            711,
            714,
            715,
            716,
            911,
            910,
            912,
            base + 7,
            913,
            707,
            713,
            1027,
            1027,
            1027,
            1026,
            718,
            base + 10,
        ]
    }
}

/// Where WinBox's `OLECLI` keeps its own in its data segment: a scratch
/// area for what it hands a stream, the name a stream last gave a format,
/// and the class names it registers.
pub(crate) const SCRATCH: u16 = 0x800;
pub(crate) const FORMAT_NAME: u16 = 0x900;
pub(crate) const CLASS_NAME: u16 = 0xa00;
/// How much of a format's name a stream may give.
pub(crate) const FORMAT_NAME_SIZE: u32 = 0x100;

/// What WinBox's `OLECLI` keeps beside guest memory.
#[derive(Debug, Default, Clone)]
pub struct State {
    /// The first client document, its far pointer; nought for none.
    pub first_doc: u32,
    /// The formats registered as the library starts, in `start::FORMATS`'
    /// order.
    pub formats: Vec<u16>,
    /// Whether the start-up's registrations are made.
    pub started: bool,
    /// `GetStockObject(DEFAULT_PALETTE)`, once asked for.
    pub default_palette: u16,
    /// The pictures being drawn: the object, whether into a metafile, its
    /// bounds, the window's bounds and the picture's window origin.
    pub playing: Vec<Playing>,
}

/// A picture being drawn, as `MFCALLBACKFUNC` plays its records.
#[derive(Debug, Default, Clone)]
pub struct Playing {
    pub object: u32,
    pub meta: bool,
    pub bounds: [i16; 4],
    pub window: [i16; 4],
    pub org: [i16; 2],
}

/// WinBox's `OLECLI` as it runs: memory, calls, its data.
pub(crate) struct Ole<'e> {
    pub e: &'e Engine,
}

impl<'e> Ole<'e> {
    pub(crate) fn new(e: &'e Engine) -> Self {
        Self { e }
    }

    /// `OLECLI`'s data segment's selector.
    pub(crate) fn ds(&self) -> u16 {
        super::data_selector(&self.e.system())
    }

    pub(crate) fn near(&self, at: u16) -> u32 {
        far(self.ds(), at)
    }

    // Guest memory.

    pub(crate) fn read(&self, at: u32, n: usize) -> Vec<u8> {
        (0..n)
            .map(|i| self.e.system().read_far(huge(at, i as u32), 1)[0])
            .collect()
    }

    pub(crate) fn write(&self, at: u32, bytes: &[u8]) {
        for (i, byte) in bytes.iter().enumerate() {
            self.e.system().write_far(huge(at, i as u32), &[*byte]);
        }
    }

    pub(crate) fn r8(&self, at: u32) -> u8 {
        self.e.system().read_far(at, 1)[0]
    }

    pub(crate) fn w8(&self, at: u32, value: u8) {
        self.e.system().write_far(at, &[value]);
    }

    pub(crate) fn r16(&self, at: u32) -> u16 {
        u16::from(self.r8(at)) | u16::from(self.r8(plus(at, 1))) << 8
    }

    pub(crate) fn w16(&self, at: u32, value: u16) {
        self.w8(at, value as u8);
        self.w8(plus(at, 1), (value >> 8) as u8);
    }

    pub(crate) fn r32(&self, at: u32) -> u32 {
        u32::from(self.r16(at)) | u32::from(self.r16(plus(at, 2))) << 16
    }

    pub(crate) fn w32(&self, at: u32, value: u32) {
        self.w16(at, value as u16);
        self.w16(plus(at, 2), (value >> 16) as u16);
    }

    /// A string at a far pointer, without its nought.
    pub(crate) fn string(&self, at: u32) -> Vec<u8> {
        let mut out = Vec::new();

        for i in 0..0xffff_u16 {
            let byte = self.r8(plus(at, i));

            if byte == 0 {
                break;
            }

            out.push(byte);
        }

        out
    }

    /// Whether `n` bytes can be read at a far pointer: the selector loads
    /// and the offsets are within its limit.
    pub(crate) fn readable(&self, at: u32, n: u16) -> bool {
        let system = self.e.system();

        sel(at) != 0
            && system.reaches(sel(at), u32::from(off(at)), false)
            && system.reaches(
                sel(at),
                u32::from(off(at).wrapping_add(n.max(1) - 1)),
                false,
            )
    }

    // Calls into KERNEL, USER and GDI.

    pub(crate) async fn call_b(&self, module: &str, name: &str, args: &[Arg]) -> R<Called> {
        api::api(self.e, module, name, args).await
    }

    pub(crate) async fn call(&self, module: &str, name: &str, args: &[Arg]) -> R<u32> {
        Ok(self.call_b(module, name, args).await?.value)
    }

    pub(crate) async fn kernel(&self, name: &str, args: &[Arg]) -> R<u32> {
        self.call("KERNEL", name, args).await
    }

    pub(crate) async fn user(&self, name: &str, args: &[Arg]) -> R<u32> {
        self.call("USER", name, args).await
    }

    pub(crate) async fn gdi(&self, name: &str, args: &[Arg]) -> R<u32> {
        self.call("GDI", name, args).await
    }

    /// A GDI call's answer as a word.
    pub(crate) async fn gdi16(&self, name: &str, args: &[Arg]) -> R<u16> {
        Ok(self.gdi(name, args).await? as u16)
    }

    pub(crate) async fn global_alloc(&self, flags: u16, size: u32) -> R<u16> {
        Ok(self
            .kernel("GlobalAlloc", &[Arg::W(flags), Arg::D(size)])
            .await? as u16)
    }

    pub(crate) async fn global_lock(&self, handle: u16) -> R<u32> {
        self.kernel("GlobalLock", &[Arg::W(handle)]).await
    }

    pub(crate) async fn global_unlock(&self, handle: u16) -> R<u16> {
        Ok(self.kernel("GlobalUnlock", &[Arg::W(handle)]).await? as u16)
    }

    pub(crate) async fn global_free(&self, handle: u16) -> R<u16> {
        Ok(self.kernel("GlobalFree", &[Arg::W(handle)]).await? as u16)
    }

    pub(crate) async fn global_size(&self, handle: u16) -> R<u32> {
        self.kernel("GlobalSize", &[Arg::W(handle)]).await
    }

    pub(crate) async fn add_atom(&self, at: u32) -> R<u16> {
        Ok(self.user("GlobalAddAtom", &[Arg::D(at)]).await? as u16)
    }

    pub(crate) async fn add_atom_text(&self, bytes: &[u8]) -> R<u16> {
        Ok(self.user("GlobalAddAtom", &[text(bytes)]).await? as u16)
    }

    pub(crate) async fn delete_atom(&self, atom: u16) -> R<u16> {
        Ok(self.user("GlobalDeleteAtom", &[Arg::W(atom)]).await? as u16)
    }

    pub(crate) async fn atom_name(&self, atom: u16, to: u32, size: u16) -> R<u16> {
        Ok(self
            .user(
                "GlobalGetAtomName",
                &[Arg::W(atom), Arg::D(to), Arg::W(size)],
            )
            .await? as u16)
    }

    pub(crate) async fn get_dc(&self) -> R<u16> {
        Ok(self.user("GetDC", &[Arg::W(0)]).await? as u16)
    }

    pub(crate) async fn release_dc(&self, dc: u16) -> R<()> {
        self.user("ReleaseDC", &[Arg::W(0), Arg::W(dc)]).await?;
        Ok(())
    }

    pub(crate) async fn device_caps(&self, dc: u16, index: u16) -> R<i16> {
        Ok(self
            .gdi("GetDeviceCaps", &[Arg::W(dc), Arg::W(index)])
            .await? as i16)
    }

    pub(crate) async fn mul_div(&self, a: i16, b: i16, c: i16) -> R<i16> {
        Ok(self
            .gdi(
                "MulDiv",
                &[Arg::W(a as u16), Arg::W(b as u16), Arg::W(c as u16)],
            )
            .await? as i16)
    }

    /// A program's procedure called far with its arguments as given, with
    /// `OLECLI`'s DS: its answer, DX:AX.
    pub(crate) async fn call_far(&self, procedure: u32, args: &[GuestArg]) -> R<u32> {
        let ds = self.ds();

        Ok(self
            .e
            .call_with(procedure, args, &[Register::Segment(DS, ds)])
            .await?
            .0)
    }

    /// `count` bytes copied between far pointers, across 64K as huge
    /// pointers go.
    pub(crate) fn copy(&self, from: u32, to: u32, count: u32) {
        let bytes = self.read(from, count as usize);

        self.write(to, &bytes);
    }

    pub(crate) fn state(&self) -> std::cell::RefMut<'_, State> {
        std::cell::RefMut::map(self.e.system(), |system| &mut system.olecli)
    }
}

/// A huge pointer `n` bytes on: 64K on is the next selector but one
/// (`__AHINCR`, 8).
pub(crate) fn huge(at: u32, n: u32) -> u32 {
    let total = u32::from(off(at)) + n;

    far(sel(at) + (total >> 16) as u16 * 8, total as u16)
}
