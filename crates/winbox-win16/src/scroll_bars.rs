//! Scroll bars: a window's own, the ones `WS_VSCROLL` and `WS_HSCROLL` give
//! it, and the scroll bar control -- a range and a position for each, which
//! the thumb shows, its arrows turned off and on, and a press on it
//! followed until the button is let go. winbox.js's `scroll-bars.ts` and
//! `scroll-track.ts`.
//!
//! **Read out of `USER.EXE`** (seg18 `0d67`, `0ed9`, `0f16`, `1900`):
//!
//! * A window's bars start at the range 0 to 100, at 0.
//! * A position is kept to the range, `min(max(min, pos), max)`, after
//!   every change of either; `SetScrollPos` answers the position before,
//!   and on a bar the window's style does not have stores nothing and
//!   answers 0.
//! * A range whose span does not fit a signed word, which includes a
//!   minimum above the maximum, is ignored. A range whose ends are equal
//!   takes the bar away, and any other gives the window the bar if it had
//!   none; the window is laid out again either way.
//!
//! **Recorded** by `mledit`, whose thumbs a multi-line edit control places.
//!
//! A scroll bar control, `SB_CTL`, keeps the same in itself, starting at
//! the range 0 to 0.
//!
//! What a bar looks like -- its arrows, its thumb, a part held down, the
//! dragged thumb's outline -- is the desktop's drawing, not ported yet: the
//! bar's state keeps what is held for it, and the drawing is passed over.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::queue::{Message, WM_SYSTIMER};
use crate::system::System;

pub const SB_HORZ: u16 = 0;
pub const SB_VERT: u16 = 1;
pub const SB_CTL: u16 = 2;
pub const SB_BOTH: u16 = 3;

const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_TABSTOP: u32 = 0x0001_0000;
const SBS_VERT: u32 = 0x0001;

const ESB_DISABLE_BOTH: u16 = 3;

const SW_HIDE: u16 = 0;
const SW_SHOW: u16 = 5;

const WM_SIZE: u16 = 0x0005;
const WM_WINDOWPOSCHANGING: u16 = 0x0046;
const WM_WINDOWPOSCHANGED: u16 = 0x0047;
const WM_NCCALCSIZE: u16 = 0x0083;
const WM_HSCROLL: u16 = 0x0114;
const WM_VSCROLL: u16 = 0x0115;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_NCLBUTTONUP: u16 = 0x00a2;

const SWP_NOSIZE: u16 = 0x0001;
const SWP_NOMOVE: u16 = 0x0002;
const SWP_NOZORDER: u16 = 0x0004;
const SWP_NOACTIVATE: u16 = 0x0010;
const SWP_FRAMECHANGED: u16 = 0x0020;

const SB_THUMBPOSITION: u16 = 4;
const SB_THUMBTRACK: u16 = 5;
const SB_ENDSCROLL: u16 = 8;

const HTHSCROLL: u16 = 6;

const SM_CXVSCROLL: i16 = 2;
const SM_CYHSCROLL: i16 = 3;
const SM_CYVTHUMB: i16 = 9;
const SM_CXHTHUMB: i16 = 10;
const SM_CYVSCROLL: i16 = 20;
const SM_CXHSCROLL: i16 = 21;

/// The system timer that repeats a part held down.
const REPEAT_TIMER: u16 = 0xfffe;
const FIRST_DELAY: u16 = 200;
const REPEAT_DELAY: u16 = 50;

/// A scroll bar's range and position, and its arrows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollState {
    pub min: i32,
    pub max: i32,
    pub pos: i32,
    /// The arrows turned off: 1 the top or left, 2 the bottom or right.
    pub flags: u16,
    /// The part held down while a press is followed, for the drawing.
    pub track: Option<ScrollTrack>,
}

impl ScrollState {
    fn new(max: i32, flags: u16) -> Self {
        Self {
            min: 0,
            max,
            pos: 0,
            flags,
            track: None,
        }
    }

    fn clamp(&mut self) {
        self.pos = self.pos.max(self.min).min(self.max);
    }
}

/// The part of a bar held down: 0 and 1 the arrows, 2 and 3 the pages
/// before and after the thumb, 4 the thumb; its run along the bar; whether
/// it is drawn pressed; and a dragged thumb's outline, where it is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollTrack {
    pub part: u16,
    pub start: i32,
    pub end: i32,
    pub pressed: bool,
    pub outline: Option<i32>,
}

/// A window's own bars, each made with the range 0 to 100 at 0 the first
/// time it is asked for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WindowScroll {
    pub vertical: Option<ScrollState>,
    pub horizontal: Option<ScrollState>,
}

impl WindowScroll {
    pub fn vertical(&mut self) -> &mut ScrollState {
        self.vertical
            .get_or_insert_with(|| ScrollState::new(100, 0))
    }

    pub fn horizontal(&mut self) -> &mut ScrollState {
        self.horizontal
            .get_or_insert_with(|| ScrollState::new(100, 0))
    }

    fn bar(&mut self, bar: u16) -> Option<&mut ScrollState> {
        match bar {
            SB_HORZ => Some(self.horizontal()),
            SB_VERT => Some(self.vertical()),
            _ => None,
        }
    }
}

/// Where the parts of a bar are along it, as the desktop lays them out
/// (`painter.ts`'s `scrollGeometry`): an arrow at each end, as long as the
/// driver's arrow bitmap but no more than half the bar less a border; the
/// thumb at the position's share of the room the track leaves it, rounded
/// as `MulDiv` rounds. None for a bar too short to have arrows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScrollGeometry {
    pub border: i32,
    pub arrow: i32,
    pub thumb: i32,
    pub room: i32,
    pub arrow_end: i32,
    pub down_start: i32,
    pub thumb_top: i32,
    /// Whether the thumb shows: a track at least as long as it.
    pub shows: bool,
}

impl System {
    pub fn scroll_geometry(
        &self,
        length: i32,
        vertical: bool,
        state: &ScrollState,
    ) -> Option<ScrollGeometry> {
        let border = 1;
        let half = (length >> 1) - border;

        if half <= 0 {
            return None;
        }

        let bitmap = self.metric(if vertical { SM_CYVSCROLL } else { SM_CXHSCROLL });
        let arrow = half.min(bitmap);
        let thumb = self.metric(if vertical { SM_CYVTHUMB } else { SM_CXHTHUMB });
        let room = length - 2 * arrow - thumb + 2 * border;
        let span = state.max - state.min;
        let offset = if span == 0 {
            state.pos - state.min
        } else {
            ((state.pos - state.min) * room + (span >> 1)).div_euclid(span)
        };

        Some(ScrollGeometry {
            border,
            arrow,
            thumb,
            room,
            arrow_end: arrow,
            down_start: length - arrow,
            thumb_top: arrow - border + offset,
            shows: length - 2 * arrow >= thumb,
        })
    }

    /// Where a window's own bar is in it (`scrollBarRect`): beside its
    /// client area, over the frame's line where it has one.
    pub fn scroll_bar_rect(&self, index: usize, vertical: bool) -> [i32; 4] {
        let client = self.control_window(index).client;
        let overlap = i32::from(client.left > 0 || client.top > 0);

        if vertical {
            [
                client.right,
                client.top - overlap,
                client.right + self.metric(SM_CXVSCROLL),
                client.bottom + 1,
            ]
        } else {
            [
                client.left - overlap,
                client.bottom,
                client.right + 1,
                client.bottom + self.metric(SM_CYHSCROLL),
            ]
        }
    }

    /// A scroll bar control's own state, made the first time; made
    /// disabled, it is made with both arrows off (seg18 `0951`).
    fn control_scroll(&mut self, index: usize) -> Option<&mut ScrollState> {
        let window = self.windows[index].as_mut()?;
        let disabled = window.style & WS_DISABLED != 0;
        let control = window.control.as_mut()?;

        if control.class_name != "SCROLLBAR" {
            return None;
        }

        Some(
            control
                .scroll
                .get_or_insert_with(|| ScrollState::new(0, if disabled { 3 } else { 0 })),
        )
    }

    /// A bar's state: a window's own, made as it is asked for, or a
    /// control's.
    fn scroll_state(&mut self, hwnd: u16, bar: u16) -> Option<&mut ScrollState> {
        let index = self.window_named(hwnd)?;

        if bar == SB_CTL {
            return self.control_scroll(index);
        }

        self.windows[index].as_mut()?.scroll_bars.bar(bar)
    }

    /// A bar drawn again: a control painted whole, a window's frame.
    fn redraw_scroll(&mut self, hwnd: u16, bar: u16) {
        let Some(index) = self.window_named(hwnd) else {
            return;
        };

        if bar == SB_CTL {
            let window = self.control_window_mut(index);

            window.needs_erase = true;
            window.needs_paint = true;
            self.repaint_control(index);
        } else {
            self.paint_frame(index);
        }
    }

    /// Sets a scroll bar's position, kept within its range; answers the
    /// position before.
    pub fn set_scroll_pos(&mut self, hwnd: u16, bar: u16, pos: u16, redraw: bool) -> i32 {
        let Some(index) = self.window_named(hwnd) else {
            return 0;
        };
        let style = self.control_window(index).style;

        if bar != SB_CTL && style & style_bit(bar) == 0 {
            return 0;
        }

        let Some(state) = self.scroll_state(hwnd, bar) else {
            return 0;
        };
        let was = state.pos;

        state.pos = i32::from(pos as i16);
        state.clamp();

        if redraw {
            self.redraw_scroll(hwnd, bar);
        }

        was
    }

    /// A scroll bar control's arrows, set by its `WM_ENABLE`: all off when
    /// disabled, all on when enabled (`USER.EXE` seg18 `0a67`).
    pub(crate) fn enable_scroll_control(&mut self, hwnd: u16, enabled: bool) {
        let Some(index) = self.window_named(hwnd) else {
            return;
        };

        if let Some(state) = self.control_scroll(index) {
            state.flags = if enabled { 0 } else { 3 };
            self.redraw_scroll(hwnd, SB_CTL);
        }
    }
}

fn style_bit(bar: u16) -> u32 {
    if bar == SB_VERT {
        WS_VSCROLL
    } else {
        WS_HSCROLL
    }
}

/// `MulDiv`, its arguments as words: the product over the divisor, rounded
/// half away from nought, held to sixteen bits signed; the largest of its
/// sign for nought.
fn mul_div(multiplicand: i32, multiplier: i32, divisor: i32) -> i32 {
    let sign = |value: i32| i32::from(value as i16);
    let product = f64::from(sign(multiplicand)) * f64::from(sign(multiplier));
    let divisor = sign(divisor);

    if divisor == 0 {
        return if product < 0.0 { -32768 } else { 32767 };
    }

    let exact = product / f64::from(divisor);

    ((exact.signum() * exact.abs().round()) as i32).clamp(-32768, 32767)
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "SetScrollPos" => Implementation::Sync(set_scroll_pos),
        "GetScrollPos" => Implementation::Sync(get_scroll_pos),
        "SetScrollRange" => Implementation::Async(set_scroll_range),
        "GetScrollRange" => Implementation::Sync(get_scroll_range),
        "ShowScrollBar" => Implementation::Async(show_scroll_bar),
        "EnableScrollBar" => Implementation::Async(enable_scroll_bar),
        _ => return None,
    })
}

fn set_scroll_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let bar = args.word(system);
    let pos = args.word(system);
    let redraw = args.word(system) != 0;

    Ok(Answer::Word(
        system.set_scroll_pos(hwnd, bar, pos, redraw) as u16
    ))
}

fn get_scroll_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let bar = args.word(system);
    let pos = system.scroll_state(hwnd, bar).map_or(0, |state| state.pos);

    Ok(Answer::Word(pos as u16))
}

/// A scroll bar's range, into two integers a program points to.
fn get_scroll_range(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let bar = args.word(system);
    let min_far = args.dword(system);
    let max_far = args.dword(system);
    let (min, max) = system
        .scroll_state(hwnd, bar)
        .map_or((0, 0), |state| (state.min, state.max));

    for (far, value) in [(min_far, min), (max_far, max)] {
        if far != 0 {
            system.write_far(far, &(value as u16).to_le_bytes());
        }
    }

    Ok(Answer::Nothing)
}

/// Sets a scroll bar's range, its position kept within it; equal ends take
/// the bar away and others bring it. **Recorded** by `showsb`: a window's
/// bar comes and goes whether or not it was asked to redraw, with the
/// messages of a frame that changed (`change_frame`).
fn set_scroll_range(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, bar, min, max, redraw) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                i32::from(args.signed(&system)),
                i32::from(args.signed(&system)),
                args.word(&system) != 0,
            )
        };
        let change = {
            let mut system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Nothing);
            };
            let Some(state) = system.scroll_state(hwnd, bar) else {
                return Ok(Answer::Nothing);
            };

            if (max - min) & 0xffff > 0x7fff {
                return Ok(Answer::Nothing);
            }

            state.min = min;
            state.max = max;
            state.clamp();

            if bar == SB_CTL {
                if redraw {
                    system.redraw_scroll(hwnd, bar);
                }

                return Ok(Answer::Nothing);
            }

            let style = system.control_window(index).style;
            let had = style & style_bit(bar) != 0;
            let has = min != max;

            if had == has {
                if redraw {
                    system.redraw_scroll(hwnd, SB_VERT);
                }

                None
            } else if has {
                Some(style | style_bit(bar))
            } else {
                Some(style & !style_bit(bar))
            }
        };

        if let Some(style) = change {
            engine.change_frame(hwnd, style).await?;
        }

        Ok(Answer::Nothing)
    })
}

/// Shows or hides a window's own scroll bars, `SB_HORZ`, `SB_VERT` or
/// both, `SB_BOTH`; or with `SB_CTL`, a scroll bar control itself, as
/// `ShowWindow` does. It answers nothing.
///
/// **Recorded** by `showsb`: a window's bar shown or hidden is its style's
/// bit set or cleared, and its frame laid out again with the messages of
/// `change_frame`; asking for what it already has sends nothing. The range
/// and position are kept, and the thumb shows them again.
fn show_scroll_bar(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, bar, show) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system) != 0,
            )
        };
        let Some((index, style)) = ({
            let system = engine.system();

            system
                .window_named(hwnd)
                .map(|index| (index, system.control_window(index).style))
        }) else {
            return Ok(Answer::Nothing);
        };

        if bar == SB_CTL {
            engine
                .show_raster(
                    hwnd,
                    index,
                    if show { SW_SHOW } else { SW_HIDE },
                    true,
                    false,
                )
                .await?;
            return Ok(Answer::Nothing);
        }

        let bits = match bar {
            SB_BOTH => WS_VSCROLL | WS_HSCROLL,
            SB_VERT => WS_VSCROLL,
            _ => WS_HSCROLL,
        };

        engine
            .change_frame(hwnd, if show { style | bits } else { style & !bits })
            .await?;
        Ok(Answer::Nothing)
    })
}

/// Turns a scroll bar's arrows off and on (`USER.EXE` seg18 `017c`,
/// `0074`): `wArrows` 1 the top or left, 2 the bottom or right, 3 both, 0
/// neither.
///
/// A window's own bars keep the arrows turned off, and answer whether any
/// changed; a bar that shows is drawn again at once.
///
/// A scroll bar control with both arrows off is a disabled window. Asked
/// for what it has, it answers 0. Asked for both off -- or for the one
/// arrow that makes both -- it is disabled with `EnableWindow`, and all on
/// again from both off, enabled; its `WM_ENABLE` then sets the arrows to all
/// off or all on (seg18 `0a67`). The answer is then made from what
/// `EnableWindow` answered, whether it had been disabled: if it had, 1 for
/// enabled now; if not, the disabled style bit as a byte, 8. Any other
/// change turns the arrows off one by one, or all on, and answers 1 (seg18
/// `0031`); an arrow off stays off until all are turned on. **Recorded** by
/// `noscroll`: 1, 8, 0, 0 and 1 for the top arrow, the bottom, both, both
/// again and neither.
fn enable_scroll_bar(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, bar, arrows) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.word(&system))
        };
        let enable = {
            let mut system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(Answer::Word(0));
            };

            if bar > 3 || arrows & !3 != 0 {
                return Ok(Answer::Word(0));
            }

            if bar == SB_CTL {
                let Some(state) = system.control_scroll(index) else {
                    return Ok(Answer::Word(0));
                };
                let old = state.flags & 3;

                if old == arrows {
                    return Ok(Answer::Word(0));
                }

                let disable = arrows == ESB_DISABLE_BOTH || (arrows != 0 && (old | arrows) == 3);
                let enable = arrows == 0 && old == 3;

                if !disable && !enable {
                    state.flags = if arrows == 0 { 0 } else { old | arrows };
                    system.redraw_scroll(hwnd, SB_CTL);
                    return Ok(Answer::Word(1));
                }

                Some((index, enable))
            } else {
                let mut changed = false;

                for each in [SB_HORZ, SB_VERT] {
                    if bar != each && bar != SB_BOTH {
                        continue;
                    }

                    let state = system
                        .control_window_mut(index)
                        .scroll_bars
                        .bar(each)
                        .expect("a window's bar");
                    let flags = if arrows == 0 { 0 } else { state.flags | arrows };

                    if flags != state.flags {
                        state.flags = flags;
                        changed = true;
                    }
                }

                if changed && system.control_window(index).style & (WS_VSCROLL | WS_HSCROLL) != 0 {
                    system.redraw_scroll(hwnd, SB_VERT);
                }

                return Ok(Answer::Word(u16::from(changed)));
            }
        };
        let Some((index, enable)) = enable else {
            return Ok(Answer::Word(0));
        };
        let was = engine.enable_window(hwnd, enable).await?;
        let disabled = engine.system().windows[index]
            .as_ref()
            .is_some_and(|window| window.style & WS_DISABLED != 0);

        Ok(Answer::Word(match (was, disabled) {
            (true, true) | (false, false) => 0,
            (true, false) => 1,
            (false, true) => 8,
        }))
    })
}

/// Whether a message is the mouse's, client or not.
fn is_mouse(message: u16) -> bool {
    (0x0200..=0x0209).contains(&message) || (0x00a0..=0x00a9).contains(&message)
}

fn is_key(message: u16) -> bool {
    (0x0100..=0x0108).contains(&message)
}

fn is_release(message: u16) -> bool {
    message == WM_LBUTTONUP || message == WM_NCLBUTTONUP
}

/// What a press on a bar is followed with: the window, which bar, where
/// it lies, and who is told.
#[derive(Debug, Clone, Copy)]
struct Press {
    index: usize,
    control: bool,
    vertical: bool,
    bar: u16,
    notify: u16,
    ctl_hwnd: u16,
    rect: [i32; 4],
    origin: (i32, i32),
    thickness: i32,
}

impl Press {
    fn along(&self, x: i32, y: i32) -> i32 {
        if self.vertical {
            y - self.origin.1 - self.rect[1]
        } else {
            x - self.origin.0 - self.rect[0]
        }
    }

    fn across(&self, x: i32, y: i32) -> i32 {
        if self.vertical {
            x - self.origin.0 - self.rect[0]
        } else {
            y - self.origin.1 - self.rect[1]
        }
    }
}

impl Engine {
    /// A window's frame changed where it is: a scroll bar of its own added
    /// or taken away, by `ShowScrollBar` or `SetScrollRange`. **Recorded** by
    /// `showsb`: the window is sent `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE`,
    /// `WM_WINDOWPOSCHANGED` and `WM_SIZE`, in that order and nothing else,
    /// and then painted: its frame by `WM_NCPAINT` from `BeginPaint`, and its
    /// background erased only where a bar went away and left client area
    /// that had not been. A style that does not change sends nothing.
    pub(crate) async fn change_frame(&self, hwnd: u16, style: u32) -> Result<(), Stop> {
        let (index, lost, position) = {
            let system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let shown = system.control_window(index);

            if style == shown.style {
                return Ok(());
            }

            let lost = shown.style & !style & (WS_VSCROLL | WS_HSCROLL) != 0;
            let (x, y) = match shown
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
            {
                Some(parent) => (
                    shown.left - parent.left - parent.client.left,
                    shown.top - parent.top - parent.client.top,
                ),
                None => (shown.left, shown.top),
            };
            let words = [
                hwnd,
                0,
                x as u16,
                y as u16,
                shown.width as u16,
                shown.height as u16,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            ];
            let position: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();

            (index, lost, position)
        };

        self.send_message(
            hwnd,
            WM_WINDOWPOSCHANGING,
            0,
            &mut Param::Struct(position.clone()),
        )
        .await?;

        // Laid out again, which is not itself a reason to erase.
        let erasing = {
            let mut system = self.system();
            let window = system.control_window_mut(index);
            let erasing = window.needs_erase;
            let (left, top, width, height) = (window.left, window.top, window.width, window.height);

            window.style = style;
            system.place_window(index, left, top, width, height)?;
            erasing
        };

        self.send_message(hwnd, WM_NCCALCSIZE, 0, &mut Param::Value(0))
            .await?;
        self.send_message(hwnd, WM_WINDOWPOSCHANGED, 0, &mut Param::Struct(position))
            .await?;

        let size = {
            let system = self.system();
            let window = system.control_window(index);

            (window.client_width() as u32 & 0xffff) | (window.client_height() as u32 & 0xffff) << 16
        };

        self.send_message(hwnd, WM_SIZE, 0, &mut Param::Value(size))
            .await?;

        if let Some(window) = self.system().windows[index].as_mut() {
            window.needs_paint = true;
            window.dirty = None;
            window.needs_nc_paint = true;
            window.needs_erase = erasing || lost;
        }

        Ok(())
    }

    /// The part held drawn pressed or not: an arrow drawn again, a page
    /// inverted -- which is the desktop's drawing; the state keeps it.
    fn show_track(&self, press: &Press, track: &mut ScrollTrack, pressed: bool) {
        if pressed == track.pressed {
            return;
        }

        track.pressed = pressed;
        self.keep_track(press, Some(*track));

        if track.part <= 1 {
            let mut system = self.system();

            if press.control {
                system.repaint_control(press.index);
            } else {
                system.paint_frame(press.index);
            }
        }
    }

    /// The part held kept in the bar's state, for its drawing.
    fn keep_track(&self, press: &Press, track: Option<ScrollTrack>) {
        let mut system = self.system();
        let state = if press.control {
            system.control_scroll(press.index)
        } else {
            system.windows[press.index]
                .as_mut()
                .and_then(|window| window.scroll_bars.bar(press.bar))
        };

        if let Some(state) = state {
            state.track = track;
        }
    }

    /// The bar's parent or window told what is being done, `lParam` the
    /// control's window in its high word.
    async fn send_scroll(&self, press: &Press, code: u16, pos: i32) -> Result<(), Stop> {
        let message = if press.vertical {
            WM_VSCROLL
        } else {
            WM_HSCROLL
        };
        let lparam = u32::from(press.ctl_hwnd) << 16 | (pos as u32 & 0xffff);

        self.send_message(press.notify, message, code, &mut Param::Value(lparam))
            .await?;
        Ok(())
    }

    /// The repeat timer set, a system timer.
    fn arm_repeat(&self, hwnd: u16, delay: u16) {
        let mut system = self.system();

        system.set_timer(hwnd, REPEAT_TIMER, delay, 0);

        if let Some(timer) = system
            .timers
            .iter_mut()
            .find(|timer| timer.hwnd == hwnd && timer.id == REPEAT_TIMER)
        {
            timer.message = WM_SYSTIMER;
        }
    }

    /// Anything else that comes while a press is followed, handed on as a
    /// program's loop would.
    async fn dispatch_during(&self, message: &Message) -> Result<(), Stop> {
        self.system().translate(message);
        self.dispatch(message).await?;
        Ok(())
    }

    /// A press on a scroll bar followed until the button is let go: what
    /// `DefWindowProc` does for `SC_VSCROLL` and `SC_HSCROLL`, which a press
    /// on a window's own bar becomes, and what a scroll bar control does
    /// with a press on itself. `hit` is `HTVSCROLL` or `HTHSCROLL` for a
    /// window's own bar and 0 for a control; `x, y` on the screen.
    ///
    /// **Read out of `USER.EXE`** seg18 `1636`:
    ///
    /// * **Where the press is.** On an arrow, `SB_LINEUP` or `SB_LINEDOWN`,
    ///   unless the arrow is turned off; between the first arrow and the
    ///   thumb, `SB_PAGEUP`; after the thumb, `SB_PAGEDOWN`; on the thumb, a
    ///   drag, if the track is longer than the thumb. A bar with both arrows
    ///   off takes no press. The part held is its run along the bar, a
    ///   border in each way: an arrow's, or a page's from the arrow to the
    ///   thumb.
    /// * **A part held.** It is drawn pressed and its code is sent:
    ///   `WM_VSCROLL` or `WM_HSCROLL`, to the window for its own bar and to
    ///   the control's parent for a control, `lParam` the control's window
    ///   in its high word. A system timer, 0xFFFE, sends it again after 200
    ///   milliseconds and then every 50, while the pointer is on the part
    ///   (seg18 `110c`). The pressed look follows the pointer off the part
    ///   and back, and coming back sends the code again at once.
    /// * **The thumb dragged.** `SB_THUMBTRACK` with the position at once,
    ///   then whenever the position under the pointer changes; the thumb's
    ///   outline follows the pointer, and goes back to where the thumb was
    ///   when the pointer leaves the bar, widened by four borders across and
    ///   one along (seg18 `14e5`). The position is `min + (max - min) * at /
    ///   room`, from where the outline is along the track. Let go,
    ///   `SB_THUMBPOSITION` with the last position. The bar itself moves
    ///   only when the program sets it.
    /// * **Let go.** `SB_ENDSCROLL`, after the part is drawn as it was.
    ///
    /// While it lasts, the mouse is the bar's, keys for the window are
    /// dropped, and everything else is dispatched (seg18 `159c`).
    ///
    /// **Recorded** by `sbtrack` on four displays: a control and a
    /// window's own bar pressed on each part and dragged, what the parent is
    /// sent, and the bar pressed and after.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn track_scroll_bar(
        &self,
        hwnd: u16,
        hit: u16,
        x: i32,
        y: i32,
    ) -> Result<(), Stop> {
        let (press, state) = {
            let mut system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let control = hit == 0;
            let window = system.control_window(index);
            let vertical = if control {
                window.style & SBS_VERT != 0
            } else {
                hit != HTHSCROLL
            };
            let bar = if control {
                SB_CTL
            } else if vertical {
                SB_VERT
            } else {
                SB_HORZ
            };
            let notify = if control {
                window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                    .map_or(0, |parent| parent.hwnd)
            } else {
                hwnd
            };
            let origin = (window.left, window.top);
            let rect = if control {
                let client = window.client;

                [client.left, client.top, client.right, client.bottom]
            } else {
                system.scroll_bar_rect(index, vertical)
            };
            let state = if control {
                system
                    .control_window(index)
                    .control
                    .as_ref()
                    .and_then(|control| control.scroll)
            } else {
                system
                    .control_window_mut(index)
                    .scroll_bars
                    .bar(bar)
                    .copied()
            };
            let Some(state) = state else {
                return Ok(());
            };
            let thickness = if vertical {
                rect[2] - rect[0]
            } else {
                rect[3] - rect[1]
            };

            (
                Press {
                    index,
                    control,
                    vertical,
                    bar,
                    notify,
                    ctl_hwnd: if control { hwnd } else { 0 },
                    rect,
                    origin,
                    thickness,
                },
                state,
            )
        };
        let flags = state.flags & 3;

        if flags == 3 {
            return Ok(());
        }

        let length = if press.vertical {
            press.rect[3] - press.rect[1]
        } else {
            press.rect[2] - press.rect[0]
        };
        let Some(geometry) = self
            .system()
            .scroll_geometry(length, press.vertical, &state)
        else {
            return Ok(());
        };
        let p = press.along(x, y);
        let ScrollGeometry {
            arrow_end,
            down_start,
            thumb_top,
            thumb,
            border,
            ..
        } = geometry;
        let part = |part, start, end, pressed| ScrollTrack {
            part,
            start,
            end,
            pressed,
            outline: None,
        };
        let mut track = if p < arrow_end {
            if flags & 1 != 0 {
                return Ok(());
            }

            part(0, border, arrow_end - border, false)
        } else if p >= down_start {
            if flags & 2 != 0 {
                return Ok(());
            }

            part(1, down_start + border, length - border, false)
        } else if p < thumb_top {
            part(2, arrow_end, thumb_top, false)
        } else if p < thumb_top + thumb {
            if down_start - arrow_end <= thumb {
                return Ok(());
            }

            part(4, thumb_top, thumb_top + thumb, true)
        } else {
            part(3, thumb_top + thumb, down_start, false)
        };
        let inside = |track: &ScrollTrack, x: i32, y: i32| {
            let along = press.along(x, y);
            let across = press.across(x, y);

            along >= track.start
                && along < track.end
                && across >= border
                && across < press.thickness - border
        };

        self.keep_track(&press, Some(track));

        let previous = self.system().capture.replace(press.index);
        let mut last = state.pos;

        if track.part <= 3 {
            // Pressed, sent, and repeated while held.
            let mut delay = FIRST_DELAY;

            self.show_track(&press, &mut track, true);
            self.arm_repeat(hwnd, delay);
            self.send_scroll(&press, track.part, 0).await?;

            loop {
                let Some(message) = self.take_message().await? else {
                    break;
                };
                let (px, py) = (i32::from(message.pt.0), i32::from(message.pt.1));

                if message.message == WM_SYSTIMER
                    && message.hwnd == hwnd
                    && message.wparam == REPEAT_TIMER
                {
                    self.system().kill_timer(hwnd, REPEAT_TIMER);
                    delay = REPEAT_DELAY;

                    let now = inside(&track, px, py);

                    self.show_track(&press, &mut track, now);

                    if now {
                        self.arm_repeat(hwnd, delay);
                        self.send_scroll(&press, track.part, 0).await?;
                    }

                    continue;
                }

                if is_mouse(message.message) {
                    let now = inside(&track, px, py);

                    if now != track.pressed {
                        self.show_track(&press, &mut track, now);

                        if now {
                            self.arm_repeat(hwnd, delay);
                            self.send_scroll(&press, track.part, 0).await?;
                        }
                    }

                    if is_release(message.message) {
                        break;
                    }

                    continue;
                }

                if is_key(message.message) {
                    continue;
                }

                self.dispatch_during(&message).await?;
            }

            self.system().kill_timer(hwnd, REPEAT_TIMER);
            self.show_track(&press, &mut track, false);
        } else {
            // The thumb dragged: its outline follows the pointer along the
            // track.
            let start = arrow_end - border;
            let room = geometry.room;
            let grab = thumb_top - p;
            let [x0, y0, x1, y1] = press.rect;
            let snap = [x0 - 4 * border, y0 - border, x1 + 4 * border, y1 + border];
            let mut at = thumb_top;

            // The position first, then the outline: the parent's first
            // `SB_THUMBTRACK` finds the bar as it was (**recorded** by
            // `sbtrack`).
            self.send_scroll(&press, SB_THUMBTRACK, last).await?;
            track.outline = Some(at);
            self.keep_track(&press, Some(track));

            loop {
                let Some(message) = self.take_message().await? else {
                    break;
                };
                let (px, py) = (i32::from(message.pt.0), i32::from(message.pt.1));

                if is_mouse(message.message) {
                    let wx = px - press.origin.0;
                    let wy = py - press.origin.1;
                    let on_bar = wx >= snap[0] && wx < snap[2] && wy >= snap[1] && wy < snap[3];
                    let next = if on_bar {
                        (press.along(px, py) + grab).max(start).min(start + room)
                    } else {
                        thumb_top
                    };

                    if next != at {
                        at = next;
                        track.outline = Some(at);
                        self.keep_track(&press, Some(track));

                        let (min, max) = {
                            let mut system = self.system();
                            let state = if press.control {
                                system.control_scroll(press.index).copied()
                            } else {
                                system.windows[press.index]
                                    .as_mut()
                                    .and_then(|window| window.scroll_bars.bar(press.bar))
                                    .copied()
                            };

                            state.map_or((0, 0), |state| (state.min, state.max))
                        };
                        let pos = if at < start {
                            min
                        } else if at >= start + room {
                            max
                        } else {
                            min + mul_div(max - min, at - start, room)
                        };

                        if pos != last {
                            last = pos;
                            self.send_scroll(&press, SB_THUMBTRACK, pos).await?;
                        }
                    }

                    if is_release(message.message) {
                        break;
                    }

                    continue;
                }

                if is_key(message.message) {
                    continue;
                }

                self.dispatch_during(&message).await?;
            }

            track.outline = None;
            self.keep_track(&press, Some(track));
            self.send_scroll(&press, SB_THUMBPOSITION, last).await?;
        }

        self.keep_track(&press, None);
        self.system().capture = previous;
        self.send_scroll(&press, SB_ENDSCROLL, 0).await
    }

    /// A press on a scroll bar control, once or twice alike: the focus, if
    /// it takes it, then the press followed (`USER.EXE` seg18 `0b63`).
    pub(crate) async fn scroll_control_press(
        &self,
        hwnd: u16,
        index: usize,
        lparam: u32,
    ) -> Result<(), Stop> {
        let (tab_stop, origin) = {
            let system = self.system();
            let window = system.control_window(index);

            (
                window.style & WS_TABSTOP != 0,
                (
                    window.left + window.client.left,
                    window.top + window.client.top,
                ),
            )
        };

        if tab_stop {
            self.set_focus(hwnd).await?;
        }

        let x = i32::from(lparam as u16 as i16);
        let y = i32::from((lparam >> 16) as u16 as i16);

        self.track_scroll_bar(hwnd, 0, origin.0 + x, origin.1 + y)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_rounds_half_away_from_nought() {
        assert_eq!(mul_div(100, 1, 3), 33);
        assert_eq!(mul_div(100, 1, 200), 1);
        assert_eq!(mul_div(-100, 1, 200), -1);
        assert_eq!(mul_div(5, 5, 0), 32767);
    }

    #[test]
    fn the_thumb_at_its_share_of_the_room() {
        let system = System::new();
        let state = ScrollState {
            pos: 50,
            ..ScrollState::new(100, 0)
        };
        let geometry = system
            .scroll_geometry(100, true, &state)
            .expect("a bar long enough");
        let arrow = system.metric(SM_CYVSCROLL).min(49);
        let thumb = system.metric(SM_CYVTHUMB);
        let room = 100 - 2 * arrow - thumb + 2;

        assert_eq!(geometry.arrow_end, arrow);
        assert_eq!(geometry.down_start, 100 - arrow);
        assert_eq!(geometry.thumb_top, arrow - 1 + (50 * room + 50) / 100);
        assert!(system.scroll_geometry(2, true, &state).is_none());
    }

    #[test]
    fn a_window_bar_starts_at_0_to_100() {
        let mut bars = WindowScroll::default();

        assert_eq!(bars.vertical().max, 100);
        assert_eq!(bars.horizontal().pos, 0);
    }
}
