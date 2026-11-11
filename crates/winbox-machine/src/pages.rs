//! The linear pages WIN386 would have present for a program in 386
//! enhanced mode, kept beside the machine's memory as blocks are given and
//! freed, and asked by no access: paging's phase 2
//! (`kb/guides/paging.md`, "The set of present pages").
//!
//! A page is 4 KiB, WIN386's (the owner's decision of 2026-11-11). WinBox
//! keeps its own addresses, a descriptor index's segment at the index
//! times 64 KiB (the owner's decision of 2026-11-10), so the set is of
//! WinBox's linear pages: a page is present where the matching page of the
//! block Windows would have given is.
//!
//! * **The first megabyte** and its high memory area are present in every
//!   virtual machine, at linear nought (**recorded** by `pgtouch`: 400h
//!   reads, 110000h faults), and WinBox's copy of it at
//!   [`FIRST_MEGABYTE`](crate::FIRST_MEGABYTE) is the same memory.
//! * **WinBox's own tables**, the global and local descriptor tables, from
//!   [`GDT_BASE`](crate::GDT_BASE) to the top of the 4 GiB.
//! * **A segment mapped** -- a module's, or a block of KERNEL's heap in the
//!   first megabyte -- is present over its whole 64 KiB, and stays so when
//!   freed: KERNEL keeps its heap, and the first megabyte is always
//!   present (**recorded** by `pgtouch` and `pgheap`: a freed small block
//!   reads, and so do the pages 1000h and 10000h past it).
//! * **A block with pages of its own** -- DPMI 0501h's, and a block of
//!   KERNEL's too big for the first megabyte ([`OWN_PAGES_ABOVE`]) -- has
//!   its pages present and no more: the page past it faults (**recorded**
//!   by `pglock`). It is committed whole (`pgbig`).
//! * **A block freed** (0502h, `GlobalFree`, or the pages 0503h cuts off)
//!   keeps the pages WIN386's `_PageFree` leaves in its page tables
//!   ([`Pages::freed`]).

use std::collections::HashMap;

/// A page's size, and its address's bits below the page.
pub const PAGE_BITS: u32 = 12;
pub const PAGE_SIZE: u32 = 1 << PAGE_BITS;

/// How many pages 4 GiB holds, and the words of a set of them.
const PAGES: usize = 1 << (32 - PAGE_BITS);
const WORDS: usize = PAGES / 64;

/// The first megabyte and its high memory area, at linear nought.
pub const FIRST_MEGABYTE_LENGTH: u32 = 0x11_0000;

/// Where WinBox's blocks lie: one 64 KiB a descriptor index, up to the
/// local table's last. A page here is WIN386's pageable memory, where
/// 0600h refuses a page not committed ([`Pages::lockable`]).
pub const BLOCKS_END: u32 = (crate::SELECTORS as u32) << 16;

/// The largest block of KERNEL's that Windows gave from the first
/// megabyte; a larger one is given pages of its own above 80000000h, as a
/// 0501h block is. **Recorded** by `pgfree` as it started: blocks of 192
/// and 256 KiB at 00045B40h, of 384, 512 and 768 KiB at 80798000h; by
/// `pgheap`: 64 and 128 KiB in the first megabyte, 1 MiB at 80798000h.
/// **Read out**: `KRNL386.EXE` seg1 `397e` grows the heap with 0501h
/// (the size asked for, or 20000h where less than 10000h, rounded to a
/// page) only when no free block in the heap holds the size, so the
/// true bound is the first megabyte's free room as the block is asked
/// for; 257 to 383 KiB were not measured.
pub const OWN_PAGES_ABOVE: u32 = 0x4_0000;

/// A page's fingerprint, or `None` where its mebibyte of memory was never
/// written.
pub type Print = Option<u64>;

/// The set: which linear pages are present, which are committed to a
/// block (what 0600h locks), and the blocks with pages of their own, each
/// page's fingerprint as it was given.
#[derive(Clone)]
pub struct Pages {
    present: Vec<u64>,
    committed: Vec<u64>,
    own: HashMap<u32, Vec<Print>>,
}

impl std::fmt::Debug for Pages {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let present: u32 = self.present.iter().map(|word| word.count_ones()).sum();

        write!(f, "Pages {{ {present} present, {} own blocks }}", self.own.len())
    }
}

impl Default for Pages {
    fn default() -> Self {
        Self::new()
    }
}

fn page_of(at: u32) -> usize {
    (at >> PAGE_BITS) as usize
}

/// The pages from the one holding `base` to the one holding its
/// `length`th byte; none for a length of nought.
fn pages_over(base: u32, length: u32) -> std::ops::Range<usize> {
    if length == 0 {
        return 0..0;
    }

    let last = u64::from(base) + u64::from(length) - 1;

    page_of(base)..((last.min(u64::from(u32::MAX)) >> PAGE_BITS) as usize + 1)
}

fn get(set: &[u64], page: usize) -> bool {
    set[page / 64] & (1 << (page % 64)) != 0
}

fn put(set: &mut [u64], page: usize, on: bool) {
    if on {
        set[page / 64] |= 1 << (page % 64);
    } else {
        set[page / 64] &= !(1 << (page % 64));
    }
}

impl Pages {
    /// The set as the machine starts: the first megabyte at nought and
    /// WinBox's copy of it, and WinBox's descriptor tables.
    pub fn new() -> Self {
        let mut pages = Self {
            present: vec![0; WORDS],
            committed: vec![0; WORDS],
            own: HashMap::new(),
        };

        pages.give(0, FIRST_MEGABYTE_LENGTH);
        pages.give(crate::FIRST_MEGABYTE, FIRST_MEGABYTE_LENGTH);
        pages.give(crate::GDT_BASE, 0u32.wrapping_sub(crate::GDT_BASE));
        pages
    }

    /// Whether the page holding `at` is present.
    pub fn present(&self, at: u32) -> bool {
        get(&self.present, page_of(at))
    }

    /// Whether the page holding `at` is committed to a block.
    pub fn committed(&self, at: u32) -> bool {
        get(&self.committed, page_of(at))
    }

    /// The pages over `length` bytes from `base` present and committed.
    pub fn give(&mut self, base: u32, length: u32) {
        for page in pages_over(base, length) {
            put(&mut self.present, page, true);
            put(&mut self.committed, page, true);
        }
    }

    /// The pages over `length` bytes from `base` neither present nor
    /// committed.
    pub fn take(&mut self, base: u32, length: u32) {
        for page in pages_over(base, length) {
            put(&mut self.present, page, false);
            put(&mut self.committed, page, false);
        }
    }

    /// Whether a block at `base` has pages of its own.
    pub fn owns(&self, base: u32) -> bool {
        self.own.contains_key(&base)
    }

    /// A block given pages of its own, from `base`, each with its
    /// fingerprint as given: present and committed, and the rest of the
    /// `room` it lies in neither.
    pub fn own(&mut self, base: u32, prints: Vec<Print>, room: u32) {
        self.take(base, room);
        self.give(base, (prints.len() as u32) << PAGE_BITS);
        self.own.insert(base, prints);
    }

    /// How many pages a block with pages of its own has.
    pub fn own_pages(&self, base: u32) -> Option<usize> {
        self.own.get(&base).map(Vec::len)
    }

    /// A block with pages of its own freed, `now` each page's fingerprint
    /// as it is freed: the pages WIN386's `_PageFree` leaves present
    /// ([`Pages::freed`]); none of them committed. Its pages, or `None`
    /// where the block has none of its own.
    pub fn free_own(&mut self, base: u32, now: &[Print]) -> Option<usize> {
        let prints = self.own.remove(&base)?;

        self.freed(base, &prints, now);
        Some(prints.len())
    }

    /// A block with pages of its own given `pages` pages, `prints` the new
    /// pages' fingerprints where it grows, `now` the fingerprints of the
    /// pages it gives up where it shrinks.
    pub fn resize_own(&mut self, base: u32, pages: usize, prints: &[Print], now: &[Print]) {
        let Some(mut kept) = self.own.remove(&base) else {
            return;
        };

        if pages < kept.len() {
            let cut = base + ((pages as u32) << PAGE_BITS);

            self.freed(cut, &kept[pages..], now);
            kept.truncate(pages);
        } else {
            let from = base + ((kept.len() as u32) << PAGE_BITS);

            self.give(from, ((pages - kept.len()) as u32) << PAGE_BITS);
            kept.extend_from_slice(prints);
        }

        self.own.insert(base, kept);
    }

    /// The pages from `base` freed as WIN386's `_PageFree` frees them.
    /// **Read out** of `WIN386.EXE`'s virtual machine manager, object 1:
    /// service 55h (`30eb`) calls `31e6` for the block's pages. Its loop
    /// (`323a`-`3294`) clears each page's record and gives its frame back,
    /// but the store that clears the page table entry (`323d`, `stosd`)
    /// writes through EDI, which `323f` then sets to the page's record for
    /// the call to `39de`, which keeps it: the first page's entry is
    /// cleared, and from the second on the store lands in the record
    /// before. The table is flushed after (`3296`). So the first page
    /// faults; a page given a frame -- by a read or a write, WIN386 giving
    /// frames as pages are first reached (`10b8`, `357c`) -- keeps its
    /// entry, present, its bytes there until the frame is given again;
    /// and a page never reached has no entry present, and its fault is
    /// refused, its record marked free (`3246`, bit 2 of byte 0Ah, tested
    /// at `10d2`-`10e5`). **Recorded** by `pgfree`: pages written or read
    /// alone read after 0502h, `GlobalFree` and 0503h's shrink, the first
    /// and those untouched fault; by `pgheap`: pages 1, 128 and 255 of 1 MiB.
    ///
    /// WinBox does not see a page reached: a page whose fingerprint has
    /// changed since it was given stands for one given a frame. A page
    /// only read, its bytes as they were, is taken for one never reached
    /// (`pgfree`'s pages read alone, a known case of the audit).
    pub fn freed(&mut self, base: u32, then: &[Print], now: &[Print]) {
        for (page, (was, is)) in then.iter().zip(now).enumerate() {
            let at = base + ((page as u32) << PAGE_BITS);
            let reached = page > 0 && touched(*was, *is);

            put(&mut self.committed, page_of(at), false);
            put(&mut self.present, page_of(at), reached);
        }
    }

    /// Whether 0600h or 0601h of `length` bytes from `base` are answered:
    /// WIN386's `_LinPageLock` (service 63h, `1337`) and `_LinPageUnLock`
    /// (64h, `1651`) call `190d`, which refuses a range holding a page whose
    /// record is marked free (`1922`-`1930`, bit 2 of byte 0Ah) -- the page
    /// past a block, a freed block's -- before it counts anything. Outside
    /// the pageable memory the services answer by other tests (the first
    /// megabyte's pages, `1438`; a range the manager keeps, `1386`-`139c`)
    /// that WinBox's addresses do not reach: WinBox answers there, as it
    /// always has. **Recorded** by `pglock` (the page past a block
    /// refused, 80000000h answered) and `pgfree` (a freed block's pages
    /// refused, those that still read too).
    pub fn lockable(&self, base: u32, length: u32) -> bool {
        pages_over(base, length).all(|page| {
            let at = (page as u32) << PAGE_BITS;

            !(FIRST_MEGABYTE_LENGTH..BLOCKS_END).contains(&at) || get(&self.committed, page)
        })
    }

    /// The pages committed to blocks with pages of their own: 0500h's
    /// largest free block is less by them.
    pub fn own_committed(&self) -> usize {
        self.own.values().map(Vec::len).sum()
    }
}

/// The fingerprint of a page of noughts, a mebibyte made since the page
/// was given.
pub fn nought_print() -> u64 {
    print_of(&[0; PAGE_SIZE as usize])
}

/// A page's bytes' fingerprint (FNV-1a, a word at a time).
pub fn print_of(bytes: &[u8]) -> u64 {
    bytes.chunks(8).fold(0xcbf2_9ce4_8422_2325, |hash, word| {
        let mut eight = [0; 8];

        eight[..word.len()].copy_from_slice(word);
        (hash ^ u64::from_le_bytes(eight)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// Whether a page was reached between two fingerprints: they differ, but
/// not where its mebibyte, never written, was made noughts by a write to
/// another page.
fn touched(was: Print, is: Print) -> bool {
    match (was, is) {
        (None, Some(print)) => print != nought_print(),
        _ => was != is,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_with_the_first_megabyte_and_the_tables() {
        let pages = Pages::new();

        assert!(pages.present(0x400));
        assert!(pages.present(0x10_ffff));
        assert!(!pages.present(0x11_0000));
        assert!(pages.present(crate::FIRST_MEGABYTE + 0x400));
        assert!(pages.present(crate::LDT_BASE));
        assert!(pages.present(0xffff_f000));
        assert!(!pages.present(0x8000_0000));
    }

    #[test]
    fn frees_as_page_free_does() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;
        let then = vec![Some(1); 6];
        let mut now = then.clone();

        pages.own(base, then, 0x10000);
        assert!(pages.present(base + 0x5fff));
        assert!(!pages.present(base + 0x6000));
        assert!(!pages.lockable(base + 0x5000, 0x2000));

        now[0] = Some(2);
        now[2] = Some(3);
        now[4] = Some(4);
        pages.free_own(base, &now);

        let left: Vec<bool> = (0..6).map(|page| pages.present(base + page * 0x1000)).collect();

        assert_eq!(left, [false, false, true, false, true, false]);
        assert!(!pages.lockable(base + 0x2000, 0x1000));
    }

    #[test]
    fn shrinks_and_grows() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;

        pages.own(base, vec![Some(1); 8], 0x10000);
        pages.resize_own(base, 2, &[], &[Some(2); 6]);

        let left: Vec<bool> = (0..9).map(|page| pages.present(base + page * 0x1000)).collect();

        assert_eq!(left, [true, true, false, true, true, true, true, true, false]);
        pages.resize_own(base, 12, &[Some(1); 10], &[]);
        assert!(pages.present(base + 0xb000));
        assert!(!pages.present(base + 0xc000));
        assert_eq!(pages.own_committed(), 12);
    }

    #[test]
    fn locks_outside_blocks_are_answered() {
        let pages = Pages::new();

        assert!(pages.lockable(0x8000_0000, 0x1000));
        assert!(pages.lockable(0xffff_f000, 0x1000));
        assert!(pages.lockable(0x400, 0x1000));
        assert!(!pages.lockable(0x0100_0000, 0x1000));
        assert!(pages.lockable(0x0100_0000, 0));
    }
}
