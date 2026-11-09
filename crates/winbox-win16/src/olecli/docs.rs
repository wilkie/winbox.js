//! A client's documents: `OleRegisterClientDoc` and the calls on the handle
//! it gives (**recorded** by `olestat`, the block's words **measured** by
//! `olemem`). A document's handle is the far pointer to its block; the
//! blocks are kept in a list, each after the one registered before it.

use super::core::{
    DOC_CLASS, DOC_FIRST, DOC_HANDLE, DOC_LAST, DOC_NAME, DOC_NEXT, DOC_PREVIOUS, DOC_SIGNATURE,
    DOC_SIZE, GMEM_DDESHARE, GMEM_MOVEABLE, GMEM_ZEROINIT, OBJ_NEXT, OLE_ERROR_ADDRESS,
    OLE_ERROR_HANDLE, OLE_ERROR_MEMORY, OLE_ERROR_NAME, OLE_ERROR_NOT_EMPTY, OLE_OK, Ole, R, plus,
};

/// Whether a handle is a document's: its block can be read and starts
/// `CD`. A string starting `CD` passes (`olestat`).
pub(crate) fn is_doc(ole: &Ole<'_>, doc: u32) -> bool {
    doc != 0 && ole.readable(doc, 2) && ole.r16(doc) == DOC_SIGNATURE
}

/// What a string argument is: none, empty, or a name.
#[derive(PartialEq, Eq)]
pub(crate) enum Named {
    None,
    Empty,
    Name,
}

pub(crate) fn named(ole: &Ole<'_>, at: u32) -> Named {
    if at == 0 || !ole.readable(at, 1) {
        return Named::None;
    }

    if ole.r8(at) == 0 {
        Named::Empty
    } else {
        Named::Name
    }
}

/// `OleRegisterClientDoc(lpszClass, lpszDoc, reserved, lplhdoc)`: an empty
/// name `OLE_ERROR_NAME`, a NULL class, name or out pointer
/// `OLE_ERROR_ADDRESS`; else the document's name and class added as atoms,
/// its block allocated, and the block put last in the list. The same name
/// registered twice is two documents.
pub(crate) async fn register_client_doc(ole: &Ole<'_>, class: u32, name: u32, out: u32) -> R<u16> {
    let name_is = named(ole, name);

    if name_is == Named::Empty {
        return Ok(OLE_ERROR_NAME);
    }

    if name_is == Named::None
        || named(ole, class) == Named::None
        || out == 0
        || !ole.readable(out, 4)
    {
        return Ok(OLE_ERROR_ADDRESS);
    }

    let name_atom = ole.add_atom(name).await?;
    let class_atom = ole.add_atom(class).await?;
    let handle = ole
        .global_alloc(GMEM_MOVEABLE | GMEM_ZEROINIT | GMEM_DDESHARE, DOC_SIZE)
        .await?;

    if handle == 0 {
        ole.delete_atom(name_atom).await?;
        ole.delete_atom(class_atom).await?;
        return Ok(OLE_ERROR_MEMORY);
    }

    let doc = ole.global_lock(handle).await?;

    ole.w16(doc, DOC_SIGNATURE);
    ole.w16(plus(doc, DOC_CLASS), class_atom);
    ole.w16(plus(doc, DOC_NAME), name_atom);
    ole.w16(plus(doc, DOC_HANDLE), handle);

    let mut last = ole.state().first_doc;

    if last == 0 {
        ole.state().first_doc = doc;
    } else {
        while ole.r32(plus(last, DOC_NEXT)) != 0 {
            last = ole.r32(plus(last, DOC_NEXT));
        }

        ole.w32(plus(last, DOC_NEXT), doc);
        ole.w32(plus(doc, DOC_PREVIOUS), last);
    }

    ole.w32(out, doc);
    Ok(OLE_OK)
}

/// `OleRevokeClientDoc(lhdoc)`: a handle that is not a document's
/// `OLE_ERROR_HANDLE`; one with objects still in it `OLE_ERROR_NOT_EMPTY`;
/// else taken out of the list, its atoms deleted, its block freed.
pub(crate) async fn revoke_client_doc(ole: &Ole<'_>, doc: u32) -> R<u16> {
    if !is_doc(ole, doc) {
        return Ok(OLE_ERROR_HANDLE);
    }

    if ole.r32(plus(doc, DOC_FIRST)) != 0 || ole.r32(plus(doc, DOC_LAST)) != 0 {
        return Ok(OLE_ERROR_NOT_EMPTY);
    }

    let previous = ole.r32(plus(doc, DOC_PREVIOUS));
    let next = ole.r32(plus(doc, DOC_NEXT));

    if previous != 0 {
        ole.w32(plus(previous, DOC_NEXT), next);
    } else if ole.state().first_doc == doc {
        ole.state().first_doc = next;
    }

    if next != 0 {
        ole.w32(plus(next, DOC_PREVIOUS), previous);
    }

    let handle = ole.r16(plus(doc, DOC_HANDLE));

    ole.delete_atom(ole.r16(plus(doc, DOC_NAME))).await?;
    ole.delete_atom(ole.r16(plus(doc, DOC_CLASS))).await?;
    ole.global_unlock(handle).await?;
    ole.global_free(handle).await?;
    Ok(OLE_OK)
}

/// `OleRenameClientDoc(lhdoc, lpszNewName)`: the new name added as an
/// atom; the same atom as before let go once more, else the old one
/// deleted and the new kept.
pub(crate) async fn rename_client_doc(ole: &Ole<'_>, doc: u32, name: u32) -> R<u16> {
    if !is_doc(ole, doc) {
        return Ok(OLE_ERROR_HANDLE);
    }

    if named(ole, name) == Named::None {
        return Ok(OLE_ERROR_ADDRESS);
    }

    let atom = ole.add_atom(name).await?;
    let old = ole.r16(plus(doc, DOC_NAME));

    if atom == old {
        ole.delete_atom(atom).await?;
        return Ok(OLE_OK);
    }

    ole.delete_atom(old).await?;
    ole.w16(plus(doc, DOC_NAME), atom);
    Ok(OLE_OK)
}

/// `OleSavedClientDoc` and `OleRevertClientDoc`: a document's, nothing to
/// tell a static object.
pub(crate) fn saved_client_doc(ole: &Ole<'_>, doc: u32) -> u16 {
    if is_doc(ole, doc) {
        OLE_OK
    } else {
        OLE_ERROR_HANDLE
    }
}

/// `OleEnumObjects(lhdoc, lplpobj)`: the object after the one given, the
/// first for NULL, NULL after the last; `OLE_OK` each time.
pub(crate) fn enum_objects(ole: &Ole<'_>, doc: u32, out: u32) -> u16 {
    if !is_doc(ole, doc) {
        return OLE_ERROR_HANDLE;
    }

    if out == 0 || !ole.readable(out, 4) {
        return OLE_ERROR_ADDRESS;
    }

    let current = ole.r32(out);

    ole.w32(
        out,
        if current == 0 {
            ole.r32(plus(doc, DOC_FIRST))
        } else {
            ole.r32(plus(current, OBJ_NEXT))
        },
    );
    OLE_OK
}
