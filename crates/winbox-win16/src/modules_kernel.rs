//! KERNEL's functions over modules, tasks and selectors: libraries loaded
//! and let go, procedures' addresses and instances, the task's own
//! questions, and selectors given out, aliased and asked about.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::{index_for, segment_selector};
use winbox_ne::Executable;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::kernel::start_libraries;
use crate::linker::kernel_constant;
use crate::system::{STEP, System};

/// How many `MakeProcInstance` thunks a block holds.
pub const THUNKS: usize = 512;

/// Modules winbox.js has only as stubs.
const STUBS_ONLY: [&str; 1] = ["COMMDLG"];

/// A string argument as the TypeScript engine reads one: nought for a null
/// pointer, a number where its segment is nought, else the string.
enum Name {
    Null,
    Number(u16),
    Text(String),
}

fn name_at(system: &System, far: u32) -> Name {
    match (far >> 16, far & 0xffff) {
        (0, 0) => Name::Null,
        (0, number) => Name::Number(number as u16),
        _ => Name::Text(
            system
                .read_string(far)
                .iter()
                .map(|&byte| char::from(byte))
                .collect(),
        ),
    }
}

/// Its argument's segment, locked: the segment, `FFFFh` for the caller's
/// own data as it is given. A discardable segment is counted up, no
/// further than `FFh`; any other is not counted (seg1 `0f1e`). See
/// `System::global_pointer`.
pub fn lock_segment(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let segment = args.word(system);
    let index = index_for(match segment {
        0xffff => system.cpu.segments[winbox_cpu::DS].selector,
        segment => segment,
    });

    if system.is_discardable(index) {
        system.lock_up_to_ceiling(index);
    }

    Ok(Answer::Word(segment))
}

/// A discardable segment counted down, and the count left in CX (seg1
/// `0f37`); AX as it was. Any other is not counted, and CX is left nought:
/// Windows leaves the block's arena flags and count in it (seg1 `2572`),
/// which nothing has recorded for a program's segment. `FFFFh` is the
/// caller's own data segment.
pub fn unlock_segment(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(match args.word(system) {
        0xffff => system.cpu.segments[winbox_cpu::DS].selector,
        segment => segment,
    });
    let count = if system.is_discardable(index) {
        system.lock_down(index)
    } else {
        0
    };

    system.cpu.regs[winbox_cpu::CX] = u16::from(count);
    Ok(Answer::Nothing)
}

pub fn get_current_task(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.task_handle))
}

/// The tasks running: the one.
pub fn get_num_tasks(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let running = if system.ended { 0 } else { system.task_count() };

    Ok(Answer::Word(running as u16))
}

/// A library's count; a program's instances running; a kept module's 1.
pub fn get_module_usage(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(match system.handles.resolve(handle) {
        Some(Object::Library(module)) => system.modules[module].usage as u16,
        Some(Object::Task(program)) => system.running_instances(program) as u16,
        // Anything else it can name, 1, as the TypeScript engine answers.
        Some(_) => 1,
        None => 0,
    }))
}

pub fn get_dos_environment(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let environment = system.task.as_ref().map_or(0, |task| task.environment);

    Ok(Answer::Dword(
        u32::from(segment_selector(environment)) << 16,
    ))
}

/// A drive's kind: removable, 2, or fixed, 3; nought for none.
pub fn get_drive_type(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let drive = args.signed(system);

    if !(0..=25).contains(&drive) || !system.files.mounted(char::from(b'A' + drive as u8)) {
        return Ok(Answer::Word(0));
    }

    let letter = char::from(b'A' + drive as u8);

    Ok(Answer::Word(if system.files.removable(letter) {
        2
    } else {
        3
    }))
}

fn alias_of(system: &mut System, selector: u16, code: bool) -> u16 {
    let index = index_for(selector);

    if index == 0 {
        return 0;
    }

    system
        .descriptors
        .alias(&mut system.cpu.bus, index, code)
        .map_or(0, segment_selector)
}

pub fn alloc_ds_to_cs_alias(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Word(alias_of(system, selector, true)))
}

pub fn alloc_cs_to_ds_alias(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Word(alias_of(system, selector, false)))
}

/// A selector: a data alias of one given, or a blank one for nought.
pub fn alloc_selector(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let made = if index == 0 {
        system.descriptors.blank(&mut system.cpu.bus, 1)
    } else {
        system.descriptors.alias(&mut system.cpu.bus, index, false)
    };

    Ok(Answer::Word(made.map_or(0, segment_selector)))
}

pub fn presto_chango_selector(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.word(system);
    let destination = args.word(system);
    let (from, to) = (index_for(source), index_for(destination));

    if from == 0 || to == 0 {
        return Ok(Answer::Word(0));
    }

    system
        .descriptors
        .copy_swapped(&mut system.cpu.bus, from, to);
    Ok(Answer::Word(destination))
}

pub fn free_selector(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let index = index_for(selector);

    if index == 0 {
        return Ok(Answer::Word(selector));
    }

    system.descriptors.release(&mut system.cpu.bus, index);
    Ok(Answer::Word(0))
}

pub fn get_selector_base(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Dword(
        system
            .peek_descriptor(selector)
            .map_or(0, |descriptor| descriptor.base),
    ))
}

pub fn get_selector_limit(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Dword(
        system
            .peek_descriptor(selector)
            .map_or(0, |descriptor| descriptor.limit),
    ))
}

/// A procedure's address in a module, by its name or its ordinal: a
/// library's or the program's own entry points; a kept module's stub, or
/// its number for an export that is one.
pub fn get_proc_address(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let name = name_at(system, args.dword(system));

    Ok(Answer::Dword(proc_address(system, handle, &name)))
}

/// A procedure's address in a module by its name, as `GetProcAddress`
/// finds it: USER finds a driver's `DriverProc` so.
pub(crate) fn proc_named(system: &mut System, handle: u16, name: &str) -> u32 {
    proc_address(system, handle, &Name::Text(name.to_string()))
}

fn proc_address(system: &mut System, handle: u16, name: &Name) -> u32 {
    let module = match system.handles.resolve(handle) {
        Some(Object::Task(program)) => Some(program),
        Some(Object::Library(module)) => Some(module),
        Some(Object::Kept(kept)) => return kept_proc(system, kept, name),
        _ => None,
    };
    let Some(module) = module else {
        return 0;
    };
    let module = &system.modules[module];
    let ordinal = match name {
        Name::Text(text) => module.executable.ordinal_of(text),
        Name::Number(number) => *number,
        Name::Null => 0,
    };

    module.lookup(ordinal).map_or(0, |(segment, offset)| {
        u32::from(segment_selector(segment)) << 16 | u32::from(offset)
    })
}

fn kept_proc(system: &mut System, kept: usize, name: &Name) -> u32 {
    let module = system.kept[kept].module;
    let ordinal = match name {
        Name::Text(text) => module.ordinal_of(text),
        Name::Number(number) => *number,
        Name::Null => 0,
    };

    if ordinal == 0 || module.export(ordinal).is_none() {
        return 0;
    }

    if module.name == "KERNEL"
        && let Some(constant) = kernel_constant(ordinal, system.coprocessor)
    {
        return u32::from(constant);
    }

    let stubs = system.stubs(kept);

    u32::from(segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

/// A procedure of a program given its data segment: a thunk of `MOV AX,
/// <its data's selector>` and a far jump to it, in a block of KERNEL's.
/// A library's procedure, or one with no task, is answered as it is.
pub fn make_proc_instance(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let procedure = args.dword(system);
    let instance = args.word(system);
    let Some(Object::Task(program)) = system.handles.resolve(instance) else {
        return Ok(Answer::Dword(procedure));
    };
    let module = &system.modules[program];

    let Some(data) = module
        .data()
        .filter(|_| module.executable.header.flags & 3 == 2)
    else {
        return Ok(Answer::Dword(procedure));
    };
    let ds = segment_selector(data);

    if system.thunks.1 >= THUNKS {
        let index = system
            .global
            .allocate(
                &mut system.cpu.bus,
                &mut system.descriptors,
                (THUNKS * 8) as u32,
                0x42,
            )
            .ok_or(Stop::Unsupported("no memory for thunks"))?;

        system.thunks = (u32::from(segment_selector(index)) << 16, 0);
    }

    let (block, used) = system.thunks;
    let far = block + 8 * used as u32;
    let [ds_low, ds_high] = ds.to_le_bytes();
    let [p0, p1, p2, p3] = procedure.to_le_bytes();

    system.write_far(far, &[0xb8, ds_low, ds_high, 0xea, p0, p1, p2, p3]);
    system.thunks.1 += 1;
    Ok(Answer::Dword(far))
}

/// Nothing to free: thunks are not given back.
pub fn free_proc_instance(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);
    Ok(Answer::Nothing)
}

/// A library a program loads itself (`sysdirs`, `loadname`): see
/// `load_library`.
pub fn load_library(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let file = {
            let system = engine.system();
            let far = args.dword(&system);

            system
                .read_string(far)
                .iter()
                .map(|&byte| char::from(byte))
                .collect::<String>()
        };

        Ok(Answer::Word(load_library_named(engine, &file).await?))
    })
}

/// A library loaded, as `LoadLibrary` does. **Recorded** by `sysdirs`: a
/// name alone is found in the system directory, and a name is not given
/// `.DLL`; a file not there answers 2, a directory not there 3, a file not
/// a program 20; a library already loaded answers the same handle again,
/// counted once more. A module winbox.js keeps is found by its file's name
/// whether or not the file is there; a module already loaded by its name,
/// the file's before the dot (`loadname`). A name alone is looked for where
/// KERNEL looks (`search.rs`), the task's program's directory fourth
/// (`search`). Its entry point runs at once.
pub(crate) async fn load_library_named(engine: &Engine, text: &str) -> Result<u16, Stop> {
    let slash = [text.rfind('\\'), text.rfind('/'), text.rfind(':')]
        .into_iter()
        .flatten()
        .max();
    let name = slash.map_or(text, |at| &text[at + 1..]).to_string();
    let found = {
        let mut system = engine.system();
        let file_of = |path: &str| path.rsplit('\\').next().unwrap_or("").to_ascii_uppercase();

        // One winbox.js keeps, found by its file's name.
        if let Some(kept) = system.kept.iter().find(|kept| {
            !STUBS_ONLY.contains(&kept.module.name)
                && file_of(kept.module.path) == name.to_ascii_uppercase()
        }) {
            return Ok(kept.instance());
        }

        // One it keeps only once loaded: its sound card's driver, and its
        // MIDI Mapper.
        for module in [&crate::wbsound::MODULE, &crate::wbmapper::MODULE] {
            let file = module.path.rsplit('\\').next().unwrap_or("");

            if name.eq_ignore_ascii_case(file) {
                let kept = system.keep_on_load(module);

                return Ok(system.kept[kept].instance());
            }
        }

        let module_name = name.split('.').next().unwrap_or("").to_ascii_uppercase();

        if !module_name.is_empty() && !system.wants_file(&module_name) {
            if let Some(library) = system.module_named(&module_name)
                && system.modules[library].executable.header.library()
            {
                system.modules[library].usage += 1;
                return Ok(system.modules[library].instance);
            }

            if let Some(kept) = system.kept_named(&module_name) {
                return Ok(system.kept[kept].instance());
            }
        }

        let beside = system.task.as_ref().and_then(|task| {
            let path = &system.modules[task.program].path;

            path.rsplit_once('\\').map(|(folder, _)| folder.to_string())
        });
        let places: Vec<String> = match slash {
            Some(at) => {
                let end = if text.as_bytes()[at] == b':' {
                    at + 1
                } else {
                    at
                };

                vec![if end == 0 {
                    "\\".to_string()
                } else {
                    text[..end].to_string()
                }]
            }
            // A name alone, where KERNEL looks (`search.rs`), the task's
            // program's directory fourth (`search`).
            None => system.search_places(beside.as_deref(), None),
        };
        let mut folder_found = false;
        let mut found = None;

        for place in places {
            // A folder of no drive lists nothing, as the TypeScript engine's
            // finds it: there, and empty.
            if !place.contains(':') || system.files.folder_exists(&place) {
                folder_found = true;
            }

            if let Some(read) = system.files.read_from(&place, &name) {
                found = Some(read);
                break;
            }
        }

        let Some((path, bytes)) = found else {
            return Ok(if slash.is_some() && !folder_found {
                3
            } else {
                2
            });
        };

        // Already loaded from this file: the same handle, counted once more.
        let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();

        if !(STUBS_ONLY.contains(&base.as_str()) && system.wants_file(&base))
            && let Some(library) = system
                .modules
                .iter()
                .position(|module| module.path.eq_ignore_ascii_case(&path))
        {
            if system.modules[library].executable.header.library() {
                system.modules[library].usage += 1;
                return Ok(system.modules[library].instance);
            }

            return Ok(system.modules[library].handle);
        }

        let Ok(executable) = Executable::parse(bytes) else {
            return Ok(20);
        };
        let mut order = Vec::new();
        let library = system.load_found(executable, &base, &path, beside.as_deref(), &mut order);

        (library, order)
    };

    start_libraries(engine, &found.1).await?;
    Ok(engine.system().modules[found.0].instance)
}

/// A library let go, as `FreeLibrary` does. **Recorded** by `freelib`:
/// each load and each import counts, each free counts down, and at nought
/// the library goes -- its name found no more -- and so do the libraries it
/// brought, counted down in their turn. As it goes its `WEP` runs, if it
/// has one and has started, told the library alone is going (nought);
/// documented, not recorded. Its memory is not given back.
pub fn free_library(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let handle = {
            let system = engine.system();

            args.word(&system)
        };

        free_library_handle(engine, handle).await?;
        Ok(Answer::Nothing)
    })
}

pub(crate) async fn free_library_handle(engine: &Engine, handle: u16) -> Result<(), Stop> {
    let (wep, brought) = {
        let mut system = engine.system();
        let Some(Object::Library(library)) = system.handles.resolve(handle) else {
            return Ok(());
        };
        let module = &mut system.modules[library];

        if module.usage == 0 {
            return Ok(());
        }

        module.usage -= 1;

        if module.usage > 0 {
            return Ok(());
        }

        let ordinal = if module.started {
            module.executable.ordinal_of("WEP")
        } else {
            0
        };
        let wep = module.lookup(ordinal).map(|(segment, offset)| {
            u32::from(segment_selector(segment)) << 16 | u32::from(offset)
        });
        let brought = module.brought.clone();
        let brought: Vec<u16> = brought
            .iter()
            .map(|&other| system.modules[other].instance)
            .collect();

        (wep, brought)
    };

    if let Some(wep) = wep {
        engine.call_guest(wep, &[0], &[]).await?;
    }

    {
        let mut system = engine.system();
        let Some(Object::Library(library)) = system.handles.resolve(handle) else {
            return Ok(());
        };
        let module_handle = system.modules[library].handle;

        // Its name, and its file, found no more.
        system.modules[library].name.clear();
        system.modules[library].path.clear();
        system.handles.free(handle);
        system.handles.free(module_handle);
    }

    for other in brought {
        Box::pin(free_library_handle(engine, other)).await?;
    }

    Ok(())
}

impl System {
    /// The libraries a program brought, let go as its task ends, as
    /// `FreeLibrary` lets one go: each counted down, and one at nought gone
    /// -- its name and its file found no more -- and those it brought in
    /// their turn. **Recorded** by `search`: a program's library, loaded as
    /// it started, is found again from its file as the program starts next
    /// time. Not followed: the `WEP` of one going, which would be called
    /// with the task already ended. As `releaseLibraries`.
    pub(crate) fn release_libraries(&mut self, libraries: &[usize]) {
        for &library in libraries {
            let module = &mut self.modules[library];

            if module.usage == 0 {
                continue;
            }

            module.usage -= 1;

            if module.usage > 0 {
                continue;
            }

            let (instance, handle) = (module.instance, module.handle);
            let brought = std::mem::take(&mut module.brought);

            module.name.clear();
            module.path.clear();
            self.handles.free(instance);
            self.handles.free(handle);
            self.release_libraries(&brought);
        }
    }
}

/// The files the task may have open: the most it has asked for, 20 at the
/// least.
pub fn set_handle_count(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let wanted = args.word(system);

    system.handle_count = system.handle_count.max(wanted);
    Ok(Answer::Word(system.handle_count))
}

/// The procedure told when a discardable block is to go, kept by the task.
pub fn global_notify(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let procedure = args.dword(system);

    if let Some(task) = system.task.as_mut() {
        task.global_notify = procedure;
    }

    Ok(Answer::Nothing)
}
