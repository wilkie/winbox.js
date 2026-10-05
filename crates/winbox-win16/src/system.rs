//! The machine Windows runs a program on, as winbox.js's `Win16` makes it:
//! the processor in protected mode, the descriptor tables, the global and
//! local heaps, and the modules winbox.js keeps, each given its selectors
//! in the order Windows' own are.

use std::collections::{HashMap, HashSet};

use winbox_cpu::Cpu;
use winbox_machine::{
    Clock, Descriptors, Files, GDT_BASE, GlobalHeap, INSTRUCTIONS_PER_MS, LDT_BASE, LocalHeap,
    Memory, days_from_civil, segment_selector,
};

use crate::call::Call;
use crate::handles::{Handles, Object};
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

/// A descriptor as the processor reads one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Each is a bit of the descriptor, as the processor reads it.
#[allow(clippy::struct_excessive_bools)]
pub struct Descriptor {
    pub base: u32,
    /// Its limit, in bytes.
    pub limit: u32,
    /// The lowest offset it reaches, and the first past its highest.
    pub low_limit: u64,
    pub past_limit: u64,
    pub present: bool,
    /// Code or data, rather than a system descriptor.
    pub segment: bool,
    pub executable: bool,
    /// Data writable, or code readable.
    pub read_write: bool,
}

/// The machine and what Windows keeps on it.
#[derive(Debug)]
// Each yes or no is one of Windows' own, kept as it keeps it.
#[allow(clippy::struct_excessive_bools)]
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
    /// The code the last task to end gave DOS as it ended (`INT 21h`
    /// AH 4Ch's AL); none before one has.
    pub exit_code: Option<u8>,
    /// The instructions run.
    pub instructions: u64,
    /// The calls made, each as it is made, its answer when it comes; kept
    /// where this is not `None`.
    pub log: Option<Vec<Call>>,
    /// How many calls the run is to make, where it is to stop as the
    /// program makes the next: the corpus comparison runs as far as the
    /// TypeScript engine's run went.
    pub calls_until: Option<usize>,
    /// Keys pressed and screens kept at set calls (`call_marks.rs`).
    pub call_marks: crate::call_marks::CallMarks,
    /// The time a message made now is given, where it is to be another's.
    pub message_time: Option<u32>,
    /// The segments whose heap grows the `GlobalAlloc` block it is in.
    pub heap_blocks: HashSet<usize>,
    /// How the task wants errors handled (`SetErrorMode`).
    pub error_mode: u16,
    /// Each fault a program's task was ended for, as its Application Error
    /// box words it, the box shown or not.
    pub application_faults: Vec<String>,
    /// The host's hand at USER's system error box, where it has one.
    pub box_hand: Option<crate::sys_error_box::BoxHand>,
    /// While USER's system error box is up, the host's mouse and keyboard
    /// as messages for it -- each its message, `wParam` and point on the
    /// screen -- in place of the windows' (`raster-input.ts`'s `modal`).
    pub modal_input: Option<std::collections::VecDeque<(u16, u16, i16, i16)>>,
    /// How many procedures the engine has called into that have not
    /// returned.
    pub depth: usize,
    /// The handles given out.
    pub handles: Handles,
    /// The task's handle, once a program is loaded.
    pub task_handle: u16,
    /// The machine's time: virtual, at the survey's rate.
    pub clock: Clock,
    /// When the clock began, in local milliseconds since 1970: the morning
    /// of winbox.js's choosing, 6 April 1992 at 9:00.
    pub epoch_ms: i64,
    /// DOS's disk transfer area with no task.
    pub transfer_area: (u16, u16),
    /// The folders DOS has searched, by the number a search's state keeps.
    pub searched: Vec<String>,
    /// DOS functions asked for and not answered, by AX.
    pub unanswered_dos: Vec<u16>,
    /// `MakeProcInstance`'s thunks: the block they are made in, and how
    /// many of its are made.
    pub thunks: (u32, usize),
    /// The day the BIOS's clock was last asked on.
    pub clock_day: Option<i64>,
    /// Blocks' page locks, and their counts.
    pub page_locks: HashMap<usize, u16>,
    /// The files the task may have open (`SetHandleCount`).
    pub handle_count: u16,
    /// The display winbox.js is.
    pub display: crate::display::Display,
    /// The kept modules' files from the installation, read when first asked
    /// for their resources, by the kept module's index.
    pub kept_files: HashMap<usize, Option<std::rc::Rc<winbox_ne::Executable>>>,
    /// The window classes registered, by index; the atoms `GetClassInfo`
    /// answers, by name.
    pub classes: Vec<crate::classes::WindowClass>,
    pub class_atoms: HashMap<String, u16>,
    /// The segment of USER's procedures' thunks, and the procedures in it.
    pub proc_segment: Option<usize>,
    pub proc_tokens: Vec<crate::classes::HostProc>,
    /// The menus made, by index.
    pub menus: Vec<crate::menus::MenuData>,
    /// The windows made, by index: `None` for one destroyed.
    pub windows: Vec<Option<crate::windows::Window>>,
    /// The windows' order, front to back.
    pub z_order: Vec<usize>,
    /// The next step of the cascade a default window is placed in.
    pub cascade_step: i32,
    /// The window with the keyboard's focus.
    pub focus: Option<usize>,
    /// The font an icon's title is in, once the raster desktop is made.
    pub icon_title_font: Option<u16>,
    /// The System font the raster desktop draws and measures its frames
    /// in, once it is made.
    pub desktop_font: Option<winbox_raster::LogicalFont>,
    /// The font icons' titles are in, realised.
    pub title_font: Option<winbox_raster::LogicalFont>,
    /// The hooks put in, by kind in the order each kind was first hooked,
    /// each chain newest first; and the last handle given one.
    pub hooks: Vec<(i16, Vec<crate::hooks::Hook>)>,
    pub next_hook: u32,
    /// TOOLHELP's registrations: each task's notification procedure and
    /// its flags, and its interrupt procedure.
    pub notifications: Vec<(u16, u32, u16)>,
    pub interrupt_handlers: Vec<(u16, u32)>,
    /// The sets of moves begun and not yet made: each window, the window it
    /// goes after, its place and size, and the flags.
    pub deferred: Vec<Option<Vec<crate::position::Deferred>>>,
    /// Whether the desktop itself is to be drawn again when paints are next
    /// looked for, as after the system colours change.
    pub background_due: bool,
    /// The mouse's buttons down, left 1, right 2, middle 4; the window whose
    /// caption they were pressed on, until let go; and the last press, for
    /// its double click: the button, where, and when.
    pub mouse_buttons: u8,
    pub caption_press: Option<usize>,
    pub last_press: Option<(u8, i16, i16, f64)>,
    /// The window the mouse is captured by, with `SetCapture`.
    pub capture: Option<usize>,
    /// The 256-colour display's system palette, once wanted; whether each
    /// device context's palette was selected for the background, by its
    /// handle; and the system palette's use, where set.
    pub system_palette: Option<crate::gdi::palettes::SystemPalette>,
    pub palette_background: HashMap<u16, bool>,
    pub system_palette_use: Option<u16>,
    /// GDI's segment as a program reads it, and where it starts.
    pub gdi_heap: crate::gdi::heap::Heap,
    pub gdi_data: Option<u32>,
    /// The accelerator tables loaded.
    pub accelerators: Vec<Vec<crate::accelerators::Accelerator>>,
    /// Which window each pixel of the screen shows, its index plus one;
    /// nought for the desktop.
    pub owners: std::rc::Rc<Vec<u16>>,
    /// The screen's pixels, made with the raster desktop.
    pub screen: Option<winbox_raster::DeviceBitmap>,
    /// The window that was active before the last change of active window,
    /// until its messages are sent, and whether a press made the change.
    pub pending_activation: Option<(Option<usize>, bool)>,
    /// The last input's serial, and the move not yet taken, if the last
    /// input was one.
    pub message_serials: u64,
    pub last_move: Option<(usize, u64)>,
    /// The last mark given a box due a paint.
    pub dirty_marks: u64,
    /// The device contexts released and not yet given out again, the
    /// oldest first: each handle, and the context it stands for.
    pub dc_cache: Vec<(u16, usize)>,
    /// The timers set, in the order they were first set.
    pub timers: Vec<crate::queue::Timer>,
    /// Where the cursor was last put; `None` where the mouse driver's reset
    /// left it, the middle of the screen.
    pub cursor_pos: Option<(i16, i16)>,
    /// The rectangle `ClipCursor` holds the cursor in, if any.
    pub cursor_clip: Option<[i16; 4]>,
    /// The tasks, and which has the processor (`scheduler`).
    pub scheduler: crate::scheduler::Scheduler,
    /// Whether USER's own hidden windows are made.
    pub user_windows_made: bool,
    /// The installation's display driver's and USER's icons and cursors.
    pub driver: Option<crate::icons::DriverResources>,
    /// The blocks icons were made in, and the standard icons' and cursors'
    /// handles, by id.
    pub icon_blocks: HashSet<u16>,
    pub standard_icons: HashMap<u16, u16>,
    pub standard_cursors: HashMap<u16, u16>,
    /// The cursors handed out, the one set, and the display count.
    pub cursors: Vec<crate::icons::CursorData>,
    pub cursor: Option<u16>,
    pub cursor_count: i16,
    /// The host it runs in, which shows the screen and hands in input,
    /// given the machine once a frame (`host.rs`); none for a run with no
    /// one to show.
    pub host: Option<crate::host::HostSlot>,
    /// The system colours `SetSysColors` set, by index.
    pub sys_colors: Vec<Option<u32>>,
    /// USER's brushes of system colours, by index: the colour each was
    /// made in and its handle.
    pub sys_color_brushes: HashMap<usize, (u32, u16)>,
    /// The block USER keeps for the message it hands its message filters,
    /// made the first time; its far address.
    pub hook_message: u32,
    /// The window `SetSysModalWindow` made system-modal, nought for none.
    pub sys_modal: u16,
    /// The device contexts `GetWindowDC` made, by index, and the window each
    /// is over, for `ReleaseDC` to take back.
    pub window_dcs: HashMap<usize, u16>,
    /// WinG's bitmaps, whose pixels are kept in step with their bits.
    pub wing_bitmaps: Vec<crate::wing::WinGBitmap>,
    /// GDI's objects and device contexts.
    pub gdi: crate::gdi::Gdi,
    /// The messages registered, by name upper case: each one's number, and
    /// its name as given.
    pub registered_messages: HashMap<String, (u16, String)>,
    /// What `SwapMouseButton` was last given.
    pub swap_buttons: Option<u16>,
    /// WIN87EM's state beside the unit's.
    pub floating: crate::win87em::FloatingState,
    /// Each local heap's handle delta, by its data segment's selector.
    pub handle_deltas: HashMap<u16, u16>,
    /// Where each module's resources' handles start.
    pub resource_bases: HashMap<usize, u16>,
    /// The resources loaded, by their handles: their blocks and uses.
    pub loaded_resources: HashMap<u16, crate::resources::Loaded>,
    /// The resource each block loaded holds.
    pub resource_blocks: HashMap<u16, u16>,
    /// The profiles written, held until a flush lets them go, by file name.
    pub profiles: HashMap<Vec<u8>, crate::profile::Profile>,
    /// The atoms' tables, global and local.
    pub atoms: crate::atoms::Atoms,
    /// What USER keeps of its calls that need no window.
    pub user_state: crate::user_misc::UserState,
    /// GDI's fonts, once loaded (`System::fonts`).
    pub fonts: Option<crate::fonts::FontManager>,
    /// The widest line of the last `DrawText`, which USER keeps between
    /// calls.
    pub draw_text_widest: i64,
    /// USER's table of installable drivers (`drivers.rs`).
    pub drivers: crate::drivers::Drivers,
    /// MMSYSTEM's timer events, MCI's devices and its drivers' state.
    pub mmsystem: crate::mmsystem::State,
    /// Procedures waiting to be called as at interrupt time.
    pub interrupts: crate::interrupts::Interrupts,
    /// What SHELL keeps: the registration database and its shell hook.
    pub shell: crate::shell::Shell,
    /// COMM's ports, and USER's table of those open.
    pub comm: crate::comm::Comm,
    pub comm_slots: crate::user_comm::Slots,
    /// The printers' device contexts and Print Manager's spooler
    /// (`printer.rs`).
    pub printing: crate::printer::Printing,
    /// The caret, and how it blinks.
    pub caret: crate::caret::CaretState,
    /// What USER keeps for the calls of `user_calls`.
    pub user_calls: crate::user_calls::UserCalls,
    /// What KERNEL keeps for the calls of `kernel_calls`.
    pub kernel_calls: crate::kernel_calls::KernelCalls,
    /// What USER keeps for its controls: the clipboard and the owner-draw
    /// structures (`control_host.rs`).
    pub controls: crate::control_host::Controls,
    /// What USER keeps while a menu is open, and of the keys that open one
    /// (`menu_loop.rs`).
    pub menu_loop: crate::menu_loop::MenuLoopState,
    /// winbox.js's own sound card, as its driver keeps it (`wbsound`).
    pub sound_card: crate::wbsound::Card,
}

impl Default for System {
    fn default() -> Self {
        Self::new()
    }
}

impl System {
    /// A machine with the modules winbox.js keeps.
    #[allow(clippy::too_many_lines)]
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
            exit_code: None,
            instructions: 0,
            log: None,
            calls_until: None,
            call_marks: crate::call_marks::CallMarks::default(),
            message_time: None,
            heap_blocks: HashSet::new(),
            error_mode: 0,
            application_faults: Vec::new(),
            box_hand: None,
            modal_input: None,
            depth: 0,
            handles: Handles::new(),
            task_handle: 0,
            clock: Clock::virtual_at(INSTRUCTIONS_PER_MS),
            epoch_ms: days_from_civil(1992, 4, 6) * 86_400_000 + 9 * 3_600_000,
            transfer_area: (0, 0x80),
            searched: Vec::new(),
            unanswered_dos: Vec::new(),
            thunks: (0, crate::modules_kernel::THUNKS),
            clock_day: None,
            page_locks: HashMap::new(),
            handle_count: 20,
            profiles: HashMap::new(),
            resource_bases: HashMap::new(),
            handle_deltas: HashMap::new(),
            floating: crate::win87em::FloatingState::default(),
            display: crate::display::mode("vga").expect("the VGA"),
            swap_buttons: None,
            sys_colors: Vec::new(),
            sys_color_brushes: HashMap::new(),
            hook_message: 0,
            sys_modal: 0,
            window_dcs: HashMap::new(),
            wing_bitmaps: Vec::new(),
            gdi: crate::gdi::Gdi::default(),
            driver: None,
            classes: Vec::new(),
            class_atoms: HashMap::new(),
            proc_segment: None,
            proc_tokens: Vec::new(),
            menus: Vec::new(),
            windows: Vec::new(),
            z_order: Vec::new(),
            cascade_step: 0,
            user_windows_made: false,
            focus: None,
            icon_title_font: None,
            desktop_font: None,
            title_font: None,
            accelerators: Vec::new(),
            gdi_heap: crate::gdi::heap::Heap::new(),
            system_palette: None,
            palette_background: HashMap::new(),
            system_palette_use: None,
            gdi_data: None,
            capture: None,
            mouse_buttons: 0,
            caption_press: None,
            last_press: None,
            background_due: false,
            deferred: Vec::new(),
            notifications: Vec::new(),
            interrupt_handlers: Vec::new(),
            hooks: Vec::new(),
            next_hook: 0,
            owners: std::rc::Rc::new(Vec::new()),
            screen: None,
            pending_activation: None,
            dirty_marks: 0,
            message_serials: 0,
            last_move: None,
            dc_cache: Vec::new(),
            timers: Vec::new(),
            cursor_pos: None,
            cursor_clip: None,
            scheduler: crate::scheduler::Scheduler::default(),
            kept_files: HashMap::new(),
            icon_blocks: HashSet::new(),
            standard_icons: HashMap::new(),
            standard_cursors: HashMap::new(),
            cursors: Vec::new(),
            cursor: None,
            cursor_count: 0,
            host: None,
            registered_messages: HashMap::new(),
            loaded_resources: HashMap::new(),
            resource_blocks: HashMap::new(),
            atoms: crate::atoms::Atoms::default(),
            user_state: crate::user_misc::UserState::default(),
            fonts: None,
            draw_text_widest: 0,
            drivers: crate::drivers::Drivers::default(),
            mmsystem: crate::mmsystem::State::default(),
            interrupts: crate::interrupts::Interrupts::default(),
            shell: crate::shell::Shell::default(),
            comm: crate::comm::Comm::default(),
            comm_slots: crate::user_comm::Slots::default(),
            printing: crate::printer::Printing::default(),
            caret: crate::caret::CaretState::default(),
            user_calls: crate::user_calls::UserCalls::default(),
            kernel_calls: crate::kernel_calls::KernelCalls::default(),
            controls: crate::control_host::Controls::default(),
            menu_loop: crate::menu_loop::MenuLoopState::default(),
            sound_card: crate::wbsound::Card::default(),
        };

        for module in KEPT {
            system.keep(module);
        }

        // The desktop window's handle, USER's first window's (2004h).
        system
            .handles
            .allocate(crate::handles::Kind::Window, Object::Desktop);

        system
    }

    pub fn memory(&mut self) -> &mut Memory {
        &mut self.cpu.bus
    }

    /// The file whose resources a handle or instance names: the task's
    /// program's, a library's, or a kept module's, as the installation has
    /// it -- `USER.EXE`'s strings, as Windows reads them.
    pub fn executable_of(&mut self, handle: u16) -> Option<std::rc::Rc<winbox_ne::Executable>> {
        match self.handles.resolve(handle)? {
            Object::Task(program) => Some(self.modules[program].executable.clone()),
            Object::Library(module) => Some(self.modules[module].executable.clone()),
            Object::Kept(kept) => {
                if !self.kept_files.contains_key(&kept) {
                    let path = self.kept[kept].module.path;
                    let (folder, file) = path.rsplit_once('\\')?;
                    let read = self
                        .files
                        .read_from(folder, file)
                        .and_then(|(_, bytes)| winbox_ne::Executable::parse(bytes).ok())
                        .map(std::rc::Rc::new);

                    self.kept_files.insert(kept, read);
                }

                self.kept_files[&kept].clone()
            }
            _ => None,
        }
    }

    /// The file of the module a handle or instance names: a kept module's,
    /// a library's; for the task, nought or any other, the task's
    /// program's.
    pub fn path_of(&self, handle: u16) -> String {
        match self.handles.resolve(handle) {
            Some(Object::Kept(kept)) => self.kept[kept].module.path.to_string(),
            Some(Object::Library(module)) => self.modules[module].path.clone(),
            _ => self
                .task
                .as_ref()
                .map_or_else(String::new, |task| self.modules[task.program].path.clone()),
        }
    }

    /// A selector's descriptor as its table holds it now, as the
    /// processor's `retrieveDescriptor` reads one. `None` for the null
    /// selector, or one past its table's end.
    pub fn peek_descriptor(&self, selector: u16) -> Option<Descriptor> {
        if !self.cpu.protected || selector & 0xfffc == 0 {
            return None;
        }

        let (table, table_limit) = if selector & 4 == 0 {
            (GDT_BASE, self.cpu.gdt_limit)
        } else {
            (LDT_BASE, self.cpu.ldt_limit)
        };
        let entry = u32::from(selector >> 3) * 8;

        if entry + 7 > table_limit {
            return None;
        }

        let memory = &self.cpu.bus;
        let access = memory.read8(table + entry + 5);
        let granularity = memory.read8(table + entry + 6);
        let mut limit =
            u32::from(memory.read16(table + entry)) | u32::from(granularity & 0x0f) << 16;

        if granularity & 0x80 != 0 {
            limit = limit << 12 | 0xfff;
        }

        let present = access & 0x80 != 0;
        let grows_down = access & 0x1c == 0x14;
        let (low_limit, past_limit) = match (present, grows_down) {
            (false, _) => (1, 0),
            (true, true) => (
                u64::from(limit) + 1,
                if granularity & 0x40 != 0 {
                    0x1_0000_0000
                } else {
                    0x1_0000
                },
            ),
            (true, false) => (0, u64::from(limit) + 1),
        };

        Some(Descriptor {
            base: self.base_of(selector),
            limit,
            low_limit,
            past_limit,
            present,
            segment: access & 0x10 != 0,
            executable: access & 0x08 != 0,
            read_write: access & 0x02 != 0,
        })
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

        // GDI's data segment, its local heap, is where a program that goes
        // looking finds GDI's objects: its bytes are made as the program
        // reads them (`gdi/heap.rs`).
        if module.name == "GDI" {
            memory.set_host((data as u32) << 16, 0x10000);
            self.gdi_data = Some((data as u32) << 16);
        }

        let index = self.kept.len();

        // Its module's handle and its instance, each standing for it.
        self.handles
            .alias_at(segment_selector(database), Object::Kept(index));
        self.handles.alias_at(
            segment_selector(data) - u16::from(!module.fixed),
            Object::Kept(index),
        );
        self.kept.push(KeptModule {
            module,
            database,
            data,
            stubs: None,
        });
    }

    /// A module winbox.js keeps only once it is loaded, as a driver's file
    /// is loaded only once `SYSTEM.INI` names it, kept now if it was not:
    /// its place among the kept modules. One kept as Windows starts takes
    /// its selectors then; this one, as it loads.
    pub(crate) fn keep_on_load(&mut self, module: &'static Kept) -> usize {
        if let Some(kept) = self.kept_named(module.name) {
            return kept;
        }

        self.keep(module);
        self.kept.len() - 1
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
