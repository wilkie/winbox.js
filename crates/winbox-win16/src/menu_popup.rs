//! What USER draws for a menu that is open, as winbox.js's `menus.ts` and
//! `desktop.ts` draw it: a pop-up -- pulled down from the menu bar or the
//! system menu box, or put up by `TrackPopupMenu` -- in a window of its own
//! on top of every other, and the item selected in it.
//!
//! Read off the `menus` probe's captures on four displays, one File menu of
//! every kind of item, a pop-up and the system menu:
//!
//! * A pop-up is outlined in the frame colour, and shadowed a pixel right
//!   and down in `COLOR_GRAYTEXT`, the shadow starting a pixel in from each
//!   corner.
//! * Its items are `tmHeight + 2` tall; a separator is `SM_CYMENU / 2 - 2`,
//!   its line at its middle, rounded down.
//! * Every item leaves room at its left for `OBM_CHECK`, which a checked
//!   item shows there, centred on it -- or the bitmap `SetMenuItemBitmaps`
//!   gave it for checked or unchecked, at the same place, cut to the
//!   check's size; its text follows; what follows a tab in its text, its
//!   shortcut, is in a column of its own after the longest text and eight
//!   pixels; a pop-up item shows `OBM_MNARROW` against the right edge; and
//!   fifteen pixels close the width.
//! * A selected item is filled with `COLOR_HIGHLIGHT`, its text in
//!   `COLOR_HIGHLIGHTTEXT`. A grayed item's text is `COLOR_GRAYTEXT`;
//!   grayed and selected, it is the highlight's text colour through every
//!   other pixel, as `GrayString` draws it.
//!
//! A pop-up keeps the screen under it and puts it back when it goes, so
//! nothing under it is painted again. **Recorded** by `menubits`: the
//! window under a menu closed by Escape is sent nothing, and the screen
//! shows it at once. By `menuinv`: not when the window was invalidated
//! where the menu is while it was up, which is drawn again instead.

use winbox_raster::DeviceBitmap;

use crate::frame::{Lettering, bytes_of};
use crate::gdi::GdiObject;
use crate::menu_bar::bar_layout;
use crate::painter::{Paint, PaintEnv, Painter};
use crate::system::System;
use crate::windows::Window;

pub const MF_GRAYED: u16 = 0x0001;
pub const MF_DISABLED: u16 = 0x0002;
const MF_CHECKED: u16 = 0x0008;
const MF_POPUP: u16 = 0x0010;
pub const MF_SEPARATOR: u16 = 0x0800;

const OBM_MNARROW: u16 = 32739;
const OBM_CHECK: u16 = 32760;

const SM_CYMENU: i16 = 15;

const COLOR_MENU: usize = 4;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_MENUTEXT: usize = 7;
const COLOR_HIGHLIGHT: usize = 13;
const COLOR_HIGHLIGHTTEXT: usize = 14;
const COLOR_GRAYTEXT: usize = 17;

/// The room after the longest text before the shortcuts, and after
/// everything.
const SHORTCUT_GAP: i32 = 8;
const RIGHT: i32 = 14;

/// The room between the check mark's column and the text.
const TEXT_GAP: i32 = 1;

/// Which pixels of a grayed label keep what was there: those whose
/// coordinates add to an odd number.
const GRAY_PHASE: i32 = 1;

/// A pop-up menu's own window: the menu shown, the item selected in it, and
/// the screen it covered as the menu opened.
#[derive(Debug, Clone, Default)]
pub struct PopupWindow {
    pub menu: usize,
    pub selected: i32,
    pub saved_bits: Option<Vec<u8>>,
}

/// An item's place in a pop-up, from its top border.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemPlace {
    pub top: i32,
    pub height: i32,
}

/// A pop-up's size, without its shadow, and where each item is.
#[derive(Debug, Clone)]
pub struct PopupLayout {
    pub width: i32,
    pub height: i32,
    pub places: Vec<ItemPlace>,
    pub text_left: i32,
    pub shortcut_left: i32,
}

/// An item's text either side of its tab, as a string's `split` gives the
/// first two parts: the shortcut is none without a tab.
fn halves(text: &str) -> (&str, Option<&str>) {
    let mut parts = text.split('\t');
    let left = parts.next().unwrap_or("");

    (left, parts.next())
}

/// Whether two rectangles -- left, top, right, bottom -- share a pixel.
fn overlaps(a: [i32; 4], b: [i32; 4]) -> bool {
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

fn place_of(window: &Window) -> [i32; 4] {
    [
        window.left,
        window.top,
        window.left + window.width,
        window.top + window.height,
    ]
}

impl System {
    /// A pop-up's layout, as `popupLayout` works it out in the System font.
    pub fn popup_layout(&self, menu: usize) -> PopupLayout {
        let letters = self.system_lettering();
        let measure = |line: &str| letters.as_ref().map_or(0, |l| l.measure(&bytes_of(line)));
        let check_width = self
            .driver
            .as_ref()
            .and_then(|driver| driver.oem.get(&OBM_CHECK))
            .map_or(14, DeviceBitmap::width);
        let item_height = letters.as_ref().map_or(0, |l| l.height) + 2;
        let separator = (self.metric(SM_CYMENU) >> 1) - 2;
        let mut places = Vec::new();
        let mut text = 0;
        let mut shortcut = 0;
        let mut y = 1;

        for item in &self.menus[menu].items {
            let shown = item.text.as_deref().unwrap_or("").replacen('&', "", 1);
            let (left, right) = halves(&shown);
            let height = if item.flags & MF_SEPARATOR != 0 {
                separator
            } else {
                item_height
            };

            places.push(ItemPlace { top: y, height });
            y += height;

            if item.flags & MF_SEPARATOR == 0 {
                text = text.max(measure(left));

                if let Some(right) = right {
                    shortcut = shortcut.max(measure(right));
                }
            }
        }

        let text_left = 1 + check_width + TEXT_GAP;
        let shortcut_left = text_left + text + SHORTCUT_GAP;
        let width = shortcut_left
            + if shortcut != 0 {
                shortcut
            } else {
                -SHORTCUT_GAP
            }
            + RIGHT
            + 1;

        PopupLayout {
            width,
            height: y + 1,
            places,
            text_left,
            shortcut_left,
        }
    }

    /// Opens a pop-up menu with its top left at `x, y` on the screen, on
    /// top of every window: its own window, a pixel larger each way for its
    /// shadow, which never becomes active. Its index among the windows.
    pub fn open_popup(&mut self, menu: usize, x: i32, y: i32, selected: i32) -> usize {
        let layout = self.popup_layout(menu);
        let (width, height) = (layout.width + 1, layout.height + 1);
        let screen = self.screen_bitmap();
        let mut bits = vec![0u8; (width.max(0) * height.max(0)) as usize];

        for row in 0..height {
            for column in 0..width {
                bits[(row * width + column) as usize] =
                    screen.index_at(x + column, y + row).unwrap_or(0);
            }
        }

        let index = self.windows.len();

        self.windows.push(Some(Window {
            left: x,
            top: y,
            width,
            height,
            style: 0x8000_0000,
            visible: true,
            popup: Some(PopupWindow {
                menu,
                selected,
                saved_bits: Some(bits),
            }),
            ..Window::default()
        }));
        self.z_order.insert(0, index);
        self.own();
        self.paint_popup(index);
        index
    }

    /// A pop-up menu's window gone: what it covered put back, if its bits
    /// still stand; otherwise what shows there now is due to be painted
    /// again, as for any window taken away.
    pub fn close_popup(&mut self, index: usize) {
        if self.windows.get(index).is_none_or(Option::is_none) {
            return;
        }

        self.z_order.retain(|&other| other != index);

        let visible = self.windows[index]
            .as_ref()
            .is_some_and(|window| window.visible);

        if visible {
            if let Some(window) = self.windows[index].as_mut() {
                window.visible = false;
                window.active = false;
                window.lit = None;
            }

            let before = self.owners.clone();

            self.own();

            if !self.restore_bits(index) {
                self.expose_owned(index, &before);
            }
        }

        self.windows[index] = None;
    }

    /// Puts back what a pop-up menu covered, if it still stands; whether it
    /// did. Thrown away when something under it is to be painted again
    /// there (`menuinv`): only a part of a window invalidated clear of the
    /// menu leaves them standing.
    fn restore_bits(&mut self, index: usize) -> bool {
        let Some(window) = self.windows[index].as_mut() else {
            return false;
        };
        let place = place_of(window);
        let bits = window
            .popup
            .as_mut()
            .and_then(|popup| popup.saved_bits.take());
        let spoiled = self.z_order.iter().any(|&other| {
            let Some(shown) = self.windows[other].as_ref() else {
                return false;
            };

            if other == index || !shown.visible || !shown.needs_paint {
                return false;
            }

            if !overlaps(place_of(shown), place) {
                return false;
            }

            shown.dirty.is_none_or(|dirty| overlaps(dirty.area, place))
        });

        let Some(bits) = bits else {
            return false;
        };

        if spoiled {
            return false;
        }

        let screen = self.screen_bitmap();
        let (width, height) = (place[2] - place[0], place[3] - place[1]);

        for row in 0..height {
            for column in 0..width {
                let (sx, sy) = (place[0] + column, place[1] + row);

                if sx >= 0 && sy >= 0 && sx < screen.width() && sy < screen.height() {
                    screen.put(sx, sy, bits[(row * width + column) as usize]);
                }
            }
        }

        screen
            .context
            .mark_rect(place[0], place[1], place[2], place[3]);
        true
    }

    /// Paints a pop-up menu's window again: its selection may have moved.
    pub fn paint_popup(&mut self, index: usize) {
        let Some((menu, selected, width, height)) = self.windows[index].as_ref().and_then(|w| {
            w.popup
                .as_ref()
                .map(|popup| (popup.menu, popup.selected, w.width, w.height))
        }) else {
            return;
        };
        let Some(whole) = self.window_part(index, 0, 0, width, height, true) else {
            return;
        };
        let Some(letters) = self.system_lettering() else {
            return;
        };

        paint_popup(self, &whole, menu, selected, &letters);
    }

    /// Where each item of a window's menu bar is on the screen: its text's
    /// width and the space either side, the bar's height. Left, right, top
    /// and bottom.
    pub fn menu_bar_items(&self, index: usize) -> Vec<[i32; 4]> {
        let Some(window) = self.windows[index].as_ref() else {
            return Vec::new();
        };
        let letters = self.system_lettering();
        let measure = |line: &str| letters.as_ref().map_or(0, |l| l.measure(&bytes_of(line)));
        let bar = self.metric(SM_CYMENU);
        let labels = window.bar.clone().unwrap_or_default();
        let (items, rows) = bar_layout(
            &labels,
            measure,
            window.client.left,
            window.width - window.client.left,
        );
        let first = window.top + window.client.top - rows * (bar + 1);

        items
            .iter()
            .map(|item| {
                [
                    window.left + item.left,
                    window.left + item.right,
                    first + item.row * (bar + 1),
                    first + item.row * (bar + 1) + bar,
                ]
            })
            .collect()
    }

    /// Where a window's system menu opens: under its box, on the caption's
    /// bottom line.
    pub fn system_menu_place(&self, index: usize) -> (i32, i32) {
        let Some(window) = self.windows[index].as_ref() else {
            return (0, 0);
        };
        let rows = window.bar.as_ref().map_or(0, |labels| {
            let letters = self.system_lettering();
            let measure = |line: &str| letters.as_ref().map_or(0, |l| l.measure(&bytes_of(line)));

            bar_layout(
                labels,
                measure,
                window.client.left,
                window.width - window.client.left,
            )
            .1
        });
        let bar = rows * (self.metric(SM_CYMENU) + 1);

        (
            window.left + window.client.left,
            window.top + window.client.top - 1 - bar,
        )
    }

    /// Where each item of an open pop-up is, from its window's top.
    pub fn popup_places(&self, index: usize) -> Vec<ItemPlace> {
        self.windows[index]
            .as_ref()
            .and_then(|window| window.popup.as_ref())
            .map(|popup| self.popup_layout(popup.menu).places)
            .unwrap_or_default()
    }
}

/// Paints a pop-up with its top left at the corner of `bitmap`: its border,
/// its shadow, and each item, `selected` highlighted.
#[allow(clippy::too_many_lines)]
fn paint_popup(
    system: &System,
    bitmap: &DeviceBitmap,
    menu: usize,
    selected: i32,
    letters: &Lettering,
) {
    let layout = system.popup_layout(menu);
    let (width, height) = (layout.width, layout.height);
    let env = PaintEnv::new(system);
    let painter = Painter::new(bitmap.clone(), 0, 0, width + 1, height + 1, &env);
    let oem = |id: u16| env.oem(id);

    painter.fill(0, 0, width, height, painter.colour(COLOR_MENU));
    painter.outline(0, 0, width, height, painter.colour(COLOR_WINDOWFRAME));

    // The shadow, a pixel right and down, a pixel in from each corner.
    let shadow = painter.colour(COLOR_GRAYTEXT);

    painter.fill(width, 1, width + 1, height + 1, shadow);
    painter.fill(1, height, width + 1, height + 1, shadow);

    for (at, item) in system.menus[menu].items.iter().enumerate() {
        let place = layout.places[at];

        if item.flags & MF_SEPARATOR != 0 {
            let line = place.top + (place.height >> 1);

            painter.fill(
                1,
                line,
                width - 1,
                line + 1,
                painter.colour(COLOR_WINDOWFRAME),
            );
            continue;
        }

        let is_selected = at as i32 == selected;
        let grayed = item.flags & MF_GRAYED != 0;

        if is_selected {
            painter.fill(
                1,
                place.top,
                width - 1,
                place.top + place.height,
                painter.colour(COLOR_HIGHLIGHT),
            );
        }

        let own = item
            .bitmaps
            .filter(|&(unchecked, checked)| unchecked != 0 || checked != 0);

        if let Some((unchecked, checked)) = own {
            // The program's own, checked or not, where the check mark would
            // be and cut to its size; a monochrome one in the item's text
            // colour and its background, as `BitBlt` copies one (`menubmp`).
            let handle = if item.flags & MF_CHECKED != 0 {
                checked
            } else {
                unchecked
            };
            let own = (handle != 0)
                .then(|| match system.gdi_object_of(handle) {
                    Some((_, GdiObject::Bitmap(bitmap))) => Some(bitmap.pixels.clone()),
                    _ => None,
                })
                .flatten();
            let check = oem(OBM_CHECK);
            let w = check.map_or(14, DeviceBitmap::width);
            let h = check.map_or(14, DeviceBitmap::height);
            let remap: Vec<(u8, Paint)> = if own.as_ref().is_some_and(|own| own.depth == 1) {
                vec![
                    (
                        0,
                        painter.colour(if is_selected {
                            COLOR_HIGHLIGHTTEXT
                        } else {
                            COLOR_MENUTEXT
                        }),
                    ),
                    (
                        1,
                        painter.colour(if is_selected {
                            COLOR_HIGHLIGHT
                        } else {
                            COLOR_MENU
                        }),
                    ),
                ]
            } else {
                Vec::new()
            };

            painter.blit_part(
                own.as_ref(),
                1,
                place.top + ((place.height - h) >> 1),
                w,
                0,
                h,
                0,
                &remap,
            );
        } else if item.flags & MF_CHECKED != 0 {
            let check = oem(OBM_CHECK);
            let h = check.map_or(0, DeviceBitmap::height);

            painter.blit(
                check,
                1,
                place.top + ((place.height - h) >> 1),
                check.map_or(0, DeviceBitmap::width),
            );
        }

        if item.flags & MF_POPUP != 0 {
            let arrow = oem(OBM_MNARROW);
            let (w, h) = arrow.map_or((0, 0), |arrow| (arrow.width(), arrow.height()));

            painter.blit(
                arrow,
                width - 2 - w,
                place.top + ((place.height - h) >> 1),
                w,
            );
        }

        // Grayed text is `COLOR_GRAYTEXT`, unless that is 0 -- a display
        // with no solid grey, as the Hercules -- or the item is selected:
        // then it is the text's own colour through every other pixel, as
        // `GrayString` draws it.
        let gray_text = env.sys_color(COLOR_GRAYTEXT);
        let dithered = grayed && (is_selected || gray_text == 0);
        let colour = if is_selected {
            env.sys_color(COLOR_HIGHLIGHTTEXT)
        } else if grayed && !dithered {
            gray_text
        } else {
            env.sys_color(COLOR_MENUTEXT)
        };
        let text = item.text.as_deref().unwrap_or("");
        let (left, right) = halves(text);

        label(
            system,
            bitmap,
            letters,
            left,
            colour,
            layout.text_left,
            place.top,
            dithered,
        );

        if let Some(right) = right {
            label(
                system,
                bitmap,
                letters,
                right,
                colour,
                layout.shortcut_left,
                place.top,
                grayed && is_selected,
            );
        }
    }
}

/// A line of text in the System font, its cell's top left at `x, y`, with
/// the character after its first `&` underlined a row below the ascent;
/// `grayed`, what was there put back through every other pixel of the
/// line's box, counted from the bitmap's corner.
#[allow(clippy::too_many_arguments)]
fn label(
    system: &System,
    bitmap: &DeviceBitmap,
    letters: &Lettering,
    line: &str,
    colour: u32,
    x: i32,
    y: i32,
    grayed: bool,
) {
    let line = bytes_of(line);
    let at = line.iter().position(|&byte| byte == b'&');
    let mut plain = line.clone();

    if let Some(at) = at {
        plain.remove(at);
    }

    let width = letters.measure(&plain);
    let height = letters.height;
    let kept: Vec<Option<u8>> = if grayed {
        (0..height)
            .flat_map(|row| (0..width).map(move |column| (column, row)))
            .map(|(column, row)| bitmap.index_at(x + column, y + row))
            .collect()
    } else {
        Vec::new()
    };

    letters.text(system, bitmap, &plain, colour, x, y);

    if let Some(at) = at.filter(|&at| at < plain.len()) {
        let under = x + letters.measure(&plain[..at]);
        let index = bitmap.device_palette.borrow_mut().index(
            colour as u8,
            (colour >> 8) as u8,
            (colour >> 16) as u8,
        ) as u8;
        let across = letters.measure(&plain[at..=at]);

        for column in 0..across {
            bitmap.put(under + column, y + letters.ascent + 1, index);
        }

        bitmap.context.mark_rect(
            under,
            y + letters.ascent + 1,
            under + across,
            y + letters.ascent + 2,
        );
    }

    if grayed {
        for row in 0..height {
            for column in 0..width {
                let (px, py) = (x + column, y + row);

                if (px + py) & 1 == GRAY_PHASE
                    && let Some(was) = kept[(row * width + column) as usize]
                {
                    bitmap.put(px, py, was);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::desktop_paint::tests::one_window;
    use crate::menus::MenuItem;

    /// A menu of two commands: its index.
    fn two_items(system: &mut crate::system::System) -> usize {
        let menu = system.new_menu();

        for id in [1, 2] {
            system.menus[menu].items.push(MenuItem {
                flags: 0,
                id,
                text: Some(format!("&Item {id}")),
                popup: None,
                bitmaps: None,
            });
        }

        menu
    }

    #[test]
    fn a_pop_up_puts_back_what_it_covered() {
        let (mut system, window, _) = one_window();

        system.paint_background();
        system.erase(window, 0x00ff_ffff, None, (0, 0));

        let screen = system.screen_bitmap();
        let before = screen.indices.borrow().clone();
        let menu = two_items(&mut system);
        let popup = system.open_popup(menu, 60, 70, -1);
        let (width, height) = {
            let shown = system.windows[popup].as_ref().unwrap();

            (shown.width, shown.height)
        };
        let stride = screen.width();
        let owner = |system: &crate::system::System, x: i32, y: i32| {
            system.owners[(y * stride + x) as usize]
        };

        // On top, its shadow's outer corners left to the window beneath.
        assert_eq!(system.z_order[0], popup);
        assert_eq!(owner(&system, 60, 70), (popup + 1) as u16);
        assert_eq!(owner(&system, 60 + width - 1, 70), (window + 1) as u16);
        assert_eq!(owner(&system, 60, 70 + height - 1), (window + 1) as u16);

        system.close_popup(popup);

        assert!(system.windows[popup].is_none());
        assert_eq!(*screen.indices.borrow(), before);
        assert!(!system.windows[window].as_ref().unwrap().needs_nc_paint);
    }

    #[test]
    fn a_window_due_a_paint_beneath_is_painted_again_instead() {
        let (mut system, window, _) = one_window();
        let menu = two_items(&mut system);
        let popup = system.open_popup(menu, 60, 70, -1);

        system.windows[window].as_mut().unwrap().needs_paint = true;
        system.close_popup(popup);

        assert!(system.windows[window].as_ref().unwrap().needs_nc_paint);
    }
}
