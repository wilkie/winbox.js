//! A global block's owner, as KERNEL keeps it in the block's arena:
//! KERNEL's ordinals 404 and 403, which only KERNEL's own code calls.
//! **Read out** of `KRNL386.EXE` and **recorded** by `kowner`. As
//! `src/win16/kernel/block-owner.ts`, which says more of each.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::index_for;

use crate::call::{Answer, Args, Stop};
use crate::system::System;
use crate::toolhelp::global::{GF_PDB_OWNER, GT_TASK, global_blocks};

/// Ordinal 404: a block's owner (`KRNL386.EXE` seg1 `29ae`, `29bf`): the
/// owner ordinal 403 set; else the block's as TOOLHELP sees it, a task's
/// prefix for a block of a task's; nought for no block.
pub fn k404(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);

    if selector == 0 {
        return Ok(Answer::Word(0));
    }

    let index = index_for(selector);

    // An owner set for a block since freed goes with it.
    if let Some(&owner) = system.set_owners.get(&index)
        && system.global.size_of(index) != 0
    {
        return Ok(Answer::Word(owner));
    }

    system.set_owners.remove(&index);

    let block = global_blocks(system).into_iter().find(|each| {
        if each.kind == GT_TASK {
            index_for(each.handle) == index
        } else {
            each.index == index
        }
    });

    Ok(Answer::Word(match block {
        None => 0,
        Some(block) if block.flags & GF_PDB_OWNER != 0 => system.prefix_of(block.owner),
        Some(block) => block.owner,
    }))
}

/// Ordinal 403: a block's owner set (`KRNL386.EXE` seg1 `29f1`, `2a03`).
/// Nothing answered: AX is as the caller had it. A block of `GlobalAlloc`'s
/// made a task's prefix's is that task's; made anything else's, no task's.
pub fn k403(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let owner = args.word(system);

    if selector == 0 {
        return Ok(Answer::Nothing);
    }

    let index = index_for(selector);

    system.set_owners.insert(index, owner);

    if system.block_owners.contains_key(&index) {
        let handles: Vec<u16> = system
            .scheduler
            .slots
            .iter()
            .map(|slot| slot.handle)
            .collect();
        let task = handles
            .into_iter()
            .find(|&handle| owner != 0 && system.prefix_of(handle) == owner)
            .unwrap_or(0);

        system.block_owners.insert(index, task);

        if task != 0 {
            system.set_owners.remove(&index);
        }
    }

    Ok(Answer::Nothing)
}
