//! USER's text drawing, which draws with GDI's: text laid out in a
//! rectangle (`DrawText`), text with its tabs expanded to stops
//! (`TabbedTextOut`), and text greyed as a disabled control's is
//! (`GrayString`). Each draws through `TextOut`, as the TypeScript engine's
//! do, so what `TextOut` draws -- the ground, the glyphs, the rules, the
//! current position -- each of them draws.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]
// Deliberately: coordinates in a JavaScript number's precision, as the
// TypeScript engine's are.
#![allow(clippy::cast_precision_loss)]

use winbox_cpu::{AX, DS, ES, SS};
use winbox_raster::text_draw::fill_rect;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::gdi::GdiObject;
use crate::gdi::bitmaps::create_bitmap;
use crate::gdi::dc::{create_compatible_dc, dc_of, delete_dc, select_object, set_text_color};
use crate::gdi::objects::delete_object;
use crate::gdi::text::{
    Text, get_text_extent, get_text_metrics, system_font_object, tab_average, text_argument,
};
use crate::gdi::text_out::{
    Bounds, colour_in, device_rect, keep_pixels, restore_outside, target_of, text_out,
};
use crate::handles::Object;
use crate::system::System;

pub fn user_implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "DrawText" => Implementation::Sync(draw_text_call),
        "TabbedTextOut" => Implementation::Sync(tabbed_text_out_call),
        "GrayString" => Implementation::Async(gray_string),
        _ => return None,
    })
}

const DT_CENTER: u16 = 0x0001;
const DT_RIGHT: u16 = 0x0002;
const DT_VCENTER: u16 = 0x0004;
const DT_BOTTOM: u16 = 0x0008;
const DT_WORDBREAK: u16 = 0x0010;
const DT_SINGLELINE: u16 = 0x0020;
const DT_EXPANDTABS: u16 = 0x0040;
const DT_TABSTOP: u16 = 0x0080;
const DT_NOCLIP: u16 = 0x0100;
const DT_EXTERNALLEADING: u16 = 0x0200;
const DT_CALCRECT: u16 = 0x0400;
const DT_NOPREFIX: u16 = 0x0800;

/// A string with its prefix characters taken out (`USER.EXE` seg1
/// `10c4`): the string, where the underlined character is -- the last `&`
/// alone marks it -- and how many characters went. `&&` is an `&`.
fn strip_prefix(text: &[u8]) -> (Vec<u8>, Option<usize>, usize) {
    let mut out = Vec::with_capacity(text.len());
    let mut index = None;
    let mut at = 0;

    while at < text.len() {
        if text[at] != b'&' {
            out.push(text[at]);
        } else if text.get(at + 1) == Some(&b'&') {
            out.push(b'&');
            at += 1;
        } else {
            index = Some(out.len());
        }

        at += 1;
    }

    let removed = text.len() - out.len();

    (out, index, removed)
}

/// The rectangle `DrawText` is given, as the structure the TypeScript
/// engine reads it into: its sides as read, and each side written back to
/// the program's memory as it is set, as a word.
struct DrawRect {
    far: u32,
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

impl DrawRect {
    fn read(system: &System, far: u32) -> Self {
        let bytes = system.read_far(far, 8);
        let side = |at: usize| i64::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

        Self {
            far,
            left: side(0),
            top: side(2),
            right: side(4),
            bottom: side(6),
        }
    }

    /// A side's word, `at` bytes into the structure.
    fn side(&self, at: u32) -> u32 {
        (self.far & 0xffff_0000) | (self.far.wrapping_add(at) & 0xffff)
    }

    fn set_right(&mut self, system: &mut System, value: i64) {
        self.right = value;
        system.write_far(self.side(4), &(value as u16).to_le_bytes());
    }

    fn set_bottom(&mut self, system: &mut System, value: i64) {
        self.bottom = value;
        system.write_far(self.side(6), &(value as u16).to_le_bytes());
    }
}

/// What laying text out asks of the device context it is drawn in.
struct Ops {
    hdc: u16,
    index: usize,
    height: i64,
    external_leading: i64,
    overhang: i64,
    ascent: i64,
}

impl Ops {
    /// A string's width, as `GetTextExtent` answers it; nothing for none.
    fn extent(&self, system: &mut System, text: &[u8]) -> Result<i64, Stop> {
        if text.is_empty() {
            return Ok(0);
        }

        Ok(i64::from(
            get_text_extent(system, self.hdc, text, text.len() as i32)? as u16,
        ))
    }

    /// A rectangle in the text colour: a prefix's underline, painted as
    /// `ExtTextOut`'s ground is, in device terms. A device context whose
    /// text colour has never been set has none to paint with, and stops,
    /// where the TypeScript engine throws.
    fn underline(&self, system: &mut System, rect: Bounds) -> Result<(), Stop> {
        let Some(colour) = system.gdi.dcs[self.index].state.text_color else {
            return Err(Stop::Unsupported("a prefix underlined with no text colour"));
        };
        let rect = device_rect(system, self.index, rect);
        let mut target = target_of(system, self.index);
        let colour = colour_in(&target, Some(colour), [0, 0, 0, 0xff]);

        fill_rect(
            &mut target.context,
            rect.left as f64,
            rect.top as f64,
            (rect.right - rect.left) as f64,
            (rect.bottom - rect.top) as f64,
            colour,
        );
        Ok(())
    }
}

/// One laying out of text in a rectangle, as `DrawText` lays it out.
struct Layout<'a> {
    ops: &'a Ops,
    text: &'a [u8],
    format: u16,
    left: i64,
    width: i64,
    line_height: i64,
    average: i64,
    stop: i64,
    widest: i64,
}

impl Layout<'_> {
    fn calc(&self) -> bool {
        self.format & DT_CALCRECT != 0
    }

    fn no_prefix(&self) -> bool {
        self.format & DT_NOPREFIX != 0
    }

    /// A line drawn with its prefix underlined (`USER.EXE` seg1 `1168`):
    /// a row of the text colour, one below the ascent, as wide as the
    /// character less half the overhang.
    fn prefix_text_out(
        &self,
        system: &mut System,
        x: i64,
        y: i64,
        line: &[u8],
    ) -> Result<(), Stop> {
        let ops = self.ops;
        let (out, index, _) = strip_prefix(line);

        text_out(system, ops.hdc, x, y, &out)?;

        let Some(index) = index else {
            return Ok(());
        };
        let ux = x + if index > 0 {
            ops.extent(system, &out[..index])? - ops.overhang
        } else {
            0
        };
        let character = [out.get(index).copied().unwrap_or(0)];
        let cw = ops.extent(system, &character)?;
        let uy = y + ops.ascent + 1;

        ops.underline(
            system,
            Bounds {
                left: ux,
                top: uy,
                right: ux + cw - ops.overhang / 2,
                bottom: uy + 1,
            },
        )
    }

    /// A line measured, or drawn, from `x` (`USER.EXE` seg6 `0360`):
    /// where it ends.
    fn draw_line(
        &mut self,
        system: &mut System,
        mut x: i64,
        y: i64,
        start: usize,
        end: usize,
        measure: bool,
    ) -> Result<i64, Stop> {
        let ops = self.ops;
        let line = &self.text[start..end];
        let adjust = if self.no_prefix() {
            0
        } else {
            let removed = strip_prefix(line).2 as i64;

            removed * (ops.extent(system, b"&")? - ops.overhang)
        };
        let mut origin = self.left;

        if !measure && self.format & (DT_CENTER | DT_RIGHT) != 0 {
            let spare = self.width - self.draw_line(system, 0, y, start, end, true)?;

            origin = if self.format & DT_CENTER != 0 {
                spare.div_euclid(2)
            } else {
                spare
            } + self.left;
        }

        let put = |layout: &Self, system: &mut System, at: i64, piece: &[u8]| {
            if measure || layout.calc() {
                return Ok(());
            }

            if layout.no_prefix() {
                text_out(system, ops.hdc, at, y, piece).map(|_| ())
            } else {
                layout.prefix_text_out(system, at, y, piece)
            }
        };

        if !measure && self.format & DT_EXPANDTABS == 0 {
            put(self, system, x + origin, line)?;
            x += ops.extent(system, line)? - adjust;
        } else {
            let pieces: Vec<&[u8]> = line.split(|&byte| byte == b'\t').collect();

            for (at, piece) in pieces.iter().enumerate() {
                put(self, system, x + origin, piece)?;
                x += ops.extent(system, piece)? - ops.overhang - adjust;

                if at < pieces.len() - 1 && self.stop != 0 {
                    x = ((x + self.average / 2) / self.stop + 1) * self.stop;
                }
            }
        }

        x += ops.overhang;

        if !measure {
            self.widest = self.widest.max(x);
        }

        Ok(x)
    }

    /// The next piece from `p`: a word, or a space or a tab by itself
    /// (`USER.EXE` seg6 `0311`).
    fn chunk(&self, p: usize, word_break: bool) -> usize {
        let text = self.text;
        let c = text[p];

        if c == b'\t' || (word_break && c == b' ') {
            return p + 1;
        }

        let mut q = p;

        while q < text.len() {
            let d = text[q];

            if d == b'\r' || d == b'\n' || d == b'\t' || (word_break && d == b' ') {
                break;
            }

            q += 1;
        }

        q
    }

    /// The lines laid out from the top: where the last one starts.
    fn run(&mut self, system: &mut System, rect: &DrawRect) -> Result<i64, Stop> {
        let ops = self.ops;
        let text = self.text;
        let top = rect.top;
        let mut y = top;

        if self.format & DT_SINGLELINE != 0 {
            let place = self.format & (DT_VCENTER | DT_BOTTOM);

            if place == DT_VCENTER {
                y = top + (rect.bottom - top - ops.height) / 2;
            } else if place == DT_BOTTOM {
                y = rect.bottom - ops.height;
            }

            self.draw_line(system, 0, y, 0, text.len(), false)?;
            return Ok(y);
        }

        let word_break = self.format & DT_WORDBREAK != 0;
        let left_aligned = self.format & (DT_CENTER | DT_RIGHT) == 0;
        let (mut line_start, mut line_end, mut p) = (0, 0, 0);
        let mut across = 0;

        while p < text.len() {
            let mut q = self.chunk(p, word_break);
            let mut done = false;

            line_end = q;
            across = self.draw_line(system, across, 0, p, q, true)? - ops.overhang;

            if word_break && across + ops.overhang > self.width && p != line_start {
                if left_aligned && text[p] == b' ' {
                    p += 1;
                }

                line_end = p;
                done = true;
            } else if q < text.len() && (text[q] == b'\r' || text[q] == b'\n') {
                let first = text[q];

                q += 1;

                if q < text.len() && text[q] == first ^ 7 {
                    q += 1;
                }

                done = true;

                if left_aligned && q < text.len() && text[q] == b' ' {
                    q += 1;
                }

                p = q;
            } else {
                p = q;
            }

            if done {
                self.draw_line(system, 0, y, line_start, line_end, false)?;
                across = 0;
                y += self.line_height;
                line_start = p;
                line_end = p;

                if self.format & (DT_NOCLIP | DT_CALCRECT) == 0 && y > rect.bottom {
                    break;
                }
            }
        }

        self.draw_line(system, 0, y, line_start, line_end, false)?;
        Ok(y)
    }
}

/// Text drawn inside a rectangle, broken into lines, aligned, its prefix
/// character underlined and its tabs expanded: `DrawText`.
///
/// **Read out of `USER.EXE`** (seg6 `0571`; the prefix, seg1 `10c4`,
/// `1168`) and **recorded** by `drawtext` on four displays.
///
/// * **Lines** end at CR, LF, CR LF or LF CR. With `DT_WORDBREAK`, the text
///   is taken a word, a space or a tab at a time, and a line ends before
///   the piece that would take it past the rectangle's width -- never
///   inside a word, so a word too long overflows. Left-aligned, a space
///   that would have gone past is dropped, and after a line end one
///   leading space is too. A line's height is the font's, and its external
///   leading with `DT_EXTERNALLEADING`.
/// * **One line**, with `DT_SINGLELINE`: CR and LF are characters, and it
///   goes at the top, at the bottom with `DT_BOTTOM`, or halfway with
///   `DT_VCENTER`, the half rounded towards nought.
/// * **Across**, centred lines take half what is left over, rounded down.
/// * **The prefix**: `&` is dropped and the character after it
///   underlined; `&&` is an `&`.
/// * **Tabs**, with `DT_EXPANDTABS`, go to the next stop past half an
///   average character on, a stop every eight averages -- `DT_TABSTOP`
///   gives the count in the format's high byte, and loses the flags there.
///   The average is USER's own for the System font, and `tmAveCharWidth`
///   for any other.
/// * **Clipped** to the rectangle unless `DT_NOCLIP`, and lines stop once
///   one would start past its bottom.
/// * **`DT_CALCRECT`** draws nothing: the rectangle's right is set to its
///   left and the widest line, and its bottom to the last line's. A line
///   wider than the rectangle lays the text out again at that width.
///
/// The answer is how far down the last line ends, from the rectangle's
/// top. A rectangle with no width, or a count of nought, draws nothing and
/// answers the top, negated; `DT_CALCRECT` then takes the widest line of
/// the last `DrawText`, as USER keeps it. The rectangle is logical, as the
/// text is: where a mapping moves it, so does what the text is clipped to.
fn layout_text(
    system: &mut System,
    ops: &Ops,
    whole: &[u8],
    cch: i16,
    rect: &mut DrawRect,
    format: u16,
) -> Result<i64, Stop> {
    let original = format;
    let mut format = format;
    let mut tab_count = 8;

    if format & DT_TABSTOP != 0 {
        tab_count = i64::from((format >> 8) & 0xff);
        format &= 0xff;
    }

    let count = i64::from(cch);
    let (left, top) = (rect.left, rect.top);
    let width = rect.right - rect.left;

    if width == 0 || count == 0 {
        if format & DT_CALCRECT != 0 {
            let widest = system.draw_text_widest;

            rect.set_right(system, left + widest);
            rect.set_bottom(system, 0);
        }

        return Ok(-top);
    }

    let text = if count < 0 {
        whole
    } else {
        &whole[..whole.len().min(count as usize)]
    };
    let index = ops.index;
    let Some(average) = tab_average(system, Some(index), ops.hdc)? else {
        return Err(Stop::Unsupported("DrawText with no font"));
    };
    let line_height = ops.height
        + if format & DT_EXTERNALLEADING != 0 {
            ops.external_leading
        } else {
            0
        };
    let mut layout = Layout {
        ops,
        text,
        format,
        left,
        width,
        line_height,
        average,
        stop: average * tab_count,
        widest: 0,
    };
    let calc = layout.calc();
    let y = if format & DT_NOCLIP != 0 || calc {
        layout.run(system, rect)?
    } else {
        let clip = device_rect(
            system,
            index,
            Bounds {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            },
        );
        let target = target_of(system, index);
        let kept = keep_pixels(&target);
        let y = layout.run(system, rect);

        restore_outside(&target, &kept, clip);
        y?
    };
    let widest = layout.widest;

    system.draw_text_widest = widest;

    if calc {
        rect.set_right(system, left + widest);

        if widest > width {
            return layout_text(system, ops, whole, cch, rect, original);
        }

        rect.set_bottom(system, y + line_height);
    }

    Ok(y - top + line_height)
}

/// `DrawText`: nought for a handle that stands for nothing or a null
/// rectangle. A handle that is no device context's lays nothing out, and
/// stops once it has text to measure, where the TypeScript engine throws.
///
/// # Errors
///
/// No font, a handle that is no device context's with text to lay out, or
/// a prefix underlined in a context that has no text colour.
pub fn draw_text(
    system: &mut System,
    hdc: u16,
    text: &[u8],
    cch: i16,
    rect_far: u32,
    format: u16,
) -> Result<i16, Stop> {
    if system.handles.resolve(hdc).is_none() || rect_far == 0 {
        return Ok(0);
    }

    let metrics = get_text_metrics(system, hdc)?.flatten();

    system_font_object(system);

    let mut rect = DrawRect::read(system, rect_far);
    let width = rect.right - rect.left;

    if width == 0 || cch == 0 {
        let ops = Ops {
            hdc,
            index: 0,
            height: 0,
            external_leading: 0,
            overhang: 0,
            ascent: 0,
        };

        return Ok(layout_text(system, &ops, text, cch, &mut rect, format)? as i16);
    }

    let (Some(index), Some(metrics)) = (dc_of(system, hdc), metrics) else {
        return Err(Stop::Unsupported("DrawText with no font"));
    };
    let ops = Ops {
        hdc,
        index,
        height: i64::from(metrics.height),
        external_leading: i64::from(metrics.external_leading),
        overhang: i64::from(metrics.overhang),
        ascent: i64::from(metrics.ascent),
    };

    Ok(layout_text(system, &ops, text, cch, &mut rect, format)? as i16)
}

fn draw_text_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let cch = args.signed(system);
    let rect = args.dword(system);
    let format = args.word(system);
    // A null string is none, and one whose segment is nought a number,
    // which the TypeScript engine lays out as its digits.
    let text = match text_argument(system, far) {
        Text::Read(text) => text,
        Text::Refused => return Ok(Answer::Word(0)),
        Text::Absent if far == 0 => Vec::new(),
        Text::Absent => (far & 0xffff).to_string().into_bytes(),
    };

    Ok(Answer::Word(
        draw_text(system, hdc, &text, cch, rect, format)? as u16,
    ))
}

/// Text with its tabs expanded to stops, drawn a piece at a time with
/// `TextOut`. **Recorded** by `tabtext`, in the System font:
///
/// * With no stops, there is one every eight average characters, 64 pixels
///   on the VGA -- the average USER counts `DrawText`'s tabs in.
/// * With one, its distance repeats.
/// * With several, each tab goes to the first stop past where the text has
///   got to, and past the last to the next of the default stops.
/// * The stops count from the tab origin, not from where the text starts.
/// * It answers the width from where the text starts to where it ends, and
///   the font's height above it.
///
/// Not recorded: another font's stops, taken as `DrawText`'s are, from
/// `tmAveCharWidth`; and what the background between the pieces is
/// painted. Nought for a handle that stands for nothing.
///
/// # Errors
///
/// A handle that is no device context's, or no font, with text to draw.
pub fn tabbed_text_out(
    system: &mut System,
    hdc: u16,
    (x, y): (i64, i64),
    text: &[u8],
    stops: &[i64],
    origin: i64,
) -> Result<u32, Stop> {
    if system.handles.resolve(hdc).is_none() {
        return Ok(0);
    }

    let index = dc_of(system, hdc);
    let spacing = tab_average(system, index, hdc)?.map(|average| 8 * average);
    let next = |at: i64| -> i64 {
        let past = at - origin;

        if stops.len() == 1 && stops[0] > 0 {
            return origin + (past.div_euclid(stops[0]) + 1) * stops[0];
        }

        if stops.len() > 1
            && let Some(stop) = stops.iter().copied().find(|&stop| stop > past)
        {
            return origin + stop;
        }

        match spacing {
            Some(spacing) if spacing > 0 => origin + (past.div_euclid(spacing) + 1) * spacing,
            _ => at,
        }
    };
    let mut pieces = Vec::new();
    let mut at = x;

    for (piece_index, piece) in text.split(|&byte| byte == b'\t').enumerate() {
        if piece_index > 0 {
            at = next(at);
        }

        pieces.push((piece, at));

        if !piece.is_empty() {
            at += i64::from(get_text_extent(system, hdc, piece, piece.len() as i32)? as u16);
        }
    }

    for (piece, start) in pieces {
        if !piece.is_empty() {
            text_out(system, hdc, start, y, piece)?;
        }
    }

    let height = get_text_metrics(system, hdc)?
        .flatten()
        .map_or(0, |metrics| i64::from(metrics.height));

    Ok(crate::gdi::pack(at - x, height))
}

fn tabbed_text_out_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let far = args.dword(system);
    let count = args.signed(system);
    let stop_count = args.signed(system);
    let stops_far = args.dword(system);
    let origin = args.signed(system);
    let text = system.read_far(far, usize::from(count.max(0) as u16));
    let stops: Vec<i64> = if stops_far == 0 || stop_count <= 0 {
        Vec::new()
    } else {
        system
            .read_far(stops_far, stop_count as usize * 2)
            .chunks(2)
            .map(|word| i64::from(i16::from_le_bytes([word[0], word[1]])))
            .collect()
    };

    Ok(Answer::Dword(tabbed_text_out(
        system,
        hdc,
        (i64::from(x), i64::from(y)),
        &text,
        &stops,
        i64::from(origin),
    )?))
}

/// What `GrayString` sets up before it draws: the monochrome bitmap's
/// device context and the bitmap, and what they replaced.
struct Scratch {
    memory: u16,
    bitmap: u16,
    old_bitmap: u16,
    old_font: u16,
}

/// The monochrome bitmap `GrayString` draws into, white, in a device
/// context of its own with the given context's font, black text, and a
/// transparent background.
fn scratch(system: &mut System, hdc: u16, index: usize, width: i64, height: i64) -> Scratch {
    let memory = create_compatible_dc(system, hdc);
    let bitmap = create_bitmap(system, width as i16, height as i16, 1, 1, 0);
    let old_bitmap = select_object(system, memory, bitmap);
    let font = system.gdi.dcs[index]
        .state
        .font
        .and_then(|object| system.handles.lookup(Object::Gdi(object)));
    let old_font = font.map_or(0, |font| select_object(system, memory, font));

    if let Some(memory_index) = dc_of(system, memory) {
        let mut target = target_of(system, memory_index);

        fill_rect(
            &mut target.context,
            0.0,
            0.0,
            width as f64,
            height as f64,
            [0xff, 0xff, 0xff, 0xff],
        );
        set_text_color(system, memory, 0);
        system.gdi.dcs[memory_index].state.back_mode = 1;
    }

    Scratch {
        memory,
        bitmap,
        old_bitmap,
        old_font,
    }
}

/// The glyphs drawn on the scratch bitmap painted on the context in the
/// brush's colour, where across and down from the corner add up to an even
/// number; and the scratch let go.
fn finish_gray(
    system: &mut System,
    index: usize,
    scratch: &Scratch,
    brush: u16,
    at: (i64, i64),
    size: (i64, i64),
) {
    let mask = dc_of(system, scratch.memory).and_then(|memory| system.draw_target(memory));
    let brush = match system.gdi_object_of(brush) {
        Some((_, GdiObject::Brush(brush))) => Some((brush.color, brush.colorref)),
        _ => None,
    };

    if let (Some(mask), Some((color, colorref))) = (mask, brush) {
        let mut target = target_of(system, index);
        let colour = colorref.map_or(color, |colorref| colour_in(&target, Some(colorref), color));

        for py in 0..size.1 {
            for px in ((py & 1)..size.0).step_by(2) {
                if mask.index_at(px as i32, py as i32) == Some(0) {
                    target
                        .context
                        .set_pixel((at.0 + px) as i32, (at.1 + py) as i32, colour);
                }
            }
        }
    }

    if scratch.old_font != 0 {
        select_object(system, scratch.memory, scratch.old_font);
    }

    select_object(system, scratch.memory, scratch.old_bitmap);
    delete_object(system, scratch.bitmap);
    delete_dc(system, scratch.memory);
}

/// Text greyed, as a disabled control's is: `GrayString`. **Recorded** by
/// `tabtext`:
///
/// * The text is drawn black on white in the device context's font on a
///   monochrome bitmap of the size given -- the text's own extent when that
///   is nought, and all of the text when the count is nought. Only the
///   pixels of its glyphs where across and down, counted from its corner,
///   add up to an even number are then painted in the brush: a gray brush
///   makes dark grey dots, a black one black. Nothing else is touched.
/// * An output procedure, given, draws instead of the text. It is called
///   with the monochrome bitmap's device context, not the one given, the
///   data and the count.
/// * It answers TRUE.
///
/// Not recorded: a procedure that answers FALSE, and a size of nought with
/// a procedure. A handle that is no device context's answers nought.
fn gray_string(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (index, scratch, brush, at, size, procedure, data, count, stack) = {
            let mut system = engine.system();
            let hdc = args.word(&system);
            let brush = args.word(&system);
            let procedure = args.dword(&system);
            let data = args.dword(&system);
            let count = args.signed(&system);
            let x = args.signed(&system);
            let y = args.signed(&system);
            let (mut width, mut height) = (
                i64::from(args.signed(&system)),
                i64::from(args.signed(&system)),
            );
            let Some(index) = dc_of(&system, hdc) else {
                return Ok(Answer::Word(0));
            };
            let text = if procedure != 0 {
                Vec::new()
            } else if count <= 0 {
                system.read_string(data)
            } else {
                system.read_far(data, count as usize)
            };

            if procedure == 0 && (width == 0 || height == 0) {
                let extent = if text.is_empty() {
                    0
                } else {
                    get_text_extent(&mut system, hdc, &text, text.len() as i32)?
                };

                if width == 0 {
                    width = i64::from(extent & 0xffff);
                }

                if height == 0 {
                    height = i64::from(extent >> 16);
                }
            }

            if width <= 0 || height <= 0 {
                return Ok(Answer::Word(1));
            }

            let scratch = scratch(&mut system, hdc, index, width, height);

            if procedure == 0 && !text.is_empty() {
                text_out(&mut system, scratch.memory, 0, 0, &text)?;
            }

            let stack = system.cpu.segments[SS].selector;

            (
                index,
                scratch,
                brush,
                (i64::from(x), i64::from(y)),
                (width, height),
                procedure,
                data,
                count,
                stack,
            )
        };

        if procedure != 0 {
            engine
                .call_with(
                    procedure,
                    &[
                        GuestArg::Word(scratch.memory),
                        GuestArg::Long(data),
                        GuestArg::Word(count as u16),
                    ],
                    &[
                        Register::Word(AX, stack),
                        Register::Segment(DS, stack),
                        Register::Segment(ES, stack),
                    ],
                )
                .await?;
        }

        finish_gray(&mut engine.system(), index, &scratch, brush, at, size);
        Ok(Answer::Word(1))
    })
}

#[cfg(test)]
mod tests;
