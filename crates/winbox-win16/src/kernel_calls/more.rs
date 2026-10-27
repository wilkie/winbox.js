//! KERNEL's documented small calls that wave one left: the error mode's
//! byte, a far pointer moved on, `NetBIOS`, a task's handle table, memory in
//! the first megabyte, a procedure called through an instance, a stack of
//! the program's own, and files opened and deleted along PATH. As
//! `kernel/more-calls.ts`, which cites the read-outs; **recorded** by
//! `kmore`.

use winbox_cpu::{AX, BP, BX, CX, DS, DX, ES, SP, SS};
use winbox_machine::{Descriptors, FIRST_MEGABYTE, LDT_BASE, index_for, segment_selector};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::system::System;

/// Where `GlobalDosAlloc` gives memory in the first megabyte, by
/// paragraph: from the first block's on Windows (`kmore`) to the top of
/// conventional memory.
pub const DOS_FIRST: u16 = 0x16d2;
pub const DOS_END: u16 = 0xa000;

/// The byte at 32Ah of KERNEL's data, as a far pointer (seg1 `0bc5`).
pub fn get_lp_err_mode(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let data = system
        .kept_named("KERNEL")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));

    Ok(Answer::Dword(u32::from(data) << 16 | 0x32a))
}

/// A descriptor's eight bytes, through the local table.
fn descriptor_bytes(system: &System, selector: u16) -> [u8; 8] {
    let entry = LDT_BASE + u32::from(selector >> 3) * 8;
    let bytes = system.cpu.bus.read(entry, 8);

    std::array::from_fn(|at| bytes[at])
}

/// A descriptor's eight bytes written straight into the table (seg1
/// `2b66`), each segment register holding it loaded again, as DPMI's 000Ch
/// leaves them (`run.rs`).
fn write_descriptor(system: &mut System, selector: u16, bytes: [u8; 8]) {
    let entry = LDT_BASE + u32::from(selector >> 3) * 8;

    system.cpu.bus.write(entry, &bytes);

    for index in 0..6 {
        let held = system.cpu.segments[index].selector;

        if held & !7 == selector & !7 && held & 4 != 0 {
            let _ = system.cpu.load_segment(index, held);
        }
    }
}

/// A far pointer moved on: its selector's base moved instead, and each of
/// a block's selectors after it (seg1 `26b9`-`2722`, `2223`-`2251`).
pub fn long_ptr_add(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let add = args.dword(system);
    let selector = (pointer >> 16) as u16;
    let offset = pointer as u16;
    let mut bytes = descriptor_bytes(system, selector);
    let base = u32::from_le_bytes([bytes[2], bytes[3], bytes[4], bytes[7]])
        .wrapping_add(u32::from(offset & 0xfff0));

    if (add >> 16) & 0xff00 != 0 {
        return Ok(Answer::Dword(0));
    }

    let base = base.wrapping_add(add);
    let count = system
        .peek_descriptor(selector)
        .map_or(1, |descriptor| ((descriptor.limit >> 16) & 0xffff) + 1);
    let [b0, b1, b2, b3] = base.to_le_bytes();

    bytes[2] = b0;
    bytes[3] = b1;
    bytes[4] = b2;
    bytes[7] = b3;

    for tile in 0..count {
        write_descriptor(
            system,
            (selector & !7).wrapping_add((tile * 8) as u16),
            bytes,
        );

        let (carried, over) = bytes[4].overflowing_add(1);

        bytes[4] = carried;
        bytes[7] = bytes[7].wrapping_add(u8::from(over));

        if bytes[6] & 0x80 != 0 {
            let low = u16::from_le_bytes([bytes[0], bytes[1]]);
            let (low, under) = low.overflowing_sub(0x10);
            let [l0, l1] = low.to_le_bytes();

            bytes[0] = l0;
            bytes[1] = l1;
            bytes[6] = bytes[6].wrapping_sub(u8::from(under));
        } else {
            bytes[6] = bytes[6].wrapping_sub(1);
        }
    }

    Ok(Answer::Dword(
        u32::from(selector) << 16 | u32::from(offset & 0xf),
    ))
}

/// `INT 5Ch` with the registers as they are: DOSBox's bare `IRET` (seg1
/// `9e19`).
pub fn net_bios_call(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.cpu.flags &= !1;
    Ok(Answer::Nothing)
}

/// A table of handles in the task's data segment (seg3 `03ce`-`0417`).
pub fn define_handle_table(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let offset = args.word(system);
    let ds = system.cpu.segments[DS].selector;
    let index = index_for(ds);

    if system.global.size_of(index) == 0 && system.global.flags_of(index) == 0 {
        return Ok(Answer::Word(0));
    }

    let task = system.current_task().unwrap_or(0);

    if let Some(record) = system.task_record(task) {
        record.handle_table = if offset == 0 { (0, 0) } else { (offset, ds) };
    }

    let tables = &mut system.kernel_calls.handle_tables;

    *tables = if offset == 0 {
        tables.wrapping_sub(1)
    } else {
        tables.wrapping_add(1)
    };

    if offset == 0 {
        return Ok(Answer::Word(ds));
    }

    let far = |at: u16| u32::from(ds) << 16 | u32::from(at);
    let count_bytes = system.read_far(far(offset), 2);
    let count = u16::from_le_bytes([count_bytes[0], count_bytes[1]]);

    for at in 0..=count {
        let place = offset.wrapping_add(2).wrapping_add(at.wrapping_mul(2));

        system.write_far(far(place), &[0, 0]);
    }

    Ok(Answer::Word(1))
}

/// The lowest paragraph `paragraphs` fit at.
fn dos_place(system: &System, paragraphs: u32) -> Option<u16> {
    let mut taken: Vec<(u16, u16)> = system.kernel_calls.dos_blocks.values().copied().collect();

    taken.sort_unstable();

    let mut at = u32::from(DOS_FIRST);

    for (start, length) in taken {
        if u32::from(start).saturating_sub(at) >= paragraphs && u32::from(start) >= at {
            return Some(at as u16);
        }

        at = at.max(u32::from(start) + u32::from(length));
    }

    (u32::from(DOS_END).saturating_sub(at) >= paragraphs && at <= u32::from(DOS_END))
        .then_some(at as u16)
}

/// Memory in the first megabyte (seg1 `139a`-`13d1`): the selector in AX,
/// the paragraph in DX.
pub fn global_dos_alloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let size = args.dword(system);

    system.global.settle();

    // `GlobalAlloc`'s own limit (`0c7c`), and nought refused: `4025` gives
    // a block of nought only where it is moveable (`40ab`), and this one is
    // fixed. **Recorded** by `galimit`: nought, 100000h and more answered
    // nought.
    if size == 0 || !winbox_machine::within_limit(size) {
        return Ok(Answer::Dword(0));
    }

    let rounded = if size == 0 { 0 } else { (size + 0x1f) & !0x1f };
    let paragraphs = rounded >> 4;
    let Some(paragraph) = dos_place(system, paragraphs) else {
        return Ok(Answer::Dword(0));
    };
    let Some(index) = crate::memory::allocate(system, size, 0) else {
        return Ok(Answer::Dword(0));
    };
    let task = system.current_task().unwrap_or(0);

    system.block_owners.insert(index, task);

    let selectors = system
        .global
        .block(index)
        .map_or(1, |block| block.selectors);

    for tile in 0..selectors {
        Descriptors::set_base(
            &mut system.cpu.bus,
            index + tile,
            FIRST_MEGABYTE + u32::from(paragraph) * 16 + tile as u32 * 0x10000,
        );
    }

    system
        .kernel_calls
        .dos_blocks
        .insert(index, (paragraph, paragraphs as u16));

    Ok(Answer::Dword(
        u32::from(paragraph) << 16 | u32::from(segment_selector(index)),
    ))
}

/// A block `GlobalDosAlloc` gave, freed (seg1 `13d4`): nought.
pub fn global_dos_free(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let selectors = system
        .global
        .block(index)
        .map_or(0, |block| block.selectors);

    system.kernel_calls.dos_blocks.remove(&index);
    system
        .global
        .free(&mut system.cpu.bus, &mut system.descriptors, index);
    system.forget_heaps(index, selectors);

    Ok(Answer::Word(0))
}

/// A procedure jumped to through an instance (seg1 `4927`-`4938`).
pub fn call_proc_instance(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let es = system.cpu.segments[ES].selector;
    let bx = system.cpu.regs[BX];
    let word = |system: &System, at: u16| {
        let bytes = system.read_far(u32::from(es) << 16 | u32::from(at), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    };
    let instance = word(system, bx);
    let offset = word(system, bx.wrapping_add(2));
    let segment = word(system, bx.wrapping_add(4));

    system.cpu.regs[AX] = if instance == 0 {
        system.cpu.segments[DS].selector
    } else if instance & 1 != 0 {
        instance
    } else {
        instance.wrapping_add(1)
    };

    let sp = system.cpu.regs[SP].wrapping_sub(4);
    let ss = system.cpu.segments[SS].selector;

    system.write_far(u32::from(ss) << 16 | u32::from(sp), &offset.to_le_bytes());
    system.write_far(
        u32::from(ss) << 16 | u32::from(sp.wrapping_add(2)),
        &segment.to_le_bytes(),
    );
    system.cpu.regs[SP] = sp;

    Ok(Answer::Nothing)
}

fn read16(system: &System, selector: u16, at: u16) -> u16 {
    let bytes = system.read_far(u32::from(selector) << 16 | u32::from(at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn write16(system: &mut System, selector: u16, at: u16, value: u16) {
    system.write_far(
        u32::from(selector) << 16 | u32::from(at),
        &value.to_le_bytes(),
    );
}

/// The stack moved into a segment of the program's own (seg1
/// `11c6`-`123b`).
pub fn switch_stack_to(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let ss = system.cpu.segments[SS].selector;
    let sp = system.cpu.regs[SP];
    let ip = read16(system, ss, sp);
    let cs = read16(system, ss, sp.wrapping_add(2));
    let top = read16(system, ss, sp.wrapping_add(4));
    let pointer = read16(system, ss, sp.wrapping_add(6));
    let segment = read16(system, ss, sp.wrapping_add(8));
    let bp = system.cpu.regs[BP];
    let mut old_sp = sp.wrapping_add(10);
    let mut from = bp.wrapping_sub(2);
    let mut count = from.wrapping_sub(old_sp) >> 1;

    old_sp = old_sp.wrapping_sub(2);
    write16(system, ss, old_sp, bp);

    write16(system, segment, 2, old_sp);
    write16(system, segment, 4, ss);
    write16(system, segment, 0xa, top);
    write16(system, segment, 0xc, pointer);
    write16(system, segment, 0xe, pointer);

    let mut new_sp = pointer.wrapping_sub(2);

    write16(system, segment, new_sp, 0);

    while count > 0 {
        from = from.wrapping_sub(2);
        new_sp = new_sp.wrapping_sub(2);

        let word = read16(system, ss, from);

        write16(system, segment, new_sp, word);
        count -= 1;
    }

    new_sp = new_sp.wrapping_sub(4);
    write16(system, segment, new_sp, ip);
    write16(system, segment, new_sp.wrapping_add(2), cs);

    system
        .cpu
        .load_segment(SS, segment)
        .map_err(Stop::Processor)?;
    system.cpu.regs[SP] = new_sp;
    system.cpu.regs[BP] = pointer;
    system.cpu.regs[AX] = 0;
    system.cpu.regs[BX] = pointer;
    system.cpu.regs[CX] = 0;
    system.cpu.regs[DX] = segment;

    Ok(Answer::Nothing)
}

/// Back to the stack `SwitchStackTo` left (seg1 `123c`-`127d`).
pub fn switch_stack_back(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let ss = system.cpu.segments[SS].selector;
    let sp = system.cpu.regs[SP];
    let ip = read16(system, ss, sp);
    let cs = read16(system, ss, sp.wrapping_add(2));
    let back_segment = read16(system, ss, 4);
    let back_pointer = read16(system, ss, 2);

    write16(system, ss, 4, 0);
    write16(system, ss, 2, 0);

    system
        .cpu
        .load_segment(SS, back_segment)
        .map_err(Stop::Processor)?;

    let bp = read16(system, back_segment, back_pointer);
    let new_sp = back_pointer.wrapping_add(2).wrapping_sub(4);

    write16(system, back_segment, new_sp, ip);
    write16(system, back_segment, new_sp.wrapping_add(2), cs);
    system.cpu.regs[SP] = new_sp;
    system.cpu.regs[BP] = bp;
    system.cpu.regs[BX] = back_segment;
    system.cpu.regs[CX] = back_pointer;

    Ok(Answer::Nothing)
}

/// Where a path's name begins: past its last `\`, `/` or `:` (seg1
/// `5a0e`).
fn name_of(path: &[u8]) -> &[u8] {
    let at = path
        .iter()
        .rposition(|&byte| byte == b'\\' || byte == b'/' || byte == b':')
        .map_or(0, |at| at + 1);

    &path[at..]
}

/// A DOS call of `ax` on the string at `selector:offset`: whether it
/// failed, and AX after.
async fn dos_on(engine: &Engine, ax: u16, selector: u16, offset: u16) -> Result<(bool, u16), Stop> {
    {
        let mut system = engine.system();

        system.cpu.regs[AX] = ax;
        system.cpu.regs[CX] = 0;
        system
            .cpu
            .load_segment(DS, selector)
            .map_err(Stop::Processor)?;
        system.cpu.regs[DX] = offset;
        system.dos_call()?;
    }

    engine.tell_file_changes().await?;

    let system = engine.system();

    Ok((system.cpu.flags & 1 != 0, system.cpu.regs[AX]))
}

/// A file opened, or deleted, as named, or else through PATH (seg3
/// `04be`-`0505`, seg1 `588e`).
fn open_path(engine: &Engine, path: u32, mode: u16) -> Later<'_> {
    Box::pin(async move {
        let ds = engine.system().cpu.segments[DS].selector;
        let ax = if mode & 0xff00 == 0 {
            mode | 0x3d00
        } else {
            mode
        };
        let selector = (path >> 16) as u16;
        let offset = path as u16;
        let (mut failed, mut answer) = dos_on(engine, ax, selector, offset).await?;

        if failed {
            let (name, directories, ss, buffer) = {
                let system = engine.system();
                let name = system.read_string(path);
                let ss = system.cpu.segments[SS].selector;
                let buffer = system.cpu.regs[SP].wrapping_sub(2).wrapping_sub(0x80);

                (name, system.path_directories(), ss, buffer)
            };

            for directory in directories {
                let mut whole = directory.into_bytes();

                if whole.last() != Some(&b'\\') {
                    whole.push(b'\\');
                }

                whole.extend_from_slice(name_of(&name));
                whole.truncate(0x7f);
                whole.push(0);

                engine
                    .system()
                    .write_far(u32::from(ss) << 16 | u32::from(buffer), &whole);

                let (again, value) = dos_on(engine, ax, ss, buffer).await?;

                failed = again;
                answer = value;

                if !failed {
                    break;
                }
            }

            if failed {
                answer = 0xffff;
            }
        }

        engine
            .system()
            .cpu
            .load_segment(DS, ds)
            .map_err(Stop::Processor)?;

        Ok(Answer::Word(answer))
    })
}

pub fn open_path_name(engine: &Engine, mut args: Args) -> Later<'_> {
    let (path, mode) = {
        let system = engine.system();
        let path = args.dword(&system);
        let mode = args.word(&system);

        (path, mode)
    };

    open_path(engine, path, mode)
}

/// `OpenPathName` with DOS's delete, 4100h (seg3 `04b6`-`04bd`).
pub fn delete_path_name(engine: &Engine, mut args: Args) -> Later<'_> {
    let path = args.dword(&engine.system());

    open_path(engine, path, 0x4100)
}

/// Every block an owner has freed (seg1 `0e39`-`0e87`): the owner a
/// task's prefix, nought for the running task's; `GMEM_SHARE` blocks are
/// the module's and stay. `FFFFh`. As `more-calls.ts`. **Recorded** by
/// `gfreeal`.
pub fn global_free_all(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let owner = args.word(system);
    let task = if owner == 0 {
        system.current_task().unwrap_or(0)
    } else {
        system
            .scheduler
            .slots
            .iter()
            .map(|slot| slot.handle)
            .find(|&handle| system.prefix_of(handle) == owner)
            .unwrap_or(0)
    };
    let mut freed: Vec<usize> = system
        .block_owners
        .iter()
        .filter(|&(&index, &by)| {
            task != 0 && by == task && system.global.flags_of(index) & 0x2000 == 0
        })
        .map(|(&index, _)| index)
        .filter(|&index| system.global.block(index).is_some())
        .collect();

    freed.sort_unstable();

    for index in freed {
        let selectors = system
            .global
            .block(index)
            .map_or(0, |block| block.selectors);

        system.kernel_calls.dos_blocks.remove(&index);
        system
            .global
            .free(&mut system.cpu.bus, &mut system.descriptors, index);
        system.forget_heaps(index, selectors);
    }

    Ok(Answer::Word(0xffff))
}
