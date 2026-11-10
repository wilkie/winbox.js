//! KERNEL's functions over modules, tasks and selectors: libraries loaded
//! and let go, procedures' addresses and instances, the task's own
//! questions, and selectors given out, aliased and asked about.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::{Descriptors, index_for, segment_selector};
use winbox_ne::Executable;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::kernel::start_libraries;
use crate::linker::kernel_constant;
use crate::loader::Held;
use crate::system::{STEP, System};

/// How many `MakeProcInstance` thunks a block holds.
pub const THUNKS: usize = 512;

/// Modules winbox.js keeps whose file is loaded beside them when there is
/// one (`own_modules.rs`).
const STUBS_ONLY: [&str; 6] = crate::own_modules::OWN_WITH_FILE;

/// A string argument: nought for a null pointer, a number where its segment
/// is nought, else the string.
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

/// The tasks running: the one.
pub fn get_num_tasks(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let running = if system.ended { 0 } else { system.task_count() };

    Ok(Answer::Word(running as u16))
}

/// A library's count; a program's instances running; a kept module's 1.
pub fn get_module_usage(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(module_usage(system, handle)))
}

/// A module's count, as `GetModuleUsage` answers it.
pub(crate) fn module_usage(system: &System, handle: u16) -> u16 {
    match system.handles.resolve_module(handle) {
        Some(Object::Library(module)) => system.modules[module].usage as u16,
        // One of WinBox's own with no file: counted as its file would be.
        Some(Object::Kept(kept))
            if crate::own_modules::own_with_file(system.kept[kept].module.name) =>
        {
            system.kept[kept].usage as u16
        }
        Some(Object::Task(program)) => system.running_instances(program) as u16,
        // Anything else it can name, 1.
        Some(_) => 1,
        None => 0,
    }
}

pub fn get_dos_environment(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let environment = system.task.as_ref().map_or(0, |task| task.environment);

    Ok(Answer::Dword(
        u32::from(segment_selector(environment)) << 16,
    ))
}

/// A drive's kind, as KERNEL asks SYSTEM.DRV's `InquireSystem` for it
/// (`SYSTEM.DRV` seg1 `0002`-`0169`, code 1): nought for none,
/// `DRIVE_REMOVABLE` (2), `DRIVE_FIXED` (3) or `DRIVE_REMOTE` (4).
///
/// * A drive DOS will not select (0Eh then 19h, `0031`-`005c`) is nought:
///   one not mounted here. (DOSBox selects A: and B: whether or not
///   anything is mounted, `dos_files.cpp` 56; a session here without A:
///   has no drive A: at all.)
/// * IOCTL 4409h succeeding with bit 12 of DX, remote: 4 (`0079`-`0090`).
/// * 4408h (`0092`-`00b8`): AX bit 0, fixed, 3; else removable, 2 -- but
///   for A: or B: only where the BIOS's equipment word says a floppy drive
///   is there (`[0Bh]` bit 0, from `INT 11h` at `01fe`-`020b`), else
///   nought. 4408h failing (`00e5`-`00f9`): the number of floppy drives
///   less one (`[0Ah]`, equipment bits 6-7), nought taken as one, below
///   the drive's number 3, else 2.
/// * Then 440Eh (`00bb`-`00e2`): succeeding with AL nought, the kind as it
///   stands; failing (`00fb`-`010b`), for B: with `[0Ah]` nought -- B: the
///   one floppy drive's other letter -- nought (DX 1), else the kind.
///
/// The IOCTL answers are DOS's (`System::drive_ioctl`). DOSBox's BIOS
/// counts a floppy image mounted in its equipment word, none to begin
/// with (`bios.cpp` 1043, `bios_disk.cpp` 219-229): here each floppy disk
/// in its drive (`Files::floppy_disks`). **Recorded** by `drivetyp` and
/// `drvioctl`: A: with nothing in it 2, B: 0, C: and Z: 3; with a floppy
/// image as B: 2, a CD-ROM image as D: 4.
pub fn get_drive_type(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let drive = args.signed(system);

    Ok(Answer::Word(drive_type(system, i32::from(drive))))
}

/// `GetDriveType`'s answer for a drive, nought for A:.
pub fn drive_type(system: &System, drive: i32) -> u16 {
    drive_inquiry(system, drive).0
}

/// What SYSTEM.DRV's `InquireSystem` answers for a drive (code 1): the
/// kind in AX, as `GetDriveType` answers it, and in DX the drive, counted
/// from 1, whose disk this one's letter is another name for -- 1, A:, for
/// B: where there is one floppy drive and 440Eh fails (`00fb`-`010b`),
/// else nought. **Recorded** by `sysdrv`: B: `00010000`.
pub fn drive_inquiry(system: &System, drive: i32) -> (u16, u16) {
    if !(0..=25).contains(&drive) {
        return (0, 0);
    }

    let letter = char::from(b'A' + drive as u8);
    let floppies = system.files.floppy_disks();
    let equipment_floppy = floppies > 0;
    let floppies_less_one = u16::from(floppies >= 2);

    // No drive here; DOSBox's B: with nothing in it, which it selects, is
    // the one floppy drive's other letter all the same.
    if !system.files.mounted(letter) {
        return (0, u16::from(drive == 1 && floppies_less_one == 0));
    }

    let dos = system.files.has_disk(letter);
    let compact_disc = system.files.removable(letter) && system.files.remote(letter);

    if dos && system.files.remote(letter) {
        return (4, 0);
    }

    // 4408h.
    let kind = if !dos || (compact_disc && drive >= 2) {
        if floppies_less_one.max(1) < drive as u16 {
            3
        } else {
            2
        }
    } else if drive >= 2 {
        3
    } else if !equipment_floppy {
        return (0, 0);
    } else {
        2
    };

    // 440Eh.
    if dos && !compact_disc {
        return (kind, 0);
    }

    if drive == 1 && floppies_less_one == 0 {
        (u16::from(kind != 2), 1)
    } else {
        (kind, 0)
    }
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

/// A data selector for a code segment's memory; see `AllocDSToCSAlias`.
pub fn alloc_cs_to_ds_alias(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Word(alias_of(system, selector, false)))
}

/// A code selector for a segment's memory, the given one in DX (seg1
/// `21fb`-`2220`). **Recorded** by `ktask`.
pub fn alloc_alias(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    Ok(Answer::Dword(
        u32::from(selector) << 16 | u32::from(alias_of(system, selector, true)),
    ))
}

/// A selector's base moved, straight into its descriptor, and the
/// selector answered (`KRNL386.EXE` seg1 `2725`-`2752`). **Recorded** by
/// `ktask`.
pub fn set_selector_base(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let base = args.dword(system);
    let index = index_for(selector);

    if index != 0 {
        Descriptors::set_base(&mut system.cpu.bus, index, base);
    }

    Ok(Answer::Word(selector))
}

/// A selector's limit, its low word and the low four bits of its high
/// word, straight into its descriptor; nought (seg1 `276d`-`2798`).
/// **Recorded** by `ktask`.
pub fn set_selector_limit(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let limit = args.dword(system);
    let index = index_for(selector);

    if index != 0 {
        system
            .descriptors
            .set_limit(&mut system.cpu.bus, index, limit & 0xfffff);
    }

    Ok(Answer::Word(0))
}

/// The bits of a selector's rights a program may change: its type and its
/// flags.
const CHANGEABLE: u16 = 0xd01e;

/// A selector's rights held to `D01Eh` for `op` nought; else those bits set
/// from `rights`, the rest kept, and nought answered (seg1 `279b`-`27cb`).
/// **Recorded** by `ktask`.
pub fn selector_access_rights(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let op = args.word(system);
    let rights = args.word(system);
    let index = index_for(selector);
    let now = if index == 0 {
        0
    } else {
        Descriptors::rights_of(&system.cpu.bus, index)
    };

    if op == 0 {
        return Ok(Answer::Word(now & CHANGEABLE));
    }

    if index != 0 {
        Descriptors::set_rights(
            &mut system.cpu.bus,
            index,
            rights & CHANGEABLE | now & !CHANGEABLE,
        );
    }

    Ok(Answer::Word(0))
}

/// Selectors one after another, each data at nought of no limit: the
/// first, or nought (seg1 `1df5`-`1e28`). **Recorded** by `ktask`.
pub fn alloc_selector_array(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let count = usize::from(args.word(system));
    let made = if count == 0 {
        None
    } else {
        system.descriptors.blank_run(&mut system.cpu.bus, count)
    };

    Ok(Answer::Word(made.map_or(0, segment_selector)))
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
    let name = match name_at(system, args.dword(system)) {
        Name::Text(text) => ordinal_written(&text).map_or(Name::Text(text), Name::Number),
        name => name,
    };

    Ok(Answer::Dword(proc_address(system, handle, &name)))
}

/// The bits of an ordinal KERNEL looks up: the low 15, so 32769 is
/// ordinal 1 and 32768 none (`KRNL386.EXE` seg1 `4ff2`; the `procnum`
/// probe, asked by number and as `#32769`).
const ORDINAL_BITS: u16 = 0x7fff;

/// The characters of a name `GetProcAddress` copies before it looks: its
/// length is kept in a byte and the copy stops at 127 (`KRNL386.EXE` seg2
/// `0710`, `CX` 7Fh).
const NAME_COPIED: usize = 127;

/// A name that is `#` and digits, the ordinal they make, as KERNEL reads it
/// before any table (`KRNL386.EXE` seg1 `50b3`-`511c`): every character
/// after the `#` of the 127 copied a decimal digit, the number kept in a
/// word as it is made (`65537` is 1); one other character, or none, and
/// the name is looked up as a name. It holds for every module: the
/// `procnum` probe. An ordinal of nought finds nothing (seg2 `07a2`).
fn ordinal_written(name: &str) -> Option<u16> {
    let mut copied = name.chars().take(NAME_COPIED);

    if copied.next() != Some('#') {
        return None;
    }
    let digits: Vec<u32> = copied
        .map(|digit| digit.to_digit(10))
        .collect::<Option<_>>()?;

    (!digits.is_empty()).then(|| {
        digits.iter().fold(0u16, |number, &digit| {
            number.wrapping_mul(10).wrapping_add(digit as u16)
        })
    })
}

/// A procedure's address in a module by its name, as `GetProcAddress`
/// finds it: USER finds a driver's `DriverProc` so.
pub(crate) fn proc_named(system: &mut System, handle: u16, name: &str) -> u32 {
    proc_address(system, handle, &Name::Text(name.to_string()))
}

/// A procedure's address in a module by its ordinal: USER finds a
/// language driver's ordinal 1 so (`language_driver.rs`).
pub(crate) fn proc_numbered(system: &mut System, handle: u16, ordinal: u16) -> u32 {
    proc_address(system, handle, &Name::Number(ordinal))
}

fn proc_address(system: &mut System, handle: u16, name: &Name) -> u32 {
    let module = match system.handles.resolve_module(handle) {
        Some(Object::Task(program)) => Some(program),
        Some(Object::Library(module)) => Some(module),
        Some(Object::Kept(kept)) => return kept_proc(system, kept, name),
        _ => None,
    };
    let Some(index) = module else {
        return 0;
    };
    let module = &system.modules[index];
    let ordinal = match name {
        Name::Text(text) => module.executable.ordinal_found(text),
        Name::Number(number) => *number,
        Name::Null => 0,
    } & ORDINAL_BITS;

    // An export of `COMMDLG`'s, `VER`'s or `LZEXPAND`'s WinBox answers: its
    // stub (`own_modules.rs`).
    if ordinal != 0
        && let Some((segment, offset)) = crate::own_modules::redirect(system, index, ordinal)
    {
        return u32::from(segment_selector(segment)) << 16 | u32::from(offset);
    }

    system.modules[index]
        .lookup(ordinal)
        .map_or(0, |(segment, offset)| {
            u32::from(segment_selector(segment)) << 16 | u32::from(offset)
        })
}

fn kept_proc(system: &mut System, kept: usize, name: &Name) -> u32 {
    let module = system.module_of(&system.kept[kept]);
    let ordinal = match name {
        Name::Text(text) => module.ordinal_of(text),
        Name::Number(number) => *number,
        Name::Null => 0,
    };

    let ordinal = ordinal & ORDINAL_BITS;

    if ordinal == 0
        || module
            .export(ordinal)
            .is_none_or(|export| export.holds_place())
    {
        return 0;
    }

    if module.name == "KERNEL"
        && let Some(constant) = kernel_constant(ordinal, system.win_flags())
    {
        return u32::from(crate::linker::CONSTANT_SEGMENT) << 16 | u32::from(constant);
    }

    // A place in the module's data, not a function (`exported_data.rs`).
    if let Some((segment, offset)) = system.exported_data_place(kept, ordinal) {
        return u32::from(segment_selector(segment)) << 16 | u32::from(offset);
    }

    let stubs = system.stubs(kept);

    u32::from(segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

/// A procedure of a program given its data segment: a thunk of `MOV AX,
/// <its data's selector>` and a far jump to it, in a block of KERNEL's.
/// A library's procedure, or one with no task, is answered as it is
/// (`KRNL386.EXE` seg3 `0294`, bit 15 of the module's flags). A program
/// linked with a single data segment, as Media Player is, has its thunk as
/// any program does (seg3 `033d`): KERNEL counts it as having multiple
/// data (`loader.rs`). **Recorded** by `solodata`.
pub fn make_proc_instance(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let procedure = args.dword(system);
    let instance = args.word(system);
    let Some(Object::Task(program)) = system.handles.resolve_module(instance) else {
        return Ok(Answer::Dword(procedure));
    };
    let module = &system.modules[program];

    let Some(data) = module.data().filter(|_| !module.is_library()) else {
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

        // Code, as Windows' thunks are: `IsBadCodePtr` passes one, as
        // MMSYSTEM's `mmioInstallIOProc` asks of a program's I/O procedure
        // (**recorded** by `mmio`).
        system
            .descriptors
            .copy_swapped(&mut system.cpu.bus, index, index);
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
    let found: (Result<usize, u16>, Vec<usize>) = 'found: {
        let mut system = engine.system();
        let file_of = |path: &str| path.rsplit('\\').next().unwrap_or("").to_ascii_uppercase();

        // One of WinBox's own kept only once loaded, kept now.
        crate::own_modules::keep_on_load(&mut system, name.split('.').next().unwrap_or(""));

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
        let places = library_places(&system, text, slash, beside.as_deref());
        let mut folder_found = false;
        let mut found = None;

        for place in places {
            // A folder of no drive lists nothing: it is there, and empty.
            if !place.contains(':') || system.files.folder_exists(&place) {
                folder_found = true;
            }

            if let Some(read) = system.files.read_from(&place, &name) {
                found = Some(read);
                break;
            }
        }

        let Some((path, bytes)) = found else {
            // `COMMDLG`, `VER`, `LZEXPAND` or `DDEML` with no file:
            // WinBox's, counted as its file would be (`own_modules.rs`).
            match crate::own_modules::without_file(&mut system, &name, beside.as_deref()) {
                Some((instance, order)) => break 'found (Err(instance), order),
                None => {
                    return Ok(if slash.is_some() && !folder_found {
                        3
                    } else {
                        2
                    });
                }
            }
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

        // `LoadLibrary` is `LoadModule` with no parameter block, its 11
        // answered as 20 (`KRNL286.EXE` seg2 `155c`-`157b`): `sysdirs`'
        // `WIN.INI` 20, `winexpe`'s Win32 program 21.
        if let Some(error) = load_error(&bytes) {
            return Ok(if error == 11 { 20 } else { error });
        }

        let Ok(executable) = Executable::parse(bytes) else {
            return Ok(20);
        };
        let mut order = Vec::new();
        let library = system.load_found(executable, &base, &path, beside.as_deref(), &mut order);

        (Ok(library), order)
    };

    start_libraries(engine, &found.1).await?;
    // A library loaded from its file, or one of WinBox's own with no file
    // by its instance.
    Ok(match found.0 {
        Ok(library) => engine.system().modules[library].instance,
        Err(instance) => instance,
    })
}

/// Where `LoadLibrary` looks for a file: the directory a name gives, or for
/// a name alone where KERNEL looks (`search.rs`), the task's program's
/// directory fourth (`search`).
fn library_places(
    system: &System,
    text: &str,
    slash: Option<usize>,
    beside: Option<&str>,
) -> Vec<String> {
    match slash {
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
        None => system.search_places(beside, None),
    }
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
    // One of WinBox's own with no file, by its instance or its module's
    // handle: counted down as its file would be.
    let own = {
        let mut system = engine.system();

        match system.handles.resolve_module(handle) {
            Some(Object::Kept(kept))
                if crate::own_modules::own_with_file(system.kept[kept].module.name) =>
            {
                Some(crate::own_modules::release_own(&mut system, kept))
            }
            _ => None,
        }
    };

    if let Some(brought) = own {
        return let_go(engine, brought).await;
    }

    let (wep, brought) = {
        let mut system = engine.system();
        let Some(Object::Library(library)) = system.handles.resolve_module(handle) else {
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

        (wep, brought)
    };

    if let Some(wep) = wep {
        engine.call_guest(wep, &[0], &[]).await?;
    }

    // The libraries it brought first, the last loaded first, each deleted
    // in its turn, then itself (`KRNL386.EXE` seg2 `0a84`-`0ad1`, `0c30`).
    let mut brought = brought;

    brought.reverse();
    let_go(engine, brought).await?;

    let mut system = engine.system();
    let Some(Object::Library(library)) = system.handles.resolve_module(handle) else {
        return Ok(());
    };

    system.delete_library(library);
    Ok(())
}

/// The modules a library held, let go as `FreeLibrary` lets one go.
async fn let_go(engine: &Engine, brought: Vec<Held>) -> Result<(), Stop> {
    for held in brought {
        match held {
            Held::Library(other) => {
                let instance = engine.system().modules[other].instance;

                Box::pin(free_library_handle(engine, instance)).await?;
            }
            Held::Own(kept) => {
                let more = crate::own_modules::release_own(&mut engine.system(), kept);

                Box::pin(let_go(engine, more)).await?;
            }
        }
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
    pub(crate) fn release_libraries(&mut self, libraries: &[Held]) {
        for &held in libraries {
            let library = match held {
                Held::Library(library) => library,
                Held::Own(kept) => {
                    let more = crate::own_modules::release_own(self, kept);

                    self.release_libraries(&more);
                    continue;
                }
            };
            let module = &mut self.modules[library];

            if module.usage == 0 {
                continue;
            }

            module.usage -= 1;

            if module.usage > 0 {
                continue;
            }

            let mut brought = std::mem::take(&mut module.brought);

            brought.reverse();
            self.release_libraries(&brought);
            self.delete_library(library);
        }
    }

    /// A library at nought deleted as KERNEL deletes a module (`0c30`): USER
    /// told (`module_gone`), its
    /// segments and its database given back (`free_module_segments`), and
    /// its name, its file, its instance and its handle found no more.
    pub(crate) fn delete_library(&mut self, library: usize) {
        let (instance, handle) = (self.modules[library].instance, self.modules[library].handle);

        // USER told, as KERNEL deletes it (`app_exit.rs`).
        self.module_gone(handle);
        crate::own_modules::freed(self, library);

        let database = (handle != 0).then(|| index_for(handle));

        self.free_module_segments(library, database, true);

        let module = &mut self.modules[library];

        module.name.clear();
        module.path.clear();
        self.handles.free_module(instance);
        self.handles.free_module(handle);
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

/// What `LoadModule` answers of a file that is no Windows module, from its
/// first bytes; `None` for one whose new header is `NE`. **Read out**
/// (`KRNL286.EXE` seg2 `0db2`-`0e1e`; `KRNL386.EXE` the same at `e9d5` in
/// the file): the first 40h bytes read; `MZ` and a new header's place at
/// 3Ch, its double word nought 11; the new header's first word `NE` a
/// module, `PE` 21 -- a Win32 program, for Win32s -- else 11; a file
/// COMPRESS made (`SZDD`, 88h F0h 27h 33h) 19; anything else, or a read
/// come short, 11. **Recorded** by `winexpe`: `LoadModule` and
/// `LoadLibrary` of a Win32 program answer 21. `LoadLibrary` answers 20
/// for this 11 (seg2 `155c`-`157b`).
pub(crate) fn load_error(bytes: &[u8]) -> Option<u16> {
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
    };

    if bytes.len() < 0x40 {
        return Some(11);
    }

    if bytes.starts_with(b"SZDD\x88\xf0\x27\x33") {
        return Some(19);
    }

    if !bytes.starts_with(b"MZ") {
        return Some(11);
    }

    let at = u32::from_le_bytes([bytes[0x3c], bytes[0x3d], bytes[0x3e], bytes[0x3f]]) as usize;

    if at == 0 || bytes.len() < at.saturating_add(0x40) {
        return Some(11);
    }

    match word(at) {
        Some(0x454e) => None,
        Some(0x4550) => Some(21),
        _ => Some(11),
    }
}

#[cfg(test)]
mod load_error_tests {
    use super::load_error;

    #[test]
    fn a_file_that_is_no_windows_module_answers_as_kernel_does() {
        let mut image = vec![0u8; 0x80];

        image[..2].copy_from_slice(b"MZ");
        image[0x3c] = 0x40;
        image[0x40..0x42].copy_from_slice(b"NE");
        assert_eq!(load_error(&image), None);

        image[0x40..0x42].copy_from_slice(b"PE");
        assert_eq!(load_error(&image), Some(21));

        image[0x40..0x42].copy_from_slice(b"LE");
        assert_eq!(load_error(&image), Some(11));

        image[0x3c] = 0;
        assert_eq!(load_error(&image), Some(11));

        let mut compressed = b"SZDD\x88\xf0\x27\x33".to_vec();

        compressed.resize(0x40, 0);
        assert_eq!(load_error(&compressed), Some(19));
        assert_eq!(load_error(b"MZ"), Some(11));
    }
}

#[cfg(test)]
mod kept_tests {
    use super::load_library_named;

    /// The modules winbox.js keeps are found by their files' names with no
    /// file on the drive: no Windows file is shipped. Each answers its
    /// instance, as `LoadLibrary` answers it (`modhand`): 32 or more. A
    /// driver it does not keep, with no file, answers an error.
    #[test]
    fn kept_modules_load_by_their_files_names_from_an_empty_drive() {
        let engine = crate::mmsystem::device_tests::machine();

        engine
            .system()
            .files
            .mount('C', winbox_machine::MemoryDrive::new());

        let instance = |name: &str| {
            let system = engine.system();
            let kept = system.kept_named(name).unwrap();

            system.kept[kept].instance()
        };
        let load = |file: &str| engine.run_now(load_library_named(&engine, file)).unwrap();

        assert_eq!(load("MCIWAVE.DRV"), instance("MCIWAVE"));
        assert_eq!(load("mciseq.drv"), instance("MCISEQ"));
        assert_eq!(load("C:\\WINDOWS\\SYSTEM\\TIMER.DRV"), instance("TIMER"));
        assert!(instance("MCIWAVE") >= 32);
        assert!(load("MCICDA.DRV") < 32);
    }
}
