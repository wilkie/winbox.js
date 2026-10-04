//! Atoms: strings kept in a table and named by a number, so that two
//! programs -- or two parts of one -- can pass the number and mean the
//! string. USER keeps one table for the whole system, the global atoms;
//! KERNEL keeps one in any data segment that asks, the local atoms. Both
//! are the same code.
//!
//! **Read out of `KRNL386.EXE`** (seg1 `4944`, `4a80`, `4ab9`), and
//! **recorded** by the `atoms` probe:
//!
//! * **Integer atoms**: a pointer with nought for its segment names the
//!   atom its offset is, and a string `#` followed by digits the one its
//!   decimal value is, wrapping at 16 bits -- 1 to `BFFFh`, and anything else
//!   fails. A `#` followed by anything but digits is an ordinary string.
//! * **Strings** are 1 to 255 characters, compared without regard to case
//!   -- `a` to `z`, and `E0h` to `FEh` but `F7h`, are their capitals -- and kept
//!   as first added. Adding one again counts it, and each delete counts it
//!   down, answering nought; at nought it is gone.
//! * **A string atom** is C000h or more. Its number is where its entry lies
//!   in the table's heap, a quarter of the offset; here they are counted up
//!   from C000h across every table -- two heaps put two tables' entries
//!   apart -- and a number given back is used again in its table.
//! * **The name**: `GetAtomName` with no room answers nought and writes
//!   nothing; otherwise the buffer is emptied first, and as much of the
//!   string as fits copied, the answer its length. An integer atom's is `#`
//!   and its digits -- the lowest ones, if there is not room for all -- and
//!   the answer one more than the digits.
//! * Deleting an integer atom answers nought. Deleting a string atom that
//!   is not there answers something else nought: KERNEL does not check it,
//!   and answers what was left in AX. Here, the atom.
//!
//! USER's global table and the clipboard formats and window messages
//! registered by name are separate: `GlobalFindAtom` finds none of those.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::collections::HashMap;

use winbox_cpu::DS;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// The first string atom.
const FIRST: u32 = 0xc000;

#[derive(Debug, Clone)]
struct Entry {
    text: Vec<u8>,
    count: u32,
}

/// One table of atoms.
#[derive(Debug, Clone, Default)]
pub struct AtomTable {
    by_key: HashMap<Vec<u8>, u16>,
    by_atom: HashMap<u16, Entry>,
    /// The numbers given back, least first.
    free: Vec<u16>,
}

/// Every table: USER's global one, each data segment's local one by its
/// selector, and the next number for a string atom, which all share so
/// that no two tables' atoms are the same number.
#[derive(Debug, Clone)]
pub struct Atoms {
    pub global: AtomTable,
    pub local: HashMap<u16, AtomTable>,
    next: u32,
}

impl Default for Atoms {
    fn default() -> Self {
        Self {
            global: AtomTable::default(),
            local: HashMap::new(),
            next: FIRST,
        }
    }
}

/// A string at a far pointer, read through its selector -- at most 256
/// characters, enough to tell one too long.
fn string_from(system: &System, far: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut at = far & 0xffff;

    while out.len() < 256 {
        let byte = system.read_far((far & 0xffff_0000) | at, 1)[0];

        if byte == 0 {
            break;
        }

        out.push(byte);
        at = (at + 1) & 0xffff;
    }

    out
}

/// A string's capitals, as KERNEL compares atoms (seg1 `83e9`).
fn upper(text: &[u8]) -> Vec<u8> {
    text.iter()
        .map(|&byte| match byte {
            b'a'..=b'z' | 0xe0..=0xfe if byte != 0xf7 => byte - 0x20,
            _ => byte,
        })
        .collect()
}

/// Whether a lookup adds the string or only finds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Find,
    Add,
}

/// What a string names: an integer atom, or a string to look up.
enum Named {
    Integer(u16),
    Text(Vec<u8>),
}

fn named(system: &System, far: u32) -> Named {
    let integer = |value: u32| {
        Named::Integer(if value != 0 && value < FIRST {
            value as u16
        } else {
            0
        })
    };

    if far >> 16 == 0 {
        return integer(far & 0xffff);
    }

    let text = string_from(system, far);

    if text.first() == Some(&b'#') && text[1..].iter().all(u8::is_ascii_digit) {
        let value = text[1..].iter().fold(0u32, |value, &digit| {
            (value * 10 + u32::from(digit - b'0')) & 0xffff
        });

        return integer(value);
    }

    Named::Text(text)
}

impl AtomTable {
    /// Finds or adds a string's atom (seg1 `4944`).
    fn lookup(&mut self, text: Vec<u8>, mode: Mode, next: &mut u32) -> u16 {
        if text.is_empty() || text.len() > 255 {
            return 0;
        }

        let key = upper(&text);
        let atom = self.by_key.get(&key).copied();

        if mode == Mode::Find {
            return atom.unwrap_or(0);
        }

        if let Some(atom) = atom {
            if let Some(entry) = self.by_atom.get_mut(&atom) {
                entry.count += 1;
            }

            return atom;
        }

        let number = if self.free.is_empty() {
            let number = *next;

            *next += 1;
            number
        } else {
            u32::from(self.free.remove(0))
        };
        let Ok(fresh) = u16::try_from(number) else {
            return 0;
        };

        self.by_key.insert(key, fresh);
        self.by_atom.insert(fresh, Entry { text, count: 1 });
        fresh
    }

    /// Deletes an atom by number: nought, or the atom for one not there
    /// (seg1 `4a80`).
    pub fn delete(&mut self, atom: u16) -> u16 {
        if u32::from(atom) < FIRST {
            return 0;
        }

        let Some(entry) = self.by_atom.get_mut(&atom) else {
            return atom;
        };

        entry.count -= 1;

        if entry.count == 0 {
            let key = upper(&entry.text);

            self.by_key.remove(&key);
            self.by_atom.remove(&atom);
            self.free.push(atom);
            self.free.sort_unstable();
        }

        0
    }

    /// A string atom's string, if it is there.
    fn text(&self, atom: u16) -> Option<Vec<u8>> {
        self.by_atom.get(&atom).map(|entry| entry.text.clone())
    }
}

/// An atom's string into a buffer, the string as its table has it; its
/// length (seg1 `4ab9`).
fn write_name(system: &mut System, atom: u16, text: Option<&[u8]>, far: u32, size: i16) -> u16 {
    if far == 0 || size == 0 {
        return 0;
    }

    copy_text(system, b"", far, 1);

    if u32::from(atom) >= FIRST {
        return text.map_or(0, |text| copy_text(system, text, far, size));
    }

    if size < 2 || atom == 0 {
        return 0;
    }

    // The lowest digits, as many as there is room for: none where there is
    // room for the `#` alone.
    let digits = atom.to_string();
    let room = (size - 2) as usize;
    let shown = if room == 0 {
        &[][..]
    } else {
        &digits.as_bytes()[digits.len().saturating_sub(room)..]
    };
    let mut name = vec![b'#'];

    name.extend_from_slice(shown);
    copy_text(system, &name, far, (shown.len() + 2) as i16);
    shown.len() as u16 + 1
}

/// Text copied to a buffer of `size` bytes, as much as fits with its
/// nought: how many of its bytes; nothing where there is no room.
fn copy_text(system: &mut System, text: &[u8], far: u32, size: i16) -> u16 {
    if far == 0 || size <= 0 {
        return 0;
    }

    system.copy_text(text, far, size as usize) as u16
}

impl Atoms {
    /// The local table of the data segment a program is running with.
    fn local(&mut self, ds: u16) -> &mut AtomTable {
        self.local.entry(ds).or_default()
    }

    fn look_up(&mut self, table: Option<u16>, name: Named, mode: Mode) -> u16 {
        let text = match name {
            Named::Integer(atom) => return atom,
            Named::Text(text) => text,
        };
        let next = &mut self.next;
        let table = match table {
            None => &mut self.global,
            Some(ds) => self.local.entry(ds).or_default(),
        };

        table.lookup(text, mode, next)
    }
}

/// The table a call is to: USER's global one, or the caller's local one.
#[derive(Debug, Clone, Copy)]
enum Which {
    Global,
    Local,
}

impl Which {
    fn ds(self, system: &System) -> Option<u16> {
        match self {
            Self::Global => None,
            Self::Local => Some(system.cpu.segments[DS].selector),
        }
    }
}

fn add(system: &mut System, args: &mut Args, which: Which) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = named(system, far);
    let ds = which.ds(system);

    Ok(Answer::Word(system.atoms.look_up(ds, name, Mode::Add)))
}

fn find(system: &mut System, args: &mut Args, which: Which) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = named(system, far);
    let ds = which.ds(system);

    Ok(Answer::Word(system.atoms.look_up(ds, name, Mode::Find)))
}

fn get_name(system: &mut System, args: &mut Args, which: Which) -> Result<Answer, Stop> {
    let atom = args.word(system);
    let far = args.dword(system);
    let size = args.signed(system);
    let text = match which.ds(system) {
        None => system.atoms.global.text(atom),
        Some(ds) => system.atoms.local(ds).text(atom),
    };

    Ok(Answer::Word(write_name(
        system,
        atom,
        text.as_deref(),
        far,
        size,
    )))
}

pub fn global_add_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    add(system, args, Which::Global)
}

pub fn global_find_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    find(system, args, Which::Global)
}

/// Answers nought, deleted or not: USER's own, recorded by `atoms`.
pub fn global_delete_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let atom = args.word(system);

    system.atoms.global.delete(atom);
    Ok(Answer::Word(0))
}

pub fn global_get_atom_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    get_name(system, args, Which::Global)
}

fn add_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    add(system, args, Which::Local)
}

fn find_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    find(system, args, Which::Local)
}

fn delete_atom(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let atom = args.word(system);
    let ds = system.cpu.segments[DS].selector;

    Ok(Answer::Word(system.atoms.local(ds).delete(atom)))
}

fn get_atom_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    get_name(system, args, Which::Local)
}

/// A string atom's entry in its table, as an offset: four times it (seg1
/// `4aa3`).
fn get_atom_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let atom = args.word(system);

    Ok(Answer::Word(if u32::from(atom) >= FIRST {
        atom << 2
    } else {
        0
    }))
}

/// Makes a data segment's table: nothing to do here beyond having one
/// (seg3 `041a`).
fn init_atom_table(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let ds = system.cpu.segments[DS].selector;

    system.atoms.local(ds);
    Ok(Answer::Word(1))
}

/// KERNEL's functions of the local atoms.
pub fn kernel_implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "AddAtom" => add_atom,
        "FindAtom" => find_atom,
        "DeleteAtom" => delete_atom,
        "GetAtomName" => get_atom_name,
        "GetAtomHandle" => get_atom_handle,
        "InitAtomTable" => init_atom_table,
        _ => return None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    use winbox_machine::segment_selector;

    /// A block of memory to put strings in, and its far pointer.
    fn block(system: &mut System) -> u32 {
        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x1000, 0)
            .unwrap();

        u32::from(segment_selector(index)) << 16
    }

    fn add_text(system: &mut System, at: u32, text: &[u8], table: Option<u16>) -> u16 {
        let mut bytes = text.to_vec();

        bytes.push(0);
        system.write_far(at, &bytes);

        let name = named(system, at);

        system.atoms.look_up(table, name, Mode::Add)
    }

    fn find_text(system: &mut System, at: u32, text: &[u8], table: Option<u16>) -> u16 {
        let mut bytes = text.to_vec();

        bytes.push(0);
        system.write_far(at, &bytes);

        let name = named(system, at);

        system.atoms.look_up(table, name, Mode::Find)
    }

    fn name_of(system: &mut System, atom: u16, far: u32, size: i16) -> (u16, Vec<u8>) {
        system.write_far(far, b"xxxxxxxx\0");

        let text = system.atoms.global.text(atom);
        let answer = write_name(system, atom, text.as_deref(), far, size);

        (answer, system.read_string(far))
    }

    /// The global table as the `atoms` probe recorded it.
    #[test]
    fn global_atoms_as_recorded() {
        let mut system = System::new();
        let at = block(&mut system);
        let buffer = at + 0x800;
        let one = add_text(&mut system, at, b"WinboxAtomOne", None);

        assert!(one >= 0xc000);
        assert_eq!(add_text(&mut system, at, b"winboxatomone", None), one);

        let two = add_text(&mut system, at, b"WinboxAtomTwo", None);

        assert_eq!(two, one + 1);
        assert_eq!(find_text(&mut system, at, b"WINBOXATOMONE", None), one);
        assert_eq!(find_text(&mut system, at, b"WinboxMissing", None), 0);

        assert_eq!(
            name_of(&mut system, one, buffer, 64),
            (13, b"WinboxAtomOne".to_vec())
        );
        assert_eq!(name_of(&mut system, one, buffer, 4), (3, b"Win".to_vec()));
        assert_eq!(
            name_of(&mut system, one, buffer, 0),
            (0, b"xxxxxxxx".to_vec())
        );

        // Added twice, so deleted twice.
        assert_eq!(system.atoms.global.delete(one), 0);
        assert_eq!(find_text(&mut system, at, b"WinboxAtomOne", None), one);
        assert_eq!(system.atoms.global.delete(one), 0);
        assert_eq!(find_text(&mut system, at, b"WinboxAtomOne", None), 0);
        assert_eq!(name_of(&mut system, one, buffer, 64), (0, Vec::new()));

        // Integer atoms.
        assert_eq!(add_text(&mut system, at, b"#1234", None), 1234);
        assert_eq!(
            system.atoms.look_up(None, named(&system, 77), Mode::Add),
            77
        );
        assert_eq!(add_text(&mut system, at, b"#0", None), 0);
        assert_eq!(add_text(&mut system, at, b"#49152", None), 0);
        assert_eq!(add_text(&mut system, at, b"#49151", None), 49151);
        assert_eq!(add_text(&mut system, at, b"#012", None), 12);
        assert!(add_text(&mut system, at, b"#+12", None) >= 0xc000);
        assert!(add_text(&mut system, at, b"#12ab", None) >= 0xc000);
        assert_eq!(system.atoms.global.delete(1234), 0);
        assert_eq!(
            name_of(&mut system, 1234, buffer, 64),
            (5, b"#1234".to_vec())
        );
        assert_eq!(name_of(&mut system, 1234, buffer, 4), (3, b"#34".to_vec()));
        assert_eq!(name_of(&mut system, 77, buffer, 64), (3, b"#77".to_vec()));
        assert_eq!(add_text(&mut system, at, b"", None), 0);
        assert_eq!(add_text(&mut system, at, b"#", None), 0);

        let long: Vec<u8> = (0..255).map(|at| b'a' + (at % 26) as u8).collect();

        assert!(add_text(&mut system, at, &long, None) >= 0xc000);

        let mut longer = long.clone();

        longer.push(b'x');
        assert_eq!(add_text(&mut system, at, &longer, None), 0);
    }

    /// A data segment's own table, apart from the global one, its numbers
    /// shared with it.
    #[test]
    fn local_atoms_are_apart() {
        let mut system = System::new();
        let at = block(&mut system);
        let global = add_text(&mut system, at, b"Global", None);
        let local = add_text(&mut system, at, b"WinboxLocalOne", Some(0x1f));

        assert_eq!(local, global + 1);
        assert_eq!(
            add_text(&mut system, at, b"WINBOXLOCALONE", Some(0x1f)),
            local
        );
        assert_eq!(find_text(&mut system, at, b"WinboxLocalOne", None), 0);

        let table = system.atoms.local.get_mut(&0x1f).unwrap();

        assert_eq!(table.delete(local), 0);
        assert_eq!(table.delete(local), 0);
        // Not there: the atom, not nought.
        assert_eq!(table.delete(local), local);
        // Given back, and used again in its table.
        assert_eq!(add_text(&mut system, at, b"Again", Some(0x1f)), local);
    }
}
