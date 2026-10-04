//! KERNEL's calls answered beside its memory, modules and files: `Catch`
//! and `Throw`, `FileCdr`, and temporary files' names.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

mod catch_throw;
pub mod file_cdr;
mod temp_files;

pub(crate) use file_cdr::{dos3_call, lcreat, open_file, tells};
pub use temp_files::temp_drive;

use crate::call::Implementation;

/// What KERNEL keeps for these calls.
#[derive(Debug, Clone, Default)]
pub struct KernelCalls {
    pub file_cdr: file_cdr::FileCdr,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "FileCdr" => Implementation::Sync(file_cdr::file_cdr),
        "Catch" => Implementation::Sync(catch_throw::catch),
        "Throw" => Implementation::Sync(catch_throw::throw),
        "GetTempDrive" => Implementation::Sync(temp_files::get_temp_drive),
        "GetTempFileName" => Implementation::Sync(temp_files::get_temp_file_name),
        _ => return None,
    })
}
