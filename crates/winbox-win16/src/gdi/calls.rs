//! GDI's calls that stand beside its objects and drawing: `MulDiv`, a
//! device's own functions by `Escape`, and the pens and brushes a display
//! offers (`EnumObjects`).
//!
//! Not here: metafiles, which are `gdi/metafile.rs`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

mod enum_objects;
mod escape;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub use enum_objects::{LogBrushRecord, LogPenRecord, enumerated_objects};
pub use escape::escape;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "MulDiv" => Implementation::Sync(mul_div_call),
        "Escape" => Implementation::Async(super::printing::escape_call),
        "EnumObjects" => Implementation::Async(enum_objects::enum_objects),
        "UnicodeToAnsi" => Implementation::Sync(unicode_to_ansi),
        _ => return None,
    })
}

/// The characters GDI's table gives a Unicode value other than the ANSI
/// code's own, from GDI.EXE's last data segment at `067E`: 256 words, the
/// Unicode value of each ANSI code. 1Fh's word is nought, so no character
/// finds it.
const OWN_UNICODE: [(u8, u16); 26] = [
    (0x1f, 0x0000),
    (0x82, 0x201a),
    (0x83, 0x0192),
    (0x84, 0x201e),
    (0x85, 0x2026),
    (0x86, 0x2020),
    (0x87, 0x2021),
    (0x88, 0x02c6),
    (0x89, 0x2030),
    (0x8a, 0x0160),
    (0x8b, 0x2039),
    (0x8c, 0x0152),
    (0x91, 0x2018),
    (0x92, 0x2019),
    (0x93, 0x201c),
    (0x94, 0x201d),
    (0x95, 0x2022),
    (0x96, 0x2013),
    (0x97, 0x2014),
    (0x98, 0x02dc),
    (0x99, 0x2122),
    (0x9a, 0x0161),
    (0x9b, 0x203a),
    (0x9c, 0x0153),
    (0x9f, 0x0178),
    (0xb7, 0x2219),
];

/// The ANSI code of a Unicode value: the first in GDI's table to have it,
/// or 1Fh for none.
pub fn ansi_of(unicode: u16) -> u8 {
    (0..=255u8)
        .find(|&code| {
            OWN_UNICODE
                .iter()
                .find(|&&(own, _)| own == code)
                .map_or(u16::from(code), |&(_, value)| value)
                == unicode
        })
        .unwrap_or(0x1f)
}

/// GDI's own: a string of Unicode words, ended by nought, made ANSI. Each
/// character is the code GDI's table gives its value, 1Fh where the table
/// has none, and the string is ended with nought; the answer is the bytes
/// written, the nought too (`GDI.EXE` seg1 `56a3`). Control Panel's Fonts
/// names the TrueType fonts it offers to add from their files' `name`
/// tables so.
fn unicode_to_ansi(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.dword(system);
    let target = args.dword(system);
    let mut made = Vec::new();

    for at in 0..0x8000u16 {
        let offset = (source as u16).wrapping_add(2 * at);
        let word = system.read_far((source & 0xffff_0000) | u32::from(offset), 2);
        let unicode = u16::from_le_bytes([word[0], word[1]]);

        if unicode == 0 {
            break;
        }

        made.push(ansi_of(unicode));
    }

    made.push(0);
    system.write_far(target, &made);
    Ok(Answer::Word(made.len() as u16))
}

/// `MulDiv`: the two multiplied and the product divided by the third, each
/// taken as sixteen bits signed, and rounded to the nearest whole number.
///
/// As documented, not yet recorded: a result past sixteen bits, or a
/// division by nought, answers 32767, or -32768 for one below nought. How a
/// half rounds is not documented; it rounds away from nought, as the
/// TypeScript engine has it, which a probe would settle.
pub fn mul_div(multiplicand: i32, multiplier: i32, divisor: i32) -> i32 {
    let sign = |value: i32| i32::from(value as i16);
    let product = f64::from(sign(multiplicand)) * f64::from(sign(multiplier));
    let divisor = sign(divisor);

    if divisor == 0 {
        return if product < 0.0 { -32768 } else { 32767 };
    }

    let exact = product / f64::from(divisor);
    let result = exact.signum() * exact.abs().round();

    (result as i32).clamp(-32768, 32767)
}

fn mul_div_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let multiplicand = i32::from(args.signed(system));
    let multiplier = i32::from(args.signed(system));
    let divisor = i32::from(args.signed(system));

    Ok(Answer::Word(
        mul_div(multiplicand, multiplier, divisor) as u16
    ))
}

#[cfg(test)]
mod tests {
    use super::mul_div;

    #[test]
    fn rounds_to_the_nearest_half_away_from_nought() {
        assert_eq!(mul_div(10, 3, 4), 8);
        assert_eq!(mul_div(12, 72, 96), 9);
        assert_eq!(mul_div(-10, 3, 4), -8);
        assert_eq!(mul_div(0xfff6, 3, 4), -8);
        assert_eq!(mul_div(5, 1, 2), 3);
        assert_eq!(mul_div(-5, 1, 2), -3);
        assert_eq!(mul_div(7, 1, -2), -4);
        assert_eq!(mul_div(100, 96, 72), 133);
    }

    #[test]
    fn holds_to_sixteen_bits_signed() {
        assert_eq!(mul_div(30000, 30000, 1), 32767);
        assert_eq!(mul_div(-30000, 30000, 1), -32768);
        assert_eq!(mul_div(5, 5, 0), 32767);
        assert_eq!(mul_div(-5, 5, 0), -32768);
        // Each argument is a word, signed.
        assert_eq!(mul_div(0xffff, 10, 1), -10);
    }
}
