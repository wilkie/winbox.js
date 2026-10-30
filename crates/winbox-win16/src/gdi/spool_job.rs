//! `GetSpoolJob`: GDI's own interface to Print Manager, an option and a
//! parameter over the spooler's state. The twin of
//! `src/win16/gdi/GetSpoolJob.ts`, where the read-out is told: seg28
//! `1802`, **recorded** by `spooljob` and `gdispool`.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// What option 14h writes: a job's details, all nought with none.
const JOB_DETAILS: u32 = 42;

/// The spooler's state as Print Manager and the spooler's own calls leave
/// it in GDI's data: whether the queues are readied (`[0590h]`), how many
/// there are (`[0A28h]`), Print Manager's window (`[058Eh]`), the disk
/// space it last gave (`[058Ah]`), its count of jobs (`[0592h]`), and the
/// flag option 23h sets (`[064Ah]` bit 3).
#[derive(Debug, Clone, Default)]
pub struct Spooler {
    pub started: bool,
    /// Print Manager's window.
    pub window: u16,
    /// The disk space option 1Bh kept, which `QueryJob`'s 1004h asks after.
    pub disk_space: u32,
    pub queues: u32,
    pub jobs: u32,
    pub flagged: bool,
}

/// An option's answer.
pub fn get_spool_job(system: &mut System, option: u16, lparam: u32) -> u32 {
    match option {
        0x14 => {
            for at in 0..JOB_DETAILS {
                let far = (lparam & 0xffff_0000) | (lparam.wrapping_add(at) & 0xffff);

                system.write_far(far, &[0]);
            }

            0
        }
        0x15 => {
            let spooler = &mut system.printing.spooler;

            spooler.window = lparam as u16;

            if spooler.window == 0 {
                spooler.disk_space = 0;
            }

            spooler.jobs
        }
        0x19 => {
            super::spooler::readied(system);
            system.printing.spooler.queues
        }
        0x1b => {
            system.printing.spooler.disk_space = lparam;
            0
        }
        0x1c => {
            super::spooler::read_queues(system);
            0
        }
        0x1d => system.printing.spooler.queues,
        0x1f => {
            system.printing.spooler.started = false;
            0
        }
        0x20 | 0x21 => {
            let at = lparam as u16 as i16;
            let queue = usize::try_from(at).ok().and_then(|at| {
                system
                    .printing
                    .spooling
                    .as_ref()
                    .and_then(|spooling| spooling.queues.get(at))
            });

            queue.map_or(0, |queue| {
                (if option == 0x20 {
                    queue.retry
                } else {
                    queue.select
                }) as u32
            })
        }
        0x22 => u32::from(system.printing.spooler.window == 0),
        0x23 => {
            system.printing.spooler.flagged = lparam != 0;
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
        assert_eq!(system.printing.spooler.disk_space, 0x1234_5678);
        get_spool_job(&mut system, 0x15, 0);
        assert_eq!(system.printing.spooler.disk_space, 0);
        assert_eq!(get_spool_job(&mut system, 0x20, 1), 0);
        get_spool_job(&mut system, 0x1f, 0);
        assert!(!system.printing.spooler.started);
    }
}
