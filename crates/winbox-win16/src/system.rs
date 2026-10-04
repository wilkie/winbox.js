//! The machine Windows runs a program on, as winbox.js's `Win16` makes it:
//! the processor in protected mode, the descriptor tables, the global and
//! local heaps, and the modules winbox.js keeps, each given its selectors
//! in the order Windows' own are.

use std::collections::{HashMap, HashSet};

use winbox_cpu::Cpu;
use winbox_machine::{
    Descriptors, Files, GDT_BASE, GlobalHeap, LDT_BASE, LocalHeap, Memory, segment_selector,
};

use crate::call::Call;
use crate::task::Task;

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

/// Who is told of each call.
pub struct Watch(pub Box<dyn FnMut(&Call)>);

impl std::fmt::Debug for Watch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Watch")
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
    /// DOS's files.
    pub files: Files,
    /// The task running, once a program has started.
    pub task: Option<Task>,
    /// Whether the task has ended.
    pub ended: bool,
    /// The instructions run.
    pub instructions: u64,
    /// Told of each call, after it is answered.
    pub on_call: Option<Watch>,
    /// The segments whose heap grows the `GlobalAlloc` block it is in.
    pub heap_blocks: HashSet<usize>,
    /// How the task wants errors handled (`SetErrorMode`).
    pub error_mode: u16,
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
            files: Files::new(),
            task: None,
            ended: false,
            instructions: 0,
            on_call: None,
            heap_blocks: HashSet::new(),
            error_mode: 0,
        };

        for module in KEPT {
            system.keep(module);
        }

        system
    }

    pub fn memory(&mut self) -> &mut Memory {
        &mut self.cpu.bus
    }

    /// The file of the module a handle or instance names: a kept module's,
    /// a loaded one's by its data segment's selector or the handle one
    /// below it; for nought or any other, the task's program's.
    pub fn path_of(&self, handle: u16) -> String {
        if handle != 0 {
            if let Some(kept) = self
                .kept
                .iter()
                .find(|kept| kept.handle() == handle || kept.instance() == handle)
            {
                return kept.module.path.to_string();
            }

            if let Some(module) = self.modules.iter().find(|module| {
                module.data().is_some_and(|data| {
                    let selector = segment_selector(data);

                    handle == selector || handle == selector - 1
                })
            }) {
                return module.path.clone();
            }
        }

        self.task
            .as_ref()
            .map_or_else(String::new, |task| self.modules[task.program].path.clone())
    }

    /// Where a selector's segment starts, from its descriptor: the local
    /// table's or the global one's.
    pub fn base_of(&self, selector: u16) -> u32 {
        let table = if selector & 4 == 0 {
            GDT_BASE
        } else {
            LDT_BASE
        };
        let entry = table + u32::from(selector & !7);
        let memory = &self.cpu.bus;

        u32::from(memory.read16(entry + 2))
            | u32::from(memory.read8(entry + 4)) << 16
            | u32::from(memory.read8(entry + 7)) << 24
    }

    /// Where a far pointer points.
    pub fn linear(&self, far: u32) -> u32 {
        self.base_of((far >> 16) as u16).wrapping_add(far & 0xffff)
    }

    /// The byte a far pointer and `step` more point at, the offset within
    /// its segment.
    fn far_step(&self, far: u32, step: u32) -> u32 {
        self.linear((far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff))
    }

    pub fn read_far(&self, far: u32, length: usize) -> Vec<u8> {
        (0..length as u32)
            .map(|step| self.cpu.bus.read8(self.far_step(far, step)))
            .collect()
    }

    pub fn write_far(&mut self, far: u32, bytes: &[u8]) {
        for (step, byte) in bytes.iter().enumerate() {
            let at = self.far_step(far, step as u32);

            self.cpu.bus.write8(at, *byte);
        }
    }

    /// Text copied to a buffer of `size` bytes, as much as fits with its
    /// nought: how many of its bytes.
    pub fn copy_text(&mut self, text: &[u8], far: u32, size: usize) -> usize {
        if far == 0 || size == 0 {
            return 0;
        }

        let count = text.len().min(size - 1);
        let mut bytes = text[..count].to_vec();

        bytes.push(0);
        self.write_far(far, &bytes);
        count
    }

    /// The string a far pointer points at, to its nought.
    pub fn read_string(&self, far: u32) -> Vec<u8> {
        (0..0x10000)
            .map(|step| self.cpu.bus.read8(self.far_step(far, step)))
            .take_while(|&byte| byte != 0)
            .collect()
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
