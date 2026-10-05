//! A program that faults, as KERNEL takes it (`KRNL386.EXE` seg1 `5e1b`),
//! as winbox.js's `kernel/fault.ts` has it: **read out**, and **recorded**
//! by `fault` through the screen.
//!
//! * If the instruction can be stepped over, the first box offers the
//!   choice: Ignore steps over it and the program goes on; Close goes on to
//!   the second. It is offered while `WIN.INI`'s `[KERNEL] GPContinue`, 1
//!   when it is not there, has its lowest bit set, the stack pointer is 80h
//!   or more, and the instruction is one KERNEL knows the length of.
//! * The second box, Application Error, says which fault, in which module,
//!   at which segment of it and where; `SetErrorMode`'s
//!   `SEM_NOGPFAULTERRORBOX` shows none. Then the program is ended, with
//!   exit code `FFh`.
//!
//! Nothing else runs while either box is up. Not followed: Dr. Watson, a
//! debugger's Cancel, a procedure TOOLHELP's `InterruptRegister` was given,
//! and a fault in KERNEL's or USER's own code, which winbox.js has none of.
//!
//! As in the TypeScript engine, only a general protection fault reaches
//! here: a processor's other faults -- a stack fault, a segment not
//! present -- are taken by no handler of the engine's, and the run stops at
//! them. The exit code is KERNEL's own; the Rust engine has no host told
//! of a task's end, as the TypeScript engine's `onExit` is, to give it to.

use winbox_machine::segment_selector;

use crate::call::Stop;
use crate::engine::Engine;
use crate::instruction_length::instruction_length;
use crate::profiles_kernel::profile_int;
use crate::run::Event;
use crate::sys_error_box::{SEB_CLOSE, SEB_DEFBUTTON, SEB_IGNORE};
use crate::system::System;

/// The fault the engine takes a program through KERNEL's boxes for.
pub const GENERAL_PROTECTION: u8 = 0x0d;

const FIRST_BOX: &[u8] = b"An error has occurred in your application.\n\
If you choose Ignore, you should save your work in a new file.\n\
If you choose Close, your application will terminate.";

const SEM_NOGPFAULTERRORBOX: u16 = 0x0002;

/// What each fault is called, as KERNEL writes it.
fn fault_name(vector: u8) -> &'static str {
    match vector {
        0x06 => "an Illegal Instruction",
        0x0c => "a Stack Fault",
        0x0d => "a General Protection Fault",
        _ => "an Application Fault",
    }
}

/// A file's name from its path, as written in the box: what follows the
/// last `\`, `/` or `:`, in capitals.
fn file_part(path: &str) -> String {
    path.rsplit(['\\', '/', ':'])
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

impl System {
    /// What a stop of the processor's comes to: a general protection fault
    /// the TypeScript engine's processor raises for the instruction, taken
    /// through KERNEL's boxes; another fault it raises, by its own vector;
    /// anything else, the stop as it was (`fault_vector.rs`).
    pub(crate) fn processor_stop(&self, exit: winbox_cpu::Exit) -> Event {
        match self.fault_vector(exit) {
            Some(GENERAL_PROTECTION) => Event::Fault(GENERAL_PROTECTION),
            Some(vector) => Event::Stop(Stop::Processor(winbox_cpu::Exit::Fault(vector))),
            None => Event::Stop(Stop::Processor(exit)),
        }
    }

    /// The running task's program's name, as the boxes give it: its file's
    /// name without the extension, in capitals, eight letters at most.
    /// `None` with no task running a program.
    fn faulted_name(&self) -> Option<String> {
        let task = self.task.as_ref()?;
        let module = self.modules.get(task.program)?;
        let file = file_part(&module.path);
        let name = file
            .rsplit_once('.')
            .map_or(file.as_str(), |(name, _)| name);

        Some(name.chars().take(8).collect())
    }

    /// The instruction at CS:IP's bytes as KERNEL reads them, through CS;
    /// `None` past its limit. The offset wraps in 64 KiB, as the
    /// JavaScript core's `read8` wraps it, unless the instruction that
    /// faulted addresses in 32 bits.
    fn code_byte(&self, wide: bool, at: u16) -> Option<u8> {
        let segment = self.cpu.segments[winbox_cpu::CS];
        let offset = u32::from(self.cpu.ip) + u32::from(at);
        let offset = if wide { offset } else { offset & 0xffff };

        (offset < segment.past_limit).then(|| {
            winbox_machine::Memory::read8(&self.cpu.bus, segment.base.wrapping_add(offset))
        })
    }

    /// Whether the first box is offered (seg1 `9ff7`).
    fn can_ignore(&mut self) -> bool {
        let setting = profile_int(self, b"KERNEL", b"GPContinue", 1);

        if setting & 1 == 0
            || self.cpu.regs[winbox_cpu::SP] < 0x80
            || u32::from(self.cpu.ip) + 10 > 0xffff
        {
            return false;
        }

        let wide = self.addresses_in_32_bits();

        instruction_length(|at| self.code_byte(wide, at)).is_some()
    }

    /// The module a code selector is in and which of its segments, counted
    /// from 1; the selector itself when it is none of them, and `<unknown>`
    /// for the module (seg1 `5d38`). The program's own module first, then
    /// the libraries it loaded.
    fn faulted_place(&self, cs: u16) -> (u16, String) {
        let Some(task) = self.task.as_ref() else {
            return (cs, "<unknown>".to_string());
        };

        for &index in std::iter::once(&task.program).chain(&task.libraries) {
            let Some(module) = self.modules.get(index) else {
                continue;
            };

            for (number, &descriptor) in (1..).zip(&module.segments) {
                if segment_selector(descriptor) & 0xfff8 == cs & 0xfff8 {
                    return (number, file_part(&module.path));
                }
            }
        }

        (cs, "<unknown>".to_string())
    }
}

impl Engine {
    /// A fault in the task that has the processor, from the instruction at
    /// CS:IP, which has done nothing: `Ok` where the program is to go on
    /// past it (Ignore), else the task ended, `Stop::Ended`. A fault with no
    /// program's task running stops the run, as no handler takes it.
    pub async fn application_fault(&self, vector: u8) -> Result<(), Stop> {
        let (name, offered, cs, ip) = {
            let mut system = self.system();
            let Some(name) = system.faulted_name() else {
                return Err(Stop::Processor(winbox_cpu::Exit::Fault(vector)));
            };
            let offered = vector == GENERAL_PROTECTION && system.can_ignore();

            (
                name,
                offered,
                system.cpu.segments[winbox_cpu::CS].selector,
                system.cpu.ip,
            )
        };

        if offered {
            let chosen = self
                .sys_error_box(
                    FIRST_BOX,
                    name.as_bytes(),
                    [SEB_CLOSE | SEB_DEFBUTTON, 0, SEB_IGNORE],
                )
                .await?;

            if chosen == 3 {
                let mut system = self.system();
                let wide = system.addresses_in_32_bits();
                let length = instruction_length(|at| system.code_byte(wide, at)).unwrap_or(0);

                system.cpu.ip = ip.wrapping_add(length);
                return Ok(());
            }
        }

        let shown = self.system().error_mode & SEM_NOGPFAULTERRORBOX == 0;
        let (number, file) = self.system().faulted_place(cs);

        self.system().application_faults.push(format!(
            "{name} caused {} in module {file} at {number:04X}:{ip:04X}",
            fault_name(vector),
        ));

        if shown {
            let text = format!(
                "{name} caused {} in\nmodule {file} at {number:04X}:{ip:04X}.\n\nChoose close. {name} will close.",
                fault_name(vector),
            );

            self.sys_error_box(
                text.as_bytes(),
                b"Application Error",
                [0, SEB_CLOSE | SEB_DEFBUTTON, 0],
            )
            .await?;
        }

        // Ended as at INT 21h function 4Ch: with others left, they run on.
        let mut system = self.system();

        if system.task_count() > 1 {
            system.exit_task(0xff);
        } else {
            system.ended = true;
        }

        Err(Stop::Ended)
    }
}

#[cfg(test)]
mod tests {
    use super::{fault_name, file_part};
    use crate::instruction_length::instruction_length;
    use crate::system::System;

    #[test]
    fn kernel_reads_an_instruction_on_past_ffffh_from_nought() {
        // Eleven ES prefixes from FFF5h, and the NOP they lead to at 0.
        let mut bytes = vec![0u8; 0x10000];

        bytes[0] = 0x90;
        bytes[0xfff5..].fill(0x26);

        let mut system = System::new();

        system.cpu.protected = true;
        system
            .descriptors
            .map(&mut system.cpu.bus, 0x40, &bytes, true);
        system
            .cpu
            .load_segment(winbox_cpu::CS, winbox_machine::segment_selector(0x40))
            .unwrap();
        system.cpu.ip = 0xfff5;

        let wide = system.addresses_in_32_bits();

        assert!(!wide);
        assert_eq!(
            instruction_length(|at| system.code_byte(wide, at)),
            Some(12)
        );
    }

    #[test]
    fn a_file_is_named_by_what_follows_its_folders() {
        assert_eq!(file_part("C:\\WINDOWS\\faultc.exe"), "FAULTC.EXE");
        assert_eq!(file_part("FAULT.EXE"), "FAULT.EXE");
    }

    #[test]
    fn a_fault_kernel_has_no_name_for_is_an_application_fault() {
        assert_eq!(fault_name(13), "a General Protection Fault");
        assert_eq!(fault_name(11), "an Application Fault");
    }
}
