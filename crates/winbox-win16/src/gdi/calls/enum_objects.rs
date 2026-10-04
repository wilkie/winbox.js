//! The pens and brushes a display offers, each handed to a procedure:
//! `EnumObjects`, as Paintbrush asks for its colours.
//!
//! **Recorded** by `enumobj` on the VGA, the EGA, the Super VGA and the
//! Hercules:
//!
//! * Pens: each style from solid, 0, to dot-dot, 4, and in each the
//!   display's colours from its last to its first, a width of nought.
//! * Brushes: 125 solid ones first, the same on every display, red stepping
//!   slowest and blue fastest, each through `ff`, `c0`, `80`, `40` and `00`.
//!   Then the hatched ones, from hatch 5 down to 0, each in the display's
//!   colours from last to first.
//! * The answer is the procedure's last; a procedure answering nought stops
//!   the walk.
//!
//! The colours are the display's own, as its bitmaps index them: sixteen,
//! the EGA's with `404040`, or the Hercules's two.

use winbox_cpu::{AX, DS, ES, SS};
use winbox_raster::palette_for_display;

use crate::call::{Answer, Args, Later};
use crate::engine::{Engine, GuestArg, Register};
use crate::gdi::text::enumerate::gdi_data_selector;
use crate::system::System;

const OBJ_PEN: i16 = 1;
const OBJ_BRUSH: i16 = 2;

const LEVELS: [u32; 5] = [0xff, 0xc0, 0x80, 0x40, 0x00];

/// How far up the stack from the procedure's entry GDI lays a pen and a
/// brush out (`enumregs`).
const PEN_AT: u16 = 40;
const BRUSH_AT: u16 = 38;

/// A `LOGPEN` handed over: its style, its width, nought across and down,
/// and its colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogPenRecord {
    pub style: u16,
    pub color: u32,
}

/// A `LOGBRUSH` handed over: its style, colour and hatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogBrushRecord {
    pub style: u16,
    pub color: u32,
    pub hatch: i16,
}

impl LogPenRecord {
    fn bytes(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(10);

        bytes.extend_from_slice(&self.style.to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(&self.color.to_le_bytes());
        bytes
    }
}

impl LogBrushRecord {
    fn bytes(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(8);

        bytes.extend_from_slice(&self.style.to_le_bytes());
        bytes.extend_from_slice(&self.color.to_le_bytes());
        bytes.extend_from_slice(&self.hatch.to_le_bytes());
        bytes
    }
}

/// The display's colours as `COLORREF`s, last first.
fn device_colours(system: &System) -> Vec<u32> {
    let palette = palette_for_display(system.display_kind(), None);
    palette
        .borrow()
        .colours
        .iter()
        .map(|&[red, green, blue]| u32::from(red) | u32::from(green) << 8 | u32::from(blue) << 16)
        .rev()
        .collect()
}

/// The pens and brushes, in the order they are handed over: `OBJ_PEN`'s
/// and `OBJ_BRUSH`'s, and none for anything else.
pub fn enumerated_objects(system: &System, kind: i16) -> (Vec<LogPenRecord>, Vec<LogBrushRecord>) {
    let colours = device_colours(system);

    match kind {
        OBJ_PEN => (
            (0..5)
                .flat_map(|style| {
                    colours
                        .iter()
                        .map(move |&color| LogPenRecord { style, color })
                })
                .collect(),
            Vec::new(),
        ),
        OBJ_BRUSH => {
            let solids = LEVELS.iter().flat_map(|&red| {
                LEVELS.iter().flat_map(move |&green| {
                    LEVELS.iter().map(move |&blue| LogBrushRecord {
                        style: 0,
                        color: red | green << 8 | blue << 16,
                        hatch: 0,
                    })
                })
            });
            let hatched = [5, 4, 3, 2, 1, 0].into_iter().flat_map(|hatch| {
                colours.iter().map(move |&color| LogBrushRecord {
                    style: 2,
                    color,
                    hatch,
                })
            });

            (Vec::new(), solids.chain(hatched).collect())
        }
        _ => (Vec::new(), Vec::new()),
    }
}

/// Each pen or brush the display offers handed to a procedure. **Recorded**
/// by `enumregs`: the object 40 bytes up the stack from the procedure's
/// entry for a pen and 38 for a brush, and AX and DS GDI's data segment, ES
/// the stack's (seg4 `08de`); a procedure needs `MakeProcInstance` to find
/// its own data. Nought for a handle that stands for nothing.
pub(super) fn enum_objects(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (objects, procedure, lparam) = {
            let system = engine.system();
            let hdc = args.word(&system);
            let kind = args.signed(&system);
            let procedure = args.dword(&system);
            let lparam = args.dword(&system);

            if system.handles.resolve(hdc).is_none() {
                return Ok(Answer::Word(0));
            }

            let (pens, brushes) = enumerated_objects(&system, kind);
            let objects: Vec<(Vec<u8>, u16)> = pens
                .into_iter()
                .map(|pen| (pen.bytes(), PEN_AT))
                .chain(brushes.into_iter().map(|brush| (brush.bytes(), BRUSH_AT)))
                .collect();

            (objects, procedure, lparam)
        };
        let mut answer: i16 = 0;

        for (bytes, at) in objects {
            let registers = {
                let mut system = engine.system();
                let data = gdi_data_selector(&mut system);
                let stack = system.cpu.segments[SS].selector;

                [
                    Register::Word(AX, data),
                    Register::Segment(DS, data),
                    Register::Segment(ES, stack),
                ]
            };
            let (result, _) = engine
                .call_with(
                    procedure,
                    &[GuestArg::Placed(bytes, at), GuestArg::Long(lparam)],
                    &registers,
                )
                .await?;

            answer = result as i16;

            if answer == 0 {
                return Ok(Answer::Word(0));
            }
        }

        Ok(Answer::Word(answer as u16))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pens_are_each_style_in_the_colours_last_first() {
        let mut system = System::new();

        system.display = crate::display::mode("vga").unwrap();

        let (pens, brushes) = enumerated_objects(&system, OBJ_PEN);

        assert!(brushes.is_empty());
        assert_eq!(pens.len(), 5 * 16);
        assert_eq!(
            pens[0],
            LogPenRecord {
                style: 0,
                color: 0x00ff_ffff
            }
        );
        assert_eq!(pens[15], LogPenRecord { style: 0, color: 0 });
        assert_eq!(pens[16].style, 1);
        assert_eq!(pens[0].bytes(), [0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);
    }

    #[test]
    fn brushes_are_the_solids_then_the_hatches() {
        let mut system = System::new();

        system.display = crate::display::mode("hercules").unwrap();

        let (pens, brushes) = enumerated_objects(&system, OBJ_BRUSH);

        assert!(pens.is_empty());
        assert_eq!(brushes.len(), 125 + 6 * 2);
        assert_eq!(brushes[0].color, 0x00ff_ffff);
        assert_eq!(brushes[1].color, 0x00c0_ffff);
        assert_eq!(brushes[5].color, 0x00ff_c0ff);
        assert_eq!(brushes[124].color, 0);
        assert_eq!(
            brushes[125],
            LogBrushRecord {
                style: 2,
                color: 0x00ff_ffff,
                hatch: 5
            }
        );
        assert_eq!(brushes[136].hatch, 0);
        assert_eq!(enumerated_objects(&system, 3).1.len(), 0);
    }
}
