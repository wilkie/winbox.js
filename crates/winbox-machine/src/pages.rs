//! The linear pages WIN386 would have present for a program in 386
//! enhanced mode, kept beside the machine's memory as blocks are given and
//! freed (paging's phase 2, `kb/guides/paging.md`, "The set of present
//! pages"), and which pages of a block the processor has reached (phase 3,
//! "First touch").
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
//! * **Reached.** In 386 enhanced mode ([`Pages::track`]) each page of a
//!   block with pages of its own starts unreached. The processor's segments
//!   are cut short of the first such page (`winbox_cpu::Bus::reached`), so
//!   that its first access goes off the common path, which takes the page
//!   as reached (`winbox_cpu::Bus::reach`) and lets the access run.
//! * **A block freed** (0502h, `GlobalFree`, or the pages 0503h cuts off)
//!   keeps the pages WIN386's `_PageFree` leaves in its page tables
//!   ([`Pages::freed`]): those reached, but the first.

use std::cell::Cell;
use std::collections::BTreeMap;

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

/// The set: which linear pages are present, which are committed to a
/// block (what 0600h locks), and the blocks with pages of their own and
/// which of their pages are not yet reached.
#[derive(Clone)]
pub struct Pages {
    present: Vec<u64>,
    /// A bit for each word of `present` whose 64 pages are all present,
    /// passed over whole where the first page not present is looked for.
    whole: Vec<u64>,
    committed: Vec<u64>,
    /// The pages of blocks with pages of their own not yet reached, a bit
    /// each, and how many there are. Marked reached by the processor's
    /// reads, which see the set through `&self`.
    unreached: Vec<Cell<u64>>,
    left: Cell<usize>,
    /// The blocks with pages of their own, by base: how many pages each.
    own: BTreeMap<u32, usize>,
    /// Whether a block's pages start unreached: 386 enhanced mode's.
    tracked: bool,
    /// Whether an access to a page not present is a page fault.
    enforced: bool,
    /// A count moved by every change the processor's segments' reach
    /// depends on: a page reached, given or taken.
    epoch: Cell<u64>,
}

impl std::fmt::Debug for Pages {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let present: u32 = self.present.iter().map(|word| word.count_ones()).sum();

        write!(
            f,
            "Pages {{ {present} present, {} own blocks, {} unreached }}",
            self.own.len(),
            self.left.get()
        )
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

fn page_at(page: usize) -> u32 {
    (page as u32) << PAGE_BITS
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

fn get_cell(set: &[Cell<u64>], page: usize) -> bool {
    set[page / 64].get() & (1 << (page % 64)) != 0
}

fn put(set: &mut [u64], page: usize, on: bool) {
    if on {
        set[page / 64] |= 1 << (page % 64);
    } else {
        set[page / 64] &= !(1 << (page % 64));
    }
}

/// The first page from `from` up to `to` whose bit is `on`, the set read a
/// word of 64 pages at a time.
fn first_bit(word_of: impl Fn(usize) -> u64, from: usize, to: usize, on: bool) -> Option<usize> {
    let mut page = from;

    while page < to {
        let word = word_of(page / 64);
        let word = if on { word } else { !word };
        let left = word >> (page % 64);

        if left != 0 {
            let found = page + left.trailing_zeros() as usize;

            return (found < to).then_some(found);
        }

        page = (page / 64 + 1) * 64;
    }

    None
}

impl Pages {
    /// The set as the machine starts: the first megabyte at nought and
    /// WinBox's copy of it, and WinBox's descriptor tables.
    pub fn new() -> Self {
        let mut pages = Self {
            present: vec![0; WORDS],
            whole: vec![0; WORDS / 64],
            committed: vec![0; WORDS],
            unreached: vec![Cell::new(0); WORDS],
            left: Cell::new(0),
            own: BTreeMap::new(),
            tracked: false,
            enforced: false,
            epoch: Cell::new(0),
        };

        pages.give(0, FIRST_MEGABYTE_LENGTH);

        // Memory WinBox's layout leaves unused -- the rest of a block's
        // 64 KiB past its pages, a descriptor's slot given to nothing -- is
        // present, committed to nothing (the owner's decision of
        // 2026-11-11): WinBox faults only where Windows certainly does.
        for page in pages_over(FIRST_MEGABYTE_LENGTH, BLOCKS_END - FIRST_MEGABYTE_LENGTH) {
            pages.set_present(page, true);
        }

        pages.give(crate::FIRST_MEGABYTE, FIRST_MEGABYTE_LENGTH);
        pages.give(crate::GDT_BASE, 0u32.wrapping_sub(crate::GDT_BASE));
        pages
    }

    /// Whether the pages of blocks given from now on start unreached, as
    /// in 386 enhanced mode; off, every page is taken as reached.
    pub fn track(&mut self, on: bool) {
        self.tracked = on;
    }

    pub fn tracked(&self) -> bool {
        self.tracked
    }

    /// Whether an access to a page not present is a page fault.
    pub fn enforce(&mut self, on: bool) {
        self.enforced = on;
        self.moved();
    }

    pub fn enforced(&self) -> bool {
        self.enforced
    }

    fn moved(&self) {
        self.epoch.set(self.epoch.get() + 1);
    }

    /// A count that moves with every change of the pages the processor
    /// must ask of.
    pub fn epoch(&self) -> u64 {
        self.epoch.get()
    }

    /// Whether the page holding `at` is present.
    pub fn present(&self, at: u32) -> bool {
        get(&self.present, page_of(at))
    }

    /// Whether the page holding `at` is committed to a block.
    pub fn committed(&self, at: u32) -> bool {
        get(&self.committed, page_of(at))
    }

    /// Whether the page holding `at` is a page of a block not yet reached.
    pub fn unreached(&self, at: u32) -> bool {
        get_cell(&self.unreached, page_of(at))
    }

    fn set_present(&mut self, page: usize, on: bool) {
        put(&mut self.present, page, on);
        put(
            &mut self.whole,
            page / 64,
            self.present[page / 64] == u64::MAX,
        );
    }

    /// A page of a block marked not yet reached, or reached.
    fn set_unreached(&self, page: usize, on: bool) {
        let word = &self.unreached[page / 64];
        let bit = 1 << (page % 64);

        if (word.get() & bit != 0) == on {
            return;
        }

        word.set(word.get() ^ bit);
        self.left.set(if on {
            self.left.get() + 1
        } else {
            self.left.get() - 1
        });
    }

    /// The pages over `length` bytes from `base` present and committed.
    pub fn give(&mut self, base: u32, length: u32) {
        for page in pages_over(base, length) {
            self.set_present(page, true);
            put(&mut self.committed, page, true);
        }

        self.moved();
    }

    /// The pages over `length` bytes from `base` committed to nothing, nor
    /// any block's: present still, as memory WinBox's layout leaves unused.
    pub fn take(&mut self, base: u32, length: u32) {
        for page in pages_over(base, length) {
            self.set_present(page, true);
            put(&mut self.committed, page, false);
            self.set_unreached(page, false);
        }

        self.moved();
    }

    /// Whether a block at `base` has pages of its own.
    pub fn owns(&self, base: u32) -> bool {
        self.own.contains_key(&base)
    }

    /// A block given `pages` pages of its own, from `base`: present and
    /// committed, not yet reached where pages are tracked, and the rest of
    /// the `room` it lies in committed to nothing.
    pub fn own(&mut self, base: u32, pages: usize, room: u32) {
        self.take(base, room);
        self.give(base, page_at(pages));

        if self.tracked {
            for page in pages_over(base, page_at(pages)) {
                self.set_unreached(page, true);
            }
        }

        self.own.insert(base, pages);
    }

    /// How many pages a block with pages of its own has.
    pub fn own_pages(&self, base: u32) -> Option<usize> {
        self.own.get(&base).copied()
    }

    /// A block with pages of its own freed: the pages WIN386's `_PageFree`
    /// leaves present ([`Pages::freed`]); none of them committed. Its
    /// pages, or `None` where the block has none of its own.
    pub fn free_own(&mut self, base: u32) -> Option<usize> {
        let pages = self.own.remove(&base)?;

        self.freed(base, pages);
        Some(pages)
    }

    /// A block with pages of its own given `pages` pages in place: the
    /// pages it gives up freed, the new ones not yet reached.
    pub fn resize_own(&mut self, base: u32, pages: usize) {
        let Some(&had) = self.own.get(&base) else {
            return;
        };

        if pages < had {
            self.freed(base + page_at(pages), had - pages);
        } else {
            let from = base + page_at(had);

            self.give(from, page_at(pages - had));

            if self.tracked {
                for page in pages_over(from, page_at(pages - had)) {
                    self.set_unreached(page, true);
                }
            }
        }

        self.own.insert(base, pages);
    }

    /// A block with pages of its own moved to `to`, given `pages` pages in
    /// `room` there: each page it keeps reached where it was, and the old
    /// block freed.
    pub fn move_own(&mut self, from: u32, to: u32, pages: usize, room: u32) {
        let Some(&had) = self.own.get(&from) else {
            return;
        };

        self.own(to, pages, room);

        for page in 0..had.min(pages) {
            if !self.unreached(from + page_at(page)) {
                self.set_unreached(page_of(to) + page, false);
            }
        }

        self.free_own(from);
    }

    /// `count` pages from `base` freed as WIN386's `_PageFree` frees them.
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
    pub fn freed(&mut self, base: u32, count: usize) {
        for (index, page) in pages_over(base, page_at(count)).enumerate() {
            let reached = index > 0 && !get_cell(&self.unreached, page);

            self.set_unreached(page, false);
            put(&mut self.committed, page, false);
            self.set_present(page, reached);
        }

        self.moved();
    }

    /// How many of `length` bytes from `base` lie before the first page
    /// that must be asked of: one not yet reached, or, enforced, one not
    /// present. Linear addresses wrap round 4 GiB.
    pub fn reached(&self, base: u32, length: u64) -> u64 {
        if length == 0 || (self.left.get() == 0 && !self.enforced) {
            return length;
        }

        let first = page_of(base);
        let last = page_of(base.wrapping_add((length - 1) as u32));
        let found = if length > u64::from(u32::MAX) || last < first {
            self.first_asked(first, PAGES)
                .or_else(|| self.first_asked(0, last + 1))
        } else {
            self.first_asked(first, last + 1)
        };

        match found {
            None => length,
            Some(page) if page == first => 0,
            Some(page) => u64::from(page_at(page).wrapping_sub(base)).min(length),
        }
    }

    /// The first page from `from` up to `to` that must be asked of.
    fn first_asked(&self, from: usize, to: usize) -> Option<usize> {
        let mut found = if self.enforced {
            self.first_absent(from, to)
        } else {
            None
        };

        if self.left.get() > 0 {
            for (&base, &pages) in &self.own {
                let start = page_of(base).max(from);
                let end = (page_of(base) + pages).min(found.unwrap_or(to));

                if start < end
                    && let Some(page) =
                        first_bit(|word| self.unreached[word].get(), start, end, true)
                {
                    found = Some(page);
                }
            }
        }

        found
    }

    /// The first page from `from` up to `to` not present, each word of 64
    /// pages all present passed over whole.
    fn first_absent(&self, from: usize, to: usize) -> Option<usize> {
        let mut page = from;

        while page < to {
            let word = page / 64;

            if get(&self.whole, word) {
                page = (word + 1) * 64;
                continue;
            }

            let stop = ((word + 1) * 64).min(to);

            if let Some(found) = first_bit(|at| self.present[at], page, stop, false) {
                return Some(found);
            }

            page = stop;
        }

        None
    }

    /// An access of `size` bytes at `at` asked of: false where enforced and
    /// one of its pages is not present; else each of its pages taken as
    /// reached.
    pub fn reach(&self, at: u32, size: u32) -> bool {
        let pages = [page_of(at), page_of(at.wrapping_add(size.max(1) - 1))];

        if self.enforced && pages.iter().any(|&page| !get(&self.present, page)) {
            return false;
        }

        for page in pages {
            if get_cell(&self.unreached, page) {
                self.set_unreached(page, false);
                self.moved();
            }
        }

        true
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
            let at = page_at(page);

            !(FIRST_MEGABYTE_LENGTH..BLOCKS_END).contains(&at) || get(&self.committed, page)
        })
    }

    /// The pages committed to blocks with pages of their own: 0500h's
    /// largest free block is less by them.
    pub fn own_committed(&self) -> usize {
        self.own.values().sum()
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
        // Unused by WinBox's layout, present.
        assert!(pages.present(0x11_0000));
        assert!(pages.present(BLOCKS_END - 1));
        assert!(!pages.present(BLOCKS_END));
        assert!(pages.present(crate::FIRST_MEGABYTE + 0x400));
        assert!(pages.present(crate::LDT_BASE));
        assert!(pages.present(0xffff_f000));
        assert!(!pages.present(0x8000_0000));
    }

    #[test]
    fn frees_as_page_free_does() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;

        pages.track(true);
        pages.own(base, 6, 0x10000);
        assert!(pages.present(base + 0x5fff));
        assert!(pages.present(base + 0x6000));
        assert!(!pages.committed(base + 0x6000));
        assert!(!pages.lockable(base + 0x5000, 0x2000));

        assert!(pages.reach(base, 1));
        assert!(pages.reach(base + 0x2fff, 2));
        assert!(pages.reach(base + 0x4000, 4));
        pages.free_own(base);

        let left: Vec<bool> = (0..6)
            .map(|page| pages.present(base + page * 0x1000))
            .collect();

        assert_eq!(left, [false, false, true, true, true, false]);
        assert!(!pages.lockable(base + 0x2000, 0x1000));
    }

    #[test]
    fn untracked_every_page_is_reached() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;

        pages.own(base, 3, 0x10000);
        assert_eq!(pages.reached(base, 0x10000), 0x10000);
        pages.free_own(base);
        assert!(!pages.present(base));
        assert!(pages.present(base + 0x2000));
    }

    #[test]
    fn shrinks_and_grows() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;

        pages.track(true);
        pages.own(base, 8, 0x10000);

        for page in 0..8 {
            pages.reach(base + page * 0x1000, 1);
        }

        pages.resize_own(base, 2);

        let left: Vec<bool> = (0..9)
            .map(|page| pages.present(base + page * 0x1000))
            .collect();

        assert_eq!(
            left,
            [true, true, false, true, true, true, true, true, true]
        );
        pages.resize_own(base, 12);
        assert!(pages.present(base + 0xb000));
        assert!(!pages.committed(base + 0xc000));
        assert!(pages.unreached(base + 0xb000));
        assert_eq!(pages.own_committed(), 12);
    }

    #[test]
    fn a_moved_block_keeps_its_pages_reached() {
        let mut pages = Pages::new();
        let (from, to) = (0x0100_0000, 0x0200_0000);

        pages.track(true);
        pages.own(from, 2, 0x10000);
        pages.reach(from + 0x1000, 1);
        pages.move_own(from, to, 4, 0x10000);
        assert!(pages.unreached(to));
        assert!(!pages.unreached(to + 0x1000));
        assert!(pages.unreached(to + 0x2000));
        assert!(pages.present(from + 0x1000));
        assert!(!pages.owns(from));
    }

    #[test]
    fn a_segment_reaches_up_to_the_first_page_not_reached() {
        let mut pages = Pages::new();
        let base = 0x0100_0000;

        assert_eq!(pages.reached(0, 0x1_0000_0000), 0x1_0000_0000);
        pages.track(true);
        pages.own(base, 4, 0x10000);
        assert_eq!(pages.reached(base, 0x10000), 0);
        assert_eq!(pages.reached(base - 0x10, 0x10000), 0x10);
        assert_eq!(pages.reached(0, 0x1_0000_0000), u64::from(base));

        pages.reach(base, 1);
        pages.reach(base + 0x2000, 1);
        assert_eq!(pages.reached(base, 0x10000), 0x1000);
        assert_eq!(pages.reached(base + 0x2000, 0x10000), 0x1000);
        assert_eq!(pages.reached(base + 0x2100, 0x10000), 0xf00);

        // A flat segment that wraps round 4 GiB.
        assert_eq!(pages.reached(0x8000_0000, 0x1_0000_0000), 0x8100_1000);

        pages.reach(base + 0x1000, 1);
        pages.reach(base + 0x3000, 1);
        assert_eq!(pages.reached(base, 0x10000), 0x10000);
    }

    #[test]
    fn enforced_a_segment_reaches_up_to_the_first_page_not_present() {
        let mut pages = Pages::new();

        pages.enforce(true);
        assert_eq!(pages.reached(0, 0x1_0000_0000), u64::from(BLOCKS_END));
        assert_eq!(pages.reached(0xffe0_0000, 0x10000), 0x10000);
        assert!(!pages.reach(0x8000_0000, 1));
        assert!(pages.reach(0x400, 2));
        assert!(!pages.reach(BLOCKS_END - 2, 4));

        // A freed block's first page, and its pages never reached.
        pages.track(true);
        pages.own(0x0100_0000, 3, 0x10000);
        pages.reach(0x0100_0000, 1);
        pages.reach(0x0100_2000, 1);
        pages.free_own(0x0100_0000);
        assert_eq!(pages.reached(0x0100_0000, 0x10000), 0);
        assert_eq!(pages.reached(0x0100_2000, 0x10000), 0x10000);
        assert_eq!(pages.reached(0x0100_0000 - 0x10, 0x100), 0x10);
        assert!(!pages.reach(0x0100_1000, 1));
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
