//! The caret, as winbox.js's `caret.ts` keeps it: one for the whole system,
//! owned by a window, shown by inverting a rectangle of that window's
//! client area and blinking on a timer.
//!
//! **Recorded** by `editctl`, on four displays: the caret inverts what is
//! under it -- black text turns white -- and blinks every 530 milliseconds
//! until `SetCaretBlinkTime` says otherwise. A caret starts hidden, and each
//! `HideCaret` must be undone by a `ShowCaret` before it shows again.
//!
//! The blink is a system timer: `WM_SYSTIMER`, 118h, which a program's loop
//! takes and dispatches like any message and which calls the caret's own
//! procedure. The TypeScript engine's replay keeps a virtual clock on which
//! it never runs; this engine's clock is the instructions run, as every
//! other timer's is, so the caret blinks on it.
//!
//! Not yet measured: a caret made from a bitmap, or grey (`hbm` 1), which
//! are drawn solid here, and the caret of a window that is not the focus.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_raster::Color;
use winbox_raster::blit::{Brush, Target, raster_op};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::queue::WM_SYSTIMER;
use crate::system::System;

/// The system timer's identifier, which no program's timer is given.
const BLINK_TIMER: u16 = 0xffff;

/// How often a caret blinks until it is told: 530 milliseconds.
const BLINK: u16 = 530;

const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;

const DSTINVERT: u32 = 0x0055_0009;

/// A caret: its window, size and place in the window's client area, how
/// many `HideCaret`s have not been undone, and whether it is drawn now, in
/// its blink.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caret {
    pub hwnd: u16,
    pub width: i32,
    pub height: i32,
    pub x: i32,
    pub y: i32,
    pub hidden: u32,
    pub on: bool,
}

/// What USER keeps of the caret: the caret, the blink time set, and the
/// windows whose `BeginPaint` hid it until their `EndPaint`.
#[derive(Debug, Clone, Default)]
pub struct CaretState {
    pub caret: Option<Caret>,
    pub blink: Option<u16>,
    pub painting: Vec<u16>,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "CreateCaret" => Implementation::Sync(create_caret),
        "DestroyCaret" => Implementation::Sync(destroy_caret),
        "SetCaretPos" => Implementation::Sync(set_caret_pos),
        "GetCaretPos" => Implementation::Sync(get_caret_pos),
        "HideCaret" => Implementation::Sync(hide_caret),
        "ShowCaret" => Implementation::Sync(show_caret),
        "SetCaretBlinkTime" => Implementation::Sync(set_caret_blink_time),
        "GetCaretBlinkTime" => Implementation::Sync(get_caret_blink_time),
        _ => return None,
    })
}

impl System {
    fn blink_time(&self) -> u16 {
        self.caret.blink.unwrap_or(BLINK)
    }

    /// Inverts the caret's rectangle in its window, drawing it or taking it
    /// away, as `DSTINVERT` through the window's own device context does.
    fn invert_caret(&mut self, caret: Caret) {
        let Some(index) = self.window_named(caret.hwnd) else {
            return;
        };
        let own = self.windows[index].as_ref().and_then(|window| window.dc);
        let bitmap = match own {
            Some(dc) => crate::gdi::draw::canvas(self, dc),
            None => self.window_view(index),
        };
        let Some(bitmap) = bitmap else {
            return;
        };
        let target = Target {
            bitmap: &bitmap,
            brush: Brush::default(),
            back: Color::rgb(0xff, 0xff, 0xff),
            text: None,
            origin: (0, 0),
            realized: None,
        };

        raster_op(
            self.display_kind(),
            &target,
            caret.x,
            caret.y,
            caret.width,
            caret.height,
            DSTINVERT,
            None,
            0,
            0,
        );
    }

    /// The caret drawn or taken away, if it is not already.
    fn draw_caret(&mut self, on: bool) {
        let Some(caret) = self.caret.caret else {
            return;
        };

        if caret.on != on {
            self.invert_caret(caret);

            if let Some(caret) = self.caret.caret.as_mut() {
                caret.on = on;
            }
        }
    }

    /// The caret's blink set going, on a system timer of its window's.
    fn start_blink(&mut self) {
        let Some(caret) = self.caret.caret else {
            return;
        };
        let every = self.blink_time();

        self.set_timer(caret.hwnd, BLINK_TIMER, every, 0);

        if let Some(timer) = self
            .timers
            .iter_mut()
            .find(|timer| timer.hwnd == caret.hwnd && timer.id == BLINK_TIMER)
        {
            timer.message = WM_SYSTIMER;
        }
    }

    /// Whether a window's system timer is the caret's blink.
    pub fn blinks(&self, hwnd: u16, id: u16) -> bool {
        self.timers
            .iter()
            .any(|timer| timer.hwnd == hwnd && timer.id == id && timer.message == WM_SYSTIMER)
    }

    /// The caret's blink: drawn or taken away, while it is not hidden.
    pub fn blink(&mut self) {
        if let Some(caret) = self.caret.caret
            && caret.hidden == 0
        {
            self.draw_caret(!caret.on);
        }
    }

    /// The caret taken away; whether there was one.
    pub fn destroy_caret_now(&mut self) -> bool {
        let Some(caret) = self.caret.caret else {
            return false;
        };

        self.draw_caret(false);
        self.kill_timer(caret.hwnd, BLINK_TIMER);
        self.caret.caret = None;
        true
    }

    /// The caret hidden, if it is the window's -- or with nought,
    /// whoever's: once more to be undone.
    pub fn hide_caret_of(&mut self, hwnd: u16) {
        let Some(caret) = self.caret.caret.as_mut() else {
            return;
        };

        if hwnd != 0 && hwnd != caret.hwnd {
            return;
        }

        caret.hidden += 1;
        self.draw_caret(false);
    }

    /// A `HideCaret` undone; the last shows it at once and starts its blink
    /// again.
    pub fn show_caret_of(&mut self, hwnd: u16) {
        let Some(caret) = self.caret.caret.as_mut() else {
            return;
        };

        if (hwnd != 0 && hwnd != caret.hwnd) || caret.hidden == 0 {
            return;
        }

        caret.hidden -= 1;

        if caret.hidden == 0 {
            self.draw_caret(true);
            self.start_blink();
        }
    }

    /// The caret hidden while a window of it is painted, until its
    /// `EndPaint` (`BeginPaint`).
    ///
    /// The window keeps one mark of it, which each `BeginPaint` sets
    /// again.
    pub fn caret_before_paint(&mut self, hwnd: u16) {
        self.caret.painting.retain(|&each| each != hwnd);

        if self.hide_caret_for(hwnd) {
            self.caret.painting.push(hwnd);
        }
    }

    /// The caret hidden, if it is the window's; whether it was.
    pub fn hide_caret_for(&mut self, hwnd: u16) -> bool {
        if self.caret.caret.is_some_and(|caret| caret.hwnd == hwnd) {
            self.hide_caret_of(hwnd);
            return true;
        }

        false
    }

    /// The caret a window's `BeginPaint` hid shown again (`EndPaint`).
    pub fn caret_after_paint(&mut self, hwnd: u16) {
        if let Some(at) = self.caret.painting.iter().position(|&each| each == hwnd) {
            self.caret.painting.remove(at);
            self.show_caret_of(hwnd);
        }
    }
}

/// A caret made for a window, taking the place of any caret before it. A
/// width or height of nought is the width or height of a window's border.
fn create_caret(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let _bitmap = args.word(system);
    let width = i32::from(args.signed(system));
    let height = i32::from(args.signed(system));

    system.destroy_caret_now();

    let width = if width == 0 {
        system.metric(SM_CXBORDER)
    } else {
        width
    };
    let height = if height == 0 {
        system.metric(SM_CYBORDER)
    } else {
        height
    };

    system.caret.caret = Some(Caret {
        hwnd,
        width,
        height,
        x: 0,
        y: 0,
        hidden: 1,
        on: false,
    });
    system.start_blink();
    Ok(Answer::Nothing)
}

/// The caret taken away: TRUE, or FALSE where there was none.
fn destroy_caret(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(u16::from(system.destroy_caret_now())))
}

/// The caret moved, in its window's client coordinates; a caret that shows
/// is drawn again there.
fn set_caret_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let Some(was) = system.caret.caret.map(|caret| caret.on) else {
        return Ok(Answer::Nothing);
    };

    system.draw_caret(false);

    if let Some(caret) = system.caret.caret.as_mut() {
        caret.x = x;
        caret.y = y;
    }

    system.draw_caret(was);
    Ok(Answer::Nothing)
}

/// Where the caret is, into a `POINT`: nought, nought without one.
fn get_caret_pos(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far != 0 {
        let (x, y) = system
            .caret
            .caret
            .map_or((0, 0), |caret| (caret.x as i16, caret.y as i16));
        let mut bytes = Vec::with_capacity(4);

        bytes.extend_from_slice(&x.to_le_bytes());
        bytes.extend_from_slice(&y.to_le_bytes());
        system.write_far(far, &bytes);
    }

    Ok(Answer::Nothing)
}

fn hide_caret(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    system.hide_caret_of(hwnd);
    Ok(Answer::Nothing)
}

fn show_caret(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    system.show_caret_of(hwnd);
    Ok(Answer::Nothing)
}

/// How often the caret blinks, its blink set going again at that.
fn set_caret_blink_time(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let every = args.word(system);

    system.caret.blink = Some(every);
    system.start_blink();
    Ok(Answer::Nothing)
}

fn get_caret_blink_time(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.blink_time()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_paint::tests::one_window;

    #[test]
    fn starts_hidden_and_shows_by_inverting_its_rectangle() {
        let (mut system, _, hwnd) = one_window();
        let screen = system.screen_bitmap();
        let at = |x: i32, y: i32| screen.index_at(40 + x, 40 + y).unwrap();

        system.caret.caret = Some(Caret {
            hwnd,
            width: 2,
            height: 5,
            x: 10,
            y: 10,
            hidden: 1,
            on: false,
        });
        assert_eq!(at(10, 10), 0);

        system.show_caret_of(hwnd);
        assert_eq!(at(10, 10), 15);
        assert_eq!(at(11, 14), 15);
        assert_eq!(at(12, 10), 0);
        assert_eq!(at(10, 15), 0);

        // Every hide to be undone before it shows again.
        system.hide_caret_of(hwnd);
        system.hide_caret_of(hwnd);
        system.show_caret_of(hwnd);
        assert_eq!(at(10, 10), 0);
        system.show_caret_of(hwnd);
        assert_eq!(at(10, 10), 15);

        // Its blink is a system timer of its window's, `WM_SYSTIMER`.
        assert!(system.blinks(hwnd, BLINK_TIMER));
        system.blink();
        assert_eq!(at(10, 10), 0);
        system.blink();
        assert_eq!(at(10, 10), 15);

        // Gone, it takes itself away, and its timer.
        assert!(system.destroy_caret_now());
        assert_eq!(at(10, 10), 0);
        assert!(!system.blinks(hwnd, BLINK_TIMER));
    }

    #[test]
    fn blinks_every_530_milliseconds_until_told_otherwise() {
        let mut system = System::new();

        assert_eq!(
            get_caret_blink_time(&mut system, &mut Args::repeat(0)),
            Ok(Answer::Word(530))
        );
        assert_eq!(
            set_caret_blink_time(&mut system, &mut Args::repeat(250)),
            Ok(Answer::Nothing)
        );
        assert_eq!(
            get_caret_blink_time(&mut system, &mut Args::repeat(0)),
            Ok(Answer::Word(250))
        );
    }
}
