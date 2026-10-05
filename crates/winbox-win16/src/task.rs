//! A program's first state, as winbox.js's `Win16.prepare` makes it: its
//! program segment prefix with the command line, its environment and stack,
//! and the registers it starts with.

use winbox_cpu::{BX, CS, CX, DI, DS, ES, Exit, SI, SP, SS};
use winbox_machine::segment_selector;

use crate::system::System;

/// Where the interrupt descriptor table is kept: one for all tasks
/// (`dos.rs` reads and writes its vectors there).
const IDT_SEGMENT: usize = 0xffd;

/// A task's DOS environment, as the `environ` probe recorded it: the DOS
/// host's variables -- none here -- then `windir`, the nought that ends
/// them, a word count of 1, and the path of the program DOS started, the
/// kernel's.
pub fn task_environment(windows: &str) -> Vec<u8> {
    let mut bytes = Vec::new();

    bytes.extend_from_slice(format!("windir={windows}").as_bytes());
    bytes.extend_from_slice(&[0, 0, 1, 0]);
    bytes.extend_from_slice(format!("{windows}\\SYSTEM\\KRNL386.EXE").as_bytes());
    bytes.push(0);
    bytes
}

/// `SW_SHOWNORMAL`, how a program is shown when nothing says otherwise.
pub(crate) const SW_SHOWNORMAL: u16 = 1;

/// A started program.
#[derive(Debug, Clone)]
pub struct Task {
    /// Its module's index.
    pub program: usize,
    /// Its program segment prefix's descriptor index.
    pub program_segment: usize,
    /// Its environment's descriptor index.
    pub environment: usize,
    /// The libraries it loaded, whose entry points run in its `InitTask`.
    pub libraries: Vec<usize>,
    /// The instance of the program before it, if any.
    pub previous: u16,
    /// How its main window is shown.
    pub show: u16,
    /// Its disk transfer area, where it has set one.
    pub transfer_area: Option<(u16, u16)>,
    /// The procedure told when a discardable block is to go.
    pub global_notify: u32,
    /// Its message queue.
    pub queue: crate::queue::Queue,
}

impl System {
    /// The first program made ready to run: in protected mode, its prefix
    /// and environment mapped, its stack noughts, its registers set.
    pub fn start(
        &mut self,
        program: usize,
        libraries: Vec<usize>,
        command_line: &str,
    ) -> Result<(), Exit> {
        self.start_with(program, libraries, command_line, SW_SHOWNORMAL, 0, None)
    }

    /// A program made ready to run, as `start` makes one, shown as `show`
    /// asks, after the instance `previous` of it if any, with an
    /// environment of its own or Windows'.
    pub fn start_with(
        &mut self,
        program: usize,
        libraries: Vec<usize>,
        command_line: &str,
        show: u16,
        previous: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<(), Exit> {
        let module = &self.modules[program];
        let header = module.executable.header.clone();
        let data = module.data().expect("a program's data segment");
        let top = module.data_top();
        let place = |segment: u16| module.translate(segment).map_or(0, segment_selector);
        let (ss, cs) = (place(header.stack_ss), place(header.entry_cs));

        // The current directory, one for all, as DOS keeps it: Windows',
        // where Windows was started, when the first program starts (`tasks2`).
        if self.scheduler.slots.is_empty() {
            self.files.drive = 'C';
            self.files.set_path("C:\\WINDOWS");
        }

        self.cpu.protected = true;
        // Protected mode's bit, as the TypeScript engine sets the word.
        self.cpu.msw = Some(1);
        // The installation's drivers' icons and cursors, where there is one.
        if self.driver.is_none() {
            self.read_drivers();
        }

        // The floating-point unit, the coprocessor's or WIN87EM's emulator's.
        self.cpu.fpu = Some(winbox_cpu::X87::default());

        if !self.descriptors.used(IDT_SEGMENT) {
            self.descriptors
                .map(&mut self.cpu.bus, IDT_SEGMENT, &[0; 4096], false);
        }

        let program_segment = self.descriptors.find(1, 1).expect("a descriptor");

        self.descriptors
            .map(&mut self.cpu.bus, program_segment, &[0; 256], false);

        let environment = self.descriptors.find(1, 1).expect("a descriptor");
        let bytes = strings.unwrap_or_else(|| task_environment("C:\\WINDOWS"));
        let mut segment = vec![0; 256.max((bytes.len() + 15) & !15)];

        segment[..bytes.len()].copy_from_slice(&bytes);
        self.descriptors
            .map(&mut self.cpu.bus, environment, &segment, false);

        let stack_size = u32::from(header.initial_stack_size);
        let memory = &mut self.cpu.bus;

        memory.zero(((data as u32) << 16) + top, stack_size as usize);

        // The prefix: `INT 20h`, the environment's selector, and the
        // command line -- its length, its characters and a nought, with no
        // carriage return (`winexec`).
        let prefix = (program_segment as u32) << 16;
        let tail = &command_line.as_bytes()[..command_line.len().min(126)];

        memory.write(prefix, &[0xcd, 0x20]);
        memory.write16(prefix + 0x2c, segment_selector(environment));
        memory.write8(prefix + 0x80, tail.len() as u8);
        memory.write(prefix + 0x81, tail);
        memory.write8(prefix + 0x81 + tail.len() as u32, 0);

        self.cpu.load_segment(DS, segment_selector(data))?;
        self.cpu.load_segment(SS, ss)?;
        self.cpu.load_segment(CS, cs)?;
        self.cpu
            .load_segment(ES, segment_selector(program_segment))?;
        self.cpu.regs[SP] = (top + stack_size) as u16;
        self.cpu.ip = header.entry_ip;
        self.cpu.regs[BX] = header.initial_stack_size;
        self.cpu.regs[CX] = header.initial_heap_size;
        // hModule.
        self.cpu.regs[DI] = 0x88;
        self.cpu.regs[SI] = 0;

        if self.scheduler.slots.is_empty() {
            self.first_task(self.task_handle, program);
        }

        self.task = Some(Task {
            program,
            program_segment,
            environment,
            libraries,
            previous,
            show,
            transfer_area: None,
            global_notify: 0,
            queue: crate::queue::Queue::default(),
        });
        Ok(())
    }
}
