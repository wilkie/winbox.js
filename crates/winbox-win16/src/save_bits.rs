//! The bits beneath a window of a class with `CS_SAVEBITS`, kept by USER as
//! the window is shown and put back where it uncovers them (`USER.EXE`
//! seg13 `1e72`, `211e`, seg1 `0959`). **Read out**:
//!
//! * **Kept** as `SetWindowPos` places a window with `SWP_SHOWWINDOW` and
//!   without `SWP_NOREDRAW`, of a class with `CS_SAVEBITS` (seg7
//!   `0b75`-`0bde`), where no window before it among its brothers shows
//!   (`0b8e`-`0bc5`), it is at the top (seg13 `1e82`-`1e99`), and no system
//!   error box is up -- USER's word at E0h (`1e78`, set by `SysErrorBox`,
//!   seg1 `9359`, `9a9a`). That is before anything of the list is drawn: the
//!   screen as it was. Its rectangle on the screen (`1ed8`-`1f0e`; the
//!   `Edsun=` widening at `1ee9` not followed), in the display driver
//!   through its `SaveScreenBitmap` where the driver has `RC_SAVEBITMAP`
//!   (seg3 `1c06`-`1c28`) and answers it (seg13 `1f5e`-`1f7b`), else in a
//!   bitmap of USER's (`1f7e`-`1fe5`). Every context's bounds are taken
//!   back first (`1e9c`-`1ec3`), and what the windows from it back were due
//!   in the rectangle is no longer due, and counts as drawn (`2028`-`2063`,
//!   `206b`), as for the lock.
//! * **Spoiled** by what is drawn behind it, as the lock is
//!   (`user_calls::lock_update`): all of it drawn over, let go (seg1
//!   `081c`).
//! * **Put back** by `SetWindowPos` for a window that had them where what
//!   showed of it does not now (seg7 `076d`-`07f3`), `restore_under`.
//! * **Let go** as a window that had them is placed with anything asked but
//!   `SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE` alone and not shown (seg7
//!   `088f`-`08b3`), and as it is destroyed (seg1 `0830`).
//!
//! **Recorded** by `savebit`. Of the drivers, `VGA.DRV`'s answer is read
//! out (`display::save_screen_bitmap`); a driver with `RC_SAVEBITMAP` not
//! read out keeps nothing here.

use winbox_raster::ClipRegion;

use crate::display::{SaveRule, save_screen_bitmap};
use crate::invalidate_through::Rect;
use crate::system::System;
use crate::user_calls::lock_update::{Lock, Record};

const CS_SAVEBITS: u16 = 0x0800;
/// Windows' own bounds set (`gdi::bounds`).
const WINDOWS_SET: u16 = 1;

/// The bits a window saved, as USER keeps them.
#[derive(Debug, Clone)]
pub struct Saved {
    /// The record: its window, rectangle and what of it is still as it was.
    pub kept: Lock,
    /// The screen's indices in the rectangle, row by row.
    pub bits: Vec<u8>,
    /// Kept by the driver's `SaveScreenBitmap` rather than in USER's bitmap.
    pub in_driver: bool,
}

impl System {
    fn saved_at(&self, window: usize) -> Option<usize> {
        self.user_calls
            .saves
            .iter()
            .position(|saved| saved.kept.window == window)
    }

    /// Whether USER keeps bits saved for a window (its byte at 24h's bit
    /// 80h).
    pub(crate) fn has_saved(&self, window: usize) -> bool {
        self.saved_at(window).is_some()
    }

    /// The bits under a window shown by `SetWindowPos` kept, where they are
    /// to be (seg7 `0b75`-`0bde`): `screen` is the screen as it was before
    /// the list was drawn.
    pub(crate) fn save_under(&mut self, index: usize, screen: &[u8]) {
        if self.class_style(index) & CS_SAVEBITS == 0
            || self.shown(index).parent.is_some()
            || self.user_calls.in_sys_error_box
        {
            return;
        }

        // No window before it among its brothers shows (`0b8e`-`0bc5`).
        for &other in &self.z_order {
            if other == index {
                break;
            }

            if self.shown(other).parent.is_none() && self.shown(other).visible {
                return;
            }
        }

        let rule = self.display.save_screen_bitmap_rule();

        if rule == SaveRule::Unread {
            return;
        }

        self.discard_saved(index);

        // Every context's bounds taken back for the records kept, then
        // emptied (`1e9c`-`1ec3`).
        self.harvest_all();

        for at in 0..self.dc_entries.list.len() {
            let dc = self.dc_entries.list[at].dc;
            let bounds = &mut self.gdi.dcs[dc].bounds;

            bounds.windows = crate::gdi::bounds::EMPTY;
            bounds.flags &= !WINDOWS_SET;
        }

        let (stride, high) = (
            i32::from(self.display.width),
            i32::from(self.display.height),
        );
        let place = self.window_rect(index);
        let rect: Rect = [
            place[0].max(0),
            place[1].max(0),
            place[2].min(stride),
            place[3].min(high),
        ];

        if rect[2] <= rect[0] || rect[3] <= rect[1] {
            return;
        }

        let in_driver = rule == SaveRule::Driver
            && save_screen_bitmap(&mut self.user_calls.screen_kept, rect, 0) != 0;
        let width = (rect[2] - rect[0]) as usize;
        let mut bits = Vec::with_capacity(width * (rect[3] - rect[1]) as usize);

        for y in rect[1]..rect[3] {
            let from = (y * stride + rect[0]) as usize;

            bits.extend_from_slice(&screen[from..from + width]);
        }

        let hwnd = self.shown(index).hwnd;

        self.user_calls.saves.insert(
            0,
            Saved {
                kept: Lock {
                    hwnd,
                    window: index,
                    rect: Some(rect),
                    still: None,
                    gone: false,
                },
                bits,
                in_driver,
            },
        );

        // What the windows from it back were due there, no longer due
        // (`2028`-`2063`): the desktop's own is not kept as a window's here.
        let brothers = self.windows_in(None);
        let from = brothers
            .iter()
            .position(|&one| one == index)
            .map_or(brothers.len(), |at| at + 1);

        for &brother in &brothers[from..] {
            if !self.has_saved(index) {
                break;
            }

            if !self.take_due(Record::Save(0), rect, brother, true) {
                break;
            }
        }
    }

    /// The bits a window saved put back where `region` of the screen, what
    /// showed of it and does not now, is (seg13 `211e`), and let go.
    /// Answers whether anything is still to be made due there, and what.
    ///
    /// * Only what is still as it was is put back; nothing at all, and all
    ///   of `region` due, where none of it is (`213c`-`2162`).
    /// * Kept by the driver: it puts back all of its rectangle, whatever
    ///   lies there now, and what of the rectangle was not as it was is due
    ///   -- nothing put back and all due where the driver answers nought
    ///   (`2171`-`21cd`).
    /// * Kept by USER: what is as it was is blitted back, no more, and the
    ///   rest of `region` is due (`21d0`-`2253`).
    pub(crate) fn restore_under(
        &mut self,
        index: usize,
        region: &ClipRegion,
    ) -> (bool, ClipRegion) {
        let Some(at) = self.saved_at(index) else {
            return (true, region.clone());
        };
        let (rect, still) = {
            let saved = &self.user_calls.saves[at];

            (
                saved.kept.rect.expect("a saved rectangle"),
                saved.kept.still.clone(),
            )
        };
        let spoiled = still.is_some();
        let restorable = match &still {
            Some(still) => {
                let part = region.intersect(still);

                if part.kind() <= 1 {
                    self.discard_saved(index);
                    return (true, region.clone());
                }

                part
            }
            None => region.clone(),
        };
        let width = rect[2] - rect[0];
        let screen = self.screen_bitmap();

        if self.user_calls.saves[at].in_driver {
            self.user_calls.saves[at].in_driver = false;

            if save_screen_bitmap(&mut self.user_calls.screen_kept, rect, 1) == 0 {
                self.discard_saved(index);
                return (true, region.clone());
            }

            {
                let bits = &self.user_calls.saves[at].bits;

                for y in rect[1]..rect[3] {
                    for x in rect[0]..rect[2] {
                        screen.put(x, y, bits[((y - rect[1]) * width + (x - rect[0])) as usize]);
                    }
                }
            }

            let left = ClipRegion::rect(rect[0], rect[1], rect[2], rect[3]).subtract(&restorable);

            self.discard_saved(index);

            return if left.kind() <= 1 {
                (spoiled, left)
            } else {
                (true, left)
            };
        }

        {
            let bits = &self.user_calls.saves[at].bits;

            for band in &restorable.bands {
                for y in band.top.max(rect[1])..band.bottom.min(rect[3]) {
                    for &(l, r) in &band.spans {
                        for x in l.max(rect[0])..r.min(rect[2]) {
                            screen.put(
                                x,
                                y,
                                bits[((y - rect[1]) * width + (x - rect[0])) as usize],
                            );
                        }
                    }
                }
            }
        }

        self.discard_saved(index);

        (spoiled, region.subtract(&restorable))
    }

    /// A window's saved bits let go (seg1 `0959`): the driver's discarded.
    pub(crate) fn discard_saved(&mut self, index: usize) {
        let Some(at) = self.saved_at(index) else {
            return;
        };
        let saved = self.user_calls.saves.remove(at);

        if saved.in_driver {
            let rect = saved.kept.rect.expect("a saved rectangle");

            save_screen_bitmap(&mut self.user_calls.screen_kept, rect, 2);
        }
    }

    /// The saved bits of a window destroyed, and of the windows in it, let
    /// go (seg1 `0830`).
    pub(crate) fn discard_within(&mut self, index: usize) {
        let saving: Vec<usize> = self
            .user_calls
            .saves
            .iter()
            .map(|saved| saved.kept.window)
            .collect();

        for window in saving {
            let mut at = Some(window);

            while let Some(one) = at {
                if one == index {
                    self.discard_saved(window);
                    break;
                }

                at = self.windows[one].as_ref().and_then(|shown| shown.parent);
            }
        }
    }
}
