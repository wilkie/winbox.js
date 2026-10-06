//! Windows 3.x New Executable files, read: the MZ stub's pointer to the NE
//! header, the header, the segment table with each segment's relocations,
//! the entry table, the resident and nonresident name tables, the module
//! references and the resource table, the old `NAMETABLE` resource's names
//! with it.
//!
//! What is read is what the file says, nothing placed in memory: the
//! engine's loader gives each segment its selector and applies the
//! relocations. Strings are the file's bytes as characters, one each.
//!
//! The format: Microsoft's *Executable-File Header Format* (1991), the
//! description kept at <https://wiki.osdev.org/NE>, and winbox.js's own
//! reading of it, `src/executable.ts` and `src/win16/loader.ts`. A
//! relocation's ADDITIVE flag is bit 2 of any type, as both read it. This
//! differs from that reading in one place, where it was short of the
//! format: the resource table is read to its end, not to thirty types.

use std::fmt;

/// Why a file could not be read as an NE executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// No `MZ` at its start.
    NotMz,
    /// No `NE` where the MZ stub's `e_lfanew` points.
    NotNe,
    /// A table that runs past the file's end, by name.
    Truncated(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotMz => write!(f, "not an executable: no MZ header"),
            Self::NotNe => write!(f, "not a New Executable: no NE header"),
            Self::Truncated(table) => write!(f, "the {table} runs past the end of the file"),
        }
    }
}

impl std::error::Error for Error {}

/// The NE header's fields, by the names Microsoft's description gives them.
#[derive(Debug, Clone, Default)]
pub struct Header {
    pub linker_version: (u8, u8),
    pub entry_table_offset: u16,
    pub entry_table_length: u16,
    pub crc: u32,
    pub flags: u16,
    pub auto_data_segment: u16,
    pub initial_heap_size: u16,
    pub initial_stack_size: u16,
    /// The entry point, segment number and offset.
    pub entry_cs: u16,
    pub entry_ip: u16,
    /// The initial stack, segment number and offset.
    pub stack_ss: u16,
    pub stack_sp: u16,
    pub segment_count: u16,
    pub module_reference_count: u16,
    pub nonresident_names_size: u16,
    pub segment_table_offset: u16,
    pub resource_table_offset: u16,
    pub resident_names_offset: u16,
    pub module_reference_offset: u16,
    pub imported_names_offset: u16,
    /// From the file's start, unlike the others, which are from the header.
    pub nonresident_names_offset: u32,
    pub movable_entry_count: u16,
    /// A segment's offset in the file is in units of `1 << page_shift`.
    pub page_shift: u16,
    pub resource_count: u16,
    pub target_os: u8,
    pub os2_flags: u8,
    pub expected_windows_version: u16,
}

impl Header {
    /// SINGLEDATA: one data segment shared, as a library has.
    pub fn single_data(&self) -> bool {
        self.flags & 0x0001 != 0
    }

    /// MULTIPLEDATA: a data segment an instance, as an application has.
    pub fn multiple_data(&self) -> bool {
        self.flags & 0x0002 != 0
    }

    /// A library module, not an application.
    pub fn library(&self) -> bool {
        self.flags & 0x8000 != 0
    }
}

/// An entry of the entry table, by ordinal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryPoint {
    /// An ordinal the table skips.
    Unused,
    /// In a fixed segment: its number and the offset.
    Fixed { segment: u8, offset: u16, flags: u8 },
    /// In a movable segment, as its `INT 3Fh` thunk names it.
    Movable { segment: u8, offset: u16, flags: u8 },
    /// A constant, segment number `FEh`.
    Constant { value: u16, flags: u8 },
}

impl EntryPoint {
    /// Whether the entry is exported: bit 0 of its flags.
    pub fn exported(self) -> bool {
        match self {
            Self::Unused => false,
            Self::Fixed { flags, .. }
            | Self::Movable { flags, .. }
            | Self::Constant { flags, .. } => flags & 1 != 0,
        }
    }

    /// The segment number and offset of an entry in a segment.
    pub fn place(self) -> Option<(u8, u16)> {
        match self {
            Self::Fixed {
                segment, offset, ..
            }
            | Self::Movable {
                segment, offset, ..
            } => Some((segment, offset)),
            _ => None,
        }
    }
}

/// A resource's or a resource type's identity: a number, or a name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceId {
    Number(u16),
    Name(String),
}

/// A resource: where its bytes are in the file and how many, its flags and
/// its identity, and the name the old `NAMETABLE` gives it.
#[derive(Debug, Clone)]
pub struct Resource {
    pub offset: u32,
    pub length: u32,
    pub flags: u16,
    pub id: ResourceId,
    pub name: Option<String>,
}

/// A resource type and its resources.
#[derive(Debug, Clone)]
pub struct ResourceType {
    pub id: ResourceId,
    /// The name a `NAMETABLE` gives a numbered type.
    pub name: Option<String>,
    pub entries: Vec<Resource>,
}

/// The old `NAMETABLE` resource's type number.
pub const NAME_TABLE: u16 = 0x000f;

/// What a relocation points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A place in a fixed segment of the module's own: its number and offset.
    Internal { segment: u8, offset: u16 },
    /// An entry of the module's own, by ordinal.
    Ordinal(u16),
    /// A procedure of another module, by ordinal.
    ImportOrdinal { module: String, ordinal: u16 },
    /// A procedure of another module, by name: the name's offset in the
    /// imported-names table, and the name.
    ImportName {
        module: String,
        name_offset: u16,
        procedure: String,
    },
    /// An operating-system fixup: a floating-point instruction, by its kind.
    OsFixup(u16),
}

/// A relocation of a segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relocation {
    /// What is written: 2 a selector, 3 a far pointer, 5 an offset, and so
    /// on, as the file says.
    pub address_type: u8,
    /// Where in the segment, the first of the chain of places it is written.
    pub offset: u16,
    /// Added to what is there, rather than written down a chain.
    pub additive: bool,
    pub target: Target,
}

/// A segment as the segment table describes it.
#[derive(Debug, Clone)]
pub struct Segment {
    /// Where its bytes are in the file, and how many; nought for none.
    pub offset: u32,
    pub length: u32,
    pub flags: u16,
    /// The bytes it is given in memory, nought for 64 KiB.
    pub min_allocation: u16,
    pub relocations: Vec<Relocation>,
}

impl Segment {
    /// A data segment, not code: bit 0 of its flags.
    pub fn data(&self) -> bool {
        self.flags & 0x0001 != 0
    }

    pub fn code(&self) -> bool {
        !self.data()
    }

    pub fn movable(&self) -> bool {
        self.flags & 0x0010 != 0
    }

    pub fn preload(&self) -> bool {
        self.flags & 0x0040 != 0
    }

    /// Writable data, or readable code: bit 7 clear.
    pub fn writable(&self) -> bool {
        self.flags & 0x0080 == 0
    }

    /// Its image in the file is iterated records (bit 3).
    pub fn iterated(&self) -> bool {
        self.flags & 0x0008 != 0
    }
}

/// A name of the resident or nonresident name table, and the ordinal it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Name {
    pub name: String,
    pub ordinal: u16,
}

/// An NE executable, read.
#[derive(Debug, Clone)]
pub struct Executable {
    bytes: Vec<u8>,
    /// Where the NE header is in the file.
    pub header_offset: u32,
    pub header: Header,
    /// By ordinal: the first, ordinal nought, is never an entry.
    pub entry_points: Vec<EntryPoint>,
    pub resources: Vec<ResourceType>,
    pub segments: Vec<Segment>,
    /// The first is the module's name.
    pub resident_names: Vec<Name>,
    /// The first is the module's description.
    pub nonresident_names: Vec<Name>,
    pub module_references: Vec<String>,
}

/// Bytes of a file read with the file's own bounds.
struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn u8(&self, at: usize, table: &'static str) -> Result<u8, Error> {
        self.0.get(at).copied().ok_or(Error::Truncated(table))
    }

    fn u16(&self, at: usize, table: &'static str) -> Result<u16, Error> {
        Ok(u16::from(self.u8(at, table)?) | (u16::from(self.u8(at + 1, table)?) << 8))
    }

    fn u32(&self, at: usize, table: &'static str) -> Result<u32, Error> {
        Ok(u32::from(self.u16(at, table)?) | (u32::from(self.u16(at + 2, table)?) << 16))
    }

    /// `length` bytes from `at` as characters, one each.
    fn string(&self, at: usize, length: usize, table: &'static str) -> Result<String, Error> {
        let bytes = self.0.get(at..at + length).ok_or(Error::Truncated(table))?;

        Ok(bytes.iter().map(|&byte| char::from(byte)).collect())
    }

    /// A string preceded by its length.
    fn counted(&self, at: usize, table: &'static str) -> Result<String, Error> {
        let length = usize::from(self.u8(at, table)?);

        self.string(at + 1, length, table)
    }
}

impl Executable {
    /// Reads `bytes` as an NE executable.
    pub fn parse(bytes: Vec<u8>) -> Result<Self, Error> {
        let file = Reader(&bytes);

        if file.u16(0, "MZ header")? != 0x5a4d {
            return Err(Error::NotMz);
        }

        let header_offset = file.u32(60, "MZ header")?;
        let at = header_offset as usize;

        if file.u16(at, "NE header")? != 0x454e {
            return Err(Error::NotNe);
        }

        let header = read_header(&file, at)?;
        let module_references = read_module_references(&file, at, &header)?;
        let resident_names =
            read_names(&file, at + usize::from(header.resident_names_offset), None)?;
        let nonresident_names = read_names(
            &file,
            header.nonresident_names_offset as usize,
            Some(usize::from(header.nonresident_names_size)),
        )?;
        let entry_points = read_entry_points(&file, at, &header)?;
        let segments = read_segments(&file, at, &header, &module_references)?;
        let mut executable = Self {
            header_offset,
            header,
            entry_points,
            resources: Vec::new(),
            segments,
            resident_names,
            nonresident_names,
            module_references,
            bytes: Vec::new(),
        };

        executable.resources = read_resources(&file, at, &executable.header)?;
        executable.bytes = bytes;
        executable.name_resources();
        Ok(executable)
    }

    /// The module's name: the first resident name.
    pub fn module_name(&self) -> Option<&str> {
        self.resident_names.first().map(|name| name.name.as_str())
    }

    /// The module's description: the first nonresident name.
    pub fn description(&self) -> Option<&str> {
        self.nonresident_names
            .first()
            .map(|name| name.name.as_str())
    }

    /// The ordinal a name is exported as: the resident names, then the
    /// nonresident ones, without regard to case, the first of each table
    /// not an export; nought for none.
    pub fn ordinal_of(&self, name: &str) -> u16 {
        let wanted = name.to_ascii_uppercase();

        self.resident_names
            .iter()
            .skip(1)
            .chain(self.nonresident_names.iter().skip(1))
            .find(|entry| entry.name.to_ascii_uppercase() == wanted)
            .map_or(0, |entry| entry.ordinal)
    }

    /// A segment's image: its bytes in the file, iterated records spelled
    /// out; empty for a segment with none.
    pub fn segment_bytes(&self, index: usize) -> Vec<u8> {
        let Some(segment) = self.segments.get(index) else {
            return Vec::new();
        };
        let start = segment.offset as usize;
        let end = (start + segment.length as usize).min(self.bytes.len());
        let image = self.bytes.get(start..end).unwrap_or_default();

        if segment.iterated() {
            expand(image)
        } else {
            image.to_vec()
        }
    }

    /// A resource's bytes, as far as the file holds them.
    pub fn resource_bytes(&self, resource: &Resource) -> &[u8] {
        let start = (resource.offset as usize).min(self.bytes.len());
        let end = (start + resource.length as usize).min(self.bytes.len());

        &self.bytes[start..end]
    }

    /// The whole file.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// The names the first `NAMETABLE` gives types and resources.
    fn name_resources(&mut self) {
        let table = self
            .resources
            .iter()
            .find(|kind| kind.id == ResourceId::Number(NAME_TABLE));
        let Some(resource) = table.and_then(|kind| kind.entries.first()).cloned() else {
            return;
        };
        let (type_names, names) = read_name_table(self.resource_bytes(&resource), resource.length);

        for kind in &mut self.resources {
            let ResourceId::Number(number) = kind.id else {
                continue;
            };

            if let Some(name) = type_names.iter().find(|(id, _)| *id == number) {
                kind.name = Some(name.1.clone());
            }

            for entry in &mut kind.entries {
                if let ResourceId::Number(id) = entry.id
                    && let Some(found) = names
                        .iter()
                        .find(|(kind_id, entry_id, _)| *kind_id == number && *entry_id == id)
                {
                    entry.name = Some(found.2.clone());
                }
            }
        }
    }
}

fn read_header(file: &Reader<'_>, at: usize) -> Result<Header, Error> {
    let table = "NE header";
    let word = |offset: usize| file.u16(at + offset, table);

    Ok(Header {
        linker_version: (file.u8(at + 2, table)?, file.u8(at + 3, table)?),
        entry_table_offset: word(4)?,
        entry_table_length: word(6)?,
        crc: file.u32(at + 8, table)?,
        flags: word(12)?,
        auto_data_segment: word(14)?,
        initial_heap_size: word(16)?,
        initial_stack_size: word(18)?,
        entry_ip: word(20)?,
        entry_cs: word(22)?,
        stack_sp: word(24)?,
        stack_ss: word(26)?,
        segment_count: word(28)?,
        module_reference_count: word(30)?,
        nonresident_names_size: word(32)?,
        segment_table_offset: word(34)?,
        resource_table_offset: word(36)?,
        resident_names_offset: word(38)?,
        module_reference_offset: word(40)?,
        imported_names_offset: word(42)?,
        nonresident_names_offset: file.u32(at + 44, table)?,
        movable_entry_count: word(48)?,
        page_shift: word(50)?,
        resource_count: word(52)?,
        target_os: file.u8(at + 54, table)?,
        os2_flags: file.u8(at + 55, table)?,
        expected_windows_version: word(62)?,
    })
}

fn read_module_references(
    file: &Reader<'_>,
    at: usize,
    header: &Header,
) -> Result<Vec<String>, Error> {
    let table = "module reference table";
    let names = at + usize::from(header.imported_names_offset);

    (0..usize::from(header.module_reference_count))
        .map(|index| {
            let offset = file.u16(
                at + usize::from(header.module_reference_offset) + 2 * index,
                table,
            )?;

            file.counted(names + usize::from(offset), "imported-names table")
        })
        .collect()
}

/// A name table: each a counted string and its ordinal, to a length of
/// nought, or to `size` bytes.
fn read_names(file: &Reader<'_>, start: usize, size: Option<usize>) -> Result<Vec<Name>, Error> {
    let table = "name table";
    let end = size.map_or(usize::MAX, |size| start + size);
    let mut names = Vec::new();
    let mut at = start;

    while at < end {
        let Some(&length) = file.0.get(at) else {
            break;
        };

        if length == 0 {
            break;
        }

        let length = usize::from(length);
        let name = file.string(at + 1, length, table)?;
        let ordinal = file.u16(at + 1 + length, table)?;

        names.push(Name { name, ordinal });
        at += length + 3;
    }

    Ok(names)
}

fn read_entry_points(
    file: &Reader<'_>,
    at: usize,
    header: &Header,
) -> Result<Vec<EntryPoint>, Error> {
    let table = "entry table";
    let start = at + usize::from(header.entry_table_offset);
    let end = start + usize::from(header.entry_table_length);
    let mut entries = vec![EntryPoint::Unused];
    let mut offset = start;

    while offset < end {
        let count = file.u8(offset, table)?;

        if count == 0 {
            break;
        }

        let segment = file.u8(offset + 1, table)?;

        offset += 2;

        if segment == 0 {
            entries.extend(std::iter::repeat_n(EntryPoint::Unused, usize::from(count)));
            continue;
        }

        for _ in 0..count {
            let entry = match segment {
                // Movable: flags, INT 3Fh, the segment number, the offset.
                0xff => {
                    let entry = EntryPoint::Movable {
                        flags: file.u8(offset, table)?,
                        segment: file.u8(offset + 3, table)?,
                        offset: file.u16(offset + 4, table)?,
                    };

                    offset += 6;
                    entry
                }
                // A constant: flags and the value.
                0xfe => {
                    let entry = EntryPoint::Constant {
                        flags: file.u8(offset, table)?,
                        value: file.u16(offset + 1, table)?,
                    };

                    offset += 3;
                    entry
                }
                _ => {
                    let entry = EntryPoint::Fixed {
                        flags: file.u8(offset, table)?,
                        segment,
                        offset: file.u16(offset + 1, table)?,
                    };

                    offset += 3;
                    entry
                }
            };

            entries.push(entry);
        }
    }

    Ok(entries)
}

fn read_segments(
    file: &Reader<'_>,
    at: usize,
    header: &Header,
    modules: &[String],
) -> Result<Vec<Segment>, Error> {
    let table = "segment table";
    let shift = if header.page_shift == 0 {
        9
    } else {
        header.page_shift
    };
    let mut segments = Vec::new();

    for index in 0..usize::from(header.segment_count) {
        let entry = at + usize::from(header.segment_table_offset) + 8 * index;
        let offset = u32::from(file.u16(entry, table)?) << shift;
        /* A length of nought is 64 KiB of the file; but a segment at offset
         * nought has nothing in the file, only its allocation. */
        let length = if offset == 0 {
            0
        } else {
            match file.u16(entry + 2, table)? {
                0 => 0x10000,
                length => u32::from(length),
            }
        };
        let flags = file.u16(entry + 4, table)?;
        let min_allocation = file.u16(entry + 6, table)?;
        let relocations = if flags & 0x0100 == 0 {
            Vec::new()
        } else {
            read_relocations(file, at, header, modules, (offset + length) as usize)?
        };

        segments.push(Segment {
            offset,
            length,
            flags,
            min_allocation,
            relocations,
        });
    }

    Ok(segments)
}

fn read_relocations(
    file: &Reader<'_>,
    at: usize,
    header: &Header,
    modules: &[String],
    start: usize,
) -> Result<Vec<Relocation>, Error> {
    let table = "relocation table";
    let count = file.u16(start, table)?;
    let module = |index: u16| -> Result<String, Error> {
        modules
            .get(usize::from(index).wrapping_sub(1))
            .cloned()
            .ok_or(Error::Truncated("module reference table"))
    };
    let mut relocations = Vec::new();

    for index in 0..usize::from(count) {
        let record = start + 2 + 8 * index;
        let address_type = file.u8(record, table)?;
        let kind = file.u8(record + 1, table)?;
        let offset = file.u16(record + 2, table)?;
        let first = file.u16(record + 4, table)?;
        let second = file.u16(record + 6, table)?;
        let target = match kind & 3 {
            0 if first & 0xff == 0xff => Target::Ordinal(second),
            0 => Target::Internal {
                segment: first as u8,
                offset: second,
            },
            1 => Target::ImportOrdinal {
                module: module(first)?,
                ordinal: second,
            },
            2 => {
                let names = at + usize::from(header.imported_names_offset) + usize::from(second);

                Target::ImportName {
                    module: module(first)?,
                    name_offset: second,
                    procedure: file.counted(names, "imported-names table")?,
                }
            }
            /* KERNEL passes OS fixups over in a module whose flags have bit
             * 3 set (`KRNL386.EXE` seg1 `7539`). */
            _ if header.flags & 0x0008 != 0 => continue,
            _ => Target::OsFixup(first),
        };

        relocations.push(Relocation {
            address_type,
            offset,
            additive: kind & 4 != 0,
            target,
        });
    }

    Ok(relocations)
}

fn read_resources(
    file: &Reader<'_>,
    at: usize,
    header: &Header,
) -> Result<Vec<ResourceType>, Error> {
    let table = "resource table";

    if header.resource_table_offset == header.resident_names_offset {
        return Ok(Vec::new());
    }

    let start = at + usize::from(header.resource_table_offset);
    let end = at + usize::from(header.resident_names_offset);
    let shift = file.u16(start, table)?;
    let id = |raw: u16| -> Result<ResourceId, Error> {
        if raw & 0x8000 != 0 {
            Ok(ResourceId::Number(raw & 0x7fff))
        } else {
            Ok(ResourceId::Name(
                file.counted(start + usize::from(raw), table)?,
            ))
        }
    };
    let mut kinds = Vec::new();
    let mut offset = start + 2;

    while offset < end {
        let raw = file.u16(offset, table)?;

        if raw == 0 {
            break;
        }

        let count = file.u16(offset + 2, table)?;
        let mut entries = Vec::new();

        offset += 8;

        for _ in 0..count {
            entries.push(Resource {
                offset: u32::from(file.u16(offset, table)?) << shift,
                length: u32::from(file.u16(offset + 2, table)?) << shift,
                flags: file.u16(offset + 4, table)?,
                id: id(file.u16(offset + 6, table)?)?,
                name: None,
            });
            offset += 12;
        }

        kinds.push(ResourceType {
            id: id(raw)?,
            name: None,
            entries,
        });
    }

    Ok(kinds)
}

/// The type names and the resource names of a `NAMETABLE`: each entry its
/// length, the type's number and the resource's, then two strings each
/// ended by a nought -- the type's name and the resource's, either empty --
/// as far as there are bytes for one.
#[allow(clippy::type_complexity)]
fn read_name_table(bytes: &[u8], length: u32) -> (Vec<(u16, String)>, Vec<(u16, u16, String)>) {
    let mut type_names: Vec<(u16, String)> = Vec::new();
    let mut names: Vec<(u16, u16, String)> = Vec::new();
    let word = |at: usize| u16::from(bytes[at]) | (u16::from(bytes[at + 1]) << 8);
    let mut offset = 0usize;

    while offset < length as usize && offset + 6 <= bytes.len() {
        let size = usize::from(word(offset));
        let kind = word(offset + 2) & 0x7fff;
        let id = word(offset + 4) & 0x7fff;

        if size < 6 {
            break;
        }

        let end = (offset + size).min(bytes.len());
        let mut strings = [String::new(), String::new()];
        let mut at = offset + 6;

        for string in &mut strings {
            while at < end && bytes[at] != 0 {
                string.push(char::from(bytes[at]));
                at += 1;
            }

            at += 1;
        }

        let [type_name, name] = strings;

        if !type_name.is_empty() && !type_names.iter().any(|(number, _)| *number == kind) {
            type_names.push((kind, type_name));
        }

        if !name.is_empty() {
            names.retain(|(number, entry, _)| !(*number == kind && *entry == id));
            names.push((kind, id, name));
        }

        offset += size;
    }

    (type_names, names)
}

/// An iterated segment's records spelled out: each a word of repeats, a
/// word of length and that many bytes, until the image ends.
pub fn expand(records: &[u8]) -> Vec<u8> {
    let mut image = Vec::new();
    let mut at = 0;

    while at + 4 <= records.len() {
        let repeats = usize::from(u16::from_le_bytes([records[at], records[at + 1]]));
        let length = usize::from(u16::from_le_bytes([records[at + 2], records[at + 3]]));
        let bytes = &records[(at + 4).min(records.len())..(at + 4 + length).min(records.len())];

        for _ in 0..repeats {
            image.extend_from_slice(bytes);
        }

        at += 4 + length;
    }

    image
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spells_out_iterated_records() {
        // Two of "ab", then one of "c".
        let records = [2, 0, 2, 0, b'a', b'b', 1, 0, 1, 0, b'c'];

        assert_eq!(expand(&records), b"ababc");
    }

    #[test]
    fn refuses_what_is_not_an_executable() {
        assert_eq!(
            Executable::parse(b"PK\x03\x04".to_vec()).unwrap_err(),
            Error::NotMz
        );

        let mut stub = vec![0u8; 64];

        stub[0..2].copy_from_slice(b"MZ");
        stub[60] = 64;
        stub.extend_from_slice(b"PE\0\0");
        assert_eq!(Executable::parse(stub).unwrap_err(), Error::NotNe);
    }

    #[test]
    fn reads_a_relocations_additive_flag_whatever_its_type() {
        // An import by ordinal, additive: type 1 | 4.
        let mut file = vec![0u8; 0x200];
        let ne = 0x80;

        file[0..2].copy_from_slice(b"MZ");
        file[60] = ne as u8;
        file[ne..ne + 2].copy_from_slice(b"NE");
        file[ne + 28] = 1; // one segment
        file[ne + 30] = 1; // one module reference
        file[ne + 34] = 0x40; // segment table at NE+40h
        file[ne + 36] = 0x48; // resource table, empty: at the resident names
        file[ne + 38] = 0x48; // resident names at NE+48h
        file[ne + 40] = 0x4a; // module references at NE+4Ah
        file[ne + 42] = 0x4c; // imported names at NE+4Ch
        file[ne + 50] = 4; // segments in units of 16 bytes
        // The segment: at 100h, 16 bytes, code with relocations.
        file[ne + 0x40] = 0x10;
        file[ne + 0x42] = 16;
        file[ne + 0x44..ne + 0x46].copy_from_slice(&0x0100u16.to_le_bytes());
        // The module reference: "KERNEL" at offset 1 of the imported names.
        file[ne + 0x4a] = 1;
        file[ne + 0x4d] = 6;
        file[ne + 0x4e..ne + 0x54].copy_from_slice(b"KERNEL");
        // One relocation after the segment's 16 bytes: a far pointer at 2,
        // KERNEL's ordinal 91, additive.
        let at = 0x110;
        file[at] = 1;
        file[at + 2..at + 10].copy_from_slice(&[3, 5, 2, 0, 1, 0, 91, 0]);

        let exe = Executable::parse(file).unwrap();
        let relocation = &exe.segments[0].relocations[0];

        assert!(relocation.additive);
        assert_eq!(
            relocation.target,
            Target::ImportOrdinal {
                module: "KERNEL".into(),
                ordinal: 91
            }
        );
    }
}
