//! GDI's font table: the files `AddFontResource` added, each with a count of
//! its adds, and what `RemoveFontResource` takes away. Read out of `GDI.EXE`
//! (`kb/topics/font-resources.md`) and recorded by `fontres`.
//!
//! A raster or vector file is a library with no data segment whose
//! `FONTDIR` lists its fonts; GDI keeps it loaded and knows it again by its
//! module (seg2 `0c09`). A TrueType `.FOT` stub is let go as soon as GDI has
//! read it, and is known again by the full name its one font carries
//! (seg2 `0b0b`): another stub naming the same face is the same font.

use std::rc::Rc;

use super::{FontManager, LogFont, Strike, file_name, read_font_resource};
use winbox_raster::{FontResource, LogicalFont, TrueTypeFont};

/// `RT_FONTDIR`, a numbered type.
const RT_FONTDIR: u16 = 0x8007;

/// The size of a `FONTDIRENTRY` before its device and face names.
const DIRECTORY_ENTRY: usize = 0x71;

/// What `AddFontResource` reads of a file: its module's name, whether it has
/// a data segment, its `FONTDIR`'s count, whether its first font is a
/// TrueType one, and the full name that font carries; and the highest
/// `dfVersion` among its entries that is neither 200h nor 100h, nought
/// where none is, which GDI holds to its limit (seg2 `0d9d`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontFile {
    pub module: String,
    pub data: bool,
    pub count: u16,
    pub true_type: bool,
    pub full_name: String,
    pub highest: u16,
}

/// The highest `dfVersion` GDI takes a raster or vector file's entry of,
/// besides 200h and 100h, which it always takes (seg2 `0d9d`): 300h where
/// the display's `RASTERCAPS` has `RC_BIGFONT`, else 200h, set as the first
/// device context is made (seg1 `047a`). **Recorded** by `fontver`: 250h,
/// 300h, nought and 1FFh taken and 301h refused on the VGA; on the
/// Hercules, which has no `RC_BIGFONT`, 250h and 300h refused too.
pub fn version_limit(big_font: bool) -> u16 {
    if big_font { 0x300 } else { 0x200 }
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
    let mut highest = 0;
    let mut true_type = false;
    let mut full_name = String::new();

    for index in 0..count {
        // Each entry: its font's ordinal, its `FONTDIRENTRY`, its device's
        // name and its face's.
        let info = entry + 2;
        let version = word(bytes, info)?;
        let kind = word(bytes, info + 0x42)?;

        if version != 0x200 && version != 0x100 {
            highest = highest.max(version);
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
        highest,
    })
}

/// A file GDI's font table has: its module's name, its file's, its adds,
/// its fonts, and for a TrueType stub the full name it is known by. A
/// raster file whose adds are all taken away while a font realised from it
/// is cached stays, its adds nought and its strikes kept out of the table,
/// each with its face's name, until the last such font goes (`hidden`).
#[derive(Debug, Clone)]
pub struct Added {
    pub module: String,
    pub file: String,
    pub uses: u32,
    pub count: u16,
    pub full_name: Option<String>,
    pub hidden: Vec<(String, Strike)>,
}

/// A font GDI's cache holds that was realised from a raster file's strike:
/// the font object that realised it, the `LOGFONT` it was made of, the
/// font, and the file (`GDI.EXE` seg3 `0dd0`, which counts it against the
/// file).
#[derive(Debug, Clone)]
pub struct Cached {
    pub owner: usize,
    pub logfont: LogFont,
    pub font: LogicalFont,
    pub file: String,
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
            hidden: Vec::new(),
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
    /// nought. `ttf` reads the `.TTF` a stub names; `limit` is the highest
    /// version taken (`version_limit`). The file already added -- a raster
    /// one by its module, a stub by its font's full name -- is counted once
    /// more and added no more (seg2 `0c22`); a raster file removed while a
    /// font of it was cached, still in the table with no adds, has its
    /// faces back where they were.
    pub fn add_resource(
        &mut self,
        name: &str,
        bytes: Vec<u8>,
        limit: u16,
        ttf: impl FnOnce(&str) -> Option<Vec<u8>>,
    ) -> u16 {
        // A library with a data segment is let go: no font file has one
        // (seg2 `0bb9`).
        let Some(file) = font_file(&bytes).filter(|file| !file.data) else {
            return 0;
        };

        // With TrueType off GDI has no TrueType table, and a stub's add
        // fails (seg2 `0f38`; **recorded** by `fontboot`).
        if file.true_type && self.true_type_off {
            return 0;
        }

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

        if let Some(at) = self
            .added
            .iter()
            .position(|added| added.full_name.is_none() && added.module == file.module)
        {
            self.added[at].uses += 1;

            let hidden = std::mem::take(&mut self.added[at].hidden);

            self.show_strikes(hidden);
            return self.added[at].count;
        }

        if file.highest > limit {
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
    /// stub found by its font's full name (seg6 `03f3`). One with no adds
    /// left answers nought (`03d0`). Its last add taken away, it goes -- but
    /// a raster file a cached font was realised from stays, its faces hidden
    /// from enumeration and the mapper, until the last such font leaves the
    /// cache (seg6 `01b8`, `0179`; **recorded** by `fontdef`).
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

        if self.added[at].uses == 0 {
            return false;
        }

        self.added[at].uses -= 1;

        if self.added[at].uses > 0 {
            return true;
        }

        if self.added[at].full_name.is_none() {
            let file = self.added[at].file.clone();

            if self.cached.iter().any(|cached| cached.file == file) {
                self.added[at].hidden = self.take_strikes(&file);
                return true;
            }
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
        self.take_strikes(file);
    }

    /// A file's strikes taken out of the table, each with its face's name,
    /// and a face left with none.
    fn take_strikes(&mut self, file: &str) -> Vec<(String, Strike)> {
        let mut taken = Vec::new();

        for (face, strikes) in &mut self.fonts {
            let (gone, kept): (Vec<Strike>, Vec<Strike>) = std::mem::take(strikes)
                .into_iter()
                .partition(|strike| strike.file == file);

            *strikes = kept;
            taken.extend(gone.into_iter().map(|strike| (face.clone(), strike)));
        }

        self.fonts.retain(|(_, strikes)| !strikes.is_empty());
        taken
    }

    /// Strikes hidden put back in the table where they were: each face's in
    /// the order the table had them.
    fn show_strikes(&mut self, hidden: Vec<(String, Strike)>) {
        for (face, strike) in hidden {
            match self.fonts.iter_mut().find(|(name, _)| *name == face) {
                Some((_, strikes)) => {
                    let at = strikes.partition_point(|each| each.order < strike.order);

                    strikes.insert(at, strike);
                }
                None => self.fonts.push((face, vec![strike])),
            }
        }
    }

    /// A font cached made of the same `LOGFONT`, which realising one finds
    /// before it maps (`GDI.EXE` seg3, the cache at `[36Ah]`): **recorded**
    /// by `fontdef`, a font made again of MS Serif at 13 once `SERIFE.FON`
    /// was removed is still its 13-row strike while the first is cached.
    pub fn cached(&self, logfont: &LogFont) -> Option<LogicalFont> {
        self.cached
            .iter()
            .find(|cached| cached.logfont == *logfont)
            .map(|cached| cached.font.clone())
    }

    /// A font realised by a font object, cached where it is a strike of a
    /// file of GDI's table (seg3 `0dd0`).
    pub fn cache(&mut self, owner: usize, logfont: LogFont, font: &LogicalFont) {
        let Some(entry) = &font.entry else {
            return;
        };
        let file = self
            .fonts
            .iter()
            .flat_map(|(_, strikes)| strikes)
            .find(|strike| Rc::ptr_eq(&strike.entry, entry))
            .map(|strike| strike.file.clone());

        if let Some(file) = file {
            self.cached.push(Cached {
                owner,
                logfont,
                font: font.clone(),
                file,
            });
        }
    }

    /// A font object's fonts gone from the cache (seg6 `0362`, `044d`), and
    /// a file removed whose last cached font that was let go (`0179`).
    pub fn release(&mut self, owner: usize) {
        if !self.cached.iter().any(|cached| cached.owner == owner) {
            return;
        }

        self.cached.retain(|cached| cached.owner != owner);

        let cached = &self.cached;

        self.added
            .retain(|added| added.uses > 0 || cached.iter().any(|each| each.file == added.file));
    }

    /// Every outline file of every family.
    pub fn outline_files(&self) -> Vec<Rc<TrueTypeFont>> {
        self.outlines
            .iter()
            .flat_map(|(_, family)| family.iter().map(|(_, font)| font.clone()))
            .collect()
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
