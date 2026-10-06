//! Where KERNEL looks for a file named without a directory: `OpenFile`'s
//! search, which `LoadModule` -- `WinExec` and `LoadLibrary` too -- opens a
//! program or a library through (`KRNL386.EXE` seg2 `1747`), and so a
//! library a module imports as well. **Recorded** by `search`, which puts a
//! copy in each place and deletes the one found, round after round; **read
//! out** of seg1 `5390`:
//!
//! 1. the current directory -- or, with `OF_SEARCH` and a directory named,
//!    that directory;
//! 2. Windows' directory;
//! 3. the system directory;
//! 4. the directory of a module's file: the task's that looks, or, for the
//!    libraries a program being started imports, that program's (seg1
//!    `55a3`, the task being made at data `22a`);
//! 5. each directory of PATH, in the environment of the task that looks
//!    (seg1 `588e`): the variable written `PATH=` exactly, its value cut at
//!    each `;`, an empty one the root of the current drive.
//!
//! The first four are a list (data `0aed`), and one of them that KERNEL
//! takes for one it has looked in already is passed over: of the same
//! length, and the same in all but its last letter, as `repe cmpsb` leaves
//! nothing to count when only the last letter differs (seg1 `5637`). The
//! `search` probe's C:\ORACLE\OWN is passed over from C:\ORACLE\OWX, and
//! not from C:\ORACLE\XWN.
//!
//! Not followed: while Windows starts, before the shell's `InitTask`, the
//! list is the system directory and then Windows' alone (data `0aea`,
//! chosen at seg1 `542f`). The first program winbox.js runs stands for one
//! started from the shell. As `search.ts`.

use crate::system::System;

/// Windows' directory, as KERNEL gives it.
pub(crate) const WINDOWS_DIRECTORY: &str = "C:\\WINDOWS";
/// Windows' system directory, as KERNEL gives it.
pub(crate) const SYSTEM_DIRECTORY: &str = "C:\\WINDOWS\\SYSTEM";

/// A directory as KERNEL keeps it to compare: upper case, no backslash at
/// its end.
fn bare(directory: &str) -> String {
    directory
        .to_ascii_uppercase()
        .trim_end_matches(['\\', '/'])
        .to_string()
}

/// The directory of a module's file, from its path.
pub(crate) fn directory_of(path: &str) -> Option<String> {
    match path.rfind(['\\', '/']) {
        Some(at) if at > 0 => Some(path[..at].to_string()),
        _ => None,
    }
}

/// Whether a name names a directory too: a backslash, a slash or a drive.
pub(crate) fn has_directory(name: &str) -> bool {
    name.contains(['\\', '/', ':'])
}

impl System {
    /// The running task's module's directory, if any.
    pub(crate) fn task_directory(&self) -> Option<String> {
        let task = self.task.as_ref()?;

        directory_of(&self.modules.get(task.program)?.path)
    }

    /// The running task's environment's variables, read from its segment
    /// as the program may have changed them: each up to its nought, to the
    /// nought that ends them.
    pub(crate) fn environment_variables(&self) -> Vec<String> {
        let Some(task) = self.task.as_ref() else {
            return Vec::new();
        };
        let base = (task.environment as u32) << 16;
        let mut variables = Vec::new();
        let mut at = 0u32;

        while at < 0x10000 {
            let mut text = String::new();

            loop {
                let byte = self.cpu.bus.read8(base + at);

                at += 1;

                if byte == 0 {
                    break;
                }

                text.push(char::from(byte));
            }

            if text.is_empty() {
                break;
            }

            variables.push(text);
        }

        variables
    }

    /// The running task's environment block, as a program started from it
    /// is given it: the variables, the nought that ends them, the count and
    /// the path after it, read from its segment.
    pub(crate) fn environment_block(&self) -> Option<Vec<u8>> {
        let task = self.task.as_ref()?;
        let base = (task.environment as u32) << 16;
        let mut bytes: Vec<u8> = Vec::new();
        let mut at = 0u32;

        // The variables, to two noughts in a row (or one at the start).
        while at < 0x10000 {
            let byte = self.cpu.bus.read8(base + at);

            at += 1;
            bytes.push(byte);

            if byte == 0 && (bytes.len() == 1 || bytes[bytes.len() - 2] == 0) {
                break;
            }
        }

        // The count, then the path to its nought.
        bytes.push(self.cpu.bus.read8(base + at));
        bytes.push(self.cpu.bus.read8(base + at + 1));
        at += 2;

        while at < 0x10000 {
            let byte = self.cpu.bus.read8(base + at);

            at += 1;
            bytes.push(byte);

            if byte == 0 {
                break;
            }
        }

        Some(bytes)
    }

    /// PATH's directories, from the running task's environment, as KERNEL
    /// cuts them.
    pub(crate) fn path_directories(&self) -> Vec<String> {
        let Some(variable) = self
            .environment_variables()
            .into_iter()
            .find(|each| each.starts_with("PATH="))
        else {
            return Vec::new();
        };
        let mut directories = Vec::new();
        let mut rest = &variable[5..];

        loop {
            match rest.split_once(';') {
                None => {
                    directories.push(rest.to_string());
                    break;
                }
                Some((directory, after)) => {
                    directories.push(directory.to_string());
                    rest = after;

                    if rest.is_empty() {
                        break;
                    }
                }
            }
        }

        directories
    }

    /// The directories looked in, in order: `first` (the current directory
    /// when none is given), Windows', the system directory and `module`'s,
    /// less any KERNEL takes for one before it; then PATH's.
    pub(crate) fn search_places(&self, module: Option<&str>, first: Option<&str>) -> Vec<String> {
        let current = first.map_or_else(|| self.files.path(), str::to_string);
        let mut kept: Vec<String> = Vec::new();

        for place in [
            Some(current.as_str()),
            Some(WINDOWS_DIRECTORY),
            Some(SYSTEM_DIRECTORY),
            module,
        ]
        .into_iter()
        .flatten()
        {
            let it = bare(place);
            let seen = kept.iter().any(|before| {
                before.len() == it.len()
                    && before[..before.len().saturating_sub(1)] == it[..it.len().saturating_sub(1)]
            });

            if !seen {
                kept.push(it);
            }
        }

        // A directory of PATH is a path given whole or from the current
        // drive's directory; an empty one is `\`, the current drive's root.
        for directory in self.path_directories() {
            let given = if directory.is_empty() {
                "\\".to_string()
            } else {
                directory
            };
            let whole: String = self
                .whole_path(&given.chars().map(|ch| ch as u8).collect::<Vec<u8>>())
                .into_iter()
                .map(char::from)
                .collect();

            kept.push(bare(&whole));
        }

        kept
    }

    /// Whether a file is there, by its whole path.
    fn file_there(&mut self, path: &str) -> bool {
        let Some(handle) = self.files.open(path) else {
            return false;
        };

        self.files.close(handle);
        true
    }

    /// A file named without a directory found where KERNEL looks: its path,
    /// the directory's and the name's, or 2, DOS's error for no file, for
    /// none (seg1 `5903`).
    pub(crate) fn search_file(
        &mut self,
        name: &str,
        module: Option<&str>,
        first: Option<&str>,
    ) -> Result<String, u16> {
        for place in self.search_places(module, first) {
            let path = format!("{place}\\{}", name.to_ascii_uppercase());

            if self.file_there(&path) {
                return Ok(path);
            }
        }

        Err(2)
    }
}
