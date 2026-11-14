//! GDI's visible-region family: the calls USER keeps a device context to
//! what shows of its window with, which a program may make too. **Read out**
//! of `GDI.EXE` seg1 and **recorded** by `visfam`. The design they follow is
//! `kb/topics/visible-regions.md`.
//!
//! A context keeps its visible region in the screen's terms (`Dc::vis`,
//! none for what the context shows), the copies `SaveVisRgn` saved, and
//! its origin (`DcState::origin`, none for its view's corner). What drawing
//! goes through is the clip region within the visible region moved to the
//! context's terms by the origin (`regions::draw_clip`). A window's context
//! still draws only on its window's pixels as well, through its view of the
//! screen: drawing where `SelectVisRgn` or `SetDCOrg` reach outside it is
//! the design's third phase.

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::handles::{Kind, Object};
use crate::system::System;

use super::GdiObject;
use super::dc::{DcBitmap, dc_of, origin_of};
use super::draw::{device_point, pat_blt, read_rect};
use super::mapping::mapping_of;
use super::pack;
use super::regions::{clip_of, region_shape, vis_of};

pub fn implementation(name: &str) -> Option<Implementation> {
    match name {
        "Death" => return Some(Implementation::Async(death_call)),
        "Resurrection" => return Some(Implementation::Async(resurrection_call)),
        _ => {}
    }

    Some(Implementation::Sync(match name {
        "SelectVisRgn" => select_vis_rgn_call,
        "IntersectVisRect" => intersect_vis_rect_call,
        "ExcludeVisRect" => exclude_vis_rect_call,
        "OffsetVisRgn" => offset_vis_rgn_call,
        "SaveVisRgn" => save_vis_rgn_call,
        "RestoreVisRgn" => restore_vis_rgn_call,
        "InquireVisRgn" => inquire_vis_rgn_call,
        "SetDCOrg" => set_dc_org_call,
        "GetDCState" => get_dc_state_call,
        "SetDCState" => set_dc_state_call,
        "FastWindowFrame" => fast_window_frame_call,
        _ => return None,
    }))
}

/// The visible region given, its handle's region kept the same.
fn set_vis(system: &mut System, dc: usize, shape: ClipRegion) {
    if let Some((_, object)) = system.gdi.dcs[dc].vis_handle {
        system.gdi.objects[object] = GdiObject::Region(shape.clone());
    }

    system.gdi.dcs[dc].vis = Some(shape);
}

/// `SelectVisRgn`'s body, as USER selects a region for a context it lends.
pub(crate) fn select_vis(system: &mut System, dc: usize, shape: ClipRegion) {
    set_vis(system, dc, shape);
}

/// `SelectVisRgn`: a copy of the region made the visible region (seg1
/// `1635`, `58b3`), the region given staying the program's (`visfam`). The
/// kind drawing is kept to; nought for no context or no region.
fn select_vis_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let hrgn = args.word(system);
    let (Some(dc), Some(shape)) = (dc_of(system, hdc), region_shape(system, hrgn)) else {
        return Ok(Answer::Word(0));
    };

    set_vis(system, dc, shape);
    Ok(Answer::Word(clip_of(system, dc).kind()))
}

/// The visible region narrowed by a rectangle in the screen's terms, its
/// edges as given, not mapped (seg1 `16b9`).
fn vis_rect(
    system: &mut System,
    args: &mut Args,
    how: fn(&ClipRegion, &ClipRegion) -> ClipRegion,
) -> Answer {
    let hdc = args.word(system);
    let [left, top, right, bottom] = [(); 4].map(|()| i32::from(args.signed(system)));
    let Some(dc) = dc_of(system, hdc) else {
        return Answer::Word(0);
    };
    let vis = vis_of(system, dc);

    set_vis(
        system,
        dc,
        how(&vis, &ClipRegion::rect(left, top, right, bottom)),
    );
    Answer::Word(clip_of(system, dc).kind())
}

/// `IntersectVisRect` (seg1 `16a2`): the wrong way round leaves nothing,
/// and answers 1 (`visfam`).
fn intersect_vis_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(vis_rect(system, args, ClipRegion::intersect))
}

/// `ExcludeVisRect` (seg1 `16a5`).
fn exclude_vis_rect_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(vis_rect(system, args, ClipRegion::subtract))
}

/// `OffsetVisRgn` (seg1 `2929`): the visible region moved; the kind
/// drawing is kept to.
fn offset_vis_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let vis = vis_of(system, dc).offset(x, y);

    set_vis(system, dc, vis);
    Ok(Answer::Word(clip_of(system, dc).kind()))
}

/// `SaveVisRgn` (seg1 `076c`): a copy of the visible region pushed on the
/// context's stack, the copy that was on top before answered -- nought for
/// the first (`visfam`).
fn save_vis_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(save_vis_rgn(system, dc)))
}

/// `SaveVisRgn`'s body: the copy that was on top before. One USER saved
/// for a region given to `GetDCEx` is given its handle now, the first time
/// a program can see it (`visnext`'s `given`): Windows' has had one all
/// along, and it becomes the visible region again as the context is given
/// back.
pub(crate) fn save_vis_rgn(system: &mut System, dc: usize) -> u16 {
    let vis = vis_of(system, dc);

    if let Some(top) = system.gdi.dcs[dc].vis_saved.last().copied()
        && top.0 == 0
    {
        let handle = system
            .handles
            .allocate(Kind::Gdi, Object::Gdi(top.1))
            .unwrap_or(0);

        if let Some(last) = system.gdi.dcs[dc].vis_saved.last_mut() {
            last.0 = handle;
        }
    }

    let before = system.gdi.dcs[dc]
        .vis_saved
        .last()
        .map_or(0, |&(handle, _)| handle);
    let handle = system.gdi_allocate(GdiObject::Region(vis));

    if let Some(Object::Gdi(object)) = system.handles.resolve(handle) {
        system.gdi.dcs[dc].vis_saved.push((handle, object));
    }

    before
}

/// `RestoreVisRgn` (seg1 `07b2`): the copy on top made the visible region
/// and the region it was deleted; the visible region's kind answered, −1
/// with nothing saved.
fn restore_vis_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(restore_vis_rgn(system, dc)))
}

/// `SaveVisRgn` as USER makes it for a region given to `GetDCEx`
/// (`dc_entries`): the copy kept with no handle of its own.
pub(crate) fn save_vis_quietly(system: &mut System, dc: usize) {
    let vis = vis_of(system, dc);
    let object = system.gdi_object(GdiObject::Region(vis));

    system.gdi.dcs[dc].vis_saved.push((0, object));
}

/// `RestoreVisRgn`'s body: the visible region's kind, −1 with nothing saved.
pub(crate) fn restore_vis_rgn(system: &mut System, dc: usize) -> u16 {
    let Some((handle, object)) = system.gdi.dcs[dc].vis_saved.pop() else {
        return 0xffff;
    };

    if let Some((old, old_object)) = system.gdi.dcs[dc].vis_handle
        && system.handles.resolve(old) == Some(Object::Gdi(old_object))
    {
        system.handles.free(old);
    }

    let shape = match &system.gdi.objects[object] {
        GdiObject::Region(shape) => shape.clone(),
        _ => ClipRegion::EMPTY,
    };

    system.gdi.dcs[dc].vis_handle = Some((handle, object));
    system.gdi.dcs[dc].vis = Some(shape);

    vis_of(system, dc).kind()
}

/// `InquireVisRgn` (seg1 `200a`): the visible region itself, the same
/// handle each time until a restore (`visfam`); here the visible region as
/// it is when asked.
fn inquire_vis_rgn_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let shape = vis_of(system, dc);

    if let Some((handle, object)) = system.gdi.dcs[dc].vis_handle
        && system.handles.resolve(handle) == Some(Object::Gdi(object))
    {
        system.gdi.objects[object] = GdiObject::Region(shape);
        return Ok(Answer::Word(handle));
    }

    let handle = system.gdi_allocate(GdiObject::Region(shape));

    if let Some(Object::Gdi(object)) = system.handles.resolve(handle) {
        system.gdi.dcs[dc].vis_handle = Some((handle, object));
    }

    Ok(Answer::Word(handle))
}

/// `SetDCOrg` (seg1 `1118`): the origin exchanged, the clip region --
/// kept in the context's own terms -- as it is, the visible region where it
/// is. The origin before, x in the low word. Drawing does not yet move.
fn set_dc_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };
    let (old_x, old_y) = origin_of(system, dc);

    system.gdi.dcs[dc].state.origin = Some((x, y));
    Ok(Answer::Dword(pack(i64::from(old_x), i64::from(old_y))))
}

/// `GetDCState` (seg1 `0601`): a copy of the state as `SaveDC` makes one,
/// as a context of its own; not the visible region.
fn get_dc_state_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let placeholder = system.placeholder_bitmap();
    let copy = system.new_dc(DcBitmap::Bitmap(placeholder), true);

    system.gdi.dcs[copy].state = system.gdi.dcs[dc].state.clone();

    Ok(Answer::Word(
        system
            .handles
            .allocate(Kind::Gdi, Object::Dc(copy))
            .unwrap_or(0),
    ))
}

/// `SetDCState` (seg1 `0615`): the state copied back, the visible region
/// kept; the origin copied and set back through `SetDCOrg` to what it was
/// (`072f`-`073f`), so the context keeps its origin (`visfam`'s `origin`:
/// it outlives `ReleaseDC`, which sets a common context's state back).
fn set_dc_state_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let saved = args.word(system);

    if let (Some(dc), Some(saved)) = (dc_of(system, hdc), dc_of(system, saved)) {
        let origin = system.gdi.dcs[dc].state.origin;

        system.gdi.dcs[dc].state = system.gdi.dcs[saved].state.clone();
        system.gdi.dcs[dc].state.origin = origin;
    }

    Ok(Answer::Nothing)
}

/// Whether a context is the display's: not a memory context, nor a
/// printer's (seg1 `422e`-`423c`).
fn on_display(system: &System, dc: usize) -> bool {
    !system.gdi.dcs[dc].memory
        && !system.printing.printers.contains_key(&dc)
        && super::printer_driver::device_info(system, dc).is_none()
}

/// `FastWindowFrame` (seg1 `420e`): a rectangle's frame drawn by the
/// display driver's `FastBorder` on a display's context whose region
/// drawing goes through is one rectangle, −1 answered (`VGA.DRV` seg1
/// `2532`, `280f`); nought otherwise. The rectangle is mapped to the device
/// (`427d`), the sides each drawn with the brush and the operation.
fn fast_window_frame_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let across = i32::from(args.signed(system));
    let down = i32::from(args.signed(system));
    let rop = args.dword(system);
    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(rect) = read_rect(system, far) else {
        return Ok(Answer::Word(0));
    };

    if !on_display(system, dc) || clip_of(system, dc).kind() != 2 {
        return Ok(Answer::Word(0));
    }

    let m = mapping_of(system, dc);
    let (left, top) = device_point(&m, rect[0], rect[1]);
    let (right, bottom) = device_point(&m, rect[2], rect[3]);
    let (width, height) = (right - left, bottom - top);
    // The sides in the device's terms: the mapping set aside while they
    // are drawn.
    let mapping = system.gdi.dcs[dc].state.mapping.take();

    for side in [
        [left, top, width, down],
        [left, bottom - down, width, down],
        [left, top + down, across, height - 2 * down],
        [right - across, top + down, across, height - 2 * down],
    ] {
        pat_blt(system, hdc, side, rop);
    }

    system.gdi.dcs[dc].state.mapping = mapping;
    Ok(Answer::Word(0xffff))
}

/// Whose `Disable` and `Enable` a context's `Death` and `Resurrection`
/// call: the display's, a printer driver's from the drive -- its entry
/// points 4 and 5 and its `PDEVICE` -- or WinBox's own printer's, which
/// has none and answers nought.
enum DeathOf {
    Display,
    Driver(usize),
    Own,
}

fn death_of(system: &System, hdc: u16) -> DeathOf {
    match dc_of(system, hdc) {
        Some(dc) if super::printer_driver::device_info(system, dc).is_some() => DeathOf::Driver(dc),
        Some(dc) if system.printing.printers.contains_key(&dc) => DeathOf::Own,
        _ => DeathOf::Display,
    }
}

/// `Death` (seg1 `2067`): the context's driver's `Disable`, given its
/// `PDEVICE`, and what it answers -- the display's without turning
/// WinBox's display off; a printer driver's from the drive run (`visprn`:
/// the PostScript driver's answers 1, `PSCRIPT.DRV` seg12 `0000`-`0044`).
fn death_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hdc = args.word(&engine.system());
        let of = death_of(&engine.system(), hdc);

        Ok(Answer::Word(match of {
            DeathOf::Display => engine.system().display.disable_answer(),
            DeathOf::Driver(dc) => super::printer_driver::call_device(engine, dc, 4, &[])
                .await?
                .unwrap_or(0) as u16,
            DeathOf::Own => 0,
        }))
    })
}

/// `Resurrection` (seg1 `208e`): the context's driver's `Enable`, given
/// its `PDEVICE`, a style of nought and the three far pointers the six
/// words make, the first word high (`20a1`-`20be`); what it answers.
fn resurrection_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, words) = {
            let system = engine.system();
            let hdc = args.word(&system);
            let words: Vec<u16> = (0..6).map(|_| args.word(&system)).collect();

            (hdc, words)
        };
        let of = death_of(&engine.system(), hdc);

        Ok(Answer::Word(match of {
            DeathOf::Display => engine.system().display.enable_answer(),
            DeathOf::Driver(dc) => {
                let far =
                    |high: u16, low: u16| GuestArg::Long(u32::from(high) << 16 | u32::from(low));

                super::printer_driver::call_device(
                    engine,
                    dc,
                    5,
                    &[
                        GuestArg::Word(0),
                        far(words[0], words[1]),
                        far(words[2], words[3]),
                        far(words[4], words[5]),
                    ],
                )
                .await?
                .unwrap_or(0) as u16
            }
            DeathOf::Own => 0,
        }))
    })
}
