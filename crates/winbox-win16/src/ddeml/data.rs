//! DDEML's data handles: a handle the application holds is a far pointer
//! to six bytes of its instance's heap -- the instance, the handle's
//! flags, the global block -- and DDEML passes the last two about as one
//! value, `MAKELONG(flags, block)`. The blocks are `GMEM_DDESHARE`, with
//! DDE's header where the handle has an item. As `DDEML.DLL` seg1 has
//! them (`14e8`-`19a0`, `63c6`-`699c`). As `src/win16/ddeml/data.ts`.

use crate::commdlg::api::Arg;

use super::D_ARRAY_OWNED;
use super::core::{Cmp, Dd, R, hi, lo, long, plus};
use super::instance::{DMLERR_INVALIDPARAMETER, DMLERR_MEMORY_ERROR, instance_of};
use super::monitor::set_error;

/// `HDATA_APPOWNED`, the header's absence, handed to a callback, sent.
pub(crate) const APPOWNED: u16 = 0x0001;
pub(crate) const NO_HEADER: u16 = 0x0100;
pub(crate) const IN_CALLBACK: u16 = 0x4000;
pub(crate) const SENT: u16 = 0x8000;

/// A value laid out below the stack, for the arrays' keys and items.
fn key(d: &Dd<'_>, value: u32) -> (u32, u16) {
    d.key(&value.to_le_bytes())
}

/// `63c6`: a block made for data -- DDE's header first where there is an
/// item, `fRelease` for DDEML's, `fAckReq` for the application's -- the
/// data copied in, and kept in the instance's handles (and DDEML's list
/// of the application's blocks): the value, nought where no memory.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn make(
    d: &Dd<'_>,
    instance: u16,
    flags: u16,
    format: u16,
    item: u16,
    offset: u32,
    size: u32,
    source: u32,
) -> R<u32> {
    let mut flags = flags;
    let mut offset = offset;

    if item != 0 {
        offset = offset.wrapping_add(4);
    } else {
        flags |= NO_HEADER;
    }

    let status = if flags & APPOWNED == 0 {
        0x2000
    } else {
        0x8000
    };
    let block = d.share(offset.wrapping_add(size), status, format).await?;

    if block == 0 {
        set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        return Ok(0);
    }

    let value = long(flags, block);
    let (record, saved) = key(d, value);
    let added = d
        .array_add(d.i32(instance, 0xc), record, Some(Cmp::Second))
        .await?;

    d.release(saved);

    let kept = added != 0
        && (flags & APPOWNED == 0 || {
            let owned = [
                block.to_le_bytes(),
                d.i16(instance, 0x1e).to_le_bytes(),
                1u16.to_le_bytes(),
                flags.to_le_bytes(),
            ]
            .concat();
            let (record, saved) = d.key(&owned);
            let added = d
                .array_add(d.i32(0, D_ARRAY_OWNED), record, Some(Cmp::First))
                .await?;

            d.release(saved);
            added != 0
        });

    if !kept {
        d.global_free(block).await?;
        set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        return Ok(0);
    }

    if source != 0 {
        let at = d.global_lock(block).await?;
        let to = Dd::huge(at, offset);

        d.copy(source, to, size);
    }

    Ok(value)
}

/// `64c4`: a value let go: the application's block counted down in
/// DDEML's list -- not at all by its own task, with `own` -- and freed,
/// its objects first, where it has `fRelease` or the application's count
/// came to nought.
pub(crate) async fn free_value(d: &Dd<'_>, instance: u16, value: u32, own: bool) -> R<()> {
    let flags = lo(value);
    let block = hi(value);
    let mut free = false;

    if flags & APPOWNED != 0 {
        let (k, saved) = d.key(&block.to_le_bytes());
        let owned = d
            .array_find(d.i32(0, D_ARRAY_OWNED), Some(Cmp::First), k, false)
            .await?;

        if owned != 0 {
            if own && d.r16(plus(owned, 2)) == d.i16(instance, 0x1e) {
                d.release(saved);
                return Ok(());
            }

            let count = d.r16(plus(owned, 4)).wrapping_sub(1);

            d.w16(plus(owned, 4), count);

            if count != 0 {
                d.release(saved);
                return Ok(());
            }

            d.array_find(d.i32(0, D_ARRAY_OWNED), Some(Cmp::First), k, true)
                .await?;
            free = true;
        }

        d.release(saved);
    }

    if block == 0 {
        return Ok(());
    }

    let (k, saved) = key(d, value);
    let found = d
        .array_find(d.i32(instance, 0xc), Some(Cmp::Second), k, true)
        .await?;

    d.release(saved);

    if found == 0 {
        return Ok(());
    }

    let mut format = 0;

    if flags & NO_HEADER != 0 {
        free |= flags & APPOWNED == 0;
    } else {
        let at = d.global_lock(block).await?;

        free |= d.r8(plus(at, 1)) & 0x20 != 0;
        format = d.r16(plus(at, 2));
        d.global_unlock(block).await?;
    }

    if !free {
        return Ok(());
    }

    if flags & NO_HEADER != 0 {
        d.global_free(block).await?;
        return Ok(());
    }

    free_block(d, block, format).await
}

/// `65b8`: a value made ready to post: copied where the partner is not
/// DDEML's and the block is the application's, or it was handed to a
/// callback; marked sent and kept in the instance's handles.
pub(crate) async fn prepare(d: &Dd<'_>, conv: u32, value: u32) -> R<u32> {
    let flags = lo(value);
    let local = d.r8(plus(conv, 0x20)) & 4 != 0;
    let mut value = value;

    if (!local && flags & APPOWNED != 0) || (flags & IN_CALLBACK != 0 && flags & APPOWNED == 0) {
        value = copy_value(d, d.r16(conv), hi(value), flags).await?;
    }

    value |= u32::from(SENT);

    let instance = d.r16(conv);
    let (k, saved) = key(d, value);

    d.array_add(d.i32(instance, 0xc), k, Some(Cmp::Second))
        .await?;
    d.release(saved);
    Ok(value)
}

/// `6610`: a value given away out of the instance's handles, but the
/// application's.
pub(crate) async fn give_away(d: &Dd<'_>, instance: u16, value: u32) -> R<()> {
    if lo(value) & APPOWNED == 0 {
        let (k, saved) = key(d, value);

        d.array_find(d.i32(instance, 0xc), Some(Cmp::Second), k, true)
            .await?;
        d.release(saved);
    }

    Ok(())
}

/// `6636`: a block received made a value: the application's flags where
/// DDEML knows it as theirs, treated as the application's where it has no
/// `fRelease`, read-only, and kept in the instance's handles.
pub(crate) async fn wrap(d: &Dd<'_>, instance: u16, block: u16, flags: u16) -> R<u32> {
    if block == 0 {
        return Ok(0);
    }

    let mut flags = flags;
    let (k, saved) = d.key(&block.to_le_bytes());
    let owned = d
        .array_find(d.i32(0, D_ARRAY_OWNED), Some(Cmp::First), k, false)
        .await?;

    d.release(saved);

    if owned != 0 {
        flags |= d.r16(plus(owned, 6));
        d.w16(plus(owned, 4), d.r16(plus(owned, 4)).wrapping_add(1));
    }

    let at = d.global_lock(block).await?;

    if d.r8(plus(at, 1)) & 0x20 == 0 {
        flags |= APPOWNED;
    }

    d.global_unlock(block).await?;

    let value = long(flags | SENT, block);
    let (k, saved) = key(d, value);

    d.array_add(d.i32(instance, 0xc), k, Some(Cmp::Second))
        .await?;
    d.release(saved);
    Ok(value)
}

/// `66c2`: a block copied into a new one of `GMEM_DDESHARE`.
async fn copy_block(d: &Dd<'_>, block: u16) -> R<u16> {
    let size = d.global_size(block).await?;
    let from = d.global_lock(block).await?;

    if from == 0 {
        return Ok(0);
    }

    let copy = d.global_alloc(0x2000, size).await?;
    let to = d.global_lock(copy).await?;

    d.copy(from, to, size);
    d.global_unlock(copy).await?;
    Ok(copy)
}

/// `671e`: a bitmap copied, through two memory contexts compatible with
/// the instance's window's.
async fn copy_bitmap(d: &Dd<'_>, bitmap: u16, instance: u16) -> R<u16> {
    let called = d
        .call_b(
            "GDI",
            "GetObject",
            &[
                Arg::W(bitmap),
                Arg::W(0xe),
                crate::commdlg::api::buffer(0xe),
            ],
        )
        .await?;

    if called.word() == 0 {
        return Ok(0);
    }

    let object = &called.buffers[0];
    let width = u16::from_le_bytes([object[2], object[3]]);
    let height = u16::from_le_bytes([object[4], object[5]]);
    let window = d.i16(instance, 0x22);
    let dc = d.user("GetDC", &[Arg::W(window)]).await? as u16;

    if dc == 0 {
        return Ok(0);
    }

    let mut made = 0u16;
    let from = d.call("GDI", "CreateCompatibleDC", &[Arg::W(dc)]).await? as u16;

    if from != 0 {
        let to = d.call("GDI", "CreateCompatibleDC", &[Arg::W(dc)]).await? as u16;

        if to != 0 {
            let old_from = d
                .call("GDI", "SelectObject", &[Arg::W(from), Arg::W(bitmap)])
                .await? as u16;

            made = d
                .call(
                    "GDI",
                    "CreateCompatibleBitmap",
                    &[Arg::W(from), Arg::W(width), Arg::W(height)],
                )
                .await? as u16;

            if made != 0 {
                let old_to = d
                    .call("GDI", "SelectObject", &[Arg::W(to), Arg::W(made)])
                    .await? as u16;

                d.call(
                    "GDI",
                    "BitBlt",
                    &[
                        Arg::W(to),
                        Arg::W(0),
                        Arg::W(0),
                        Arg::W(width),
                        Arg::W(height),
                        Arg::W(from),
                        Arg::W(0),
                        Arg::W(0),
                        Arg::D(0x00cc_0020),
                    ],
                )
                .await?;
                d.call("GDI", "SelectObject", &[Arg::W(from), Arg::W(old_from)])
                    .await?;
                d.call("GDI", "SelectObject", &[Arg::W(to), Arg::W(old_to)])
                    .await?;
            }

            d.call("GDI", "DeleteDC", &[Arg::W(to)]).await?;
        }

        d.call("GDI", "DeleteDC", &[Arg::W(from)]).await?;
    }

    d.user("ReleaseDC", &[Arg::W(window), Arg::W(dc)]).await?;
    Ok(made)
}

/// `67fc`: a value's block copied, `fRelease` set in the copy's header and
/// the objects of a bitmap, a metafile picture or a DIB copied with it;
/// the copy DDEML's own, kept in the instance's handles.
pub(crate) async fn copy_value(d: &Dd<'_>, instance: u16, block: u16, flags: u16) -> R<u32> {
    if block == 0 {
        return Ok(long(flags, block));
    }

    let copy = copy_block(d, block).await?;

    if copy == 0 {
        return Ok(0);
    }

    if flags & NO_HEADER == 0 {
        let at = d.global_lock(copy).await?;

        if at != 0 {
            d.w8(plus(at, 1), d.r8(plus(at, 1)) | 0x20);

            match d.r16(plus(at, 2)) {
                2 | 0x82 => {
                    let bitmap = copy_bitmap(d, d.r16(plus(at, 4)), instance).await?;

                    d.w16(plus(at, 4), bitmap);
                }
                3 | 0x83 => {
                    let picture = copy_block(d, d.r16(plus(at, 4))).await?;

                    d.w16(plus(at, 4), picture);

                    if picture != 0 {
                        let inner = d.global_lock(picture).await?;

                        if inner != 0 {
                            let metafile = d
                                .call(
                                    "GDI",
                                    "CopyMetaFile",
                                    &[Arg::W(d.r16(plus(inner, 6))), Arg::D(0)],
                                )
                                .await? as u16;

                            d.w16(plus(inner, 6), metafile);
                            d.global_unlock(picture).await?;
                        }

                        d.global_unlock(picture).await?;
                    }
                }
                8 => {
                    let dib = copy_block(d, d.r16(plus(at, 4))).await?;

                    d.w16(plus(at, 4), dib);
                }
                _ => {}
            }

            d.global_unlock(copy).await?;
        }
    }

    let value = long(flags & 0xbffe, copy);
    let (k, saved) = key(d, value);

    d.array_add(d.i32(instance, 0xc), k, None).await?;
    d.release(saved);
    Ok(value)
}

/// `691a`: a block freed, the object of a bitmap, a DIB or a metafile
/// picture it holds deleted first.
pub(crate) async fn free_block(d: &Dd<'_>, block: u16, format: u16) -> R<()> {
    let at = d.global_lock(block).await?;

    if at == 0 {
        return Ok(());
    }

    match format {
        2 | 8 | 0x82 => {
            d.call("GDI", "DeleteObject", &[Arg::W(d.r16(plus(at, 4)))])
                .await?;
        }
        3 | 0x83 => {
            let picture = d.r16(plus(at, 4));
            let inner = d.global_lock(picture).await?;

            if inner != 0 {
                d.call("GDI", "DeleteObject", &[Arg::W(d.r16(plus(inner, 6)))])
                    .await?;
            }

            d.global_unlock(picture).await?;
            d.global_free(picture).await?;
        }
        _ => {}
    }

    d.global_free(block).await?;
    Ok(())
}

/// The record of a handle the application holds, and its instance.
fn record_of(d: &Dd<'_>, handle: u32) -> (u16, u32) {
    (d.r16(handle), d.r32(plus(handle, 2)))
}

/// `DdeCreateDataHandle` (`14e8`).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_data_handle(
    d: &Dd<'_>,
    id: u32,
    source: u32,
    size: u32,
    offset: u32,
    item: u32,
    format: u16,
    flags: u16,
) -> R<u32> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if flags & 0xfffe != 0 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let value = make(d, instance, flags, format, lo(item), offset, size, source).await?;

    if value == 0 {
        return Ok(0);
    }

    let record = d.alloc(d.i16(instance, 0x20), 6).await?;

    if record != 0 {
        d.w16(record, instance);
        d.w32(plus(record, 2), value);
    }

    Ok(record)
}

/// `DdeAddData` (`1598`).
pub(crate) async fn add_data(
    d: &Dd<'_>,
    handle: u32,
    source: u32,
    size: u32,
    offset: u32,
) -> R<u32> {
    let (instance, mut value) = record_of(d, handle);

    d.si16(instance, 0x2a, 0);

    let bad = 'check: {
        if hi(value) == 0 || lo(value) & SENT != 0 {
            break 'check true;
        }

        let (k, saved) = key(d, value);
        let found = d
            .array_find(d.i32(instance, 0xc), Some(Cmp::Second), k, false)
            .await?;

        d.release(saved);
        found == 0 || d.r8(plus(found, 1)) & 0x80 != 0
    };

    if bad {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let mut offset = offset;

    if lo(value) & NO_HEADER == 0 {
        offset = offset.wrapping_add(4);
    }

    let block = hi(value);
    let current = d.global_size(block).await?;
    let needed = offset.wrapping_add(size);

    if needed > current {
        let mut grown = d
            .kernel("GlobalReAlloc", &[Arg::W(block), Arg::D(needed), Arg::W(2)])
            .await? as u16;

        if grown == 0 {
            grown = d.global_alloc(0x2002, needed).await?;

            if grown == 0 {
                set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
                return Ok(0);
            }

            let from = d.global_lock(block).await?;
            let to = d.global_lock(grown).await?;
            let size = d.global_size(block).await?;

            d.copy(from, to, size);
            d.global_free(block).await?;
        }

        if grown != block {
            let (k, saved) = key(d, value);
            let found = d
                .array_find(d.i32(instance, 0xc), Some(Cmp::Second), k, true)
                .await?;

            d.release(saved);

            if found != 0 {
                let (k, saved) = d.key(&block.to_le_bytes());
                let owned = d
                    .array_find(d.i32(0, D_ARRAY_OWNED), Some(Cmp::First), k, false)
                    .await?;
                let mut stored_flags = 0u16;

                if owned != 0 {
                    stored_flags = d.r16(plus(owned, 6));

                    let record = [
                        grown.to_le_bytes(),
                        d.r16(plus(owned, 2)).to_le_bytes(),
                        d.r16(plus(owned, 4)).to_le_bytes(),
                        stored_flags.to_le_bytes(),
                    ]
                    .concat();

                    d.array_find(d.i32(0, D_ARRAY_OWNED), Some(Cmp::First), k, true)
                        .await?;

                    let (r, saved) = d.key(&record);

                    d.array_add(d.i32(0, D_ARRAY_OWNED), r, None).await?;
                    d.release(saved);
                }

                d.release(saved);

                let (r, saved) = key(d, long(stored_flags, grown));

                d.array_add(d.i32(instance, 0xc), r, Some(Cmp::Second))
                    .await?;
                d.release(saved);
            }

            value = long(lo(value), grown);
        }
    }

    if source != 0 {
        let at = d.global_lock(hi(value)).await?;
        let to = Dd::huge(at, offset);

        d.copy(source, to, size);
    }

    d.w32(plus(handle, 2), value);
    Ok(handle)
}

/// `DdeGetData` (`17a8`).
pub(crate) async fn get_data(d: &Dd<'_>, handle: u32, out: u32, most: u32, offset: u32) -> R<u32> {
    let (instance, value) = record_of(d, handle);

    d.si16(instance, 0x2a, 0);

    let size = d.global_size(hi(value)).await?;
    let mut offset = offset;
    let header = lo(value) & NO_HEADER == 0;

    if header {
        offset = offset.wrapping_add(4);
    }

    if offset >= size {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let count = (size - offset).min(most);

    if out == 0 {
        return Ok(if header { size.wrapping_sub(4) } else { size });
    }

    let at = d.global_lock(hi(value)).await?;
    let from = Dd::huge(at, offset);

    d.copy(from, out, count);
    Ok(count)
}

/// `DdeAccessData` (`188a`).
pub(crate) async fn access_data(d: &Dd<'_>, handle: u32, size: u32) -> R<u32> {
    let (instance, value) = record_of(d, handle);

    d.si16(instance, 0x2a, 0);

    if hi(value) == 0 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let skip = if lo(value) & NO_HEADER != 0 { 0 } else { 4 };

    if size != 0 {
        let whole = d.global_size(hi(value)).await?;

        d.w32(size, whole.wrapping_sub(skip));
    }

    let at = d.global_lock(hi(value)).await?;

    Ok(plus(at, skip as u16))
}

/// `DdeUnaccessData` (`1916`).
pub(crate) async fn unaccess_data(d: &Dd<'_>, handle: u32) -> R<u16> {
    let (instance, _) = record_of(d, handle);

    d.si16(instance, 0x2a, 0);
    d.global_unlock(d.r16(plus(handle, 4))).await?;
    Ok(1)
}

/// `DdeFreeDataHandle` (`1946`): a handle handed to a callback is left.
pub(crate) async fn free_data_handle(d: &Dd<'_>, handle: u32) -> R<u16> {
    if handle == 0 {
        return Ok(1);
    }

    let instance = d.r16(handle);

    d.si16(instance, 0x2a, 0);

    if d.r8(plus(handle, 3)) & 0x40 == 0 {
        free_value(d, d.r16(handle), d.r32(plus(handle, 2)), false).await?;
        d.free(handle).await?;
    }

    Ok(1)
}
