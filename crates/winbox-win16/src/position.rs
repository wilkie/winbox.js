//! A window moved, sized, shown, hidden or brought forward on the raster
//! desktop, as winbox.js's `positionRaster` does it: what `SetWindowPos`
//! does, and `MoveWindow` and `BringWindowToTop` through it; and the active
//! window asked for and set (`placement.ts`).
//!
//! A child's place is in its parent's client area, as a program gives it.
//! It is done in two halves (`defer`): `WM_WINDOWPOSCHANGING`, and
//! `WM_NCCALCSIZE` when a size is given; then the window is placed, and
//! `WM_WINDOWPOSCHANGED` follows when its place, size or showing changed,
//! from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. Where it goes
//! in the order of windows, and what it keeps of its bits as it moves, is
//! `moved.rs`'s.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::messages::{Param, WM_NCCALCSIZE};
use crate::moved::Insert;
use crate::system::System;
use crate::windows::Placement;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
pub(crate) const SWP_NOZORDER: u16 = 0x0004;
pub(crate) const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;
const SWP_NOCOPYBITS: u16 = 0x0100;
const SWP_FRAMECHANGED: u16 = 0x0020;
const SWP_NOCLIENTSIZE: u16 = 0x0800;
const SWP_NOCLIENTMOVE: u16 = 0x1000;

const WM_WINDOWPOSCHANGING: u16 = 0x0046;
const WM_WINDOWPOSCHANGED: u16 = 0x0047;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;

const SM_CXMIN: i16 = 28;
const SM_CYMIN: i16 = 29;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

/// A `WINDOWPOS`, as it is laid out: seven words.
fn window_pos(hwnd: u16, after: u16, place: [i32; 4], flags: u16) -> Vec<u8> {
    [hwnd, after]
        .into_iter()
        .chain(place.map(|value| value as u16))
        .chain(std::iter::once(flags))
        .flat_map(u16::to_le_bytes)
        .collect()
}

impl System {
    /// A window's size held to the least it may be. **Recorded** by
    /// `minsize`: an overlapped window is at least `SM_CXMIN` by `SM_CYMIN`;
    /// a pop-up or child with a thick frame at least two frames each way as
    /// it is moved or sized; any other window any size.
    pub fn least_size_moving(&self, style: u32, cx: i32, cy: i32) -> (i32, i32) {
        if style & (WS_POPUP | WS_CHILD) == 0 {
            return (cx.max(self.metric(SM_CXMIN)), cy.max(self.metric(SM_CYMIN)));
        }

        if style & WS_THICKFRAME != 0 {
            return (
                cx.max(2 * self.metric(SM_CXFRAME)),
                cy.max(2 * self.metric(SM_CYFRAME)),
            );
        }

        (cx, cy)
    }

    /// A window's client area in its parent's, or on the screen for a
    /// window at the top.
    pub(crate) fn client_in_parent(&self, index: usize) -> [i32; 4] {
        let window = self.windows[index].as_ref().expect("a window");
        let (x, y) = window
            .parent
            .and_then(|parent| self.windows[parent].as_ref())
            .map_or((window.left, window.top), |parent| {
                (
                    window.left - parent.left - parent.client.left,
                    window.top - parent.top - parent.client.top,
                )
            });

        [
            x + window.client.left,
            y + window.client.top,
            x + window.client.right,
            y + window.client.bottom,
        ]
    }

    /// A window's frame changed where it is: `SWP_FRAMECHANGED` with no
    /// move or size (`USER.EXE` seg7 `0e8f`-`0fe6`). Its client area is
    /// laid out again for its style; what of the old client area's bits
    /// fits is kept at the new one's top left, as `WM_NCCALCSIZE` answered
    /// with nought keeps it (`0f67`-`0f84`), and the rest is due an erase
    /// and a paint. Its whole frame is due, `WM_NCPAINT` given a region of
    /// it, and its erase is due though nothing of it may be (`swpframe`):
    /// the box of what is not kept, which the erase's clip and the paint
    /// are, a rectangle where only one side grew.
    pub(crate) fn frame_changed(&mut self, index: usize) -> Result<(), Stop> {
        let (left, top, width, height, was) = {
            let window = self.windows[index].as_ref().expect("a window");

            (
                window.left,
                window.top,
                window.width,
                window.height,
                window.client,
            )
        };
        let screen = self.screen_bitmap();
        let old = [
            left + was.left,
            top + was.top,
            left + was.right,
            top + was.bottom,
        ];
        let bits: Vec<u8> = (old[1]..old[3])
            .flat_map(|y| (old[0]..old[2]).map(move |x| (x, y)))
            .map(|(x, y)| screen.index_at(x, y).unwrap_or(0))
            .collect();

        self.relocate(index, left, top, width, height)?;

        if !self.showing(index) {
            return Ok(());
        }

        self.own();

        let now = self.windows[index].as_ref().expect("a window").client;
        let new = [
            left + now.left,
            top + now.top,
            left + now.right,
            top + now.bottom,
        ];
        let kept = [
            new[0],
            new[1],
            new[2].min(new[0] + old[2] - old[0]),
            new[3].min(new[1] + old[3] - old[1]),
        ];

        if let Some(view) = self.window_part(index, 0, 0, width, height, false) {
            let across = (old[2] - old[0]).max(0);

            for y in kept[1]..kept[3] {
                for x in kept[0]..kept[2] {
                    let at = ((y - new[1]) * across + (x - new[0])) as usize;

                    view.put(x - left, y - top, bits.get(at).copied().unwrap_or(0));
                }
            }

            view.context.mark_rect(0, 0, width, height);
        }

        let lost = if kept[2] >= new[2] && kept[3] >= new[3] {
            None
        } else if kept[2] >= new[2] {
            Some([new[0], kept[3], new[2], new[3]])
        } else if kept[3] >= new[3] {
            Some([kept[2], new[1], new[2], new[3]])
        } else {
            Some(new)
        };
        let area = lost.unwrap_or([new[0], new[1], new[0], new[1]]);
        let dirty = self.dirty_box(area);
        let window = self.windows[index].as_mut().expect("a window");

        window.needs_nc_paint = true;
        window.frame_region = true;
        window.needs_erase = true;

        if let Some(lost) = lost {
            window.dirty = match (window.needs_paint, window.dirty) {
                (false, _) => Some(dirty),
                (true, None) => None,
                (true, Some(before)) => Some(crate::windows::Dirty {
                    area: [
                        before.area[0].min(lost[0]),
                        before.area[1].min(lost[1]),
                        before.area[2].max(lost[2]),
                        before.area[3].max(lost[3]),
                    ],
                    ..dirty
                }),
            };
            window.needs_paint = true;
        } else if !window.needs_paint {
            window.dirty = Some(dirty);
        }

        Ok(())
    }

    /// The active window at the top's handle, nought for none.
    pub(crate) fn active_hwnd(&self) -> u16 {
        self.active_top()
            .and_then(|index| self.windows[index].as_ref())
            .map_or(0, |window| window.hwnd)
    }
}

/// The first half of a move: where the window is to go, after it was told.
pub(crate) struct Move {
    hwnd: u16,
    index: usize,
    after: u16,
    insert: Insert,
    place: [i32; 4],
    flags: u16,
}

impl Engine {
    /// A window placed, shown, hidden or activated as `SetWindowPos` asks.
    #[allow(clippy::too_many_arguments)]
    pub async fn position_raster(
        &self,
        hwnd: u16,
        index: usize,
        after: u16,
        x: i16,
        y: i16,
        cx: i16,
        cy: i16,
        flags: u16,
    ) -> Result<(), Stop> {
        let Some(change) = self
            .position_changing(hwnd, index, after, [x, y, cx, cy].map(i32::from), flags)
            .await?
        else {
            return Ok(());
        };

        self.position_changed(vec![change]).await
    }

    /// The first half of a window's move: what it is told before, and where
    /// it is to go -- as the window procedure left the structure, which may
    /// move it elsewhere (Towers of the corpus does). None where nothing is
    /// to be done at all, and nothing is sent.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn position_changing(
        &self,
        hwnd: u16,
        index: usize,
        after: u16,
        [x, y, mut cx, mut cy]: [i32; 4],
        mut flags: u16,
    ) -> Result<Option<Move>, Stop> {
        let (after, insert) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");

            // An icon is not held to a window's least size (`userwin`).
            if flags & SWP_NOSIZE == 0 && window.placement != Placement::Minimized {
                (cx, cy) = system.least_size_moving(window.style, cx, cy);
            }

            // The window it goes after as USER works it out, told so in the
            // structure; asked to go after itself, or a child to be topmost,
            // it is sent nothing at all where nothing else is asked
            // (`swporder`).
            let activated = flags & (SWP_NOACTIVATE | SWP_HIDEWINDOW) == 0
                && (window.visible || flags & SWP_SHOWWINDOW != 0);

            if flags & SWP_NOZORDER != 0 {
                (after, Insert::Stay)
            } else if let Some(found) = system.insert_for(index, after, activated) {
                found
            } else if flags & (SWP_NOMOVE | SWP_NOSIZE) == SWP_NOMOVE | SWP_NOSIZE
                && flags & (SWP_SHOWWINDOW | SWP_HIDEWINDOW) == 0
            {
                return Ok(None);
            } else {
                flags |= SWP_NOZORDER;
                (after, Insert::Stay)
            }
        };

        let mut structure = Param::Struct(window_pos(hwnd, after, [x, y, cx, cy], flags));

        self.send_message(hwnd, WM_WINDOWPOSCHANGING, 0, &mut structure)
            .await?;

        let (asked, x, y, cx, cy, flags) = match &structure {
            Param::Struct(bytes) => {
                let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
                let signed = |at: usize| i32::from(word(at) as i16);

                (
                    word(2),
                    signed(4),
                    signed(6),
                    signed(8),
                    signed(10),
                    word(12),
                )
            }
            Param::Value(_) => (after, x, y, cx, cy, flags),
        };
        // Put elsewhere by the window procedure, it goes where it was put.
        let insert = if flags & SWP_NOZORDER != 0 {
            Insert::Stay
        } else if asked == after {
            insert
        } else {
            self.system()
                .insert_for(index, asked, false)
                .map_or(Insert::Stay, |(_, insert)| insert)
        };
        let after = asked;
        let place = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");
            let offset = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or((0, 0), |parent| {
                    (
                        parent.left + parent.client.left,
                        parent.top + parent.client.top,
                    )
                });

            [
                if flags & SWP_NOMOVE != 0 {
                    window.left
                } else {
                    x + offset.0
                },
                if flags & SWP_NOMOVE != 0 {
                    window.top
                } else {
                    y + offset.1
                },
                if flags & SWP_NOSIZE != 0 {
                    window.width
                } else {
                    cx
                },
                if flags & SWP_NOSIZE != 0 {
                    window.height
                } else {
                    cy
                },
            ]
        };

        // Whenever a size is given, even the one the window has (`defer`),
        // and whenever the frame changed (`USER.EXE` seg7 `0e8f`): with
        // `NCCALCSIZE_PARAMS`, the window's rectangle to be, the one it
        // has and its client area's, each in its parent's client area
        // (`0ea4`-`0f50`; `swpframe`). What the window procedure leaves of
        // the first is not taken: its client area is laid out as its
        // style says. Nor is the `WINDOWPOS` pointed to.
        if flags & SWP_NOSIZE == 0 || flags & SWP_FRAMECHANGED != 0 {
            let params = {
                let system = self.system();
                let window = system.windows[index].as_ref().expect("a window");
                let offset = window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                    .map_or((0, 0), |parent| {
                        (
                            parent.left + parent.client.left,
                            parent.top + parent.client.top,
                        )
                    });
                let (x, y) = (window.left - offset.0, window.top - offset.1);
                let [left, top, width, height] = place;
                let (left, top) = (left - offset.0, top - offset.1);
                let mut params: Vec<u8> = [
                    left,
                    top,
                    left + width,
                    top + height,
                    x,
                    y,
                    x + window.width,
                    y + window.height,
                    x + window.client.left,
                    y + window.client.top,
                    x + window.client.right,
                    y + window.client.bottom,
                ]
                .iter()
                .flat_map(|&value| (value as i16).to_le_bytes())
                .collect();

                params.extend(0u32.to_le_bytes());
                params
            };

            self.send_message(hwnd, WM_NCCALCSIZE, 1, &mut Param::Struct(params))
                .await?;
        }

        Ok(Some(Move {
            hwnd,
            index,
            after,
            insert,
            place,
            flags,
        }))
    }

    /// The second half of the moves begun, each window placed and then
    /// told, in the order they were begun -- only when something changed:
    /// a window deferred to where it already was is sent no more (`defer`).
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn position_changed(&self, changes: Vec<Move>) -> Result<(), Stop> {
        let mut placed = Vec::with_capacity(changes.len());

        for change in changes {
            let mut system = self.system();
            let [left, top, width, height] = change.place;
            let framed = change.flags & SWP_FRAMECHANGED != 0;
            let client_was = system.client_in_parent(change.index);
            let (moved, resized, visible, parent) = {
                let window = system.windows[change.index].as_ref().expect("a window");

                (
                    left != window.left || top != window.top,
                    width != window.width || height != window.height,
                    window.visible,
                    window.parent,
                )
            };

            if moved || resized {
                system.move_with_bits(
                    change.index,
                    change.place,
                    change.flags & SWP_NOCOPYBITS == 0,
                )?;
            } else if framed {
                system.frame_changed(change.index)?;
            }

            // Sized, its whole frame is due as a region of it (`swpframe`).
            if resized && let Some(window) = system.windows[change.index].as_mut() {
                window.frame_region = window.needs_nc_paint;
            }

            if moved || resized {
                // An icon moved keeps that place, minimized again later
                // (`iconclk`).
                if moved
                    && let Some(window) = system.windows[change.index].as_mut()
                    && window.placement == Placement::Minimized
                {
                    window.icon_place = Some((left, top));
                }
            }

            let now = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible;

            // Put where it was asked to go among its brothers (`mousemsg`,
            // `swporder`); a window shown comes to the front as it shows,
            // and one hidden stays where it is.
            let reordered = change.flags & SWP_HIDEWINDOW == 0
                && (now || change.flags & SWP_SHOWWINDOW == 0)
                && system.reorder(change.index, change.insert);

            if change.flags & SWP_HIDEWINDOW != 0 && now {
                // The active window hidden so stays active: only
                // `ShowWindow` and `DestroyWindow` ask for another
                // (`USER.EXE` seg14 `0dc2`, seg8 `0bb7`).
                system.hide_with(change.index, false);
            } else if change.flags & SWP_SHOWWINDOW != 0 && !now {
                system.show(change.index);
            } else if parent.is_none() && now && change.flags & SWP_NOACTIVATE == 0 {
                // Activated, and so brought to the top, unless asked not to be
                // (`mousemv`); only what it uncovered of itself is due.
                system.show_with(change.index, false);
            }

            let showing = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible
                != visible;

            // What of the client area stayed as it was, said so (seg7
            // `0d66`, `0fcf`, `0fe6`).
            let client_now = system.client_in_parent(change.index);
            let client = if client_now[2] - client_now[0] == client_was[2] - client_was[0]
                && client_now[3] - client_now[1] == client_was[3] - client_was[1]
            {
                SWP_NOCLIENTSIZE
            } else {
                0
            } | if client_now[..2] == client_was[..2] {
                SWP_NOCLIENTMOVE
            } else {
                0
            };

            placed.push((
                change,
                moved,
                resized,
                showing || reordered || framed,
                client,
            ));
        }

        // Made active, then erased where it is due, and only then told it
        // moved (`swpbits`, `swporder`, `showseq`).
        self.deliver_activation(None).await?;
        self.erase_due().await?;

        // A frame changed with nothing of its client area to paint is done.
        for (change, ..) in &placed {
            if change.flags & SWP_FRAMECHANGED != 0
                && let Some(window) = self.system().windows[change.index].as_mut()
                && !window.needs_paint
            {
                window.dirty = None;
            }
        }

        for (change, moved, sized, changed, client) in placed {
            if !moved && !sized && !changed {
                continue;
            }

            let place = {
                let system = self.system();
                let window = system.windows[change.index].as_ref().expect("a window");
                let (x, y) = match window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                {
                    Some(parent) => (
                        window.left - parent.left - parent.client.left,
                        window.top - parent.top - parent.client.top,
                    ),
                    None => (window.left, window.top),
                };

                [x, y, window.width, window.height]
            };
            let flags = change.flags
                | if moved { 0 } else { SWP_NOMOVE }
                | if sized { 0 } else { SWP_NOSIZE }
                | client;

            self.send_message(
                change.hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(change.hwnd, change.after, place, flags)),
            )
            .await?;
        }

        self.system().nudge()?;
        Ok(())
    }
}

/// `SetWindowPos`: FALSE for a handle that is no window of the desktop's.
pub fn set_window_pos(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, after, x, y, cx, cy, flags) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.word(&system),
            )
        };
        let Some(index) = engine.system().window_named(hwnd) else {
            return Ok(Answer::Word(0));
        };

        engine
            .position_raster(hwnd, index, after, x, y, cx, cy, flags)
            .await?;
        Ok(Answer::Word(1))
    })
}

/// `MoveWindow`: `SetWindowPos` with the place and size, and no change to
/// the order or the activation.
pub fn move_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, x, y, cx, cy) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let place = (
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
                args.signed(&system),
            );

            args.word(&system);
            (hwnd, place.0, place.1, place.2, place.3)
        };
        let Some(index) = engine.system().window_named(hwnd) else {
            return Ok(Answer::Word(0));
        };

        engine
            .position_raster(hwnd, index, 0, x, y, cx, cy, SWP_NOZORDER | SWP_NOACTIVATE)
            .await?;
        Ok(Answer::Word(1))
    })
}

/// A window brought above the others: a top-level window to the top, made
/// active with the focus; a child above its siblings, the focus left where
/// it was (`minis`).
pub fn bring_window_to_top(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());
        let (index, child) = {
            let system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            (
                index,
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_some()),
            )
        };

        if child {
            engine.system().raise(index);
        } else {
            engine
                .position_raster(hwnd, index, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
                .await?;
        }

        Ok(Answer::Word(1))
    })
}

/// The active top-level window: a document window inside one does not
/// count.
pub fn get_active_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.raster();
    Ok(Answer::Word(system.active_hwnd()))
}

/// A top-level window made the active one, brought to the top, with the
/// messages that go with it (`activate`); the window that was active.
pub fn set_active_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let hwnd = args.word(&engine.system());

        Ok(Answer::Word(engine.activate_top(hwnd).await?))
    })
}

impl Engine {
    /// `SetActiveWindow`: a top-level window made the active one, brought
    /// to the top, with the messages that go with it; the window that was
    /// active. A window hidden is made active hidden: USER asks only that it
    /// is not a child (`USER.EXE` seg1 `38c5`, `38f2`, then `3514`).
    pub(crate) async fn activate_top(&self, hwnd: u16) -> Result<u16, Stop> {
        let (previous, index) = {
            let mut system = self.system();

            system.raster();

            let previous = system.active_hwnd();
            let index = system.window_named(hwnd).filter(|&index| {
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.parent.is_none())
            });

            (previous, index)
        };

        if let Some(index) = index {
            self.system().activate(index);
            self.deliver_activation(None).await?;
        }

        Ok(previous)
    }
}

/// Whether a window of the desktop's is an icon.
pub fn is_iconic(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let placement = system
        .window_named(hwnd)
        .and_then(|index| system.windows[index].as_ref())
        .map(|window| window.placement);

    Ok(Answer::Word(u16::from(
        placement == Some(Placement::Minimized),
    )))
}

/// Whether a window of the desktop's is maximized.
pub fn is_zoomed(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let placement = system
        .window_named(hwnd)
        .and_then(|index| system.windows[index].as_ref())
        .map(|window| window.placement);

    Ok(Answer::Word(u16::from(
        placement == Some(Placement::Maximized),
    )))
}

/// A move kept: the window, the window it goes after, its place and size,
/// and the flags.
pub type Deferred = (u16, u16, [i16; 4], u16);

/// Moves kept to be made together: a handle for them.
pub fn begin_defer_window_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    system.deferred.push(Some(Vec::new()));

    let index = system.deferred.len() - 1;

    Ok(Answer::Word(
        system
            .handles
            .allocate(
                crate::handles::Kind::Atom,
                crate::handles::Object::Deferred(index),
            )
            .unwrap_or(0),
    ))
}

/// A move kept with the others; the handle, or nought for no set or a
/// handle that is no window of the desktop's.
pub fn defer_window_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let set = args.word(system);
    let hwnd = args.word(system);
    let after = args.word(system);
    let place = [
        args.signed(system),
        args.signed(system),
        args.signed(system),
        args.signed(system),
    ];
    let flags = args.word(system);
    let Some(crate::handles::Object::Deferred(index)) = system.handles.resolve(set) else {
        return Ok(Answer::Word(0));
    };

    if system.window_named(hwnd).is_none() {
        return Ok(Answer::Word(0));
    }

    if let Some(moves) = system.deferred[index].as_mut() {
        moves.push((hwnd, after, place, flags));
    }

    Ok(Answer::Word(set))
}

/// The moves kept made, each window's first half in turn, then each
/// placed and told (`defer`).
pub fn end_defer_window_pos(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let moves = {
            let mut system = engine.system();
            let set = args.word(&system);
            let Some(crate::handles::Object::Deferred(index)) = system.handles.resolve(set) else {
                return Ok(Answer::Word(0));
            };

            system.handles.free(set);
            system.deferred[index].take().unwrap_or_default()
        };
        let mut begun = Vec::with_capacity(moves.len());

        for (hwnd, after, place, flags) in moves {
            let Some(index) = engine.system().window_named(hwnd) else {
                continue;
            };

            begun.extend(
                engine
                    .position_changing(hwnd, index, after, place.map(i32::from), flags)
                    .await?,
            );
        }

        engine.position_changed(begun).await?;
        Ok(Answer::Word(1))
    })
}
