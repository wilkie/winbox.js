//! What a program asks of the desktop's windows beside their places: the
//! mouse's capture, the window at a point, points moved between windows,
//! and a part of a window validated.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::system::System;
use crate::windows::Placement;

const WS_DISABLED: u32 = 0x0800_0000;

impl System {
    /// Where a window's client area is on the screen; the screen's corner
    /// for the desktop or nothing.
    fn mapping_origin(&self, hwnd: u16) -> (i32, i32) {
        self.window_named(hwnd)
            .and_then(|index| self.windows[index].as_ref())
            .map_or((0, 0), |window| {
                (
                    window.left + window.client.left,
                    window.top + window.client.top,
                )
            })
    }

    /// Whether a window holds a point of the screen.
    fn holds(&self, index: usize, x: i32, y: i32) -> bool {
        self.windows[index].as_ref().is_some_and(|window| {
            x >= window.left
                && y >= window.top
                && x < window.left + window.width
                && y < window.top + window.height
        })
    }

    /// A window's children, in the desktop's order.
    fn children_of(&self, index: usize) -> Vec<usize> {
        self.z_order
            .iter()
            .copied()
            .filter(|&other| {
                self.windows[other]
                    .as_ref()
                    .is_some_and(|window| window.parent == Some(index))
            })
            .collect()
    }
}

/// The mouse captured by a window; the window that had it.
pub fn set_capture(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if !system.raster() {
        return Ok(Answer::Word(0));
    }

    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Word(0));
    };
    let was = system
        .capture
        .and_then(|capture| system.windows[capture].as_ref())
        .map_or(0, |window| window.hwnd);

    system.capture = Some(index);
    system.capture_kind = crate::mouse_scan::CaptureKind::Set;
    Ok(Answer::Word(was))
}

pub fn release_capture(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if system.raster() {
        system.capture = None;
    }

    Ok(Answer::Nothing)
}

pub fn get_capture(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.raster();

    let capture = system
        .capture
        .and_then(|capture| system.windows[capture].as_ref())
        .map_or(0, |window| window.hwnd);

    Ok(Answer::Word(capture))
}

/// Points in one window's client area moved into another's, either being
/// the screen when nought.
pub fn map_window_points(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let from = args.word(system);
    let to = args.word(system);
    let far = args.dword(system);
    let count = args.word(system);
    let (fx, fy) = system.mapping_origin(from);
    let (tx, ty) = system.mapping_origin(to);
    let (dx, dy) = (fx - tx, fy - ty);

    for index in 0..u32::from(count) {
        let at = far & 0xffff_0000 | (far.wrapping_add(index * 4) & 0xffff);
        let bytes = system.read_far(at, 4);
        let x = i32::from(u16::from_le_bytes([bytes[0], bytes[1]]));
        let y = i32::from(u16::from_le_bytes([bytes[2], bytes[3]]));
        let mut out = ((x + dx) as u16).to_le_bytes().to_vec();

        out.extend(((y + dy) as u16).to_le_bytes());
        system.write_far(at, &out);
    }

    Ok(Answer::Nothing)
}

/// The window at a point of the screen: the top-level window there, then
/// its children down as far as one holds the point -- passing over a
/// hidden one -- but not inside a disabled window, nor an icon
/// (`iconkid`); the desktop where there is none.
const BS_GROUPBOX: u32 = 7;

pub fn window_from_point(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let point = args.dword(system);
    let (x, y) = (i32::from(point as i16), i32::from((point >> 16) as i16));

    if !system.raster()
        || x < 0
        || y < 0
        || x >= i32::from(system.display.width)
        || y >= i32::from(system.display.height)
    {
        return Ok(Answer::Word(0));
    }

    let Some(mut found) = system.window_at(x, y) else {
        return Ok(Answer::Word(
            system.handles.lookup(Object::Desktop).unwrap_or(0),
        ));
    };

    while let Some(parent) = system.windows[found]
        .as_ref()
        .and_then(|window| window.parent)
    {
        found = parent;
    }

    loop {
        let window = system.windows[found].as_ref().expect("a window");

        if window.style & WS_DISABLED != 0 || window.placement == Placement::Minimized {
            break;
        }

        // A hidden child is passed over, and a control that lets the
        // mouse through: static text and a group box.
        let next = system.children_of(found).into_iter().find(|&child| {
            system.windows[child].as_ref().is_some_and(|window| {
                window.visible
                    && !window.control.as_ref().is_some_and(|control| {
                        control.class_name == "STATIC"
                            || (control.class_name == "BUTTON"
                                && control.style & 0x0f == BS_GROUPBOX)
                    })
            }) && system.holds(child, x, y)
        });

        match next {
            Some(next)
                if system.windows[next]
                    .as_ref()
                    .is_some_and(|window| window.style & WS_DISABLED == 0) =>
            {
                found = next;
            }
            _ => break,
        }
    }

    Ok(Answer::Word(
        system.windows[found]
            .as_ref()
            .map_or(0, |window| window.hwnd),
    ))
}

/// The child of a window at a point of its client area -- hidden or not --
/// or the window itself; nought outside it.
pub fn child_window_from_point(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let point = args.dword(system);
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Word(0));
    };
    let (x, y) = (i32::from(point as i16), i32::from((point >> 16) as i16));
    let window = system.windows[index].as_ref().expect("a window");

    if x < 0 || y < 0 || x >= window.client_width() || y >= window.client_height() {
        return Ok(Answer::Word(0));
    }

    let (sx, sy) = (
        window.left + window.client.left + x,
        window.top + window.client.top + y,
    );
    let child = system
        .children_of(index)
        .into_iter()
        .find(|&child| system.holds(child, sx, sy))
        .unwrap_or(index);

    Ok(Answer::Word(
        system.windows[child]
            .as_ref()
            .map_or(0, |window| window.hwnd),
    ))
}

/// A part of a window's client area validated, or all of it for none: cut
/// from what it is due to paint (`updrgn`).
pub fn validate_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Nothing);
    };

    if far == 0 {
        system.set_update_of(index, ClipRegion::EMPTY, false);
        return Ok(Answer::Nothing);
    }

    let bytes = system.read_far(far, 8);
    let side = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
    let window = system.windows[index].as_ref().expect("a window");
    let (x, y) = (
        window.left + window.client.left,
        window.top + window.client.top,
    );
    let part = ClipRegion::rect(side(0) + x, side(2) + y, side(4) + x, side(6) + y);
    let left = system.update_region(index).subtract(&part);

    system.set_update_of(index, left, false);
    Ok(Answer::Nothing)
}

impl System {
    /// A window made the child of another, or of none: it and its children
    /// taken out and put above its new parent -- at the front of its kind
    /// for none -- keeping its place in its parent's client area.
    pub fn reparent(&mut self, index: usize, parent: Option<usize>) -> Result<(), Stop> {
        let origin_of = |system: &Self, of: Option<usize>| {
            of.and_then(|of| system.windows[of].as_ref())
                .map_or((0, 0), |of| {
                    (of.left + of.client.left, of.top + of.client.top)
                })
        };
        let (was, place) = {
            let window = self.windows[index].as_ref().expect("a window");

            (
                origin_of(self, window.parent),
                (window.left, window.top, window.width, window.height),
            )
        };
        let (x, y) = (place.0 - was.0, place.1 - was.1);
        let family: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&other| self.within(other, index))
            .collect();

        self.z_order.retain(|other| !family.contains(other));
        self.windows[index].as_mut().expect("a window").parent = parent;

        let at = match parent {
            Some(parent) => self
                .z_order
                .iter()
                .position(|&other| other == parent)
                .unwrap_or(0),
            None => self.front_of(index),
        };

        self.z_order.splice(at..at, family);

        let now = origin_of(self, parent);

        self.place_window(index, now.0 + x, now.1 + y, place.2, place.3)
    }
}

/// A window made the child of another, its parent before answered.
pub fn set_parent(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let child = args.word(system);
    let parent = args.word(system);
    let Some(index) = system.window_named(child) else {
        return Ok(Answer::Word(0));
    };
    let old = system.windows[index]
        .as_ref()
        .and_then(|window| window.parent)
        .and_then(|parent| system.windows[parent].as_ref())
        .map_or(0, |window| window.hwnd);
    let parent = system.window_named(parent);

    system.reparent(index, parent)?;
    Ok(Answer::Word(old))
}

/// A window's caption drawn active or not, its activation unchanged: turned
/// from how it is drawn, or put back to its activation; whether it was drawn
/// active, as 40h. An icon's title is turned without being told.
pub fn flash_window(engine: &crate::engine::Engine, mut args: Args) -> crate::call::Later<'_> {
    Box::pin(async move {
        let (hwnd, invert, index) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let invert = args.word(&system) != 0;
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            (hwnd, invert, index)
        };
        let (minimized, lit) = {
            let system = engine.system();
            let window = system.windows[index].as_ref().expect("a window");

            (
                window.placement == Placement::Minimized,
                window.lit.unwrap_or(window.active),
            )
        };

        if minimized {
            let mut system = engine.system();
            let window = system.windows[index].as_mut().expect("a window");

            window.lit = Some(invert && !lit);

            if window.visible {
                system.paint_frame(index);
            }

            return Ok(Answer::Word(1));
        }

        let was = if lit { 0x40 } else { 0 };
        let now = if invert {
            was == 0
        } else {
            let mut system = engine.system();

            system.raster();
            system.active_top().is_some_and(|active| active == index)
        };

        engine
            .send_message(
                hwnd,
                0x0086,
                u16::from(now),
                &mut crate::messages::Param::Value(0),
            )
            .await?;
        Ok(Answer::Word(was))
    })
}

/// The system colours set, each element's from the two arrays given; then
/// everything to be drawn again, and each window at the top told
/// `WM_SYSCOLORCHANGE` (`syscol`). TRUE.
pub fn set_sys_colors(engine: &crate::engine::Engine, mut args: Args) -> crate::call::Later<'_> {
    Box::pin(async move {
        let tops = {
            let mut system = engine.system();
            let count = args.signed(&system);
            let elements = args.dword(&system);
            let values = args.dword(&system);

            for at in 0..i32::from(count).max(0) as u32 {
                let element = system.read_far(elements.wrapping_add(at * 2), 2);
                let value = system.read_far(values.wrapping_add(at * 4), 4);
                let index = usize::from(u16::from_le_bytes([element[0], element[1]]));
                let colour =
                    u32::from_le_bytes([value[0], value[1], value[2], value[3]]) & 0x00ff_ffff;

                if system.sys_colors.len() <= index {
                    system.sys_colors.resize(index + 1, None);
                }

                system.sys_colors[index] = Some(colour);
            }

            if !system.raster() {
                return Ok(Answer::Word(1));
            }

            system.repaint_all();
            system
                .z_order
                .iter()
                .filter_map(|&index| system.windows[index].as_ref())
                .filter(|window| {
                    window.parent.is_none() && window.hwnd != 0 && window.title_of.is_none()
                })
                .map(|window| window.hwnd)
                .collect::<Vec<_>>()
        };

        for hwnd in tops {
            engine
                .send_message(hwnd, 0x0015, 0, &mut crate::messages::Param::Value(0))
                .await?;
        }

        Ok(Answer::Word(1))
    })
}

/// The window made system-modal, answering the one before: nought for none
/// (`userwin`). Nothing else is made of it.
pub fn set_sys_modal_window(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let before = system.sys_modal;

    system.sys_modal = if hwnd != 0 && system.window_named(hwnd).is_some() {
        hwnd
    } else {
        0
    };

    Ok(Answer::Word(before))
}

/// The system-modal window, while it is a window; nought else.
pub fn get_sys_modal_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let current = system.sys_modal;

    Ok(Answer::Word(
        if current != 0 && system.window_named(current).is_some() {
            current
        } else {
            0
        },
    ))
}
