//! The colour a `COLORREF` stands for in a device context: a plain colour,
//! or an entry of the logical palette selected there, and where that
//! palette is realized on a palette device, the slot of the system palette
//! it is drawn in.

use crate::{Color, DevicePalette};

/// A logical palette's entry: red, green, blue and flags.
pub type PaletteEntry = [u8; 4];

/// The stock `DEFAULT_PALETTE`'s twenty entries, as `GetPaletteEntries`
/// answers them. **Recorded** by `palette` on four displays, the same on
/// each: the sixteen colours in pairs about four more.
pub const DEFAULT_ENTRIES: [PaletteEntry; 20] = [
    [0x00, 0x00, 0x00, 0],
    [0x80, 0x00, 0x00, 0],
    [0x00, 0x80, 0x00, 0],
    [0x80, 0x80, 0x00, 0],
    [0x00, 0x00, 0x80, 0],
    [0x80, 0x00, 0x80, 0],
    [0x00, 0x80, 0x80, 0],
    [0xc0, 0xc0, 0xc0, 0],
    [0xc0, 0xdc, 0xc0, 0],
    [0xa6, 0xca, 0xf0, 0],
    [0xff, 0xfb, 0xf0, 0],
    [0xa0, 0xa0, 0xa4, 0],
    [0x80, 0x80, 0x80, 0],
    [0xff, 0x00, 0x00, 0],
    [0x00, 0xff, 0x00, 0],
    [0xff, 0xff, 0x00, 0],
    [0x00, 0x00, 0xff, 0],
    [0xff, 0x00, 0xff, 0],
    [0x00, 0xff, 0xff, 0],
    [0xff, 0xff, 0xff, 0],
];

const PC_EXPLICIT: u8 = 0x02;

/// What of a device context a colour is read against: the entries of the
/// logical palette selected into it and, once realized, each entry's slot
/// of the system palette; and the palette of the bitmap it draws into.
/// Any of them may be missing, as the TypeScript engine's surface may lack
/// each.
#[derive(Debug, Clone, Copy, Default)]
pub struct SurfacePalette<'a> {
    pub entries: Option<&'a [PaletteEntry]>,
    pub slots: Option<&'a [usize]>,
    pub device: Option<&'a DevicePalette>,
}

/// A logical palette realized on a palette device, into which a surface
/// draws: its entries and each one's slot of the system palette.
#[derive(Debug, Clone, Copy)]
pub struct Realized<'a> {
    pub entries: &'a [PaletteEntry],
    pub slots: &'a [usize],
}

impl Realized<'_> {
    /// The slot a colour of a picture is drawn in: its nearest entry's
    /// (`paldib`: a DIB's colours, and WinG's, come out as the realized
    /// palette's nearest). An entry with no slot is slot 0, as the
    /// TypeScript engine's missing slot is once it is stored as a pixel.
    pub fn slot_of(&self, red: u8, green: u8, blue: u8) -> usize {
        self.slots
            .get(nearest_entry(self.entries, red, green, blue))
            .copied()
            .unwrap_or(0)
    }
}

impl<'a> SurfacePalette<'a> {
    /// The palette realized where the surface draws, where it has one on a
    /// palette device.
    pub fn realized(&self) -> Option<Realized<'a>> {
        let (Some(entries), Some(slots), Some(device)) = (self.entries, self.slots, self.device)
        else {
            return None;
        };

        (device.size() == 256).then_some(Realized { entries, slots })
    }
}

/// Whether a `COLORREF` is a palette's: `PALETTEINDEX` or `PALETTERGB`.
pub fn is_palette_ref(clrref: u32) -> bool {
    matches!(clrref >> 24, 1 | 2)
}

/// The entry of `entries` nearest a colour, by the sum of the squares, the
/// first of equals.
pub fn nearest_entry(entries: &[PaletteEntry], red: u8, green: u8, blue: u8) -> usize {
    let mut best = 0;
    let mut distance = i32::MAX;

    for (index, [r, g, b, _]) in entries.iter().enumerate() {
        let d = (i32::from(*r) - i32::from(red)).pow(2)
            + (i32::from(*g) - i32::from(green)).pow(2)
            + (i32::from(*b) - i32::from(blue)).pow(2);

        if d < distance {
            distance = d;
            best = index;
        }
    }

    best
}

/// The colour a `COLORREF` stands for in a device context. **Recorded** by
/// `palette`, on displays whose colours are fixed:
///
/// * `PALETTEINDEX(n)` is entry `n` of the palette selected into it -- the
///   stock palette if none is -- and entry 0 for an index past the end. An
///   entry with `PC_EXPLICIT` is the device's own colour its low word names,
///   kept to the device's colours: `01 02 03` is the VGA's colour 1, dark
///   red. On the Hercules it is the entry's own colour, black: fitted to
///   that one case, why not known.
/// * `PALETTERGB` is the colour itself, as a plain `RGB`.
///
/// Anything else is the colour itself. With a palette realized on a palette
/// device, an index is its entry's slot, and a `PALETTERGB` its nearest
/// entry's (`palreal`).
pub fn colour_of(clrref: u32, surface: &SurfacePalette) -> Color {
    let kind = clrref >> 24;
    let low = (clrref & 0xffff) as usize;
    let (red, green, blue) = (clrref as u8, (clrref >> 8) as u8, (clrref >> 16) as u8);

    if let Some(realized) = surface.realized() {
        let at = match kind {
            1 => Some(if low < realized.entries.len() { low } else { 0 }),
            2 => Some(nearest_entry(realized.entries, red, green, blue)),
            _ => None,
        };

        if let Some(at) = at {
            let [r, g, b, _] = realized.entries.get(at).copied().unwrap_or_default();

            return Color::rgb(r, g, b).in_slot(realized.slots.get(at).copied());
        }
    }

    if kind == 1 {
        let entries = surface.entries.unwrap_or(&DEFAULT_ENTRIES);
        let Some(&entry) = entries.get(low).or_else(|| entries.first()) else {
            return Color::rgb(0, 0, 0);
        };

        if entry[3] & PC_EXPLICIT != 0 {
            let device = surface.device.map_or(&[][..], |device| &device.colours[..]);

            if device.len() > 2 {
                let [r, g, b] =
                    device[(usize::from(entry[0]) | usize::from(entry[1]) << 8) % device.len()];

                return Color::rgb(r, g, b);
            }
        }

        return Color::rgb(entry[0], entry[1], entry[2]);
    }

    Color::rgb(red, green, blue)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_index_is_an_entry_of_the_stock_palette() {
        let none = SurfacePalette::default();

        assert_eq!(colour_of(0x0100_000d, &none).value(), 0xffff_0000);
        // Past the end: entry 0.
        assert_eq!(colour_of(0x0100_0040, &none).value(), 0xff00_0000);
        assert_eq!(colour_of(0x0200_8040, &none).value(), 0xff40_8000);
        assert!(is_palette_ref(0x0200_0000) && !is_palette_ref(0x0300_0000));
    }

    #[test]
    fn an_explicit_entry_is_the_devices_own_colour() {
        let entries = [[0x01, 0x02, 0x03, PC_EXPLICIT]];
        let vga = DevicePalette::sixteen();
        let mono = DevicePalette::mono();
        let on = |device| SurfacePalette {
            entries: Some(&entries),
            slots: None,
            device: Some(device),
        };

        // 0x0201 is 513, colour 1 of sixteen: dark red.
        assert_eq!(colour_of(0x0100_0000, &on(&vga)).value(), 0xff80_0000);
        // The Hercules: the entry's own colour.
        assert_eq!(colour_of(0x0100_0000, &on(&mono)).value(), 0xff01_0203);
    }

    #[test]
    fn a_realized_palette_names_its_slots() {
        let entries = [[0x10, 0x20, 0x30, 0], [0xf0, 0xf0, 0xf0, 0]];
        let slots = [10, 11];
        let device = DevicePalette::two_fifty_six();
        let surface = SurfacePalette {
            entries: Some(&entries),
            slots: Some(&slots),
            device: Some(&device),
        };

        assert_eq!(colour_of(0x0100_0001, &surface).slot, Some(11));
        assert_eq!(colour_of(0x0200_ffff, &surface).slot, Some(11));
        assert_eq!(surface.realized().unwrap().slot_of(0, 0, 0), 10);
    }
}
