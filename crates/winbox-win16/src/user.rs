//! USER's functions, as far as the Rust engine answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "InitApp" => init_app,
        "_WSPRINTF" => wsprintf,
        "ExitWindows" => exit_windows,
        _ => return None,
    })
}

/// A program's start in USER. The TypeScript engine makes USER's own
/// windows here and loads the installable drivers; there are no windows
/// here yet.
fn init_app(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// The session ended: the task with it.
fn exit_windows(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);
    args.word(system);
    system.ended = true;
    Ok(Answer::Word(1))
}

/// `wsprintf`, a C function: the output and the format above the return
/// address, then the values. Its count of characters written, its nought
/// not counted.
fn wsprintf(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let output = args.above(system, 0);
    let format = system.read_string(args.above(system, 4));
    let values = args.address_above(system, 8);
    let text = format_values(system, &format, values);
    let mut bytes = text.clone();

    bytes.push(0);
    system.write_far(output, &bytes);
    Ok(Answer::Word(text.len() as u16))
}

/// A format spelled out with the values at a far pointer, as `wsprintf`
/// and `wvsprintf` do: `%` then `-`, `#` and `0` flags, a width, a
/// precision after `.`, `l` for a long, and `%`, `s`, `c`, `d`, `i`, `u`,
/// `x` or `X`. A character it does not know is passed over, and the scan
/// goes on for one it does.
pub fn format_values(system: &System, format: &[u8], values: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut next = values;
    let mut word = |system: &System| {
        let bytes = system.read_far(next, 2);

        next = (next & 0xffff_0000) | (next.wrapping_add(2) & 0xffff);
        u16::from_le_bytes([bytes[0], bytes[1]])
    };
    let mut at = 0;

    while at < format.len() {
        let byte = format[at];

        at += 1;

        if byte != b'%' {
            out.push(byte);
            continue;
        }

        let mut width = 0usize;
        let mut precision = 0usize;
        let mut in_precision = false;
        let mut left = false;
        let mut zeros = false;
        let mut prefix = false;
        let mut long = false;

        while at < format.len() {
            let code = format[at];

            at += 1;

            match code {
                b'%' => {
                    out.push(b'%');
                    break;
                }
                b'-' => left = true,
                b'#' => prefix = true,
                // A nought first is the flag; after, a digit of the width.
                b'0' if width == 0 && !in_precision => zeros = true,
                b'.' => in_precision = true,
                b'l' => long = true,
                b'0'..=b'9' => {
                    let digit = usize::from(code - b'0');

                    if in_precision {
                        precision = precision * 10 + digit;
                    } else {
                        width = width * 10 + digit;
                    }
                }
                b's' => {
                    let offset = word(system);
                    let segment = word(system);
                    let string = system.read_string(u32::from(segment) << 16 | u32::from(offset));
                    let count = if precision > 0 {
                        string.len().min(precision)
                    } else {
                        string.len()
                    };

                    out.extend_from_slice(&string[..count]);
                    break;
                }
                b'c' => {
                    let value = word(system) as u8;

                    if value != 0 {
                        out.push(value);
                    }

                    break;
                }
                b'd' | b'i' | b'u' | b'x' | b'X' => {
                    let low = word(system);
                    let value = if long {
                        u32::from(word(system)) << 16 | u32::from(low)
                    } else if matches!(code, b'd' | b'i') {
                        // A short is signed only for %d and %i; %u and %x
                        // take its sixteen bits as they are (`comms`).
                        i32::from(low as i16) as u32
                    } else {
                        u32::from(low)
                    };
                    let mut digits = match code {
                        b'd' | b'i' => (value as i32).to_string(),
                        b'u' => value.to_string(),
                        b'x' => format!("{value:x}"),
                        _ => format!("{value:X}"),
                    };

                    if prefix && matches!(code, b'x' | b'X') {
                        digits.insert_str(0, if code == b'x' { "0x" } else { "0X" });
                    }

                    if digits.len() < precision {
                        digits.insert_str(0, &"0".repeat(precision - digits.len()));
                    }

                    if digits.len() < width {
                        let fill = if zeros { "0" } else { " " }.repeat(width - digits.len());

                        if left {
                            digits.push_str(&fill);
                        } else {
                            digits.insert_str(0, &fill);
                        }
                    }

                    out.extend_from_slice(digits.as_bytes());
                    break;
                }
                _ => {}
            }
        }
    }

    out
}
