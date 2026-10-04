//! KERNEL's functions, as far as the Rust engine answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, BP, BX, CX, DI, DS, DX, ES, SI, SP, SS};
use winbox_machine::{handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, Register};
use crate::files_kernel;
use crate::handles::Object;
use crate::memory;
use crate::modules_kernel;
use crate::pointers;
use crate::profiles_kernel;
use crate::resources;
use crate::system::System;

/// `HFILE_ERROR`.
const HFILE_ERROR: u16 = 0xffff;

#[allow(clippy::too_many_lines)]
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "InitTask" => Implementation::Async(init_task),
        "WaitEvent" => Implementation::Sync(wait_event),
        "GetVersion" => Implementation::Sync(get_version),
        "GetModuleFilename" => Implementation::Sync(get_module_filename),
        "GlobalHandle" => Implementation::Sync(global_handle),
        "GlobalSize" => Implementation::Sync(global_size),
        "_lcreat" => Implementation::Async(crate::kernel_calls::lcreat),
        "_lwrite" => Implementation::Sync(lwrite),
        "_lclose" => Implementation::Sync(lclose),
        "GlobalAlloc" => Implementation::Sync(memory::global_alloc),
        "GlobalLock" => Implementation::Sync(memory::global_lock),
        "GlobalUnlock" => Implementation::Sync(memory::global_unlock),
        "GlobalFree" => Implementation::Sync(memory::global_free),
        "GlobalReAlloc" => Implementation::Sync(memory::global_realloc),
        "GlobalFlags" => Implementation::Sync(memory::global_flags),
        "LocalInit" => Implementation::Sync(memory::local_init),
        "LocalAlloc" => Implementation::Sync(memory::local_alloc),
        "LocalFree" => Implementation::Sync(memory::local_free),
        "LocalLock" => Implementation::Sync(memory::local_lock),
        "LocalUnlock" => Implementation::Sync(memory::local_unlock),
        "LocalSize" => Implementation::Sync(memory::local_size),
        "LocalReAlloc" => Implementation::Sync(memory::local_realloc),
        "LocalCompact" => Implementation::Sync(memory::local_compact),
        "LocalShrink" => Implementation::Sync(memory::local_shrink),
        "LocalHandle" | "LocalFlags" => Implementation::Sync(memory::local_nought),
        "OutputDebugString" | "FatalAppExit" => Implementation::Sync(nothing_shown),
        "IsDBCSLeadByte" => Implementation::Sync(is_dbcs_lead_byte),
        "FatalExit" => Implementation::Async(fatal_exit),
        "GetModuleHandle" => Implementation::Sync(get_module_handle),
        "lstrcpy" => Implementation::Sync(lstrcpy),
        "lstrcat" => Implementation::Sync(lstrcat),
        "lstrlen" => Implementation::Sync(lstrlen),
        "Dos3Call" => Implementation::Async(crate::kernel_calls::dos3_call),
        "GetWinFlags" => Implementation::Sync(get_win_flags),
        "GetWindowsDirectory" => Implementation::Sync(get_windows_directory),
        "GetSystemDirectory" => Implementation::Sync(get_system_directory),
        "SetErrorMode" => Implementation::Sync(set_error_mode),
        "LockSegment" => Implementation::Sync(modules_kernel::lock_segment),
        "UnlockSegment" => Implementation::Sync(modules_kernel::unlock_segment),
        "GetCurrentTask" => Implementation::Sync(modules_kernel::get_current_task),
        "GetNumTasks" => Implementation::Sync(modules_kernel::get_num_tasks),
        "WinExec" => Implementation::Async(crate::tasks::win_exec),
        "LoadModule" => Implementation::Async(crate::tasks::load_module),
        "Yield" => Implementation::Async(crate::tasks::yield_call),
        "DirectedYield" => Implementation::Async(crate::tasks::directed_yield),
        "GetModuleUsage" => Implementation::Sync(modules_kernel::get_module_usage),
        "GetDOSEnvironment" => Implementation::Sync(modules_kernel::get_dos_environment),
        "GetDriveType" => Implementation::Sync(modules_kernel::get_drive_type),
        "AllocDSToCSAlias" => Implementation::Sync(modules_kernel::alloc_ds_to_cs_alias),
        "AllocCSToDSAlias" => Implementation::Sync(modules_kernel::alloc_cs_to_ds_alias),
        "AllocSelector" => Implementation::Sync(modules_kernel::alloc_selector),
        "PrestoChangoSelector" => Implementation::Sync(modules_kernel::presto_chango_selector),
        "FreeSelector" => Implementation::Sync(modules_kernel::free_selector),
        "GetSelectorBase" => Implementation::Sync(modules_kernel::get_selector_base),
        "GetSelectorLimit" => Implementation::Sync(modules_kernel::get_selector_limit),
        "GetProcAddress" => Implementation::Sync(modules_kernel::get_proc_address),
        "MakeProcInstance" => Implementation::Sync(modules_kernel::make_proc_instance),
        "FreeProcInstance" => Implementation::Sync(modules_kernel::free_proc_instance),
        "LoadLibrary" => Implementation::Async(modules_kernel::load_library),
        "GlobalWire" => Implementation::Sync(memory::global_wire),
        "GlobalUnwire" => Implementation::Sync(memory::global_unwire),
        "OpenFile" => Implementation::Async(crate::kernel_calls::open_file),
        "IsBadReadPtr" => Implementation::Sync(pointers::is_bad_read_ptr),
        "IsBadWritePtr" => Implementation::Sync(pointers::is_bad_write_ptr),
        "IsBadHugeReadPtr" => Implementation::Sync(pointers::is_bad_huge_read_ptr),
        "IsBadHugeWritePtr" => Implementation::Sync(pointers::is_bad_huge_write_ptr),
        "IsBadCodePtr" => Implementation::Sync(pointers::is_bad_code_ptr),
        "IsBadStringPtr" => Implementation::Sync(pointers::is_bad_string_ptr),
        "GetFreeSpace" => Implementation::Sync(pointers::get_free_space),
        "GlobalCompact" => Implementation::Sync(pointers::global_compact),
        "LocalHandleDelta" => Implementation::Sync(pointers::local_handle_delta),
        "FindResource" => Implementation::Sync(resources::find_resource),
        "LoadResource" => Implementation::Sync(resources::load_resource),
        "LockResource" => Implementation::Sync(resources::lock_resource),
        "FreeResource" => Implementation::Sync(resources::free_resource),
        "AccessResource" => Implementation::Sync(resources::access_resource),
        "SizeofResource" => Implementation::Sync(resources::sizeof_resource),
        "GetProfileInt" => Implementation::Sync(profiles_kernel::get_profile_int),
        "GetProfileString" => Implementation::Sync(profiles_kernel::get_profile_string),
        "WriteProfileString" => Implementation::Sync(profiles_kernel::write_profile_string),
        "GetPrivateProfileInt" => Implementation::Sync(profiles_kernel::get_private_profile_int),
        "GetPrivateProfileString" => {
            Implementation::Sync(profiles_kernel::get_private_profile_string)
        }
        "WritePrivateProfileString" => {
            Implementation::Sync(profiles_kernel::write_private_profile_string)
        }
        "_lopen" => Implementation::Sync(files_kernel::lopen),
        "_lread" => Implementation::Sync(files_kernel::lread),
        "_llseek" => Implementation::Sync(files_kernel::llseek),
        "_HREAD" => Implementation::Sync(files_kernel::hread),
        "_HWRITE" => Implementation::Sync(files_kernel::hwrite),
        "HMEMCPY" => Implementation::Sync(files_kernel::hmemcpy),
        "GlobalPageLock" => Implementation::Sync(memory::global_page_lock),
        "GlobalPageUnlock" => Implementation::Sync(memory::global_page_unlock),
        "SetHandleCount" => Implementation::Sync(modules_kernel::set_handle_count),
        "GlobalNotify" => Implementation::Sync(modules_kernel::global_notify),
        "FreeLibrary" => Implementation::Async(modules_kernel::free_library),
        _ => {
            return crate::atoms::kernel_implementation(name)
                .or_else(|| crate::kernel_calls::implementation(name));
        }
    })
}

/// The task's start, as a program's start-up calls it: its libraries'
/// entry points run, the stack's three words written in the data
/// segment's header, the registers `WinMain` is given, and a nought pushed
/// under the return address for a walk of the stack's frames.
fn init_task(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let libraries = engine
            .system()
            .task
            .as_ref()
            .map(|task| task.libraries.clone())
            .unwrap_or_default();

        start_libraries(engine, &libraries).await?;
        init_task_registers(&mut engine.system())
    })
}

/// The entry point of each library the task loaded that has not run yet,
/// in the order they were loaded, as KERNEL calls one (`KRNL386.EXE` seg2
/// `24a0`): DS and DX its data segment, DI its instance, CX its heap's
/// size, ES:SI no command line, AX 1.
pub(crate) async fn start_libraries(engine: &Engine, libraries: &[usize]) -> Result<(), Stop> {
    loop {
        let next = {
            let mut system = engine.system();
            let libraries = libraries.to_vec();
            let Some(library) = libraries
                .into_iter()
                .find(|&library| !system.modules[library].started)
            else {
                break;
            };
            let module = &mut system.modules[library];

            module.started = true;

            let header = &module.executable.header;
            let Some(cs) = module.translate(header.entry_cs) else {
                continue;
            };
            let ds = module.data().map_or(0, segment_selector);
            let procedure = u32::from(segment_selector(cs)) << 16 | u32::from(header.entry_ip);

            (
                procedure,
                [
                    Register::Segment(DS, ds),
                    Register::Word(DX, ds),
                    Register::Word(DI, module.instance),
                    Register::Word(CX, header.initial_heap_size),
                    Register::Segment(ES, 0),
                    Register::Word(SI, 0),
                    Register::Word(AX, 1),
                ],
            )
        };

        engine.call_guest(next.0, &[], &next.1).await?;
    }

    Ok(())
}

fn init_task_registers(system: &mut System) -> Result<Answer, Stop> {
    let task = system
        .task
        .clone()
        .ok_or(Stop::Unsupported("InitTask with no task"))?;
    let module = &system.modules[task.program];
    let data = segment_selector(module.data().ok_or(Stop::Unsupported("no data segment"))?);

    // The instance is the data segment's handle, one below its selector
    // (`instds`), and both name the task.
    system
        .handles
        .alias_at(data - 1, Object::Task(task.program));
    system.handles.alias_at(data, Object::Task(task.program));

    let cpu = &mut system.cpu;
    let stack = cpu.segments[SS].base;
    let sp = cpu.regs[SP];

    // As KRNL386.EXE seg2 `268d` writes them: the stack's bottom and the
    // lowest it has reached where the stack pointer is with the return
    // address taken off, and its limit that less the stack's size, in BX
    // as the task started, and 96h more (`stackpos`). The limit in CX.
    let bottom = sp.wrapping_add(4);
    let limit = bottom.wrapping_sub(cpu.regs[BX]).wrapping_add(0x96);

    cpu.bus.write16(stack + 0x0a, limit);
    cpu.bus.write16(stack + 0x0c, bottom);
    cpu.bus.write16(stack + 0x0e, bottom);

    cpu.load_segment(DS, data).map_err(Stop::Processor)?;
    cpu.load_segment(ES, segment_selector(task.program_segment))
        .map_err(Stop::Processor)?;
    // The command line's offset in the prefix.
    cpu.regs[BX] = 0x81;
    cpu.regs[CX] = limit;
    // The instance: the data segment's handle, one below its selector
    // (`instds`).
    cpu.regs[DI] = data - 1;
    cpu.regs[SI] = task.previous;
    cpu.regs[DX] = task.show;
    cpu.regs[BP] = sp;

    let at = |sp: u16| stack + u32::from(sp);
    let return_ip = cpu.bus.read16(at(sp));
    let return_cs = cpu.bus.read16(at(sp.wrapping_add(2)));

    cpu.bus.write16(at(sp.wrapping_add(2)), 0);
    cpu.bus.write16(at(sp), return_cs);
    cpu.bus.write16(at(sp.wrapping_sub(2)), return_ip);
    cpu.regs[SP] = sp.wrapping_sub(2);

    Ok(Answer::Word(1))
}

/// Nothing waited for: nought.
fn wait_event(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}

/// Windows 3.1 on DOS 6.22.
fn get_version(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0x0616_0a03))
}

/// A module's file, as far as the buffer holds it with its nought: a kept
/// module's, a loaded one's, else the task's program's.
fn get_module_filename(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let path = system.path_of(instance);

    if size == 0 {
        return Ok(Answer::Word(0));
    }

    let room = if size > 0 { size as usize - 1 } else { 0 };
    let count = path.len().min(room);
    let mut bytes = path.as_bytes()[..count].to_vec();

    bytes.push(0);
    system.write_far(buffer, &bytes);
    Ok(Answer::Word(count as u16))
}

/// The handle and the selector of a block, nought for one never given.
fn global_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let index = index_for(selector);

    if system.global.size_of(index) == 0 && system.global.flags_of(index) == 0 {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(
        u32::from(segment_selector(index)) << 16 | u32::from(handle_for(index)),
    ))
}

fn global_size(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Dword(system.global.size_of(index_for(handle))))
}

/// A file created, or `HFILE_ERROR`.
pub(crate) fn lcreat(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);
    let _attribute = args.word(system);

    if name == 0 {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let given = system.read_string(name);
    let path = String::from_utf8_lossy(&given).into_owned();
    let handle = system
        .files
        .create(&path)
        .map_or(HFILE_ERROR, |handle| handle as u16);

    // Told to `FileCdr`'s procedure as DOS's create, 3C00h.
    if handle != HFILE_ERROR {
        system.note_file_change(0x3c00, &given, None);
    }

    Ok(Answer::Word(handle))
}

/// Bytes written to a file: how many, or `HFILE_ERROR`.
fn lwrite(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let buffer = args.dword(system);
    let length = args.word(system);

    if length > 0xfffe || system.files.resolve(usize::from(handle)).is_none() {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let bytes = system.read_far(buffer, usize::from(length));
    let file = system
        .files
        .resolve(usize::from(handle))
        .expect("an open file");

    Ok(Answer::Word(file.write(&bytes) as u16))
}

fn lclose(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(if system.files.close(usize::from(handle)) {
        0
    } else {
        HFILE_ERROR
    }))
}

/// A module's handle by its name, or by its file's name where the name has
/// a dot; nought for one not loaded, or one winbox.js keeps only as names
/// until its file is loaded.
fn get_module_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);

    // Nought, or a number in a pointer's place.
    if name >> 16 == 0 {
        return Ok(Answer::Word(0));
    }

    let text = String::from_utf8_lossy(&system.read_string(name)).to_ascii_uppercase();
    let wanted = text
        .rsplit(['\\', '/', ':'])
        .next()
        .unwrap_or("")
        .to_string();
    let file_of = |path: &str| path.rsplit('\\').next().unwrap_or("").to_ascii_uppercase();
    let dotted = wanted.contains('.');

    // A module loaded from its file is found before one kept of its name.
    let loaded = if dotted {
        system
            .modules
            .iter()
            .position(|module| file_of(&module.path) == wanted)
    } else {
        system.module_named(&wanted)
    };

    if let Some(module) = loaded {
        // The TypeScript engine registers a program with no handle: nought.
        return Ok(Answer::Word(system.modules[module].handle));
    }

    let kept = if dotted {
        system
            .kept
            .iter()
            .find(|kept| file_of(kept.module.path) == wanted)
    } else {
        system.kept_named(&wanted).map(|kept| &system.kept[kept])
    };

    // COMMDLG is kept only as names, until its file is loaded.
    Ok(Answer::Word(kept.map_or(0, |kept| {
        if kept.module.name.eq_ignore_ascii_case("COMMDLG") {
            0
        } else {
            kept.handle()
        }
    })))
}

/// A string copied, its nought too: the destination.
fn lstrcpy(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let mut bytes = system.read_string(from);

    bytes.push(0);
    system.write_far(to, &bytes);
    Ok(Answer::Dword(to))
}

/// A string put after another: the first.
fn lstrcat(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let end = system.read_string(to).len() as u32;
    let mut bytes = system.read_string(from);

    bytes.push(0);
    system.write_far((to & 0xffff_0000) | (to.wrapping_add(end) & 0xffff), &bytes);
    Ok(Answer::Dword(to))
}

fn lstrlen(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let string = args.dword(system);

    Ok(Answer::Word(system.read_string(string).len() as u16))
}

/// Standard mode, a 486, and the coprocessor's bit as the machine has one:
/// `WF_PMODE`, `WF_STANDARD`, `WF_CPU486`, `WF_80x87`.
fn get_win_flags(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let coprocessor = if system.coprocessor { 0x0400 } else { 0 };

    Ok(Answer::Dword(0x0001 | 0x0010 | 0x0008 | coprocessor))
}

/// A directory's path copied where it fits with its nought: its length;
/// where it does not, the room it needs.
fn directory(system: &mut System, args: &mut Args, path: &str) -> Answer {
    let buffer = args.dword(system);
    let size = usize::from(args.word(system));

    if size < path.len() + 1 {
        return Answer::Word(path.len() as u16 + 1);
    }

    system.copy_text(path.as_bytes(), buffer, size);
    Answer::Word(path.len() as u16)
}

fn get_windows_directory(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(directory(system, args, "C:\\WINDOWS"))
}

fn get_system_directory(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(directory(system, args, "C:\\WINDOWS\\SYSTEM"))
}

/// How the task wants errors handled: the mode before, nought to begin.
fn set_error_mode(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let mode = args.word(system);

    Ok(Answer::Word(std::mem::replace(
        &mut system.error_mode,
        mode,
    )))
}

/// The debugging calls, which go to no debugger here: `OutputDebugString`
/// shows nothing, and `FatalAppExit` shows no box and goes on, as the
/// TypeScript engine answers them.
fn nothing_shown(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

/// Whether a byte begins a two-byte character. **Read out of
/// `KRNL386.EXE`** (seg1 `8425`): this build answers FALSE for every byte,
/// without looking at it -- it has no lead bytes.
fn is_dbcs_lead_byte(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}

/// `FatalExit`: the program halted, never to be resumed, as the TypeScript
/// engine halts it -- here it waits for ever.
fn fatal_exit(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        loop {
            engine.wait_for_wake(None).await;
        }
    })
}
