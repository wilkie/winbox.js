//! A program or library placed in memory, as winbox.js's `Loader` places
//! one and KERNEL would: each segment given a descriptor, its image written
//! there, its block sized, its entry points' prologues patched, and its data
//! segment given its local heap.

use winbox_machine::segment_selector;
use winbox_ne::{EntryPoint, Executable, Target};

use crate::handles::{Kind, Object};
use crate::system::System;

/// The block of global memory KERNEL loads a segment into: its minimum
/// allocation, 64K for none, and two bytes, and for the data segment the
/// stack and the heap more (`KRNL386.EXE` seg1 `7678`-`76a7`), which the
/// global heap rounds up to 32 bytes as it rounds any block's (**recorded**
/// by `grround`), no more than a selector's 64K here. `number` counts from
/// 1. As `loader.ts`'s `segmentBlockSize`.
pub fn segment_block_size(executable: &Executable, number: usize) -> u32 {
    let header = &executable.header;
    let segment = &executable.segments[number - 1];
    let extra = if number == usize::from(header.auto_data_segment) {
        u32::from(header.initial_stack_size) + u32::from(header.initial_heap_size)
    } else {
        0
    };
    let minimum = match segment.min_allocation {
        0 => 0x10000,
        size => u32::from(size),
    };

    ((minimum + 2 + extra).min(0x10000) + 31) & !31
}

/// A segment's bytes as KERNEL leaves them in its block: the file's, and
/// nought for the rest of the block. KERNEL reads the file's bytes into the
/// block's start and fills from their end to the block's (`KRNL286.EXE`
/// seg1 `71e1`-`720f` sizes the block, `72a6`-`7314` reads, `732d`-`7348`
/// fills to `GlobalSize`; `KRNL386.EXE` seg1 `7968`-`7981`, `7a43`-`7aa5`,
/// and `7ab6`-`7ae2` to the segment's limit). **Recorded** by `segtail`:
/// past a library's segments' lengths, to their minimum allocation and two
/// bytes, every byte is nought. Microsoft's setup toolkit relies on it:
/// `MSCOMSTF.DLL`'s segment 32 ends in a `retf 8` whose last byte, past the
/// file's `FD0h` bytes, is the nought of its minimum allocation of `FD1h`. As
/// `loader.ts`'s `loadedSegment`.
pub fn loaded_segment(mut bytes: Vec<u8>, size: u32) -> Vec<u8> {
    if bytes.len() < size as usize {
        bytes.resize(size as usize, 0);
    }

    bytes
}

/// A module loaded from its file: a program, or a library it needs.
#[derive(Debug)]
pub struct Module {
    pub executable: std::rc::Rc<Executable>,
    /// Each segment's descriptor index, by its number less one.
    pub segments: Vec<usize>,
    /// The name it is registered and found by.
    pub name: String,
    /// Its file, as DOS names it.
    pub path: String,
    /// Whether its entry point has run, for a library.
    pub started: bool,
    /// Its count, as `GetModuleUsage` answers it: a load or an import each.
    pub usage: u32,
    /// The libraries it counted when it was loaded, to be let go with it.
    pub brought: Vec<Held>,
    /// A library's instance, as `LoadLibrary` answers it and its entry
    /// point is given it, and its module's handle: another number, for the
    /// same library. Nought for a program.
    pub instance: u16,
    pub handle: u16,
    /// A program's task's own selectors, given back as it ends
    /// (`exit_slot`).
    pub own: Option<Own>,
}

/// The selectors KERNEL gives a program's task besides its segments, in the
/// order it gives them (`load_program`): its module's database where the
/// module is new, the task's database, its program segment prefix, a
/// second selector and USER's message queue; and its environment, as it
/// starts. As `win16.ts`'s `own`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Own {
    pub database: usize,
    pub prefix: usize,
    pub second: usize,
    pub queue: usize,
    pub environment: Option<usize>,
    /// Whether the task called `LoadLibrary` (`exit_slot`).
    pub loaded: bool,
}

impl Module {
    /// Where a segment of its numbering was put: its descriptor index.
    pub fn translate(&self, segment: u16) -> Option<usize> {
        self.segments
            .get(usize::from(segment).checked_sub(1)?)
            .copied()
    }

    /// Where an entry point is: its segment's descriptor index and offset.
    pub fn lookup(&self, ordinal: u16) -> Option<(usize, u16)> {
        let (segment, offset) = self
            .executable
            .entry_points
            .get(usize::from(ordinal))?
            .place()?;

        Some((self.translate(u16::from(segment))?, offset))
    }

    /// Whether it is a library: bit 15 of its header's flags. Any other
    /// module is a program, and KERNEL counts a program as having multiple
    /// data whatever its header says (`patch_prologues`).
    pub fn is_library(&self) -> bool {
        self.executable.header.flags & 0x8000 != 0
    }

    /// The data segment's descriptor index, if it has one.
    pub fn data(&self) -> Option<usize> {
        self.translate(self.executable.header.auto_data_segment)
    }

    /// Where its data ends and its stack begins: after all the data the
    /// segment asks for, the uninitialised past what the file holds too, on
    /// a word boundary (`stackpos`).
    pub fn data_top(&self) -> u32 {
        let header = &self.executable.header;
        let segment = &self.executable.segments[usize::from(header.auto_data_segment) - 1];

        (segment.length.max(u32::from(segment.min_allocation)) + 1) & !1
    }
}

/// What a program or a library holds of the modules it imported, to let
/// go with it: a library loaded from its file, by its index among the
/// modules; or one of WinBox's own whose file is not there, by its index
/// among the kept modules (`own_modules::use_own`). As `library.ts`'s
/// `Held`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Held {
    Library(usize),
    Own(usize),
}

/// Modules winbox.js keeps whose file on the disk is loaded beside them
/// when there is one: the file's exports WinBox does not answer yet are
/// the file's code (`commdlg/`, `own_modules.rs`).
const STUBS_ONLY: [&str; 6] = crate::own_modules::OWN_WITH_FILE;

impl System {
    /// The module loaded from its file under a name, without regard to case.
    pub fn module_named(&self, name: &str) -> Option<usize> {
        self.modules
            .iter()
            .position(|module| module.name.eq_ignore_ascii_case(name))
    }

    /// Whether a module is to be loaded from its file rather than taken
    /// from winbox.js: none of that name is loaded, and winbox.js keeps none
    /// or only its stubs.
    pub(crate) fn wants_file(&self, name: &str) -> bool {
        self.module_named(name).is_none()
            && (self.kept_named(name).is_none()
                || STUBS_ONLY
                    .iter()
                    .any(|stub| stub.eq_ignore_ascii_case(name)))
    }

    /// A program loaded: placed, its local heap made, and the libraries it
    /// needs from the disk placed and linked, `find` reading each library's
    /// file by its name, and naming its path. `path` is the program's, as DOS
    /// names it. Its index among the modules, and the libraries in
    /// the order their entry points are to run.
    pub fn load(&mut self, executable: Executable, path: &str) -> (usize, Vec<usize>) {
        // USER's start-up read of the display driver's metrics and colours.
        self.take_display_oembin();

        let (program, order, handle) = self.load_program(executable, path);

        self.task_handle = handle;
        (program, order)
    }

    /// A program loaded, as `load` loads one, for a task of its own: its
    /// module, its libraries in order, and the task's handle.
    pub fn load_program(&mut self, executable: Executable, path: &str) -> (usize, Vec<usize>, u16) {
        let file = path.rsplit('\\').next().unwrap_or(path);
        let name = file.split('.').next().unwrap_or(file).to_ascii_uppercase();
        let shared = self
            .modules
            .iter()
            .find(|module| !module.is_library() && module.handle != 0 && module.path == path)
            .map(|module| module.handle);

        // Its module's database first, where the module is new; then the
        // task's own: its database, its program segment prefix, a second
        // selector and USER's message queue; then its segments -- the order
        // Windows gives them selectors in (**recorded** by `segfree`). WinBox
        // keeps nothing in the task's database, the second selector or the
        // queue (`Descriptors::reserve`). As `Win16.load`.
        let database = match shared {
            Some(_) => None,
            None => self.module_database(&executable),
        };
        let own = self.own_selectors();
        let program = self.place(executable, &name, path);
        let mut order = Vec::new();
        let beside = path.rsplit_once('\\').map(|(folder, _)| folder.to_string());

        self.modules[program].own = own;
        self.load_libraries_for(program, beside.as_deref(), &mut order);

        // Its module's handle, as `GetModuleHandle` finds it by its name and
        // TOOLHELP's walks find it: the selector of its database, which
        // every instance of the program shares (**recorded** by `thtask`),
        // its low two bits 3 as Windows' are (`modhand`). The block holds
        // the file's header from its `NE` to the end of its entry table,
        // which a program reads through it (`solodata`). From descriptors of
        // their own, where no block reaches; let go with its last instance
        // (`exit_task`). As `Win16.load`. Made first, above.
        self.modules[program].handle = shared.unwrap_or_else(|| {
            database.map_or(0, |index| {
                self.handles
                    .alias_at(segment_selector(index), Object::Task(program))
            })
        });

        // Its local heap is made as it calls `InitTask`, at the end of its
        // data segment (`kernel::task_heap`).
        let handle = self
            .handles
            .allocate(Kind::Instance, Object::Task(program))
            .unwrap_or(0);

        (program, order, handle)
    }

    /// A module's database: a descriptor as KERNEL gives one, the one freed
    /// last first, from those above any block where none was freed,
    /// holding the file's header from its `NE` to the end of its entry
    /// table. A program's and a library's alike. As `moduleDatabase`.
    pub(crate) fn module_database(&mut self, executable: &Executable) -> Option<usize> {
        let start = executable.header_offset as usize;
        let end = start
            + usize::from(executable.header.entry_table_offset)
            + usize::from(executable.header.entry_table_length);
        let bytes = executable.bytes()[start..end.min(executable.bytes().len())].to_vec();
        let handles = &self.handles;
        let index = self
            .descriptors
            .take_avoiding(1, |index| numbered(handles, index))?;

        self.descriptors
            .map(&mut self.cpu.bus, index, &bytes, false);
        self.descriptors.set_limit(
            &mut self.cpu.bus,
            index,
            (bytes.len() as u32).saturating_sub(1),
        );
        Some(index)
    }

    /// A task's own selectors but its environment's, as `load_program`
    /// gives them: its database, its prefix -- 256 bytes of nought -- a
    /// second selector and its queue.
    fn own_selectors(&mut self) -> Option<Own> {
        let database = self.descriptors.reserve(&mut self.cpu.bus, 1)?;
        let prefix = self.descriptors.take(1)?;

        self.descriptors
            .map(&mut self.cpu.bus, prefix, &[0; 256], false);

        let second = self.descriptors.reserve(&mut self.cpu.bus, 1)?;
        let queue = self.descriptors.reserve(&mut self.cpu.bus, 1)?;

        Some(Own {
            database,
            prefix,
            second,
            queue,
            environment: None,
            loaded: false,
        })
    }

    /// A module's segments given back as KERNEL deletes it (**read out**,
    /// `KRNL386.EXE` seg2 `0c30`): its data segment first (`0c88`-`0c98`,
    /// seg1 `4fa2`), then every block it owns by `GlobalFreeAll` (`0ce0`,
    /// seg1 `0e39`), in the heap's order -- its database, below its
    /// segments, then its other segments, here in their order. Each on top
    /// of the free list (**recorded** by `segfree`). Only the data segment
    /// where `whole` is false: another instance runs on, and the code is
    /// the module's (`0d12`). As `freeModuleSegments`.
    pub(crate) fn free_module_segments(
        &mut self,
        module: usize,
        database: Option<usize>,
        whole: bool,
    ) {
        let data = self.modules[module].data();

        if let Some(data) = data {
            self.free_segment(data);
        }

        if let Some(database) = database {
            self.descriptors.give(&mut self.cpu.bus, database);
        }

        if !whole {
            return;
        }

        for index in self.modules[module].segments.clone() {
            if Some(index) != data {
                self.free_segment(index);
            }
        }
    }

    /// A module's segment freed: its size and heap forgotten, its selector
    /// given back (`Allocator.freeSegment`).
    fn free_segment(&mut self, index: usize) {
        self.global.forget_segment(index);
        self.forget_heaps(index, 1);
        self.descriptors.give(&mut self.cpu.bus, index);
    }

    /// The libraries a module imports that are to come from their files,
    /// and theirs, each once: placed, registered under its name, and
    /// linked, in the order their entry points are to run -- a library
    /// before the ones that need it.
    pub(crate) fn load_libraries_for(
        &mut self,
        module: usize,
        beside: Option<&str>,
        order: &mut Vec<usize>,
    ) {
        for name in Self::import_names(&self.modules[module].executable) {
            if let Some(held) = self.import_one(&name, Some(module), beside, order) {
                self.modules[module].brought.push(held);
            }
        }
    }

    /// A module imported by its name, loaded or counted as KERNEL loads an
    /// import: what the importer then holds of it. As `importOne`.
    pub(crate) fn import_one(
        &mut self,
        name: &str,
        importer: Option<usize>,
        beside: Option<&str>,
        order: &mut Vec<usize>,
    ) -> Option<Held> {
        // One of WinBox's own kept only once loaded, kept now.
        crate::own_modules::keep_on_load(self, name);

        if let Some(already) = self.module_named(name)
            && Some(already) != importer
            && self.modules[already].executable.header.library()
        {
            self.modules[already].usage += 1;
            return Some(Held::Library(already));
        }

        if !self.wants_file(name) {
            return None;
        }

        let Some((path, bytes)) = self.find_library(name, beside) else {
            // One of WinBox's own with no file, counted as its file would
            // be (`own_modules::use_own`).
            return crate::own_modules::use_own(self, name, beside, order);
        };
        let executable = Executable::parse(bytes).ok()?;

        Some(Held::Library(
            self.load_found(executable, name, &path, beside, order),
        ))
    }

    /// A library a module imports, found by its name with `.DLL` added
    /// where KERNEL looks (`search.rs`): `beside` is the directory of the
    /// module whose file is looked in fourth -- the program being started,
    /// or the task that loads a library (**recorded** by `search`).
    pub(crate) fn find_library(
        &self,
        name: &str,
        beside: Option<&str>,
    ) -> Option<(String, Vec<u8>)> {
        let file = format!("{}.DLL", name.to_ascii_uppercase());

        self.search_places(beside, None)
            .into_iter()
            .find_map(|place| self.files.read_from(&place, &file))
    }

    /// The modules a module imports from, by name, in the order its
    /// relocations name them.
    pub(crate) fn import_names(executable: &Executable) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();

        for segment in &executable.segments {
            for relocation in &segment.relocations {
                if let Target::ImportOrdinal { module: from, .. }
                | Target::ImportName { module: from, .. } = &relocation.target
                {
                    let name = from.to_ascii_uppercase();

                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
            }
        }

        names
    }

    /// The first library a program imports that is neither loaded nor kept
    /// by winbox.js -- not even as stubs, as `COMMDLG` is -- and is found
    /// nowhere KERNEL looks, if any: such a program is not started, and
    /// `WinExec` answers 2 (**recorded** by `search`). Only the program's
    /// own imports are looked at; a library's that is missing is not
    /// recorded. As `missingLibrary`.
    pub(crate) fn missing_library(
        &self,
        executable: &Executable,
        beside: Option<&str>,
    ) -> Option<String> {
        Self::import_names(executable).into_iter().find(|name| {
            self.module_named(name).is_none()
                && self.kept_named(name).is_none()
                && !crate::own_modules::kept_on_load(name)
                && self.find_library(name, beside).is_none()
        })
    }

    /// A library read from its file: placed, numbered, registered, its own
    /// imports loaded first, and linked; added to `order`. Its index.
    pub(crate) fn load_found(
        &mut self,
        executable: Executable,
        name: &str,
        path: &str,
        beside: Option<&str>,
        order: &mut Vec<usize>,
    ) -> usize {
        // Its database before its segments, as KERNEL loads a module and
        // like a program's: a descriptor of its own, the module's handle
        // (**recorded** by `segfree`). As `loadFound`.
        let database = self.module_database(&executable);
        let library = self.place(executable, name, path);

        // `COMMDLG.DLL` loaded afresh: its data as the file has it, which
        // WinBox's print dialogs keep beside it (`commdlg/`).
        if name.eq_ignore_ascii_case(crate::commdlg::NAME) {
            crate::commdlg::print_loaded(self);
        }

        // The module's handle its database's selector; the instance its
        // data segment's handle.
        self.modules[library].handle = database.map_or(0, |index| {
            self.handles
                .alias_at(segment_selector(index), Object::Library(library))
        });
        self.modules[library].instance = self.library_instance(library);

        let header = &self.modules[library].executable.header;

        // The data segment KERNEL allocates: its minimum allocation (64K for
        // none) and two bytes, its stack and its heap (`KRNL386.EXE` seg1
        // `7678`-`76a7`). Its heap grows with it when a request does not
        // fit (`local_init`).
        if let Some(data) = self.modules[library].data() {
            let segment = &self.modules[library].executable.segments
                [usize::from(header.auto_data_segment) - 1];
            let minimum = match segment.min_allocation {
                0 => 0x10000,
                size => u32::from(size),
            };
            let size = minimum
                + 2
                + u32::from(header.initial_stack_size)
                + u32::from(header.initial_heap_size);

            // Rounded up to 32 bytes, as the global heap rounds a block
            // (**recorded** by `grround`).
            self.global.set_segment_size(data, (size + 31) & !31);
        }

        self.load_libraries_for(library, beside, order);
        self.link(library);
        order.push(library);
        library
    }

    /// A library's instance, as `LoadLibrary` answers it and its entry
    /// point is given it in DI: its data segment's handle -- one below the
    /// selector for a moveable segment, the selector for a fixed one --
    /// where its header says it has data (flags bit 0 or 1) and names the
    /// segment; else its module's handle (`KRNL386.EXE` seg2 `0b59`, which
    /// seg2 `24a0` gives the entry point and seg2 `1c50` answers for a
    /// library loaded again). **Recorded** by `ddewep`: DDEML's `WEP`
    /// answers its data segment's selector, one more than the instance. As
    /// `libraryInstance`.
    fn library_instance(&mut self, library: usize) -> u16 {
        let module = &self.modules[library];
        let header = &module.executable.header;

        let Some(data) = module.data().filter(|_| header.flags & 3 != 0) else {
            return module.handle;
        };
        let movable =
            module.executable.segments[usize::from(header.auto_data_segment) - 1].movable();
        let selector = segment_selector(data);

        self.handles.alias_at(
            if movable { selector - 1 } else { selector },
            Object::Library(library),
        )
    }

    /// A module placed: its segments mapped, from descriptor 1 on, its
    /// prologues patched and its blocks sized; registered under its name.
    fn place(&mut self, executable: Executable, name: &str, path: &str) -> usize {
        let mut segments = Vec::new();

        for index in 0..executable.segments.len() {
            let bytes = loaded_segment(
                executable.segment_bytes(index),
                segment_block_size(&executable, index + 1),
            );
            // A selector as KERNEL gives one, the one freed last first; the
            // data segment's not one whose handle another handle has.
            let data = index + 1 == usize::from(executable.header.auto_data_segment);
            let handles = &self.handles;
            let at = self
                .descriptors
                .take_avoiding(1, |index| data && numbered(handles, index))
                .expect("a descriptor for a segment");

            self.descriptors.map(
                &mut self.cpu.bus,
                at,
                &bytes,
                executable.segments[index].code(),
            );
            segments.push(at);
        }

        let module = Module {
            name: executable.module_name().unwrap_or(name).to_string(),
            path: path.to_string(),
            executable: executable.into(),
            segments,
            started: false,
            usage: 1,
            brought: Vec::new(),
            instance: 0,
            handle: 0,
            own: None,
        };

        self.patch_prologues(&module);
        self.size_segments(&module);
        self.modules.push(module);
        self.modules.len() - 1
    }

    /// Each segment a block of global memory, with a size: its minimum
    /// allocation, 64K for none, and two bytes, and for the data segment
    /// the stack and the heap more (`KRNL386.EXE` seg1 `7678`-`76a7`),
    /// which the global heap rounds up to 32 bytes as it rounds any
    /// block's (**recorded** by `grround`: 2FF0h is given 3000h, and
    /// `locinfo`'s heap at the end of its data segment grows from there).
    /// As `win16.ts`.
    fn size_segments(&mut self, module: &Module) {
        for (number, &index) in module.segments.iter().enumerate() {
            self.global
                .set_segment_size(index, segment_block_size(&module.executable, number + 1));
        }
    }

    /// The prologues of a module's entry points, patched as KERNEL patches
    /// them when it loads a code segment (`KRNL386.EXE` seg1 `7bac`). For
    /// each entry in a code segment whose third byte is `nop`:
    ///
    /// * `push ds; pop ax` (`1E 58`) becomes `mov ax, ds` (`8C D8`);
    /// * then `mov ax, ds` becomes `mov ax, <data segment's selector>` for
    ///   an entry flagged as using shared data (bit 1);
    /// * an exported entry of a module with multiple data -- a program --
    ///   becomes three `nop`s, its data segment coming from AX.
    ///
    /// A module with no data segment is not patched at all.
    ///
    /// Every program has multiple data, whatever its header says: KERNEL
    /// marks any module that is not a library so as it loads it (`KRNL386.EXE`
    /// seg2 `17ee`, `or ne_flags, 2` unless bit 15 is set). Media Player is
    /// linked with a single data segment (flags 0309h), and its hook for
    /// `COMMDLG`'s Open dialog finds its data only so. **Recorded** by
    /// `solodata`: a program linked `oneautodata` (201h) has the flags 243h
    /// in memory, its exported hook three `nop`s, and its hook, through
    /// `MakeProcInstance`'s thunk, its own data.
    fn patch_prologues(&mut self, module: &Module) {
        let Some(data) = module.data() else {
            return;
        };
        let multiple = !module.is_library();
        let dgroup = segment_selector(data);
        let memory = &mut self.cpu.bus;

        for entry in &module.executable.entry_points {
            let (EntryPoint::Fixed {
                segment,
                offset,
                flags,
            }
            | EntryPoint::Movable {
                segment,
                offset,
                flags,
            }) = *entry
            else {
                continue;
            };

            let code = module
                .executable
                .segments
                .get(usize::from(segment).wrapping_sub(1))
                .is_some_and(winbox_ne::Segment::code);

            if segment == 0 || !code {
                continue;
            }

            let at = ((module.segments[usize::from(segment) - 1] as u32) << 16) + u32::from(offset);

            if memory.read8(at + 2) != 0x90 {
                continue;
            }

            if memory.read8(at) == 0x1e && memory.read8(at + 1) == 0x58 {
                memory.write(at, &[0x8c, 0xd8]);
            }

            if memory.read8(at) != 0x8c || memory.read8(at + 1) != 0xd8 {
                continue;
            }

            if multiple && entry.exported() {
                memory.write(at, &[0x90, 0x90]);
                continue;
            }

            if flags & 0x02 != 0 {
                let [low, high] = dgroup.to_le_bytes();

                memory.write(at, &[0xb8, low, high]);
            }
        }
    }
}

/// Whether the selector a module's database would be, or its data segment's
/// handle one below, is a number another of WinBox's handles has: a
/// module's database is its handle, and its data segment's handle its
/// instance, in the one set of numbers GDI's objects and the rest are given
/// from, so such a descriptor is passed over for them. As `Win16.numbered`.
fn numbered(handles: &crate::handles::Handles, index: usize) -> bool {
    let selector = segment_selector(index);

    handles.resolve(selector).is_some() || handles.resolve(selector.wrapping_sub(1)).is_some()
}
