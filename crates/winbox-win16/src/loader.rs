//! A program or library placed in memory, as winbox.js's `Loader` places
//! one and KERNEL would: each segment given a descriptor, its image written
//! there, its block sized, its entry points' prologues patched, and its data
//! segment given its local heap.

use winbox_machine::segment_selector;
use winbox_ne::{EntryPoint, Executable, Target};

use crate::system::System;

/// A module loaded from its file: a program, or a library it needs.
#[derive(Debug)]
pub struct Module {
    pub executable: Executable,
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

/// Finds a library's file by its module name: its path, as DOS names it,
/// and its bytes.
pub type FindLibrary<'a> = dyn FnMut(&str) -> Option<(String, Vec<u8>)> + 'a;

/// Modules winbox.js has only as stubs: the file on the disk is used
/// instead when there is one.
const STUBS_ONLY: [&str; 1] = ["COMMDLG"];

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
    fn wants_file(&self, name: &str) -> bool {
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
    pub fn load(
        &mut self,
        executable: Executable,
        path: &str,
        find: &mut FindLibrary<'_>,
    ) -> (usize, Vec<usize>) {
        let file = path.rsplit('\\').next().unwrap_or(path);
        let name = file.split('.').next().unwrap_or(file).to_ascii_uppercase();
        let program = self.place(executable, &name, path);
        let mut order = Vec::new();

        self.load_libraries_for(program, find, &mut order);

        let module = &self.modules[program];
        let header = &module.executable.header;

        if let Some(data) = module.data() {
            let start = module.data_top() + u32::from(header.initial_stack_size);
            let end = start + u32::from(header.initial_heap_size);
            let movable =
                module.executable.segments[usize::from(header.auto_data_segment) - 1].movable();

            // A moveable data segment's heap grows when a request does not fit.
            if self.local_init(data, start, end)
                && let Some(heap) = self.heaps.get_mut(&data)
            {
                heap.growable = movable;
            }
        }

        (program, order)
    }

    /// The libraries a module imports that are to come from their files,
    /// and theirs, each once: placed, registered under its name, and
    /// linked, in the order their entry points are to run -- a library
    /// before the ones that need it.
    fn load_libraries_for(
        &mut self,
        module: usize,
        find: &mut FindLibrary<'_>,
        order: &mut Vec<usize>,
    ) {
        let mut names: Vec<String> = Vec::new();

        for segment in &self.modules[module].executable.segments {
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

        for name in names {
            if let Some(already) = self.module_named(&name)
                && already != module
                && self.modules[already].executable.header.library()
            {
                self.modules[already].usage += 1;
                continue;
            }

            if !self.wants_file(&name) {
                continue;
            }

            let Some((path, executable)) =
                find(&name).and_then(|(path, bytes)| Some((path, Executable::parse(bytes).ok()?)))
            else {
                continue;
            };
            let library = self.place(executable, &name, &path);
            let header = &self.modules[library].executable.header;

            // The data segment KERNEL allocates: its minimum allocation
            // (64K for none) and two bytes, its stack and its heap, in
            // paragraphs. A moveable one's heap grows (`Heap.grow`).
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

                if segment.movable() {
                    self.growable.insert(data);
                }

                self.global.set_segment_size(data, (size + 15) & !15);
            }

            self.load_libraries_for(library, find, order);
            self.link(library);
            order.push(library);
        }
    }

    /// A module placed: its segments mapped, from descriptor 1 on, its
    /// prologues patched and its blocks sized; registered under its name.
    fn place(&mut self, executable: Executable, name: &str, path: &str) -> usize {
        let mut segments = Vec::new();

        for index in 0..executable.segments.len() {
            let bytes = executable.segment_bytes(index);
            let at = self
                .descriptors
                .find(1, 1)
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
            executable,
            segments,
            started: false,
            usage: 1,
        };

        self.patch_prologues(&module);
        self.size_segments(&module);
        self.modules.push(module);
        self.modules.len() - 1
    }

    /// Each segment a block of global memory, with a size: its minimum
    /// allocation, 64K for none, and for the data segment two bytes, the
    /// stack and the heap more, in paragraphs (`KRNL386.EXE` seg1 `7660`).
    fn size_segments(&mut self, module: &Module) {
        let header = &module.executable.header;

        for (number, segment) in module.executable.segments.iter().enumerate() {
            let extra = if number + 1 == usize::from(header.auto_data_segment) {
                2 + u32::from(header.initial_stack_size) + u32::from(header.initial_heap_size)
            } else {
                0
            };
            let minimum = match segment.min_allocation {
                0 => 0x10000,
                size => u32::from(size),
            };
            let size = (minimum + extra).min(0x10000);

            self.global
                .set_segment_size(module.segments[number], (size + 15) & !15);
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
    fn patch_prologues(&mut self, module: &Module) {
        let Some(data) = module.data() else {
            return;
        };
        let multiple = module.executable.header.flags & 3 == 2;
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
