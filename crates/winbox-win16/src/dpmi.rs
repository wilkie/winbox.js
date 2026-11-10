//! The DPMI host a Windows program finds behind INT 31h: standard mode's
//! DOSX.EXE, or 386 enhanced mode's WIN386 (`kb/topics/dpmi-functions.md`,
//! `kb/guides/enhanced-mode.md`). Each function is answered as the
//! machine's mode's host answers it. The read-out: DOSX's table at 2A80h of
//! its protected-mode segment (image 6342h), its handlers answering with
//! the carry clear (2B92h), set with AX as it was (2B8Ch), or set with AX
//! nought (2B87h); WIN386's answers as the probes recorded them
//! (`enhmode`, `dpmildt`, `dpmimem`, `dpmirm`, `dpmiexc`, `dpmigrw`,
//! `dpminul`, `dpmiout`), a refusal leaving AX as it was.

use std::collections::{HashMap, HashSet};

use winbox_cpu::{AX, BP, BX, CS, CX, DI, DS, DX, ES, FS, GS, SI, SP, SS};
use winbox_machine::{FIRST_MEGABYTE, FIRST_MEGABYTE_SELECTORS};

use crate::Mode;
use crate::call::Stop;
use crate::run::Event;
use crate::system::System;

/// 0400h's answers: DOSX's version 0.90 and flags (`DOSX.EXE` 2FC1h), and
/// WIN386's flags. **Recorded** by `dpmiver` in each mode.
pub const DPMI_VERSION: u16 = 0x005a;
pub const DPMI_FLAGS: u16 = 0x000a;
pub const DPMI_FLAGS_ENHANCED: u16 = 0x0005;
/// The processor 0400h names in CL, an i486; the interrupt controllers'
/// bases in DH and DL.
pub const DPMI_PROCESSOR: u16 = 4;
pub const DPMI_PIC_BASES: u16 = 0x0870;

/// The last byte DOSX's local table reaches (2CA2h-2CB1h; `dpmildt`).
pub const DOSX_TABLE_LIMIT: u16 = 0xffef;
/// WIN386's, as `dpmildt` found it in enhanced mode.
pub const WIN386_TABLE_LIMIT: u16 = 0x186f;

/// DOSX's segment in conventional memory, where its real-mode code and
/// callbacks are (0303h's CX, `dpmirm`): the host's own code and stacks
/// are kept there.
pub const HOST_SEGMENT: u16 = 0x0a09;
const HOST_LINEAR: u32 = FIRST_MEGABYTE + (HOST_SEGMENT as u32) * 16;

/// The global table's descriptors of the host's code, its stack, and the
/// real-mode segments of a call into real mode.
const HOST_CODE_INDEX: u16 = 0x1c;
const HOST_STACK_INDEX: u16 = 0x1d;
const SCRATCH_INDICES: [u16; 4] = [0x10, 0x11, 0x12, 0x13];

/// Where in the host's code each stub is.
const EXCEPTION_DEFAULTS: u16 = 0x1133;
const EXCEPTION_RETURN: u16 = 0x140c;
const VECTOR_DEFAULTS: u16 = 0x2000;
const CALLBACK_RETURN: u16 = 0x2ee3;
const REAL_CALL: u16 = 0x3100;
const STATE_SAVE: u16 = 0x3200;
const RAW_SWITCH: u16 = 0x3204;

const HOST_STACK_OFFSET: u32 = 0x4000;
const HOST_STACK_TOP: u16 = 0x2000;
const REAL_STACK_TOP: u16 = 0x7000;
const REAL_RETURN: u16 = 0x0e40;

/// DOSX's sixteen callbacks from 0E70h, three bytes apart, the first taken
/// (`dpmirm`); WIN386's in segment `FF06h` from `0AB7h` down by 10h.
const DOSX_CALLBACKS: u16 = 16;
const DOSX_CALLBACK_FIRST: u16 = 0x0e70;
const DOSX_CALLBACKS_TAKEN: u16 = 1;
const WIN386_CALLBACK_SEGMENT: u16 = 0xff06;
const WIN386_CALLBACK_FIRST: u16 = 0x0ab7;

/// 0500h's figures as `enhmode` found them.
const FREE_LARGEST: u32 = 0x00e3_47e0;
const FREE_PAGES: u32 = 0xe34;
const FREE_ENHANCED: [u32; 12] = [
    0x0386_8000,
    0x3868,
    0x0e7f,
    0x39fc,
    0x0e86,
    0x0d80,
    0x0f6d,
    0x3869,
    0x39fc,
    0xffff_ffff,
    0xffff_ffff,
    0xffff_ffff,
];

/// What DOSX writes as Windows ends at a fault in its own code.
pub const DOSX_FAULT: &str = "Standard Mode: Fault in MS-DOS Extender.";

/// The interrupts WinBox's DOS and BIOS answer, which 0300h can reach.
const ANSWERED: [u8; 4] = [0x12, 0x1a, 0x21, 0x2f];

const INTERRUPT: u16 = 0x0200;
const TRAP: u16 = 0x0100;

/// The machine's registers, as a call into real mode returns to them.
#[derive(Debug, Clone, Copy, Default)]
struct Context {
    regs: [u16; 8],
    high: [u16; 8],
    flags: u16,
    /// EIP whole.
    ip: u32,
    selectors: [u16; 6],
}

#[derive(Debug, Clone, Copy)]
struct RealCall {
    caller: Context,
    structure: u32,
    stack_index: Option<usize>,
    segments: [u16; 4],
}

#[derive(Debug, Clone, Copy)]
struct Callback {
    procedure: (u16, u16),
    structure: (u16, u16),
}

#[derive(Debug, Clone, Copy)]
struct Block {
    index: usize,
    count: usize,
    size: u32,
    base: u32,
}

/// The real-mode call structure's fields.
#[derive(Debug, Clone, Copy, Default)]
struct Structure {
    edi: u32,
    esi: u32,
    ebp: u32,
    ebx: u32,
    edx: u32,
    ecx: u32,
    eax: u32,
    flags: u16,
    es: u16,
    ds: u16,
    fs: u16,
    gs: u16,
    ip: u16,
    cs: u16,
    sp: u16,
    ss: u16,
}

/// The host's state.
#[derive(Debug, Default)]
pub struct Host {
    exceptions: HashMap<u8, (u16, u16)>,
    vectors: HashMap<u8, (u16, u16)>,
    callbacks: HashMap<u16, Callback>,
    freed_callbacks: Vec<u16>,
    next_callback: Option<u16>,
    blocks: HashMap<u32, Block>,
    watchpoints: [Option<u32>; 4],
    own: HashSet<usize>,
    released: HashSet<usize>,
    calls: Vec<RealCall>,
    stack_tops: Vec<u16>,
    ready: bool,
    answered_vectors: HashMap<u8, u32>,
    /// What ended Windows, where the host did.
    pub fault: Option<String>,
}

impl Host {
    /// Whether the host takes a vector from the processor: a program's
    /// handler is set for it.
    pub fn claims(&self, vector: u8) -> bool {
        self.vectors.contains_key(&vector)
            || (vector < 0x20 && self.exceptions.contains_key(&vector))
    }

    /// Whether a program's exception handler is set for a fault.
    pub fn handles_exception(&self, vector: u8) -> bool {
        vector < 0x20 && self.exceptions.contains_key(&vector)
    }
}

fn first_megabyte_index(index: usize) -> bool {
    FIRST_MEGABYTE_SELECTORS
        .iter()
        .any(|&(_, each)| each == index)
}

impl System {
    fn dpmi_enhanced(&self) -> bool {
        self.mode == Mode::Enhanced
    }

    fn dpmi_host_code(&self) -> u16 {
        (HOST_CODE_INDEX << 3) | if self.dpmi_enhanced() { 3 } else { 0 }
    }

    fn dpmi_host_stack() -> u16 {
        (HOST_STACK_INDEX << 3) | 3
    }

    /// Whether a selector is the host's code's.
    pub(crate) fn is_host_code(selector: u16) -> bool {
        selector & 0xfff8 == HOST_CODE_INDEX << 3
    }

    /// Whether the `INT` at CS:IP is the host's call into real mode for
    /// 0300h, which DOS answers alone; the host's vectors' own stubs go to
    /// WinBox's answer as a program's `INT` does.
    pub(crate) fn at_real_call(&self) -> bool {
        Self::is_host_code(self.cpu.segments[CS].selector)
            && (u32::from(REAL_CALL)..u32::from(REAL_CALL) + 0x100).contains(&self.cpu.ip)
    }

    fn dpmi_reg32(&self, index: usize) -> u32 {
        u32::from(self.cpu.high[index]) << 16 | u32::from(self.cpu.regs[index])
    }

    fn dpmi_set_reg32(&mut self, index: usize, value: u32) {
        self.cpu.regs[index] = value as u16;
        self.cpu.high[index] = (value >> 16) as u16;
    }

    fn dpmi_low8(&self, index: usize) -> u8 {
        self.cpu.regs[index] as u8
    }

    fn dpmi_high8(&self, index: usize) -> u8 {
        (self.cpu.regs[index] >> 8) as u8
    }

    fn dpmi_context(&self) -> Context {
        Context {
            regs: self.cpu.regs,
            high: self.cpu.high,
            flags: self.cpu.flags,
            ip: self.cpu.ip,
            selectors: std::array::from_fn(|index| self.cpu.segments[index].selector),
        }
    }

    fn dpmi_load(&mut self, index: usize, selector: u16) {
        let _ = self.cpu.load_segment(index, selector);
    }

    fn dpmi_restore(&mut self, context: &Context) {
        self.cpu.regs = context.regs;
        self.cpu.high = context.high;
        self.cpu.flags = context.flags;

        for index in [DS, ES, FS, GS, SS, CS] {
            self.dpmi_load(index, context.selectors[index]);
        }

        self.cpu.ip = context.ip;
    }

    fn dpmi_push16(&mut self, value: u16) {
        let sp = self.cpu.regs[SP].wrapping_sub(2);
        let at = self.cpu.segments[SS].base.wrapping_add(u32::from(sp));

        self.cpu.bus.write16(at, value);
        self.cpu.regs[SP] = sp;
    }

    fn dpmi_pop16(&mut self) -> u16 {
        let sp = self.cpu.regs[SP];
        let value = self
            .cpu
            .bus
            .read16(self.cpu.segments[SS].base.wrapping_add(u32::from(sp)));

        self.cpu.regs[SP] = sp.wrapping_add(2);
        value
    }

    fn dpmi_linear(&self, segment: usize, offset: u16) -> u32 {
        self.cpu.segments[segment]
            .base
            .wrapping_add(u32::from(offset))
    }

    /// The linear address a selector and offset name, from the selector's
    /// descriptor.
    fn dpmi_address_of(&self, selector: u16, offset: u16) -> u32 {
        let (table, _) = if selector & 4 != 0 {
            (self.cpu.ldt_base, self.cpu.ldt_limit)
        } else {
            (self.cpu.gdt_base, self.cpu.gdt_limit)
        };
        let at = table.wrapping_add(u32::from(selector >> 3) * 8);
        let bytes = self.cpu.bus.read(at, 8);
        let base = u32::from(bytes[2])
            | u32::from(bytes[3]) << 8
            | u32::from(bytes[4]) << 16
            | u32::from(bytes[7]) << 24;

        base.wrapping_add(u32::from(offset))
    }

    fn dpmi_describe(&mut self, at: u32, base: u32, limit: u32, access: u8) {
        let [b0, b1, b2, b3] = base.to_le_bytes();

        self.cpu.bus.write(
            at,
            &[
                limit as u8,
                (limit >> 8) as u8,
                b0,
                b1,
                b2,
                access,
                ((limit >> 16) & 0x0f) as u8,
                b3,
            ],
        );
    }

    fn dpmi_global(&mut self, index: u16, base: u32, limit: u32, access: u8) {
        let at = self.cpu.gdt_base + u32::from(index) * 8;

        self.dpmi_describe(at, base, limit, access);
    }

    /// The host's code and stack, made as a program first needs them.
    fn dpmi_host(&mut self) {
        if self.dpmi.ready {
            return;
        }

        self.dpmi.ready = true;
        self.dpmi_global(HOST_CODE_INDEX, HOST_LINEAR, 0xffff, 0xfb);
        self.dpmi_global(
            HOST_STACK_INDEX,
            HOST_LINEAR + HOST_STACK_OFFSET,
            u32::from(HOST_STACK_TOP) - 1,
            0xf3,
        );

        let code = |system: &mut Self, offset: u16, bytes: &[u8]| {
            system.cpu.bus.write(HOST_LINEAR + u32::from(offset), bytes);
        };

        for number in 0..0x20u16 {
            code(self, EXCEPTION_DEFAULTS + 3 * number, &[0xcd, 0x31, 0x90]);
        }

        for vector in 0..=0xffu8 {
            code(
                self,
                VECTOR_DEFAULTS + 4 * u16::from(vector),
                &[0xcd, vector, 0xcf, 0x90],
            );
        }

        code(self, EXCEPTION_RETURN, &[0xcd, 0x31]);
        code(self, CALLBACK_RETURN, &[0xcd, 0x31]);
        code(self, STATE_SAVE, &[0xcb]);
        code(self, RAW_SWITCH, &[0xcd, 0x31]);

        for vector in ANSWERED {
            let value = self.cpu.bus.read32(FIRST_MEGABYTE + u32::from(vector) * 4);

            self.dpmi.answered_vectors.insert(vector, value);
        }
    }

    // --- the descriptors ---

    fn dpmi_entry(&self, selector: u16) -> u32 {
        self.cpu.ldt_base + u32::from(selector >> 3) * 8
    }

    fn dpmi_read_descriptor(&self, selector: u16) -> [u8; 8] {
        let bytes = self.cpu.bus.read(self.dpmi_entry(selector), 8);

        std::array::from_fn(|at| bytes[at])
    }

    /// A descriptor's bytes written, and taken at once by any segment
    /// register holding it, so the processor forgets
    /// what it kept of it.
    fn dpmi_write_descriptor(&mut self, selector: u16, bytes: [u8; 8]) {
        let at = self.dpmi_entry(selector);

        self.cpu.bus.write(at, &bytes);
        self.dpmi_refresh(selector);
    }

    fn dpmi_refresh(&mut self, selector: u16) {
        for index in 0..6 {
            let held = self.cpu.segments[index].selector;

            if held & !7 == selector & !7 && held & 4 != 0 {
                let _ = self.cpu.load_segment(index, held);
            }
        }
    }

    fn dpmi_given(&mut self, index: usize) {
        self.descriptors.claim(index, true);
        self.dpmi.released.remove(&index);
    }

    fn dpmi_fresh(&mut self, index: usize) {
        self.dpmi_given(index);
        self.dpmi_write_descriptor(((index as u16) << 3) | 7, [0, 0, 0, 0, 0, 0xf2, 0, 0]);
    }

    /// Whether WIN386 answers for a selector.
    fn dpmi_valid(&self, selector: u16) -> bool {
        let index = usize::from(selector >> 3);

        selector & 4 != 0
            && index > 0
            && !self.dpmi.released.contains(&index)
            && (u32::from(selector & 0xfff8) + 7 <= u32::from(WIN386_TABLE_LIMIT)
                || first_megabyte_index(index))
    }

    // --- answering ---

    fn dpmi_ok(&mut self) -> Option<Event> {
        self.cpu.flags &= !1;
        None
    }

    fn dpmi_refuse(&mut self, ax: Option<u16>) -> Option<Event> {
        if let Some(ax) = ax {
            self.cpu.regs[AX] = ax;
        }

        self.cpu.flags |= 1;
        None
    }

    /// Windows ends: DOSX faults in its own code.
    fn dpmi_host_fault(&mut self, why: &str) -> Event {
        self.dpmi.fault = Some(format!("{DOSX_FAULT} ({why})"));
        self.ended = true;
        Event::Stop(Stop::Ended)
    }

    /// INT 31h, its instruction run (IP after it), or a stub of the host's
    /// reached: an event where the run stops.
    pub(crate) fn dpmi_interrupt(&mut self) -> Option<Event> {
        if Self::is_host_code(self.cpu.segments[CS].selector) {
            // The host's code is 16-bit: IP is EIP's low word.
            return self.dpmi_host_returned((self.cpu.ip as u16).wrapping_sub(2));
        }

        let function = self.cpu.regs[AX];

        if function == 0x0400 {
            self.cpu.regs[AX] = DPMI_VERSION;
            self.cpu.regs[BX] = if self.dpmi_enhanced() {
                DPMI_FLAGS_ENHANCED
            } else {
                DPMI_FLAGS
            };
            self.cpu.regs[CX] = self.cpu.regs[CX] & 0xff00 | DPMI_PROCESSOR;
            self.cpu.regs[DX] = DPMI_PIC_BASES;
            return self.dpmi_ok();
        }

        if self.dpmi_enhanced() {
            self.dpmi_win386(function)
        } else {
            self.dpmi_dosx(function)
        }
    }

    /// DOSX's table (`DOSX.EXE` 2A80h).
    fn dpmi_dosx(&mut self, function: u16) -> Option<Event> {
        let bx = self.cpu.regs[BX];

        match function {
            0x0000 => self.dpmi_allocate(self.cpu.regs[CX]),
            0x0001 => self.dpmi_free_descriptor(bx),
            0x0002 => self.dpmi_segment(bx),
            0x0003 => {
                self.cpu.regs[AX] = 8;
                self.dpmi_ok()
            }
            0x0006 => self.dpmi_get_base(bx),
            0x0007 => self.dpmi_set_base(bx),
            0x0008 => self.dpmi_set_limit(bx),
            0x0009 => self.dpmi_set_rights(bx),
            0x000a => self.dpmi_alias(bx),
            0x000b | 0x000c => self.dpmi_descriptor(function, bx),
            0x000d => self.dpmi_specific(bx),
            0x0101 => {
                if self.cpu.regs[DX] == 0 {
                    Some(self.dpmi_host_fault("0101h of nought"))
                } else {
                    self.dpmi_refuse(None)
                }
            }
            0x0100 | 0x0102 => {
                self.cpu.regs[BX] = 0;
                self.dpmi_refuse(Some(8))
            }
            0x0200 | 0x0201 => self.dpmi_real_vector(self.dpmi_low8(AX) == 0, self.dpmi_low8(BX)),
            0x0202 | 0x0203 => {
                self.dpmi_set_exception(function == 0x0202, self.dpmi_low8(BX), 0x10)
            }
            0x0204 | 0x0205 => self.dpmi_set_vector(function == 0x0204, self.dpmi_low8(BX)),
            0x0300..=0x0302 => self.dpmi_real_call(function),
            0x0303 => self.dpmi_allocate_callback(),
            0x0304 => self.dpmi_free_callback(self.cpu.regs[CX], self.cpu.regs[DX]),
            0x0305 | 0x0306 | 0x0700 | 0x0701 | 0x0a00 => self.dpmi_refuse(Some(0)),
            0x0500 => self.dpmi_free_information(),
            0x0501 => self.dpmi_allocate_block(),
            0x0502 => self.dpmi_free_block(),
            0x0503 => self.dpmi_resize_block(),
            0x0004 | 0x0005 | 0x0600..=0x0603 | 0x0702 | 0x0703 | 0x0800 => self.dpmi_ok(),
            0x0604 => {
                self.cpu.regs[BX] = 0;
                self.cpu.regs[CX] = 0x1000;
                self.dpmi_ok()
            }
            0x0900..=0x0902 => self.dpmi_interrupt_state(),
            0x0b00..=0x0b03 => self.dpmi_watchpoint(function),
            _ => Some(self.dpmi_host_fault(&format!("function {function:04x}h"))),
        }
    }

    /// WIN386's answers, as recorded.
    fn dpmi_win386(&mut self, function: u16) -> Option<Event> {
        let bx = self.cpu.regs[BX];

        match function {
            0x0000 => self.dpmi_allocate(self.cpu.regs[CX]),
            0x0001 => self.dpmi_free_descriptor(bx),
            0x0002 => self.dpmi_segment(bx),
            0x0003 => {
                self.cpu.regs[AX] = 8;
                self.dpmi_ok()
            }
            0x0006 if self.dpmi_valid(bx) => self.dpmi_get_base(bx),
            0x0007 if self.dpmi_valid(bx) => self.dpmi_set_base(bx),
            0x0008 => {
                let limit = u32::from(self.cpu.regs[CX]) << 16 | u32::from(self.cpu.regs[DX]);

                if !self.dpmi_valid(bx) || (limit > 0xfffff && limit & 0xfff != 0xfff) {
                    self.dpmi_refuse(None)
                } else {
                    self.dpmi_set_limit(bx)
                }
            }
            0x0009 => {
                if self.dpmi_valid(bx) && fit_rights(self.dpmi_low8(CX)) {
                    self.dpmi_set_rights(bx)
                } else {
                    self.dpmi_refuse(None)
                }
            }
            0x000a if self.dpmi_valid(bx) => self.dpmi_alias(bx),
            0x000b | 0x000c => self.dpmi_descriptor(function, bx),
            0x000d => self.dpmi_specific(bx),
            0x0100 => {
                self.cpu.regs[BX] = 0;
                self.dpmi_refuse(Some(8))
            }
            0x0102 => self.dpmi_refuse(Some(7)),
            0x0200 | 0x0201 => self.dpmi_real_vector(self.dpmi_low8(AX) == 0, self.dpmi_low8(BX)),
            0x0202 | 0x0203 => {
                self.dpmi_set_exception(function == 0x0202, self.dpmi_low8(BX), 0x1f)
            }
            0x0204 | 0x0205 => self.dpmi_set_vector(function == 0x0204, self.dpmi_low8(BX)),
            0x0300..=0x0302 => self.dpmi_real_call(function),
            0x0303 => self.dpmi_allocate_callback(),
            0x0304 => self.dpmi_free_callback(self.cpu.regs[CX], self.cpu.regs[DX]),
            0x0305 => {
                self.dpmi_host();
                self.cpu.regs[AX] = 0x24;
                self.cpu.regs[BX] = HOST_SEGMENT;
                self.cpu.regs[CX] = STATE_SAVE;
                self.cpu.regs[SI] = self.dpmi_host_code();
                self.cpu.regs[DI] = STATE_SAVE;
                self.dpmi_ok()
            }
            0x0306 => {
                self.dpmi_host();
                self.cpu.regs[BX] = HOST_SEGMENT;
                self.cpu.regs[CX] = RAW_SWITCH;
                self.cpu.regs[SI] = self.dpmi_host_code();
                self.cpu.regs[DI] = RAW_SWITCH;
                self.dpmi_ok()
            }
            0x0500 => self.dpmi_free_information(),
            0x0501 => self.dpmi_allocate_block(),
            0x0502 => self.dpmi_free_block(),
            0x0503 => self.dpmi_resize_block(),
            0x0004 | 0x0005 | 0x0600..=0x0603 | 0x0702 | 0x0703 | 0x0e00 | 0x0e01 => self.dpmi_ok(),
            0x0604 => {
                self.cpu.regs[BX] = 0;
                self.cpu.regs[CX] = 0x1000;
                self.dpmi_ok()
            }
            0x0800 => {
                let address = u32::from(self.cpu.regs[BX]) << 16 | u32::from(self.cpu.regs[CX]);

                if address < 0x10_0000 {
                    self.dpmi_refuse(None)
                } else {
                    self.dpmi_ok()
                }
            }
            0x0900..=0x0902 => self.dpmi_interrupt_state(),
            0x0b00..=0x0b03 => self.dpmi_watchpoint(function),
            _ => self.dpmi_refuse(None),
        }
    }

    // --- 0000h-000Dh ---

    /// 0000h, allocate descriptors.
    fn dpmi_allocate(&mut self, count: u16) -> Option<Event> {
        let count = usize::from(count.max(1));
        let index = if count == 1 {
            self.descriptors.take(1)
        } else {
            self.descriptors.find(1, count)
        };
        let Some(index) = index else {
            return self.dpmi_refuse(Some(0));
        };

        for at in index..index + count {
            self.dpmi_fresh(at);
        }

        self.cpu.regs[AX] = ((index as u16) << 3) | 7;
        self.dpmi_ok()
    }

    /// 0001h (as `#freeDescriptor`).
    fn dpmi_free_descriptor(&mut self, selector: u16) -> Option<Event> {
        let index = usize::from(selector >> 3);

        if selector & 4 == 0 || index == 0 {
            return self.dpmi_refuse(None);
        }

        if self.dpmi_enhanced() && self.dpmi.released.contains(&index) {
            return self.dpmi_ok();
        }

        if !self.descriptors.used(index) {
            return self.dpmi_refuse(None);
        }

        if !self.dpmi_enhanced() && self.dpmi.own.contains(&index) {
            let at = self.dpmi_entry(selector);

            self.cpu.bus.write16(at + 5, 0);
            self.dpmi_refresh(selector);
            self.descriptors.claim(index, false);
            self.dpmi.own.remove(&index);
            return self.dpmi_refuse(None);
        }

        self.dpmi.own.remove(&index);
        self.descriptors.give(&mut self.cpu.bus, index);
        self.dpmi_refresh(selector);
        self.dpmi.released.insert(index);

        if !self.dpmi_enhanced() {
            for register in [DS, ES] {
                if self.cpu.segments[register].selector & 0xfffc == selector & 0xfffc {
                    self.dpmi_load(register, 0);
                }
            }
        }

        self.dpmi_ok()
    }

    /// 0002h (as `#segment`).
    fn dpmi_segment(&mut self, paragraph: u16) -> Option<Event> {
        let base = FIRST_MEGABYTE.wrapping_add(u32::from(paragraph) * 16);
        let mut candidates: Vec<usize> = FIRST_MEGABYTE_SELECTORS
            .iter()
            .map(|&(_, index)| index)
            .collect();

        candidates.extend(self.dpmi.own.iter().copied());

        for index in candidates {
            let bytes = self.dpmi_read_descriptor((index as u16) << 3);
            let at = u32::from_le_bytes([bytes[2], bytes[3], bytes[4], bytes[7]]);

            if self.descriptors.used(index)
                && at == base
                && bytes[0] == 0xff
                && bytes[1] == 0xff
                && (bytes[5] ^ 0xf2) & 0xfe == 0
            {
                self.cpu.regs[AX] = ((index as u16) << 3) | 7;
                return self.dpmi_ok();
            }
        }

        let Some(index) = self.descriptors.take(1) else {
            return self.dpmi_refuse(None);
        };
        let [b0, b1, b2, b3] = base.to_le_bytes();

        self.dpmi_given(index);
        self.dpmi.own.insert(index);
        self.dpmi_write_descriptor(
            ((index as u16) << 3) | 7,
            [0xff, 0xff, b0, b1, b2, 0xf2, 0, b3],
        );
        self.cpu.regs[AX] = ((index as u16) << 3) | 7;
        self.dpmi_ok()
    }

    fn dpmi_get_base(&mut self, selector: u16) -> Option<Event> {
        let bytes = self.dpmi_read_descriptor(selector);

        self.cpu.regs[CX] = u16::from(bytes[4]) | u16::from(bytes[7]) << 8;
        self.cpu.regs[DX] = u16::from(bytes[2]) | u16::from(bytes[3]) << 8;
        self.dpmi_ok()
    }

    fn dpmi_set_base(&mut self, selector: u16) -> Option<Event> {
        let at = self.dpmi_entry(selector);
        let (cx, dx) = (self.cpu.regs[CX], self.cpu.regs[DX]);

        self.cpu.bus.write16(at + 2, dx);
        self.cpu.bus.write8(at + 4, cx as u8);
        self.cpu.bus.write8(at + 7, (cx >> 8) as u8);
        self.dpmi_refresh(selector);
        self.dpmi_ok()
    }

    fn dpmi_set_limit(&mut self, selector: u16) -> Option<Event> {
        let at = self.dpmi_entry(selector);
        let (mut cx, mut dx) = (self.cpu.regs[CX], self.cpu.regs[DX]);
        let mut flags = self.cpu.bus.read8(at + 6) & 0x70;

        if cx & 0xfff0 != 0 {
            dx = (dx >> 12) | (cx << 4);
            cx >>= 12;
            flags |= 0x80;
        }

        self.cpu.bus.write16(at, dx);
        self.cpu.bus.write8(at + 6, flags | (cx & 0x0f) as u8);
        self.dpmi_refresh(selector);
        self.dpmi_ok()
    }

    fn dpmi_set_rights(&mut self, selector: u16) -> Option<Event> {
        let at = self.dpmi_entry(selector);
        let (cl, ch) = (self.dpmi_low8(CX), self.dpmi_high8(CX));
        let flags = self.cpu.bus.read8(at + 6);

        self.cpu.bus.write8(at + 5, cl);
        self.cpu.bus.write8(at + 6, (flags & 0x0f) | (ch & 0xf0));
        self.dpmi_refresh(selector);
        self.dpmi_ok()
    }

    /// Whether `VERR` passes a selector at privilege 3 (as `#readable`).
    fn dpmi_readable(&self, selector: u16) -> bool {
        let index = u32::from(selector >> 3);

        if selector & 0xfffc == 0 || selector & 4 == 0 || index * 8 + 7 > self.cpu.ldt_limit {
            return false;
        }

        let access = self.dpmi_read_descriptor(selector)[5];

        if access & 0x10 == 0 || access & 0x0a == 0x08 {
            return false;
        }

        access & 0x0c == 0x0c || (access >> 5) & 3 == 3
    }

    fn dpmi_alias(&mut self, selector: u16) -> Option<Event> {
        if (!self.dpmi_enhanced() && !self.dpmi_readable(selector)) || selector & 0xfffc == 0 {
            return self.dpmi_refuse(None);
        }

        let Some(index) = self.descriptors.take(1) else {
            return self.dpmi_refuse(None);
        };
        let mut bytes = self.dpmi_read_descriptor(selector);

        bytes[5] = (bytes[5] & 0xe0) | 0x12;
        self.dpmi_given(index);
        self.dpmi_write_descriptor(((index as u16) << 3) | 7, bytes);
        self.cpu.regs[AX] = ((index as u16) << 3) | 7;
        self.dpmi_ok()
    }

    fn dpmi_descriptor(&mut self, function: u16, selector: u16) -> Option<Event> {
        let refused = if self.dpmi_enhanced() {
            !self.dpmi_valid(selector)
        } else {
            selector & 0xfff8 >= DOSX_TABLE_LIMIT
        };

        if refused {
            return self.dpmi_refuse(None);
        }

        let address = self.dpmi_linear(ES, self.cpu.regs[DI]);

        if function == 0x000b {
            let bytes = self.dpmi_read_descriptor(selector);

            self.cpu.bus.write(address, &bytes);
            return self.dpmi_ok();
        }

        let read = self.cpu.bus.read(address, 8);
        let bytes: [u8; 8] = std::array::from_fn(|at| read[at]);

        if self.dpmi_enhanced() && !fit_rights(bytes[5]) {
            return self.dpmi_refuse(None);
        }

        self.dpmi_write_descriptor(selector, bytes);
        self.dpmi_ok()
    }

    fn dpmi_specific(&mut self, selector: u16) -> Option<Event> {
        let index = usize::from(selector >> 3);

        if selector & 4 == 0 || index == 0 || index > 0x0f || self.descriptors.used(index) {
            return self.dpmi_refuse(None);
        }

        if self.dpmi_enhanced() {
            self.dpmi_fresh(index);
            return self.dpmi_ok();
        }

        self.dpmi_given(index);
        self.dpmi.own.insert(index);

        let at = self.dpmi_entry(selector);

        self.cpu.bus.write8(at + 5, 0x0f);
        self.dpmi_refresh(selector);
        self.dpmi_ok()
    }

    // --- 0200h-0205h ---

    fn dpmi_real_vector(&mut self, get: bool, vector: u8) -> Option<Event> {
        self.dpmi_host();

        let number = if !self.dpmi_enhanced() && (0x50..=0x57).contains(&vector) {
            vector - 0x48
        } else {
            vector
        };
        let at = FIRST_MEGABYTE + u32::from(number) * 4;

        if get {
            self.cpu.regs[DX] = self.cpu.bus.read16(at);
            self.cpu.regs[CX] = self.cpu.bus.read16(at + 2);
        } else {
            self.cpu.bus.write16(at, self.cpu.regs[DX]);
            self.cpu.bus.write16(at + 2, self.cpu.regs[CX]);
        }

        self.dpmi_ok()
    }

    fn dpmi_exception_handler(&self, number: u8) -> (u16, u16) {
        self.dpmi.exceptions.get(&number).copied().unwrap_or((
            self.dpmi_host_code(),
            EXCEPTION_DEFAULTS + 3 * u16::from(number),
        ))
    }

    fn dpmi_vector_handler(&self, vector: u8) -> (u16, u16) {
        self.dpmi.vectors.get(&vector).copied().unwrap_or((
            self.dpmi_host_code(),
            VECTOR_DEFAULTS + 4 * u16::from(vector),
        ))
    }

    fn dpmi_set_exception(&mut self, get: bool, number: u8, most: u8) -> Option<Event> {
        if number > most {
            return self.dpmi_refuse(None);
        }

        self.dpmi_host();

        let (cx, dx) = (self.cpu.regs[CX], self.cpu.regs[DX]);

        if get {
            (self.cpu.regs[CX], self.cpu.regs[DX]) = self.dpmi_exception_handler(number);
        } else if Self::is_host_code(cx) && dx == EXCEPTION_DEFAULTS + 3 * u16::from(number) {
            self.dpmi.exceptions.remove(&number);
        } else {
            self.dpmi.exceptions.insert(number, (cx, dx));
        }

        self.dpmi_ok()
    }

    fn dpmi_set_vector(&mut self, get: bool, vector: u8) -> Option<Event> {
        self.dpmi_host();

        let (cx, dx) = (self.cpu.regs[CX], self.cpu.regs[DX]);

        if get {
            (self.cpu.regs[CX], self.cpu.regs[DX]) = self.dpmi_vector_handler(vector);
        } else if Self::is_host_code(cx) && dx == VECTOR_DEFAULTS + 4 * u16::from(vector) {
            self.dpmi.vectors.remove(&vector);
        } else {
            self.dpmi.vectors.insert(vector, (cx, dx));
        }

        self.dpmi_ok()
    }

    /// An `INT` a program's handler is set for, its instruction run (IP
    /// after it): the handler called as the processor calls one. True where
    /// it was. The frame is of words, a 16-bit client's, as every client
    /// here is; IP is EIP's low word ([[topic:win386]], "Not yet done").
    pub(crate) fn dpmi_vector(&mut self, vector: u8) -> bool {
        let Some(&(cs, ip)) = self.dpmi.vectors.get(&vector) else {
            return false;
        };

        if Self::is_host_code(self.cpu.segments[CS].selector) {
            return false;
        }

        let (flags, from_cs, from_ip) =
            (self.cpu.flags, self.cpu.segments[CS].selector, self.cpu.ip);

        self.dpmi_push16(flags);
        self.dpmi_push16(from_cs);
        self.dpmi_push16(from_ip as u16);
        self.dpmi_load(CS, cs);
        self.cpu.ip = u32::from(ip);
        true
    }

    /// A fault given to the program's handler for it (as `#raise`), from
    /// the instruction that faulted, at CS:IP. The frame is of words, a
    /// 16-bit client's: IP is EIP's low word.
    pub(crate) fn dpmi_exception(&mut self, number: u8, code: u16) {
        self.dpmi_host();

        let top = self
            .dpmi
            .stack_tops
            .last()
            .copied()
            .unwrap_or(HOST_STACK_TOP);
        let frame = [
            self.cpu.segments[SS].selector,
            self.cpu.regs[SP],
            self.cpu.flags,
            self.cpu.segments[CS].selector,
            self.cpu.ip as u16,
            code,
            self.dpmi_host_code(),
            EXCEPTION_RETURN,
        ];
        let (cs, ip) = self.dpmi.exceptions[&number];

        self.dpmi_load(SS, Self::dpmi_host_stack());
        self.cpu.regs[SP] = top;

        for word in frame {
            self.dpmi_push16(word);
        }

        self.dpmi.stack_tops.push(self.cpu.regs[SP]);
        self.dpmi_load(CS, cs);
        self.cpu.ip = u32::from(ip);
    }

    // --- the host's stubs ---

    fn dpmi_host_returned(&mut self, at: u16) -> Option<Event> {
        if at == EXCEPTION_RETURN {
            let frame: [u16; 6] = std::array::from_fn(|_| 0);
            let frame = frame.map(|_| self.dpmi_pop16());

            self.dpmi.stack_tops.pop();
            self.cpu.flags = frame[3];
            self.dpmi_load(SS, frame[5]);
            self.cpu.regs[SP] = frame[4];
            self.dpmi_load(CS, frame[2]);
            self.cpu.ip = u32::from(frame[1]);
            return None;
        }

        if (EXCEPTION_DEFAULTS..EXCEPTION_DEFAULTS + 3 * 0x20).contains(&at) {
            return Some(self.dpmi_passed_on(((at - EXCEPTION_DEFAULTS) / 3) as u8));
        }

        if at == CALLBACK_RETURN {
            return self.dpmi_callback_returned();
        }

        if (REAL_CALL..REAL_CALL + 0x100).contains(&at) {
            return self.dpmi_real_returned();
        }

        Some(Event::Stop(Stop::Unsupported(if at == RAW_SWITCH {
            "WIN386's raw mode switch"
        } else {
            "the DPMI host's code reached elsewhere"
        })))
    }

    /// A program's exception handler going on to the host's (as
    /// `#passedOn`).
    fn dpmi_passed_on(&mut self, number: u8) -> Event {
        let frame: [u16; 8] = std::array::from_fn(|_| 0);
        let frame = frame.map(|_| self.dpmi_pop16());

        self.dpmi.stack_tops.pop();
        self.cpu.flags = frame[5];
        self.dpmi_load(SS, frame[7]);
        self.cpu.regs[SP] = frame[6];
        self.dpmi_load(CS, frame[4]);
        self.cpu.ip = u32::from(frame[3]);

        if number == crate::fault::GENERAL_PROTECTION {
            Event::Fault(number)
        } else {
            Event::Stop(Stop::Processor(winbox_cpu::Exit::Fault(number)))
        }
    }

    // --- 0300h-0304h ---

    fn dpmi_structure(&self, at: u32) -> Structure {
        let bus = &self.cpu.bus;
        let word = |offset: u32| bus.read16(at + offset);
        let dword = |offset: u32| bus.read32(at + offset);

        Structure {
            edi: dword(0x00),
            esi: dword(0x04),
            ebp: dword(0x08),
            ebx: dword(0x10),
            edx: dword(0x14),
            ecx: dword(0x18),
            eax: dword(0x1c),
            flags: word(0x20),
            es: word(0x22),
            ds: word(0x24),
            fs: word(0x26),
            gs: word(0x28),
            ip: word(0x2a),
            cs: word(0x2c),
            sp: word(0x2e),
            ss: word(0x30),
        }
    }

    fn dpmi_callback_key(&self, segment: u16, offset: u16) -> Option<u16> {
        if self.dpmi_enhanced() {
            return (segment == WIN386_CALLBACK_SEGMENT
                && self.dpmi.callbacks.contains_key(&offset))
            .then_some(offset);
        }

        if segment != HOST_SEGMENT || offset < DOSX_CALLBACK_FIRST {
            return None;
        }

        let from = offset - DOSX_CALLBACK_FIRST;

        (from.is_multiple_of(3) && self.dpmi.callbacks.contains_key(&(from / 3)))
            .then_some(from / 3)
    }

    /// 0300h-0302h (as `#realCall`).
    fn dpmi_real_call(&mut self, function: u16) -> Option<Event> {
        let structure = self.dpmi_linear(ES, self.cpu.regs[DI]);
        let regs = self.dpmi_structure(structure);

        self.dpmi_host();

        let vector = self.dpmi_low8(BX);
        let target = if function == 0x0300 {
            let at = FIRST_MEGABYTE + u32::from(vector) * 4;

            (self.cpu.bus.read16(at + 2), self.cpu.bus.read16(at))
        } else {
            (regs.cs, regs.ip)
        };

        if let Some(key) = self.dpmi_callback_key(target.0, target.1) {
            let callback = self.dpmi.callbacks[&key];

            return self.dpmi_call_callback(callback, structure, &regs, function != 0x0301);
        }

        let value = u32::from(target.0) << 16 | u32::from(target.1);

        if function == 0x0300
            && ANSWERED.contains(&vector)
            && self.dpmi.answered_vectors.get(&vector) == Some(&value)
        {
            self.dpmi_call_answered(vector, structure, &regs);
            return None;
        }

        Some(Event::Stop(Stop::Unsupported("a call into real-mode code")))
    }

    fn dpmi_call_answered(&mut self, vector: u8, structure: u32, regs: &Structure) {
        let caller = self.dpmi_context();
        let depth = self.dpmi.calls.len() as u16;
        let segments = [regs.es, regs.ds, regs.fs, regs.gs];

        for (at, paragraph) in segments.iter().enumerate() {
            self.dpmi_global(
                SCRATCH_INDICES[at],
                FIRST_MEGABYTE.wrapping_add(u32::from(*paragraph) * 16),
                0xffff,
                0xf3,
            );
        }

        self.dpmi.calls.push(RealCall {
            caller,
            structure,
            stack_index: None,
            segments,
        });

        let stub = REAL_CALL + 4 * depth;

        self.cpu
            .bus
            .write(HOST_LINEAR + u32::from(stub), &[0xcd, vector, 0xcd, 0x31]);
        self.dpmi_set_reg32(AX, regs.eax);
        self.dpmi_set_reg32(BX, regs.ebx);
        self.dpmi_set_reg32(CX, regs.ecx);
        self.dpmi_set_reg32(DX, regs.edx);
        self.dpmi_set_reg32(SI, regs.esi);
        self.dpmi_set_reg32(DI, regs.edi);
        self.dpmi_set_reg32(BP, regs.ebp);
        self.cpu.flags = (regs.flags & !(INTERRUPT | TRAP)) | (caller.flags & (INTERRUPT | TRAP));

        for (at, register) in [ES, DS, FS, GS].into_iter().enumerate() {
            self.dpmi_load(register, (SCRATCH_INDICES[at] << 3) | 3);
        }

        let top = self
            .dpmi
            .stack_tops
            .last()
            .copied()
            .unwrap_or(HOST_STACK_TOP);

        self.dpmi_load(SS, Self::dpmi_host_stack());
        self.cpu.regs[SP] = top;
        self.dpmi_load(CS, self.dpmi_host_code());
        self.cpu.ip = u32::from(stub);
    }

    fn dpmi_paragraph(&self, selector: u16, scratch: u16, given: u16) -> u16 {
        if selector & 0xfff8 == scratch << 3 {
            return given;
        }

        let base = self
            .dpmi_address_of(selector, 0)
            .wrapping_sub(FIRST_MEGABYTE);

        if base < 0x10_0000 {
            (base >> 4) as u16
        } else {
            given
        }
    }

    fn dpmi_real_returned(&mut self) -> Option<Event> {
        let call = self.dpmi.calls.pop()?;
        let at = call.structure;
        let [es, ds, fs, gs] = call.segments;
        let words = [
            (0x00, self.dpmi_reg32(DI)),
            (0x04, self.dpmi_reg32(SI)),
            (0x08, self.dpmi_reg32(BP)),
            (0x10, self.dpmi_reg32(BX)),
            (0x14, self.dpmi_reg32(DX)),
            (0x18, self.dpmi_reg32(CX)),
            (0x1c, self.dpmi_reg32(AX)),
        ];

        for (offset, value) in words {
            self.cpu.bus.write32(at + offset, value);
        }

        let segments = [
            (
                0x22,
                self.dpmi_paragraph(self.cpu.segments[ES].selector, SCRATCH_INDICES[0], es),
            ),
            (
                0x24,
                self.dpmi_paragraph(self.cpu.segments[DS].selector, SCRATCH_INDICES[1], ds),
            ),
            (
                0x26,
                self.dpmi_paragraph(self.cpu.segments[FS].selector, SCRATCH_INDICES[2], fs),
            ),
            (
                0x28,
                self.dpmi_paragraph(self.cpu.segments[GS].selector, SCRATCH_INDICES[3], gs),
            ),
        ];

        self.cpu.bus.write16(at + 0x20, self.cpu.flags);

        for (offset, value) in segments {
            self.cpu.bus.write16(at + offset, value);
        }

        let flags = self.cpu.bus.read16(at + 0x20);

        self.dpmi_caller_on(&call, flags);
        None
    }

    fn dpmi_caller_on(&mut self, call: &RealCall, flags: u16) {
        self.dpmi_restore(&call.caller);
        self.cpu.flags = (flags & 0xbffe) | (call.caller.flags & (INTERRUPT | TRAP));
    }

    /// A callback called from real mode (as `#callCallback`).
    fn dpmi_call_callback(
        &mut self,
        callback: Callback,
        structure: u32,
        regs: &Structure,
        interrupt: bool,
    ) -> Option<Event> {
        let caller = self.dpmi_context();
        let (mut ss, mut sp) = (regs.ss, regs.sp);

        if ss == 0 && sp == 0 {
            ss = HOST_SEGMENT;
            sp = REAL_STACK_TOP - 0x40 * self.dpmi.calls.len() as u16;
        }

        let real = FIRST_MEGABYTE.wrapping_add(u32::from(ss) * 16);
        let mut push = |system: &mut Self, word: u16| {
            sp = sp.wrapping_sub(2);
            system.cpu.bus.write16(real + u32::from(sp), word);
        };

        if interrupt {
            push(self, regs.flags);
        }

        push(self, HOST_SEGMENT);
        push(self, REAL_RETURN);

        let target = self.dpmi_address_of(callback.structure.0, callback.structure.1);
        let words = [
            (0x00, regs.edi as u16),
            (0x04, regs.esi as u16),
            (0x08, regs.ebp as u16),
            (0x10, regs.ebx as u16),
            (0x14, regs.edx as u16),
            (0x18, regs.ecx as u16),
            (0x1c, regs.eax as u16),
            (0x20, regs.flags),
            (0x22, regs.es),
            (0x24, regs.ds),
            (0x2e, sp),
            (0x30, ss),
        ];

        for (offset, value) in words {
            self.cpu.bus.write16(target + offset, value);
        }

        let Some(index) = self.descriptors.take(1) else {
            return Some(Event::Stop(Stop::Unsupported(
                "no descriptor for a callback's real-mode stack",
            )));
        };
        let [b0, b1, b2, b3] = real.to_le_bytes();

        self.descriptors.claim(index, true);
        self.dpmi_write_descriptor(
            ((index as u16) << 3) | 7,
            [0xff, 0xff, b0, b1, b2, 0xf2, 0, b3],
        );
        self.dpmi.calls.push(RealCall {
            caller,
            structure,
            stack_index: Some(index),
            segments: [0; 4],
        });

        let top = self
            .dpmi
            .stack_tops
            .last()
            .copied()
            .unwrap_or(HOST_STACK_TOP);
        let flags = caller.flags & !(INTERRUPT | TRAP);

        self.dpmi_load(SS, Self::dpmi_host_stack());
        self.cpu.regs[SP] = top;
        self.dpmi_push16(flags);
        self.dpmi_push16(self.dpmi_host_code());
        self.dpmi_push16(CALLBACK_RETURN);
        self.dpmi.stack_tops.push(self.cpu.regs[SP]);
        self.cpu.flags = flags;
        self.dpmi_load(DS, ((index as u16) << 3) | 7);
        self.cpu.regs[SI] = sp;
        self.dpmi_load(ES, callback.structure.0);
        self.cpu.regs[DI] = callback.structure.1;
        self.dpmi_load(CS, callback.procedure.0);
        self.cpu.ip = u32::from(callback.procedure.1);
        None
    }

    fn dpmi_callback_returned(&mut self) -> Option<Event> {
        let call = self.dpmi.calls.pop()?;
        let from = self.dpmi_linear(ES, self.cpu.regs[DI]);
        let regs = self.dpmi_structure(from);

        self.dpmi.stack_tops.pop();

        if let Some(index) = call.stack_index {
            self.descriptors.give(&mut self.cpu.bus, index);
        }

        if regs.cs != HOST_SEGMENT || regs.ip != REAL_RETURN {
            return Some(Event::Stop(Stop::Unsupported(
                "a callback returning to real-mode code",
            )));
        }

        let bytes = self.cpu.bus.read(from, 0x2a);

        self.cpu.bus.write(call.structure, &bytes);
        self.dpmi_caller_on(&call, regs.flags);
        None
    }

    /// 0303h (as `#allocateCallback`).
    fn dpmi_allocate_callback(&mut self) -> Option<Event> {
        let callback = Callback {
            procedure: (self.cpu.segments[DS].selector, self.cpu.regs[SI]),
            structure: (self.cpu.segments[ES].selector, self.cpu.regs[DI]),
        };

        if self.dpmi_enhanced() {
            let next = self.dpmi.next_callback.unwrap_or(WIN386_CALLBACK_FIRST);
            let offset = self.dpmi.freed_callbacks.pop().unwrap_or(next);

            if offset == next {
                self.dpmi.next_callback = Some(next.wrapping_sub(0x10));
            }

            self.dpmi.callbacks.insert(offset, callback);
            self.cpu.regs[CX] = WIN386_CALLBACK_SEGMENT;
            self.cpu.regs[DX] = offset;
            return self.dpmi_ok();
        }

        for slot in DOSX_CALLBACKS_TAKEN..DOSX_CALLBACKS {
            if let std::collections::hash_map::Entry::Vacant(entry) =
                self.dpmi.callbacks.entry(slot)
            {
                entry.insert(callback);
                self.cpu.regs[CX] = HOST_SEGMENT;
                self.cpu.regs[DX] = DOSX_CALLBACK_FIRST + 3 * slot;
                return self.dpmi_ok();
            }
        }

        self.dpmi_refuse(None)
    }

    /// 0304h (as `#freeCallback`).
    fn dpmi_free_callback(&mut self, segment: u16, offset: u16) -> Option<Event> {
        if self.dpmi_enhanced() {
            if segment != WIN386_CALLBACK_SEGMENT || self.dpmi.callbacks.remove(&offset).is_none() {
                return self.dpmi_refuse(None);
            }

            self.dpmi.freed_callbacks.push(offset);
            return self.dpmi_ok();
        }

        if segment != HOST_SEGMENT
            || offset < DOSX_CALLBACK_FIRST
            || (offset - DOSX_CALLBACK_FIRST) / 3 >= DOSX_CALLBACKS
        {
            return self.dpmi_refuse(None);
        }

        self.dpmi
            .callbacks
            .remove(&((offset - DOSX_CALLBACK_FIRST) / 3));
        self.dpmi_ok()
    }

    // --- 0500h-0503h ---

    fn dpmi_free_information(&mut self) -> Option<Event> {
        let at = self.dpmi_linear(ES, self.cpu.regs[DI]);

        if self.dpmi_enhanced() {
            for (index, value) in (0u32..).zip(FREE_ENHANCED) {
                self.cpu.bus.write32(at + 4 * index, value);
            }
        } else {
            self.cpu.bus.write(at, &[0xff; 0x30]);
            self.cpu.bus.write32(at, FREE_LARGEST);
            self.cpu.bus.write32(at + 0x14, FREE_PAGES);
            self.cpu.bus.write32(at + 0x1c, FREE_PAGES);
            self.cpu.bus.write32(at + 0x20, 0);
        }

        self.dpmi_ok()
    }

    /// 0501h (as `#allocateBlock`).
    fn dpmi_allocate_block(&mut self) -> Option<Event> {
        let size = u32::from(self.cpu.regs[BX]) << 16 | u32::from(self.cpu.regs[CX]);
        let largest = if self.dpmi_enhanced() {
            FREE_ENHANCED[0]
        } else {
            FREE_LARGEST
        };

        if (self.dpmi_enhanced() && size == 0) || size > largest {
            return self.dpmi_refuse(None);
        }

        let header = if self.dpmi_enhanced() { 0 } else { 0x10 };
        let count = ((size + header).div_ceil(0x10000) as usize).max(1);
        let Some(index) = self.descriptors.find(1, count) else {
            return self.dpmi_refuse(None);
        };

        for at in index..index + count {
            self.descriptors.claim(at, true);
        }

        let base = ((index as u32) << 16) + header;
        let handle = if self.dpmi_enhanced() {
            ((index as u32) << 3) << 16
        } else {
            let limit = if size == 0 || size > 0x10000 {
                0xffff
            } else {
                size - 1
            };
            let [b0, b1, b2, b3] = base.to_le_bytes();
            let selector = ((index as u16) << 3) | 7;

            self.dpmi_write_descriptor(
                selector,
                [limit as u8, (limit >> 8) as u8, b0, b1, b2, 0xf2, 0, b3],
            );
            u32::from(selector) * 0x10001
        };

        self.dpmi.blocks.insert(
            handle,
            Block {
                index,
                count,
                size,
                base,
            },
        );
        self.cpu.regs[BX] = (base >> 16) as u16;
        self.cpu.regs[CX] = base as u16;
        self.cpu.regs[SI] = (handle >> 16) as u16;
        self.cpu.regs[DI] = handle as u16;
        self.dpmi_ok()
    }

    fn dpmi_block_handle(&self) -> u32 {
        if self.dpmi_enhanced() {
            u32::from(self.cpu.regs[SI]) << 16 | u32::from(self.cpu.regs[DI])
        } else {
            u32::from(self.cpu.regs[SI]) * 0x10001
        }
    }

    fn dpmi_release_block(&mut self, block: Block) {
        for at in block.index..block.index + block.count {
            if self.dpmi_enhanced() || at != block.index {
                self.descriptors.claim(at, false);
            } else {
                self.descriptors.release(&mut self.cpu.bus, at);
            }
        }
    }

    fn dpmi_free_block(&mut self) -> Option<Event> {
        if !self.dpmi_enhanced() && self.cpu.regs[SI] == 0 {
            return Some(self.dpmi_host_fault("0502h of nought"));
        }

        let handle = self.dpmi_block_handle();
        let Some(block) = self.dpmi.blocks.remove(&handle) else {
            return self.dpmi_refuse(None);
        };

        self.dpmi_release_block(block);
        self.dpmi_ok()
    }

    /// 0503h (as `#resizeBlock`).
    fn dpmi_resize_block(&mut self) -> Option<Event> {
        let size = u32::from(self.cpu.regs[BX]) << 16 | u32::from(self.cpu.regs[CX]);
        let handle = self.dpmi_block_handle();
        let block = self.dpmi.blocks.get(&handle).copied();

        if !self.dpmi_enhanced() {
            if self.cpu.regs[SI] == 0 || block.is_some() {
                let why = format!("0503h, EC={:04X}", self.cpu.regs[CX]);

                return Some(self.dpmi_host_fault(&why));
            }

            return self.dpmi_refuse(None);
        }

        let Some(mut block) = block else {
            return self.dpmi_refuse(None);
        };

        if size == 0 || size > FREE_ENHANCED[0] {
            return self.dpmi_refuse(None);
        }

        if size.div_ceil(0x1000) > block.size.div_ceil(0x1000) {
            let count = (size.div_ceil(0x10000) as usize).max(1);
            let Some(index) = self.descriptors.find(1, count) else {
                return self.dpmi_refuse(None);
            };

            for at in index..index + count {
                self.descriptors.claim(at, true);
            }

            let base = (index as u32) << 16;
            let bytes = self.cpu.bus.read(block.base, block.size.min(size) as usize);

            self.cpu.bus.write(base, &bytes);
            self.dpmi_release_block(block);
            block.index = index;
            block.count = count;
            block.base = base;
        }

        block.size = size;
        self.dpmi.blocks.insert(handle, block);
        self.cpu.regs[BX] = (block.base >> 16) as u16;
        self.cpu.regs[CX] = block.base as u16;
        self.dpmi_ok()
    }

    // --- 0900h-0902h, 0B00h-0B03h ---

    fn dpmi_interrupt_state(&mut self) -> Option<Event> {
        let on = u16::from(self.cpu.flags & INTERRUPT != 0);

        self.cpu.regs[AX] = self.cpu.regs[AX] & 0xff00 | on;
        self.dpmi_ok()
    }

    /// 0B00h-0B03h (as `#watchpoint`).
    fn dpmi_watchpoint(&mut self, function: u16) -> Option<Event> {
        if function == 0x0b00 {
            let kind = self.dpmi_high8(DX);
            let size = if kind == 0 { 1 } else { self.dpmi_low8(DX) };

            if ![1, 2, 4].contains(&size) || kind > 2 {
                return self.dpmi_refuse(None);
            }

            let Some(free) = self.dpmi.watchpoints.iter().position(Option::is_none) else {
                return self.dpmi_refuse(None);
            };

            self.dpmi.watchpoints[free] =
                Some(u32::from(self.cpu.regs[BX]) << 16 | u32::from(self.cpu.regs[CX]));
            self.cpu.regs[BX] = free as u16;
            return self.dpmi_ok();
        }

        let number = usize::from(self.cpu.regs[BX]);

        if number >= 4 || self.dpmi.watchpoints[number].is_none() {
            return self.dpmi_refuse(None);
        }

        if function == 0x0b01 {
            self.dpmi.watchpoints[number] = None;
        } else if function == 0x0b02 {
            self.cpu.regs[AX] = u16::from(!self.dpmi_enhanced());
        }

        self.dpmi_ok()
    }
}

/// WIN386's 0009h and 000Ch: a segment, not a system descriptor, of
/// privilege 3 (`dpmildt`).
fn fit_rights(access: u8) -> bool {
    access & 0x10 != 0 && (access >> 5) & 3 == 3
}
