//! The edit control's pixels, as winbox.js's `desktop.ts` paints them
//! (`#paintEdit`, `#paintLines`): its client area in the window colour, its
//! border inside it in the frame colour, and its text from the first
//! character or line that shows, the selection in the highlight colours --
//! in the colours its parent answered `WM_CTLCOLOR` with, where it
//! answered. What it is laid out by, and which lines show, is `edit.rs`'s
//! and `mledit.rs`'s.

use winbox_raster::{DeviceBitmap, LogicalFont};

use crate::call::Stop;
use crate::control_pixels::{clipped, write_text};
use crate::edit::{EditLayout, EditState, slice};
use crate::mledit::{FormatRect, LinesLayout, PaintRow};
use crate::painter::{PaintEnv, Painter};
use crate::system::System;

const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_WINDOWTEXT: usize = 8;
const COLOR_HIGHLIGHT: usize = 13;
const COLOR_HIGHLIGHTTEXT: usize = 14;

const ES_MULTILINE: u32 = 0x0004;
const ES_NOHIDESEL: u32 = 0x0100;

/// What an edit control is painted from, worked out before it is.
pub(crate) enum EditPixels {
    Single {
        layout: EditLayout,
        text: Vec<u8>,
        edit: EditState,
        style: u32,
        border: bool,
    },
    Lines {
        font: LogicalFont,
        layout: LinesLayout,
        rect: FormatRect,
        rows: Vec<PaintRow>,
        border: bool,
    },
}

impl System {
    /// An edit control's layout and text as it is to be painted.
    pub(crate) fn edit_pixels(&mut self, index: usize) -> Result<EditPixels, Stop> {
        let style = self.control_at(index).style;
        let border = self.control_at(index).border;

        if style & ES_MULTILINE != 0 {
            let font = self.edit_layout(index)?.font.font;
            let layout = self.lines_layout(index)?;
            let (rect, rows) = self.paint_lines(index)?;

            return Ok(EditPixels::Lines {
                font,
                layout,
                rect,
                rows,
                border,
            });
        }

        Ok(EditPixels::Single {
            layout: self.edit_layout(index)?,
            text: self.edit_text(index),
            edit: *self.edit_state(index),
            style,
            border,
        })
    }
}

/// An edit control painted, `width` by `height`, on its parent's
/// background colour `ground` where it answered one.
pub(crate) fn paint_edit(
    paint: &PaintEnv,
    bitmap: &DeviceBitmap,
    width: i32,
    height: i32,
    ground: Option<u32>,
    pixels: &EditPixels,
) {
    match pixels {
        EditPixels::Single {
            layout,
            text,
            edit,
            style,
            border,
        } => paint_single(
            paint, bitmap, width, height, ground, layout, text, edit, *style, *border,
        ),
        EditPixels::Lines {
            font,
            layout,
            rect,
            rows,
            border,
        } => paint_lines(
            paint, bitmap, width, height, ground, font, layout, rect, rows, *border,
        ),
    }
}

/// The client area in the window colour, and the border inside it.
fn ground_and_border(painter: &Painter, width: i32, height: i32, border: bool) {
    painter.fill(0, 0, width, height, painter.colour(COLOR_WINDOW));

    if border {
        painter.outline(0, 0, width, height, painter.colour(COLOR_WINDOWFRAME));
    }
}

/// A single-line edit control, as `USER.EXE` paints one (seg28 `1151`,
/// `0280`): its client area in the window colour, its border inside it in
/// the frame colour, and the text from the first character that shows,
/// clipped to the text's rectangle and its margins below. The selection,
/// while the control has the focus or keeps it anyway (`ES_NOHIDESEL`),
/// is a run in the highlight colours on a ground a pixel taller each way
/// than the text's rectangle, which the clip takes back.
#[allow(clippy::too_many_arguments)]
fn paint_single(
    paint: &PaintEnv,
    bitmap: &DeviceBitmap,
    width: i32,
    height: i32,
    ground: Option<u32>,
    layout: &EditLayout,
    text: &[u8],
    edit: &EditState,
    style: u32,
    border: bool,
) {
    let painter = Painter::new(bitmap.clone(), 0, 0, width, height, paint);

    ground_and_border(&painter, width, height, border);

    // The clip: the client area less the margins, which the text's
    // rectangle is too but for its height.
    let clip = [layout.left, layout.top, layout.right, height - layout.top];
    let inside = clipped(bitmap, clip);
    let painter = Painter::new(inside.clone(), 0, 0, width, height, paint);

    // Only the characters that fit wholly are drawn (seg28 `0521`): as many
    // from the first that shows as `GetTextExtent` keeps within the width.
    let length = text.len() as i32;
    let mut last = edit.scroll;

    while last < length && layout.measure(slice(text, edit.scroll, last + 1)) <= layout.width {
        last += 1;
    }

    // The runs either side of the selection and in it, each drawn on its
    // own (seg28 `0568`).
    let (start, end) = edit.selection();
    let shows = start != end && (edit.focused || style & ES_NOHIDESEL != 0);
    let cut = |at: i32| edit.scroll.max(at.min(last));
    let runs = if shows {
        vec![
            (edit.scroll, cut(start), false),
            (cut(start), cut(end), true),
            (cut(end), last, false),
        ]
    } else {
        vec![(edit.scroll, last, false)]
    };

    for (from, to, selected) in runs {
        if to <= from {
            continue;
        }

        // A run from the first character that shows starts at the text's
        // left; a later one, less the font's overhang (seg28 `02e6`).
        let x = if from == edit.scroll {
            layout.left
        } else {
            layout.left + layout.measure(slice(text, edit.scroll, from)) - layout.overhang
        };
        let run = slice(text, from, to);

        if selected {
            let across = layout.measure(run);

            painter.fill(
                x.max(clip[0]),
                (layout.top - 1).max(clip[1]),
                (x + across).min(clip[2]),
                (layout.bottom + 1).min(clip[3]),
                painter.colour(COLOR_HIGHLIGHT),
            );
        }

        let ink = paint.sys_color(if selected {
            COLOR_HIGHLIGHTTEXT
        } else {
            COLOR_WINDOWTEXT
        });
        // On the background colour, the cell it takes (`ctlcolor`).
        let back = if selected { None } else { ground };

        write_text(
            paint.system,
            &inside,
            &layout.font.font,
            ink,
            back,
            x,
            layout.top,
            run,
        );
    }

    bitmap.context.mark_rect(0, 0, width, height);
}

/// A multi-line edit control (`USER.EXE` seg30 `0ed8`, seg26 `0020`): the
/// window colour, its border inside it, and each line that shows from the
/// first, the selected part of a line on the highlight colour; clipped to
/// the text's rectangle, so a line only partly room for is not drawn at
/// all. On the parent's background colour, where it answered one, each
/// line's whole width (`ctlcolor`).
#[allow(clippy::too_many_arguments)]
fn paint_lines(
    paint: &PaintEnv,
    bitmap: &DeviceBitmap,
    width: i32,
    height: i32,
    ground: Option<u32>,
    font: &LogicalFont,
    layout: &LinesLayout,
    rect: &FormatRect,
    rows: &[PaintRow],
    border: bool,
) {
    let painter = Painter::new(bitmap.clone(), 0, 0, width, height, paint);

    ground_and_border(&painter, width, height, border);

    let clip = [
        rect.clip_left,
        rect.clip_top,
        width - rect.clip_left,
        (height - rect.clip_top).min(rect.bottom),
    ];
    let inside = clipped(bitmap, clip);
    let painter = Painter::new(inside.clone(), 0, 0, width, height, paint);

    for row in rows {
        if let Some(ground) = ground {
            painter.fill(
                clip[0],
                row.y.max(clip[1]),
                clip[2],
                (row.y + layout.height1).min(clip[3]),
                painter.solid(ground),
            );
        }

        for (x, text, selected) in &row.runs {
            if *selected {
                let across: i32 = text.iter().map(|&code| layout.char_width(code)).sum();

                painter.fill(
                    (*x).max(clip[0]),
                    row.y.max(clip[1]),
                    (x + across).min(clip[2]),
                    (row.y + layout.height1).min(clip[3]),
                    painter.colour(COLOR_HIGHLIGHT),
                );
            }

            let ink = paint.sys_color(if *selected {
                COLOR_HIGHLIGHTTEXT
            } else {
                COLOR_WINDOWTEXT
            });

            write_text(paint.system, &inside, font, ink, None, *x, row.y, text);
        }
    }

    bitmap.context.mark_rect(0, 0, width, height);
}
