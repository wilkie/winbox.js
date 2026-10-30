//! Exports that are data, not code: what a program finds at the address
//! `GetProcAddress` gives for one, or its import is bound to. As
//! `exported-data.ts`, which tells where Windows has each: bytes laid where
//! the export's stub would be, as a table in code is -- each system
//! module's `__GP` -- or a place in the module's own data segment, as
//! KERNEL's `THHOOK` and GDI's `FTrapping0` are.

use crate::kernel_calls::thhook::THHOOK_OFFSET;

/// The end of a `__GP` table, a selector of nought (`KRNL386.EXE` seg1
/// `4c72`-`4d36`, `HasGPHandler`'s walk). WinBox's modules have no code of
/// Windows' to fault in: their tables hold the end alone.
pub const GP_TABLE_END: u16 = 0;

const EMPTY_GP_TABLE: [u8; 2] = GP_TABLE_END.to_le_bytes();

/// `FTrapping0`'s word in GDI's data (`GDI.EXE` seg48 `02ef`).
pub const FTRAPPING0_OFFSET: u16 = 0x2ef;

/// Where an export that is data is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportedData {
    /// These bytes in place of its stub.
    Stub(&'static [u8]),
    /// This offset in the module's data segment.
    Data(u16),
}

/// The export at an ordinal of a kept module, if it is data.
pub fn exported_data(module: &str, ordinal: u16) -> Option<ExportedData> {
    match (module, ordinal) {
        ("KERNEL", 342) | ("USER", 484) | ("GDI", 46) => Some(ExportedData::Stub(&EMPTY_GP_TABLE)),
        ("KERNEL", 332) => Some(ExportedData::Data(THHOOK_OFFSET)),
        ("GDI", 355) => Some(ExportedData::Data(FTRAPPING0_OFFSET)),
        _ => None,
    }
}

impl crate::system::System {
    /// The far address of an export that is a place in its module's data,
    /// what is there laid out as it is handed out.
    pub(crate) fn exported_data_place(
        &mut self,
        kept: usize,
        ordinal: u16,
    ) -> Option<(usize, u16)> {
        let name = self.kept[kept].module.name;
        let Some(ExportedData::Data(offset)) = exported_data(name, ordinal) else {
            return None;
        };

        if name == "KERNEL" {
            self.thhook_handed_out();
        }

        Some((self.kept[kept].data, offset))
    }
}
