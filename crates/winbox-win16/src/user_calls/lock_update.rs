//! One window at a time kept from drawing on the screen
//! (`LockWindowUpdate`), and the device context `GetDC` gives of it while
//! it is.

use winbox_raster::DeviceBitmap;

use crate::call::{Answer, Args, Stop};
use crate::gdi::GdiObject;
use crate::gdi::dc::DcBitmap;
use crate::gdi::ddb::Bitmap;
use crate::system::System;

/// The window locked, and the device contexts `GetDC` gave of it since, by
/// their indices: what they drew is made invalid on unlocking.
#[derive(Debug, Clone)]
pub struct Lock {
    pub hwnd: u16,
    pub dcs: Vec<usize>,
}

/// One window at a time kept from drawing on the screen. **Recorded** by
/// `lockupd`:
///
/// * Locking answers 1; locking while a window is locked, the same one or
///   another, answers nought, and so does unlocking with none locked.
/// * What a device context from `GetDC` draws on the locked window does not
///   show, and nothing is made invalid while it is locked.
/// * Unlocking makes invalid what was drawn -- its rectangle, not the whole
///   window -- and it is painted as any invalid part is.
///
/// Here the device context draws on a bitmap of its own, the client area's
/// size, which keeps the rectangle drawn on. Not recorded: the locked
/// window's children, and `BeginPaint` while it is locked.
pub(super) fn lock_window_update(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);

    if hwnd != 0 {
        if system.user_calls.locked.is_some() || system.window_named(hwnd).is_none() {
            return Ok(Answer::Word(0));
        }

        system.user_calls.locked = Some(Lock {
            hwnd,
            dcs: Vec::new(),
        });
        return Ok(Answer::Word(1));
    }

    let Some(lock) = system.user_calls.locked.take() else {
        return Ok(Answer::Word(0));
    };

    let mut drawn: Option<[i32; 4]> = None;

    for dc in lock.dcs {
        let Some(dirty) = system
            .dc_bitmap(dc)
            .and_then(|bitmap| bitmap.pixels.context.take_dirty())
        else {
            continue;
        };

        drawn = Some(match drawn {
            Some([left, top, right, bottom]) => [
                left.min(dirty.left),
                top.min(dirty.top),
                right.max(dirty.right),
                bottom.max(dirty.bottom),
            ],
            None => [dirty.left, dirty.top, dirty.right, dirty.bottom],
        });
    }

    if let Some(drawn) = drawn
        && let Some(index) = system.window_named(lock.hwnd)
    {
        system.invalidate(index, Some(drawn), true);
    }

    Ok(Answer::Word(1))
}

impl System {
    /// For `GetDC` of the locked window: a device context of its own,
    /// drawing on a bitmap the client area's size at the screen's depth and
    /// in its palette, made anew each time; none for any other window. It
    /// is not a memory device context: its driver is the display's.
    pub(crate) fn locked_dc(&mut self, hwnd: u16) -> Option<usize> {
        if self.user_calls.locked.as_ref()?.hwnd != hwnd {
            return None;
        }

        let index = self.window_named(hwnd)?;
        let (width, height) = self.windows[index]
            .as_ref()
            .map(|window| (window.client_width(), window.client_height()))?;
        let screen = self.screen_bitmap();
        let pixels = DeviceBitmap::new(
            width.max(1),
            height.max(1),
            screen.depth,
            None,
            Some(std::rc::Rc::clone(&screen.device_palette)),
        );

        pixels.context.take_dirty();

        let object = self.gdi_object(GdiObject::Bitmap(Box::new(Bitmap::new(pixels))));
        let dc = self.new_dc(DcBitmap::Bitmap(object), false);

        if let Some(lock) = self.user_calls.locked.as_mut() {
            lock.dcs.push(dc);
        }

        Some(dc)
    }
}
