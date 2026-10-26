//! Reading and writing TOOLHELP's structures in a program's memory, and
//! the check every one of its calls makes of the structure it is handed:
//! not nought, and its `dwSize` exactly the structure's size, its high word
//! nought (`TOOLHELP.DLL` seg1 `0cb3`-`0cd0` for `TaskFirst`, and the same
//! in each). As `toolhelp/structures.ts`.

use crate::system::System;

/// A structure at a far address.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Far(pub u32);

impl Far {
    /// The far address `delta` bytes in, the offset within its segment.
    pub fn at(self, delta: u16) -> u32 {
        (self.0 & 0xffff_0000) | u32::from((self.0 as u16).wrapping_add(delta))
    }

    pub fn read16(self, system: &System, delta: u16) -> u16 {
        let bytes = system.read_far(self.at(delta), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    pub fn read32(self, system: &System, delta: u16) -> u32 {
        u32::from(self.read16(system, delta.wrapping_add(2))) << 16
            | u32::from(self.read16(system, delta))
    }

    pub fn write8(self, system: &mut System, delta: u16, value: u8) {
        system.write_far(self.at(delta), &[value]);
    }

    pub fn write16(self, system: &mut System, delta: u16, value: u16) {
        system.write_far(self.at(delta), &value.to_le_bytes());
    }

    pub fn write32(self, system: &mut System, delta: u16, value: u32) {
        self.write16(system, delta, value as u16);
        self.write16(system, delta.wrapping_add(2), (value >> 16) as u16);
    }

    /// A string of up to `length` bytes written, then a nought.
    pub fn write_string(self, system: &mut System, delta: u16, text: &[u8], length: usize) {
        let count = text.len().min(length);

        for (at, &byte) in text[..count].iter().enumerate() {
            self.write8(system, delta.wrapping_add(at as u16), byte);
        }

        self.write8(system, delta.wrapping_add(count as u16), 0);
    }
}

/// The structure handed in, where it is one of `size` bytes as its
/// `dwSize` says.
pub(crate) fn structure(system: &System, far: u32, size: u16) -> Option<Far> {
    if far == 0 {
        return None;
    }

    let entry = Far(far);

    (entry.read16(system, 0) == size && entry.read16(system, 2) == 0).then_some(entry)
}
