//! A display's palette: the colours its pixels' indices stand for, and the
//! nearest of them to a colour, as winbox.js's `DevicePalette` matches one.

use std::collections::HashMap;

/// A colour: red, green, blue.
pub type Rgb = [u8; 3];

/// The 256-colour palette's static colours at its bottom and its top.
const STATIC_LOW: [Rgb; 10] = [
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xc0, 0xdc, 0xc0],
    [0xa6, 0xca, 0xf0],
];
const STATIC_HIGH: [Rgb; 10] = [
    [0xff, 0xfb, 0xf0],
    [0xa0, 0xa0, 0xa4],
    [0x80, 0x80, 0x80],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
];
const CUBE: [u8; 7] = [0x3f, 0x5f, 0x7f, 0x9f, 0xbf, 0xdf, 0xff];

/// The sixteen colours of a VGA, by index.
const SIXTEEN: [Rgb; 16] = [
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0x80, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
];

/// A display's palette.
#[derive(Debug, Clone)]
pub struct DevicePalette {
    pub colours: Vec<Rgb>,
    initial: Vec<Rgb>,
    /// Each colour asked for, and the index it matched.
    found: HashMap<u32, usize>,
    stale: bool,
}

fn key([red, green, blue]: Rgb) -> u32 {
    u32::from(red) << 16 | u32::from(green) << 8 | u32::from(blue)
}

impl DevicePalette {
    pub fn new(colours: Vec<Rgb>) -> Self {
        let mut palette = Self {
            initial: colours.clone(),
            colours,
            found: HashMap::new(),
            stale: false,
        };

        palette.seed();
        palette
    }

    /// Each colour the palette holds found at its first index.
    fn seed(&mut self) {
        self.found.clear();

        for (index, &colour) in self.colours.iter().enumerate() {
            self.found.entry(key(colour)).or_insert(index);
        }
    }

    /// An entry given a new colour, matched afresh when next asked.
    pub fn recolour(&mut self, index: usize, colour: Rgb) {
        self.colours[index] = colour;
        self.stale = true;
    }

    /// Every entry its first colour again.
    pub fn reset(&mut self) {
        for (index, colour) in self.initial.clone().into_iter().enumerate() {
            self.recolour(index, colour);
        }
    }

    pub fn holds(&self, colour: Rgb) -> bool {
        self.colours.contains(&colour)
    }

    pub fn size(&self) -> usize {
        self.colours.len()
    }

    /// The index of a colour, or of the nearest by the sum of the squares of
    /// the differences, the first of equals.
    pub fn index(&mut self, red: u8, green: u8, blue: u8) -> usize {
        if self.stale {
            self.stale = false;
            self.seed();
        }

        let wanted = [red, green, blue];

        if let Some(&found) = self.found.get(&key(wanted)) {
            return found;
        }

        let distance = |[r, g, b]: Rgb| {
            let d = |a: u8, b: u8| (i32::from(a) - i32::from(b)).pow(2);

            d(r, red) + d(g, green) + d(b, blue)
        };
        let best = (0..self.colours.len())
            .min_by_key(|&index| (distance(self.colours[index]), index))
            .unwrap_or(0);

        self.found.insert(key(wanted), best);
        best
    }

    /// An index's colour as a `COLORREF`.
    pub fn colorref(&self, index: usize) -> u32 {
        let [red, green, blue] = self.colours.get(index).copied().unwrap_or([0, 0, 0]);

        u32::from(blue) << 16 | u32::from(green) << 8 | u32::from(red)
    }

    pub fn mono() -> Self {
        Self::new(vec![[0x00, 0x00, 0x00], [0xff, 0xff, 0xff]])
    }

    pub fn sixteen() -> Self {
        Self::new(SIXTEEN.to_vec())
    }

    /// The EGA's: its dark grey a darker one.
    pub fn ega() -> Self {
        let mut colours = SIXTEEN.to_vec();

        colours[8] = [0x40, 0x40, 0x40];
        Self::new(colours)
    }

    /// The 256-colour palette: its static colours, and a cube between.
    pub fn two_fifty_six() -> Self {
        Self::new(
            (0..256)
                .map(|index| match index {
                    0..10 => STATIC_LOW[index],
                    246.. => STATIC_HIGH[index - 246],
                    _ => {
                        let step = index - 9;

                        [CUBE[step % 7], CUBE[(step / 7) % 7], CUBE[step / 49]]
                    }
                })
                .collect(),
        )
    }

    pub fn for_depth(depth: u8) -> Self {
        match depth {
            1 => Self::mono(),
            4 => Self::sixteen(),
            _ => Self::two_fifty_six(),
        }
    }

    /// A display's: its depth's, or the EGA's for a display that says so.
    pub fn for_display(colours: u32, ega: bool) -> Self {
        let depth = Self::depth_of(colours);

        if ega {
            Self::ega()
        } else {
            Self::for_depth(depth)
        }
    }

    /// The bits a pixel of a display of so many colours takes.
    pub fn depth_of(colours: u32) -> u8 {
        match colours {
            0..=2 => 1,
            3..=16 => 4,
            _ => 8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_nearest_colour() {
        let mut palette = DevicePalette::sixteen();

        assert_eq!(palette.index(0xff, 0xff, 0xff), 15);
        assert_eq!(palette.index(0xc8, 0xc8, 0xc8), 8);
        assert_eq!(palette.colorref(1), 0x0000_0080);
        assert_eq!(
            DevicePalette::two_fifty_six().colours[10],
            [0x5f, 0x3f, 0x3f]
        );
    }
}
