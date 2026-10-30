//! Drawing an object: `OleDraw`'s methods, `MFDRAW`, `BMDRAW`, `DIBDRAW`
//! (308, 408, 508), and `MFCALLBACKFUNC` (102), the procedure a picture's
//! records are enumerated through. Each call into GDI and USER as
//! `OLECLI.DLL` makes it, seen with its arguments as WinBox ran the file;
//! the metafiles it leaves **measured** by `olemem`'s `record`s, the
//! pixels **recorded** by `olestat`. As `src/win16/olecli/draw.ts`.

use crate::commdlg::api::Arg;
use crate::engine::GuestArg;

use super::core::{
    BM_BITMAP, BM_HEIGHT, BM_WIDTH, DEFAULT_PALETTE, DIB_DATA, DT_METAFILE, GMEM_MOVEABLE, Kind,
    MF_METAFILE, MM_ANISOTROPIC, OBJ_CLIENT, OLE_ERROR_ABORT, OLE_ERROR_DRAW, OLE_ERROR_GENERIC,
    OLE_ERROR_MEMORY, OLE_OK, Ole, Playing, R, SCRATCH, SRCCOPY, TECHNOLOGY, plus,
};

/// What a picture's object keeps of a drawing under way (**measured** by
/// `olemem`'s `drawstate` and `long draw` records, the words after its
/// picture's): whether it is drawn into a metafile, the error that stopped
/// it, and how many records are left before its client is asked whether
/// to go on.
pub(crate) const MF_INTO_METAFILE: u16 = 0x3e;
pub(crate) const MF_DRAW_ERROR: u16 = 0x40;
pub(crate) const MF_RECORDS_LEFT: u16 = 0x42;
/// Records played between askings: sixteen.
pub(crate) const RECORDS_PER_ASK: u16 = 16;
/// `OLE_QUERY_PAINT`, the notice a client is asked with (ole.h).
const OLE_QUERY_PAINT: u16 = 4;

/// `OleIsDcMeta`: whether the device context's technology is
/// `DT_METAFILE`.
pub(crate) async fn is_dc_meta(ole: &Ole<'_>, dc: u16) -> R<u16> {
    Ok(u16::from(
        ole.device_caps(dc, TECHNOLOGY).await? == DT_METAFILE,
    ))
}

/// A `RECT`'s four sides.
fn rect(ole: &Ole<'_>, at: u32) -> [i16; 4] {
    [0, 2, 4, 6].map(|step| ole.r16(plus(at, step)) as i16)
}

/// `MFDRAW` (308): the device context saved and clipped to the bounds; its
/// metafile's records enumerated through `MFCALLBACKFUNC` and played, the
/// object's pointer given it. Into a metafile the window's bounds are
/// wanted -- none is `OLE_ERROR_DRAW`, the context left saved -- and the
/// picture's window is mapped into them; into any other context the bounds
/// are made the viewport, in device units, `MM_ANISOTROPIC`, and the
/// picture's own window used as it is. The context restored, its answer
/// the error a client's no left, else `OLE_OK`.
pub(crate) async fn draw_picture(
    ole: &Ole<'_>,
    object: u32,
    dc: u16,
    bounds_at: u32,
    window_at: u32,
) -> R<u16> {
    ole.w16(plus(object, MF_RECORDS_LEFT), RECORDS_PER_ASK);
    ole.w16(plus(object, MF_DRAW_ERROR), OLE_OK);

    let meta = is_dc_meta(ole, dc).await? == 1;

    if meta {
        ole.w16(plus(object, MF_INTO_METAFILE), 1);
    }

    let saved = ole.gdi16("SaveDC", &[Arg::W(dc)]).await?;
    let bounds = rect(ole, bounds_at);
    let mut clip = vec![Arg::W(dc)];

    clip.extend(bounds.iter().map(|side| Arg::W(*side as u16)));
    ole.gdi("IntersectClipRect", &clip).await?;

    let mut playing = Playing {
        object,
        meta,
        bounds,
        ..Playing::default()
    };

    if meta {
        if window_at == 0 {
            return Ok(OLE_ERROR_DRAW);
        }

        playing.window = rect(ole, window_at);
    } else {
        let at = ole.near(SCRATCH + 0x80);

        for (i, side) in bounds.iter().enumerate() {
            ole.w16(plus(at, i as u16 * 2), *side as u16);
        }

        ole.gdi("LPToDP", &[Arg::W(dc), Arg::D(at), Arg::W(2)])
            .await?;

        let device = rect(ole, at);

        ole.gdi("SetMapMode", &[Arg::W(dc), Arg::W(MM_ANISOTROPIC)])
            .await?;
        ole.gdi(
            "SetViewportOrg",
            &[
                Arg::W(dc),
                Arg::W(device[0] as u16),
                Arg::W(device[1] as u16),
            ],
        )
        .await?;
        ole.gdi(
            "SetViewportExt",
            &[
                Arg::W(dc),
                Arg::W(device[2].wrapping_sub(device[0]) as u16),
                Arg::W(device[3].wrapping_sub(device[1]) as u16),
            ],
        )
        .await?;
    }

    ole.state().playing.push(playing);

    let enumerated = ole
        .gdi(
            "EnumMetafile",
            &[
                Arg::W(dc),
                Arg::W(ole.r16(plus(object, MF_METAFILE))),
                Arg::D(super::export_address(ole.e, 102)),
                Arg::D(object),
            ],
        )
        .await;

    ole.state().playing.retain(|each| each.object != object);
    enumerated?;

    if meta {
        ole.w16(plus(object, MF_INTO_METAFILE), 0);
    }

    let restore = if meta { 0xffff } else { saved };

    ole.gdi("RestoreDC", &[Arg::W(dc), Arg::W(restore)]).await?;
    Ok(ole.r16(plus(object, MF_DRAW_ERROR)))
}

/// A metafile record's function.
const SET_WINDOW_ORG: u16 = 0x020b;
const SET_WINDOW_EXT: u16 = 0x020c;

/// `MFCALLBACKFUNC` (102), `EnumMetaFile`'s procedure for a picture being
/// drawn, given the object: every sixteenth record its client asked
/// `OLE_QUERY_PAINT`, a no stopping the enumeration with
/// `OLE_ERROR_ABORT` kept in the object (**measured** by `olemem`: 41
/// records, two askings, seven left); each record played with
/// `PlayMetaFileRecord`, but into a metafile its `SetWindowOrg` kept and
/// its `SetWindowExt` made the window's bounds' extents scaled to the
/// picture's -- the extent `MulDiv(right, extent, width)` and the origin
/// the picture's less `MulDiv(left - window's left, extent, width)`, each
/// way (**measured** by `olemem`'s `windowed` records). One to go on.
pub(crate) async fn mf_callback(
    ole: &Ole<'_>,
    dc: u16,
    table: u32,
    record: u32,
    objects: u16,
    object: u32,
) -> R<u16> {
    let remaining = ole.r16(plus(object, MF_RECORDS_LEFT)).wrapping_sub(1);

    ole.w16(plus(object, MF_RECORDS_LEFT), remaining);

    if remaining == 0 {
        ole.w16(plus(object, MF_RECORDS_LEFT), RECORDS_PER_ASK);

        let client = ole.r32(plus(object, OBJ_CLIENT));
        let callback = ole.r32(ole.r32(client));
        let answer = ole
            .call_far(
                callback,
                &[
                    GuestArg::Long(client),
                    GuestArg::Word(OLE_QUERY_PAINT),
                    GuestArg::Long(object),
                ],
            )
            .await?;

        if answer as u16 == 0 {
            ole.w16(plus(object, MF_DRAW_ERROR), OLE_ERROR_ABORT);
            return Ok(0);
        }
    }

    let function = ole.r16(plus(record, 4));
    let playing = ole
        .state()
        .playing
        .iter()
        .find(|each| each.object == object)
        .cloned();

    if let Some(playing) = playing
        && playing.meta
        && (function == SET_WINDOW_ORG || function == SET_WINDOW_EXT)
    {
        let y = ole.r16(plus(record, 6)) as i16;
        let x = ole.r16(plus(record, 8)) as i16;

        if function == SET_WINDOW_ORG {
            if let Some(kept) = ole
                .state()
                .playing
                .iter_mut()
                .find(|each| each.object == object)
            {
                kept.org = [x, y];
            }

            return Ok(1);
        }

        let [left, top, right, bottom] = playing.bounds;
        let [w_left, w_top, w_right, w_bottom] = playing.window;
        let width = right.wrapping_sub(left);
        let height = bottom.wrapping_sub(top);
        let ext_x = ole.mul_div(w_right, x, width).await?;
        let ext_y = ole.mul_div(w_bottom, y, height).await?;

        ole.gdi(
            "SetWindowExt",
            &[Arg::W(dc), Arg::W(ext_x as u16), Arg::W(ext_y as u16)],
        )
        .await?;

        let org_x =
            playing.org[0].wrapping_sub(ole.mul_div(left.wrapping_sub(w_left), x, width).await?);
        let org_y =
            playing.org[1].wrapping_sub(ole.mul_div(top.wrapping_sub(w_top), y, height).await?);

        ole.gdi(
            "SetWindowOrg",
            &[Arg::W(dc), Arg::W(org_x as u16), Arg::W(org_y as u16)],
        )
        .await?;
        return Ok(1);
    }

    ole.gdi(
        "PlayMetafileRecord",
        &[Arg::W(dc), Arg::D(table), Arg::D(record), Arg::W(objects)],
    )
    .await?;
    Ok(1)
}

/// `BMDRAW` (408): the bitmap selected into a context compatible with the
/// one drawn into and stretched onto the bounds, `SRCCOPY`. A metafile's
/// context has none compatible with it: `OLE_ERROR_MEMORY` (**recorded**
/// by `olestat`, **measured** by `olemem`).
pub(crate) async fn draw_bitmap(ole: &Ole<'_>, object: u32, dc: u16, bounds_at: u32) -> R<u16> {
    let screen = ole.get_dc().await?;
    let memory = ole.gdi16("CreateCompatibleDC", &[Arg::W(dc)]).await?;

    if memory == 0 {
        ole.release_dc(screen).await?;
        return Ok(OLE_ERROR_MEMORY);
    }

    let [left, top, right, bottom] = rect(ole, bounds_at);
    let old = ole
        .gdi16(
            "SelectObject",
            &[Arg::W(memory), Arg::W(ole.r16(plus(object, BM_BITMAP)))],
        )
        .await?;

    ole.gdi(
        "StretchBlt",
        &[
            Arg::W(dc),
            Arg::W(left as u16),
            Arg::W(top as u16),
            Arg::W(right.wrapping_sub(left) as u16),
            Arg::W(bottom.wrapping_sub(top) as u16),
            Arg::W(memory),
            Arg::W(0),
            Arg::W(0),
            Arg::W(ole.r16(plus(object, BM_WIDTH))),
            Arg::W(ole.r16(plus(object, BM_HEIGHT))),
            Arg::D(SRCCOPY),
        ],
    )
    .await?;
    ole.gdi("SelectObject", &[Arg::W(memory), Arg::W(old)])
        .await?;
    ole.gdi("DeleteDC", &[Arg::W(memory)]).await?;
    ole.release_dc(screen).await?;
    Ok(OLE_OK)
}

/// `DIBDRAW` (508): a palette made of the DIB's colours selected and
/// realized, the DIB stretched onto the bounds with `StretchDIBits`, then
/// the default palette selected and realized again and the DIB's deleted
/// (**measured** by `olemem`'s `dib` records). The window's bounds are not
/// used.
pub(crate) async fn draw_dib(ole: &Ole<'_>, object: u32, dc: u16, bounds_at: u32) -> R<u16> {
    let data = ole.r16(plus(object, DIB_DATA));
    let info = ole.global_lock(data).await?;
    let header_size = ole.r32(info) as u16;
    let width = ole.r32(plus(info, 4));
    let height = ole.r32(plus(info, 8));
    let bit_count = ole.r16(plus(info, 14));
    let used = ole.r32(plus(info, 32)) as u16;
    let colours = if used != 0 {
        used
    } else if bit_count <= 8 {
        1 << bit_count
    } else {
        0
    };
    let block = ole
        .global_alloc(GMEM_MOVEABLE, 4 + u32::from(colours) * 4)
        .await?;
    let logical = ole.global_lock(block).await?;

    ole.w16(logical, 0x300);
    ole.w16(plus(logical, 2), colours);

    for i in 0..colours {
        let quad = plus(info, header_size.wrapping_add(i * 4));
        let entry = plus(logical, 4 + i * 4);

        ole.w8(entry, ole.r8(plus(quad, 2)));
        ole.w8(plus(entry, 1), ole.r8(plus(quad, 1)));
        ole.w8(plus(entry, 2), ole.r8(quad));
        ole.w8(plus(entry, 3), 0);
    }

    ole.global_unlock(block).await?;

    let palette = ole.gdi16("CreatePalette", &[Arg::D(logical)]).await?;

    ole.user("SelectPalette", &[Arg::W(dc), Arg::W(palette), Arg::W(1)])
        .await?;
    ole.user("RealizePalette", &[Arg::W(dc)]).await?;

    let [left, top, right, bottom] = rect(ole, bounds_at);

    ole.gdi(
        "StretchDIBits",
        &[
            Arg::W(dc),
            Arg::W(left as u16),
            Arg::W(top as u16),
            Arg::W(right.wrapping_sub(left) as u16),
            Arg::W(bottom.wrapping_sub(top) as u16),
            Arg::W(0),
            Arg::W(0),
            Arg::W(width as u16),
            Arg::W(height as u16),
            Arg::D(plus(info, header_size.wrapping_add(colours * 4))),
            Arg::D(info),
            Arg::W(0),
            Arg::D(SRCCOPY),
        ],
    )
    .await?;

    let mut default = ole.state().default_palette;

    if default == 0 {
        default = ole
            .gdi16("GetStockObject", &[Arg::W(DEFAULT_PALETTE)])
            .await?;
        ole.state().default_palette = default;
    }

    ole.user("SelectPalette", &[Arg::W(dc), Arg::W(default), Arg::W(1)])
        .await?;
    ole.user("RealizePalette", &[Arg::W(dc)]).await?;
    ole.gdi("DeleteObject", &[Arg::W(palette)]).await?;
    ole.global_free(block).await?;
    ole.global_unlock(data).await?;
    Ok(OLE_OK)
}

/// An object drawn by its kind; another class's data cannot be drawn
/// (`GENDRAW`, 609): `OLE_ERROR_GENERIC` (**measured** by `olemem`).
pub(crate) async fn draw(
    ole: &Ole<'_>,
    kind: Kind,
    object: u32,
    dc: u16,
    bounds: u32,
    window: u32,
) -> R<u16> {
    match kind {
        Kind::Mf => draw_picture(ole, object, dc, bounds, window).await,
        Kind::Bm => draw_bitmap(ole, object, dc, bounds).await,
        Kind::Dib => draw_dib(ole, object, dc, bounds).await,
        Kind::Gen => Ok(OLE_ERROR_GENERIC),
    }
}
