//! The screen as a host shows it: its palette indices turned into colours,
//! as winbox.js's `Presenter` turns them, with the cursor drawn over a copy
//! of them as the display driver draws it (`cursor-api.ts`'s
//! `cursorOnScreen` and `withCursor`).

use winbox_raster::CursorImage;

use crate::handles::Object;
use crate::system::System;

/// The cursor as the display shows it: its picture, and where its top left
/// is.
#[derive(Debug, Clone)]
pub struct ShownCursor {
    pub image: CursorImage,
    pub left: i32,
    pub top: i32,
}

/// A palette's colours as the screen shows them: its entries, but where the
/// display driver puts another colour in the DAC. What a program reads back
/// is the entries; this is only for showing them.
///
/// * The Super VGA 256-colour driver writes a component of exactly 80h of
///   its first ten entries as C0h, whenever they are set
///   (`brightLowStatics`, read out of `SVGA256.DRV` and **recorded** by
///   `palshot`).
/// * The 8514/a's driver puts its twenty static colours into the DAC
///   itself as it starts, a component of exactly 80h as `BFh` but in 808080
///   (`enable_statics`; `8514.DRV` seg1 `2ab7`-`2b26`). Its `SetPalette`
///   writes what it is given (seg9 `03d4`), and GDI sends it the whole
///   palette, statics and all, where a realization changes the palette or
///   `SetSystemPaletteUse` puts the statics back (`GDI.EXE` seg22 `0e51`,
///   `0fd3`, `0af3`): from then on (`rewritten`) the statics show as they
///   are. At start-up GDI sends only the 236 between (seg22 `06f1`).
pub fn shown_colours(
    display: &crate::display::Display,
    colours: &[[u8; 3]],
    rewritten: bool,
) -> Vec<[u8; 3]> {
    if display.enable_statics && !rewritten {
        return enabled_statics(colours);
    }

    let below = display.bright_low_statics;
    let brighten = |value: u8| if value == 0x80 { 0xc0 } else { value };

    colours
        .iter()
        .enumerate()
        .map(|(index, &[red, green, blue])| {
            if index < usize::from(below) {
                [brighten(red), brighten(green), brighten(blue)]
            } else {
                [red, green, blue]
            }
        })
        .collect()
}

/// The twenty static colours as `8514.DRV`'s `Enable` writes them, the
/// first ten and then the last ten, as its routine at seg1 `2ae9` does,
/// compares and all: it holds the value it looks for and the one it
/// writes in a register, 80h and `BFh`, and on meeting 808080 writes it as it
/// is and from then on looks for 7Fh and writes 80h -- which no static
/// colour after it has.
fn enabled_statics(colours: &[[u8; 3]]) -> Vec<[u8; 3]> {
    let mut shown = colours.to_vec();
    let (mut looked, mut written) = (0x80u8, 0xbfu8);

    for index in (0..10).chain(246..256) {
        let Some(colour) = shown.get_mut(index) else {
            continue;
        };

        if colour.iter().all(|&value| value == looked) {
            (looked, written) = (looked - 1, looked);
            continue;
        }

        for value in colour.iter_mut() {
            if *value == looked {
                *value = written;
            }
        }
    }

    shown
}

impl System {
    /// The cursor as the display shows it: none while `ShowCursor` has it
    /// hidden, and before a program sets one, the arrow, as Windows starts
    /// with. A cursor of a program's own shows its own picture; a standard
    /// one, the driver's.
    pub fn cursor_on_screen(&mut self) -> Option<ShownCursor> {
        if self.cursor_count < 0 {
            return None;
        }

        let handle = self.current_cursor();
        let Some(Object::Cursor(index)) = self.handles.resolve(handle) else {
            return None;
        };
        let cursor = self.cursors.get(index)?;
        let image = cursor.image.clone().or_else(|| {
            self.driver
                .as_ref()
                .and_then(|driver| driver.cursor_images.get(&cursor.id).cloned())
        })?;
        let (x, y) = self.cursor_of();

        Some(ShownCursor {
            left: i32::from(x) - i32::from(image.hotspot.0),
            top: i32::from(y) - i32::from(image.hotspot.1),
            image,
        })
    }

    /// The cursor drawn over a copy of the screen's pixels, as the display
    /// driver draws it: kept where its mask is set, then its picture's bits
    /// flipped in.
    pub fn with_cursor(&mut self, indices: &[u8], width: usize, height: usize) -> Vec<u8> {
        let mut out = indices.to_vec();
        let Some(ShownCursor { image, left, top }) = self.cursor_on_screen() else {
            return out;
        };
        let icon = &image.icon;

        for row in 0..icon.height {
            for column in 0..icon.width {
                let x = left + column as i32;
                let y = top + row as i32;

                if x < 0 || y < 0 || x as usize >= width || y as usize >= height {
                    continue;
                }

                let at = row * icon.width + column;
                let place = y as usize * width + x as usize;
                let beneath = if icon.and[at] != 0 { out[place] } else { 0 };

                out[place] = beneath ^ icon.xor[at];
            }
        }

        out
    }

    /// The screen as a host shows it, the cursor over it: its width, its
    /// height, and a pixel a word, `0x00RRGGBB`, row by row.
    pub fn screen_rgb(&mut self) -> (usize, usize, Vec<u32>) {
        let screen = self.screen_bitmap();
        let (width, height) = (screen.width() as usize, screen.height() as usize);
        let indices = self.with_cursor(&screen.indices.borrow(), width, height);

        (width, height, self.coloured(&screen, &indices))
    }

    /// The screen's pixels as they are, with no cursor over them, as the
    /// TypeScript engine's survey keeps a box of USER's as it comes up;
    /// none before there is a screen.
    pub fn screen_rgb_bare(&self) -> Option<(usize, usize, Vec<u32>)> {
        let screen = self.screen.as_ref()?;
        let (width, height) = (screen.width() as usize, screen.height() as usize);

        Some((
            width,
            height,
            self.coloured(screen, &screen.indices.borrow()),
        ))
    }

    /// A rectangle of the screen as a host shows it -- left, top, width,
    /// height -- with the cursor over it where `cursor`: a pixel a word,
    /// `0x00RRGGBB`, row by row, black off the screen. Seamless mode's,
    /// which shows each window's rectangle alone, and so need not colour
    /// the whole of a screen the host's size each frame.
    pub fn screen_rgb_cut(&mut self, rect: [i32; 4], cursor: bool) -> Vec<u32> {
        let screen = self.screen_bitmap();
        let (width, height) = (screen.width(), screen.height());
        let (w, h) = (rect[2].max(0) as usize, rect[3].max(0) as usize);
        let mut indices = vec![0u8; w * h];
        let mut on = vec![false; w * h];

        {
            let all = screen.indices.borrow();

            for row in 0..h {
                let y = rect[1] + row as i32;

                if y < 0 || y >= height {
                    continue;
                }

                for column in 0..w {
                    let x = rect[0] + column as i32;

                    if x >= 0 && x < width {
                        indices[row * w + column] = all[(y * width + x) as usize];
                        on[row * w + column] = true;
                    }
                }
            }
        }

        if cursor && let Some(ShownCursor { image, left, top }) = self.cursor_on_screen() {
            let icon = &image.icon;

            for row in 0..icon.height {
                for column in 0..icon.width {
                    let x = left + column as i32 - rect[0];
                    let y = top + row as i32 - rect[1];

                    if x < 0 || y < 0 || x as usize >= w || y as usize >= h {
                        continue;
                    }

                    let at = row * icon.width + column;
                    let place = y as usize * w + x as usize;

                    if !on[place] {
                        continue;
                    }

                    let beneath = if icon.and[at] != 0 { indices[place] } else { 0 };

                    indices[place] = beneath ^ icon.xor[at];
                }
            }
        }

        let lookup = self.shown_lookup(&screen);

        indices
            .iter()
            .zip(&on)
            .map(|(&index, &on)| {
                if on {
                    lookup.get(usize::from(index)).copied().unwrap_or(0)
                } else {
                    0
                }
            })
            .collect()
    }

    /// The colour the screen shows for each of its palette's indices, a
    /// word `0x00RRGGBB` an index.
    pub(crate) fn shown_lookup(&self, screen: &winbox_raster::DeviceBitmap) -> Vec<u32> {
        let palette = screen.device_palette.borrow();

        shown_colours(&self.display, &palette.colours, palette.rewritten)
            .iter()
            .map(|&[red, green, blue]| {
                u32::from(red) << 16 | u32::from(green) << 8 | u32::from(blue)
            })
            .collect()
    }

    /// Palette indices of the screen's as the colours the screen shows.
    pub(crate) fn coloured(
        &self,
        screen: &winbox_raster::DeviceBitmap,
        indices: &[u8],
    ) -> Vec<u32> {
        let lookup = self.shown_lookup(screen);

        indices
            .iter()
            .map(|&index| lookup.get(usize::from(index)).copied().unwrap_or(0))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rectangle_cut_is_the_screens_and_black_off_it() {
        let mut system = System::new();

        system.display = crate::display::mode("vga").unwrap();

        let screen = system.screen_bitmap();

        for (at, index) in screen.indices.borrow_mut().iter_mut().enumerate() {
            *index = (at % 16) as u8;
        }

        let (width, _, whole) = system.screen_rgb();
        let cut = system.screen_rgb_cut([-2, 478, 4, 3], false);

        // Its top row's two pixels on the screen, at the left of row 478;
        // everything else off it.
        assert_eq!(cut.len(), 12);
        assert_eq!(&cut[..2], &[0, 0]);
        assert_eq!(&cut[2..4], &whole[478 * width..478 * width + 2]);
        assert_eq!(&cut[6..8], &whole[479 * width..479 * width + 2]);
        assert!(cut[8..].iter().all(|&pixel| pixel == 0));
    }

    #[test]
    fn the_low_statics_brightened_on_the_screen() {
        let colours = [[0x80, 0, 0x80], [0x80, 0x80, 0x80], [0x80, 0x40, 0xff]];
        let mut display = crate::display::mode("vga").unwrap();

        display.bright_low_statics = 2;
        assert_eq!(
            shown_colours(&display, &colours, false),
            vec![[0xc0, 0, 0xc0], [0xc0, 0xc0, 0xc0], [0x80, 0x40, 0xff]]
        );
        display.bright_low_statics = 0;
        assert_eq!(shown_colours(&display, &colours, false), colours.to_vec());
    }

    /// `8514.DRV`'s `Enable` (seg1 `2ae9`): its twenty statics into the DAC
    /// with a component of 80h as `BFh` but in 808080, until GDI sends the
    /// whole palette; the 236 between as they are.
    #[test]
    fn the_8514s_statics_as_enable_writes_them() {
        let display = crate::display::mode("8514").unwrap();
        let colours = winbox_raster::palette_for_display(
            winbox_raster::DisplayKind {
                colors: 256,
                ega: false,
                ibm: true,
            },
            None,
        )
        .borrow()
        .colours
        .clone();
        let shown = shown_colours(&display, &colours, false);

        assert_eq!(
            &shown[..10],
            &[
                [0, 0, 0],
                [0xbf, 0, 0],
                [0, 0xbf, 0],
                [0xbf, 0xbf, 0],
                [0, 0, 0xbf],
                [0xbf, 0, 0xbf],
                [0, 0xbf, 0xbf],
                [0xc0, 0xc0, 0xc0],
                [0xc0, 0xdc, 0xc0],
                [0xa4, 0xc8, 0xf0],
            ]
        );
        assert_eq!(shown[248], [0x80, 0x80, 0x80]);
        assert_eq!(&shown[10..246], &colours[10..246]);
        assert_eq!(&shown[246..], &colours[246..]);
        assert_eq!(shown_colours(&display, &colours, true), colours);
    }
}
