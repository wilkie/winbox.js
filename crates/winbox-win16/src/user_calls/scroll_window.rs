//! Scrolling what is drawn: `ScrollWindow`, `ScrollWindowEx` and
//! `ScrollDC`, through the visible region, as `USER.EXE` seg13 does it.
//! Twin of the TypeScript engine's `scroll-window.ts`.
//!
//! **Read out**, `ScrollDC`'s body (seg13 `178d`), on a context:
//!
//! * Its clip box is asked (`179f`): nothing visible, an empty update and an
//!   answer of 1. The scroll rectangle is the one given or the clip box; with the
//!   clip rectangle, all in device terms where the call is `ScrollDC`'s or
//!   `ScrollWindowEx`'s without `SW_INVALIDATE` (`17ea`-`1855`).
//! * Where what shows is one rectangle (cut to the clip rectangle, `18b9`)
//!   and the window has no update region (`1975`), the rectangles alone
//!   (`1984`-`1b62`): the source and destination cut to the clip box, the
//!   pixels moved where both are, and the update the two together less
//!   what was moved -- a rectangle, or a region where the move is both ways
//!   or the two are apart and the source was cut.
//! * Otherwise by regions (`1bc4`-`1def`): what is visible, the clip box's
//!   region within the visible region and the clip region (`1e19`); the
//!   source and destination within it; what moves, the source moved within
//!   the destination, less the window's update region where it is and
//!   where it moves to (`1c94`-`1d09`); the update the source and
//!   destination less what moves. The pixels are blitted through what moves
//!   as the visible region (`1d7d`-`1dea`): **what another window covers is
//!   not copied, and where it would have gone is left to paint**.
//! * It answers the update region's kind, or nonzero for `ScrollDC`.
//!
//! `ScrollWindowEx` (seg13 `12f3`) and `ScrollWindow` (`127a`, which is
//! `ScrollWindowEx` with `SW_INVALIDATE | SW_ERASE`, `SW_SCROLLCHILDREN`
//! where no scroll rectangle is given, and a flag of its own):
//!
//! * Nothing to move, or the window not shown: an empty update, and 1.
//! * The caret hidden while it is in the window or one the window is in
//!   (`1332`-`134e`).
//! * A common context of the window's client area (`1362`-`13d2`); for
//!   `ScrollWindow`, the window's own if its class has one; with
//!   `SW_SCROLLCHILDREN`, `GetDCEx`'s 80000h, which leaves the children in.
//! * `ScrollWindow` first makes due the box of what the window was due,
//!   moved as far as the pixels (`1497`-`14db`), and gives the body no
//!   update region; `ScrollWindowEx` gives it the window's.
//! * With `SW_SCROLLCHILDREN`: the caret moved, if it is the window's and
//!   in the scroll rectangle (`15ab`-`1600`); the children that meet the
//!   scroll rectangle moved with their pixels (seg2 `0a1d`) and the
//!   window's contexts made stale (`1656`-`1666`); each sent `WM_MOVE`
//!   after, if it meets the scroll rectangle moved by the parent's client
//!   area's corner (`16c3`-`1742`), which is the window's own only for a
//!   window at the top.
//! * With `SW_INVALIDATE` the update made due, through the window's
//!   children too, erased with `SW_ERASE` (`166b`-`16af`).
//!
//! **Recorded** by `scrolls` and `visscrl`.

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::gdi::dc::{dc_of, origin_of};
use crate::gdi::draw::{bit_blt, read_rect, write_rect};
use crate::gdi::mapping::mapping_of;
use crate::invalidate_through::{
    RDW_ALLCHILDREN, RDW_ERASE, RDW_INVALIDATE, Rect, cut, is_empty, region_of,
};
use crate::messages::{Param, WM_MOVE};
use crate::system::System;
use crate::window_vis::{DCX_CACHE, DCX_USESTYLE};

const SW_SCROLLCHILDREN: u16 = 0x0001;
const SW_INVALIDATE: u16 = 0x0002;
const SW_ERASE: u16 = 0x0004;
/// `ScrollWindow`'s own (seg13 `12a7`).
const SW_SCROLLWINDOW: u16 = 0x8000;

const WS_CLIPCHILDREN: u32 = 0x0200_0000;
const CS_OWNDC: u16 = 0x0020;
const CS_CLASSDC: u16 = 0x0040;
/// `GetDCEx`'s 80000h: the children left in (seg1 `84ff`).
const DCX_NOCLIPCHILDREN: u32 = 0x0008_0000;
const SRCCOPY: u32 = 0x00cc_0020;

const EMPTY: Rect = [0, 0, 0, 0];

/// `IntersectRect` (seg1 `1e3e`): all nought where nothing is left.
fn intersect(a: Rect, b: Rect) -> Rect {
    let r = cut(a, b);

    if is_empty(r) { EMPTY } else { r }
}

fn shift(r: Rect, dx: i32, dy: i32) -> Rect {
    [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]
}

fn box_of(region: &ClipRegion) -> Rect {
    let bounds = region.bounds();

    [bounds.left, bounds.top, bounds.right, bounds.bottom]
}

/// `UnionRect` (seg1 `1ea6`).
fn unite(a: Rect, b: Rect) -> Rect {
    if is_empty(a) {
        return if is_empty(b) { EMPTY } else { b };
    }

    if is_empty(b) {
        return a;
    }

    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}

/// `SubtractRect` (seg1 `20b8`): cut only where `b` spans the whole of `a`
/// one way.
fn subtract(a: Rect, b: Rect) -> Rect {
    if is_empty(a) {
        return EMPTY;
    }

    let r = super::lock_update::subtract_rect(a, b);

    if is_empty(r) { EMPTY } else { r }
}

/// A logical rectangle in device terms, its points mapped as they are
/// (`LPtoDP`).
fn to_device(system: &System, dc: usize, r: Rect) -> Rect {
    let m = mapping_of(system, dc);

    [
        m.device_x(i64::from(r[0])) as i32,
        m.device_y(i64::from(r[1])) as i32,
        m.device_x(i64::from(r[2])) as i32,
        m.device_y(i64::from(r[3])) as i32,
    ]
}

fn to_logical(system: &System, dc: usize, r: Rect) -> Rect {
    let m = mapping_of(system, dc);

    [
        m.logical_x(i64::from(r[0])) as i32,
        m.logical_y(i64::from(r[1])) as i32,
        m.logical_x(i64::from(r[2])) as i32,
        m.logical_y(i64::from(r[3])) as i32,
    ]
}

/// Where a scroll's body hands its update: the program's rectangle and
/// region, either of which may be none; `region` asks for the region even
/// with no handle -- USER's own, at [14Eh] (seg13 `13f2`) -- and gets it.
struct Told {
    /// The program's rectangle's far address, and what is to be written
    /// there.
    far: u32,
    rect: Option<Rect>,
    hrgn: u16,
    region: bool,
    shape: Option<ClipRegion>,
}

impl Told {
    fn new(far: u32, hrgn: u16) -> Self {
        Self {
            far,
            rect: None,
            hrgn,
            region: false,
            shape: None,
        }
    }

    fn wanted(&self) -> bool {
        self.region || self.hrgn != 0 || self.far != 0
    }

    /// The update into the program's region, and its rectangle kept to be
    /// written (`1a7f`-`1aaa`, `1d27`-`1d72`).
    fn tell(&mut self, system: &mut System, shape: ClipRegion, rect: Rect) {
        if self.hrgn != 0
            && let Some((object, _)) = system.region_named(self.hrgn)
        {
            system.gdi.objects[object] = GdiObject::Region(shape.clone());
        }

        self.shape = Some(shape);

        if self.far != 0 {
            self.rect = Some(rect);
        }
    }

    /// The program's rectangle written.
    fn write(&self, system: &mut System) {
        if self.far != 0
            && let Some(rect) = self.rect
        {
            write_rect(system, self.far, rect);
        }
    }
}

/// The window's update region as the body is given it.
enum Update {
    None,
    Whole,
    Region(ClipRegion),
}

/// `ScrollDC`'s body (seg13 `178d`) on a context: its answer, the update's
/// kind (nought for no context). `update` is the window's update region on
/// the screen; `convert` takes what is given in logical terms.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn scroll_body(
    system: &mut System,
    hdc: u16,
    (dx, dy): (i32, i32),
    scroll: Option<Rect>,
    clip: Option<Rect>,
    update: &Update,
    told: &mut Told,
    convert: bool,
) -> u16 {
    let Some(dc) = dc_of(system, hdc) else {
        return 0;
    };

    // What can be drawn on, and its box in logical terms (`179f`).
    let visible = crate::gdi::regions::clip_of(system, dc);
    let mut kind = visible.kind();
    let mut area = if kind == 1 {
        EMPTY
    } else {
        to_logical(system, dc, box_of(&visible))
    };
    let mut source = scroll.unwrap_or(area);
    let mut within = clip;
    let (mut ddx, mut ddy) = (dx, dy);

    if convert {
        area = to_device(system, dc, area);
        source = to_device(system, dc, source);
        within = within.map(|within| to_device(system, dc, within));

        let [x0, y0, x1, y1] = to_device(system, dc, [0, 0, dx, dy]);

        (ddx, ddy) = (x1 - x0, y1 - y0);
    }

    let empty = |system: &mut System, told: &mut Told| {
        told.tell(system, ClipRegion::EMPTY, EMPTY);

        1
    };

    if kind == 1 {
        return empty(system, told);
    }

    // What shows, in device terms, where it is more than a rectangle
    // (`1e19`).
    let mut shows: Option<ClipRegion> = (kind == 3).then(|| visible.clone());
    let mut target = shift(source, ddx, ddy);
    let plain = matches!(update, Update::None | Update::Whole);

    if let Some(within) = within {
        if kind == 2 && plain {
            area = intersect(area, within);

            if is_empty(area) {
                return empty(system, told);
            }
        } else {
            let now = shows
                .take()
                .unwrap_or_else(|| visible.clone())
                .intersect(&region_of(within));

            kind = now.kind();

            if kind == 1 {
                return empty(system, told);
            }

            if kind == 2 {
                area = box_of(&now);
            }

            shows = Some(now);
        }
    }

    let mut moved = EMPTY;
    let mut answer = kind;
    // What moves, where the pixels go through it alone, on the screen.
    let mut through: Option<ClipRegion> = None;

    if kind == 2 && plain {
        // The rectangles alone (`1984`-`1b62`).
        let given = source;

        target = intersect(target, area);
        source = intersect(source, area);
        moved = if matches!(update, Update::Whole) {
            EMPTY
        } else {
            intersect(shift(source, ddx, ddy), target)
        };

        let left = if is_empty(source) {
            Some(target)
        } else if !is_empty(intersect(source, target)) {
            (!(ddx != 0 && ddy != 0)).then(|| subtract(unite(source, target), moved))
        } else if source == given {
            Some(source)
        } else {
            None
        };

        if let Some(left) = left {
            told.tell(system, region_of(left), left);
            answer = if is_empty(left) { 1 } else { 2 };
        } else if told.wanted() {
            let shape = region_of(target)
                .union(&region_of(source))
                .subtract(&region_of(moved));
            let rect = box_of(&shape);

            answer = shape.kind();
            told.tell(system, shape, rect);
        }
    } else {
        // By regions (`1bc4`-`1def`).
        let (ox, oy) = origin_of(system, dc);
        let now = shows.unwrap_or(visible);
        let from = region_of(source).intersect(&now);
        let to = region_of(target).intersect(&now);
        let mut moving = ClipRegion::EMPTY;

        if !matches!(update, Update::Whole) {
            moving = from.offset(ddx, ddy).intersect(&to);

            if let Update::Region(update) = update
                && moving.kind() > 1
            {
                let due = update.offset(-ox, -oy);

                moving = moving.subtract(&due);

                if moving.kind() > 1 {
                    moving = moving.subtract(&due.offset(ddx, ddy));
                }
            }
        }

        if told.wanted() {
            let mut shape = to.union(&from);

            if moving.kind() != 1 {
                shape = shape.subtract(&moving);
            }

            let rect = box_of(&shape);

            answer = shape.kind();
            told.tell(system, shape, rect);
        }

        if moving.kind() != 1 {
            through = Some(moving.offset(ox, oy));
            moved = target;
        }
    }

    if !is_empty(moved) {
        let at = if convert {
            to_logical(system, dc, moved)
        } else {
            moved
        };
        let blit = |system: &mut System| {
            bit_blt(
                system,
                hdc,
                [at[0], at[1], at[2] - at[0], at[3] - at[1]],
                hdc,
                at[0] - dx,
                at[1] - dy,
                SRCCOPY,
            );
        };

        if let Some(through) = through {
            // `SaveVisRgn`, `SelectVisRgn` of what moving, `RestoreVisRgn`.
            let vis = system.gdi.dcs[dc].vis.clone();
            let object = system.gdi.dcs[dc]
                .vis_handle
                .map(|(_, object)| (object, system.gdi.objects[object].clone()));

            crate::gdi::visible_region::select_vis(system, dc, through);
            blit(system);
            system.gdi.dcs[dc].vis = vis;

            if let Some((object, kept)) = object {
                system.gdi.objects[object] = kept;
            }
        } else {
            blit(system);
        }
    }

    if convert && let Some(rect) = told.rect {
        told.rect = Some(to_logical(system, dc, rect));
    }

    answer
}

/// `ScrollWindowEx`'s body (seg13 `12f3`), which `ScrollWindow` calls
/// too: its answer.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn scroll_window_body(
    engine: &Engine,
    hwnd: u16,
    (dx, dy): (i32, i32),
    scroll: Option<Rect>,
    clip: Option<Rect>,
    told: &mut Told,
    flags: u16,
) -> Result<u16, Stop> {
    let (index, caret_hidden, answer, moved_children) = {
        let mut system = engine.system();
        let Some(index) = system.window_named(hwnd) else {
            return Ok(0);
        };

        if (dx == 0 && dy == 0) || !system.user_shows(Some(index), true) {
            told.tell(&mut system, ClipRegion::EMPTY, EMPTY);
            told.write(&mut system);

            return Ok(1);
        }

        // The caret hidden while it is in the window or one the window is
        // in.
        let caret = system.caret.caret.map(|caret| caret.hwnd);
        let caret_hidden = caret.filter(|&caret| {
            system
                .window_named(caret)
                .is_some_and(|owner| system.within(index, owner))
        });

        if let Some(caret) = caret_hidden {
            system.hide_caret_of(caret);
        }

        let style = system.shown(index).style;
        let mut dc_flags = DCX_CACHE | DCX_USESTYLE;

        if flags & SW_SCROLLWINDOW != 0 {
            dc_flags = DCX_USESTYLE;

            if system.class_style(index) & (CS_OWNDC | CS_CLASSDC) == 0 {
                dc_flags |= DCX_CACHE;
            }

            if flags & SW_SCROLLCHILDREN != 0 && style & WS_CLIPCHILDREN != 0 {
                dc_flags |= DCX_CACHE | DCX_NOCLIPCHILDREN;
            }
        } else if flags & SW_SCROLLCHILDREN != 0 {
            dc_flags |= DCX_NOCLIPCHILDREN;
        }

        let hdc = system.get_dc_ex(hwnd, 0, dc_flags);
        let context = dc_of(&system, hdc);
        let (ox, oy) = context.map_or((0, 0), |dc| origin_of(&system, dc));
        let own = context.filter(|_| dc_flags & DCX_CACHE == 0);

        // The scroll rectangle: the client area where none is given, in the
        // window's own context's logical terms (`13f8`-`1421`); in device
        // terms, with the amount, for the children and the caret
        // (`1447`-`148e`).
        let (width, height) = {
            let shown = system.shown(index);

            (shown.client_width(), shown.client_height())
        };
        let mut given = scroll.unwrap_or([0, 0, width, height]);

        if scroll.is_none()
            && let Some(own) = own
        {
            given = to_logical(&system, own, given);
        }

        let mut device = given;
        let (mut ddx, mut ddy) = (dx, dy);

        if let Some(own) = own {
            device = to_device(&system, own, given);

            let [x0, y0, x1, y1] = to_device(&system, own, [0, 0, dx, dy]);

            (ddx, ddy) = (x1 - x0, y1 - y0);
        }

        // What the window was due: `ScrollWindow` makes its box due again
        // where it moving to and gives the body none; `ScrollWindowEx` gives
        // it.
        let mut update = Update::None;

        if system.shown(index).needs_paint {
            update = if system.shown(index).dirty.is_some() {
                Update::Region(system.update_region(index))
            } else {
                Update::Whole
            };
        }

        if flags & SW_SCROLLWINDOW != 0 {
            if let Update::Region(due) = &update {
                let moved = shift(box_of(due), ddx, ddy);
                let client = system.client_rect(index);

                // Through `RedrawWindow`'s own body, which tells the lock
                // (seg1 `3e1e`, `3f41`).
                system.lock_touched(Some(index), intersect(moved, client), 0);
                system.invalidate_through(
                    Some(index),
                    Some(&region_of(moved)),
                    RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN,
                );
            }

            update = Update::None;
        }

        told.region = flags & SW_INVALIDATE != 0;

        let answer = scroll_body(
            &mut system,
            hdc,
            (dx, dy),
            Some(given),
            clip,
            &update,
            told,
            flags & SW_INVALIDATE == 0,
        );

        told.write(&mut system);
        system.release_dc(hwnd, hdc)?;

        let (cx, cy) = {
            let shown = system.shown(index);

            (shown.left + shown.client.left, shown.top + shown.client.top)
        };

        // What the pixels moved over, to the lock (seg13 `151f`-`159d`).
        let over = if scroll.is_some() {
            unite(shift(device, cx, cy), shift(device, cx + ddx, cy + ddy))
        } else {
            system.client_rect(index)
        };

        system.lock_touched(Some(index), over, 0);

        let mut moved_children = None;

        if flags & SW_SCROLLCHILDREN != 0 {
            // The caret, if it is the window's and in what moving
            // (`15ab`-`1600`).
            if let Some(caret) = system.caret.caret.as_mut()
                && caret.hwnd == hwnd
            {
                let at = [
                    caret.x,
                    caret.y,
                    caret.x + caret.width,
                    caret.y + caret.height,
                ];

                if scroll.is_none() || !is_empty(intersect(at, device)) {
                    caret.x += ddx;
                    caret.y += ddy;
                }
            }

            system.scroll_children_by(index, (ddx, ddy), scroll.map(|_| shift(device, cx, cy)))?;

            if !system.windows_in(Some(index)).is_empty() {
                let style = system.shown(index).style;

                system.make_stale(hwnd, if style & WS_CLIPCHILDREN != 0 { 4 } else { 2 });
            }

            moved_children = Some((device, (ddx, ddy), (cx, cy)));
        }

        if flags & SW_INVALIDATE != 0
            && let Some(shape) = told.shape.as_ref().filter(|shape| shape.kind() > 1)
        {
            let shape = shape.offset(ox, oy);

            system.invalidate_through(
                Some(index),
                Some(&shape),
                RDW_INVALIDATE
                    | RDW_ALLCHILDREN
                    | if flags & SW_ERASE != 0 { RDW_ERASE } else { 0 },
            );
        }

        (index, caret_hidden, answer, moved_children)
    };

    if let Some((device, (ddx, ddy), (cx, cy))) = moved_children {
        // `WM_MOVE` to each child that meets the scroll rectangle moved by
        // the parent's client area's corner (`16c9`-`1742`).
        let (children, area) = {
            let system = engine.system();
            let (px, py) = system.shown(index).parent.map_or((0, 0), |parent| {
                let shown = system.shown(parent);

                (shown.left + shown.client.left, shown.top + shown.client.top)
            });
            let area = scroll.map(|_| shift(device, px + ddx, py + ddy));

            (system.windows_in(Some(index)), area)
        };

        for child in children {
            let target = {
                let system = engine.system();

                match system.windows[child].as_ref() {
                    Some(shown) => {
                        let rect = [
                            shown.left,
                            shown.top,
                            shown.left + shown.width,
                            shown.top + shown.height,
                        ];

                        if area.is_some_and(|area| is_empty(intersect(area, rect))) {
                            None
                        } else {
                            let x = shown.left + shown.client.left - cx;
                            let y = shown.top + shown.client.top - cy;

                            Some((
                                shown.hwnd,
                                (x as u32 & 0xffff) | ((y as u32 & 0xffff) << 16),
                            ))
                        }
                    }
                    None => None,
                }
            };

            if let Some((child_hwnd, lparam)) = target {
                engine
                    .send_message(child_hwnd, WM_MOVE, 0, &mut Param::Value(lparam))
                    .await?;
            }
        }
    }

    if let Some(caret) = caret_hidden {
        engine.system().show_caret_of(caret);
    }

    Ok(answer)
}

pub(super) fn scroll_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, delta, scroll, clip) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let dx = i32::from(args.signed(&system));
            let dy = i32::from(args.signed(&system));
            let scroll = read_rect(&system, args.dword(&system));
            let clip = read_rect(&system, args.dword(&system));

            (hwnd, (dx, dy), scroll, clip)
        };
        let flags = SW_SCROLLWINDOW
            | SW_INVALIDATE
            | SW_ERASE
            | if scroll.is_some() {
                0
            } else {
                SW_SCROLLCHILDREN
            };

        scroll_window_body(
            engine,
            hwnd,
            delta,
            scroll,
            clip,
            &mut Told::new(0, 0),
            flags,
        )
        .await?;
        Ok(Answer::Nothing)
    })
}

pub(super) fn scroll_window_ex(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, delta, scroll, clip, mut told, flags) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let dx = i32::from(args.signed(&system));
            let dy = i32::from(args.signed(&system));
            let scroll = read_rect(&system, args.dword(&system));
            let clip = read_rect(&system, args.dword(&system));
            let hrgn = args.word(&system);
            let far = args.dword(&system);
            let flags = args.word(&system);

            (
                hwnd,
                (dx, dy),
                scroll,
                clip,
                Told::new(far, hrgn),
                flags & (SW_SCROLLCHILDREN | SW_INVALIDATE | SW_ERASE),
            )
        };
        let answer =
            scroll_window_body(engine, hwnd, delta, scroll, clip, &mut told, flags).await?;

        Ok(Answer::Word(answer))
    })
}

/// A device context's pixels scrolled: nonzero, nought for no device
/// context.
pub(super) fn scroll_dc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let scroll = read_rect(system, args.dword(system));
    let clip = read_rect(system, args.dword(system));
    let hrgn = args.word(system);
    let far = args.dword(system);
    let mut told = Told::new(far, hrgn);
    let answer = scroll_body(
        system,
        hdc,
        (dx, dy),
        scroll,
        clip,
        &Update::None,
        &mut told,
        true,
    );

    told.write(system);
    Ok(Answer::Word(u16::from(answer != 0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rectangles_as_user_works_them() {
        assert_eq!(intersect([0, 0, 4, 4], [5, 5, 6, 6]), EMPTY);
        assert_eq!(unite(EMPTY, [1, 1, 2, 2]), [1, 1, 2, 2]);
        assert_eq!(unite([0, 0, 2, 2], [1, 1, 3, 3]), [0, 0, 3, 3]);
        // Cut only where the one spans the other the whole way across.
        assert_eq!(subtract([0, 0, 10, 10], [0, 0, 10, 4]), [0, 4, 10, 10]);
        assert_eq!(subtract([0, 0, 10, 10], [2, 2, 4, 4]), [0, 0, 10, 10]);
        assert_eq!(subtract([0, 0, 10, 10], [0, 0, 10, 10]), EMPTY);
    }
}
