//! The machine Windows runs a program on, as winbox.js's `Win16` makes it:
//! the processor in protected mode, the descriptor tables, the global and
//! local heaps, and the modules winbox.js keeps, each given its selectors
//! in the order Windows' own are.

use std::collections::{HashMap, HashSet};

use winbox_cpu::Cpu;
use winbox_machine::{Descriptors, GlobalHeap, LocalHeap, Memory, segment_selector};

use crate::kept::KEPT;
use crate::loader::Module;
use crate::modules::Kept;

/// The first descriptor Windows' own modules are given: selector 27h, so
/// that every handle made of one is 32 or more (`modhand`).
const SYSTEM_FIRST: usize = 4;

/// Where the stubs of a kept module are looked for a descriptor from.
const STUBS_FIRST: usize = 4096;

/// How far apart a kept module's stubs are: `INT 80h`, `RETF n` and a byte.
pub const STEP: u16 = 8;

/// A kept module as this machine has it.
#[derive(Debug)]
pub struct KeptModule {
    pub module: &'static Kept,
    /// The descriptor of its module database: its handle's.
    pub database: usize,
    /// Its data segment's descriptor.
    pub data: usize,
    /// Its stubs' segment's descriptor, once a program links to it.
    pub stubs: Option<usize>,
}

impl KeptModule {
    /// Its module handle, as `GetModuleHandle` answers it.
    pub fn handle(&self) -> u16 {
        segment_selector(self.database)
    }

    /// Its instance, as `LoadLibrary` answers it: its data segment's
    /// selector for fixed data, one below for moveable.
    pub fn instance(&self) -> u16 {
        segment_selector(self.data) - u16::from(!self.module.fixed)
    }
}

/// The machine and what Windows keeps on it.
#[derive(Debug)]
pub struct System {
    pub cpu: Cpu<Memory>,
    pub descriptors: Descriptors,
    pub global: GlobalHeap,
    /// The local heaps, by their segment's descriptor index.
    pub heaps: HashMap<usize, LocalHeap>,
    pub kept: Vec<KeptModule>,
    /// The modules loaded from their files.
    pub modules: Vec<Module>,
    /// The data segments whose heap grows, once it is made: a moveable
    /// library's.
    pub growable: HashSet<usize>,
    /// Whether the machine has a coprocessor: what `__WINFLAGS` says, and
    /// which OS fixups apply.
    pub coprocessor: bool,
}

impl Default for System {
    fn default() -> Self {
        Self::new()
    }
}

impl System {
    /// A machine with the modules winbox.js keeps.
    pub fn new() -> Self {
        let mut cpu = Cpu::new(Memory::new());
        let mut descriptors = Descriptors::new();

        descriptors.reset(&mut cpu.bus);

        let (ldt_base, ldt_limit) = Descriptors::ldt();
        let (gdt_base, gdt_limit) = Descriptors::gdt();

        cpu.ldt_base = ldt_base;
        cpu.ldt_limit = ldt_limit;
        cpu.gdt_base = gdt_base;
        cpu.gdt_limit = gdt_limit;

        let mut system = Self {
            cpu,
            descriptors,
            global: GlobalHeap::new(),
            heaps: HashMap::new(),
            kept: Vec::new(),
            modules: Vec::new(),
            growable: HashSet::new(),
            coprocessor: true,
        };

        for module in KEPT {
            system.keep(module);
        }

        system
    }

    pub fn memory(&mut self) -> &mut Memory {
        &mut self.cpu.bus
    }

    /// A kept module's database and its data segment, 64 KiB of noughts.
    fn keep(&mut self, module: &'static Kept) {
        let memory = &mut self.cpu.bus;
        let database = self
            .descriptors
            .blank(memory, SYSTEM_FIRST)
            .expect("a descriptor for a module");
        let data = self
            .descriptors
            .find(SYSTEM_FIRST, 1)
            .expect("a descriptor for a module's data");

        self.descriptors.map(memory, data, &vec![0; 0x10000], false);
        self.kept.push(KeptModule {
            module,
            database,
            data,
            stubs: None,
        });
    }

    /// The kept module of a name, without regard to case.
    pub fn kept_named(&self, name: &str) -> Option<usize> {
        self.kept
            .iter()
            .position(|kept| kept.module.name.eq_ignore_ascii_case(name))
    }

    /// The kept module whose stubs are in a segment.
    pub fn kept_at(&self, index: usize) -> Option<&KeptModule> {
        self.kept.iter().find(|kept| kept.stubs == Some(index))
    }

    /// A kept module's stubs, made the first time a program links to it: a
    /// callback thunk first, then for each ordinal `INT 80h` and `RETF`
    /// popping its arguments, as many as the module has, a thousand at least.
    pub fn stubs(&mut self, kept: usize) -> usize {
        if let Some(index) = self.kept[kept].stubs {
            return index;
        }

        let module = self.kept[kept].module;
        let ordinals = module.exports.len().max(1000);
        let step = usize::from(STEP);
        let mut code = vec![0u8; (ordinals + 1) * step];

        code[..8].copy_from_slice(&[0x9a, 0x00, 0x00, 0xff, 0xff, 0xcd, 0x81, 0x00]);

        for ordinal in 0..ordinals {
            let pops = module
                .export(ordinal as u16)
                .map_or(0, |export| export.pops);
            let [low, high] = pops.to_le_bytes();
            let at = step * (ordinal + 1);

            code[at..at + 5].copy_from_slice(&[0xcd, 0x80, 0xca, low, high]);
        }

        let index = self
            .descriptors
            .find(STUBS_FIRST, 1)
            .expect("a descriptor for a module's stubs");

        self.descriptors.map(&mut self.cpu.bus, index, &code, true);
        self.kept[kept].stubs = Some(index);
        index
    }
}
