//! GDI's font table: the files `AddFontResource` added, each with a count of
//! its adds, and what `RemoveFontResource` takes away. Read out of `GDI.EXE`
//! (`kb/topics/font-resources.md`) and recorded by `fontres`.
//!
//! A raster or vector file is a library with no data segment whose
//! `FONTDIR` lists its fonts; GDI keeps it loaded and knows it again by its
//! module (seg2 `0c09`). A TrueType `.FOT` stub is let go as soon as GDI has
//! read it, and is known again by the full name its one font carries
//! (seg2 `0b0b`): another stub naming the same face is the same font.

use super::{FontManager, file_name, read_font_resource};
use winbox_raster::FontResource;

/// `RT_FONTDIR`, a numbered type.
const RT_FONTDIR: u16 = 0x8007;

/// The size of a `FONTDIRENTRY` before its device and face names.
const DIRECTORY_ENTRY: usize = 0x71;

/// What `AddFontResource` reads of a file: its module's name, whether it has
/// a data segment, its `FONTDIR`'s count, whether its first font is a
/// TrueType one, and the full name that font carries; and whether every
/// entry's `dfVersion` is one GDI takes (seg2 `0d9d`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontFile {
    pub module: String,
    pub data: bool,
    pub count: u16,
    pub true_type: bool,
    pub full_name: String,
    pub versions: bool,
}

fn word(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]))
}

fn string(bytes: &[u8], at: usize) -> Option<(String, usize)> {
    let end = at + bytes.get(at..)?.iter().position(|&byte| byte == 0)?;

    Some((
        bytes[at..end]
            .iter()
            .map(|&byte| char::from(byte))
            .collect(),
        end + 1,
    ))
}

/// A font file as `AddFontResource` reads it; `None` for a file that is no
/// `NE` module, or one with no `FONTDIR`, which it fails.
pub fn font_file(bytes: &[u8]) -> Option<FontFile> {
    if word(bytes, 0)? != 0x5a4d {
        return None;
    }

    let ne = u32::from_le_bytes(bytes.get(0x3c..0x40)?.try_into().ok()?) as usize;

    if word(bytes, ne)? != 0x454e {
        return None;
    }

    // Its module's name, the resident names' first.
    let names = ne + usize::from(word(bytes, ne + 0x26)?);
    let length = usize::from(*bytes.get(names)?);
    let module: String = bytes
        .get(names + 1..names + 1 + length)?
        .iter()
        .map(|&byte| char::from(byte.to_ascii_uppercase()))
        .collect();
    let data = word(bytes, ne + 0x0e)? != 0;

    // The `FONTDIR`: the first resource of its type.
    let table = ne + usize::from(word(bytes, ne + 0x24)?);
    let shift = word(bytes, table)? & 31;
    let mut at = table + 2;
    let mut directory = None;

    loop {
        let kind = word(bytes, at)?;

        if kind == 0 {
            break;
        }

        let count = usize::from(word(bytes, at + 2)?);

        if kind == RT_FONTDIR && count > 0 {
            directory = Some((usize::from(word(bytes, at + 8)?)) << shift);
            break;
        }

        at += 8 + count * 12;
    }

    let directory = directory?;
    let count = word(bytes, directory)?;
    let mut entry = directory + 2;
    let mut versions = true;
    let mut true_type = false;
    let mut full_name = String::new();

    for index in 0..count {
        // Each entry: its font's ordinal, its `FONTDIRENTRY`, its device's
        // name and its face's.
        let info = entry + 2;
        let version = word(bytes, info)?;
        let kind = word(bytes, info + 0x42)?;

        if version > 0x200 {
            versions = false;
        }

        let (_, after_device) = string(bytes, info + DIRECTORY_ENTRY)?;
        let (_, after_face) = string(bytes, after_device)?;

        if index == 0 && kind & 3 == 3 {
            true_type = true;
            full_name = string(bytes, after_face).map(|(name, _)| name)?;
        }

        entry = after_face;
    }

    Some(FontFile {
        module,
        data,
        count,
        true_type,
        full_name,
        versions,
    })
}

/// A file GDI's font table has: its module's name, its file's, its adds,
/// its fonts, and for a TrueType stub the full name it is known by.
#[derive(Debug, Clone)]
pub struct Added {
    pub module: String,
    pub file: String,
    pub uses: u32,
    pub count: u16,
    pub full_name: Option<String>,
}

impl FontManager {
    /// A file the boot adds, as `AddFontResource` would (USER's start-up adds
    /// each line of `WIN.INI` `[fonts]` with it, `USER.EXE` seg3 `1bcf`).
    pub(super) fn register(&mut self, name: &str, bytes: &[u8]) {
        let Some(file) = font_file(bytes) else {
            return;
        };

        self.added.push(Added {
            module: file.module,
            file: file_name(name),
            uses: 1,
            count: file.count,
            full_name: file.true_type.then_some(file.full_name),
        });
    }

    /// A stub's slot in the TrueType table: the first a font removed left
    /// empty, else a new one at its end (seg2 `0f2c`).
    pub(super) fn fill_slot(&mut self, resource: FontResource) {
        match self.slots.iter_mut().find(|slot| slot.is_none()) {
            Some(slot) => *slot = Some(resource),
            None => self.slots.push(Some(resource)),
        }

        self.true_type_directory = self.slots.iter().flatten().cloned().collect();
    }

    /// `AddFontResource` of a file read: the fonts its `FONTDIR` lists, or
    /// nought. `ttf` reads the `.TTF` a stub names. The file already added --
    /// a raster one by its module, a stub by its font's full name -- is
    /// counted once more and added no more (seg2 `0c22`).
    pub fn add_resource(
        &mut self,
        name: &str,
        bytes: Vec<u8>,
        ttf: impl FnOnce(&str) -> Option<Vec<u8>>,
    ) -> u16 {
        // A library with a data segment is let go: no font file has one
        // (seg2 `0bb9`).
        let Some(file) = font_file(&bytes).filter(|file| !file.data) else {
            return 0;
        };

        if file.true_type {
            if let Some(added) = self.added.iter_mut().find(|added| {
                added
                    .full_name
                    .as_ref()
                    .is_some_and(|full| full.eq_ignore_ascii_case(&file.full_name))
            }) {
                added.uses += 1;
                return 1;
            }

            let Some(resource) = read_font_resource(&bytes) else {
                return 0;
            };

            self.load_stub(name, &bytes, true);

            // The outlines, unless a stub already loaded them.
            let loaded = self.outlines.iter().any(|(_, family)| {
                family.iter().any(|(_, font)| {
                    font.file_name.borrow().as_deref() == Some(resource.file.as_str())
                })
            });

            if !loaded && let Some(outlines) = ttf(&resource.file) {
                self.load_outline(&resource.file, outlines);
            }

            return file.count;
        }

        if let Some(added) = self
            .added
            .iter_mut()
            .find(|added| added.full_name.is_none() && added.module == file.module)
        {
            added.uses += 1;
            return added.count;
        }

        if !file.versions {
            return 0;
        }

        // Its faces put at the table's end, as GDI appends them: a file
        // loaded before only so that its faces are found, not listed, goes
        // from where it was.
        self.drop_strikes(&file_name(name));
        self.load_strikes(name, bytes, true);
        file.count
    }

    /// `RemoveFontResource`: whether a font was taken away. `name` is what the
    /// program passed, a file's or a module's; `bytes` the file it names, read,
    /// where there is one. A raster file is found by its module, as KERNEL's
    /// `GetModuleHandle` finds it (seg6 `03b5`); else the file is read and a
    /// stub found by its font's full name (seg6 `03f3`). Its last add taken
    /// away, it goes; this keeps no count of the fonts realised from it, which
    /// GDI waits for (seg6 `0179`).
    pub fn remove_resource(&mut self, name: &str, bytes: Option<&[u8]>) -> bool {
        let wanted = file_name(name);
        let by_module = !wanted.contains('.');
        let found = self.added.iter().position(|added| {
            added.full_name.is_none()
                && if by_module {
                    added.module == wanted
                } else {
                    added.file == wanted
                }
        });
        let found = found.or_else(|| {
            let file = font_file(bytes?)?;

            file.true_type.then_some(())?;
            self.added.iter().position(|added| {
                added
                    .full_name
                    .as_ref()
                    .is_some_and(|full| full.eq_ignore_ascii_case(&file.full_name))
            })
        });
        let Some(at) = found else {
            return false;
        };

        self.added[at].uses -= 1;

        if self.added[at].uses > 0 {
            return true;
        }

        let added = self.added.remove(at);

        match &added.full_name {
            Some(full) => self.drop_slot(full),
            None => self.drop_strikes(&added.file),
        }

        true
    }

    /// A file's strikes taken out of the table, and a face left with none.
    fn drop_strikes(&mut self, file: &str) {
        for (_, strikes) in &mut self.fonts {
            strikes.retain(|strike| strike.file != file);
        }

        self.fonts.retain(|(_, strikes)| !strikes.is_empty());
    }

    /// A stub's slot emptied, and its outlines taken from the mapper.
    fn drop_slot(&mut self, full: &str) {
        let mut file = None;

        for slot in &mut self.slots {
            if slot
                .as_ref()
                .is_some_and(|resource| resource.full_name.eq_ignore_ascii_case(full))
            {
                file = slot.take().map(|resource| resource.file);
            }
        }

        self.true_type_directory = self.slots.iter().flatten().cloned().collect();

        let Some(file) = file else {
            return;
        };

        if self
            .true_type_directory
            .iter()
            .any(|resource| resource.file == file)
        {
            return;
        }

        for (_, family) in &mut self.outlines {
            family.retain(|(_, font)| font.file_name.borrow().as_deref() != Some(file.as_str()));
        }

        self.outlines.retain(|(_, family)| !family.is_empty());
    }
}
