//! A window moved or sized, as winbox.js's `track-loop.ts` does it: what
//! `DefWindowProc` does for `SC_MOVE` and `SC_SIZE`, from the keyboard or
//! with the mouse on the caption or the frame.
//!
//! Like a menu, it is modal: the loop takes the program's messages until it
//! ends, with Enter or the mouse's release, or Escape, which leaves the
//! window where it was.
//!
//! Measured by the `sizing` probe on four displays: from the keyboard each
//! arrow moves half of `SM_CXSIZE` or `SM_CYSIZE` -- 9 pixels, or 8 down on
//! the EGA and Hercules -- and sizing, the first arrow picks the edge and
//! the rest move it, an arrow on the other axis adding that edge. Not
//! measured: the outline drawn while the window moves. Windows' loop does
//! not dispatch a timer, so the probe cannot capture from inside it; the
//! outline here is the window's rectangle inverted, a frame's width thick,
//! and is the TypeScript engine's.

use crate::call::Stop;
use crate::engine::Engine;
use crate::handles::Object;
use crate::messages::Param;
use crate::painter::{PaintEnv, Painter};
use crate::queue::{WM_KEYDOWN, WM_KEYUP, WM_MOUSEMOVE, WM_SYSKEYDOWN, WM_SYSKEYUP};
use crate::raster_input::{
    HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT,
};

const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CXMINTRACK: i16 = 34;
const SM_CYMINTRACK: i16 = 35;

const WM_CHAR: u16 = 0x0102;
const WM_NCMOUSEMOVE: u16 = 0x00a0;
const WM_NCLBUTTONUP: u16 = 0x00a2;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;

const VK_RETURN: u16 = 0x0d;
const VK_ESCAPE: u16 = 0x1b;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOZORDER: u16 = 0x0004;
const SWP_NOACTIVATE: u16 = 0x0010;

/// How a move or a size starts: from the keyboard, or with the mouse at a
/// point of the screen -- sizing, on a part of the frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackStart {
    Keyboard { size: bool },
    Move { x: i32, y: i32 },
    Size { x: i32, y: i32, hit: u16 },
}

/// Which edges move: left, top, right, bottom.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
struct Edges {
    left: bool,
    top: bool,
    right: bool,
    bottom: bool,
}

/// Which edges a sizing hit moves.
fn edges_of(hit: u16) -> Edges {
    let (left, top, right, bottom) = match hit {
        HTLEFT => (true, false, false, false),
        HTRIGHT => (false, false, true, false),
        HTTOP => (false, true, false, false),
        HTBOTTOM => (false, false, false, true),
        HTTOPLEFT => (true, true, false, false),
        HTTOPRIGHT => (false, true, true, false),
        HTBOTTOMLEFT => (true, false, false, true),
        HTBOTTOMRIGHT => (false, false, true, true),
        _ => (false, false, false, false),
    };

    Edges {
        left,
        top,
        right,
        bottom,
    }
}

/// A move or a size under way.
struct Track {
    size: bool,
    rect: [i32; 4],
    edges: Edges,
    drawn: Option<[i32; 4]>,
    done: bool,
    cancelled: bool,
}

impl Engine {
    /// The outline, drawn by inverting: drawing it again takes it away.
    fn track_outline(&self, rect: [i32; 4]) {
        let mut system = self.system();
        let screen = system.screen_bitmap();
        let thickness = system.metric(SM_CXFRAME);
        let env = PaintEnv::new(&system);
        let painter = Painter::new(screen.clone(), 0, 0, screen.width(), screen.height(), &env);
        let [left, top, right, bottom] = rect;
        let t = thickness.min((right - left) >> 1).min((bottom - top) >> 1);

        painter.invert(left, top, right, top + t);
        painter.invert(left, bottom - t, right, bottom);
        painter.invert(left, top + t, left + t, bottom - t);
        painter.invert(right - t, top + t, right, bottom - t);
    }

    fn track_redraw(&self, track: &mut Track) {
        if let Some(drawn) = track.drawn {
            self.track_outline(drawn);
        }

        track.drawn = Some(track.rect);
        self.track_outline(track.rect);
    }

    fn track_shift(&self, track: &mut Track, dx: i32, dy: i32) {
        let edges = track.edges;
        let rect = &mut track.rect;

        if edges.left {
            rect[0] += dx;
        }

        if edges.right {
            rect[2] += dx;
        }

        if edges.top {
            rect[1] += dy;
        }

        if edges.bottom {
            rect[3] += dy;
        }

        // Sized no smaller than the least a window may be tracked to.
        if track.size {
            let (min_width, min_height) = {
                let system = self.system();

                (system.metric(SM_CXMINTRACK), system.metric(SM_CYMINTRACK))
            };

            if rect[2] - rect[0] < min_width {
                if edges.left {
                    rect[0] = rect[2] - min_width;
                } else {
                    rect[2] = rect[0] + min_width;
                }
            }

            if rect[3] - rect[1] < min_height {
                if edges.top {
                    rect[1] = rect[3] - min_height;
                } else {
                    rect[3] = rect[1] + min_height;
                }
            }
        }

        self.track_redraw(track);
    }

    fn track_key(&self, track: &mut Track, code: u16) {
        let (step_x, step_y) = {
            let system = self.system();

            (system.metric(SM_CXSIZE) >> 1, system.metric(SM_CYSIZE) >> 1)
        };

        match code {
            VK_RETURN => track.done = true,
            VK_ESCAPE => {
                track.cancelled = true;
                track.done = true;
            }
            VK_LEFT | VK_RIGHT => {
                // Sizing: the first arrow on an axis picks its edge; the
                // rest move it.
                if track.size && !track.edges.left && !track.edges.right {
                    if code == VK_LEFT {
                        track.edges.left = true;
                    } else {
                        track.edges.right = true;
                    }

                    self.track_redraw(track);
                    return;
                }

                self.track_shift(track, if code == VK_LEFT { -step_x } else { step_x }, 0);
            }
            VK_UP | VK_DOWN => {
                if track.size && !track.edges.top && !track.edges.bottom {
                    if code == VK_UP {
                        track.edges.top = true;
                    } else {
                        track.edges.bottom = true;
                    }

                    self.track_redraw(track);
                    return;
                }

                self.track_shift(track, 0, if code == VK_UP { -step_y } else { step_y });
            }
            _ => {}
        }
    }

    /// Moves or sizes a window until let go; answers whether it changed.
    #[allow(clippy::too_many_lines)]
    pub async fn track_window(&self, hwnd: u16, start: TrackStart) -> Result<bool, Stop> {
        let (index, rect, previous_capture) = {
            let mut system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(false);
            };
            let window = system.windows[index].as_ref().expect("a window");
            let rect = [
                window.left,
                window.top,
                window.left + window.width,
                window.top + window.height,
            ];
            let previous = system.capture;

            system.capture = Some(index);
            (index, rect, previous)
        };
        let original = rect;
        let (size, edges, mut last) = match start {
            TrackStart::Keyboard { size } => (
                size,
                if size {
                    Edges::default()
                } else {
                    Edges {
                        left: true,
                        top: true,
                        right: true,
                        bottom: true,
                    }
                },
                None,
            ),
            TrackStart::Move { x, y } => (
                false,
                Edges {
                    left: true,
                    top: true,
                    right: true,
                    bottom: true,
                },
                Some((x, y)),
            ),
            TrackStart::Size { x, y, hit } => (true, edges_of(hit), Some((x, y))),
        };
        let mut track = Track {
            size,
            rect,
            edges,
            drawn: None,
            done: false,
            cancelled: false,
        };

        self.track_redraw(&mut track);

        while !track.done {
            let Some(message) = self.take_message_from(true, None).await? else {
                break;
            };

            if message.message == WM_KEYDOWN || message.message == WM_SYSKEYDOWN {
                self.track_key(&mut track, message.wparam);
                continue;
            }

            // The pointer, in either form: the page posts each mouse event
            // as it happens, hit-tested then, so a release that came before
            // this loop took the capture is still the non-client message it
            // was posted as. Windows hit-tests when a message is taken, and
            // has no such case.
            let moved = message.message == WM_MOUSEMOVE || message.message == WM_NCMOUSEMOVE;
            let released = message.message == WM_LBUTTONUP || message.message == WM_NCLBUTTONUP;

            if moved || released {
                if let Some((x, y)) = last {
                    let (px, py) = (i32::from(message.pt.0), i32::from(message.pt.1));

                    self.track_shift(&mut track, px - x, py - y);
                    last = Some((px, py));
                }

                if released {
                    track.done = true;
                }

                continue;
            }

            if matches!(
                message.message,
                WM_KEYUP | WM_SYSKEYUP | WM_CHAR | WM_LBUTTONDOWN
            ) {
                continue;
            }

            let target = {
                let system = self.system();

                matches!(
                    system.handles.resolve(message.hwnd),
                    Some(Object::Window(at)) if system.windows[at].is_some()
                )
            };

            if target {
                self.send_message(
                    message.hwnd,
                    message.message,
                    message.wparam,
                    &mut Param::Value(message.lparam),
                )
                .await?;
            }
        }

        if let Some(drawn) = track.drawn {
            self.track_outline(drawn);
        }

        let place = {
            let mut system = self.system();

            system.capture = previous_capture;

            let Some(window) = system.windows[index].as_ref() else {
                return Ok(false);
            };
            let parent = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or((0, 0), |parent| {
                    (
                        parent.left + parent.client.left,
                        parent.top + parent.client.top,
                    )
                });

            (window.left, window.top, window.width, window.height, parent)
        };
        let (left, top, width, height, parent) = place;
        let last = if track.cancelled {
            original
        } else {
            track.rect
        };
        let (new_width, new_height) = (last[2] - last[0], last[3] - last[1]);
        let changed =
            last[0] != left || last[1] != top || new_width != width || new_height != height;

        // Put where it was let go as `SetWindowPos` puts it, and told so by
        // that: moved and not sized, it gets `WM_MOVE` and no `WM_SIZE`
        // (`iconclk`).
        if changed {
            let sized = new_width != width || new_height != height;

            self.position_raster(
                hwnd,
                index,
                0,
                (last[0] - parent.0) as i16,
                (last[1] - parent.1) as i16,
                new_width as i16,
                new_height as i16,
                SWP_NOZORDER | SWP_NOACTIVATE | if sized { 0 } else { SWP_NOSIZE },
            )
            .await?;
        }

        Ok(changed)
    }
}
