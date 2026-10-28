//! What a window is due to paint, asked about and changed as a region:
//! `GetUpdateRect`, `InvalidateRgn`, `ValidateRgn`, `GetUpdateRgn`,
//! `ExcludeUpdateRgn`, and `RedrawWindow`. **Recorded** by `updrgn`:
//!
//! * The update is a region, not its box: two parts invalidated apart are a
//!   complex region, a point between them is not in it, and the paint that
//!   follows is clipped to the two parts.
//! * A part validated is cut from it.
//! * `InvalidateRgn` of NULL is the whole client area; `ValidateRgn` of NULL
//!   leaves nothing.
//! * `ExcludeUpdateRgn` cuts the update from a device context's clip and
//!   answers the kind of what is left.
//!
//! The region is kept as `paint.rs` keeps it: the box beside the shape,
//! the shape counting only while the box is the very one it was set with.

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::gdi::dc::dc_of;
use crate::gdi::draw::write_rect;
use crate::system::System;

const RDW_INVALIDATE: u16 = 0x0001;
const RDW_ERASE: u16 = 0x0004;
const RDW_VALIDATE: u16 = 0x0008;
const RDW_ALLCHILDREN: u16 = 0x0080;
const RDW_UPDATENOW: u16 = 0x0100;
const RDW_FRAME: u16 = 0x0400;

impl System {
    /// A window's client area on the screen.
    fn client_region(&self, index: usize) -> ClipRegion {
        let window = self.windows[index].as_ref().expect("a window");
        let left = window.left + window.client.left;
        let top = window.top + window.client.top;

        ClipRegion::rect(
            left,
            top,
            left + window.client_width(),
            top + window.client_height(),
        )
    }

    /// The region a handle stands for: its index among GDI's objects, and
    /// its shape.
    pub(crate) fn region_named(&self, handle: u16) -> Option<(usize, ClipRegion)> {
        match self.gdi_object_of(handle)? {
            (object, GdiObject::Region(shape)) => Some((object, shape.clone())),
            _ => None,
        }
    }

    /// A program's region, in a window's client area, on the screen and cut
    /// to it.
    fn region_on_screen(&self, index: usize, hrgn: u16) -> Option<ClipRegion> {
        let (_, shape) = self.region_named(hrgn)?;
        let corner = self.client_region(index).bounds();

        Some(shape.offset(corner.left, corner.top))
    }

    /// What a window is due to paint, in its client area, cut to those of
    /// the windows it is in (`USER.EXE` seg1 `47c2`, `8bb3`; `invchild`).
    fn update_seen(&self, index: usize) -> ClipRegion {
        let client = self.client_region(index);
        let corner = client.bounds();
        let seen = self
            .cut_to_parents(
                index,
                [corner.left, corner.top, corner.right, corner.bottom],
            )
            .map_or(ClipRegion::EMPTY, crate::invalidate_through::region_of);

        self.update_region(index)
            .intersect(&seen)
            .offset(-corner.left, -corner.top)
    }

    /// What a window is due to paint, in its client area.
    fn update_in_client(&self, index: usize) -> ClipRegion {
        let client = self.client_region(index);
        let corner = client.bounds();

        self.update_region(index)
            .intersect(&client)
            .offset(-corner.left, -corner.top)
    }

    /// The smallest rectangle around what a window is due to paint, in its
    /// client area, if there is any: the paint's own clip while it paints,
    /// else what is due, else all of it.
    pub fn update_rect(&self, hwnd: u16) -> Option<[i32; 4]> {
        let index = self.window_named(hwnd)?;
        let window = self.windows[index].as_ref()?;

        if !window.needs_paint {
            return None;
        }

        let x = window.left + window.client.left;
        let y = window.top + window.client.top;
        let area = window.paint_clip.or(window.dirty.map(|dirty| dirty.area));
        let (width, height) = (window.client_width(), window.client_height());
        // Cut to the client area, and to those of the windows it is in
        // (`USER.EXE` seg1 `46d6`-`46f2`, `8bb3`; `invchild`).
        let seen = self.cut_to_parents(
            index,
            [
                area.map_or(x, |area| area[0]).max(x),
                area.map_or(y, |area| area[1]).max(y),
                area.map_or(x + width, |area| area[2]).min(x + width),
                area.map_or(y + height, |area| area[3]).min(y + height),
            ],
        )?;
        let [left, top, right, bottom] = [seen[0] - x, seen[1] - y, seen[2] - x, seen[3] - y];

        (right > left && bottom > top).then_some([left, top, right, bottom])
    }
}

/// The smallest rectangle around what a window is due to paint, in its
/// client area; whether there is any (documented). Write asks before it
/// paints, and paints nothing -- validating nothing -- when told there is
/// nothing, so `WM_PAINT` came back for ever while this answered nought.
///
/// Not followed: `bErase`, which would have the background erased first.
pub(super) fn get_update_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let _erase = args.word(system);
    let rect = system.update_rect(hwnd);

    if far != 0 {
        write_rect(system, far, rect.unwrap_or([0; 4]));
    }

    Ok(Answer::Word(u16::from(rect.is_some())))
}

/// A region of a window's client area made due to paint: with none, all of
/// it. `InvalidateRgn` and `ValidateRgn` go through `RedrawWindow`'s body
/// (`USER.EXE` seg1 `aa67`, `aa93`, `011c`, `012f`, `3e1e`): the region,
/// not cut to the client area, made due or valid through the window and the
/// windows in it (`invalidate_through`; `invchild`).
pub(super) fn invalidate_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let hrgn = args.word(system);
    let erase = args.word(system) != 0;
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };
    let region = (hrgn != 0).then(|| system.region_on_screen(index, hrgn));

    if let Some(None) = region {
        return Ok(Answer::Nothing);
    }

    // Where a window is locked, what is made due is told to it as drawn,
    // the region's box (`USER.EXE` seg1 `3f41`-`3f7c`).
    let given = (hrgn != 0)
        .then(|| system.region_named(hrgn))
        .flatten()
        .map(|(_, shape)| {
            let bounds = shape.bounds();

            [bounds.left, bounds.top, bounds.right, bounds.bottom]
        });

    system.redraw_through(
        index,
        region.flatten().as_ref(),
        RDW_INVALIDATE | if erase { RDW_ERASE } else { 0 },
        given,
    );
    Ok(Answer::Nothing)
}

/// A region of a window's client area cut from what it is due to paint:
/// with none, all of it.
pub(super) fn validate_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let hrgn = args.word(system);
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };
    let region = (hrgn != 0).then(|| system.region_on_screen(index, hrgn));

    if let Some(None) = region {
        return Ok(Answer::Nothing);
    }

    system.redraw_through(index, region.flatten().as_ref(), RDW_VALIDATE, None);
    Ok(Answer::Nothing)
}

/// What a window is due to paint, put in a program's region, in its client
/// area; the region's kind, nought for no window or no region.
pub(super) fn get_update_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let hrgn = args.word(system);
    let _erase = args.word(system);
    let (Some(index), Some((object, _))) = (system.window_named(hwnd), system.region_named(hrgn))
    else {
        return Ok(Answer::Word(0));
    };
    let update = system.update_seen(index);
    let kind = update.kind();

    system.gdi.objects[object] = GdiObject::Region(update);
    Ok(Answer::Word(kind))
}

/// What a window is due to paint cut from a device context's clip: the
/// kind of what is left, nought for no device context or no window.
pub(super) fn exclude_update_rgn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let hwnd = args.word(system);
    let (Some(dc), Some(index)) = (dc_of(system, hdc), system.window_named(hwnd)) else {
        return Ok(Answer::Word(0));
    };
    let update = system.update_in_client(index);

    Ok(Answer::Word(crate::gdi::regions::narrow(
        system,
        dc,
        |clip| clip.subtract(&update),
    )))
}

/// A window drawn again, as `RedrawWindow`'s flags ask: its frame drawn
/// again, the window -- and with `RDW_ALLCHILDREN` its children -- marked to
/// be erased and painted, and painted at once with `RDW_UPDATENOW`. The
/// whole of each window: the rectangle and region are not kept, as the
/// TypeScript engine keeps neither. Validating leaves the box of what was
/// due where it was, only no longer due. Nought for a handle that is no
/// window of the desktop's, the desktop's own among them.
pub(super) fn redraw_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let windows = {
            let mut system = engine.system();
            let hwnd = args.word(&system);
            let _rect = args.dword(&system);
            let _hrgn = args.word(&system);
            let flags = args.word(&system);
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };
            let mut windows = vec![index];

            if flags & RDW_ALLCHILDREN != 0 {
                windows.extend(
                    system
                        .z_order
                        .iter()
                        .copied()
                        .filter(|&other| other != index && system.within(other, index)),
                );
            }

            for &window in &windows {
                if flags & RDW_INVALIDATE != 0 {
                    if flags & RDW_FRAME != 0 {
                        system.paint_frame(window);
                    }

                    let shown = system.windows[window].as_mut().expect("a window");

                    shown.needs_paint = true;
                    shown.dirty = None;
                    shown.dirty_shape = None;
                    shown.needs_erase |= flags & RDW_ERASE != 0;
                }

                if flags & RDW_VALIDATE != 0 {
                    let shown = system.windows[window].as_mut().expect("a window");

                    shown.needs_paint = false;
                    shown.needs_erase = false;
                }
            }

            if flags & RDW_UPDATENOW == 0 {
                return Ok(Answer::Word(1));
            }

            windows
                .into_iter()
                .filter_map(|window| system.windows[window].as_ref().map(|shown| shown.hwnd))
                .filter(|&hwnd| hwnd != 0)
                .collect::<Vec<_>>()
        };

        for hwnd in windows {
            engine.update_window(hwnd).await?;
        }

        Ok(Answer::Word(1))
    })
}
