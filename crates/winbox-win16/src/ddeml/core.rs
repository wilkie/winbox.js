//! What every routine of WinBox's `DDEML` stands on: its data segment and
//! the guest memory its structures live in, its calls into KERNEL and USER
//! made as `DDEML.DLL` makes them, and the little library of lists, arrays
//! and queues `DDEML.DLL` keeps them in (seg1 `2144`-`2d80`, `5eae`-`6114`,
//! `6118`-`62dc`, `7334`-`74d4`). As `src/win16/ddeml/core.ts`.
//!
//! Every structure is where `DDEML.DLL` puts it and laid out as it lays it
//! out: the instances in DDEML's own local heap, everything of an
//! instance's in a local heap of 4 KB of its own in a global block, the
//! queues each in a global heap of their own. A routine here is the C of
//! `DDEML.DLL` read back from its code, a far pointer a `u32` of selector
//! and offset as the code holds one.

use winbox_cpu::{DS, SP, SS};

use crate::call::Stop;
use crate::commdlg::api::{self, Arg, Called};
use crate::engine::{Engine, GuestArg, Register};

pub(crate) type R<T> = Result<T, Stop>;

/// A far pointer's selector, offset, and the two made one.
pub(crate) const fn sel(far: u32) -> u16 {
    (far >> 16) as u16
}

pub(crate) const fn off(far: u32) -> u16 {
    far as u16
}

pub(crate) const fn far(selector: u16, offset: u16) -> u32 {
    (selector as u32) << 16 | offset as u32
}

/// A far pointer `n` bytes on, in its segment.
pub(crate) const fn plus(at: u32, n: u16) -> u32 {
    far(sel(at), off(at).wrapping_add(n))
}

pub(crate) const fn lo(value: u32) -> u16 {
    value as u16
}

pub(crate) const fn hi(value: u32) -> u16 {
    (value >> 16) as u16
}

pub(crate) const fn long(low: u16, high: u16) -> u32 {
    (high as u32) << 16 | low as u32
}

/// The comparisons the lists are searched with, by their places in seg1:
/// a doubleword (`2278`), the first word (`22a0`), the second word
/// (`22be`), and an advise link's fields with nought for any (`2518`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cmp {
    Dword,
    First,
    Second,
    Link,
}

/// One of the calls made: `DDEML.DLL` as it runs.
pub(crate) struct Dd<'e> {
    pub e: &'e Engine,
}

impl<'e> Dd<'e> {
    pub(crate) fn new(e: &'e Engine) -> Self {
        Self { e }
    }

    // DDEML's data segment.

    /// Its selector.
    pub(crate) fn ds(&self) -> u16 {
        super::data_selector(&self.e.system())
    }

    /// A word of DDEML's data, by its offset.
    pub(crate) fn d16(&self, at: u16) -> u16 {
        let ds = self.ds();

        self.r16(far(ds, at))
    }

    pub(crate) fn sd16(&self, at: u16, value: u16) {
        let ds = self.ds();

        self.w16(far(ds, at), value);
    }

    /// A far pointer to DDEML's data.
    pub(crate) fn near(&self, at: u16) -> u32 {
        far(self.ds(), at)
    }

    // Guest memory.

    pub(crate) fn read(&self, at: u32, n: usize) -> Vec<u8> {
        self.e.system().read_far(at, n)
    }

    pub(crate) fn write(&self, at: u32, bytes: &[u8]) {
        self.e.system().write_far(at, bytes);
    }

    pub(crate) fn r8(&self, at: u32) -> u8 {
        self.read(at, 1)[0]
    }

    pub(crate) fn w8(&self, at: u32, value: u8) {
        self.write(at, &[value]);
    }

    pub(crate) fn r16(&self, at: u32) -> u16 {
        let bytes = self.read(at, 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    pub(crate) fn w16(&self, at: u32, value: u16) {
        self.write(at, &value.to_le_bytes());
    }

    pub(crate) fn r32(&self, at: u32) -> u32 {
        let bytes = self.read(at, 4);

        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    }

    pub(crate) fn w32(&self, at: u32, value: u32) {
        self.write(at, &value.to_le_bytes());
    }

    /// A word of an instance's record, by the instance's offset.
    pub(crate) fn i16(&self, instance: u16, field: u16) -> u16 {
        self.d16(instance.wrapping_add(field))
    }

    pub(crate) fn si16(&self, instance: u16, field: u16, value: u16) {
        self.sd16(instance.wrapping_add(field), value);
    }

    pub(crate) fn i32(&self, instance: u16, field: u16) -> u32 {
        self.r32(self.near(instance.wrapping_add(field)))
    }

    pub(crate) fn si32(&self, instance: u16, field: u16, value: u32) {
        self.w32(self.near(instance.wrapping_add(field)), value);
    }

    // Calls into KERNEL, USER, GDI and KEYBOARD.

    /// An export called as `DDEML.DLL` calls it: its answer and buffers.
    pub(crate) async fn call_b(&self, module: &str, name: &str, args: &[Arg]) -> R<Called> {
        api::api(self.e, module, name, args).await
    }

    /// An export's answer, DX:AX.
    pub(crate) async fn call(&self, module: &str, name: &str, args: &[Arg]) -> R<u32> {
        Ok(self.call_b(module, name, args).await?.value)
    }

    pub(crate) async fn user(&self, name: &str, args: &[Arg]) -> R<u32> {
        self.call("USER", name, args).await
    }

    pub(crate) async fn kernel(&self, name: &str, args: &[Arg]) -> R<u32> {
        self.call("KERNEL", name, args).await
    }

    /// A KERNEL call that works on the local heap of the segment in DS,
    /// made with DS that segment (`735c`, the C library's switch of DS).
    pub(crate) async fn kernel_in(&self, segment: u16, name: &str, args: &[Arg]) -> R<u32> {
        let saved = self.e.system().cpu.segments[DS].selector;

        self.load_ds(segment)?;

        let answer = self.kernel(name, args).await;

        self.load_ds(saved)?;
        answer
    }

    fn load_ds(&self, selector: u16) -> R<()> {
        self.e
            .system()
            .cpu
            .load_segment(DS, selector)
            .map_err(Stop::Processor)
    }

    pub(crate) async fn is_window(&self, hwnd: u16) -> R<bool> {
        Ok(self.user("IsWindow", &[Arg::W(hwnd)]).await? as u16 != 0)
    }

    pub(crate) async fn window_word(&self, hwnd: u16, index: u16) -> R<u16> {
        Ok(self
            .user("GetWindowWord", &[Arg::W(hwnd), Arg::W(index)])
            .await? as u16)
    }

    pub(crate) async fn window_long(&self, hwnd: u16, index: u16) -> R<u32> {
        self.user("GetWindowLong", &[Arg::W(hwnd), Arg::W(index)])
            .await
    }

    pub(crate) async fn set_window_word(&self, hwnd: u16, index: u16, value: u16) -> R<u16> {
        Ok(self
            .user(
                "SetWindowWord",
                &[Arg::W(hwnd), Arg::W(index), Arg::W(value)],
            )
            .await? as u16)
    }

    pub(crate) async fn set_window_long(&self, hwnd: u16, index: u16, value: u32) -> R<u32> {
        self.user(
            "SetWindowLong",
            &[Arg::W(hwnd), Arg::W(index), Arg::D(value)],
        )
        .await
    }

    pub(crate) async fn get_window(&self, hwnd: u16, command: u16) -> R<u16> {
        Ok(self
            .user("GetWindow", &[Arg::W(hwnd), Arg::W(command)])
            .await? as u16)
    }

    pub(crate) async fn get_parent(&self, hwnd: u16) -> R<u16> {
        Ok(self.user("GetParent", &[Arg::W(hwnd)]).await? as u16)
    }

    pub(crate) async fn set_parent(&self, hwnd: u16, parent: u16) -> R<u16> {
        Ok(self
            .user("SetParent", &[Arg::W(hwnd), Arg::W(parent)])
            .await? as u16)
    }

    pub(crate) async fn window_task(&self, hwnd: u16) -> R<u16> {
        Ok(self.user("GetWindowTask", &[Arg::W(hwnd)]).await? as u16)
    }

    pub(crate) async fn current_task(&self) -> R<u16> {
        Ok(self.kernel("GetCurrentTask", &[]).await? as u16)
    }

    pub(crate) async fn current_time(&self) -> R<u32> {
        self.user("GetCurrentTime", &[]).await
    }

    pub(crate) async fn send(&self, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
        self.user(
            "SendMessage",
            &[
                Arg::W(hwnd),
                Arg::W(message),
                Arg::W(wparam),
                Arg::D(lparam),
            ],
        )
        .await
    }

    pub(crate) async fn post(&self, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u16> {
        Ok(self
            .user(
                "PostMessage",
                &[
                    Arg::W(hwnd),
                    Arg::W(message),
                    Arg::W(wparam),
                    Arg::D(lparam),
                ],
            )
            .await? as u16)
    }

    pub(crate) async fn destroy_window(&self, hwnd: u16) -> R<u16> {
        Ok(self.user("DestroyWindow", &[Arg::W(hwnd)]).await? as u16)
    }

    pub(crate) async fn set_timer(&self, hwnd: u16, id: u16, elapse: u16) -> R<u16> {
        Ok(self
            .user(
                "SetTimer",
                &[Arg::W(hwnd), Arg::W(id), Arg::W(elapse), Arg::D(0)],
            )
            .await? as u16)
    }

    pub(crate) async fn kill_timer(&self, hwnd: u16, id: u16) -> R<u16> {
        Ok(self.user("KillTimer", &[Arg::W(hwnd), Arg::W(id)]).await? as u16)
    }

    /// `CreateWindow(class, "", style, 0, 0, 0, 0, parent, 0, DDEML's
    /// instance, lpParam)`, the class and the empty name DDEML's own strings.
    pub(crate) async fn create_window(
        &self,
        class: u16,
        style: u32,
        parent: u16,
        param: u32,
    ) -> R<u16> {
        let instance = self.d16(super::D_HINSTANCE);

        Ok(self
            .user(
                "CreateWindow",
                &[
                    Arg::D(self.near(class)),
                    Arg::D(self.near(super::D_EMPTY)),
                    Arg::D(style),
                    Arg::W(0),
                    Arg::W(0),
                    Arg::W(0),
                    Arg::W(0),
                    Arg::W(parent),
                    Arg::W(0),
                    Arg::W(instance),
                    Arg::D(param),
                ],
            )
            .await? as u16)
    }

    pub(crate) async fn global_alloc(&self, flags: u16, size: u32) -> R<u16> {
        Ok(self
            .kernel("GlobalAlloc", &[Arg::W(flags), Arg::D(size)])
            .await? as u16)
    }

    pub(crate) async fn global_lock(&self, handle: u16) -> R<u32> {
        self.kernel("GlobalLock", &[Arg::W(handle)]).await
    }

    pub(crate) async fn global_unlock(&self, handle: u16) -> R<u16> {
        Ok(self.kernel("GlobalUnlock", &[Arg::W(handle)]).await? as u16)
    }

    pub(crate) async fn global_free(&self, handle: u16) -> R<u16> {
        Ok(self.kernel("GlobalFree", &[Arg::W(handle)]).await? as u16)
    }

    pub(crate) async fn global_size(&self, handle: u16) -> R<u32> {
        self.kernel("GlobalSize", &[Arg::W(handle)]).await
    }

    pub(crate) async fn add_atom_text(&self, text: &[u8]) -> R<u16> {
        Ok(self.user("GlobalAddAtom", &[api::text(text)]).await? as u16)
    }

    /// `GlobalAddAtom` of a string in guest memory.
    pub(crate) async fn add_atom_at(&self, string: u32) -> R<u16> {
        Ok(self.user("GlobalAddAtom", &[Arg::D(string)]).await? as u16)
    }

    pub(crate) async fn find_atom_at(&self, string: u32) -> R<u16> {
        Ok(self.user("GlobalFindAtom", &[Arg::D(string)]).await? as u16)
    }

    pub(crate) async fn delete_atom_raw(&self, atom: u16) -> R<u16> {
        Ok(self.user("GlobalDeleteAtom", &[Arg::W(atom)]).await? as u16)
    }

    /// `GlobalGetAtomName(atom, buffer, size)` into a buffer of DDEML's
    /// stack: the length and the name.
    pub(crate) async fn atom_name(&self, atom: u16, size: u16) -> R<(u16, Vec<u8>)> {
        let called = self
            .call_b(
                "USER",
                "GlobalGetAtomName",
                &[Arg::W(atom), api::buffer(usize::from(size)), Arg::W(size)],
            )
            .await?;

        Ok((called.word(), called.string(0)))
    }

    /// `GlobalGetAtomName` into guest memory: the length.
    pub(crate) async fn atom_name_at(&self, atom: u16, buffer: u32, size: u16) -> R<u16> {
        Ok(self
            .user(
                "GlobalGetAtomName",
                &[Arg::W(atom), Arg::D(buffer), Arg::W(size)],
            )
            .await? as u16)
    }

    // Space on DDEML's stack, for a structure a call is handed a pointer
    // to and that must outlast the call that makes it.

    /// `n` bytes taken below the stack: their far address, and the stack
    /// pointer to give back.
    pub(crate) fn reserve(&self, n: u16) -> (u32, u16) {
        let mut system = self.e.system();
        let saved = system.cpu.regs[SP];
        let at = saved.wrapping_sub((n + 1) & !1);

        system.cpu.regs[SP] = at;

        (far(system.cpu.segments[SS].selector, at), saved)
    }

    pub(crate) fn release(&self, saved: u16) {
        self.e.system().cpu.regs[SP] = saved;
    }

    /// A program's procedure called far with Pascal arguments and DDEML's
    /// data segment in DS, as `DDEML.DLL` calls a callback (`58ef`).
    pub(crate) async fn call_far(&self, procedure: u32, args: &[GuestArg]) -> R<u32> {
        let ds = self.ds();

        Ok(self
            .e
            .call_with(procedure, args, &[Register::Segment(DS, ds)])
            .await?
            .0)
    }

    // The C library's memory (`7334`, `7396`, `2c66`).

    /// `2c66`: `size` bytes copied from `from` to `to`, across segments as
    /// huge pointers go (`__AHINCR`).
    pub(crate) fn copy(&self, from: u32, to: u32, size: u32) {
        let mut from = from;
        let mut to = to;
        let mut left = size;

        while left > 0 {
            let room = (0x1_0000 - u32::from(off(from))).min(0x1_0000 - u32::from(off(to)));
            let count = room.min(left);
            let bytes = self.read(from, count as usize);

            self.write(to, &bytes);
            from = Self::huge(from, count);
            to = Self::huge(to, count);
            left -= count;
        }
    }

    /// `7334`: a huge pointer `n` bytes on.
    pub(crate) fn huge(at: u32, n: u32) -> u32 {
        let total = u32::from(off(at)) + n;

        far(sel(at).wrapping_add((total >> 16) as u16 * 8), total as u16)
    }

    // The heaps (`6118`-`62dc`).

    /// `6118`: a global heap of `size` bytes, `GMEM_MOVEABLE`, its local
    /// heap made in it: its handle, or nought.
    pub(crate) async fn heap_create(&self, size: u16) -> R<u16> {
        let handle = self.global_alloc(0x0002, u32::from(size)).await?;

        if handle == 0 {
            return Ok(0);
        }

        let locked = self.global_lock(handle).await?;

        if locked == 0 {
            self.global_free(handle).await?;
            return Ok(0);
        }

        let made = self
            .kernel(
                "LocalInit",
                &[Arg::W(hi(locked)), Arg::W(0), Arg::W(size.wrapping_sub(1))],
            )
            .await? as u16;

        self.global_unlock(handle).await?;

        if made == 0 {
            self.global_free(handle).await?;
            return Ok(0);
        }

        Ok(handle)
    }

    /// `6182`: a heap freed, unless still locked.
    pub(crate) async fn heap_free(&self, handle: u16) -> R<u16> {
        if self.global_unlock(handle).await? != 0 {
            return Ok(handle);
        }

        self.global_free(handle).await
    }

    /// A heap's segment locked: DDEML's own data segment is its own.
    async fn heap_lock(&self, handle: u16) -> R<u16> {
        if handle == self.ds() {
            return Ok(handle);
        }

        Ok(hi(self.global_lock(handle).await?))
    }

    async fn heap_unlock(&self, handle: u16) -> R<()> {
        if handle != self.ds() {
            self.global_unlock(handle).await?;
        }

        Ok(())
    }

    /// `6250`: `size` bytes of a heap, `LMEM_ZEROINIT`, as a far pointer;
    /// a heap full calls `61a8` and tries again while it answers.
    pub(crate) async fn alloc(&self, handle: u16, size: u16) -> R<u32> {
        let segment = self.heap_lock(handle).await?;

        if segment == 0 {
            return Ok(0);
        }

        let block = loop {
            let block = self
                .kernel_in(segment, "LocalAlloc", &[Arg::W(0x40), Arg::W(size)])
                .await? as u16;

            if block != 0 || Box::pin(super::monitor::heap_full(self, handle)).await? == 0 {
                break block;
            }
        };

        self.heap_unlock(handle).await?;

        Ok(if block == 0 { 0 } else { far(segment, block) })
    }

    /// `62b6`: a block of a heap freed.
    pub(crate) async fn free(&self, block: u32) -> R<()> {
        let handle = self
            .kernel_in(sel(block), "LocalHandle", &[Arg::W(off(block))])
            .await? as u16;

        self.kernel_in(sel(block), "LocalFree", &[Arg::W(handle)])
            .await?;
        Ok(())
    }

    // Lists: a header of eight bytes, the first item, the heap and the
    // size of an item's data; each item the next and then its data.

    /// `2144`: a list's header.
    pub(crate) async fn list_new(&self, heap: u16, size: u16) -> R<u32> {
        let header = self.alloc(heap, 8).await?;

        if header == 0 {
            return Ok(0);
        }

        self.w16(plus(header, 4), heap);
        self.w16(plus(header, 6), size);
        self.w32(header, 0);
        Ok(header)
    }

    /// `218a`: every item freed, and the header.
    pub(crate) async fn list_free(&self, header: u32) -> R<()> {
        if header == 0 {
            return Ok(());
        }

        loop {
            let first = self.r32(header);

            if first == 0 {
                break;
            }

            self.list_remove(header, first).await?;
        }

        self.free(header).await
    }

    /// The comparison `2212` and `29d8` make: whether `item` matches `key`.
    fn compare(&self, cmp: Cmp, item: u32, key: u32) -> bool {
        match cmp {
            Cmp::Dword => self.r32(key) == self.r32(item),
            Cmp::First => self.r16(key) == self.r16(item),
            Cmp::Second => self.r16(plus(key, 2)) == self.r16(plus(item, 2)),
            Cmp::Link => self.link_matches(plus(item, 0xfffc), plus(key, 0xfffc)),
        }
    }

    /// `2518`: an advise link against a key whose noughts match anything:
    /// item (4), topic (6), format (8), window (0Ch).
    fn link_matches(&self, item: u32, key: u32) -> bool {
        for field in [6, 0xc, 4, 8] {
            let wanted = self.r16(plus(key, field));

            if wanted != 0 && self.r16(plus(item, field)) != wanted {
                return false;
            }
        }

        true
    }

    /// `2212`: the first item whose data matches the key's data.
    pub(crate) fn list_find(&self, header: u32, cmp: Cmp, key: u32) -> u32 {
        if header == 0 {
            return 0;
        }

        let mut item = self.r32(header);

        while item != 0 {
            if self.compare(cmp, plus(item, 4), key) {
                break;
            }

            item = self.r32(item);
        }

        item
    }

    /// `22de`: an item made, put last, or first with flag 1, or not linked
    /// with flag 2.
    pub(crate) async fn list_add(&self, header: u32, flags: u16) -> R<u32> {
        if header == 0 {
            return Ok(0);
        }

        let item = self
            .alloc(
                self.r16(plus(header, 4)),
                self.r16(plus(header, 6)).wrapping_add(4),
            )
            .await?;

        if item == 0 || flags & 2 != 0 {
            return Ok(item);
        }

        let first = self.r32(header);

        if first != 0 && flags & 1 == 0 {
            let mut last = first;

            while self.r32(last) != 0 {
                last = self.r32(last);
            }

            self.w32(last, item);
            self.w32(item, 0);
        } else {
            self.w32(item, first);
            self.w32(header, item);
        }

        Ok(item)
    }

    /// `2392`: an item taken out of its list and freed -- freed even when
    /// it is not found in it.
    pub(crate) async fn list_remove(&self, header: u32, item: u32) -> R<bool> {
        if header == 0 || item == 0 {
            return Ok(false);
        }

        let first = self.r32(header);

        if first == 0 {
            return Ok(false);
        }

        if first == item {
            self.w32(header, self.r32(item));
        } else {
            let mut at = first;

            while self.r32(at) != item && self.r32(at) != 0 {
                at = self.r32(at);
            }

            if self.r32(at) != 0 {
                self.w32(at, self.r32(item));
            }
        }

        self.free(item).await?;
        Ok(true)
    }

    // Arrays: a header of 0Ch bytes -- the first block, the heap, a
    // block's size, items to a block, an item's size -- each block the
    // next, its count, and its items from 8.

    /// `28ec`: an array's header.
    pub(crate) async fn array_new(&self, heap: u16, size: u16, count: u16) -> R<u32> {
        let header = self.alloc(heap, 0xc).await?;

        if header == 0 {
            return Ok(0);
        }

        self.w32(header, 0);
        self.w16(plus(header, 4), heap);
        self.w16(plus(header, 6), count.wrapping_mul(size).wrapping_add(8));
        self.w16(plus(header, 8), count);
        self.w16(plus(header, 0xa), size);
        Ok(header)
    }

    /// `2946`: every block freed, and the header.
    pub(crate) async fn array_free(&self, header: u32) -> R<()> {
        if header == 0 {
            return Ok(());
        }

        loop {
            let first = self.r32(header);

            if first == 0 {
                break;
            }

            self.list_remove(header, first).await?;
        }

        self.free(header).await
    }

    /// `2984`: how many items.
    pub(crate) fn array_count(&self, header: u32) -> u16 {
        if header == 0 {
            return 0;
        }

        let mut total = 0u16;
        let mut block = self.r32(header);

        while block != 0 {
            total = total.wrapping_add(self.r16(plus(block, 4)));
            block = self.r32(block);
        }

        total
    }

    /// `29d8`: the first item matching the key -- any, with no key or no
    /// comparison -- taken out with `remove`, the last of its block put in
    /// its place: its address, nought for none.
    pub(crate) async fn array_find(
        &self,
        header: u32,
        cmp: Option<Cmp>,
        key: u32,
        remove: bool,
    ) -> R<u32> {
        if header == 0 {
            return Ok(0);
        }

        let size = self.r16(plus(header, 0xa));
        let mut block = self.r32(header);

        while block != 0 {
            let mut item = plus(block, 8);
            let mut index = 0u16;

            while index < self.r16(plus(block, 4)) {
                let matched = match cmp {
                    Some(cmp) if key != 0 => self.compare(cmp, item, key),
                    _ => true,
                };

                if matched {
                    if remove {
                        let count = self.r16(plus(block, 4)).wrapping_sub(1);

                        self.w16(plus(block, 4), count);

                        if count == 0 {
                            self.list_remove(header, block).await?;
                        } else {
                            let last = plus(block, 8u16.wrapping_add(size.wrapping_mul(count)));
                            let bytes = self.read(last, usize::from(size));

                            self.write(item, &bytes);
                        }
                    }

                    return Ok(item);
                }

                item = plus(item, size);
                index += 1;
            }

            block = self.r32(block);
        }

        Ok(0)
    }

    /// `2ac6`: an item put in: in the place of one matching it, with a
    /// comparison (2); else in the first block with room, a block made
    /// first where none has (1). Nought where no memory.
    pub(crate) async fn array_add(&self, header: u32, item: u32, cmp: Option<Cmp>) -> R<u16> {
        if header == 0 {
            return Ok(0);
        }

        let size = self.r16(plus(header, 0xa));

        if let Some(cmp) = cmp {
            let found = self.array_find(header, Some(cmp), item, false).await?;

            if found != 0 {
                let bytes = self.read(item, usize::from(size));

                self.write(found, &bytes);
                return Ok(2);
            }
        }

        let mut block = self.r32(header);

        while block != 0 && self.r16(plus(block, 4)) == self.r16(plus(header, 8)) {
            block = self.r32(block);
        }

        if block == 0 {
            block = self.list_add(header, 0).await?;

            if block == 0 {
                return Ok(0);
            }

            self.w16(plus(block, 4), 0);
        }

        let index = self.r16(plus(block, 4));

        self.w16(plus(block, 4), index.wrapping_add(1));

        let bytes = self.read(item, usize::from(size));

        self.write(
            plus(block, size.wrapping_mul(index).wrapping_add(8)),
            &bytes,
        );
        Ok(1)
    }

    /// `2bba`: the first item taken out, into `out`.
    pub(crate) async fn array_pop(&self, header: u32, out: &mut Vec<u8>) -> R<bool> {
        if header == 0 {
            return Ok(false);
        }

        let block = self.r32(header);

        if block == 0 {
            return Ok(false);
        }

        let size = self.r16(plus(header, 0xa));
        let first = plus(block, 8);

        *out = self.read(first, usize::from(size));

        if self.r16(plus(block, 4)) == 1 {
            self.list_remove(header, block).await?;
        } else {
            let count = self.r16(plus(block, 4)).wrapping_sub(1);

            self.w16(plus(block, 4), count);

            let bytes = self.read(plus(first, size.wrapping_mul(count)), usize::from(size));

            self.write(first, &bytes);
        }

        Ok(true)
    }

    /// A key, or an item to put in, laid out below the stack as DDEML
    /// keeps one on its own, four bytes of room before it as a list's key
    /// has: its far address, and the stack to give back.
    pub(crate) fn key(&self, bytes: &[u8]) -> (u32, u16) {
        let (at, saved) = self.reserve(bytes.len() as u16 + 4);

        self.write(plus(at, 4), bytes);
        (plus(at, 4), saved)
    }

    // Queues: a header of 0Ch bytes -- a count, the last serial, an item's
    // size, the queue's own heap, the last item -- each item in a ring,
    // the next (0), the one before (4), and its serial (8).

    /// `5eae`: a queue of items of `size` bytes, in a heap of its own.
    pub(crate) async fn queue_new(&self, size: u16) -> R<u32> {
        let heap = self
            .heap_create(size.wrapping_add(0xc).wrapping_shl(3))
            .await?;

        if heap == 0 {
            return Ok(0);
        }

        let header = self.alloc(heap, 0xc).await?;

        if header == 0 {
            self.heap_free(heap).await?;
            return Ok(0);
        }

        self.write(
            header,
            &[
                0,
                0,
                0,
                0,
                size as u8,
                (size >> 8) as u8,
                heap as u8,
                (heap >> 8) as u8,
                0,
                0,
                0,
                0,
            ],
        );
        Ok(header)
    }

    /// `5f18`: a queue freed, its heap and all.
    pub(crate) async fn queue_free(&self, header: u32) -> R<()> {
        if header != 0 {
            self.heap_free(self.r16(plus(header, 6))).await?;
        }

        Ok(())
    }

    /// `5f36`: an item put last, its serial the queue's next.
    pub(crate) async fn queue_add(&self, header: u32) -> R<u32> {
        let item = self
            .alloc(self.r16(plus(header, 6)), self.r16(plus(header, 4)))
            .await?;

        if item == 0 {
            return Ok(0);
        }

        if self.r16(header) == 0 {
            self.w32(item, item);
            self.w32(plus(item, 4), item);
            self.w32(plus(header, 8), item);
        } else {
            let last = self.r32(plus(header, 8));
            let first = self.r32(last);

            self.w32(plus(item, 4), last);
            self.w32(item, first);
            self.w32(plus(first, 4), item);
            self.w32(last, item);
            self.w32(plus(header, 8), item);
        }

        self.w16(header, self.r16(header).wrapping_add(1));

        let serial = self.r16(plus(header, 2)).wrapping_add(1);

        self.w16(plus(header, 2), serial);
        self.w16(plus(item, 8), serial);
        Ok(item)
    }

    /// `60a0`: an item of a queue: nought the first, FFFF:FFFE the last,
    /// any other the item at that offset whose serial is the high word.
    pub(crate) fn queue_item(&self, header: u32, which: u32) -> u32 {
        if header == 0 || self.r32(plus(header, 8)) == 0 {
            return 0;
        }

        let last = self.r32(plus(header, 8));

        match which {
            0 => self.r32(last),
            0xffff_fffe => last,
            _ => {
                let item = far(sel(header), lo(which));

                if self.r16(plus(item, 8)) == hi(which) {
                    item
                } else {
                    0
                }
            }
        }
    }

    /// An item's identifier, as `queue_item` takes one: its offset and its
    /// serial.
    pub(crate) fn queue_id(&self, item: u32) -> u32 {
        long(off(item), self.r16(plus(item, 8)))
    }

    /// `6004`: an item taken out and freed.
    pub(crate) async fn queue_remove(&self, header: u32, which: u32) -> R<()> {
        let item = self.queue_item(header, which);

        if item == 0 {
            return Ok(());
        }

        let next = self.r32(item);
        let before = self.r32(plus(item, 4));

        self.w32(plus(before, 0), next);
        self.w32(plus(next, 4), before);

        if self.r32(plus(header, 8)) == item {
            self.w32(plus(header, 8), before);
        }

        let count = self.r16(header).wrapping_sub(1);

        self.w16(header, count);

        if count == 0 {
            self.w32(plus(header, 8), 0);
        }

        self.free(item).await
    }

    /// `5b0c`: a block of `GMEM_DDESHARE`, at least a byte, its first two
    /// words given: its handle.
    pub(crate) async fn share(&self, size: u32, first: u16, second: u16) -> R<u16> {
        let handle = self
            .global_alloc(0x2000, if size == 0 { 1 } else { size })
            .await?;

        if handle != 0 {
            let at = self.global_lock(handle).await?;

            self.w16(at, first);
            self.w16(plus(at, 2), second);
            self.global_unlock(handle).await?;
        }

        Ok(handle)
    }
}

/// `7374`: the C library's `atol` of a string, as `DDEML.DLL` reads its
/// time-outs: spaces and tabs skipped, a sign, decimal digits.
pub(crate) fn atol(text: &[u8]) -> u32 {
    let mut bytes = text
        .iter()
        .copied()
        .skip_while(|&b| b == b' ' || b == b'\t');
    let mut value = 0u32;
    let mut first = bytes.next();
    let negative = first == Some(b'-');

    if matches!(first, Some(b'-' | b'+')) {
        first = bytes.next();
    }

    while let Some(digit @ b'0'..=b'9') = first {
        value = value.wrapping_mul(10).wrapping_add(u32::from(digit - b'0'));
        first = bytes.next();
    }

    if negative {
        value.wrapping_neg()
    } else {
        value
    }
}
