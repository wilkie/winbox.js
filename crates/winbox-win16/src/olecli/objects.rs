//! What every object is, whatever its kind: its block, laid out as
//! `olemem` measured it, made and let go, put in its document's list,
//! named, and its methods found through its table. As
//! `src/win16/olecli/objects.ts`.

use crate::engine::GuestArg;

use super::core::{
    DOC_FIRST, DOC_LAST, GMEM_MOVEABLE, GMEM_ZEROINIT, Kind, MM_TEXT, Method, OBJ_CLIENT, OBJ_DOC,
    OBJ_HANDLE, OBJ_MAPPING, OBJ_NAME, OBJ_NEXT, OBJ_PREVIOUS, OBJ_SIGNATURE, OBJ_SIGNATURE_LE,
    OBJ_TYPE, OBJ_UNKNOWN_FFFF, OBJ_VTBL, OLE_ERROR_ADDRESS, OLE_ERROR_HANDLE, OLE_ERROR_NAME,
    OLE_ERROR_SIZE, OLE_OK, OT_STATIC, Ole, R, off, plus, sel,
};
use super::docs::is_doc;

/// A kind's method table, laid out in `OLECLI`'s data the first time one
/// is wanted: each slot the far address of the export that is that method.
pub(crate) fn vtbl_of(ole: &Ole<'_>, kind: Kind) -> u32 {
    let at = ole.near(kind.vtbl_at());

    if ole.r32(at) == 0 {
        for (index, ordinal) in kind.table().iter().enumerate() {
            ole.w32(
                plus(at, index as u16 * 4),
                super::export_address(ole.e, *ordinal),
            );
        }
    }

    at
}

/// Which of WinBox's kinds an object is, by its table; none for one not
/// WinBox's.
pub(crate) fn kind_of(ole: &Ole<'_>, object: u32) -> Option<Kind> {
    let table = ole.r32(plus(object, OBJ_VTBL));

    if sel(table) != ole.ds() {
        return None;
    }

    Kind::ALL
        .into_iter()
        .find(|kind| kind.vtbl_at() == off(table))
}

/// Whether a pointer is an object's: its block can be read and has `LE` at
/// its signature.
pub(crate) fn is_object(ole: &Ole<'_>, object: u32) -> bool {
    object != 0
        && ole.readable(object, OBJ_SIGNATURE + 2)
        && ole.r16(plus(object, OBJ_SIGNATURE)) == OBJ_SIGNATURE_LE
}

/// An object's block made: `size` bytes, its table, signature, handle,
/// client and document, its type static, its name added as an atom. Put
/// last in its document's list. Its far pointer, or nought.
pub(crate) async fn new_object(
    ole: &Ole<'_>,
    kind: Kind,
    size: u32,
    client: u32,
    doc: u32,
    name: u32,
) -> R<u32> {
    let handle = ole
        .global_alloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size)
        .await?;

    if handle == 0 {
        return Ok(0);
    }

    let object = ole.global_lock(handle).await?;

    ole.w32(plus(object, OBJ_VTBL), vtbl_of(ole, kind));
    ole.w16(plus(object, OBJ_SIGNATURE), OBJ_SIGNATURE_LE);
    ole.w16(plus(object, OBJ_HANDLE), handle);
    ole.w32(plus(object, OBJ_CLIENT), client);
    ole.w32(plus(object, OBJ_TYPE), OT_STATIC);
    ole.w16(plus(object, OBJ_MAPPING), MM_TEXT);
    ole.w16(plus(object, OBJ_UNKNOWN_FFFF), 0xffff);

    let atom = if name == 0 {
        0
    } else {
        ole.add_atom(name).await?
    };

    ole.w16(plus(object, OBJ_NAME), atom);
    ole.w32(plus(object, OBJ_DOC), doc);
    link(ole, object, doc);
    Ok(object)
}

/// An object put last in its document's list.
fn link(ole: &Ole<'_>, object: u32, doc: u32) {
    // A presentation an embedded or linked object holds is in no document.
    if doc == 0 {
        return;
    }

    let last = ole.r32(plus(doc, DOC_LAST));

    if last == 0 {
        ole.w32(plus(doc, DOC_FIRST), object);
    } else {
        ole.w32(plus(last, OBJ_NEXT), object);
        ole.w32(plus(object, OBJ_PREVIOUS), last);
    }

    ole.w32(plus(doc, DOC_LAST), object);
}

/// An object taken out of its document's list.
fn unlink(ole: &Ole<'_>, object: u32) {
    let doc = ole.r32(plus(object, OBJ_DOC));
    let previous = ole.r32(plus(object, OBJ_PREVIOUS));
    let next = ole.r32(plus(object, OBJ_NEXT));

    if previous != 0 {
        ole.w32(plus(previous, OBJ_NEXT), next);
    } else if doc != 0 {
        ole.w32(plus(doc, DOC_FIRST), next);
    }

    if next != 0 {
        ole.w32(plus(next, OBJ_PREVIOUS), previous);
    } else if doc != 0 {
        ole.w32(plus(doc, DOC_LAST), previous);
    }
}

/// An object's block let go: out of its document, its name's atom
/// deleted, the block freed.
pub(crate) async fn free_object(ole: &Ole<'_>, object: u32) -> R<()> {
    let handle = ole.r16(plus(object, OBJ_HANDLE));

    unlink(ole, object);
    ole.delete_atom(ole.r16(plus(object, OBJ_NAME))).await?;
    ole.global_unlock(handle).await?;
    ole.global_free(handle).await?;
    Ok(())
}

/// What an argument that should be a document is: `OLE_ERROR_HANDLE` if
/// it is not one.
pub(crate) fn doc_error(ole: &Ole<'_>, doc: u32) -> u16 {
    if is_doc(ole, doc) {
        OLE_OK
    } else {
        OLE_ERROR_HANDLE
    }
}

/// Whether an object's name, given to a call that makes one, is wrong:
/// none `OLE_ERROR_ADDRESS`, empty `OLE_ERROR_NAME`.
pub(crate) fn name_error(ole: &Ole<'_>, name: u32) -> u16 {
    if name == 0 || !ole.readable(name, 1) {
        return OLE_ERROR_ADDRESS;
    }

    if ole.r8(name) == 0 {
        OLE_ERROR_NAME
    } else {
        OLE_OK
    }
}

/// Whether an out pointer can be written.
pub(crate) fn writable(ole: &Ole<'_>, at: u32, n: u16) -> bool {
    at != 0 && ole.readable(at, n)
}

// The methods every kind shares, the `OBJ` exports (910-913).

/// `OBJQUERYNAME` (910): the name's atom read into the buffer, at most the
/// count given, and the count set to the name's length; a count of nought
/// `OLE_ERROR_SIZE` (**recorded** by `olestat`).
pub(crate) async fn query_name(ole: &Ole<'_>, object: u32, buffer: u32, count: u32) -> R<u16> {
    let size = ole.r16(count);

    if size == 0 {
        return Ok(OLE_ERROR_SIZE);
    }

    let length = ole
        .atom_name(ole.r16(plus(object, OBJ_NAME)), buffer, size)
        .await?;

    ole.w16(count, length);
    Ok(OLE_OK)
}

/// `OBJRENAME` (911): an empty name `OLE_ERROR_NAME`; else the old name's
/// atom deleted and the new one's added.
pub(crate) async fn rename(ole: &Ole<'_>, object: u32, name: u32) -> R<u16> {
    if name == 0 || !ole.readable(name, 1) {
        return Ok(OLE_ERROR_ADDRESS);
    }

    if ole.r8(name) == 0 {
        return Ok(OLE_ERROR_NAME);
    }

    ole.delete_atom(ole.r16(plus(object, OBJ_NAME))).await?;

    let atom = ole.add_atom(name).await?;

    ole.w16(plus(object, OBJ_NAME), atom);
    Ok(OLE_OK)
}

/// `OBJQUERYTYPE` (912): the type, `OT_STATIC` for the static kinds.
pub(crate) fn query_type(ole: &Ole<'_>, object: u32, out: u32) -> u16 {
    ole.w32(out, ole.r32(plus(object, OBJ_TYPE)));
    OLE_OK
}

/// The method in an object's table, by its slot: its far address.
pub(crate) fn method_at(ole: &Ole<'_>, object: u32, method: Method) -> u32 {
    let table = ole.r32(plus(object, OBJ_VTBL));

    ole.r32(plus(table, method as u16 * 4))
}

/// An argument of a method's, a word or a doubleword.
#[derive(Debug, Clone, Copy)]
pub(crate) enum MethodArg {
    W(u16),
    D(u32),
}

impl MethodArg {
    pub(crate) fn value(self) -> u32 {
        match self {
            Self::W(word) => u32::from(word),
            Self::D(long) => long,
        }
    }
}

/// An object's method called through its table, as each `Ole` function
/// calls it: WinBox's own answered here, by the export the address is;
/// another's called far with the arguments as given. DX:AX.
pub(crate) async fn call_method(
    ole: &Ole<'_>,
    object: u32,
    method: Method,
    args: &[MethodArg],
) -> R<u32> {
    let address = method_at(ole, object, method);

    if let Some(ordinal) = own_ordinal(ole, address) {
        let mut values = vec![object];

        values.extend(args.iter().map(|arg| arg.value()));
        return Box::pin(super::methods::call_own_method(ole, ordinal, &values)).await;
    }

    let mut guest = vec![GuestArg::Long(object)];

    guest.extend(args.iter().map(|arg| match arg {
        MethodArg::W(word) => GuestArg::Word(*word),
        MethodArg::D(long) => GuestArg::Long(*long),
    }));
    ole.call_far(address, &guest).await
}

/// The ordinal of one of `OLECLI`'s stubs at a far address; none for
/// another.
fn own_ordinal(ole: &Ole<'_>, address: u32) -> Option<u16> {
    let first = super::export_address(ole.e, 1);
    let second = super::export_address(ole.e, 2);

    if first == 0 || sel(address) != sel(first) {
        return None;
    }

    let step = off(second).wrapping_sub(off(first));

    (step != 0).then(|| off(address).wrapping_sub(off(first)) / step + 1)
}
