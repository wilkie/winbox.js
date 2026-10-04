//! A colour as winbox.js's raster layer carries one: alpha, red, green and
//! blue in a word, `0xAARRGGBB`, and, where a palette realized on a palette
//! device names it, the slot of the system palette it is drawn in.

/// A colour, `0xAARRGGBB`.
///
/// The word is unsigned here. The TypeScript engine's `value` and
/// `a8r8g8b8` are the signed 32-bit number its shifts make, negative for any
/// colour with alpha 0x80 or more -- every opaque one; the bits are the same.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Color {
    value: u32,
    /// The slot of the system palette this colour is drawn in, solid, where
    /// a palette realized on a palette device names it (`palreal`).
    pub slot: Option<usize>,
}

/// A colour's channels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Channels {
    pub a: u8,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Color {
    /// A colour from its word, `0xAARRGGBB`.
    pub fn new(value: u32) -> Self {
        Self { value, slot: None }
    }

    /// A colour from red, green and blue, opaque.
    pub fn rgb(red: u8, green: u8, blue: u8) -> Self {
        Self::rgba(red, green, blue, 255)
    }

    pub fn rgba(red: u8, green: u8, blue: u8, alpha: u8) -> Self {
        Self::new(Self::rgb_to_color(red, green, blue, alpha))
    }

    /// The same colour, drawn in a slot of the system palette.
    #[must_use]
    pub fn in_slot(mut self, slot: Option<usize>) -> Self {
        self.slot = slot;
        self
    }

    /// Halfway, or `amount` of the way, to another colour; opaque. Each
    /// channel is made a 32-bit whole number, cut towards nought, and shifted
    /// into place with the others combined by OR, as the TypeScript engine's
    /// bit operations on its fractions do: an `amount` outside 0 to 1 that
    /// takes a channel below 0 or past 255 spills into its neighbours.
    #[must_use]
    pub fn mix(&self, secondary: &Self, amount: f64) -> Self {
        let channel = |a: u8, b: u8| {
            let mixed = f64::from(a) * (1.0 - amount) + f64::from(b) * amount;

            // ToInt32: a fraction cut down, then wrapped to 32 bits.
            if mixed.is_finite() {
                (mixed.trunc().rem_euclid(4_294_967_296.0) as u64) as u32
            } else {
                0
            }
        };
        let (red, green, blue) = (
            channel(self.red(), secondary.red()),
            channel(self.green(), secondary.green()),
            channel(self.blue(), secondary.blue()),
        );

        Self::new(0xff00_0000 | red << 16 | green << 8 | blue)
    }

    pub fn value(&self) -> u32 {
        self.value
    }

    pub fn a8r8g8b8(&self) -> u32 {
        self.value
    }

    pub fn a8b8g8r8(&self) -> u32 {
        (self.value & 0xff00_ff00) | ((self.value >> 16) & 0xff) | ((self.value & 0xff) << 16)
    }

    pub fn r8g8b8a8(&self) -> u32 {
        self.value.rotate_left(8)
    }

    pub fn b8g8r8a8(&self) -> u32 {
        ((self.value << 8) & 0x00ff_0000)
            | ((self.value >> 8) & 0x0000_ff00)
            | ((self.value >> 24) & 0xff)
            | ((self.value & 0xff) << 24)
    }

    pub fn channels(&self) -> Channels {
        Self::color_to_rgb(self.value)
    }

    pub fn red(&self) -> u8 {
        self.channels().r
    }

    pub fn green(&self) -> u8 {
        self.channels().g
    }

    pub fn blue(&self) -> u8 {
        self.channels().b
    }

    /// The alpha, from 0 to 1.
    pub fn alpha(&self) -> f64 {
        f64::from(self.channels().a) / 255.0
    }

    /// How bright the colour looks, from 0 to just under 1.
    pub fn brightness(&self) -> f64 {
        let Channels { r, g, b, .. } = self.channels();

        (f64::from(r) * 0.299 + f64::from(g) * 0.587 + f64::from(b) * 0.114) / 256.0
    }

    /// The colour inverted. Meant to keep its alpha, it ORs the alpha with
    /// its inverse, and so is always opaque.
    #[must_use]
    pub fn invert(&self) -> Self {
        Self::new(!self.value | (self.value & 0xff00_0000))
    }

    pub fn rgb_to_color(r: u8, g: u8, b: u8, a: u8) -> u32 {
        u32::from(a) << 24 | u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b)
    }

    /// A word's channels read as `0xAABBGGRR`.
    pub fn color_to_bgr(color: u32) -> Channels {
        Channels {
            a: (color >> 24) as u8,
            b: (color >> 16) as u8,
            g: (color >> 8) as u8,
            r: color as u8,
        }
    }

    /// A word's channels read as `0xAARRGGBB`.
    pub fn color_to_rgb(color: u32) -> Channels {
        Channels {
            a: (color >> 24) as u8,
            r: (color >> 16) as u8,
            g: (color >> 8) as u8,
            b: color as u8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_alpha_red_green_and_blue_in_a_word() {
        let colour = Color::rgba(0x12, 0x34, 0x56, 0x78);

        assert_eq!(colour.value(), 0x7812_3456);
        assert_eq!(colour.a8b8g8r8(), 0x7856_3412);
        assert_eq!(colour.r8g8b8a8(), 0x1234_5678);
        assert_eq!(colour.b8g8r8a8(), 0x5634_1278);
        assert_eq!(
            (colour.red(), colour.green(), colour.blue()),
            (0x12, 0x34, 0x56)
        );
        // The alpha inverted and ORed with itself: opaque, whatever it was.
        assert_eq!(colour.invert().value(), 0xffed_cba9);
    }

    #[test]
    fn mixes_cutting_each_channel_down() {
        let mixed = Color::rgb(0, 0, 0).mix(&Color::rgb(255, 255, 255), 0.5);

        // 127.5, cut down.
        assert_eq!(mixed.red(), 127);

        // Past white: 0x17e in each channel, its high bit ORed into the
        // channel above.
        let past = Color::rgb(0, 0, 0).mix(&Color::rgb(255, 255, 255), 1.5);

        assert_eq!(past.value(), 0xff7f_7f7e);
    }
}
