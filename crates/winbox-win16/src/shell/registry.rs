//! The registration database: `REG.DAT`, as `SHELL.DLL` keeps it.
//!
//! **Read out of `SHELL.DLL`** (seg2, and seg7 for the writer), and of the
//! installation's own `REG.DAT`, every byte of which decodes as below.
//!
//! The file is a header of 20h bytes -- `SHCC3.10`, 20h, the node table's
//! offset and count, the text area's offset and size, the number of hash
//! buckets and the head of the free list -- then a table of 8-byte entries
//! and a text area. One index names three kinds of entry:
//!
//! * **Entry 0** is the root. **Entries 1 to the bucket count** are hash
//!   buckets, each the head of a circular chain of texts.
//! * **A key**: next sibling, first child, its name's text and its value's.
//! * **A text**: next in its bucket's chain, how many use it, its length, and
//!   where it is in the text area, just past a word that names the entry
//!   back. Names and values share texts: `txtfile` is `.txt`'s value,
//!   `.ini`'s, and a key's name.
//!
//! `HKEY_CLASSES_ROOT` is not the root but its child `.classes`. A key made
//! is put first among its parent's children, so they come newest first. A
//! name matches whatever case it was first stored in; a value matches
//! exactly.
//!
//! Loaded when the first key is opened; written back, if anything changed,
//! when the last is closed (`reg_api.rs`). Every call opens and closes for
//! itself, so a change made with no key open reaches the disk at once.
//!
//! Not followed: `[embedding]` in `WIN.INI`, which SHELL copies in on the
//! first open and out on each write (seg2 `1730`, `18b4`); the order the
//! text area is compacted in, which is the entries' order here; the
//! temporary file SHELL writes and renames into place, where this writes
//! `REG.DAT` directly; and the discarding and re-reading of the database
//! under memory pressure.

use std::collections::BTreeMap;

use crate::user_misc::ansi_upper_byte;

pub const ERROR_SUCCESS: u32 = 0;
pub const ERROR_BADDB: u32 = 1;
pub const ERROR_BADKEY: u32 = 2;
pub const ERROR_CANTREAD: u32 = 4;
pub const ERROR_CANTWRITE: u32 = 5;
pub const ERROR_OUTOFMEMORY: u32 = 6;
pub const ERROR_INVALID_PARAMETER: u32 = 7;

pub const HKEY_CLASSES_ROOT: u32 = 1;

const MAGIC: &[u8; 8] = b"SHCC3.10";
const EMPTY_BUCKETS: usize = 37;

/// An entry's four words, kept as the TypeScript engine keeps them, as
/// numbers: a text's count of uses may pass nought going down.
pub type Entry = [i32; 4];

/// Text as JavaScript's `toUpperCase` makes it, each byte a character.
pub fn upper(text: &[u8]) -> String {
    text.iter()
        .map(|&byte| char::from(byte))
        .collect::<String>()
        .to_uppercase()
}

/// The database, as read from `REG.DAT` or made empty.
#[derive(Debug, Clone, Default)]
pub struct RegistryDatabase {
    pub entries: Vec<Entry>,
    pub buckets: usize,
    pub free_head: i32,
    /// The texts, by their entries.
    pub texts: BTreeMap<usize, Vec<u8>>,
    pub dirty: bool,
}

impl RegistryDatabase {
    /// An empty database: the root and its buckets, each chain empty
    /// (resource 100).
    pub fn empty() -> Self {
        let mut entries = vec![[0, 0, 0, 0]];

        for bucket in 1..=EMPTY_BUCKETS {
            entries.push([bucket as i32, 0, 0, 0]);
        }

        Self {
            entries,
            buckets: EMPTY_BUCKETS,
            ..Self::default()
        }
    }

    /// A file read, or the error SHELL gives for one it will not take.
    pub fn parse(bytes: &[u8]) -> Result<Self, u32> {
        if bytes.len() < 0x20 {
            return Err(ERROR_CANTREAD);
        }

        let word = |at: usize| usize::from(u16::from_le_bytes([bytes[at], bytes[at + 1]]));
        let dword = |at: usize| {
            u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize
        };

        if &bytes[..8] != MAGIC || dword(8) != 0x20 {
            return Err(ERROR_BADDB);
        }

        let node_offset = dword(12);
        let count = dword(16);
        let text_offset = dword(20);
        let text_size = dword(24);
        let mut db = Self {
            buckets: word(28),
            free_head: word(30) as i32,
            ..Self::default()
        };

        if count >= 0x1fff || count <= db.buckets || node_offset + count * 8 > bytes.len() {
            return Err(ERROR_BADDB);
        }

        for index in 0..count {
            let at = node_offset + index * 8;

            db.entries.push([
                word(at) as i32,
                word(at + 2) as i32,
                word(at + 4) as i32,
                word(at + 6) as i32,
            ]);
        }

        // The texts are what the bucket chains hold.
        for bucket in 1..=db.buckets {
            let mut id = db.entries[bucket][0] as usize;

            while id > db.buckets {
                // A chain that leads past the table: the TypeScript engine
                // throws reading it; here the file is refused.
                let Some(&[_, _, length, offset]) = db.entries.get(id) else {
                    return Err(ERROR_BADDB);
                };
                let (length, offset) = (length as usize, offset as usize);

                if offset + length > text_size || text_offset + offset + length > bytes.len() {
                    return Err(ERROR_BADDB);
                }

                let start = text_offset + offset;

                db.texts.insert(id, bytes[start..start + length].to_vec());
                id = db.entries.get(id).map_or(0, |entry| entry[0] as usize);
            }
        }

        Ok(db)
    }

    /// The file as SHELL writes it: the table at 20h, the texts packed
    /// after it.
    pub fn serialize(&self) -> Vec<u8> {
        let count = self.entries.len();
        let text_offset = 0x20 + count * 8;
        let mut pieces: Vec<u8> = Vec::new();
        let mut offsets = BTreeMap::new();

        for (&id, text) in &self.texts {
            pieces.extend_from_slice(&((id * 2 + 1) as u16).to_le_bytes());
            offsets.insert(id, pieces.len());
            pieces.extend_from_slice(text);
        }

        let mut bytes = vec![0u8; text_offset + pieces.len()];
        let mut put = |at: usize, value: &[u8]| bytes[at..at + value.len()].copy_from_slice(value);

        put(0, MAGIC);
        put(8, &0x20u32.to_le_bytes());
        put(12, &0x20u32.to_le_bytes());
        put(16, &(count as u32).to_le_bytes());
        put(20, &(text_offset as u32).to_le_bytes());
        put(24, &(pieces.len() as u32).to_le_bytes());
        put(28, &(self.buckets as u16).to_le_bytes());
        put(30, &(self.free_head as u16).to_le_bytes());

        for (index, entry) in self.entries.iter().enumerate() {
            let at = 0x20 + index * 8;
            let out = match self.texts.get(&index) {
                Some(text) => [
                    entry[0],
                    entry[1],
                    text.len() as i32,
                    offsets[&index] as i32,
                ],
                None => *entry,
            };

            for (k, word) in out.iter().enumerate() {
                put(at + k * 2, &(*word as u16).to_le_bytes());
            }
        }

        put(text_offset, &pieces);
        bytes
    }

    /// A text by its entry; none for nought or an entry that holds none.
    pub fn text_of(&self, id: i32) -> Option<&[u8]> {
        if id == 0 {
            return None;
        }

        self.texts.get(&(id as usize)).map(Vec::as_slice)
    }

    /// A text's bucket (seg2 `063e`): its first 39 characters upper-cased,
    /// summed as signed bytes.
    pub fn bucket_of(&self, text: &[u8]) -> usize {
        let mut sum: i32 = 0;

        for &byte in text.iter().take(39) {
            sum += i32::from(ansi_upper_byte(byte) as i8);
        }

        ((sum & 0xffff) as usize % self.buckets) + 1
    }

    /// An entry off the free list, or a new one, the table grown by 16 when
    /// it is empty.
    fn allocate(&mut self) -> usize {
        if self.free_head == 0 {
            let first = self.entries.len();

            for i in 0..16 {
                let next = if i < 15 { (first + i + 1) as i32 } else { 0 };

                self.entries.push([next, 0, 0, 0]);
            }

            self.free_head = first as i32;
        }

        let id = self.free_head as usize;

        self.free_head = self.entries[id][0];
        self.entries[id] = [0, 0, 0, 0];
        id
    }

    fn free(&mut self, id: usize) {
        self.entries[id] = [self.free_head, 0, 0, 0];
        self.free_head = id as i32;
    }

    /// A text to use, shared if there is one -- by case for a name, exactly
    /// for a value.
    pub fn use_text(&mut self, text: &[u8], any_case: bool) -> i32 {
        let bucket = self.bucket_of(text);
        let mut id = self.entries[bucket][0] as usize;

        while id > self.buckets {
            let have = &self.texts[&id];

            if have.len() == text.len()
                && (if any_case {
                    upper(have) == upper(text)
                } else {
                    have == text
                })
            {
                self.entries[id][1] += 1;
                return id as i32;
            }

            id = self.entries[id][0] as usize;
        }

        let id = self.allocate();

        self.entries[id] = [self.entries[bucket][0], 1, text.len() as i32, 0];
        self.entries[bucket][0] = id as i32;
        self.texts.insert(id, text.to_vec());
        id as i32
    }

    /// A text no longer used by one more thing: gone, out of its chain, at
    /// nought.
    pub fn release_text(&mut self, id: i32) {
        let id = id as usize;

        if id == 0 || !self.texts.contains_key(&id) {
            return;
        }

        self.entries[id][1] -= 1;

        if self.entries[id][1] > 0 {
            return;
        }

        let bucket = self.bucket_of(&self.texts[&id]);
        let mut at = bucket;

        while self.entries[at][0] as usize != id {
            at = self.entries[at][0] as usize;
        }

        self.entries[at][0] = self.entries[id][0];
        self.texts.remove(&id);
        self.free(id);
    }

    /// A key's child by its name, without regard to case; nought for none.
    pub fn child_named(&self, parent: usize, name: &[u8]) -> usize {
        let wanted = upper(name);
        let mut child = self.entries[parent][1] as usize;

        while child != 0 {
            if upper(self.text_of(self.entries[child][2]).unwrap_or_default()) == wanted {
                return child;
            }

            child = self.entries[child][0] as usize;
        }

        0
    }

    /// A child made first among its parent's (seg2 `08f4`).
    pub fn make_child(&mut self, parent: usize, name: &[u8]) -> usize {
        let id = self.allocate();
        let text = self.use_text(name, true);

        self.entries[id] = [self.entries[parent][1], 0, text, 0];
        self.entries[parent][1] = id as i32;
        self.dirty = true;
        id
    }

    /// A key and everything under it, gone.
    pub fn remove_tree(&mut self, id: usize) {
        let mut child = self.entries[id][1] as usize;

        while child != 0 {
            let next = self.entries[child][0] as usize;

            self.remove_tree(child);
            child = next;
        }

        self.release_text(self.entries[id][2]);
        self.release_text(self.entries[id][3]);
        self.free(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_database_round_trips() {
        let mut db = RegistryDatabase::empty();
        let classes = db.make_child(0, b".classes");
        let txt = db.make_child(classes, b".txt");

        db.entries[txt][3] = db.use_text(b"txtfile", false);

        let again = RegistryDatabase::parse(&db.serialize()).unwrap();

        // Read back, each text's entry says where it is in the file.
        assert_eq!(again.serialize(), db.serialize());
        assert_eq!(again.texts, db.texts);
        assert_eq!(again.child_named(0, b".CLASSES"), classes);
        assert_eq!(
            again.text_of(again.entries[txt][3]),
            Some(b"txtfile".as_slice())
        );
    }

    #[test]
    fn names_share_texts_without_regard_to_case_and_values_exactly() {
        let mut db = RegistryDatabase::empty();
        let name = db.use_text(b"txtfile", true);

        assert_eq!(db.use_text(b"TXTFILE", true), name);
        assert_ne!(db.use_text(b"TXTFILE", false), name);
        assert_eq!(db.entries[name as usize][1], 2);

        db.release_text(name);
        db.release_text(name);
        assert_eq!(db.text_of(name), None);
    }

    #[test]
    fn files_shell_will_not_take() {
        assert_eq!(
            RegistryDatabase::parse(&[0; 16]).unwrap_err(),
            ERROR_CANTREAD
        );
        assert_eq!(RegistryDatabase::parse(&[0; 32]).unwrap_err(), ERROR_BADDB);
    }
}
