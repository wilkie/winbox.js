//! The handles of the system's objects, as winbox.js's `HandleManager`
//! gives them: each kind from its own range, so a handle's low two bits
//! are what Windows' are (`handbits`) -- 2 for GDI's objects and an
//! instance, 0 for a window and a menu -- and GDI's from one set they
//! share, the last given back given first (`gdinum`).

use std::collections::HashMap;

/// What a handle stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Object {
    /// The task.
    Task,
    /// A module winbox.js keeps, by its index.
    Kept(usize),
    /// A module loaded from its file, by its index.
    Library(usize),
    /// A resource: its module's index, its type's and its own in the
    /// resource table.
    Resource(usize, usize, usize),
    /// A cursor, by its index among those handed out.
    Cursor(usize),
    /// A window class, by its index among those registered.
    Class(usize),
    /// A menu, by its index among those made.
    Menu(usize),
    /// The desktop window.
    Desktop,
    /// A window, by its index among those made.
    Window(usize),
}

/// The kinds of handle, by the range each is given from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A pen, a brush, a font, a bitmap, a region, a palette: GDI's.
    Gdi,
    /// A device context.
    Dc,
    /// A window or a menu: USER's, a multiple of four.
    Window,
    File,
    /// An instance: a global handle, as Windows' is, low bits 2.
    Instance,
    Module,
    /// Anything else, from the atoms' range.
    Atom,
}

const HDC: u16 = 0x9000;
const HINSTANCE: u16 = 0x8000;
const HMODULE: u16 = 0x7000;
const ATOM: u16 = 0x2000;
const HFILE: u16 = 0x1000;

/// The stock objects' handles, the same on every display (`gdinum`).
pub const STOCK_FIRST: u16 = 0xac6;
pub const STOCK_LAST: u16 = 0xb06;

/// Where GDI's handles are given from, and between what.
const GDI_START: u16 = 0xc6a;
const GDI_LOWEST: u16 = 0x0e;
const GDI_HIGHEST: u16 = 0x3ffe;

#[derive(Debug, Clone, Copy)]
struct Entry {
    object: Object,
}

/// The handles given out.
#[derive(Debug, Clone)]
pub struct Handles {
    given: HashMap<u16, Entry>,
    /// Each object's own handle, not an alias's.
    lookup: HashMap<Object, u16>,
    gdi_free: Vec<u16>,
    gdi_next: u16,
    /// Handles registered by name, upper case: a window class's.
    names: HashMap<String, u16>,
}

impl Default for Handles {
    fn default() -> Self {
        Self {
            given: HashMap::new(),
            lookup: HashMap::new(),
            gdi_free: Vec::new(),
            gdi_next: GDI_START,
            names: HashMap::new(),
        }
    }
}

impl Handles {
    pub fn new() -> Self {
        Self::default()
    }

    /// A new handle for an object, from its kind's range.
    pub fn allocate(&mut self, kind: Kind, object: Object) -> Option<u16> {
        let handle = match kind {
            Kind::Gdi => self.gdi_handle(),
            Kind::Dc => self.find(HDC + 1, 0xffe, Some(2)),
            Kind::Window => self.find(ATOM + 1, 0xffe, Some(0)),
            Kind::File => self.find(HFILE + 1, 0xffe, None),
            Kind::Instance => self.find(HINSTANCE + 1, 0xffe, Some(2)),
            Kind::Module => self.find(HMODULE + 1, 0xffe, None),
            Kind::Atom => self.find(ATOM + 1, 0xffe, None),
        }?;

        self.given.insert(handle, Entry { object });
        self.lookup.insert(object, handle);
        Some(handle)
    }

    /// A second handle for an object, among the modules': a library's
    /// module, beside its instance.
    pub fn alias(&mut self, object: Object) -> Option<u16> {
        let handle = self.find(HMODULE + 1, 0xffe, None)?;

        self.given.insert(handle, Entry { object });
        Some(handle)
    }

    /// A handle at a number of the caller's choosing, if it is free: a
    /// program's instance, its data segment's handle, beside its task.
    pub fn alias_at(&mut self, handle: u16, object: Object) -> u16 {
        self.given.entry(handle).or_insert(Entry { object });
        handle
    }

    /// A handle registered under a name, without regard to case.
    pub fn register(&mut self, handle: u16, name: &str) {
        if self.given.contains_key(&handle) {
            self.names.insert(name.to_ascii_uppercase(), handle);
        }
    }

    /// The handle registered under a name, without regard to case.
    pub fn retrieve(&self, name: &str) -> Option<u16> {
        self.names.get(&name.to_ascii_uppercase()).copied()
    }

    /// The object a handle stands for.
    pub fn resolve(&self, handle: u16) -> Option<Object> {
        self.given.get(&handle).map(|entry| entry.object)
    }

    /// An object's own handle.
    pub fn lookup(&self, object: Object) -> Option<u16> {
        self.lookup.get(&object).copied()
    }

    /// A handle let go: GDI's given out again first, but a stock object's.
    pub fn free(&mut self, handle: u16) -> Option<Object> {
        let entry = self.given.remove(&handle)?;

        if handle & 3 == 2
            && (GDI_LOWEST..=GDI_HIGHEST).contains(&handle)
            && !(STOCK_FIRST..=STOCK_LAST).contains(&handle)
        {
            self.gdi_free.push(handle);
        }

        if self.lookup.get(&entry.object) == Some(&handle) {
            self.lookup.remove(&entry.object);
        }

        self.names.retain(|_, named| *named != handle);

        Some(entry.object)
    }

    /// A free handle from `start`, within `length`, with `residue` its low
    /// two bits where given.
    fn find(&self, start: u16, length: u16, residue: Option<u16>) -> Option<u16> {
        let (mut at, step) = (u32::from(start), if residue.is_some() { 4 } else { 1 });
        let end = u32::from(start) + u32::from(length);

        if let Some(residue) = residue {
            at = (at & !3) + u32::from(residue);

            if at < end - u32::from(length) {
                at += 4;
            }
        }

        while at <= end && self.given.contains_key(&(at as u16)) {
            at += step;
        }

        (at <= end).then_some(at as u16)
    }

    /// One of GDI's handles: the last given back, else down four at a time
    /// from `C6Ah` past the stock objects', then above where it started.
    fn gdi_handle(&mut self) -> Option<u16> {
        while let Some(handle) = self.gdi_free.pop() {
            if !self.given.contains_key(&handle) {
                return Some(handle);
            }
        }

        let mut handle = self.gdi_next;

        while handle >= GDI_LOWEST {
            if !(STOCK_FIRST..=STOCK_LAST).contains(&handle) && !self.given.contains_key(&handle) {
                self.gdi_next = handle - 4;
                return Some(handle);
            }

            handle -= 4;
        }

        (GDI_START + 4..=GDI_HIGHEST)
            .step_by(4)
            .find(|handle| !self.given.contains_key(handle))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_each_kind_its_range() {
        let mut handles = Handles::new();

        assert_eq!(handles.allocate(Kind::Instance, Object::Task), Some(0x8002));
        assert_eq!(
            handles.allocate(Kind::Atom, Object::Library(0)),
            Some(0x2001)
        );
        assert_eq!(
            handles.allocate(Kind::Window, Object::Library(1)),
            Some(0x2004)
        );
        assert_eq!(handles.alias(Object::Library(0)), Some(0x7001));
        assert_eq!(handles.lookup(Object::Library(0)), Some(0x2001));
        assert_eq!(handles.resolve(0x7001), Some(Object::Library(0)));
        assert_eq!(handles.allocate(Kind::Gdi, Object::Kept(0)), Some(0xc6a));
        assert_eq!(handles.allocate(Kind::Gdi, Object::Kept(1)), Some(0xc66));
        handles.free(0xc6a);
        assert_eq!(handles.allocate(Kind::Gdi, Object::Kept(2)), Some(0xc6a));
    }
}
