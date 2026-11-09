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
        "IsWinOldApTask" => Implementation::Sync(is_win_old_ap_task),
        "GetVersion" => Implementation::Sync(get_version),
        "GetExpWinVer" => Implementation::Sync(get_exp_win_ver),
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
        "LocalHandle" => Implementation::Sync(memory::local_handle),
        "LocalFlags" => Implementation::Sync(memory::local_flags),
        "LocalNotify" => Implementation::Sync(memory::local_notify),
        "LocalCountFree" => Implementation::Sync(memory::local_count_free),
        "LocalHeapSize" => Implementation::Sync(memory::local_heap_size),
        "GetInstanceData" => Implementation::Sync(memory::get_instance_data),
        "OutputDebugString" => Implementation::Sync(nothing_shown),
        "FatalAppExit" => Implementation::Async(fatal_app_exit),
        "UndefDynLink" => Implementation::Async(undef_dynlink),
        "IsDBCSLeadByte" => Implementation::Sync(is_dbcs_lead_byte),
        "FatalExit" => Implementation::Async(fatal_exit),
        "GetModuleHandle" => Implementation::Sync(get_module_handle),
        "lstrcpy" => Implementation::Sync(lstrcpy),
        "LSTRCPYN" => Implementation::Sync(lstrcpyn),
        "lstrcat" => Implementation::Sync(lstrcat),
        "lstrlen" => Implementation::Sync(lstrlen),
        "Dos3Call" | "NoHookDosCall" => Implementation::Async(crate::kernel_calls::dos3_call),
        "GetWinFlags" => Implementation::Sync(get_win_flags),
        "GetWindowsDirectory" => Implementation::Sync(get_windows_directory),
        "GetSystemDirectory" => Implementation::Sync(get_system_directory),
        "SetErrorMode" => Implementation::Sync(set_error_mode),
        "IsRomModule" | "IsRomFile" => Implementation::Sync(is_rom),
        "LockSegment" => Implementation::Sync(modules_kernel::lock_segment),
        "UnlockSegment" => Implementation::Sync(modules_kernel::unlock_segment),
        "GetCurrentTask" => Implementation::Sync(crate::kernel_calls::tasks::get_current_task),
        "LockCurrentTask" => Implementation::Sync(crate::lock_input::lock_current_task),
        "IsTaskLocked" => Implementation::Sync(crate::lock_input::is_task_locked),
        "GetNumTasks" => Implementation::Sync(modules_kernel::get_num_tasks),
        "WinExec" => Implementation::Async(crate::tasks::win_exec),
        "LoadModule" => Implementation::Async(crate::tasks::load_module),
        "Yield" => Implementation::Async(crate::tasks::yield_call),
        "OldYield" => Implementation::Async(crate::tasks::old_yield),
        "DirectedYield" => Implementation::Async(crate::tasks::directed_yield),
        "GetModuleUsage" => Implementation::Sync(modules_kernel::get_module_usage),
        "GetDOSEnvironment" => Implementation::Sync(modules_kernel::get_dos_environment),
        "GetDriveType" => Implementation::Sync(modules_kernel::get_drive_type),
        "AllocDSToCSAlias" => Implementation::Sync(modules_kernel::alloc_ds_to_cs_alias),
        "AllocCSToDSAlias" => Implementation::Sync(modules_kernel::alloc_cs_to_ds_alias),
        "AllocSelector" => Implementation::Sync(modules_kernel::alloc_selector),
        "AllocAlias" => Implementation::Sync(modules_kernel::alloc_alias),
        "SetSelectorBase" => Implementation::Sync(modules_kernel::set_selector_base),
        "SetSelectorLimit" => Implementation::Sync(modules_kernel::set_selector_limit),
        "SelectorAccessRights" => Implementation::Sync(modules_kernel::selector_access_rights),
        "AllocSelectorArray" => Implementation::Sync(modules_kernel::alloc_selector_array),
        // KERNEL's ordinals 77 to 80 handed to USER's (`KRNL386.EXE` seg1
        // `83c4`-`83e6`).
        "Reserved1" => return crate::user::implementation("AnsiNext"),
        "Reserved2" => return crate::user::implementation("AnsiPrev"),
        "Reserved3" => return crate::user::implementation("AnsiUpper"),
        "Reserved4" => return crate::user::implementation("AnsiLower"),
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
        "GlobalFix" => Implementation::Sync(memory::global_fix),
        "GlobalUnfix" => Implementation::Sync(memory::global_unfix),
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
        "LoadResource" => Implementation::Async(resources::load_resource),
        "LockResource" => Implementation::Async(resources::lock_resource),
        "SetResourceHandler" => Implementation::Sync(resources::set_resource_handler),
        "ResourceHandler" => Implementation::Sync(resources::resource_handler),
        "AllocResource" => Implementation::Sync(resources::alloc_resource),
        "DirectResAlloc" => Implementation::Sync(resources::direct_res_alloc),
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
        // The same code (`KRNL386.EXE` seg2 `0176`, `018a`).
        "FreeLibrary" | "FreeModule" => Implementation::Async(modules_kernel::free_library),
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

        if !task_heap(&mut engine.system()) {
            return Ok(Answer::Word(0));
        }

        start_libraries(engine, &libraries).await?;
        init_task_registers(&mut engine.system())
    })
}

/// The task's local heap, made as KERNEL's `InitTask` makes it, before the
/// libraries start (`KRNL386.EXE` seg2 `26b2`-`26c5`): `LocalInit` of DS
/// with a start of nought and the size in CX, the heap's size the task
/// started with, unless that is nought. So the heap is at the end of the
/// data segment, ending a byte short of its size -- after the program's
/// own start-up has grown the segment, as a Visual Basic program's does.
/// Whether it was made, or none was asked for; where it cannot be made, `InitTask`
/// fails, answering nought. As `initTask`'s.
fn task_heap(system: &mut System) -> bool {
    let size = system.cpu.regs[CX];

    if size == 0 {
        return true;
    }

    let Some(program) = system.task.as_ref().map(|task| task.program) else {
        return true;
    };
    let Some(data) = system.modules[program].data() else {
        return true;
    };

    system.local_init(data, 0, u32::from(size))
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

/// Windows 3.1 on DOS 6.22.
fn get_version(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0x0616_0a03))
}

/// The Windows version the module of a handle or instance was made for, as
/// `CreateWindow` asks it (`KRNL386.EXE` seg1 `4f02`-`4f27`): `GetExePtr`'s
/// module, its word 3Eh in AX (`System::expected_windows_version`) and its flag
/// 2000h in DX (`System::module_flag_2000`). For a handle of no module, nought
/// in AX and DX as it was. **Recorded** by `lbmark` and `modnum`.
fn get_exp_win_ver(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);

    Ok(match system.expected_windows_version(instance) {
        Some(version) => {
            Answer::Dword(u32::from(system.module_flag_2000(instance)) << 16 | u32::from(version))
        }
        None => Answer::Word(0),
    })
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

    Ok(Answer::Dword(global_handle_of(system, selector)))
}

/// `GlobalHandle`'s answer for a selector or handle: the selector above,
/// the handle below, or nought for no block.
pub(crate) fn global_handle_of(system: &System, selector: u16) -> u32 {
    let index = index_for(selector);

    if system.global.size_of(index) == 0 && system.global.flags_of(index) == 0 {
        return 0;
    }

    // A block in the first megabyte: its handle is its selector
    // (`GlobalDosAlloc`, `kmore`); and so is the global heap's own block,
    // fixed (`GlobalMasterHandle`, `kgaps`).
    if system.kernel_calls.dos_blocks.contains_key(&index)
        || system.kernel_calls.master_block == Some(segment_selector(index))
    {
        let selector = segment_selector(index);

        return u32::from(selector) << 16 | u32::from(selector);
    }

    u32::from(segment_selector(index)) << 16 | u32::from(handle_for(index))
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
    let mut path = String::from_utf8_lossy(&given).into_owned();

    // A name with no drive placed as DOS's function 3Ch, which KERNEL
    // hands it to, places it: in the current directory, the task's own
    // (`curdir`).
    if !path.contains(':') {
        path = system.placed_path(&path);
    }

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

    // DOS's write with DS:DX the buffer (`KRNL386.EXE` seg1 `0c42`): the
    // bytes on from it past offset FFFFh, where its block goes on
    // (`lwrhuge`).
    let bytes = system
        .cpu
        .bus
        .read(system.linear(buffer), usize::from(length));
    let file = system
        .files
        .resolve(usize::from(handle))
        .expect("an open file");

    // Nought bytes is DOS's write with CX nought, which makes the file end
    // where it is (`KRNL386.EXE` seg1 `0c42`, function 40h). Program
    // Manager ends a group file it wrote again so (`PROGMAN.EXE` seg4
    // `05e9`). **Recorded** by `progdde`: a group shorter than before has
    // no bytes of the old one after its end.
    if length == 0 {
        if let Some(at) = file.seek(std::io::SeekFrom::Current(0)) {
            file.truncate(at);
        }

        return Ok(Answer::Word(0));
    }

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
/// a dot; nought for one not loaded, or one of WinBox's own libraries
/// that has a file while it is not in use. A number with no segment is a
/// module's handle or an instance (`module_by_number`).
fn get_module_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);

    if name == 0 {
        return Ok(Answer::Word(0));
    }

    if name >> 16 == 0 {
        return Ok(Answer::Word(module_by_number(system, name as u16)));
    }

    let text = String::from_utf8_lossy(&system.read_string(name)).to_ascii_uppercase();

    Ok(Answer::Word(module_handle_named(system, &text)))
}

/// A module's handle by its name, upper case, or by its file's name where
/// the name has a dot, as `GetModuleHandle` finds it: TOOLHELP's walk of
/// the modules finds them so too.
pub(crate) fn module_handle_named(system: &System, text: &str) -> u16 {
    let wanted = text
        .rsplit(['\\', '/', ':'])
        .next()
        .unwrap_or("")
        .to_string();
    let file_of = |path: &str| path.rsplit('\\').next().unwrap_or("").to_ascii_uppercase();
    let dotted = wanted.contains('.');

    // A module loaded from its file is found before one kept of its name. A
    // program's whose last instance has ended is deleted, its name and its
    // file found no more (`exit_slot`), and a library's at nought so
    // (`delete_library`).
    let named = |module: &crate::loader::Module| {
        if dotted {
            file_of(&module.path) == wanted
        } else {
            module.name.eq_ignore_ascii_case(&wanted)
        }
    };
    let loaded = system.modules.iter().position(named);

    if let Some(module) = loaded {
        return system.modules[module].handle;
    }

    let kept = if dotted {
        system
            .kept
            .iter()
            .find(|kept| file_of(kept.module.path) == wanted)
    } else {
        system.kept_named(&wanted).map(|kept| &system.kept[kept])
    };

    // COMMDLG, VER, LZEXPAND and DDEML are there only while in use: their
    // file's, or counted as their file would be with no file
    // (`own_modules::use_own`): DDEML while a program that imports it runs
    // (**recorded** by `ddewep`).
    kept.map_or(0, |kept| {
        if crate::own_modules::own_with_file(kept.module.name) && kept.usage == 0 {
            0
        } else {
            kept.handle()
        }
    })
}

/// `GetModuleHandle` given a number in the offset, its segment nought:
/// KERNEL hands it to `GetExePtr` (`KRNL386.EXE` seg2 `07c6`, `082e`),
/// which finds the module of a module's handle or an instance -- a
/// program's, a library's, or one WinBox keeps -- and answers its handle,
/// as its name would find it. A task's handle finds nothing (**recorded**
/// by `modnum`), but a program's task is its instance here. As
/// `GetModuleHandle.ts`.
fn module_by_number(system: &System, number: u16) -> u16 {
    match system.handles.resolve_module(number) {
        // A task's own handle -- not its instance's, nor its module's --
        // names no module (**recorded** by `modnum`).
        Some(Object::Task(module))
            if system.handles.lookup(Object::Task(module)) == Some(number) =>
        {
            0
        }
        Some(Object::Task(module) | Object::Library(module)) => system.modules[module].handle,
        Some(Object::Kept(kept)) => {
            let kept = &system.kept[kept];

            if crate::own_modules::own_with_file(kept.module.name) && kept.usage == 0 {
                0
            } else {
                kept.handle()
            }
        }
        _ => 0,
    }
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

/// At most `count` bytes of a string, its nought among them: the
/// destination. As `KRNL386.EXE` does it (seg1 `831f`, ordinal 353): the
/// source's length with its nought, or `count` where that is less --
/// compared unsigned -- and one fewer than that copied forward, a word at a
/// time and then the odd byte, each word read before it is written; then a
/// nought. A count of 1 writes the nought alone; one of nought is 65535
/// bytes, one less than nought, as the code has it.
fn lstrcpyn(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let limit = u32::from(args.word(system));
    let length = (system.read_string(from).len() as u32 + 1).min(0xffff);
    let count = length.min(limit).wrapping_sub(1) & 0xffff;
    let step = |far: u32, at: u32| (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff);
    let mut at = 0;

    while at + 1 < count {
        let word = system.read_far(step(from, at), 2);

        system.write_far(step(to, at), &word);
        at += 2;
    }

    if at < count {
        let byte = system.read_far(step(from, at), 1);

        system.write_far(step(to, at), &byte);
        at += 1;
    }

    system.write_far(step(to, at), &[0]);
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

/// `GetWinFlags`: `System::win_flags`.
pub(crate) fn get_win_flags(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(u32::from(system.win_flags())))
}

impl System {
    /// The flags, as `GetWinFlags` answers them and KERNEL exports them as
    /// `__WINFLAGS`. **Recorded** by `winflags`: 419h in standard mode --
    /// `WF_PMODE`, `WF_STANDARD`, `WF_CPU486`, `WF_80x87` -- and C29h in
    /// 386 enhanced mode (`enhanced/winflags`, `enhanced/dpmiver`) --
    /// `WF_PMODE`, `WF_ENHANCED`, `WF_CPU486`, `WF_80x87`, `WF_PAGING`.
    /// KERNEL sets `WF_PMODE|WF_ENHANCED` or `WF_PMODE|WF_STANDARD` by what
    /// INT 2Fh 1600h answers as it starts (`KRNL386.EXE` seg1
    /// `aa76`-`aa90`). The coprocessor's bit follows the machine's. As
    /// `GetWinFlags.ts`'s `winFlags`.
    #[must_use]
    pub fn win_flags(&self) -> u16 {
        let mode = match self.mode {
            crate::Mode::Standard => 0x0010,
            crate::Mode::Enhanced => 0x0020 | 0x0800,
        };
        let coprocessor = if self.coprocessor { 0x0400 } else { 0 };

        0x0001 | mode | 0x0008 | coprocessor
    }

    /// How much memory the machine has to give, by its mode
    /// (`winbox_machine::Figures`).
    #[must_use]
    pub fn memory_figures(&self) -> winbox_machine::Figures {
        match self.mode {
            crate::Mode::Standard => winbox_machine::Figures::STANDARD,
            crate::Mode::Enhanced => winbox_machine::Figures::ENHANCED,
        }
    }
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

/// Whether a module, or a file, is in ROM: never, on a Windows run from the
/// disk. KERNEL answers nought for each (`KRNL386.EXE` seg2 `1e9b`,
/// `1ea0`). Answered as a stub, AX was left as it was, and VER.DLL took it
/// for a ROM module's selector: Control Panel's Fonts faulted on a font
/// chosen.
fn is_rom(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// How the task wants errors handled: the mode before, nought to begin.
fn set_error_mode(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let mode = args.word(system);

    Ok(Answer::Word(std::mem::replace(
        &mut system.error_mode,
        mode,
    )))
}

/// `OutputDebugString`, which goes to no debugger here: it shows nothing.
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

/// `FatalExit`: `FatalAppExit(0, "Application requested abnormal termination")`
/// in the retail build (`KRNL386.EXE` seg1 `93ce`-`93e4`), the code shown
/// nowhere; the procedure `FatalExitHook` keeps is never called.
fn fatal_exit(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        args.word(&engine.system());
        ended_in_box(engine, b"Application requested abnormal termination").await
    })
}

/// USER's system error box, "Application Error" and the text given (or KERNEL's
/// "Closing current application." for none), its one button Close; then the
/// task ended through DOS with code `FFh` (seg1 `5cdf`-`5d09`, `5c80`-`5cdc`,
/// `5e01`-`5e19`).
fn fatal_app_exit(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let text = {
            let system = engine.system();
            let _action = args.word(&system);
            let far = args.dword(&system);

            if far >> 16 == 0 {
                b"Closing current application.".to_vec()
            } else {
                system.read_string(far)
            }
        };

        ended_in_box(engine, &text).await
    })
}

/// Where KERNEL's loader binds an import it cannot find: `FatalAppExit`'s
/// routine with nought and KERNEL's text at 9BAh of its data (seg1
/// `72d4`-`72eb`). **Recorded** by `undefdl`.
fn undef_dynlink(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { ended_in_box(engine, b"Call to Undefined Dynalink").await })
}

/// The box `FatalAppExit` shows, and the task ended as at `INT 21h` 4Ch.
async fn ended_in_box(engine: &Engine, text: &[u8]) -> Result<Answer, Stop> {
    engine
        .sys_error_box(
            text,
            b"Application Error",
            [
                0,
                crate::sys_error_box::SEB_CLOSE | crate::sys_error_box::SEB_DEFBUTTON,
                0,
            ],
        )
        .await?;

    // USER told, as the task ends (`app_exit.rs`).
    let task = engine.system().task_handle;

    engine.app_exit(task).await?;

    let mut system = engine.system();

    system.exit_code = Some(0xff);

    if system.task_count() > 1 || system.stays_up {
        system.exit_task(0xff);
    } else {
        system.ended = true;
    }

    Err(Stop::Ended)
}

/// Whether a task is `WinOldAp`'s, running a DOS program in a window: bit 0
/// of the word at 48h of its module's database (`KRNL386.EXE` seg1 `7e3e`).
/// winbox.js runs no DOS program so, and every program's is clear: FALSE.
/// The Task List's End Task switches to a window first only where it is
/// not (`TASKMAN.EXE` seg1 `02fb`; `tasklist`).
fn is_win_old_ap_task(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _task = args.word(system);

    Ok(Answer::Word(0))
}
