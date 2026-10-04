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
/// display driver puts another colour in the DAC -- the Super VGA
/// 256-colour driver writes a component of exactly 80h of its first ten
/// entries as C0h (`brightLowStatics`, read out of `SVGA256.DRV` and
/// **recorded** by `palshot`). What a program reads back is the entries;
/// this is only for showing them.
pub fn shown_colours(below: u8, colours: &[[u8; 3]]) -> Vec<[u8; 3]> {
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

    /// Palette indices of the screen's as the colours the screen shows.
    fn coloured(&self, screen: &winbox_raster::DeviceBitmap, indices: &[u8]) -> Vec<u32> {
        let colours = shown_colours(
            self.display.bright_low_statics,
            &screen.device_palette.borrow().colours,
        );
        let lookup: Vec<u32> = colours
            .iter()
            .map(|&[red, green, blue]| {
                u32::from(red) << 16 | u32::from(green) << 8 | u32::from(blue)
            })
            .collect();

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
    fn the_low_statics_brightened_on_the_screen() {
        let colours = [[0x80, 0, 0x80], [0x80, 0x80, 0x80], [0x80, 0x40, 0xff]];

        assert_eq!(
            shown_colours(2, &colours),
            vec![[0xc0, 0, 0xc0], [0xc0, 0xc0, 0xc0], [0x80, 0x40, 0xff]]
        );
        assert_eq!(shown_colours(0, &colours), colours.to_vec());
    }
}
