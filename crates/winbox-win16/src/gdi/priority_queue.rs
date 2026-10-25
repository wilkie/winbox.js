//! GDI's priority queue, which the spooler keeps its jobs in: `CreatePQ`,
//! `InsertPQ`, `MinPQ`, `ExtractPQ`, `SizePQ` and `DeletePQ`, as `GDI.EXE`
//! seg27 has them. The TypeScript engine's twin is
//! `src/win16/gdi/priority-queue.ts`, where each read-out is told.
//!
//! **Recorded** by `gdipq`.

use winbox_machine::handle_for;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// The header's four words: where the entries end, the room for them, the
/// last key appended (or `HEAP`), where the first still queued starts.
const HEADER: u16 = 8;
/// Word 2 once the entries are a heap.
const HEAP: u16 = 0x4000;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "CreatePQ" => create_pq,
        "MinPQ" => min_pq,
        "ExtractPQ" => extract_pq,
        "InsertPQ" => insert_pq,
        "SizePQ" => size_pq,
        "DeletePQ" => delete_pq,
        _ => return None,
    }))
}

/// A queue's block, locked: its words read and written by offset.
struct Block(u32);

impl Block {
    fn lock(system: &System, handle: u16) -> Option<Self> {
        let far = system.global_pointer(handle);

        (far != 0).then_some(Self(far))
    }

    fn at(&self, offset: u16) -> u32 {
        (self.0 & 0xffff_0000) | u32::from((self.0 as u16).wrapping_add(offset))
    }

    fn read(&self, system: &System, offset: u16) -> u16 {
        let bytes = system.read_far(self.at(offset), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    fn write(&self, system: &mut System, offset: u16, value: u16) {
        system.write_far(self.at(offset), &value.to_le_bytes());
    }

    /// The entries from word 3 on moved down to the first, word 3 nought
    /// (seg27 `025a`).
    fn compact(&self, system: &mut System) {
        let start = self.read(system, 6);
        let words = self.read(system, 2).wrapping_sub(start) >> 1;
        let end = self.read(system, 0);

        self.write(system, 0, end.wrapping_sub(start));

        for i in 0..words {
            let word = self.read(system, HEADER.wrapping_add(start).wrapping_add(i * 2));

            self.write(system, HEADER.wrapping_add(i * 2), word);
        }

        self.write(system, 6, 0);
    }

    /// A child's entry and its parent's swapped where the child's key is
    /// the smaller, unsigned (seg27 `00d9`): whether they were.
    fn swap_smaller(&self, system: &mut System, child: u16, parent: u16) -> bool {
        let child_key = self.read(system, HEADER.wrapping_add(child));
        let parent_key = self.read(system, HEADER.wrapping_add(parent));

        if child_key >= parent_key {
            return false;
        }

        let child_tag = self.read(system, HEADER.wrapping_add(child).wrapping_add(2));
        let parent_tag = self.read(system, HEADER.wrapping_add(parent).wrapping_add(2));

        self.write(system, HEADER.wrapping_add(child), parent_key);
        self.write(
            system,
            HEADER.wrapping_add(child).wrapping_add(2),
            parent_tag,
        );
        self.write(system, HEADER.wrapping_add(parent), child_key);
        self.write(
            system,
            HEADER.wrapping_add(parent).wrapping_add(2),
            child_tag,
        );
        true
    }
}

fn global_unlock(system: &mut System, handle: u16) -> u16 {
    match crate::memory::global_unlock(system, &mut Args::repeat(handle)) {
        Ok(answer) => answer.value().unwrap_or(0) as u16,
        Err(_) => 0,
    }
}

/// A queue of room for `count` entries (seg27 `0000`), its block
/// `GMEM_MOVEABLE | GMEM_DDESHARE` (seg1 `1f6d`) with the header `[0,
/// count * 4, 0, 0]`: its handle, -1 where the block is not given.
fn create_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let bytes = args.word(system) << 2;
    let handle = system
        .global
        .allocate(
            &mut system.cpu.bus,
            &mut system.descriptors,
            u32::from(bytes) + u32::from(HEADER),
            0x2002,
        )
        .map_or(0, handle_for);

    if handle == 0 {
        return Ok(Answer::Word(0xffff));
    }

    if let Some(block) = Block::lock(system, handle) {
        for (offset, value) in [(0, 0), (2, bytes), (4, 0), (6, 0)] {
            block.write(system, offset, value);
        }
    }

    global_unlock(system, handle);
    Ok(Answer::Word(handle))
}

/// An entry added (seg27 `0045`): the queue's handle, -1 where it is full
/// or not a block. Appended; a key below the last, unsigned, makes the
/// entries a heap and is sifted up.
fn insert_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let tag = args.word(system);
    let key = args.word(system);
    let block = Block::lock(system, handle).filter(|block| {
        block.read(system, 0).wrapping_sub(block.read(system, 6)) < block.read(system, 2)
    });
    let Some(block) = block else {
        global_unlock(system, handle);
        return Ok(Answer::Word(0xffff));
    };

    if block.read(system, 0) >= block.read(system, 2) {
        block.compact(system);
    }

    let end = block.read(system, 0);

    block.write(system, HEADER.wrapping_add(end).wrapping_add(2), tag);
    block.write(system, HEADER.wrapping_add(end), key);
    block.write(system, 0, end.wrapping_add(4));

    if key >= block.read(system, 4) {
        block.write(system, 4, key);
    } else {
        block.compact(system);
        block.write(system, 4, HEAP);

        let mut at = block.read(system, 0).wrapping_sub(4);

        while at != block.read(system, 6) {
            let parent = ((at >> 1).wrapping_sub(2)) & 0xfffc;
            let swapped = block.swap_smaller(system, at, parent);

            at = parent;

            if !swapped {
                break;
            }
        }
    }

    global_unlock(system, handle);
    Ok(Answer::Word(handle))
}

/// The first entry's tag, or the first taken (seg27 `00fb`, `00fe`): -1
/// for an empty queue or no block. In order, word 3 moves on; a heap's
/// last entry is put first and sifted down by the smaller child, the right
/// where they tie, all the way down.
fn first(system: &mut System, handle: u16, take: bool) -> u16 {
    let Some(block) = Block::lock(system, handle) else {
        global_unlock(system, handle);
        return 0xffff;
    };
    let start = block.read(system, 6);

    if start >= block.read(system, 0) {
        global_unlock(system, handle);
        return 0xffff;
    }

    let tag = block.read(system, HEADER.wrapping_add(start).wrapping_add(2));

    if take {
        let next = start.wrapping_add(4);

        if next >= block.read(system, 0) {
            for offset in [4, 6, 0] {
                block.write(system, offset, 0);
            }
        } else if block.read(system, 4) < HEAP {
            block.write(system, 6, next);
        } else {
            let last = start.wrapping_add(block.read(system, 0)).wrapping_sub(4);
            let key = block.read(system, HEADER.wrapping_add(last));
            let moved = block.read(system, HEADER.wrapping_add(last).wrapping_add(2));

            block.write(system, 0, last);
            block.write(system, HEADER.wrapping_add(start), key);
            block.write(system, HEADER.wrapping_add(start).wrapping_add(2), moved);

            let mut parent: u16 = 0;

            loop {
                let mut child = parent.wrapping_mul(2).wrapping_add(4);

                if child >= block.read(system, 0) {
                    break;
                }

                let right = child.wrapping_add(4);

                if right < block.read(system, 0)
                    && block.read(system, HEADER.wrapping_add(child))
                        >= block.read(system, HEADER.wrapping_add(right))
                {
                    child = right;
                }

                block.swap_smaller(system, child, parent);
                parent = child;
            }
        }
    }

    global_unlock(system, handle);
    tag
}

fn min_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(first(system, handle, false)))
}

fn extract_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(first(system, handle, true)))
}

/// The queue's room asked, or grown or shrunk by `delta` entries (seg27
/// `01dc`): `GlobalUnlock`'s answer, nought, but -1 for no block or one
/// `GlobalReAlloc` will not give.
fn size_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let mut handle = args.word(system);
    let delta = args.word(system);
    let Some(block) = Block::lock(system, handle) else {
        return Ok(Answer::Word(0xffff));
    };

    if delta != 0 {
        let bytes = (delta << 2).wrapping_add(block.read(system, 2));

        if bytes >= block.read(system, 0) {
            global_unlock(system, handle);

            let moved =
                crate::memory::reallocate(system, handle, u32::from(bytes) + u32::from(HEADER), 2);

            if moved == 0 {
                return Ok(Answer::Word(0xffff));
            }

            handle = moved;

            if let Some(block) = Block::lock(system, moved) {
                block.write(system, 2, bytes);
            }
        }
    }

    Ok(Answer::Word(global_unlock(system, handle)))
}

/// The queue's block freed (seg27 `01cb`): `GlobalFree`'s answer.
fn delete_pq(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    crate::memory::global_free(system, &mut Args::repeat(handle))
}
