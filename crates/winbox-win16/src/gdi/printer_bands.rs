//! Bands: GDI's side of a driver whose `dpRaster` has `RC_BANDING` (2), as
//! `GDI.EXE` keeps it. The twin of `src/win16/gdi/printer-bands.ts`.
//!
//! * `CreateDC` of a device newly enabled, not an IC, makes a metafile
//!   (seg1 `042d`, `GetTempFileName` and `CreateMetaFile`; here one in
//!   memory), keeps it on the context, saves the context (`025b`) and marks
//!   it as recording, type 4F50h (`0264`).
//! * While it records, each call that draws is kept in the metafile and not
//!   drawn; each that sets the context's state is kept and made too;
//!   `LineTo` is kept and moves the current position (`banding_call`).
//! * `NEWFRAME` (seg7 `01b7`), as `EndPage` sends it: the context made the
//!   type that draws (4F4Fh), restored to its first level, the metafile
//!   closed; then for each band, the context saved, the driver's `Control`
//!   asked `NEXTBAND` (`0207`), the visible region narrowed to the band
//!   (`IntersectVisRect`), the clip region dropped, the metafile played and
//!   the context restored -- until the driver gives an empty band. Then the
//!   metafile deleted, a new one made, the context saved and recording
//!   again, and `NEWFRAME` given to the driver (`044e`). A band the driver
//!   refuses, or a metafile that does not play, ends it so and gives the
//!   driver `ABORTDOC` instead, answering the refusal (`028d`).
//! * `NEXTBAND` from the program (`0303`): the first of a page throws the
//!   metafile away, restores the context and saves it again, and the
//!   context draws; each gives the driver `NEXTBAND` and narrows the
//!   visible region to its band; an empty band makes a metafile again,
//!   restores and saves the context, and it records (`03a3`).
//! * `ABORTDOC` (`018c`) restores the context, and makes the metafile anew;
//!   `ENDDOC` (`0152`) widens the visible region back.
//! * `DeleteDC` closes and deletes the metafile (seg1 `089b`).
//!
//! Not followed: `RC_SCALING`'s shifts, the temporary file, and the escapes
//! GDI keeps in the metafile (25, 200h on, seg7 `0172`, `0469`).

use crate::call::Stop;
use crate::engine::Engine;
use crate::handles::Object;
use crate::modules::Export;
use crate::system::System;

/// GDI's side of a context of a driver that bands.
#[derive(Debug, Clone, Default)]
pub struct Bands {
    /// The metafile's device context, while there is one.
    pub meta: u16,
    /// Whether calls are kept in it (type 4F50h).
    pub recording: bool,
    /// The band the visible region is narrowed to, in device units.
    pub rect: Option<[i32; 4]>,
}

/// What a call does on a context that records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Banding {
    /// Kept and made.
    Both,
    /// Kept, and the current position moved (seg21 `0b47`).
    Position,
    /// Kept and not made.
    Kept,
}

/// Calls kept and made (seg20 `2596` and the `cmp byte [bx+2], 50h` that
/// lets a context of type 4F50h on).
const BOTH: &[&str] = &[
    "SetBkColor",
    "SetBkMode",
    "SetMapMode",
    "SetRop2",
    "SetPolyFillMode",
    "SetStretchBltMode",
    "SetTextAlign",
    "SetTextCharacterExtra",
    "SetTextColor",
    "SetTextJustification",
    "SetWindowOrg",
    "SetWindowExt",
    "SetViewportOrg",
    "SetViewportExt",
    "OffsetWindowOrg",
    "ScaleWindowExt",
    "OffsetViewportOrg",
    "ScaleViewportExt",
    "MoveTo",
    "ExcludeClipRect",
    "IntersectClipRect",
    "SelectObject",
    "SelectClipRgn",
    "SaveDC",
    "RestoreDC",
    "SetMapperFlags",
];

/// Calls kept and not made.
const KEPT: &[&str] = &[
    "Arc",
    "Chord",
    "Ellipse",
    "Pie",
    "Rectangle",
    "RoundRect",
    "Polygon",
    "Polyline",
    "PolyPolygon",
    "TextOut",
    "ExtTextOut",
    "PatBlt",
    "BitBlt",
    "StretchBlt",
    "SetPixel",
    "FloodFill",
    "ExtFloodFill",
    "FillRgn",
    "FrameRgn",
    "InvertRgn",
    "PaintRgn",
    "OffsetClipRgn",
    "SetDIBitsToDevice",
    "StretchDIBits",
];

fn banding_call(name: &str) -> Option<Banding> {
    if BOTH.contains(&name) {
        Some(Banding::Both)
    } else if name == "LineTo" {
        Some(Banding::Position)
    } else if KEPT.contains(&name) {
        Some(Banding::Kept)
    } else {
        None
    }
}

/// The metafile a call at an `INT 80h` is kept in, on a context of a
/// driver that bands while it records, with what else the call does: the
/// metafile's index, how, and the context.
pub(crate) fn recording(
    system: &System,
    module: &str,
    export: Export,
    stack: u32,
    sp: u32,
) -> Option<(usize, Banding, u16)> {
    if module != "GDI" || system.printing.drivers.bands.is_empty() {
        return None;
    }

    let how = banding_call(export.name)?;
    let first = sp + 4 + u32::from(export.pops).saturating_sub(2);
    let hdc = system.cpu.bus.read16(stack + (first & 0xffff));
    let dc = super::printer_driver::driver_dc_of(system, hdc)?;
    let bands = system.printing.drivers.bands.get(&dc)?;

    if !bands.recording {
        return None;
    }

    let Some(Object::Metafile(index)) = system.handles.resolve(bands.meta) else {
        return None;
    };

    Some((index, how, hdc))
}

/// A call kept in the metafile, and, for one that is not made too, its
/// answer the record's and the current position moved for `LineTo`:
/// whether it is answered so.
pub(crate) fn keep(
    system: &mut System,
    (meta, how, hdc): (usize, Banding, u16),
    ordinal: u16,
    export: Export,
    stack: u32,
    sp: u32,
) -> bool {
    super::metafile::record_call(system, meta, ordinal, export, stack, sp);

    if how == Banding::Position {
        let read = |at: u32| system.cpu.bus.read16(stack + (at & 0xffff));
        let (x, y) = (read(sp + 6) as i16, read(sp + 4) as i16);

        super::dc::move_to(system, hdc, x, y);
    }

    how != Banding::Both
}

const NEWFRAME: u16 = 1;
const ABORTDOC: u16 = 2;
const NEXTBAND: u16 = 3;
const ENDDOC: u16 = 11;

/// A context of a driver that bands made ready to record (seg1 `042d`,
/// `025b`).
pub fn start_bands(system: &mut System, hdc: u16, dc: usize) {
    let meta = super::metafile::create_in_memory(system);

    super::dc::save_dc(system, hdc);
    system.printing.drivers.bands.insert(
        dc,
        Bands {
            meta,
            recording: meta != 0,
            rect: None,
        },
    );
}

fn bands_mut(system: &mut System, dc: usize) -> Option<&mut Bands> {
    system.printing.drivers.bands.get_mut(&dc)
}

/// The metafile a context recorded, closed and deleted.
fn drop_metafile(system: &mut System, dc: usize) {
    let meta = bands_mut(system, dc).map_or(0, |bands| std::mem::take(&mut bands.meta));

    if meta != 0 {
        let hmf = super::metafile::close(system, meta);

        super::metafile::delete(system, hmf);
    }
}

/// A new metafile, the context saved, and recording again.
fn record_again(system: &mut System, hdc: u16, dc: usize) {
    let meta = super::metafile::create_in_memory(system);

    super::dc::save_dc(system, hdc);

    if let Some(bands) = bands_mut(system, dc) {
        bands.meta = meta;
        bands.recording = meta != 0;
    }
}

fn set_rect(system: &mut System, dc: usize, rect: Option<[i32; 4]>) {
    if let Some(bands) = bands_mut(system, dc) {
        bands.rect = rect;
    }
}

fn rect_of(bytes: &[u8]) -> [i32; 4] {
    let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

    [word(0), word(2), word(4), word(6)]
}

fn empty(rect: [i32; 4]) -> bool {
    rect == [0, 0, 0, 0]
}

/// An escape GDI takes for a context that bands, or `None` for one it
/// hands to the driver as any other (seg7 `0137`-`0448`).
pub async fn band_escape(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    escape: u16,
    input: u32,
    output: u32,
) -> Result<Option<i16>, Stop> {
    let Some(bands) = engine.system().printing.drivers.bands.get(&dc).cloned() else {
        return Ok(None);
    };

    match escape {
        NEWFRAME if bands.recording => Ok(Some(new_frame(engine, hdc, dc, input, output).await?)),
        NEXTBAND => Ok(Some(next_band(engine, hdc, dc, output).await?)),
        ABORTDOC => {
            {
                let mut system = engine.system();

                super::dc::restore_dc(&mut system, hdc, 0);
                set_rect(&mut system, dc, None);

                if bands.meta == 0 {
                    super::dc::restore_dc(&mut system, hdc, 0);
                }

                drop_metafile(&mut system, dc);
                record_again(&mut system, hdc, dc);
            }

            Ok(Some(
                super::printer_driver::control(engine, dc, ABORTDOC, input, output).await?,
            ))
        }
        ENDDOC => {
            set_rect(&mut engine.system(), dc, None);
            Ok(None)
        }
        _ => Ok(None),
    }
}

/// The page GDI kept, played band by band (seg7 `01b7`-`0300`).
async fn new_frame(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    input: u32,
    output: u32,
) -> Result<i16, Stop> {
    let hmf = {
        let mut system = engine.system();
        let meta = bands_mut(&mut system, dc).map_or(0, |bands| {
            bands.recording = false;
            std::mem::take(&mut bands.meta)
        });

        super::dc::restore_dc(&mut system, hdc, 0);
        super::metafile::close(&mut system, meta)
    };
    let mut refused = None;

    loop {
        super::dc::save_dc(&mut engine.system(), hdc);

        let (answer, left) = super::printer_driver::on_stack(engine, &[0; 12], |far| async move {
            let out = (far & 0xffff_0000) | (far.wrapping_add(4) & 0xffff);

            super::printer_driver::control(engine, dc, NEXTBAND, far, out).await
        })
        .await?;
        let rect = rect_of(&left[4..12]);

        if answer <= 0 {
            refused = Some(answer);
            break;
        }

        if empty(rect) {
            break;
        }

        let saved = {
            let mut system = engine.system();
            let saved = bands_mut(&mut system, dc).and_then(|bands| bands.rect);
            let narrowed = saved.map_or(rect, |within| {
                [
                    within[0].max(rect[0]),
                    within[1].max(rect[1]),
                    within[2].min(rect[2]),
                    within[3].min(rect[3]),
                ]
            });

            set_rect(&mut system, dc, Some(narrowed));
            super::regions::select_clip_rgn(&mut system, hdc, 0);
            saved
        };

        let played = super::metafile::play(engine, hdc, hmf).await?;
        let mut system = engine.system();

        set_rect(&mut system, dc, saved);

        if !played {
            refused = Some(-1);
            break;
        }

        super::dc::restore_dc(&mut system, hdc, 0);
    }

    {
        let mut system = engine.system();

        super::dc::restore_dc(&mut system, hdc, 0);
        super::metafile::delete(&mut system, hmf);
        record_again(&mut system, hdc, dc);
    }

    let escape = if refused.is_some() {
        ABORTDOC
    } else {
        NEWFRAME
    };
    let answer = super::printer_driver::control(engine, dc, escape, input, output).await?;

    Ok(refused.unwrap_or(answer))
}

/// The program's own `NEXTBAND` (seg7 `0303`-`0448`).
async fn next_band(engine: &Engine, hdc: u16, dc: usize, output: u32) -> Result<i16, Stop> {
    {
        let mut system = engine.system();
        let meta = bands_mut(&mut system, dc).map_or(0, |bands| bands.meta);

        if meta != 0 {
            drop_metafile(&mut system, dc);

            if let Some(bands) = bands_mut(&mut system, dc) {
                bands.recording = false;
            }

            super::dc::restore_dc(&mut system, hdc, 0);
            super::dc::save_dc(&mut system, hdc);
        }

        set_rect(&mut system, dc, None);
    }

    let (answer, _) = super::printer_driver::on_stack(engine, &[0; 4], |far| async move {
        super::printer_driver::control(engine, dc, NEXTBAND, far, output).await
    })
    .await?;
    let mut system = engine.system();
    let rect = if output == 0 {
        [0; 4]
    } else {
        rect_of(&system.read_far(output, 8))
    };

    if empty(rect) {
        let meta = super::metafile::create_in_memory(&mut system);

        super::dc::restore_dc(&mut system, hdc, 0);
        super::dc::save_dc(&mut system, hdc);

        if let Some(bands) = bands_mut(&mut system, dc) {
            bands.meta = meta;
            bands.recording = meta != 0;
        }

        return Ok(answer);
    }

    set_rect(&mut system, dc, Some(rect));
    Ok(answer)
}

/// A context that bands deleted: its metafile closed and deleted (seg1
/// `089b`).
pub fn stop_bands(system: &mut System, dc: usize) {
    drop_metafile(system, dc);
    system.printing.drivers.bands.remove(&dc);
}

/// The band a context's visible region is narrowed to, if it bands.
pub(crate) fn band_of(system: &System, dc: usize) -> Option<[i32; 4]> {
    system
        .printing
        .drivers
        .bands
        .get(&dc)
        .and_then(|bands| bands.rect)
}
