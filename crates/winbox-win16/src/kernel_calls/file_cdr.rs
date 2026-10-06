//! `FileCdr`: the one procedure KERNEL tells when a file changes, which
//! File Manager sets so that its windows follow what other programs do to
//! the disk.
//!
//! **Read out** of `KRNL386.EXE` (seg3 `888`, seg1 `7f19`) and **recorded**
//! by `filecdr`:
//!
//! * Given a pointer whose segment is `FFFFh`, it answers the procedure set,
//!   nought for none. Given any other, it sets it -- nought clears it -- and
//!   answers 1, unless another task set the one there, when it answers
//!   nought and leaves it.
//! * After a create (3Ch, 5Bh), a delete (41h), a rename (56h), a directory
//!   made or taken away (39h, 3Ah) or attributes set (4301h) succeeds, the
//!   procedure is called with the function's AX -- the function in AH, and
//!   in AL whatever the caller had there -- and the whole path: the drive,
//!   the current directory unless the path begins at the root, and the path
//!   as it was given. A rename's new name follows the old one's null, as
//!   given. A write, a close, an open of a file that is there, and a call
//!   that fails, tell it nothing.
//! * KERNEL's own calls tell it too: `_lcreat` and `OpenFile` creating as
//!   3Ch, `OpenFile` deleting as 41h.
//!
//! Not followed: what KERNEL does with the procedure when the task that set
//! it ends.
//!
//! A change is noted where the file is changed, by `dos.rs` and by `_lcreat`
//! and `OpenFile`, and the procedure is told once the call that changed it
//! has done: `Dos3Call`, `_lcreat` and `OpenFile` tell it before they
//! answer; an `INT 21h` of the program's own, before the program goes on
//! (`run.rs`).

use winbox_machine::{handle_for, segment_selector};

use crate::call::{Answer, Args, Later, Pending, Stop};
use crate::engine::{Engine, GuestArg};
use crate::system::System;

const QUERY: u16 = 0xffff;

/// The procedure, the task that set it, and the changes noted and not yet
/// told: each function's AX, and the text the procedure is given.
#[derive(Debug, Clone, Default)]
pub struct FileCdr {
    proc: u32,
    owner: u16,
    due: Vec<(u16, Vec<u8>)>,
}

/// Whether a DOS call, by its AX, is one that tells the procedure: 43h only
/// setting.
pub(crate) fn tells(ax: u16) -> bool {
    matches!(ax >> 8, 0x39 | 0x3a | 0x3c | 0x41 | 0x56 | 0x5b) || ax == 0x4301
}

impl System {
    /// Whether a procedure is set to be told.
    pub(crate) fn file_cdr_set(&self) -> bool {
        self.kernel_calls.file_cdr.proc >> 16 != 0
    }

    /// A path made whole as KERNEL makes it (seg1 `7f6d`): its drive, the
    /// drive's current directory unless it starts at the root, and the
    /// path as it was given.
    pub(crate) fn whole_path(&self, path: &[u8]) -> Vec<u8> {
        let mut rest = path;
        let mut drive = self.files.drive;

        if rest.get(1) == Some(&b':') {
            drive = char::from(rest[0].to_ascii_uppercase());
            rest = &rest[2..];
        }

        let mut whole = format!("{drive}:").into_bytes();

        if !matches!(rest.first(), Some(b'\\' | b'/')) {
            let current: Vec<u8> = self
                .files
                .current(drive)
                .chars()
                .skip(2)
                .map(|ch| ch as u8)
                .collect();
            let ends = matches!(current.last(), Some(b'\\' | b'/'));

            whole.extend_from_slice(&current);

            if !ends {
                whole.push(b'\\');
            }
        }

        whole.extend_from_slice(rest);
        whole
    }

    /// A change noted for the procedure, where one is set: `ax` the DOS
    /// function, `path` as the program gave it, `second` a rename's new
    /// name.
    pub(crate) fn note_file_change(&mut self, ax: u16, path: &[u8], second: Option<&[u8]>) {
        if !self.file_cdr_set() {
            return;
        }

        let mut text = self.whole_path(path);

        if let Some(second) = second {
            text.push(0);
            text.extend_from_slice(second);
        }

        self.kernel_calls.file_cdr.due.push((ax, text));
    }

    /// The procedure's telling, as a call the engine makes once an `INT
    /// 21h` has done, where a change is due.
    pub(crate) fn file_changes_pending(&mut self) -> Option<Pending> {
        (!self.kernel_calls.file_cdr.due.is_empty()).then(|| Pending {
            implementation: tell_after_interrupt,
            args: Args::repeat(0),
            logged: None,
        })
    }
}

impl Engine {
    /// Each change noted told to the procedure, in a block of its own that
    /// is freed after: its AX and the whole path.
    pub(crate) async fn tell_file_changes(&self) -> Result<(), Stop> {
        loop {
            let (proc, ax, far, index) = {
                let mut system = self.system();

                if system.kernel_calls.file_cdr.due.is_empty() {
                    return Ok(());
                }

                let (ax, text) = system.kernel_calls.file_cdr.due.remove(0);
                let proc = system.kernel_calls.file_cdr.proc;

                // Cleared meanwhile, it is told nothing.
                if proc >> 16 == 0 {
                    system.kernel_calls.file_cdr.due.clear();
                    return Ok(());
                }

                let system = &mut *system;
                let index = system.global.allocate(
                    &mut system.cpu.bus,
                    &mut system.descriptors,
                    text.len() as u32 + 1,
                    0x42,
                );
                let far = index.map_or(0, |index| u32::from(segment_selector(index)) << 16);

                for (at, &byte) in text.iter().chain(&[0]).enumerate() {
                    system.write_far(far | (at as u32 & 0xffff), &[byte]);
                }

                (proc, ax, far, index)
            };

            self.call_with(proc, &[GuestArg::Word(ax), GuestArg::Long(far)], &[])
                .await?;

            if let Some(index) = index {
                let handle = handle_for(index);

                crate::memory::global_free(&mut self.system(), &mut Args::repeat(handle))?;
            }
        }
    }
}

/// The procedure told of what an `INT 21h` changed: a call of the engine's
/// own, between the GDI heap's taking and leaving as any call is.
fn tell_after_interrupt(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.system().gdi_heap_before_call();
        engine.tell_file_changes().await?;
        Ok(Answer::Nothing)
    })
}

/// Sets the procedure told of changes, or asks for it: asked, the
/// procedure; set, 1, or nought when another task's is there.
pub(super) fn file_cdr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let notify = args.dword(system);
    let task = system.task_handle;
    let hook = &mut system.kernel_calls.file_cdr;

    if (notify >> 16) as u16 == QUERY {
        return Ok(Answer::Dword(hook.proc));
    }

    if hook.proc >> 16 != 0 && hook.owner != task {
        return Ok(Answer::Dword(0));
    }

    hook.proc = notify;
    hook.owner = task;
    Ok(Answer::Dword(1))
}

/// `Dos3Call`: the DOS function AH names, and the procedure told of what it
/// changed.
pub(crate) fn dos3_call(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.system().dos_call()?;
        engine.tell_file_changes().await?;
        Ok(Answer::Nothing)
    })
}

/// A call of KERNEL's that may change a file, its procedure told after.
fn telling(engine: &Engine, mut args: Args, answer: crate::call::Sync) -> Later<'_> {
    Box::pin(async move {
        let answer = answer(&mut engine.system(), &mut args)?;

        engine.tell_file_changes().await?;
        Ok(answer)
    })
}

/// `_lcreat`, its create told as 3C00h.
pub(crate) fn lcreat(engine: &Engine, args: Args) -> Later<'_> {
    telling(engine, args, crate::kernel::lcreat)
}

/// `OpenFile`, its create told as 3C01h and its delete as 4100h.
pub(crate) fn open_file(engine: &Engine, args: Args) -> Later<'_> {
    telling(engine, args, crate::files_kernel::open_file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_of_changes_only() {
        for ax in [
            0x3c00, 0x3c41, 0x5b00, 0x4100, 0x5600, 0x3900, 0x3a00, 0x4301,
        ] {
            assert!(tells(ax), "{ax:04x}");
        }

        for ax in [0x3d00, 0x3e00, 0x4000, 0x4300, 0x4e00] {
            assert!(!tells(ax), "{ax:04x}");
        }
    }

    #[test]
    fn a_path_is_made_whole() {
        let mut system = System::new();

        system.files.drive = 'C';
        assert_eq!(system.whole_path(b"\\ORACLE\\A.TXT"), b"C:\\ORACLE\\A.TXT");
        assert_eq!(system.whole_path(b"a.txt"), b"C:\\a.txt");
        assert_eq!(system.whole_path(b"d:x"), b"D:\\x");

        system.files.set_current('C', "C:\\WINDOWS\\".to_string());
        assert_eq!(system.whole_path(b"x.txt"), b"C:\\WINDOWS\\x.txt");
        assert_eq!(system.whole_path(b"C:/x"), b"C:/x");
    }

    #[test]
    fn a_change_is_noted_only_with_a_procedure_set() {
        let mut system = System::new();

        system.note_file_change(0x3c00, b"\\A", None);
        assert!(system.kernel_calls.file_cdr.due.is_empty());

        system.kernel_calls.file_cdr.proc = 0x0017_0010;
        system.note_file_change(0x5600, b"\\A", Some(b"B"));
        assert_eq!(
            system.kernel_calls.file_cdr.due,
            [(0x5600, b"C:\\A\0B".to_vec())]
        );
    }
}
