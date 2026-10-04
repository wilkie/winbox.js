//! A window moved, sized, shown, hidden or brought forward on the raster
//! desktop, as winbox.js's `positionRaster` does it: what `SetWindowPos`
//! does, and `MoveWindow` and `BringWindowToTop` through it; and the active
//! window asked for and set (`placement.ts`).
//!
//! A child's place is in its parent's client area, as a program gives it.
//! It is done in two halves (`defer`): `WM_WINDOWPOSCHANGING`, and
//! `WM_NCCALCSIZE` when a size is given; then the window is placed, and
//! `WM_WINDOWPOSCHANGED` follows when its place, size or showing changed,
//! from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. The window to
//! go after is told, and not followed: the window is brought to the top
//! where it is made active.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::messages::{Param, WM_NCCALCSIZE};
use crate::system::System;
use crate::windows::Placement;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOZORDER: u16 = 0x0004;
const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_SHOWWINDOW: u16 = 0x0040;
const SWP_HIDEWINDOW: u16 = 0x0080;

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

    /// The active window at the top's handle, nought for none.
    fn active_hwnd(&self) -> u16 {
        self.active_top()
            .and_then(|index| self.windows[index].as_ref())
            .map_or(0, |window| window.hwnd)
    }
}

/// The first half of a move: where the window is to go, after it was told.
struct Move {
    hwnd: u16,
    index: usize,
    after: u16,
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
        let change = self
            .position_changing(hwnd, index, after, [x, y, cx, cy].map(i32::from), flags)
            .await?;

        self.position_changed(vec![change]).await
    }

    /// The first half of a window's move: what it is told before, and where
    /// it is to go -- as the window procedure left the structure, which may
    /// move it elsewhere (Towers of the corpus does).
    async fn position_changing(
        &self,
        hwnd: u16,
        index: usize,
        after: u16,
        [x, y, mut cx, mut cy]: [i32; 4],
        flags: u16,
    ) -> Result<Move, Stop> {
        {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");

            // An icon is not held to a window's least size (`userwin`).
            if flags & SWP_NOSIZE == 0 && window.placement != Placement::Minimized {
                (cx, cy) = system.least_size_moving(window.style, cx, cy);
            }
        }

        let mut structure = Param::Struct(window_pos(hwnd, after, [x, y, cx, cy], flags));

        self.send_message(hwnd, WM_WINDOWPOSCHANGING, 0, &mut structure)
            .await?;

        let (x, y, cx, cy, flags) = match &structure {
            Param::Struct(bytes) => {
                let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
                let signed = |at: usize| i32::from(word(at) as i16);

                (signed(4), signed(6), signed(8), signed(10), word(12))
            }
            Param::Value(_) => (x, y, cx, cy, flags),
        };
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

        // Whenever a size is given, even the one the window has (`defer`).
        if flags & SWP_NOSIZE == 0 {
            self.send_message(hwnd, WM_NCCALCSIZE, 0, &mut Param::Value(0))
                .await?;
        }

        Ok(Move {
            hwnd,
            index,
            after,
            place,
            flags,
        })
    }

    /// The second half of the moves begun, each window placed and then
    /// told, in the order they were begun -- only when something changed:
    /// a window deferred to where it already was is sent no more (`defer`).
    async fn position_changed(&self, changes: Vec<Move>) -> Result<(), Stop> {
        let mut placed = Vec::with_capacity(changes.len());

        for change in changes {
            let mut system = self.system();
            let [left, top, width, height] = change.place;
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
                system.place_window(change.index, left, top, width, height)?;

                if moved
                    && system.windows[change.index]
                        .as_ref()
                        .is_some_and(|window| window.placement == Placement::Minimized)
                {
                    return Err(Stop::Unsupported("an icon moved"));
                }
            }

            let now = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible;

            if change.flags & SWP_HIDEWINDOW != 0 && now {
                system.hide(change.index);
            } else if change.flags & SWP_SHOWWINDOW != 0 && !now {
                system.show(change.index);
            } else if parent.is_none() && now && change.flags & SWP_NOACTIVATE == 0 {
                // Activated, and so brought to the top, unless asked not to be
                // (`mousemv`).
                system.show(change.index);
            }

            let showing = system.windows[change.index]
                .as_ref()
                .expect("a window")
                .visible
                != visible;

            placed.push((change, moved, resized, showing));
        }

        self.deliver_activation(None).await?;

        for (change, moved, sized, showing) in placed {
            if !moved && !sized && !showing {
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
                | if sized { 0 } else { SWP_NOSIZE };

            self.send_message(
                change.hwnd,
                WM_WINDOWPOSCHANGED,
                0,
                &mut Param::Struct(window_pos(change.hwnd, change.after, place, flags)),
            )
            .await?;
        }

        self.erase_due().await?;
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

/// A shown top-level window made the active one, brought to the top, with
/// the messages that go with it (`activate`); the window that was active.
pub fn set_active_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (previous, index) = {
            let mut system = engine.system();
            let hwnd = args.word(&system);

            system.raster();

            let previous = system.active_hwnd();
            let index = system.window_named(hwnd).filter(|&index| {
                system.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.visible && window.parent.is_none())
            });

            (previous, index)
        };

        if let Some(index) = index {
            engine.system().show(index);
            engine.deliver_activation(None).await?;
        }

        Ok(Answer::Word(previous))
    })
}
