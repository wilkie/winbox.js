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
        "Escape" => Implementation::Sync(escape::escape_call),
        "EnumObjects" => Implementation::Async(enum_objects::enum_objects),
        _ => return None,
    })
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
