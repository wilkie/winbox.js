//! What USER draws around a window, as winbox.js's `frame.ts` draws it: its
//! border or sizing frame, its caption, the system menu, minimize and
//! maximize boxes, its menu bar and its scroll bars -- the non-client area
//! -- into the screen's pixels.
//!
//! Every rule here is read off the `chrome` probe's captures:
//!
//! * A sizing frame is `SM_CXFRAME` wide: a line in the window frame colour,
//!   the rest in the border colour, and another line inside it. A notch of
//!   the frame colour crosses it `SM_CXFRAME + SM_CXSIZE` from each corner.
//! * A thin border is one line; a dialog frame is one line and
//!   `SM_CXDLGFRAME` in the caption colour.
//! * A caption is `SM_CYCAPTION` tall, its first and last rows lines, on the
//!   frame's inner line or the border itself. The system menu box is the
//!   left half of the display driver's `OBM_CLOSE`, then a line; the
//!   maximize box is `OBM_ZOOM` against the right edge and the minimize box
//!   `OBM_REDUCE` beside it, each 19 wide with its own separating line. The
//!   title is centred in what is left.
//! * Active and inactive windows differ only in colours: the caption, the
//!   caption text and the border.
//! * A menu bar is `SM_CYMENU` of the menu colour under the caption, then a
//!   line; each item is its text with eight pixels either side, its
//!   mnemonic underlined a row below the font's ascent.
//! * A scroll bar is `SM_CXVSCROLL` or `SM_CYHSCROLL` of the scroll bar
//!   colour, outlined, sharing its edge lines with what is next to it: the
//!   driver's arrow bitmaps at its ends, and a raised thumb overlapping the
//!   first. Both bars fill the box between them.
//! * Every area is filled with a brush of its colour, so a colour the
//!   display lacks is patterned as the driver patterns a brush -- the
//!   Hercules's grey border is a checkerboard.
//!
//! The OEM bitmaps are the display driver's own, read from the installation
//! the person supplied.

use winbox_raster::{DeviceBitmap, LogicalFont, Measure};

use crate::gdi::text_out::Writer;
use crate::menu_bar::{MENU_GAP, bar_layout};
use crate::painter::{Painter, ScrollPaint};
use crate::system::System;
use crate::windows::Rect;

const WS_CAPTION: u32 = 0x00c0_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_DLGFRAME: u32 = 0x0040_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;

const OBM_CLOSE: u16 = 32754;
const OBM_REDUCE: u16 = 32749;
const OBM_ZOOM: u16 = 32748;
const OBM_RESTORE: u16 = 32747;

const SM_CXVSCROLL: i16 = 2;
const SM_CYHSCROLL: i16 = 3;
const SM_CYCAPTION: i16 = 4;
const SM_CXDLGFRAME: i16 = 7;
const SM_CYDLGFRAME: i16 = 8;
const SM_CYMENU: i16 = 15;
const SM_CXSIZE: i16 = 30;
const SM_CYSIZE: i16 = 31;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;

const COLOR_SCROLLBAR: usize = 0;
const COLOR_ACTIVECAPTION: usize = 2;
const COLOR_INACTIVECAPTION: usize = 3;
const COLOR_MENU: usize = 4;
const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWFRAME: usize = 6;
const COLOR_MENUTEXT: usize = 7;
const COLOR_CAPTIONTEXT: usize = 9;
const COLOR_ACTIVEBORDER: usize = 10;
const COLOR_INACTIVEBORDER: usize = 11;
const COLOR_HIGHLIGHT: usize = 13;
const COLOR_HIGHLIGHTTEXT: usize = 14;
const COLOR_GRAYTEXT: usize = 17;
const COLOR_INACTIVECAPTIONTEXT: usize = 19;

/// A string's characters as the bytes a font draws.
pub fn bytes_of(text: &str) -> Vec<u8> {
    text.chars().map(|c| c as u8).collect()
}

/// A colour as text is drawn in it.
pub fn rgba(colorref: u32) -> [u8; 4] {
    [
        colorref as u8,
        (colorref >> 8) as u8,
        (colorref >> 16) as u8,
        0xff,
    ]
}

/// A font USER draws its own text in -- the System font, an icon title's,
/// or a control's -- with the height and ascent `GetTextMetrics` gives it,
/// and its overhang.
#[derive(Debug, Clone)]
pub struct Lettering {
    pub font: LogicalFont,
    pub height: i32,
    pub ascent: i32,
    pub overhang: i32,
    pub average: i32,
}

impl Lettering {
    pub fn of(font: LogicalFont) -> Self {
        let metrics = crate::fonts::text_metrics(&font);

        Self {
            font,
            height: metrics.height,
            ascent: metrics.ascent,
            overhang: metrics.overhang,
            average: metrics.ave_char_width,
        }
    }

    /// The width of a line of text.
    pub fn measure(&self, line: &[u8]) -> i32 {
        self.font.measure(line, Measure::default()).0 as i32
    }

    /// A line of text, its cell's top left at `x, y` of `bitmap`, in a
    /// colour, nothing behind it.
    pub fn text(
        &self,
        system: &System,
        bitmap: &DeviceBitmap,
        line: &[u8],
        colour: u32,
        x: i32,
        y: i32,
    ) {
        let mut writer = Writer::user(system, bitmap.clone(), self.font.clone(), rgba(colour));

        // A strike's region of negative size, the only way drawing text can
        // fail, comes of a negative character extra, which USER's own text
        // never has.
        let _ = writer.fill_text(i64::from(x), i64::from(y), line);
    }
}

/// What a frame is drawn from.
#[derive(Debug, Clone, Default)]
#[allow(clippy::struct_excessive_bools)]
pub struct Frame<'a> {
    pub style: u32,
    /// The scroll bars' ranges and positions, where the thumbs go: vertical
    /// and horizontal; 0 to 100 at 0 without.
    pub scroll: [Option<ScrollPaint>; 2],
    /// The class's background, which a scroll bar with both arrows off
    /// shows.
    pub background: Option<u32>,
    pub active: bool,
    pub title: &'a str,
    /// The menu bar's items, as `AppendMenu` was given them, `&` and all.
    pub menu: Option<&'a [String]>,
    pub menu_grayed: Option<&'a [bool]>,
    /// The menu bar's item that is selected, while a menu is open from it.
    pub menu_selected: Option<usize>,
    /// Whether the system menu is open, which shows its box inverted.
    pub system_menu_open: bool,
    /// Whether the window is maximized: its maximize box is then a restore
    /// box.
    pub zoomed: bool,
    /// A dialog's modal frame, `DS_MODALFRAME`: a dialog frame around a
    /// caption.
    pub modal: bool,
}

/// Paints a window's non-client area through `painter`, whose corner is
/// the window's, and answers its client rectangle, relative to the window.
/// Text is drawn in the System font, `letters`.
#[allow(clippy::too_many_lines)]
pub fn paint_frame(painter: &Painter, frame: &Frame, letters: &Lettering) -> Rect {
    let env = painter.env;
    let (width, height) = (painter.width, painter.height);
    let colour = |system: usize| painter.colour(system);
    let line = colour(COLOR_WINDOWFRAME);
    let style = frame.style;
    let has_caption = style & WS_CAPTION == WS_CAPTION;
    let thick = style & WS_THICKFRAME != 0;
    let modal = frame.modal;
    // A dialog frame before a sizing frame: `WS_EX_DLGMODALFRAME`, or
    // `WS_DLGFRAME` without `WS_BORDER`, is laid out and drawn as one with
    // `WS_THICKFRAME` too (`USER.EXE` seg1 `6fed`, `9fa5`), and `nchit`
    // records its client area five pixels in.
    let dialog = modal || (!has_caption && style & WS_DLGFRAME != 0);
    let bordered = has_caption || style & WS_BORDER != 0;

    // The edges, and where inside them the window's own area starts.
    let mut inset = 0;
    let mut inset_y = 0;

    if thick && !dialog {
        inset = env.metric(SM_CXFRAME);
        inset_y = env.metric(SM_CYFRAME);

        let border = colour(if frame.active {
            COLOR_ACTIVEBORDER
        } else {
            COLOR_INACTIVEBORDER
        });

        painter.fill(0, 0, width, inset_y, border);
        painter.fill(0, height - inset_y, width, height, border);
        painter.fill(0, 0, inset, height, border);
        painter.fill(width - inset, 0, width, height, border);
        painter.outline(0, 0, width, height, line);
        painter.outline(
            inset - 1,
            inset_y - 1,
            width - inset + 1,
            height - inset_y + 1,
            line,
        );

        // The notches, where a drag on the frame sizes a corner rather than
        // an edge.
        let across = inset + env.metric(SM_CXSIZE);
        let down = inset_y + env.metric(SM_CYSIZE);

        for x in [across, width - 1 - across] {
            painter.fill(x, 1, x + 1, inset_y - 1, line);
            painter.fill(x, height - inset_y + 1, x + 1, height - 1, line);
        }

        for y in [down, height - 1 - down] {
            painter.fill(1, y, inset - 1, y + 1, line);
            painter.fill(width - inset + 1, y, width - 1, y + 1, line);
        }
    } else if dialog {
        let edge = env.metric(SM_CXDLGFRAME);
        let edge_y = env.metric(SM_CYDLGFRAME);
        let ring = colour(if frame.active {
            COLOR_ACTIVECAPTION
        } else {
            COLOR_INACTIVECAPTION
        });

        inset = edge + 1;
        inset_y = edge_y + 1;
        painter.fill(0, 0, width, inset_y, ring);
        painter.fill(0, height - inset_y, width, height, ring);
        painter.fill(0, 0, inset, height, ring);
        painter.fill(width - inset, 0, width, height, ring);
        painter.outline(0, 0, width, height, line);
    } else if bordered {
        painter.outline(0, 0, width, height, line);
        inset = 1;
        inset_y = 1;
    }

    let mut client = Rect {
        left: inset,
        top: inset_y,
        right: width - inset,
        bottom: height - inset_y,
    };

    if has_caption {
        client.top = paint_caption(painter, frame, letters, inset, inset_y, thick, modal);
    }

    if let Some(menu) = frame.menu {
        client.top = paint_menu(painter, frame, menu, letters, inset, client.top);
    }

    paint_scroll_bars(painter, frame, &mut client, inset, inset_y);
    client
}

/// The caption and its boxes; where the client area would start.
///
/// Its top row is the frame's inner line, or the border. In a modal frame
/// it is the ring's inner row, and the caption's top row and its two sides
/// are the window colour: measured by the `dialogs` probe, and which colour
/// by `dlgcolor`, which turned each of the white system colours red in
/// turn. What is in the caption starts a pixel in.
fn paint_caption(
    painter: &Painter,
    frame: &Frame,
    letters: &Lettering,
    inset: i32,
    inset_y: i32,
    thick: bool,
    modal: bool,
) -> i32 {
    let env = painter.env;
    let width = painter.width;
    let style = frame.style;
    let line = painter.colour(COLOR_WINDOWFRAME);
    let caption_top = if thick || modal { inset_y - 1 } else { 0 };
    let caption_height = env.metric(SM_CYCAPTION);
    let row_top = caption_top + 1;
    let row_bottom = caption_top + caption_height - 1;
    let edge = if modal { inset + 1 } else { inset };

    if modal {
        let window = painter.colour(COLOR_WINDOW);

        painter.fill(inset, caption_top, width - inset, caption_top + 1, window);
        painter.fill(
            inset,
            caption_top,
            edge,
            caption_top + caption_height,
            window,
        );
        painter.fill(
            width - edge,
            caption_top,
            width - inset,
            caption_top + caption_height,
            window,
        );
    }

    painter.fill(
        edge,
        caption_top + caption_height - 1,
        width - edge,
        caption_top + caption_height,
        line,
    );

    let mut bar_left = edge;
    let mut bar_right = width - edge;

    if style & WS_SYSMENU != 0 {
        let close = env.oem(OBM_CLOSE);
        let size = close.map_or_else(|| env.metric(SM_CXSIZE), |close| close.width() / 2);

        painter.blit(close, edge, row_top, size);
        painter.fill(edge + size, row_top, edge + size + 1, row_bottom, line);

        if frame.system_menu_open {
            painter.invert(edge, row_top, edge + size, row_bottom);
        }

        bar_left = edge + size + 1;
    }

    if style & WS_MAXIMIZEBOX != 0 {
        let zoom = env.oem(if frame.zoomed { OBM_RESTORE } else { OBM_ZOOM });
        let size = zoom.map_or_else(|| env.metric(SM_CXSIZE) + 1, DeviceBitmap::width);

        bar_right -= size;
        painter.blit(zoom, bar_right, row_top, size);
    }

    if style & WS_MINIMIZEBOX != 0 {
        let reduce = env.oem(OBM_REDUCE);
        let size = reduce.map_or_else(|| env.metric(SM_CXSIZE) + 1, DeviceBitmap::width);

        bar_right -= size;
        painter.blit(reduce, bar_right, row_top, size);
    }

    painter.fill(
        bar_left,
        row_top,
        bar_right,
        row_bottom,
        painter.colour(if frame.active {
            COLOR_ACTIVECAPTION
        } else {
            COLOR_INACTIVECAPTION
        }),
    );

    // The title, centred in what the boxes leave -- and not held to it.
    let title = bytes_of(frame.title);
    let colour = env.sys_color(if frame.active {
        COLOR_CAPTIONTEXT
    } else {
        COLOR_INACTIVECAPTIONTEXT
    });
    let [left, top, right, bottom] = [
        painter.left + bar_left,
        painter.top + row_top,
        painter.left + bar_right,
        painter.top + row_bottom,
    ];

    letters.text(
        env.system,
        &painter.screen,
        &title,
        colour,
        left + (right - left - letters.measure(&title)).div_euclid(2),
        top + (bottom - top - letters.height).div_euclid(2),
    );

    caption_top + caption_height
}

/// The menu bar, from `from`; where the client area starts below it.
///
/// The text's cell is one pixel less than centred in the bar: 0 in the
/// VGA's 18 for a font of 16, 1 in the EGA's 16 for a font of 12. Its rows
/// are a pixel taller than the bar each, the line under the last
/// (`menuhelp`).
fn paint_menu(
    painter: &Painter,
    frame: &Frame,
    menu: &[String],
    letters: &Lettering,
    inset: i32,
    from: i32,
) -> i32 {
    let env = painter.env;
    let width = painter.width;
    let bar = env.metric(SM_CYMENU);
    let cell = ((bar - letters.height) >> 1) - 1;
    let underline = cell + letters.ascent + 1;
    let measure = |text: &str| letters.measure(&bytes_of(text));
    let (items, rows) = bar_layout(menu, measure, inset, width - inset);
    let height = rows * (bar + 1) - 1;
    let line = painter.colour(COLOR_WINDOWFRAME);

    painter.fill(
        inset,
        from,
        width - inset,
        from + height,
        painter.colour(COLOR_MENU),
    );
    painter.fill(inset, from + height, width - inset, from + height + 1, line);

    for (index, item) in items.iter().enumerate() {
        let label = bytes_of(&item.text);
        let at = label.iter().position(|&byte| byte == b'&');
        let mut text = label.clone();

        if let Some(at) = at {
            text.remove(at);
        }

        let selected = frame.menu_selected == Some(index);
        // A grayed item's text is `COLOR_GRAYTEXT`, as in a pop-up:
        // Leapfrog grays its Undo, Up and Down.
        let grayed = !selected
            && frame
                .menu_grayed
                .is_some_and(|grayed| grayed.get(index).copied().unwrap_or(false));
        let text_colour = if selected {
            COLOR_HIGHLIGHTTEXT
        } else if grayed {
            COLOR_GRAYTEXT
        } else {
            COLOR_MENUTEXT
        };
        let ink = painter.colour(text_colour);
        let x = item.left;
        let y = from + item.row * (bar + 1);

        // A selected item: the highlight, the text's width and the space
        // either side.
        if selected {
            painter.fill(x, y, item.right, y + bar, painter.colour(COLOR_HIGHLIGHT));
        }

        letters.text(
            env.system,
            &painter.screen,
            &text,
            env.sys_color(text_colour),
            painter.left + x + MENU_GAP,
            painter.top + y + cell,
        );

        // The mnemonic, underlined.
        if let Some(at) = at.filter(|&at| at < text.len()) {
            let under = x + MENU_GAP + letters.measure(&text[..at]);

            painter.fill(
                under,
                y + underline,
                under + letters.measure(&text[at..=at]),
                y + underline + 1,
                ink,
            );
        }
    }

    from + height + 1
}

/// The scroll bars, and the box between them.
///
/// A bar shares its outer line with the window's edge when there is one; a
/// window without edges has its bars at its own edge (`USER.EXE` seg18
/// `0f5f`), as `mledit`'s borderless edit control records.
fn paint_scroll_bars(
    painter: &Painter,
    frame: &Frame,
    client: &mut Rect,
    inset: i32,
    inset_y: i32,
) {
    let env = painter.env;
    let style = frame.style;
    let trough = painter.colour(COLOR_SCROLLBAR);
    let across = env.metric(SM_CXVSCROLL);
    let down = env.metric(SM_CYHSCROLL);

    // No room left below the caption and menu bar: the client area is
    // empty there, and neither bar is laid out; else the vertical bar where
    // the style asks, and the horizontal one where more than its height is
    // left (`USER.EXE` seg1 `70b7`, `70e3`, recorded by `nchit`).
    let room = client.bottom - client.top;

    if room <= 0 {
        client.bottom = client.top;
    }

    let vertical = style & WS_VSCROLL != 0 && room > 0;
    let horizontal = style & WS_HSCROLL != 0 && room > down;
    let overlap = i32::from(inset > 0 || inset_y > 0);
    let place = |given: Option<ScrollPaint>| {
        given.map_or_else(ScrollPaint::default, |given| ScrollPaint {
            shaft: frame.background,
            ..given
        })
    };

    if vertical {
        client.right -= across - overlap;
    }

    if horizontal {
        client.bottom -= down - overlap;
    }

    if vertical {
        painter.scroll_bar(
            client.right,
            client.top - overlap,
            client.right + across,
            client.bottom + 1,
            true,
            &mut place(frame.scroll[0]),
        );
    }

    if horizontal {
        painter.scroll_bar(
            client.left - overlap,
            client.bottom,
            client.right + 1,
            client.bottom + down,
            false,
            &mut place(frame.scroll[1]),
        );
    }

    if vertical && horizontal {
        painter.fill(
            client.right + 1,
            client.bottom + 1,
            client.right + across - overlap,
            client.bottom + down - overlap,
            trough,
        );
    }
}
