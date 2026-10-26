//! KERNEL's calls answered beside its memory, modules and files: `Catch`
//! and `Throw`, `FileCdr`, and temporary files' names.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

mod catch_throw;
mod code;
pub mod file_cdr;
mod retail;
pub(crate) mod tasks;
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
        "IsTask" => Implementation::Sync(tasks::is_task),
        "GetCodeHandle" => Implementation::Sync(code::get_code_handle),
        "GetCodeInfo" => Implementation::Sync(code::get_code_info),
        "GetHeapSpaces" => Implementation::Sync(code::get_heap_spaces),
        "GetLastDiskChange" => Implementation::Sync(code::get_last_disk_change),
        "MemoryFreed" => Implementation::Sync(code::memory_freed),
        "SetSwapAreaSize" => Implementation::Sync(code::set_swap_area_size),
        "SetTaskSignalProc" => Implementation::Sync(code::set_task_signal_proc),
        "GlobalLRUOldest" | "GlobalLRUNewest" => Implementation::Sync(code::global_lru),
        "GetTaskQueue" => Implementation::Sync(tasks::get_task_queue),
        "SetTaskQueue" => Implementation::Sync(tasks::set_task_queue),
        "PostEvent" => Implementation::Sync(tasks::post_event),
        "SetPriority" => Implementation::Sync(tasks::set_priority),
        "GetCurrentPDB" => Implementation::Sync(tasks::get_current_pdb),
        "GetTaskDS" => Implementation::Sync(tasks::get_task_ds),
        "GetTaskQueueDS" => Implementation::Sync(tasks::get_task_queue_ds),
        "GetTaskQueueES" => Implementation::Sync(tasks::get_task_queue_es),
        "GetExeVersion" => Implementation::Sync(tasks::get_exe_version),
        "GetAppCompatFlags" => Implementation::Sync(tasks::get_app_compat_flags),
        "GetExePtr" => Implementation::Sync(tasks::get_exe_ptr),
        "IsSharedSelector" => Implementation::Sync(tasks::is_shared_selector),
        "GlobalHandleNoRIP" => return crate::kernel::implementation("GlobalHandle"),
        "EnableDos"
        | "DisableDos"
        | "EnableKernel"
        | "KbdRst"
        | "_DEBUGOUTPUT"
        | "K329"
        | "ValidateCodeSegments"
        | "LogError"
        | "LogParamError" => Implementation::Sync(retail::nothing),
        "LimitEmsPages" | "GetCurPID" => Implementation::Sync(retail::nought),
        "GetWinDebugInfo" | "SetWinDebugInfo" | "DiagQuery" => {
            Implementation::Sync(retail::nought_word)
        }
        "FatalExitHook" => Implementation::Sync(retail::fatal_exit_hook),
        "GetFreeMemInfo" => Implementation::Sync(retail::get_free_mem_info),
        "Reserved5" => Implementation::Sync(retail::reserved5),
        _ => return None,
    })
}
