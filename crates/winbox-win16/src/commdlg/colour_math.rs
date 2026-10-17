//! The Color dialog's arithmetic: hue, luminosity and saturation from a
//! colour and back, each on a scale of 240, in COMMDLG's own sixteen bit
//! words. **Read out** of `COMMDLG.DLL` seg1 (`281d`, `29f1`, `2999`) and
//! **recorded** by `choosclr`'s `rgb` and `hls` records. As
//! `src/win16/commdlg/colour-math.ts`.

/// A colour as hue, luminosity and saturation (seg1 `281d`): luminosity the
/// sum of the largest and smallest of red, green and blue on 240 (rounded
/// by 255 over 510); grey has no saturation and a hue of 160.
pub fn rgb_to_hls(rgb: u32) -> (u16, u16, u16) {
    let red = rgb & 0xff;
    let green = (rgb >> 8) & 0xff;
    let blue = (rgb >> 16) & 0xff;
    let max = green.max(red).max(blue);
    let min = green.min(red).min(blue);
    let sum = max + min;
    let lum = (sum * 240 + 255) / 510;
    let spread = max - min;

    if spread == 0 {
        return (160, lum as u16, 0);
    }

    let over = if lum <= 120 { sum } else { 510 - sum };
    let sat = (spread * 240 + (over >> 1)) / over;
    let delta = |part: u32| (((max - part) * 40 + (spread >> 1)) / spread) as i32;
    let mut hue = if max == red {
        delta(blue) - delta(green)
    } else if max == green {
        delta(red) - delta(blue) + 80
    } else {
        delta(green) - delta(red) + 160
    };

    if hue < 0 {
        hue += 240;
    }

    if hue >= 240 {
        hue -= 240;
    }

    (hue as u16, lum as u16, sat as u16)
}

/// One of red, green and blue for a hue (seg1 `2999`): a hue past 240 has
/// 240 taken from it once, and the rest as words, as COMMDLG's are.
fn hue_to_rgb(low: u16, high: u16, hue: u16) -> u16 {
    let hue = if hue >= 240 {
        hue.wrapping_sub(240)
    } else {
        hue
    };
    let ramp =
        |n: u16| low.wrapping_add(high.wrapping_sub(low).wrapping_mul(n).wrapping_add(20) / 40);

    if hue < 40 {
        ramp(hue)
    } else if hue < 120 {
        high
    } else if hue < 160 {
        ramp(160 - hue)
    } else {
        low
    }
}

/// A colour from hue, luminosity and saturation (seg1 `29f1`). Grey, with
/// no saturation, is the luminosity times 255 over 240, not rounded; each of
/// the others is rounded.
pub fn hls_to_rgb(hue: u16, lum: u16, sat: u16) -> u32 {
    if sat == 0 {
        let grey = (255 * u32::from(lum) / 240) & 0xff;

        return grey | grey << 8 | grey << 16;
    }

    let high = if lum <= 120 {
        ((u32::from(lum) * (240 + u32::from(sat)) + 120) / 240) as u16
    } else {
        let part = (u32::from(lum.wrapping_mul(sat)) + 120) / 240;

        lum.wrapping_add(sat).wrapping_sub(part as u16)
    };
    let low = lum.wrapping_mul(2).wrapping_sub(high);
    let byte = |v: u16| u32::from(v.wrapping_mul(255).wrapping_add(120) / 240) & 0xff;
    let red = byte(hue_to_rgb(low, high, hue.wrapping_add(80)));
    let green = byte(hue_to_rgb(low, high, hue));
    let blue = byte(hue_to_rgb(low, high, hue.wrapping_sub(80)));

    red | green << 8 | blue << 16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_as_choosclr_recorded_them() {
        // (colour, hue, saturation, luminosity) from `choosclr`'s `rgb`.
        for &(rgb, hue, sat, lum) in &[
            (0x0000_0000, 160, 0, 0),
            (0x00ff_ffff, 160, 0, 240),
            (0x0000_00ff, 0, 240, 120),
            (0x00c0_c0c0, 160, 0, 181),
            (0x0040_80ff, 13, 240, 150),
            (0x0038_220c, 140, 155, 32),
            (0x0032_64c8, 13, 144, 118),
            (0x0003_0201, 140, 120, 2),
            (0x00fc_fdfe, 20, 120, 238),
            (0x0082_05fa, 220, 231, 120),
            (0x004e_4d4d, 160, 2, 73),
            (0x00c8_4080, 179, 133, 124),
        ] {
            assert_eq!(rgb_to_hls(rgb), (hue, lum, sat), "{rgb:06x}");
        }
    }

    #[test]
    fn hls_as_choosclr_recorded_it() {
        // (hue, saturation, luminosity, red, green, blue) from `hls`.
        for &(hue, sat, lum, red, green, blue) in &[
            (40, 120, 60, 96, 96, 32),
            (200, 60, 200, 223, 202, 223),
            (10, 0, 100, 106, 106, 106),
            (120, 240, 1, 0, 2, 2),
            (30, 200, 119, 232, 180, 21),
            (170, 100, 121, 102, 75, 182),
            (5, 239, 239, 255, 253, 253),
            (100, 1, 120, 126, 129, 128),
            (225, 180, 90, 168, 23, 78),
            (60, 240, 180, 191, 255, 128),
        ] {
            assert_eq!(
                hls_to_rgb(hue, lum, sat),
                red | green << 8 | blue << 16,
                "{hue},{sat},{lum}"
            );
        }
    }
}
