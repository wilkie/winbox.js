//! `GetSpoolJob`: GDI's own interface to Print Manager, an option and a
//! parameter over the spooler's state.
//!
//! **Read out** of `GDI.EXE` (seg28 `1802`) and **recorded** by `spooljob`
//! on an installation with no printer, in the order Print Manager asks as
//! it starts -- 1Dh, 19h, 14h, 15h -- and then the options that only read:
//!
//! * 14h hands the spooler a buffer, which it fills with the next job's
//!   details: with no printer, 42 bytes of nought. It answers nought.
//! * 15h takes Print Manager's window, nought for none, and answers how
//!   many jobs there are: nought. Taking nought forgets the procedure 1Bh
//!   gave.
//! * 19h readies the spooler's queues from the printers the first time,
//!   and answers how many: nought. 1Ch readies them again, and answers
//!   nought; 1Dh answers how many; 1Fh lets them be readied afresh.
//! * 1Bh keeps a procedure. 20h and 21h answer the two timeouts of a queue,
//!   by its number: nought with none. 22h answers 1 while Print Manager has
//!   given no window, else nought. 23h sets or clears a flag. Every other
//!   option answers nought.
//!
//! Not followed: printers, their queues and their jobs, of which winbox.js
//! has none; the queues' timeouts, which GDI reads from `[PrinterPorts]`.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// What option 14h writes: a job's details, all nought with none.
const JOB_DETAILS: u32 = 42;

/// The spooler's state, as Print Manager's options leave it.
#[derive(Debug, Clone, Default)]
pub struct Spooler {
    pub started: bool,
    /// Print Manager's window.
    pub window: u16,
    /// The procedure option 1Bh kept.
    pub procedure: u32,
    pub queues: u32,
    pub jobs: u32,
    pub flagged: bool,
}

/// An option's answer.
pub fn get_spool_job(system: &mut System, option: u16, lparam: u32) -> u32 {
    let spooler = &mut system.printing.spooler;

    match option {
        0x14 => {
            for at in 0..JOB_DETAILS {
                let far = (lparam & 0xffff_0000) | (lparam.wrapping_add(at) & 0xffff);

                system.write_far(far, &[0]);
            }

            0
        }
        0x15 => {
            spooler.window = lparam as u16;

            if spooler.window == 0 {
                spooler.procedure = 0;
            }

            spooler.jobs
        }
        0x19 => {
            if !spooler.started {
                spooler.started = true;
                spooler.queues = 0;
            }

            spooler.queues
        }
        0x1b => {
            spooler.procedure = lparam;
            0
        }
        0x1c => {
            spooler.queues = 0;
            0
        }
        0x1d => spooler.queues,
        0x1f => {
            spooler.started = false;
            0
        }
        0x22 => u32::from(spooler.window == 0),
        0x23 => {
            spooler.flagged = lparam != 0;
            0
        }
        _ => 0,
    }
}

pub(crate) fn get_spool_job_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let option = args.word(system);
    let lparam = args.dword(system);

    Ok(Answer::Dword(get_spool_job(system, option, lparam)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_print_manager_as_it_starts_with_no_printer() {
        let mut system = System::new();

        assert_eq!(get_spool_job(&mut system, 0x1d, 0), 0);
        assert_eq!(get_spool_job(&mut system, 0x19, 0), 0);
        assert!(system.printing.spooler.started);
        assert_eq!(get_spool_job(&mut system, 0x22, 0), 1);
        get_spool_job(&mut system, 0x1b, 0x1234_5678);
        assert_eq!(get_spool_job(&mut system, 0x15, 0x42), 0);
        assert_eq!(get_spool_job(&mut system, 0x22, 0), 0);
        assert_eq!(system.printing.spooler.procedure, 0x1234_5678);
        get_spool_job(&mut system, 0x15, 0);
        assert_eq!(system.printing.spooler.procedure, 0);
        assert_eq!(get_spool_job(&mut system, 0x20, 1), 0);
        get_spool_job(&mut system, 0x1f, 0);
        assert!(!system.printing.spooler.started);
    }
}
