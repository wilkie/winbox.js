//! A run-length encoded DIB's bits, `BI_RLE8` or `BI_RLE4`, walked as the
//! display drivers walk them when they set one into a bitmap or draw it on
//! the screen: `VGA.DRV`'s export 501 (seg9 `12ec`, the set from `13ff`) and
//! `SVGA256.DRV`'s seg9 `15ac`. **Recorded** by `gdidmrle`, into a bitmap's
//! memory with 64 bytes either side, and `rledib`, through `SetDIBits`,
//! `SetDIBitsToDevice` and `StretchDIBits`.
//!
//! A pair of bytes at a time: a count and a value, the value's index that
//! many times -- of four bits its high digit and its low in turn, from the
//! high (`VGA.DRV` `1966`-`19e6`; `SVGA256.DRV` `19d3`) -- or nought and an
//! escape: nought ends the line, back to the first column a line up
//! (`1586`; `1647`); one ends the bitmap (`1592`; `1661`); two moves on by
//! the next two bytes, across and up (`1573`; `1609`); three or more is
//! that many indices as they are, of four bits from the high digit
//! (`1d7e`; `1941`), and a byte more where the next is at an odd address
//! (`154b`-`1551`; `15f3`-`1605`) -- the address's, not the stream's.
//!
//! Nothing stops the VGA's walk but the escape that ends the bitmap: lines
//! past the top go on up (`gdidmrle`: written before the bitmap's bits).
//! The 256-colour driver's stops at a line above the top of its clipping
//! rectangle, at an end of line or a delta up (`164a`-`1650`,
//! `1626`-`1631`). Neither bounds a run to the bitmap's width; what is past
//! the right edge goes where the bitmap's memory has it.

/// How far WinBox reads a stream that never ends: Windows reads on through
/// memory to the end of the bitmap's escape or a fault.
const LIMIT: u32 = 0x10_0000;

/// Where and how a walk goes.
#[derive(Debug)]
pub struct RleWalk {
    /// Eight bits a pixel, or four.
    pub eight: bool,
    /// The first column, and the first line's row.
    pub x: i32,
    pub y: i32,
    /// The row above which a line ends the walk: the 256-colour driver's.
    pub top: Option<i32>,
}

/// Walks the stream: `read` its byte at an offset from its start, `odd`
/// whether an offset is at an odd address, `plot` a pixel of the DIB's
/// index at a column and row.
pub fn walk_rle(
    walk: &RleWalk,
    read: &mut dyn FnMut(u32) -> u8,
    odd: &dyn Fn(u32) -> bool,
    plot: &mut dyn FnMut(i32, i32, u8),
) {
    let eight = walk.eight;
    let mut at = 0u32;
    let mut x = walk.x;
    let mut y = walk.y;
    let above = |y: i32| walk.top.is_some_and(|top| y < top);

    while at < LIMIT {
        let count = read(at);
        let value = read(at + 1);

        at += 2;

        if count != 0 {
            for n in 0..i32::from(count) {
                let index = if eight {
                    value
                } else if n & 1 != 0 {
                    value & 0x0f
                } else {
                    value >> 4
                };

                plot(x + n, y, index);
            }

            x += i32::from(count);
            continue;
        }

        match value {
            0 => {
                x = walk.x;
                y -= 1;

                if above(y) {
                    return;
                }
            }
            1 => return,
            2 => {
                let across = read(at);
                let up = read(at + 1);

                at += 2;
                x += i32::from(across);
                y -= i32::from(up);

                if up != 0 && above(y) {
                    return;
                }
            }
            _ => {
                for n in 0..u32::from(value) {
                    let byte = read(at + if eight { n } else { n >> 1 });
                    let index = if eight {
                        byte
                    } else if n & 1 != 0 {
                        byte & 0x0f
                    } else {
                        byte >> 4
                    };

                    plot(x + n as i32, y, index);
                }

                x += i32::from(value);
                at += if eight {
                    u32::from(value)
                } else {
                    (u32::from(value) + 1) >> 1
                };

                if odd(at) {
                    at += 1;
                }
            }
        }
    }
}

/// A byte of a huge pointer's memory: `at` bytes on from `far`, stepping to
/// the next selector, eight on (`__AHINCR`), at each 64 KiB, as the drivers
/// step to the next segment as they read (`VGA.DRV` seg9 `1862`;
/// `SVGA256.DRV` `15c0`-`15cb`). `hugeRead8`.
pub(crate) fn huge_byte(system: &crate::system::System, far: u32, at: u32) -> u8 {
    let offset = (far & 0xffff) + at;
    let selector = ((far >> 16) + (offset >> 16) * 8) & 0xffff;

    system.read_far(selector << 16 | (offset & 0xffff), 1)[0]
}

/// Whether `at` bytes on from `far` is at an odd address.
pub(crate) fn odd_at(far: u32, at: u32) -> bool {
    ((far & 0xffff) + at) & 1 != 0
}
