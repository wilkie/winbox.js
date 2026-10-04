//! The modules winbox.js keeps itself -- KERNEL, USER, GDI and the rest --
//! as a program links to them: a segment of stubs, one for each ordinal,
//! each `INT 80h` and a `RETF` popping the call's arguments.

/// One export of a kept module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Export {
    pub name: &'static str,
    /// The bytes of arguments it pops.
    pub pops: u16,
}

/// A module winbox.js keeps.
#[derive(Debug)]
pub struct Kept {
    pub name: &'static str,
    /// Its file, where Windows keeps it.
    pub path: &'static str,
    /// Whether its data segment is fixed, its instance its selector; else
    /// moveable, its instance one below.
    pub fixed: bool,
    /// Its exports, by ordinal.
    pub exports: &'static [Option<Export>],
}

impl Kept {
    /// The kept module of a name, compared without regard to case.
    pub fn named(name: &str) -> Option<&'static Kept> {
        crate::kept::KEPT
            .iter()
            .find(|kept| kept.name.eq_ignore_ascii_case(name))
    }

    /// The export at an ordinal.
    pub fn export(&self, ordinal: u16) -> Option<Export> {
        self.exports.get(usize::from(ordinal)).copied().flatten()
    }

    /// The ordinal it exports a name at, without regard to case; 0 for none.
    pub fn ordinal_of(&self, name: &str) -> u16 {
        self.exports
            .iter()
            .position(|export| export.is_some_and(|export| export.name.eq_ignore_ascii_case(name)))
            .filter(|&ordinal| ordinal > 0)
            .map_or(0, |ordinal| ordinal as u16)
    }
}
