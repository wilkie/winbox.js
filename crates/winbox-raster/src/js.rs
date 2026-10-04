//! A JavaScript number's arithmetic, where the TypeScript engine's outline
//! code leans on it: the scaler's arithmetic was measured through that
//! engine, so where it rounds a half, takes a sign or truncates to
//! thirty-two bits, this does exactly the same.

/// `Math.round`: to the nearest whole number, a half upward.
pub fn round(value: f64) -> f64 {
    crate::logical_font::round(value)
}

/// `Math.sign`: nought, minus nought and not-a-number answer themselves.
pub fn sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        value
    }
}

/// `Math.max` of two, which is not-a-number where either is.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b || (a == 0.0 && b == 0.0 && a.is_sign_positive()) {
        a
    } else {
        b
    }
}

/// `Math.min` of two, which is not-a-number where either is.
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b || (a == 0.0 && b == 0.0 && a.is_sign_negative()) {
        a
    } else {
        b
    }
}

/// `ToInt32`: a number as the bitwise operators take it, modulo two to the
/// thirty-second, nought for anything not finite.
pub fn int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }

    let whole = value.trunc() % 4_294_967_296.0;

    (whole as i64) as i32
}

/// `a >> b`.
pub fn sar(a: f64, b: f64) -> f64 {
    f64::from(int32(a).wrapping_shr(int32(b) as u32))
}

/// `a << b`.
pub fn shl(a: f64, b: f64) -> f64 {
    f64::from(int32(a).wrapping_shl(int32(b) as u32))
}

/// `a & b`.
pub fn and(a: f64, b: f64) -> f64 {
    f64::from(int32(a) & int32(b))
}

/// `a | b`.
pub fn or(a: f64, b: f64) -> f64 {
    f64::from(int32(a) | int32(b))
}

/// `~a`.
pub fn not(a: f64) -> f64 {
    f64::from(!int32(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_and_wraps_as_javascript_does() {
        assert_eq!(int32(-1.5), -1);
        assert_eq!(int32(4_294_967_296.0 + 5.0), 5);
        assert_eq!(int32(2_147_483_648.0), i32::MIN);
        assert_eq!(int32(f64::NAN), 0);
        assert!((sar(-65.0, 6.0) + 2.0).abs() < f64::EPSILON);
        assert!((shl(1.0, 33.0) - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn keeps_not_a_number_through_max_and_min() {
        assert!(max(1.0, f64::NAN).is_nan());
        assert!(min(f64::NAN, 1.0).is_nan());
        assert!((max(2.0, 3.0) - 3.0).abs() < f64::EPSILON);
        assert!(sign(-0.0).is_sign_negative());
    }
}
