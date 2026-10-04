//! GDI's objects where a program that goes looking finds them: in GDI's
//! data segment, its local heap, as Windows 3.1 keeps them -- winbox.js's
//! `gdi-heap.ts`. The objects are kept here in Rust; this makes the bytes a
//! program reads from GDI's segment as it reads them, and loses what it
//! writes there.
//!
//! **Recorded** by `gdiobj`, walking as the engine Bubble Girl of the
//! corpus brings walks, to draw into a bitmap's bits itself:
//!
//! * A bitmap's handle is a moveable local handle: the word at it is the
//!   object's address, and the two bytes after it nought.
//! * The object's word at +2 is `KO`, 4F4Bh, and at +0Ah a moveable global
//!   handle: its block, 20h bytes of the display driver's header. When the
//!   bits fit after the header in 64 KiB they follow it there; otherwise the
//!   block is the header alone and the bits a block of their own.
//! * The header: nought, the width, the height, the bytes of a plane's row,
//!   the planes, 4, and the bits a pixel, 1; the bits' far pointer, nought
//!   until the bitmap is first selected into a device context; the bytes of
//!   a plane; and at 16h, 18h and 1Ah the step from one of the bits'
//!   selectors to the next, the rows that fit in 64 KiB, and the bytes left
//!   after them.
//! * The bits: each row the four planes' rows in turn. Rows do not cross
//!   from one 64 KiB segment to the next.
//!
//! The header and the bits are plain memory, which the program reads and
//! writes as it likes; around each call the bitmaps whose blocks were made
//! are made to agree with them: their pixels read from the bits before, and
//! the bits and the header written from the pixels after. The TypeScript
//! engine does this around a call that names such a bitmap; read before and
//! written after, the bits come back as they were, so doing it around every
//! call is the same, and costs nothing until a program has asked.
//!
//! Only a bitmap of the display's four planes is laid out; other objects,
//! and the rest of their fields, read as noughts. Where Windows puts objects
//! is not recorded: here they are given addresses above the handles as they
//! are first looked for.

use std::collections::HashMap;

use winbox_machine::index_for;

use crate::call::Args;
use crate::handles::Object;
use crate::system::System;

use super::GdiObject;

const KO: u16 = 0x4f4b;
const HEADER: u32 = 0x20;
const OBJECT: u32 = 0x10;

/// The objects above GDI's handles, which are given out below 4000h.
const FIRST_OBJECT: u32 = 0x4000;

/// How a bitmap's bits are laid out in memory.
#[derive(Debug, Clone, Copy)]
struct Layout {
    row: u32,
    line: u32,
    lines: u32,
    fill: u32,
    inline: bool,
    size: u32,
}

/// A bitmap's blocks: its header's handle, its bits' where they are a block
/// of their own, and how they are laid out.
#[derive(Debug, Clone, Copy)]
struct Blocks {
    header: u16,
    bits: Option<u16>,
    layout: Layout,
}

/// What GDI's segment keeps as a program reads it.
#[derive(Debug, Default)]
pub struct Heap {
    addresses: HashMap<u16, u32>,
    owners: HashMap<u32, u16>,
    next: u32,
    /// The bitmaps whose blocks were made, by object, in the order made.
    blocks: Vec<(usize, Blocks)>,
}

impl Heap {
    pub fn new() -> Self {
        Self {
            next: FIRST_OBJECT,
            ..Self::default()
        }
    }
}

fn layout_of(width: i32, height: i32) -> Layout {
    let row = (((width + 15) >> 4) << 1) as u32;
    let line = row * 4;
    let lines = 0x10000 / line.max(1);
    let bits = line * height as u32;
    let inline = HEADER + bits < 0x10000;
    let tiles = (height as u32).div_ceil(lines.max(1));
    let size = if inline {
        HEADER + bits + 1
    } else {
        (tiles - 1) * 0x10000 + (height as u32 - (tiles - 1) * lines) * line
    };

    Layout {
        row,
        line,
        lines,
        fill: 0x10000 - lines * line,
        inline,
        size,
    }
}

impl System {
    /// The bitmap object a handle stands for, where it is laid out: one of
    /// the display's four planes, not a view.
    fn laid_out(&self, handle: i32) -> Option<usize> {
        let handle = u16::try_from(handle).ok()?;

        match self.handles.resolve(handle)? {
            Object::Gdi(index) => match &self.gdi.objects[index] {
                GdiObject::Bitmap(bitmap)
                    if bitmap.pixels.depth == 4 && !bitmap.pixels.is_view() =>
                {
                    Some(index)
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// The object's address for a handle, given it the first time.
    fn address_of(&mut self, handle: u16) -> u32 {
        let heap = &mut self.gdi_heap;

        if let Some(&address) = heap.addresses.get(&handle) {
            return address;
        }

        if heap.next + OBJECT > 0x10000 {
            return 0;
        }

        let address = heap.next;

        heap.next += OBJECT;
        heap.addresses.insert(handle, address);
        heap.owners.insert(address, handle);
        address
    }

    /// A byte of GDI's segment, as a program reads it.
    pub fn gdi_heap_read(&mut self, offset: u32) -> u8 {
        // A handle's entry: the object's address, then two noughts.
        if offset < FIRST_OBJECT {
            let handle = ((offset as i32 - 2) & !3) + 2;

            if self.laid_out(handle).is_none() {
                return 0;
            }

            let address = self.address_of(handle as u16);

            return if offset as i32 == handle {
                address as u8
            } else if offset as i32 == handle + 1 {
                (address >> 8) as u8
            } else {
                0
            };
        }

        let base = offset & !(OBJECT - 1);
        let Some(&handle) = self.gdi_heap.owners.get(&base) else {
            return 0;
        };
        let Some(object) = self.laid_out(i32::from(handle)) else {
            return 0;
        };
        let word = |value: u16| {
            if offset & 1 != 0 {
                (value >> 8) as u8
            } else {
                value as u8
            }
        };

        match offset - base {
            2 | 3 => word(KO),
            0x0a | 0x0b => word(self.bits_of(object)),
            _ => 0,
        }
    }

    /// A bitmap's blocks, made the first time they are asked for: its
    /// header's handle.
    fn bits_of(&mut self, object: usize) -> u16 {
        if let Some((_, blocks)) = self
            .gdi_heap
            .blocks
            .iter()
            .find(|(each, _)| *each == object)
        {
            return blocks.header;
        }

        let GdiObject::Bitmap(bitmap) = &self.gdi.objects[object] else {
            return 0;
        };
        let layout = layout_of(bitmap.pixels.width(), bitmap.pixels.height());
        let header = self.global_block(if layout.inline { layout.size } else { HEADER });

        if header == 0 {
            return 0;
        }

        let bits = if layout.inline {
            None
        } else {
            let bits = self.global_block(layout.size);

            if bits == 0 {
                crate::memory::global_free(self, &mut Args::repeat(header)).ok();
                return 0;
            }

            Some(bits)
        };

        self.cpu.bus.zero(
            (index_for(header) as u32) << 16,
            (if layout.inline { layout.size } else { HEADER }) as usize,
        );

        if let Some(bits) = bits {
            self.cpu
                .bus
                .zero((index_for(bits) as u32) << 16, layout.size as usize);
        }

        let blocks = Blocks {
            header,
            bits,
            layout,
        };

        self.gdi_heap.blocks.push((object, blocks));
        self.store_bits(object, blocks);
        header
    }

    /// A moveable global block, as `GlobalAlloc` makes one: its handle.
    fn global_block(&mut self, size: u32) -> u16 {
        let index = self
            .global
            .allocate(&mut self.cpu.bus, &mut self.descriptors, size, 0x0002);

        index.map_or(0, winbox_machine::handle_for)
    }

    /// A bitmap deleted: its blocks let go.
    pub fn forget_bitmap(&mut self, object: usize) {
        let Some(at) = self
            .gdi_heap
            .blocks
            .iter()
            .position(|(each, _)| *each == object)
        else {
            return;
        };
        let (_, blocks) = self.gdi_heap.blocks.remove(at);

        for handle in [Some(blocks.header), blocks.bits].into_iter().flatten() {
            crate::memory::global_free(self, &mut Args::repeat(handle)).ok();
        }
    }

    /// Where row `y` of a bitmap's bits is, as a linear address.
    fn row_at(blocks: Blocks, y: u32) -> u32 {
        let layout = blocks.layout;

        match blocks.bits {
            None => ((index_for(blocks.header) as u32) << 16) + HEADER + y * layout.line,
            Some(bits) => {
                let tile = y / layout.lines;

                ((index_for(bits) as u32 + tile) << 16) + (y - tile * layout.lines) * layout.line
            }
        }
    }

    /// A bitmap's pixels read from its bits, as the program left them.
    fn load_bits(&mut self, object: usize, blocks: Blocks) {
        let GdiObject::Bitmap(bitmap) = &self.gdi.objects[object] else {
            return;
        };
        let pixels = bitmap.pixels.clone();
        let Layout { row, line, .. } = blocks.layout;

        for y in 0..pixels.height() {
            let bytes = self
                .cpu
                .bus
                .read(Self::row_at(blocks, y as u32), line as usize);

            for x in 0..pixels.width() {
                let byte = (x >> 3) as usize;
                let shift = 7 - (x & 7);
                let index = (0..4).fold(0u8, |index, plane| {
                    index | ((bytes[plane * row as usize + byte] >> shift) & 1) << plane
                });

                pixels.put(x, y, index);
            }
        }
    }

    /// A bitmap's bits written from its pixels, the bits past its width as
    /// they were, and its header's fields.
    fn store_bits(&mut self, object: usize, blocks: Blocks) {
        let GdiObject::Bitmap(bitmap) = &self.gdi.objects[object] else {
            return;
        };
        let pixels = bitmap.pixels.clone();
        let Layout { row, line, .. } = blocks.layout;

        for y in 0..pixels.height() {
            let at = Self::row_at(blocks, y as u32);
            let mut bytes = self.cpu.bus.read(at, line as usize);

            for x in 0..pixels.width() {
                let byte = (x >> 3) as usize;
                let bit = 0x80u8 >> (x & 7);
                let index = pixels.index_at(x, y).unwrap_or(0);

                for plane in 0..4 {
                    let at = plane * row as usize + byte;

                    if (index >> plane) & 1 != 0 {
                        bytes[at] |= bit;
                    } else {
                        bytes[at] &= !bit;
                    }
                }
            }

            self.cpu.bus.write(at, &bytes);
        }

        let selector = blocks.bits.unwrap_or(blocks.header) | 1;
        let pointer = if pixels.selected {
            u32::from(selector) << 16 | if blocks.bits.is_some() { 0 } else { HEADER }
        } else {
            0
        };
        let mut header = vec![0u8; HEADER as usize];

        header[2..4].copy_from_slice(&(pixels.width() as u16).to_le_bytes());
        header[4..6].copy_from_slice(&(pixels.height() as u16).to_le_bytes());
        header[6..8].copy_from_slice(&(row as u16).to_le_bytes());
        header[8] = 4;
        header[9] = 1;
        header[0x0a..0x0e].copy_from_slice(&pointer.to_le_bytes());
        header[0x0e..0x12].copy_from_slice(&(row * pixels.height() as u32).to_le_bytes());
        header[0x16..0x18]
            .copy_from_slice(&(if blocks.layout.inline { 0u16 } else { 8 }).to_le_bytes());
        header[0x18..0x1a].copy_from_slice(&(blocks.layout.lines as u16).to_le_bytes());
        header[0x1a..0x1c].copy_from_slice(&(blocks.layout.fill as u16).to_le_bytes());
        self.cpu
            .bus
            .write((index_for(blocks.header) as u32) << 16, &header);
    }

    /// Before a call: what was answered of GDI's segment let go, to be made
    /// again as it is next read, and the bitmaps whose blocks were made read
    /// from their bits.
    pub fn gdi_heap_before_call(&mut self) {
        self.cpu.bus.forget_answers();

        for (object, blocks) in self.gdi_heap.blocks.clone() {
            self.load_bits(object, blocks);
        }
    }

    /// After a call: those bitmaps' bits written from their pixels again.
    pub fn gdi_heap_after_call(&mut self) {
        for (object, blocks) in self.gdi_heap.blocks.clone() {
            self.store_bits(object, blocks);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lays_bits_out_after_the_header_or_in_blocks_of_their_own() {
        // Bubble Girl's 320 by 220: after the header, and a byte more.
        let small = layout_of(320, 220);

        assert!(small.inline);
        assert_eq!(
            (small.row, small.line, small.size),
            (40, 160, 0x20 + 160 * 220 + 1)
        );

        // The screen's size: 204 rows to a segment, three segments.
        let large = layout_of(640, 480);

        assert!(!large.inline);
        assert_eq!(large.lines, 204);
        assert_eq!(large.fill, 0x10000 - 204 * 320);
        assert_eq!(large.size, 2 * 0x10000 + (480 - 408) * 320);
    }
}
