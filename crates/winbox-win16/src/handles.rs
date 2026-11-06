//! The handles of the system's objects, as winbox.js's `HandleManager`
//! gives them: each kind from its own range, so a handle's low two bits
//! are what Windows' are (`handbits`) -- 2 for GDI's objects and an
//! instance, 0 for a window and a menu -- and GDI's from one set they
//! share, the last given back given first (`gdinum`).

use std::collections::HashMap;

/// What a handle stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Object {
    /// A task, by its program's module's index.
    Task(usize),
    /// A module winbox.js keeps, by its index.
    Kept(usize),
    /// A module loaded from its file, by its index.
    Library(usize),
    /// A resource: its module, its type's index and its own in the
    /// resource table.
    Resource(Owner, usize, usize),
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
    /// One of GDI's objects -- a pen, a brush, a font, a palette -- by its
    /// index among those made.
    Gdi(usize),
    /// A device context, by its index among those made.
    Dc(usize),
    /// An accelerator table, by its index among those loaded.
    Accelerators(usize),
    /// A set of moves `BeginDeferWindowPos` began, by its index.
    Deferred(usize),
    /// A metafile's device context, being recorded, by its index.
    Metafile(usize),
}

/// Whose resource table a resource is in: a module loaded from its file,
/// by its index; or one winbox.js keeps, by its index, whose table is its
/// file's on the installation -- the display driver's `OEMBIN`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Owner {
    Module(usize),
    Kept(usize),
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
    /// An instance's or a module's handle, made from a selector
    /// (`alias_at`), which one of GDI's may share.
    alias: bool,
}

/// The handles given out.
#[derive(Debug, Clone)]
pub struct Handles {
    given: HashMap<u16, Entry>,
    /// GDI's handles: its objects' and its device contexts', each a
    /// moveable local handle in GDI's own heap (**read out**: `GDI.EXE`
    /// seg1 `0b7c`-`0b9f` makes a pen by `0eef`-`0f31`, which asks
    /// `LocalAlloc(LMEM_MOVEABLE, ...)` of GDI's data segment,
    /// `1f43`-`1f4e`, and answers the local handle). Numbers within GDI's
    /// data segment, apart from KERNEL's selectors and the instances and
    /// modules' handles made from them, kept in `given` with USER's and
    /// WinBox's others. A number may be both an instance and one of GDI's
    /// objects: KERNEL's functions take it for the instance
    /// (`resolve_module`), the others for the object (`resolve`). As
    /// `HandleManager._gdi`.
    gdi: HashMap<u16, Entry>,
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
            gdi: HashMap::new(),
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

    /// Whether an object's handle is GDI's: an object or a device context.
    fn in_gdi(object: Object) -> bool {
        matches!(object, Object::Gdi(_) | Object::Dc(_))
    }

    /// The table an object's handle is in.
    fn table_for(&mut self, object: Object) -> &mut HashMap<u16, Entry> {
        if Self::in_gdi(object) {
            &mut self.gdi
        } else {
            &mut self.given
        }
    }

    /// Whether a number is taken, for a handle given in GDI's set (`gdi`)
    /// or in the rest: GDI's own, or any of the rest's but an instance's or
    /// a module's, made from a selector (`alias_at`); the rest's own, or
    /// any of GDI's. So the two sets share no number but where an instance
    /// or a module's handle is one of GDI's, as Windows' can be. As
    /// `HandleManager.taken`.
    fn taken(&self, handle: u16, gdi: bool) -> bool {
        let other = self.given.get(&handle);

        if gdi {
            self.gdi.contains_key(&handle) || other.is_some_and(|entry| !entry.alias)
        } else {
            other.is_some() || self.gdi.contains_key(&handle)
        }
    }

    /// A new handle for an object, from its kind's range.
    pub fn allocate(&mut self, kind: Kind, object: Object) -> Option<u16> {
        let handle = match kind {
            Kind::Gdi => self.gdi_handle(),
            Kind::Dc => self.find(HDC + 1, 0xffe, Some(2), true),
            Kind::Window => self.find(ATOM + 1, 0xffe, Some(0), false),
            Kind::File => self.find(HFILE + 1, 0xffe, None, false),
            Kind::Instance => self.find(HINSTANCE + 1, 0xffe, Some(2), false),
            Kind::Module => self.find(HMODULE + 1, 0xffe, None, false),
            Kind::Atom => self.find(ATOM + 1, 0xffe, None, false),
        }?;
        let entry = Entry {
            object,
            alias: false,
        };

        if matches!(kind, Kind::Gdi | Kind::Dc) {
            self.gdi.insert(handle, entry);
        } else {
            self.given.insert(handle, entry);
        }

        self.lookup.insert(object, handle);
        Some(handle)
    }

    /// A handle at a number of the caller's choosing, given whether or not
    /// it was, and what `lookup` answers for its object: a stock object's.
    pub fn assign(&mut self, handle: u16, object: Object) {
        self.table_for(object).insert(
            handle,
            Entry {
                object,
                alias: false,
            },
        );
        self.lookup.insert(object, handle);
    }

    /// A second handle for an object, among the modules': a library's
    /// module, beside its instance.
    pub fn alias(&mut self, object: Object) -> Option<u16> {
        let handle = self.find(HMODULE + 1, 0xffe, None, false)?;

        self.given.insert(
            handle,
            Entry {
                object,
                alias: false,
            },
        );
        Some(handle)
    }

    /// A handle at a number of the caller's choosing, if it is free: a
    /// program's instance, its data segment's handle, beside its task; a
    /// module's handle; a resource's.
    pub fn alias_at(&mut self, handle: u16, object: Object) -> u16 {
        let alias = matches!(
            object,
            Object::Task(_) | Object::Library(_) | Object::Kept(_)
        );

        self.table_for(object)
            .entry(handle)
            .or_insert(Entry { object, alias });
        handle
    }

    /// The table a handle is found in: the rest's, where it is one of
    /// theirs that is not an instance's or a module's; else GDI's; else
    /// the rest's. Asked for an instance or a module (`module`), the
    /// rest's first. As `HandleManager.tableOf`.
    fn table_of(&self, handle: u16, module: bool) -> Option<&HashMap<u16, Entry>> {
        let other = self.given.get(&handle);

        if other.is_some_and(|entry| module || !entry.alias) {
            return Some(&self.given);
        }

        if self.gdi.contains_key(&handle) {
            Some(&self.gdi)
        } else {
            other.map(|_| &self.given)
        }
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

    /// The object a handle stands for: one of the rest's, else one of
    /// GDI's -- a number both an instance's and one of GDI's objects' is
    /// the object's, as GDI and USER take it (`table_of`).
    pub fn resolve(&self, handle: u16) -> Option<Object> {
        self.table_of(handle, false)?
            .get(&handle)
            .map(|entry| entry.object)
    }

    /// The object a handle given as an instance or a module stands for, as
    /// KERNEL takes it: the instance's or the module's where the number is
    /// both one of theirs and one of GDI's objects'.
    pub fn resolve_module(&self, handle: u16) -> Option<Object> {
        self.table_of(handle, true)?
            .get(&handle)
            .map(|entry| entry.object)
    }

    /// Every handle given out and what it stands for, in no order.
    pub fn objects(&self) -> impl Iterator<Item = (u16, Object)> + '_ {
        self.given
            .iter()
            .chain(&self.gdi)
            .map(|(&handle, entry)| (handle, entry.object))
    }

    /// An object's own handle.
    pub fn lookup(&self, object: Object) -> Option<u16> {
        self.lookup.get(&object).copied()
    }

    /// A handle let go, found as `resolve` finds it: GDI's given out again
    /// first, but a stock object's.
    pub fn free(&mut self, handle: u16) -> Option<Object> {
        self.release(handle, false)
    }

    /// An instance's or a module's handle let go, found as
    /// `resolve_module` finds it.
    pub fn free_module(&mut self, handle: u16) -> Option<Object> {
        self.release(handle, true)
    }

    fn release(&mut self, handle: u16, module: bool) -> Option<Object> {
        let gdi = std::ptr::eq(self.table_of(handle, module)?, &raw const self.gdi);
        let entry = if gdi {
            self.gdi.remove(&handle)
        } else {
            self.given.remove(&handle)
        }?;

        if gdi
            && handle & 3 == 2
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
    /// two bits where given; in GDI's set where `gdi` (`taken`).
    fn find(&self, start: u16, length: u16, residue: Option<u16>, gdi: bool) -> Option<u16> {
        let (mut at, step) = (u32::from(start), if residue.is_some() { 4 } else { 1 });
        let end = u32::from(start) + u32::from(length);

        if let Some(residue) = residue {
            at = (at & !3) + u32::from(residue);

            if at < end - u32::from(length) {
                at += 4;
            }
        }

        while at <= end && self.taken(at as u16, gdi) {
            at += step;
        }

        (at <= end).then_some(at as u16)
    }

    /// One of GDI's handles: the last given back, else down four at a time
    /// from `C6Ah` past the stock objects', then above where it started.
    fn gdi_handle(&mut self) -> Option<u16> {
        while let Some(handle) = self.gdi_free.pop() {
            if !self.taken(handle, true) {
                return Some(handle);
            }
        }

        let mut handle = self.gdi_next;

        while handle >= GDI_LOWEST {
            if !(STOCK_FIRST..=STOCK_LAST).contains(&handle) && !self.taken(handle, true) {
                self.gdi_next = handle - 4;
                return Some(handle);
            }

            handle -= 4;
        }

        (GDI_START + 4..=GDI_HIGHEST)
            .step_by(4)
            .find(|&handle| !self.taken(handle, true))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_each_kind_its_range() {
        let mut handles = Handles::new();

        assert_eq!(
            handles.allocate(Kind::Instance, Object::Task(0)),
            Some(0x8002)
        );
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

    /// An instance's handle, made from a selector, and one of GDI's objects
    /// may have one number: GDI's numbers pass over WinBox's own numbers,
    /// not an instance's, and each is found by those that take it so.
    #[test]
    fn keeps_gdi_apart_from_instances() {
        let mut handles = Handles::new();

        handles.alias_at(0xc6a, Object::Task(0));
        handles.alias_at(0xc66, Object::Cursor(0));
        assert_eq!(handles.allocate(Kind::Gdi, Object::Gdi(0)), Some(0xc6a));
        assert_eq!(handles.allocate(Kind::Gdi, Object::Gdi(1)), Some(0xc62));
        assert_eq!(handles.resolve(0xc6a), Some(Object::Gdi(0)));
        assert_eq!(handles.resolve_module(0xc6a), Some(Object::Task(0)));
        assert_eq!(handles.free_module(0xc6a), Some(Object::Task(0)));
        assert_eq!(handles.resolve_module(0xc6a), Some(Object::Gdi(0)));
    }
}
