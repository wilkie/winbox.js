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

use crate::invalidate_through::{
    RDW_ALLCHILDREN, RDW_ERASE, RDW_ERASENOW, RDW_INVALIDATE, RDW_NOCHILDREN, RDW_UPDATENOW,
    RDW_VALIDATE,
};
use crate::paint::{DSP_ALLCHILDREN, DSP_ENUMCLIPPEDCHILDREN};

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
/// With `bErase`, the window's frame is drawn and its erase sent first,
/// where they are due, the window alone (`USER.EXE` seg1 `466f`-`467c`,
/// `7913`; `uwleft`).
pub(super) fn get_update_rect(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far, erase) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };
        let index = engine.system().window_named(hwnd);

        if erase != 0
            && let Some(index) = index
        {
            engine.sync_paint_from(Some(index), 0).await?;
        }

        update_rect_answer(&mut engine.system(), hwnd, far)
    })
}

/// `GetUpdateRect`'s answer, once anything due is erased.
fn update_rect_answer(system: &mut System, hwnd: u16, far: u32) -> Result<Answer, Stop> {
    // The desktop window: what of the desktop itself is due (`rdwmore`).
    if hwnd != 0 && system.handles.lookup(crate::handles::Object::Desktop) == Some(hwnd) {
        let due = system.background_region.as_ref().map(|region| {
            let bounds = region.bounds();

            [bounds.left, bounds.top, bounds.right, bounds.bottom]
        });

        if far != 0 {
            write_rect(system, far, due.unwrap_or([0; 4]));
        }

        return Ok(Answer::Word(u16::from(due.is_some())));
    }

    // Another task's making it due, looked at (`USER.EXE` seg1 `4684`).
    if let Some(index) = system.window_named(hwnd) {
        system.shown_mut(index).other_task = false;
    }

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
///
/// With `bErase`, the window's frame is drawn and its erase sent first,
/// where they are due, the window alone (`USER.EXE` seg1 `478e`-`479b`,
/// `7913`; `uwleft`).
pub(super) fn get_update_rgn(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, hrgn, erase) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.word(&system))
        };
        let index = {
            let system = engine.system();

            system
                .window_named(hwnd)
                .filter(|_| system.region_named(hrgn).is_some())
        };

        if erase != 0
            && let Some(index) = index
        {
            engine.sync_paint_from(Some(index), 0).await?;
        }

        update_rgn_answer(&mut engine.system(), hwnd, hrgn)
    })
}

/// `GetUpdateRgn`'s answer, once anything due is erased.
fn update_rgn_answer(system: &mut System, hwnd: u16, hrgn: u16) -> Result<Answer, Stop> {
    let (Some(index), Some((object, _))) = (system.window_named(hwnd), system.region_named(hrgn))
    else {
        return Ok(Answer::Word(0));
    };
    // Another task's making it due, looked at (`USER.EXE` seg1 `47a3`).
    system.shown_mut(index).other_task = false;

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

/// `RedrawWindow` (`USER.EXE` seg1 `aabf`, `3e1e`, `3ed7`; `rdwwalk`).
/// **Read out**:
///
/// * A handle that is no window, or a region that is no region, answers
///   nought (`aac8`, `aadd`-`aaec`, KERNEL's `HandleParamError`); flags
///   above 0FFFh are warned of and go on (`aaef`-`aafa`). Else it answers
///   1, for a window that does not show too (`3ecd`).
/// * The rectangle or region is in the client area's terms, put on the
///   screen (`3e5c`-`3ebb`); with neither, all of the window. Only with
///   `RDW_INVALIDATE` or `RDW_VALIDATE` (`3e56`).
/// * Made due or validated through USER's walk (`invalidate_through`).
/// * Then `RDW_UPDATENOW` paints the window, and the windows in it but with
///   `RDW_NOCHILDREN` (`3f93`-`3fad`, seg1 `441d`); else `RDW_ERASENOW`
///   draws the frames and erases now (`3faf`-`3fcf`, seg1 `7913`): the
///   windows in it with `RDW_ALLCHILDREN`, none with `RDW_NOCHILDREN`, else
///   those of a window with `WS_CLIPCHILDREN`.
pub(super) fn redraw_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, far, hrgn, flags) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let far = args.dword(&system);
            let hrgn = args.word(&system);
            let flags = args.word(&system);

            (hwnd, far, hrgn, flags)
        };

        redraw(engine, hwnd, far, hrgn, flags).await
    })
}

/// `RedrawWindow`'s body as a program calls it, for `InvalidateRect` of no
/// window too (`redraw_window`).
pub(crate) async fn redraw(
    engine: &Engine,
    hwnd: u16,
    far: u32,
    hrgn: u16,
    flags: u16,
) -> Result<Answer, Stop> {
    let (index, hwnd, flags) = {
        let mut system = engine.system();
        // The desktop's own handle is the desktop, as none is
        // (`3e2d`-`3e31`).
        let desktop = system.handles.lookup(crate::handles::Object::Desktop);
        let index = if hwnd == 0 || Some(hwnd) == desktop {
            None
        } else {
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            Some(index)
        };
        let given = if hrgn == 0 {
            None
        } else {
            let Some((_, shape)) = system.region_named(hrgn) else {
                return Ok(Answer::Word(0));
            };

            Some(shape)
        };
        let rect = system.rect_given(far);
        let (x, y) = index.map_or((0, 0), |index| {
            let window = system.shown(index);

            (
                window.left + window.client.left,
                window.top + window.client.top,
            )
        });
        let region = if flags & (RDW_INVALIDATE | RDW_VALIDATE) == 0 {
            None
        } else if let Some(shape) = &given {
            Some(shape.offset(x, y))
        } else {
            rect.map(|[left, top, right, bottom]| {
                ClipRegion::rect(left + x, top + y, right + x, bottom + y)
            })
        };

        if let Some(index) = index {
            // Where a window is locked, what is made due is told to it as
            // drawn (`3f41`-`3f7c`).
            let told = match &given {
                Some(shape) => {
                    let bounds = shape.bounds();

                    Some([bounds.left, bounds.top, bounds.right, bounds.bottom])
                }
                None => rect,
            };

            if !system.redraw_through(index, region.as_ref(), flags, told) {
                return Ok(Answer::Word(1));
            }
        } else {
            // What is made due of the desktop told to the records USER
            // keeps, as a window's is (`3f41`-`3f7c`; `uwleft`).
            if flags & RDW_INVALIDATE != 0 {
                system.tell_desktop(region.as_ref().map(|region| {
                    let bounds = region.bounds();

                    [bounds.left, bounds.top, bounds.right, bounds.bottom]
                }));
            }

            system.invalidate_through(
                None,
                region.as_ref(),
                flags | crate::invalidate_through::RDW_CALLED,
            );
        }

        (index, hwnd, flags)
    };

    if flags & RDW_UPDATENOW != 0 {
        let children = flags & RDW_NOCHILDREN == 0;

        if index.is_some() {
            engine.update_now(hwnd, children).await?;
        } else if children {
            // The desktop's own drawn first; the windows at the top,
            // front to back (`44c5`-`450e`).
            let tops: Vec<u16> = {
                let mut system = engine.system();

                system.paint_background_due();

                system
                    .windows_in(None)
                    .into_iter()
                    .map(|top| system.shown(top).hwnd)
                    .collect()
            };

            for top in tops {
                engine.update_now(top, true).await?;
            }
        }
    } else if flags & RDW_ERASENOW != 0 {
        let dsp = if flags & RDW_NOCHILDREN != 0 {
            0
        } else if flags & RDW_ALLCHILDREN != 0 {
            DSP_ALLCHILDREN
        } else {
            DSP_ENUMCLIPPEDCHILDREN
        };

        engine.sync_paint_from(index, dsp).await?;
    }

    Ok(Answer::Word(1))
}
