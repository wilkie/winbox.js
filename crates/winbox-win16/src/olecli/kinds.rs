//! The static kinds -- a picture, a bitmap, a DIB -- and an object of
//! another class read from a stream: how each is made from the clipboard
//! or a stream, and its own methods, the 300s, 400s, 500s and 600s of
//! `OLECLI`'s exports. Their calls into GDI, USER and KERNEL are the ones
//! `OLECLI.DLL` makes, each seen with its arguments as WinBox ran the file
//! (the probes' runs); their answers **recorded** by `olestat` and
//! **measured** by `olemem`. As `src/win16/olecli/kinds.ts`.

use crate::commdlg::api::{Arg, buffer};

use super::core::{
    BM_BITMAP, BM_HEIGHT, BM_SIZE, BM_WIDTH, CF_BITMAP, CF_DIB, CF_METAFILEPICT, DIB_DATA,
    DIB_SIZE, FORMAT_NAME, FORMAT_NAME_SIZE, GEN_CLASS, GEN_DATA, GEN_FORMAT, GEN_SIZE,
    GMEM_MOVEABLE, Kind, LOGPIXELSX, LOGPIXELSY, MF_BLOCK, MF_METAFILE, MF_MM, MF_PICTURE, MF_SIZE,
    MF_XEXT, MF_YEXT, MM_ANISOTROPIC, OBJ_HEIGHT, OBJ_MAPPING, OBJ_WIDTH, OLE_ERROR_FORMAT,
    OLE_ERROR_GENERIC, OLE_ERROR_MEMORY, OLE_ERROR_NOT_EQUAL, OLE_ERROR_STREAM, OLE_OK, OT_STATIC,
    Ole, R, SCRATCH, SMALL_BLOCK, STREAM_VERSION, huge, plus,
};
use super::objects::{free_object, new_object};
use super::streams::{get, get_long, put, put_bytes, put_long, put_name};

/// Each static kind's class, as a stream names it.
pub(crate) fn class_of(kind: Kind) -> &'static [u8] {
    match kind {
        Kind::Mf => b"METAFILEPICT",
        Kind::Bm => b"BITMAP",
        Kind::Dib => b"DIB",
        Kind::Gen => b"",
    }
}

/// Each static kind's clipboard format.
pub(crate) const fn format_of_kind(kind: Kind) -> u16 {
    match kind {
        Kind::Mf => CF_METAFILEPICT,
        Kind::Bm => CF_BITMAP,
        Kind::Dib | Kind::Gen => CF_DIB,
    }
}

/// Each kind's block's size.
pub(crate) const fn block_of(kind: Kind) -> u32 {
    match kind {
        Kind::Mf => MF_BLOCK,
        _ => SMALL_BLOCK,
    }
}

/// A number kept as the bounds are: a word, sign-extended to a doubleword.
const fn long(value: i32) -> u32 {
    value as i16 as i32 as u32
}

/// The bounds kept: width, and height made negative.
fn set_bounds(ole: &Ole<'_>, object: u32, width: i32, height: i32) {
    ole.w32(plus(object, OBJ_WIDTH), long(width));
    ole.w32(plus(object, OBJ_HEIGHT), long(height));
}

// A picture.

/// A picture's own made from a `METAFILEPICT`'s fields: its metafile, its
/// size its bits' block's and the `METAFILEPICT`'s eight bytes, its bounds
/// the extents when the width is more than nought, else nought
/// (**measured** by `olemem`'s `mode` records). Only `MM_ANISOTROPIC` is
/// taken: any other mode is `OLE_ERROR_MEMORY`, the copy deleted.
async fn set_picture(
    ole: &Ole<'_>,
    object: u32,
    mm: u16,
    x_ext: u16,
    y_ext: u16,
    metafile: u16,
) -> R<u16> {
    if mm != MM_ANISOTROPIC {
        ole.gdi("DeleteMetafile", &[Arg::W(metafile)]).await?;
        return Ok(OLE_ERROR_MEMORY);
    }

    let bits = ole.gdi16("GetMetafileBits", &[Arg::W(metafile)]).await?;
    let size = ole.global_size(bits).await?;
    let again = ole.gdi16("SetMetafileBits", &[Arg::W(bits)]).await?;

    ole.w32(plus(object, MF_SIZE), size + 8);
    ole.w16(plus(object, MF_MM), mm);
    ole.w16(plus(object, MF_XEXT), x_ext);
    ole.w16(plus(object, MF_YEXT), y_ext);
    ole.w16(plus(object, MF_METAFILE), again);
    ole.w16(plus(object, OBJ_MAPPING), mm);

    let x = i32::from(x_ext as i16);

    if x > 0 {
        set_bounds(ole, object, x, -i32::from(y_ext as i16));
    } else {
        set_bounds(ole, object, 0, 0);
    }

    Ok(OLE_OK)
}

async fn picture_from(ole: &Ole<'_>, object: u32, handle: u16) -> R<u16> {
    let at = ole.global_lock(handle).await?;
    let mm = ole.r16(at);
    let x_ext = ole.r16(plus(at, 2));
    let y_ext = ole.r16(plus(at, 4));
    let metafile = ole.r16(plus(at, 6));

    ole.global_unlock(handle).await?;

    let copy = ole
        .gdi16("CopyMetafile", &[Arg::W(metafile), Arg::D(0)])
        .await?;

    set_picture(ole, object, mm, x_ext, y_ext, copy).await
}

// A bitmap.

/// A bitmap's `BITMAP`, by `GetObject`: its fourteen bytes.
async fn bitmap_info(ole: &Ole<'_>, bitmap: u16) -> R<Vec<u8>> {
    let called = ole
        .call_b(
            "GDI",
            "GetObject",
            &[Arg::W(bitmap), Arg::W(14), buffer(14)],
        )
        .await?;

    Ok(called.buffers.into_iter().next().unwrap_or_default())
}

fn word(bytes: &[u8], at: usize) -> u16 {
    u16::from(bytes.get(at).copied().unwrap_or(0))
        | u16::from(bytes.get(at + 1).copied().unwrap_or(0)) << 8
}

/// A bitmap's bits' size, as `OLECLI` counts it: bytes to a row, rows,
/// planes and bits to a pixel.
fn bits_size(info: &[u8]) -> u32 {
    u32::from(word(info, 6))
        * u32::from(word(info, 4))
        * u32::from(info.get(8).copied().unwrap_or(0))
        * u32::from(info.get(9).copied().unwrap_or(0))
}

/// A bitmap copied, as `OLECLI` copies one: its bits through a block into
/// a bitmap `CreateBitmap` made of its shape.
async fn copy_bitmap(ole: &Ole<'_>, bitmap: u16) -> R<(u16, Vec<u8>)> {
    let info = bitmap_info(ole, bitmap).await?;
    let size = bits_size(&info);
    let block = ole.global_alloc(GMEM_MOVEABLE, size).await?;
    let bits = ole.global_lock(block).await?;

    ole.gdi(
        "GetBitmapBits",
        &[Arg::W(bitmap), Arg::D(size), Arg::D(bits)],
    )
    .await?;

    let copy = ole
        .gdi16(
            "CreateBitmap",
            &[
                Arg::W(word(&info, 2)),
                Arg::W(word(&info, 4)),
                Arg::W(u16::from(info[8])),
                Arg::W(u16::from(info[9])),
                Arg::D(0),
            ],
        )
        .await?;

    ole.gdi("SetBitmapBits", &[Arg::W(copy), Arg::D(size), Arg::D(bits)])
        .await?;
    ole.global_unlock(block).await?;
    ole.global_free(block).await?;
    Ok((copy, info))
}

/// A bitmap's own kept: its copy, its size (the `BITMAP` and the bits),
/// and its bounds -- its dimension's, ten to a unit, where the bitmap it
/// came from has one, else its pixels at the screen's resolution in
/// `MM_HIMETRIC` (**measured** by `olemem`'s `bounds`).
async fn set_bitmap(ole: &Ole<'_>, object: u32, from: u16, copy: u16, info: &[u8]) -> R<()> {
    ole.w32(plus(object, BM_SIZE), 14 + bits_size(info));
    ole.w16(plus(object, BM_WIDTH), word(info, 2));
    ole.w16(plus(object, BM_HEIGHT), word(info, 4));
    ole.w16(plus(object, BM_BITMAP), copy);

    let dimension = ole.gdi("GetBitmapDimension", &[Arg::W(from)]).await?;

    if dimension != 0 {
        set_bounds(
            ole,
            object,
            i32::from(dimension as i16) * 10,
            -i32::from((dimension >> 16) as i16) * 10,
        );
        return Ok(());
    }

    let dc = ole.get_dc().await?;
    let px = ole.device_caps(dc, LOGPIXELSX).await?;
    let width = ole.mul_div(word(info, 2) as i16, 2540, px).await?;
    let py = ole.device_caps(dc, LOGPIXELSY).await?;
    let height = ole.mul_div(word(info, 4) as i16, 2540, py).await?;

    ole.release_dc(dc).await?;
    set_bounds(ole, object, i32::from(width), -i32::from(height));
    Ok(())
}

async fn bitmap_from(ole: &Ole<'_>, object: u32, bitmap: u16) -> R<u16> {
    let (copy, info) = copy_bitmap(ole, bitmap).await?;

    set_bitmap(ole, object, bitmap, copy, &info).await?;
    Ok(OLE_OK)
}

// A DIB.

/// A global block copied: a block `GMEM_MOVEABLE` its size, the bytes.
async fn copy_block(ole: &Ole<'_>, handle: u16) -> R<u16> {
    let from = ole.global_lock(handle).await?;
    let size = ole.global_size(handle).await?;
    let copy = ole.global_alloc(GMEM_MOVEABLE, size).await?;

    if copy == 0 {
        ole.global_unlock(handle).await?;
    } else {
        let to = ole.global_lock(copy).await?;

        ole.copy(from, to, size);
        ole.global_unlock(handle).await?;
        ole.global_unlock(copy).await?;
    }

    Ok(copy)
}

/// A DIB's bounds from its header: its pels to a metre, the screen's
/// resolution's where nought (and written so into the header), its width
/// and height in hundredths of a millimetre, as words (**measured** by
/// `olemem`'s `bounds`: 2000, nought, -5).
async fn dib_bounds(ole: &Ole<'_>, object: u32, data: u16) -> R<()> {
    let header = ole.global_lock(data).await?;
    let width = ole.r32(plus(header, 4)) as i32;
    let height = ole.r32(plus(header, 8)) as i32;
    let mut x = ole.r32(plus(header, 24)) as i32;
    let mut y = ole.r32(plus(header, 28)) as i32;

    if x == 0 || y == 0 {
        let dc = ole.get_dc().await?;

        if x == 0 {
            let caps = ole.device_caps(dc, LOGPIXELSX).await?;

            x = i32::from(ole.mul_div(caps, 10000, 254).await?);
            ole.w32(plus(header, 24), x as u32);
        }

        if y == 0 {
            let caps = ole.device_caps(dc, LOGPIXELSY).await?;

            y = i32::from(ole.mul_div(caps, 10000, 254).await?);
            ole.w32(plus(header, 28), y as u32);
        }

        ole.release_dc(dc).await?;
    }

    ole.global_unlock(data).await?;

    let across = if x == 0 {
        0
    } else {
        (i64::from(width) * 100_000 / i64::from(x)) as i32
    };
    let down = if y == 0 {
        0
    } else {
        (i64::from(height) * 100_000 / i64::from(y)) as i32
    };

    set_bounds(ole, object, across, down.wrapping_neg());
    Ok(())
}

async fn dib_from(ole: &Ole<'_>, object: u32, handle: u16) -> R<u16> {
    let copy = copy_block(ole, handle).await?;

    if copy == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    let size = ole.global_size(copy).await?;

    ole.w32(plus(object, DIB_SIZE), size);
    ole.w16(plus(object, DIB_DATA), copy);
    dib_bounds(ole, object, copy).await?;
    Ok(OLE_OK)
}

/// An object's data made from a handle of its kind's format.
async fn data_from(ole: &Ole<'_>, kind: Kind, object: u32, handle: u16) -> R<u16> {
    match kind {
        Kind::Mf => picture_from(ole, object, handle).await,
        Kind::Bm => bitmap_from(ole, object, handle).await,
        _ => dib_from(ole, object, handle).await,
    }
}

// Making one.

/// A static object made from what is on the clipboard in a format: its
/// block, then its own copy of the data. Its pointer written to `out`, or
/// the error.
pub(crate) async fn static_from_clipboard(
    ole: &Ole<'_>,
    kind: Kind,
    handle: u16,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let object = new_object(ole, kind, block_of(kind), client, doc, name).await?;

    if object == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    let made = data_from(ole, kind, object, handle).await?;

    if made != OLE_OK {
        free_object(ole, object).await?;
        return Ok(made);
    }

    ole.w32(out, object);
    Ok(OLE_OK)
}

// The methods: release, get data, enumerate formats, bounds, size.

/// `MFRELEASE`, `BMRELEASE`, `DIBRELEASE`, `GENRELEASE` (300, 400, 500,
/// 600), and `Delete`: its data let go, then its block.
pub(crate) async fn release(ole: &Ole<'_>, kind: Kind, object: u32) -> R<u16> {
    match kind {
        Kind::Mf => {
            ole.gdi(
                "DeleteMetafile",
                &[Arg::W(ole.r16(plus(object, MF_METAFILE)))],
            )
            .await?;

            let picture = ole.r16(plus(object, MF_PICTURE));

            if picture != 0 {
                ole.global_free(picture).await?;
            }
        }
        Kind::Bm => {
            ole.gdi("DeleteObject", &[Arg::W(ole.r16(plus(object, BM_BITMAP)))])
                .await?;
        }
        Kind::Dib => {
            ole.global_free(ole.r16(plus(object, DIB_DATA))).await?;
        }
        Kind::Gen => {
            let data = ole.r16(plus(object, GEN_DATA));

            if data != 0 {
                ole.global_free(data).await?;
            }

            ole.delete_atom(ole.r16(plus(object, GEN_CLASS))).await?;
        }
    }

    free_object(ole, object).await?;
    Ok(OLE_OK)
}

/// A kind's format: its clipboard format, or the format another class's
/// stream gave.
pub(crate) fn format_of(ole: &Ole<'_>, kind: Kind, object: u32) -> u16 {
    if kind == Kind::Gen {
        ole.r16(plus(object, GEN_FORMAT))
    } else {
        format_of_kind(kind)
    }
}

/// `...ENUMFORMAT` (309, 409, 509, 610): its one format after nought,
/// nought after it.
pub(crate) fn enum_format(ole: &Ole<'_>, kind: Kind, object: u32, format: u16) -> u16 {
    if format == 0 {
        format_of(ole, kind, object)
    } else {
        0
    }
}

/// `...GETDATA` (301, 401, 501, 601): in its format, its data's handle --
/// for a picture a `METAFILEPICT` made the first time it is asked for and
/// kept -- else `OLE_ERROR_FORMAT`.
pub(crate) async fn get_data(
    ole: &Ole<'_>,
    kind: Kind,
    object: u32,
    format: u16,
    out: u32,
) -> R<u16> {
    if format != format_of(ole, kind, object) {
        return Ok(OLE_ERROR_FORMAT);
    }

    let handle = match kind {
        Kind::Mf => {
            let mut handle = ole.r16(plus(object, MF_PICTURE));

            if handle == 0 {
                handle = ole.global_alloc(GMEM_MOVEABLE, 8).await?;

                let at = ole.global_lock(handle).await?;

                ole.w16(at, ole.r16(plus(object, MF_MM)));
                ole.w16(plus(at, 2), ole.r16(plus(object, MF_XEXT)));
                ole.w16(plus(at, 4), ole.r16(plus(object, MF_YEXT)));
                ole.w16(plus(at, 6), ole.r16(plus(object, MF_METAFILE)));
                ole.global_unlock(handle).await?;
                ole.w16(plus(object, MF_PICTURE), handle);
            }

            handle
        }
        Kind::Bm => ole.r16(plus(object, BM_BITMAP)),
        Kind::Dib => ole.r16(plus(object, DIB_DATA)),
        Kind::Gen => ole.r16(plus(object, GEN_DATA)),
    };

    ole.w16(out, handle);
    Ok(OLE_OK)
}

/// `...CHANGEDATA` (310, 410, 510, 611): an object's data made again from
/// a handle of its format, as from the clipboard, the old let go, and the
/// handle let go too where the caller says so; no handle
/// `OLE_ERROR_MEMORY` (**measured** by `olemem`'s `other` records, NULL
/// given). The rest follows the OLE 1.0 reference's object handlers'
/// `ChangeData`.
pub(crate) async fn change_data(
    ole: &Ole<'_>,
    kind: Kind,
    object: u32,
    handle: u16,
    release_it: u16,
) -> R<u16> {
    // A picture's `METAFILEPICT` locked first: none to lock, the error.
    if kind == Kind::Mf {
        if ole.global_lock(handle).await? == 0 {
            return Ok(OLE_ERROR_MEMORY);
        }

        ole.global_unlock(handle).await?;
    }

    if handle == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    if kind == Kind::Gen {
        return gen_set_data(ole, object, ole.r16(plus(object, GEN_FORMAT)), handle).await;
    }

    match kind {
        Kind::Mf => {
            ole.gdi(
                "DeleteMetafile",
                &[Arg::W(ole.r16(plus(object, MF_METAFILE)))],
            )
            .await?;

            let picture = ole.r16(plus(object, MF_PICTURE));

            if picture != 0 {
                ole.global_free(picture).await?;
                ole.w16(plus(object, MF_PICTURE), 0);
            }
        }
        Kind::Bm => {
            ole.gdi("DeleteObject", &[Arg::W(ole.r16(plus(object, BM_BITMAP)))])
                .await?;
        }
        _ => {
            ole.global_free(ole.r16(plus(object, DIB_DATA))).await?;
        }
    }

    let answer = data_from(ole, kind, object, handle).await?;

    if release_it != 0 {
        if kind == Kind::Bm {
            ole.gdi("DeleteObject", &[Arg::W(handle)]).await?;
        } else {
            ole.global_free(handle).await?;
        }
    }

    Ok(answer)
}

/// `GENSETDATA` (602): another class's data replaced, in its format;
/// another `OLE_ERROR_FORMAT`.
pub(crate) async fn gen_set_data(ole: &Ole<'_>, object: u32, format: u16, handle: u16) -> R<u16> {
    if format != ole.r16(plus(object, GEN_FORMAT)) {
        return Ok(OLE_ERROR_FORMAT);
    }

    let old = ole.r16(plus(object, GEN_DATA));

    if old != 0 {
        ole.global_free(old).await?;
    }

    ole.w16(plus(object, GEN_DATA), handle);

    let size = ole.global_size(handle).await?;

    ole.w32(plus(object, GEN_SIZE), size);
    Ok(OLE_OK)
}

/// `...QUERYBOUNDS` (307, 407, 507): nought, nought, the width and the
/// height; another class's (608) noughts and `OLE_ERROR_GENERIC`.
pub(crate) fn query_bounds(ole: &Ole<'_>, kind: Kind, object: u32, rect: u32) -> u16 {
    let (width, height) = if kind == Kind::Gen {
        (0, 0)
    } else {
        (
            ole.r32(plus(object, OBJ_WIDTH)) as u16,
            ole.r32(plus(object, OBJ_HEIGHT)) as u16,
        )
    };

    ole.w16(rect, 0);
    ole.w16(plus(rect, 2), 0);
    ole.w16(plus(rect, 4), width);
    ole.w16(plus(rect, 6), height);

    if kind == Kind::Gen {
        OLE_ERROR_GENERIC
    } else {
        OLE_OK
    }
}

/// A class's name's bytes: a static kind's, or another class's atom's.
async fn class_name(ole: &Ole<'_>, kind: Kind, object: u32) -> R<Vec<u8>> {
    if kind != Kind::Gen {
        return Ok(class_of(kind).to_vec());
    }

    let at = ole.near(SCRATCH);

    ole.atom_name(ole.r16(plus(object, GEN_CLASS)), at, 0x100)
        .await?;
    Ok(ole.string(at))
}

/// Another class's format's name, as `GetClipboardFormatName` gives it;
/// none for a format below C000h.
async fn format_name(ole: &Ole<'_>, format: u16) -> R<Option<Vec<u8>>> {
    if format < 0xc000 {
        return Ok(None);
    }

    let at = ole.near(SCRATCH);

    ole.user(
        "GetClipboardFormatName",
        &[Arg::W(format), Arg::D(at), Arg::W(0x100)],
    )
    .await?;
    Ok(Some(ole.string(at)))
}

/// The data's size as a stream holds it.
fn data_size(ole: &Ole<'_>, kind: Kind, object: u32) -> u32 {
    ole.r32(plus(
        object,
        if kind == Kind::Gen { GEN_SIZE } else { MF_SIZE },
    ))
}

/// `OBJQUERYSIZE` (913): what `OleSaveToStream` would write -- the
/// version, the type, the class's name, then the bounds and the data's
/// size and data, or another class's format and its name, its data's size
/// and data (**recorded** by `olestat`; **measured** by `olemem`'s
/// `noname`).
pub(crate) async fn query_size(ole: &Ole<'_>, kind: Kind, object: u32, out: u32) -> R<u16> {
    let class = class_name(ole, kind, object).await?;
    let mut size = 8 + 4 + class.len() as u32 + 1;

    if kind == Kind::Gen {
        let name = format_name(ole, ole.r16(plus(object, GEN_FORMAT))).await?;

        size += 4 + name.map_or(0, |name| 4 + name.len() as u32 + 1) + 4;
    } else {
        size += 12;
    }

    match kind {
        Kind::Mf => {
            // Its bits looked at, as for its stream.
            let bits = ole
                .gdi16(
                    "GetMetafileBits",
                    &[Arg::W(ole.r16(plus(object, MF_METAFILE)))],
                )
                .await?;

            ole.global_lock(bits).await?;
            ole.global_unlock(bits).await?;

            let again = ole.gdi16("SetMetafileBits", &[Arg::W(bits)]).await?;

            ole.w16(plus(object, MF_METAFILE), again);
        }
        Kind::Dib => {
            let data = ole.r16(plus(object, DIB_DATA));

            ole.global_size(data).await?;
            ole.global_lock(data).await?;
            ole.global_unlock(data).await?;
        }
        Kind::Bm => {
            // A bitmap's bits and its `BITMAP` fetched, as for its stream,
            // into a block let go again.
            let bitmap = ole.r16(plus(object, BM_BITMAP));
            let count = ole.r32(plus(object, BM_SIZE)).wrapping_sub(14);
            let block = ole.global_alloc(GMEM_MOVEABLE, count).await?;
            let at = ole.global_lock(block).await?;

            ole.gdi(
                "GetBitmapBits",
                &[Arg::W(bitmap), Arg::D(count), Arg::D(at)],
            )
            .await?;
            bitmap_info(ole, bitmap).await?;
            ole.global_unlock(block).await?;
            ole.global_free(block).await?;
        }
        Kind::Gen => {}
    }

    ole.w32(out, size.wrapping_add(data_size(ole, kind, object)));
    Ok(OLE_OK)
}

// Streams.

/// `...SAVETOSTREAM` (302, 402, 502, 603): the version, the type (static),
/// the class's name, then for a static kind its width, its height, its
/// data's size and its data -- a picture's `METAFILEPICT` and its bits, a
/// bitmap's `BITMAP` and its bits, a DIB's block -- and for another class
/// its format, the format's name where it is registered, its data's size
/// and its data. Each field a `Put` of its own (**recorded** by `olestat`).
pub(crate) async fn save_to_stream(ole: &Ole<'_>, kind: Kind, object: u32, stream: u32) -> R<u16> {
    let class = class_name(ole, kind, object).await?;

    if !(put_long(ole, stream, STREAM_VERSION).await?
        && put_long(ole, stream, OT_STATIC).await?
        && put_name(ole, stream, &class).await?)
    {
        return Ok(OLE_ERROR_STREAM);
    }

    if kind == Kind::Gen {
        let format = ole.r16(plus(object, GEN_FORMAT));
        let name = format_name(ole, format).await?;
        let given = if name.is_some() { 0 } else { u32::from(format) };

        if !put_long(ole, stream, given).await? {
            return Ok(OLE_ERROR_STREAM);
        }

        if let Some(name) = name
            && !put_name(ole, stream, &name).await?
        {
            return Ok(OLE_ERROR_STREAM);
        }
    } else if !put_long(ole, stream, ole.r32(plus(object, OBJ_WIDTH))).await?
        || !put_long(ole, stream, ole.r32(plus(object, OBJ_HEIGHT))).await?
    {
        return Ok(OLE_ERROR_STREAM);
    }

    let size = data_size(ole, kind, object);

    if !put_long(ole, stream, size).await? {
        return Ok(OLE_ERROR_STREAM);
    }

    Ok(if put_data(ole, kind, object, stream, size).await? {
        OLE_OK
    } else {
        OLE_ERROR_STREAM
    })
}

async fn put_data(ole: &Ole<'_>, kind: Kind, object: u32, stream: u32, size: u32) -> R<bool> {
    match kind {
        Kind::Mf => {
            let header: Vec<u8> = [MF_MM, MF_XEXT, MF_YEXT, MF_METAFILE]
                .iter()
                .flat_map(|field| ole.r16(plus(object, *field)).to_le_bytes())
                .collect();

            if !put_bytes(ole, stream, &header).await? {
                return Ok(false);
            }

            let bits = ole
                .gdi16(
                    "GetMetafileBits",
                    &[Arg::W(ole.r16(plus(object, MF_METAFILE)))],
                )
                .await?;
            let at = ole.global_lock(bits).await?;
            let ok = put(ole, stream, at, size.wrapping_sub(8)).await?;

            ole.global_unlock(bits).await?;

            let again = ole.gdi16("SetMetafileBits", &[Arg::W(bits)]).await?;

            ole.w16(plus(object, MF_METAFILE), again);
            Ok(ok)
        }
        Kind::Bm => {
            let bitmap = ole.r16(plus(object, BM_BITMAP));
            let count = size.wrapping_sub(14);
            let block = ole.global_alloc(GMEM_MOVEABLE, count).await?;
            let at = ole.global_lock(block).await?;

            ole.gdi(
                "GetBitmapBits",
                &[Arg::W(bitmap), Arg::D(count), Arg::D(at)],
            )
            .await?;

            let info = bitmap_info(ole, bitmap).await?;
            let ok = put_bytes(ole, stream, &info).await? && put(ole, stream, at, count).await?;

            ole.global_unlock(block).await?;
            ole.global_free(block).await?;
            Ok(ok)
        }
        _ => {
            let data = ole.r16(plus(
                object,
                if kind == Kind::Dib {
                    DIB_DATA
                } else {
                    GEN_DATA
                },
            ));
            let at = ole.global_lock(data).await?;
            let ok = put(ole, stream, at, size).await?;

            ole.global_unlock(data).await?;
            Ok(ok)
        }
    }
}

/// A static stream's object read, the version and type already read and
/// the class's name given: its block made, then its fields. Its pointer,
/// or the error; what was made let go on an error.
pub(crate) async fn load_static(
    ole: &Ole<'_>,
    stream: u32,
    class: &[u8],
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let kind = [Kind::Mf, Kind::Bm, Kind::Dib]
        .into_iter()
        .find(|kind| class_of(*kind) == class);
    let class_atom = ole.add_atom_text(class).await?;
    let made = kind.unwrap_or(Kind::Gen);
    let object = new_object(ole, made, block_of(made), client, doc, name).await?;

    if object == 0 {
        ole.delete_atom(class_atom).await?;
        return Ok(OLE_ERROR_MEMORY);
    }

    let read = match kind {
        Some(kind) => Box::pin(read_static(ole, kind, object, stream)).await?,
        None => Box::pin(read_other(ole, object, stream, class_atom)).await?,
    };

    if kind.is_some() || read != OLE_OK {
        ole.delete_atom(class_atom).await?;
    }

    if read != OLE_OK {
        if kind.is_none() {
            ole.w16(plus(object, GEN_CLASS), 0);
        }

        free_object(ole, object).await?;
        return Ok(read);
    }

    ole.w32(out, object);
    Ok(OLE_OK)
}

/// A block of `size` bytes read from the stream: its handle, or nought.
async fn read_block(ole: &Ole<'_>, stream: u32, size: u32) -> R<u16> {
    let block = ole.global_alloc(GMEM_MOVEABLE, size).await?;

    if block == 0 {
        return Ok(0);
    }

    let at = ole.global_lock(block).await?;
    let ok = get(ole, stream, at, size).await?;

    ole.global_unlock(block).await?;

    if !ok {
        ole.global_free(block).await?;
        return Ok(0);
    }

    Ok(block)
}

async fn read_static(ole: &Ole<'_>, kind: Kind, object: u32, stream: u32) -> R<u16> {
    let Some(width) = get_long(ole, stream).await? else {
        return Ok(OLE_ERROR_STREAM);
    };
    let Some(height) = get_long(ole, stream).await? else {
        return Ok(OLE_ERROR_STREAM);
    };
    let Some(size) = get_long(ole, stream).await? else {
        return Ok(OLE_ERROR_STREAM);
    };

    ole.w32(plus(object, OBJ_WIDTH), width);
    ole.w32(plus(object, OBJ_HEIGHT), height);

    match kind {
        Kind::Mf => {
            let at = ole.near(SCRATCH + 0x40);

            if !get(ole, stream, at, 8).await? {
                return Ok(OLE_ERROR_STREAM);
            }

            let mm = ole.r16(at);
            let x_ext = ole.r16(plus(at, 2));
            let y_ext = ole.r16(plus(at, 4));
            let bits = read_block(ole, stream, size.wrapping_sub(8)).await?;

            if bits == 0 {
                return Ok(OLE_ERROR_STREAM);
            }

            let metafile = ole.gdi16("SetMetafileBits", &[Arg::W(bits)]).await?;

            ole.w32(plus(object, MF_SIZE), size);
            ole.w16(plus(object, MF_MM), mm);
            ole.w16(plus(object, MF_XEXT), x_ext);
            ole.w16(plus(object, MF_YEXT), y_ext);
            ole.w16(plus(object, MF_METAFILE), metafile);
            ole.w16(plus(object, OBJ_MAPPING), mm);
            Ok(OLE_OK)
        }
        Kind::Bm => {
            let at = ole.near(SCRATCH + 0x40);

            if !get(ole, stream, at, 14).await? {
                return Ok(OLE_ERROR_STREAM);
            }

            let info = ole.read(at, 14);
            let block = read_block(ole, stream, size.wrapping_sub(14)).await?;

            if block == 0 {
                return Ok(OLE_ERROR_STREAM);
            }

            let bits = ole.global_lock(block).await?;
            let bitmap = ole
                .gdi16(
                    "CreateBitmap",
                    &[
                        Arg::W(word(&info, 2)),
                        Arg::W(word(&info, 4)),
                        Arg::W(u16::from(info[8])),
                        Arg::W(u16::from(info[9])),
                        Arg::D(bits),
                    ],
                )
                .await?;

            ole.global_unlock(block).await?;
            ole.global_free(block).await?;
            ole.w32(plus(object, BM_SIZE), size);
            ole.w16(plus(object, BM_WIDTH), word(&info, 2));
            ole.w16(plus(object, BM_HEIGHT), word(&info, 4));
            ole.w16(plus(object, BM_BITMAP), bitmap);
            Ok(OLE_OK)
        }
        _ => {
            let data = read_block(ole, stream, size).await?;

            if data == 0 {
                return Ok(OLE_ERROR_STREAM);
            }

            ole.w32(plus(object, DIB_SIZE), size);
            ole.w16(plus(object, DIB_DATA), data);
            Ok(OLE_OK)
        }
    }
}

/// Another class's object read: its format, or for nought a name's length
/// and that many bytes read over the name the last such stream left in
/// `OLECLI`'s buffer, the format registered by what the buffer then holds
/// (**measured** by `olemem`'s `noname`, whose stream gives a length of
/// nought and whose format is named as the stream before it named one);
/// then its data's size and data.
async fn read_other(ole: &Ole<'_>, object: u32, stream: u32, class_atom: u16) -> R<u16> {
    ole.w16(plus(object, GEN_CLASS), class_atom);

    let Some(mut format) = get_long(ole, stream).await? else {
        return Ok(OLE_ERROR_STREAM);
    };

    if format == 0 {
        let Some(length) = get_long(ole, stream).await? else {
            return Ok(OLE_ERROR_STREAM);
        };
        let at = ole.near(FORMAT_NAME);

        if length != 0 && !get(ole, stream, at, length.min(FORMAT_NAME_SIZE)).await? {
            return Ok(OLE_ERROR_STREAM);
        }

        format = u32::from(ole.user("RegisterClipboardFormat", &[Arg::D(at)]).await? as u16);
    }

    ole.w16(plus(object, GEN_FORMAT), format as u16);

    let Some(size) = get_long(ole, stream).await? else {
        return Ok(OLE_ERROR_STREAM);
    };
    let data = read_block(ole, stream, size).await?;

    if data == 0 {
        return Ok(OLE_ERROR_STREAM);
    }

    ole.w32(plus(object, GEN_SIZE), size);
    ole.w16(plus(object, GEN_DATA), data);
    Ok(OLE_OK)
}

// Clone, equal, copy to the clipboard.

/// `...CLONE` (303, 403, 503, 604): another of its kind in the document
/// given, its data copied.
pub(crate) async fn clone(
    ole: &Ole<'_>,
    kind: Kind,
    object: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let mut metafile = 0;

    if kind == Kind::Mf {
        metafile = ole
            .gdi16(
                "CopyMetafile",
                &[Arg::W(ole.r16(plus(object, MF_METAFILE))), Arg::D(0)],
            )
            .await?;
    }

    let copy = new_object(ole, kind, block_of(kind), client, doc, name).await?;

    if copy == 0 {
        return Ok(OLE_ERROR_MEMORY);
    }

    ole.w32(plus(copy, OBJ_WIDTH), ole.r32(plus(object, OBJ_WIDTH)));
    ole.w32(plus(copy, OBJ_HEIGHT), ole.r32(plus(object, OBJ_HEIGHT)));
    ole.w16(plus(copy, OBJ_MAPPING), ole.r16(plus(object, OBJ_MAPPING)));

    match kind {
        Kind::Mf => {
            for field in [MF_SIZE, MF_SIZE + 2, MF_MM, MF_XEXT, MF_YEXT] {
                ole.w16(plus(copy, field), ole.r16(plus(object, field)));
            }

            ole.w16(plus(copy, MF_METAFILE), metafile);
        }
        Kind::Bm => {
            let bitmap = ole.r16(plus(object, BM_BITMAP));
            let (made, info) = copy_bitmap(ole, bitmap).await?;

            set_bitmap(ole, copy, bitmap, made, &info).await?;
        }
        _ => {
            let field = if kind == Kind::Dib {
                DIB_DATA
            } else {
                GEN_DATA
            };
            let data = copy_block(ole, ole.r16(plus(object, field))).await?;

            ole.w32(
                plus(
                    copy,
                    if kind == Kind::Dib {
                        DIB_SIZE
                    } else {
                        GEN_SIZE
                    },
                ),
                data_size(ole, kind, object),
            );
            ole.w16(plus(copy, field), data);

            if kind == Kind::Gen {
                let at = ole.near(SCRATCH);

                ole.w16(plus(copy, GEN_FORMAT), ole.r16(plus(object, GEN_FORMAT)));
                ole.atom_name(ole.r16(plus(object, GEN_CLASS)), at, 0x100)
                    .await?;

                let atom = ole.add_atom(at).await?;

                ole.w16(plus(copy, GEN_CLASS), atom);
            }
        }
    }

    ole.w32(out, copy);
    Ok(OLE_OK)
}

/// Two blocks' bytes compared, `count` of them.
fn same(ole: &Ole<'_>, a: u32, b: u32, count: u32) -> bool {
    (0..count).all(|i| ole.r8(huge(a, i)) == ole.r8(huge(b, i)))
}

/// `...EQUAL` (304, 404, 504, 605): a picture's bits, by
/// `GetMetafileBits`, their blocks' sizes and bytes; a DIB's blocks;
/// another class's format and block (**measured** by `olemem`'s `equal`
/// and `other` records).
///
/// A bitmap's (`BMEQUAL`, **read out** of `OLECLI.DLL` seg11 `00e4`): the
/// sizes first, `OLE_ERROR_NOT_EQUAL` where they differ; then each one's
/// bits by `GetBitmapBits` into a block of its size, the two counts
/// compared (`OLE_ERROR_NOT_EQUAL` where they differ) and the bytes by its
/// entry 1031 (seg3 `38a6`), which answers 1 for the same and nought for
/// not -- and `BMEQUAL` makes 1 `OLE_ERROR_NOT_EQUAL` and nought `OLE_OK`.
/// So bitmaps alike answer not equal and bitmaps that differ equal
/// (**recorded** by `olestat`, a bitmap and itself; **measured** by
/// `olemem`, two that differ). A block not had is `OLE_ERROR_MEMORY`.
pub(crate) async fn equal(ole: &Ole<'_>, kind: Kind, a: u32, b: u32) -> R<u16> {
    match kind {
        Kind::Mf => {
            let first = ole
                .gdi16("GetMetafileBits", &[Arg::W(ole.r16(plus(a, MF_METAFILE)))])
                .await?;
            let second = ole
                .gdi16("GetMetafileBits", &[Arg::W(ole.r16(plus(b, MF_METAFILE)))])
                .await?;
            let answer = same_blocks(ole, first, second).await?;
            let again_a = ole.gdi16("SetMetafileBits", &[Arg::W(first)]).await?;

            ole.w16(plus(a, MF_METAFILE), again_a);

            let again_b = ole.gdi16("SetMetafileBits", &[Arg::W(second)]).await?;

            ole.w16(plus(b, MF_METAFILE), again_b);
            Ok(answer)
        }
        Kind::Bm => bitmaps_equal(ole, a, b).await,
        _ => {
            if kind == Kind::Gen && ole.r16(plus(a, GEN_FORMAT)) != ole.r16(plus(b, GEN_FORMAT)) {
                return Ok(OLE_ERROR_NOT_EQUAL);
            }

            let field = if kind == Kind::Dib {
                DIB_DATA
            } else {
                GEN_DATA
            };

            same_blocks(ole, ole.r16(plus(a, field)), ole.r16(plus(b, field))).await
        }
    }
}

async fn bitmaps_equal(ole: &Ole<'_>, a: u32, b: u32) -> R<u16> {
    let size = ole.r32(plus(a, BM_SIZE));

    if size != ole.r32(plus(b, BM_SIZE)) {
        return Ok(OLE_ERROR_NOT_EQUAL);
    }

    let first = ole.global_alloc(GMEM_MOVEABLE, size).await?;
    let pa = if first == 0 {
        0
    } else {
        ole.global_lock(first).await?
    };
    let second = if pa == 0 {
        0
    } else {
        ole.global_alloc(GMEM_MOVEABLE, size).await?
    };
    let pb = if second == 0 {
        0
    } else {
        ole.global_lock(second).await?
    };
    let mut answer = OLE_ERROR_MEMORY;

    if pa != 0 && pb != 0 {
        let bitmap_a = ole.r16(plus(a, BM_BITMAP));
        let bitmap_b = ole.r16(plus(b, BM_BITMAP));
        let count_a = ole
            .gdi(
                "GetBitmapBits",
                &[Arg::W(bitmap_a), Arg::D(size), Arg::D(pa)],
            )
            .await?;
        let count_b = ole
            .gdi(
                "GetBitmapBits",
                &[Arg::W(bitmap_b), Arg::D(size), Arg::D(pb)],
            )
            .await?;

        answer = if count_a != count_b || same(ole, pa, pb, count_a) {
            OLE_ERROR_NOT_EQUAL
        } else {
            OLE_OK
        };
    }

    for (handle, locked) in [(first, pa), (second, pb)] {
        if locked != 0 {
            ole.global_unlock(handle).await?;
        }
    }

    for handle in [first, second] {
        if handle != 0 {
            ole.global_free(handle).await?;
        }
    }

    Ok(answer)
}

/// Two global blocks: equal where their sizes and bytes are.
async fn same_blocks(ole: &Ole<'_>, first: u16, second: u16) -> R<u16> {
    let size = ole.global_size(first).await?;

    if size != ole.global_size(second).await? {
        return Ok(OLE_ERROR_NOT_EQUAL);
    }

    let pa = ole.global_lock(first).await?;
    let pb = ole.global_lock(second).await?;
    let answer = if same(ole, pa, pb, size) {
        OLE_OK
    } else {
        OLE_ERROR_NOT_EQUAL
    };

    ole.global_unlock(first).await?;
    ole.global_unlock(second).await?;
    Ok(answer)
}

/// `...COPY` (305, 405, 505, 606): a copy of its data put on the clipboard
/// the program has open, in its format: a picture's metafile copied into a
/// new `METAFILEPICT`, a bitmap copied, a block copied.
pub(crate) async fn copy_to_clipboard(ole: &Ole<'_>, kind: Kind, object: u32) -> R<u16> {
    let handle = match kind {
        Kind::Mf => {
            let metafile = ole
                .gdi16(
                    "CopyMetafile",
                    &[Arg::W(ole.r16(plus(object, MF_METAFILE))), Arg::D(0)],
                )
                .await?;
            let handle = ole.global_alloc(GMEM_MOVEABLE, 8).await?;
            let at = ole.global_lock(handle).await?;

            ole.w16(at, ole.r16(plus(object, MF_MM)));
            ole.w16(plus(at, 2), ole.r16(plus(object, MF_XEXT)));
            ole.w16(plus(at, 4), ole.r16(plus(object, MF_YEXT)));
            ole.w16(plus(at, 6), metafile);
            ole.global_unlock(handle).await?;
            handle
        }
        Kind::Bm => copy_bitmap(ole, ole.r16(plus(object, BM_BITMAP))).await?.0,
        _ => {
            let field = if kind == Kind::Dib {
                DIB_DATA
            } else {
                GEN_DATA
            };

            copy_block(ole, ole.r16(plus(object, field))).await?
        }
    };

    ole.user(
        "SetClipboardData",
        &[Arg::W(format_of(ole, kind, object)), Arg::W(handle)],
    )
    .await?;
    Ok(OLE_OK)
}
