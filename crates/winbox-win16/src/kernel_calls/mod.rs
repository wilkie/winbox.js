//! KERNEL's calls answered beside its memory, modules and files: `Catch`
//! and `Throw`, `FileCdr`, and temporary files' names.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

mod catch_throw;
mod code;
pub mod file_cdr;
pub(crate) mod more;
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
    /// The blocks `GlobalDosAlloc` gave, by their descriptor index: their
    /// paragraph and paragraphs.
    pub dos_blocks: std::collections::BTreeMap<usize, (u16, u16)>,
    /// The word at 23Eh of KERNEL's data: the handle tables made.
    pub handle_tables: u16,
    /// The tasks waiting in `WaitEvent`: the task whose event each waits
    /// for, and its slot.
    pub event_waiters: Vec<(u16, usize)>,
    /// The resource handlers programs set, by owner and type
    /// (`resources.rs`).
    pub resource_handlers: std::collections::HashMap<(crate::handles::Owner, usize), u32>,
    /// KERNEL's own handler's address, as `SetResourceHandler` last made it.
    pub default_resource_handler: u32,
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
        "WaitEvent" => Implementation::Async(tasks::wait_event),
        "SetPriority" => Implementation::Sync(tasks::set_priority),
        "GetCurrentPDB" => Implementation::Sync(tasks::get_current_pdb),
        "GetTaskDS" => Implementation::Sync(tasks::get_task_ds),
        "GetTaskQueueDS" => Implementation::Sync(tasks::get_task_queue_ds),
        "GetTaskQueueES" => Implementation::Sync(tasks::get_task_queue_es),
        "GetExeVersion" => Implementation::Sync(tasks::get_exe_version),
        "GetAppCompatFlags" => Implementation::Sync(tasks::get_app_compat_flags),
        "GetExePtr" => Implementation::Sync(tasks::get_exe_ptr),
        "IsSharedSelector" => Implementation::Sync(tasks::is_shared_selector),
        "GetLPErrMode" => Implementation::Sync(more::get_lp_err_mode),
        "LONGPTRADD" => Implementation::Sync(more::long_ptr_add),
        "NetBiosCall" => Implementation::Sync(more::net_bios_call),
        "DefineHandleTable" => Implementation::Sync(more::define_handle_table),
        "GlobalDosAlloc" => Implementation::Sync(more::global_dos_alloc),
        "GlobalDosFree" => Implementation::Sync(more::global_dos_free),
        "GlobalFreeAll" => Implementation::Sync(more::global_free_all),
        "CallProcInstance" => Implementation::Sync(more::call_proc_instance),
        "SwitchStackTo" => Implementation::Sync(more::switch_stack_to),
        "SwitchStackBack" => Implementation::Sync(more::switch_stack_back),
        "OpenPathName" => Implementation::Async(more::open_path_name),
        "DeletePathName" => Implementation::Async(more::delete_path_name),
        "GlobalHandleNoRIP" => return crate::kernel::implementation("GlobalHandle"),
        "EnableDos"
        | "DisableDos"
        | "EnableKernel"
        | "KbdRst"
        | "_DEBUGOUTPUT"
        | "K329"
        | "ValidateCodeSegments"
        | "LogError"
        | "LogParamError"
        | "DebugBreak" => Implementation::Sync(retail::nothing),
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
