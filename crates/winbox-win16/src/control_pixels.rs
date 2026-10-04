//! The pixels of the controls that keep state of their own, as winbox.js's
//! `desktop.ts` draws them for `control-classes.ts`: a list box's rows,
//! its highlight, its focus rectangle and its scrolling (`listText`,
//! `scrollClient`, `listFocus`, `listErase`), a combo box's button and
//! field (`paintCombo`), and the scroll bar control (`controls.ts`'s
//! `paintControl`). The edit control's are `edit_paint.rs`.
//!
//! What a control's parent answered `WM_CTLCOLOR` stands, as for the
//! buttons and static text (`control_paint.rs`), for the system colours it
//! replaces; a list box's scrolling and a combo box's own painting are
//! drawn in the system colours whatever was answered, as the TypeScript
//! engine draws them.

use std::rc::Rc;

use winbox_raster::{DeviceBitmap, LogicalFont};

use crate::call::Stop;
use crate::combobox::ComboState;
use crate::control_host::bytes_of;
use crate::controls::ControlColours;
use crate::frame::rgba;
use crate::gdi::text_out::Writer;
use crate::painter::{PaintEnv, Painter, ScrollGeometry, ScrollPaint, scroll_geometry};
use crate::scroll_bars::ScrollState;
use crate::system::System;
use crate::windows::Rect;

const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_WINDOWTEXT: usize = 8;
const COLOR_HIGHLIGHT: usize = 13;
const COLOR_HIGHLIGHTTEXT: usize = 14;
const COLOR_BTNTEXT: usize = 18;

const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;

const LBS_MULTIPLESEL: u32 = 0x0008;
const LBS_EXTENDEDSEL: u32 = 0x0800;

/// The display driver's arrow for a combo box's button.
const OBM_COMBO: u16 = 32738;

/// A control's painting environment (`#controlEnvironment`): what its
/// parent answered standing for the window colour -- or for a scroll bar,
/// the scroll bar colour -- and the window text's, its pattern from where
/// the brush was realised; and the background colour its text is drawn on,
/// unless the mode is transparent. A push button and a scroll bar draw no
/// text on it.
pub(crate) fn control_env(
    system: &System,
    colours: Option<ControlColours>,
    scroll_bar: bool,
    push: bool,
) -> (PaintEnv<'_>, Option<u32>) {
    let mut paint = PaintEnv::new(system);
    let mut ground = None;

    if let Some(colours) = colours {
        paint.control = Some((colours, scroll_bar));
        paint.pattern_origin = colours.brush_origin;

        if !scroll_bar && !push && !colours.transparent {
            ground = Some(colours.ground);
        }
    }

    (paint, ground)
}

/// Pixels drawn through only within a rectangle, as a `Surface`'s
/// `withClip` keeps what lies outside it: a rectangle whose edges are the
/// wrong way round is turned the right way, not refused (`clipedge`).
pub(crate) fn clipped(bitmap: &DeviceBitmap, rect: [i32; 4]) -> DeviceBitmap {
    let [left, top, right, bottom] = rect;
    let (left, right) = (left.min(right), left.max(right));
    let (top, bottom) = (top.min(bottom), top.max(bottom));
    let mut view = bitmap.clone();
    let outer = view.context.clip.clone();

    view.context.clip = Some(Rc::new(move |x, y| {
        x >= left
            && x < right
            && y >= top
            && y < bottom
            && outer.as_ref().is_none_or(|clip| clip(x, y))
    }));
    view
}

/// A line of text as USER draws a control's, its cell's top left at
/// `x, y`: transparent, or on its cell in a background colour.
#[allow(clippy::too_many_arguments)]
pub(crate) fn write_text(
    system: &System,
    bitmap: &DeviceBitmap,
    font: &LogicalFont,
    colour: u32,
    back: Option<u32>,
    x: i32,
    y: i32,
    text: &[u8],
) {
    let mut writer = Writer::user(system, bitmap.clone(), font.clone(), rgba(colour));

    if let Some(back) = back {
        writer = writer.opaque(rgba(back));
    }

    // A strike's region of negative size, the only way drawing text can
    // fail, comes of a negative character extra, which USER's own text
    // never has.
    let _ = writer.fill_text(i64::from(x), i64::from(y), text);
}

/// A scroll bar's state as it is painted.
pub(crate) fn scroll_paint(state: Option<&ScrollState>) -> Option<ScrollPaint> {
    state.map(|state| ScrollPaint {
        min: state.min,
        max: state.max,
        pos: state.pos,
        flags: state.flags,
        shaft: None,
        track: state.track,
    })
}

/// A held page as painting a bar leaves it: cut back to the thumb where
/// the thumb has come into it (`USER.EXE` seg18 `042c`). The painter cuts
/// back the press's own run, which the press then goes on with -- whether
/// the pointer is still in it is asked of what is left.
fn settle(state: &mut ScrollState, geometry: Option<ScrollGeometry>) {
    let (Some(track), Some(geometry)) = (state.track.as_mut(), geometry) else {
        return;
    };

    if track.part == 2 {
        track.end = track.end.min(geometry.thumb_top);
    } else if track.part == 3 {
        track.start = track.start.max(geometry.thumb_top + geometry.thumb);
    }
}

impl System {
    /// Draws on a window, frame and all, where it shows
    /// (`windowPainter`): in the system colours.
    pub(crate) fn paint_on_window(&mut self, index: usize, draw: impl FnOnce(&Painter)) {
        let Some(window) = self.windows[index].as_ref() else {
            return;
        };
        let (width, height) = (window.width, window.height);
        let Some(whole) = self.window_part(index, 0, 0, width, height, false) else {
            return;
        };
        let env = PaintEnv::new(self);

        draw(&Painter::new(whole, 0, 0, width, height, &env));
    }

    /// A window's own bars' held pages, as painting its frame has just cut
    /// them back: along the bars as the frame drew them, around the client
    /// area it left (`client`, what `paint_frame` answers). The TypeScript
    /// engine's painter cuts the press's own record as it draws a bar, so
    /// the length is the painted bar's, which shares its outer line with
    /// the window's edge only where there is an edge -- not
    /// `scroll_bar_rect`'s, which for a window without edges but with a
    /// menu bar is a pixel longer.
    pub(crate) fn settle_frame_tracks(&mut self, index: usize, client: Rect) {
        // A frame's edges are there across and down alike, so the client
        // area starts in from the left exactly when there are edges.
        let overlap = i32::from(client.left > 0);

        for vertical in [true, false] {
            let Some(window) = self.windows[index].as_ref() else {
                return;
            };
            let bit = if vertical { WS_VSCROLL } else { WS_HSCROLL };
            let state = if vertical {
                window.scroll_bars.vertical
            } else {
                window.scroll_bars.horizontal
            };
            let Some(mut state) = state.filter(|_| window.style & bit != 0) else {
                continue;
            };
            let length = if vertical {
                client.bottom + 1 - (client.top - overlap)
            } else {
                client.right + 1 - (client.left - overlap)
            };
            let geometry = scroll_geometry(
                |metric| self.metric(metric),
                length,
                vertical,
                state.min,
                state.max,
                state.pos,
            );

            settle(&mut state, geometry);

            let bars = &mut self.windows[index].as_mut().expect("a window").scroll_bars;

            if vertical {
                bars.vertical = Some(state);
            } else {
                bars.horizontal = Some(state);
            }
        }
    }

    /// The font a control's text is drawn in: its own, or the System font.
    pub(crate) fn control_drawing_font(
        &mut self,
        index: usize,
    ) -> Result<Option<LogicalFont>, Stop> {
        Ok(self
            .control_font(index)?
            .map(|font| font.font)
            .or_else(|| self.desktop_font.clone()))
    }

    /// A list box's row of a string item (`USER.EXE` seg35 `069a`): a
    /// selected row filled in the highlight colour and its text in the
    /// highlight text colour; an unselected one filled in the window colour
    /// when `fill` says so, and its text on its own cell. The text is two
    /// pixels in. A redraw of one item, as its selection changes, fills its
    /// whole row first (seg35 `1096`) -- and a list of many selections
    /// always does; painting leaves that to the erase. With `rows`, only
    /// the part of the row within them is drawn.
    pub fn list_text(
        &mut self,
        index: usize,
        item: i32,
        fill: bool,
        rows: Option<(i32, i32)>,
    ) -> Result<(), Stop> {
        let selected = self.is_selected(index, item);
        let (top_item, height) = {
            let list = self.list_state(index);

            (list.top, list.height)
        };
        let Some(font) = self.control_drawing_font(index)? else {
            return Ok(());
        };
        let Some(bitmap) = self.window_view(index) else {
            return Ok(());
        };
        let window = self.control_window(index);
        let (width, client_height) = (window.client_width(), window.client_height());
        let control = window.control.as_ref().expect("a control");
        let fill = fill || control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL) != 0;
        let text = usize::try_from(item)
            .ok()
            .and_then(|item| control.items.get(item))
            .map(|item| bytes_of(item))
            .unwrap_or_default();
        let (env, ground) = control_env(self, control.colours, false, false);
        let painter = Painter::new(bitmap.clone(), 0, 0, width, client_height, &env);
        let y = (item - top_item) * height;
        let (low, high) = rows.unwrap_or((y, y + height));
        let top = y.max(low);
        let bottom = (y + height).min(high);

        if selected || fill {
            painter.fill(
                0,
                top,
                width,
                bottom,
                painter.colour(if selected {
                    COLOR_HIGHLIGHT
                } else {
                    COLOR_WINDOW
                }),
            );
        }

        let back = if selected {
            env.sys_color(COLOR_HIGHLIGHT)
        } else {
            ground.unwrap_or_else(|| env.sys_color(COLOR_WINDOW))
        };
        let ink = env.sys_color(if selected {
            COLOR_HIGHLIGHTTEXT
        } else {
            COLOR_WINDOWTEXT
        });

        write_text(
            self,
            &clipped(&bitmap, [0, top, width, bottom]),
            &font,
            ink,
            Some(back),
            2,
            y,
            &text,
        );
        bitmap.context.mark_rect(0, 0, width, client_height);
        Ok(())
    }

    /// Moves a list box's client pixels down by `dy`, clearing rows `from`
    /// to `to` in the window colour, as `ScrollWindow` and the erase after
    /// it do -- in the system's window colour, not what the parent
    /// answered, as the TypeScript engine clears them.
    pub fn list_scroll_client(&mut self, index: usize, dy: i32, from: i32, to: i32) {
        let Some(bitmap) = self.window_view(index) else {
            return;
        };
        let window = self.control_window(index);
        let (width, height) = (window.client_width(), window.client_height());
        let rows: Vec<Vec<Option<u8>>> = (0..height)
            .map(|y| (0..width).map(|x| bitmap.index_at(x, y)).collect())
            .collect();

        for y in 0..height {
            let source = y - dy;

            if source < 0 || source >= height {
                continue;
            }

            for x in 0..width {
                if let Some(value) = rows[source as usize][x as usize] {
                    bitmap.put(x, y, value);
                }
            }
        }

        let env = PaintEnv::new(self);
        let painter = Painter::new(bitmap.clone(), 0, 0, width, height, &env);

        painter.fill(0, from, width, to, painter.colour(COLOR_WINDOW));
        bitmap.context.mark_rect(0, 0, width, height);
    }

    /// The dotted focus rectangle on a list box's row, as `DrawFocusRect`
    /// draws it: each side a line of the grey pattern inverted, so a
    /// corner, on two sides, is inverted twice. **Recorded** by `listbox`:
    /// the inverted pixels are those whose client coordinates add to an odd
    /// number.
    pub fn list_focus_rect(&mut self, index: usize, row: i32) {
        let height = self.list_state(index).height;
        let Some(bitmap) = self.window_view(index) else {
            return;
        };
        let width = self.control_window(index).client_width();
        let top = row * height;
        let bottom = top + height - 1;
        let mask = ((1u32 << bitmap.depth) - 1) as u8;
        let flip = |x: i32, y: i32| {
            if (x + y) & 1 != 0
                && let Some(index) = bitmap.index_at(x, y)
            {
                bitmap.put(x, y, index ^ mask);
            }
        };

        for x in 0..width {
            flip(x, top);
            flip(x, bottom);
        }

        for y in top..=bottom {
            flip(0, y);
            flip(width - 1, y);
        }

        bitmap.context.mark_rect(0, top, width, bottom + 1);
    }

    /// A list box cleared in its window colour, or what its parent
    /// answered.
    pub fn list_erase(&mut self, index: usize) {
        let Some(bitmap) = self.window_view(index) else {
            return;
        };
        let window = self.control_window(index);
        let (width, height) = (window.client_width(), window.client_height());
        let colours = window.control.as_ref().and_then(|control| control.colours);
        let (env, _) = control_env(self, colours, false, false);
        let painter = Painter::new(bitmap, 0, 0, width, height, &env);

        painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));
    }

    /// A combo box's own painting (`USER.EXE` seg33 `0875`): the window
    /// colour between its field and its button; the button, raised, with
    /// the display driver's combo arrow centred on it in the button text
    /// colour, a pixel down and right while pressed; and for a drop-down
    /// list its field -- outlined in the frame colour while the list is put
    /// away, filled, and while it has the focus and the list is put away
    /// the highlight inside a pixel of the window colour, the text a pixel
    /// in. In the system colours, whatever the parent answered.
    pub fn paint_combo(
        &mut self,
        index: usize,
        combo: &ComboState,
        text: Option<&[u8]>,
    ) -> Result<(), Stop> {
        let font = self.control_drawing_font(index)?;
        let Some(bitmap) = self.window_view(index) else {
            return Ok(());
        };
        let window = self.control_window(index);
        let (width, height) = (window.client_width(), window.client_height());
        let env = PaintEnv::new(self);
        let painter = Painter::new(bitmap.clone(), 0, 0, width, height, &env);
        let [fl, ft, fr, fb] = combo.field;

        if let Some([bl, bt, br, bb]) = combo.button {
            if !combo.dropped {
                painter.fill(fr, ft, br, fb.max(bb), painter.colour(COLOR_WINDOW));
            }

            painter.thumb(bl, bt, br, bb);

            if let Some(arrow) = env.oem(OBM_COMBO) {
                let shift = i32::from(combo.pressed);
                let x = bl + (br - bl - arrow.width()) / 2 + shift;
                let y = bt + (bb - bt - arrow.height()) / 2 + shift;
                let ink = painter.colour(COLOR_BTNTEXT);
                let palette = arrow.device_palette.borrow();

                for row in 0..arrow.height() {
                    for column in 0..arrow.width() {
                        let at = usize::from(arrow.index_at(column, row).unwrap_or(0));
                        let colour = palette.colours.get(at).copied().unwrap_or([0, 0, 0]);

                        if colour.iter().map(|&part| u32::from(part)).sum::<u32>() == 0 {
                            painter.fill(x + column, y + row, x + column + 1, y + row + 1, ink);
                        }
                    }
                }
            }
        }

        if combo.kind != crate::combobox::CBS_DROPDOWNLIST {
            return Ok(());
        }

        if !combo.dropped {
            painter.outline(fl, ft, fr, fb, painter.colour(COLOR_WINDOWFRAME));
        }

        let highlighted = combo.focused && !combo.dropped;
        let rc = [fl + 1, ft + 1, fr - 1, fb - 1];

        painter.fill(rc[0], rc[1], rc[2], rc[3], painter.colour(COLOR_WINDOW));

        let rc = [rc[0] + 1, rc[1] + 1, rc[2] - 1, rc[3] - 1];

        if highlighted {
            painter.fill(rc[0], rc[1], rc[2], rc[3], painter.colour(COLOR_HIGHLIGHT));
        }

        if let (Some(text), Some(font)) = (text, font) {
            let ink = env.sys_color(if highlighted {
                COLOR_HIGHLIGHTTEXT
            } else {
                COLOR_WINDOWTEXT
            });

            write_text(
                self,
                &clipped(&bitmap, rc),
                &font,
                ink,
                None,
                rc[0] + 1,
                rc[1] + 1,
                text,
            );
            bitmap.context.mark_rect(0, 0, width, height);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_paint::tests::one_window;
    use crate::painter::ScrollTrack;

    /// A held page is cut back along the bar as the frame painted it. A
    /// window without edges but with a menu bar has its vertical bar from
    /// the client area's top, not a pixel above it as `scroll_bar_rect`
    /// has it, so the thumb at the bottom of the range is where the
    /// painted bar puts it.
    #[test]
    fn a_held_page_is_cut_back_along_the_painted_bar() {
        let (mut system, index, _) = one_window();
        let client = Rect {
            left: 0,
            top: 20,
            right: 183,
            bottom: 120,
        };
        let page = ScrollTrack {
            part: 2,
            start: 17,
            end: 1000,
            pressed: true,
            outline: None,
        };

        {
            let window = system.windows[index].as_mut().unwrap();

            window.style = WS_VSCROLL;
            window.client = client;
            *window.scroll_bars.vertical() = ScrollState {
                min: 0,
                max: 100,
                pos: 100,
                flags: 0,
                track: Some(page),
            };
        }

        let thumb_top = |length| {
            scroll_geometry(|metric| system.metric(metric), length, true, 0, 100, 100)
                .unwrap()
                .thumb_top
        };
        let painted = thumb_top(121 - 20);
        let [_, top, _, bottom] = system.scroll_bar_rect(index, true);

        assert_ne!(painted, thumb_top(bottom - top));

        system.settle_frame_tracks(index, client);

        let window = system.windows[index].as_ref().unwrap();
        let track = window.scroll_bars.vertical.unwrap().track.unwrap();

        assert_eq!(track.end, painted);
        assert_eq!(track.start, 17);
    }
}
