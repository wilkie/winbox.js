//! An MDI client's scroll bars: shown when its children reach past its
//! edges, and scrolling them -- winbox.js's `mdi-scroll.ts`.
//!
//! **Read out of `USER.EXE`** (seg15 `0276`, `053f`, `06b3`), and
//! **recorded** by `mdiscrl`, a document window moved past each edge of its
//! client, scrolled a line, a page, to a thumb position and to each end,
//! minimized and maximized:
//!
//! * The ranges and positions are the screen's coordinates. A bar's
//!   position is the client's own left or top on the screen; its range runs
//!   from where the children and the client together start to where they
//!   end, less the client's width or height.
//! * The client recalculates by itself, through a message of its own it
//!   posts when a child moves or is sized, when it is sized itself, and when
//!   a child is destroyed or the icons arranged. Not while it is scrolling,
//!   and not while a child is maximized.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::scroll_bars::{SB_BOTH, SB_HORZ, SB_VERT, ScrollState};
use crate::system::System;
use crate::windows::Placement;

const WS_BORDER: u32 = 0x0080_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;

const SM_CXVSCROLL: i16 = 2;
const SM_CYHSCROLL: i16 = 3;
const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;

const WM_HSCROLL: u16 = 0x0114;

const SB_ENDSCROLL: u16 = 8;

/// `SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE`.
const MOVED_ONLY: u16 = 0x0001 | 0x0004 | 0x0010;

/// The client's private message that recalculates its bars (seg15 `06b3`).
pub const WM_MDIRECALC: u16 = 0x10ac;

/// What the client keeps for its scroll bars.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ClientScroll {
    /// The bars it was made with: 1 vertical, 2 horizontal.
    pub bars: u8,
    /// Scrolling, or arranging: a child's move posts nothing.
    pub busy: bool,
    /// A recalculation posted and not yet made.
    pub pending: bool,
}

/// A bar's range and position as they are worked out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Range {
    min: i32,
    max: i32,
    pos: i32,
}

/// A bar given a range and a position worked out, the position kept to the
/// range or written as it is.
fn set_range(state: &mut ScrollState, range: Range, kept: bool) {
    state.min = range.min;
    state.max = range.max;
    state.pos = if kept {
        range.pos.max(range.min).min(range.max)
    } else {
        range.pos
    };
}

impl Engine {
    /// `CalcChildScroll`: the client's bars worked out from its children
    /// (seg15 `0276`).
    ///
    /// * Nothing for a minimized client, or a bar other than `SB_HORZ`,
    ///   `SB_VERT` or `SB_BOTH`.
    /// * It works on the client as if the bars it is asked about were not
    ///   there, and walks its visible children: a maximized one means no
    ///   scrolling at all; every other one's window counts towards what the
    ///   children cover, icons and their titles too, but only a window of
    ///   its own -- not an icon's title -- reaching past the client makes
    ///   scrolling needed.
    /// * Needed, the range is worked out again with a bar added each time
    ///   one becomes needed, the client losing its width or height, until
    ///   nothing changes.
    /// * If a bar comes or goes, both bars' style bits are set from the
    ///   ranges, the ranges and positions written as they are, and the frame
    ///   changed; otherwise each bar asked about is given its range and
    ///   position.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn calc_child_scroll(&self, hwnd: u16, bar: i16) -> Result<(), Stop> {
        let change = {
            let mut guard = self.system();
            let system = &mut *guard;
            let Some(client) = system.window_named(hwnd) else {
                return Ok(());
            };
            let shown = system.windows[client].as_ref().expect("a window");

            if shown.placement == Placement::Minimized {
                return Ok(());
            }

            let Ok(bar) = u16::try_from(bar) else {
                return Ok(());
            };

            if bar != SB_HORZ && bar != SB_VERT && bar != SB_BOTH {
                return Ok(());
            }

            let style = shown.style;
            let bordered = style & WS_BORDER != 0;
            let cx = system.metric(SM_CXVSCROLL)
                - if bordered {
                    system.metric(SM_CXBORDER)
                } else {
                    0
                };
            let cy = system.metric(SM_CYHSCROLL)
                - if bordered {
                    system.metric(SM_CYBORDER)
                } else {
                    0
                };
            let horizontal = bar != SB_VERT;
            let vertical = bar != SB_HORZ;
            let left = shown.left + shown.client.left;
            let top = shown.top + shown.client.top;
            let mut right = left
                + shown.client_width()
                + if vertical && style & WS_VSCROLL != 0 {
                    cx
                } else {
                    0
                };
            let mut bottom = top
                + shown.client_height()
                + if horizontal && style & WS_HSCROLL != 0 {
                    cy
                } else {
                    0
                };
            let mut extent: Option<[i32; 4]> = None;
            let mut needed = false;
            let mut maximized = false;

            for &other in &system.z_order {
                let Some(child) = system.windows[other].as_ref() else {
                    continue;
                };

                if child.parent != Some(client) || !child.visible {
                    continue;
                }

                if child.placement == Placement::Maximized {
                    maximized = true;
                    break;
                }

                let place = [
                    child.left,
                    child.top,
                    child.left + child.width,
                    child.top + child.height,
                ];

                extent = Some(extent.map_or(place, |extent| {
                    [
                        extent[0].min(place[0]),
                        extent[1].min(place[1]),
                        extent[2].max(place[2]),
                        extent[3].max(place[3]),
                    ]
                }));

                if child.title_of.is_none()
                    && (place[0] < left || place[1] < top || place[2] > right || place[3] > bottom)
                {
                    needed = true;
                }
            }

            let mut h = Range::default();
            let mut v = Range::default();

            if let Some(extent) = extent.filter(|_| needed && !maximized) {
                let mut h_added = false;
                let mut v_added = false;

                loop {
                    let rl = extent[0].min(left);
                    let rt = extent[1].min(top);
                    let rr = extent[2].max(right) - (right - left);
                    let rb = extent[3].max(bottom) - (bottom - top);
                    let mut changed = false;

                    h = Range {
                        min: rl,
                        max: rr,
                        pos: left,
                    };
                    v = Range {
                        min: rt,
                        max: rb,
                        pos: top,
                    };

                    if rt < rb && !v_added {
                        v_added = true;
                        right -= cx;
                        changed = true;
                    }

                    if rl < rr && !h_added {
                        h_added = true;
                        bottom -= cy;
                        changed = true;
                    }

                    if !changed {
                        break;
                    }
                }

                if h.min >= h.max {
                    h = Range::default();
                }

                if v.min >= v.max {
                    v = Range::default();
                }
            }

            let has_h = style & WS_HSCROLL != 0;
            let has_v = style & WS_VSCROLL != 0;
            let want_h = h.min < h.max;
            let want_v = v.min < v.max;
            let window = system.windows[client].as_mut().expect("a window");

            if (horizontal && has_h != want_h) || (vertical && has_v != want_v) {
                set_range(window.scroll_bars.horizontal(), h, false);
                set_range(window.scroll_bars.vertical(), v, false);

                Some(
                    style & !(WS_HSCROLL | WS_VSCROLL)
                        | if want_h { WS_HSCROLL } else { 0 }
                        | if want_v { WS_VSCROLL } else { 0 },
                )
            } else {
                if horizontal && has_h {
                    set_range(window.scroll_bars.horizontal(), h, true);
                }

                if vertical && has_v {
                    set_range(window.scroll_bars.vertical(), v, true);
                }

                system.paint_frame(client);
                None
            }
        };

        if let Some(style) = change {
            self.change_frame(hwnd, style).await?;
        }

        Ok(())
    }

    /// `ScrollChildren`: the client scrolled as its bar asks (seg15 `053f`).
    /// A line is `SM_CXSIZE` or `SM_CYSIZE`, a page half the client's width
    /// or height; the new position is kept to the range, and the distance
    /// moved is a multiple of 8, a part of 8 rounded away from where it was
    /// going when it is going forward and on by a whole 8 more going back.
    /// The position is set, and the children moved by the distance, kept to
    /// the range or not. `SB_ENDSCROLL` recalculates the bar;
    /// `SB_THUMBTRACK` does nothing.
    pub(crate) async fn scroll_children(
        &self,
        hwnd: u16,
        message: u16,
        code: u16,
        lparam: u32,
    ) -> Result<(), Stop> {
        let across = message == WM_HSCROLL;
        let which = if across { SB_HORZ } else { SB_VERT };

        if code == SB_ENDSCROLL {
            return self.calc_child_scroll(hwnd, which as i16).await;
        }

        let d = {
            let mut guard = self.system();
            let system = &mut *guard;
            let Some(client) = system.window_named(hwnd) else {
                return Ok(());
            };
            let line = system.metric(if across { SM_CXSIZE } else { SM_CYSIZE });
            let window = system.windows[client].as_mut().expect("a window");
            let page = if across {
                window.client_width()
            } else {
                window.client_height()
            } / 2;
            let state = if across {
                window.scroll_bars.horizontal()
            } else {
                window.scroll_bars.vertical()
            };
            let next = match code {
                0 => state.pos - line,
                1 => state.pos + line,
                2 => state.pos - page,
                3 => state.pos + page,
                4 => i32::from(lparam as u16 as i16),
                6 => state.min,
                7 => state.max,
                _ => return Ok(()),
            }
            .max(state.min)
            .min(state.max);
            let mut d = state.pos - next;

            if d % 8 != 0 {
                d = (d + if d > 0 { 8 } else { -8 }) & !7;
            }

            state.pos = (state.pos - d).max(state.min).min(state.max);
            system.paint_frame(client);
            d
        };

        if across {
            self.scroll_window_children(hwnd, d, 0).await
        } else {
            self.scroll_window_children(hwnd, 0, d).await
        }
    }

    /// A window's children moved by a distance, and the window painted
    /// again: `ScrollWindow` with neither rectangle. Documented, and not
    /// recorded: the window's pixels are painted again rather than moved.
    async fn scroll_window_children(&self, hwnd: u16, dx: i32, dy: i32) -> Result<(), Stop> {
        let (parent, children) = {
            let system = self.system();
            let Some(parent) = system.window_named(hwnd) else {
                return Ok(());
            };
            let children: Vec<u16> = system
                .z_order
                .iter()
                .filter_map(|&other| system.windows[other].as_ref())
                .filter(|child| child.parent == Some(parent) && child.hwnd != 0)
                .map(|child| child.hwnd)
                .collect();

            (parent, children)
        };

        if dx != 0 || dy != 0 {
            for child in children {
                let (index, x, y) = {
                    let system = self.system();
                    let (Some(index), Some(shown)) =
                        (system.window_named(child), system.windows[parent].as_ref())
                    else {
                        continue;
                    };
                    let window = system.windows[index].as_ref().expect("a window");

                    (
                        index,
                        window.left - shown.left - shown.client.left + dx,
                        window.top - shown.top - shown.client.top + dy,
                    )
                };

                self.position_raster(child, index, 0, x as i16, y as i16, 0, 0, MOVED_ONLY)
                    .await?;
            }
        }

        if let Some(shown) = self.system().windows[parent].as_mut() {
            shown.needs_paint = true;
            shown.needs_erase = true;
            shown.dirty = None;
        }

        Ok(())
    }

    /// The client's own message: its bars recalculated, as it was made with
    /// them. A client made with only a horizontal bar never recalculates,
    /// and its message stays due: read out, and not recorded.
    pub(crate) async fn recalc_client(&self, hwnd: u16) -> Result<(), Stop> {
        let bar = {
            let mut system = self.system();
            let Some(client) = system.mdi_mut(hwnd) else {
                return Ok(());
            };

            match client.scroll.bars {
                1 => {
                    client.scroll.pending = false;
                    SB_VERT
                }
                3 => {
                    client.scroll.pending = false;
                    SB_BOTH
                }
                _ => return Ok(()),
            }
        };

        self.calc_child_scroll(hwnd, bar as i16).await
    }
}

impl System {
    /// A recalculation posted to the client, unless it is busy or one is
    /// already due (seg15 `06b3`).
    pub(crate) fn post_recalc(&mut self, hwnd: u16) {
        let Some(client) = self.mdi_mut(hwnd) else {
            return;
        };

        if client.scroll.busy || client.scroll.pending {
            return;
        }

        client.scroll.pending = true;
        self.post_message(hwnd, WM_MDIRECALC, 0, 0);
    }
}

/// Worked out from a program's own call: the MDI client, and `SB_HORZ`,
/// `SB_VERT` or `SB_BOTH`.
pub(crate) fn calc_child_scroll(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, bar) = {
            let system = engine.system();

            (args.word(&system), args.signed(&system))
        };

        engine.calc_child_scroll(hwnd, bar).await?;
        Ok(Answer::Nothing)
    })
}

/// Scrolled from a program's own call, as the client does for its bar's
/// messages: the MDI client, `WM_HSCROLL` or `WM_VSCROLL`, the scroll
/// bar's code, and the thumb's position in the low word of the last.
pub(crate) fn scroll_children(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, code, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        engine.scroll_children(hwnd, message, code, lparam).await?;
        Ok(Answer::Nothing)
    })
}
