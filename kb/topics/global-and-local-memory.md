---
kind: topic
name: Global and local memory
summary: What a global handle is, how the two heaps round a request, and what Windows 3.1 did and did not do to a block once it had one — as two probes recorded it.
probes:
  [
    lochand,
    memory,
    handles,
    localgro,
    lheapseg,
    selinfo,
    handbits,
    freemem,
    localre,
    misc,
    glock,
    glocks,
    minis3,
    selalias,
    enumregs,
    sysheap,
    badptr,
    grow,
    dpmidesc,
    segreg,
    gfresh,
  ]
---

A Windows 3.1 program has two allocators: the global heap, whose blocks are whole segments reached through selectors, and the local heap inside its own data segment, whose blocks are near offsets. The two round differently, and the global one's handles have a precise relationship to the selectors that address them.

Handle values are the allocator's choice and need not repeat between runs, so neither probe records one. They record what can be derived from a handle instead: sizes, flags, offsets, and whether two values are equal or differ by a constant. Both fixtures record Windows 3.1 in standard mode. Every one of their 56 records agrees with winbox.js.

## A global handle is its selector at a lower privilege

- [[measured]] The selector in the pointer [[fn:KERNEL.GlobalLock]] returns is the handle plus one, for moveable, fixed and discardable blocks: 3 of 3 records of [[probe:handles]].
- [[measured]] The handle's low three bits are 6 and the selector's are 7, on the same three blocks.
- [[inferred]] So both have the table bit set and name the same entry in the local descriptor table. What separates them is the requested privilege level, 2 for the handle and 3 for the selector. Shifting either right by three gives the descriptor.
- [[measured]] [[fn:KERNEL.GlobalHandle]] turns the selector back into the handle, for moveable and fixed blocks: 2 of 2.
- [[measured]] [[probe:memory]] had already found that the selector is not the handle even for a fixed block. The common account says a fixed block's handle is its selector, and it is wrong by exactly one.

## What the processor sees

A library that is handed a pointer can ask the processor about its selector without touching it: `VERR` and `VERW` say whether it can be read and written, `LAR` gives its access rights and `LSL` its limit. `OLESVR.DLL` checks every pointer a server gives it this way, so a selector's descriptor has to be Windows' own. [[probe:selinfo]] runs the four instructions on its own selectors.

- [[measured]] A block from [[fn:KERNEL.GlobalAlloc]] has access rights F3h: present, privilege 3, read/write data, already accessed. Moveable, fixed and discardable are alike. USER's code has FBh: code, readable, not writable. The probe's own code and data showed the same in a first recording, which does not keep them, since they are the program's.
- [[measured]] A block's limit is its rounded size less one: 7Fh for 100 bytes, 3FFh for 1000. A block of 70,000 bytes is 70,016 rounded, and its first selector's limit reaches all of it, 1117Fh, of which `LSL`'s 16 bits show 117Fh.
- [[measured]] A freed block's selector, the null selector and the null selector with RPL 3 are refused by all four.
- [[documented]] Each later selector of a block past 64 KiB reaches from its own start to the block's end. winbox.js does this; it is not recorded.

## The low bits of a handle

- [[measured]] [[probe:handbits]] records the low two bits of four handles of each kind. Every GDI object's are 2: DCs, the screen's DC, pens, brushes, fonts, bitmaps, regions and the stock objects. A global handle's and an instance's are 2 as well. A window's and a menu's are 0.
- [[measured]] Programs lean on this. `PBRUSH.DLL` gives out a DC's handle less one as a bitmap of its own, and tells the two apart by the low bit (`VBITBLT`, `test byte [bp+18h], 1`). With winbox.js's odd handles, Paintbrush took its canvas for a DC that was not there, and its canvas showed black.

## Global sizes

- [[measured]] [[fn:KERNEL.GlobalAlloc]] rounds a request up to a multiple of 32 bytes, with 32 the least, and [[fn:KERNEL.GlobalSize]] reports the rounded size: 1 → 32, 17 → 32, 100 → 128, 1024 → 1024, 65536 → 65536. 17 records, fixed, moveable and `GMEM_ZEROINIT` alike.
- [[measured]] A request for zero bytes is honoured, not refused. It returns a real handle whose size reads 0, moveable or fixed.
- [[measured]] A locked block starts at offset 0 of its selector: 2 of 2.

## Local sizes

- [[measured]] The local heap works in four-byte units with a smallest block of eight. A fixed block's [[fn:KERNEL.LocalSize]] is `max(8, roundup(request, 4))`: 1 → 8, 9 → 12, 17 → 20, 100 → 100. 7 records.
- [[measured]] A moveable block reports `max(8, roundup(request + 2, 4)) - 2`: 1 → 6, 7 → 10, 15 to 18 → 18, 19 → 22, 100 → 102. 10 records.
- [[inferred]] The two bytes a moveable block does not report hold the link back to its handle.
- [[refused]] The first reading of 15, 16 and 17 all reporting 18 looked like the probe measuring reuse, since it freed each block before asking for the next. Holding every block until the end gave the same 17 numbers, so reuse was ruled out. Nine of the sizes were picked to break the model — on either side of a four-byte boundary, at the minimum, or exactly on a boundary — and none did.

## A local heap that runs out

- [[measured]] [[probe:localgro]] starts with a data segment of 12,160 bytes and a 1,024-byte heap. It asks [[fn:KERNEL.LocalAlloc]] for fixed blocks that do not fit: three of 1,000 bytes, one of 3,072, then 4,096 at a time until one fails. Each request that does not fit grows the data segment. It grows by **the request plus 544, rounded up to 32**: 1,568 for 1,000, 3,616 for 3,072 and 4,640 for 4,096. The heap is at the end of the segment, so it grows with it.
- [[measured]] The growth ignores the room the heap already had, so the slack it leaves can take the next request whole. The second 1,000-byte block and the sixth 4,096-byte one needed no growth.
- [[measured]] A growth that would pass 64 KiB grows the segment to exactly 64 KiB instead, if the block then fits. If it still does not fit, the segment does not grow at all and `LocalAlloc` returns NULL. The first recording ended at 65,536 with the block made. The second ended at 65,312 and returned NULL.
- [[measured]] Each fixed block starts four bytes after the previous one ends.
- [[refused]] The first recording asked only for multiples of 32. On those, "the block, its four-byte header and 540" and "the same with 512, rounded up to 32" both fit every growth. The 1,000-byte requests were added to split them, and they refuted both: 1,544 and 1,536 against the 1,568 recorded.
- This is what Notepad hits first. Its heap is 2,048 bytes, and it asks for 3,072 before it opens its window.
- [[measured]] A heap a program makes itself with [[fn:KERNEL.LocalInit]], in a block from [[fn:KERNEL.GlobalAlloc]], grows the same way, and so does its block, whether the block is moveable or fixed. [[probe:lheapseg]] does what the Visual Basic runtime does: a heap from 16 to 2,080 in a block of 2,080 bytes, a 49-byte block and a 638-byte one, then 49-byte blocks. All 80 are made, the block growing to 5,856 bytes. `LocalReAlloc` of the 638-byte block to 660 then succeeds, the block growing to 7,072. With no growth, the runtime's `LocalReAlloc` failed, and StarMerc and Four Seasons stopped with "Unexpected error; quitting".
- Not modelled: where Windows puts each block and handle in such a heap. Its handles sit in tables of their own, and each block has a header, so Windows grows five blocks sooner than winbox.js does, and to other sizes. The handles and sizes in `lheapseg` are a known gap.

## Flags and lock counts

- [[measured]] [[fn:KERNEL.GlobalFlags]] reports `0x0000` for new moveable and fixed blocks and `0x0100` for a discardable one. Being moveable is not reported.
- [[measured]] The lock count stays at 0 through two nested `GlobalLock` calls, on moveable and fixed blocks alike, and both calls return the same pointer.
- [[measured]] [[probe:glocks]] locks and unlocks blocks of each kind. Only a discardable block counts its locks: [[fn:KERNEL.GlobalFlags]] reports `0x0101`, then `0x0102`, and [[fn:KERNEL.GlobalUnlock]] answers 1, the count left, after which the flags are `0x0101` again. A moveable block that is not discardable, and a fixed block, report a low byte of 0 through three locks, and `GlobalUnlock` answers 0 every time, also unlocked once more than locked.
- [[measured]] The same probe frees each block while it is still locked. [[fn:KERNEL.GlobalFree]] answers `NULL` for all of them, discardable ones still counting a lock among them. The handle then has a size and flags of 0, the old selector names no handle, and the old pointer is unreadable. Cell Wars frees a block it may have locked more than it unlocked this way.
- [[read out]] The count is one byte in the block's arena, at offset 14h (`KRNL386.EXE` seg1 `0fd7`). `GlobalLock` (`0f9d`) counts it up only where the block's descriptor marks it discardable, without a ceiling. `GlobalUnlock` (`0fe6`) counts a discardable block down and answers what is left; at 0, or at FFh, it leaves the count and answers 0. `GlobalFlags` (`0f85`) shows the count for any block whose handle is not its selector, which leaves out only fixed blocks. `LockSegment` (`0f1e`) and `UnlockSegment` (`0f37`) count a discardable block too, up to FFh and no further, the count left in CX. `GlobalFix` (`0f2d`) and `GlobalUnfix` (`0f46`) count any block that is not fixed the same way, and answer the block's handle. [[fn:KERNEL.GlobalReAlloc]] will not discard a block whose count is not 0 (`4129`). KERNEL's own `LockResource` locks with `GlobalLock` (`8768`).
- winbox.js keeps the count with the block, as Windows does, and its own modules take a block's address without counting, so a program sees only the locks it made, or KERNEL's `LockResource` made for it.
- [[measured]] [[probe:glock]] locks handles that name nothing: nought, 1, 2, 7, and a block just freed. `GlobalLock` answers NULL for each, and `GlobalUnlock` answers 0. **FFFFh locks the caller's own data segment**, at offset 0.
- [[measured]] Print Manager's Printer Setup hands Control Panel's printers applet a 1. The applet treats it as a global handle, and copies a string from it if the lock answers anything. winbox.js once answered a pointer to the empty first descriptor, and the copy ran off the segment.

## Wiring and page-locking

[[probe:misc]] wires and page-locks one moveable block of 64 bytes, and winbox.js agrees with every record.

- [[measured]] [[fn:KERNEL.GlobalWire]] answers the same pointer `GlobalLock` gives, and the block's lock count in [[fn:KERNEL.GlobalFlags]] is then 1, though the block is not discardable and `GlobalLock` would not have counted it.
- [[measured]] [[fn:KERNEL.GlobalUnWire]] answers −1, and the lock count is back to 0.
- [[read out]] Wiring counts the same byte as locking (`KRNL386.EXE` seg1 `104e`), for any block that is not fixed. `GlobalUnWire` (`10da`) counts it down as `GlobalUnlock` does, and answers −1 once it is 0 and 0 while it is not.
- [[measured]] [[fn:KERNEL.GlobalPageLock]] answers the count after it: 1, then 2. [[fn:KERNEL.GlobalPageUnlock]] counts down, 1 then 0, and stays at 0 when called once more.

## Nothing moved

- [[measured]] A moveable block unlocked, then surrounded by eight 4 KB allocations of which half were freed, then put through `GlobalCompact(0)`, locked at the same address again. So did a fixed block.
- [[measured]] [[fn:KERNEL.GlobalReAlloc]] kept the handle and the address when growing 256 bytes to 1024, shrinking 1024 to 256, and resizing 256 to 256, for a fixed block as well as moveable ones. [[fn:KERNEL.GlobalSize]] then reported the new size.
- [[inferred]] In protected mode none of these sizes requires a move: a descriptor's limit can change while its base stays. It also means a program that goes on using a moveable block's old pointer after unlocking it kept working on these recordings.

## A block that has no room to grow

[[probe:segreg]] grows a moveable block of 256 bytes to 16 KB with [[fn:KERNEL.GlobalReAlloc]], with a fixed block allocated straight after it. Before the call it loads the block's selector into FS, which no 16-bit code of Windows loads.

- [[measured]] The block moves: [[fn:KERNEL.GetSelectorBase]] answers a new base, and [[fn:KERNEL.GlobalLock]] gives the same selector. winbox.js grows it where it is, since each selector has 64 KB of its own.
- [[measured]] FS does not keep the block. It comes back from the call holding nought, and reads linear address nought, the interrupt table, rather than the block's old place or its new one. That is a segment register after a trip to real mode, which standard mode makes for the call. The recording is of standard mode only.
- [[inferred]] So a program never reaches a block through a descriptor Windows has since changed. DS comes back from every call by `POP`, which reads the table again; ES is not kept across calls; and here even FS was not kept. winbox.js reads a descriptor afresh from the table whenever it has changed one. Before, Star Merc grew a local heap with [[fn:KERNEL.LocalAlloc]] and had [[fn:KERNEL.lstrlen]] read it, and the new limit was seen only because the program happened to load the selector again in between.

## A local handle is a word in the segment

- [[documented]] A moveable local block's handle is the address, in the data segment, of a word that holds the block's address. `LocalLock` answers that word.
- [[read out]] [[fn:KERNEL.LocalHandle]] tells a pointer by bit 1, which KERNEL sets only in a moveable block's pointer: a value without it is answered as it is, a fixed block's pointer being its handle; with it, the word before the pointer names the handle, answered if that handle holds the pointer, else nought (`KRNL386.EXE` seg1 `8d6a`). [[measured]] [[probe:lochand]]: a locked or unlocked moveable block's pointer answers its handle, a fixed block's itself, the handle itself nought. winbox.js answered nought for all, and Windows Help, which hands its macros' buttons over by the handle it finds for a block it holds by its pointer, said "Unable to add button.". winbox.js now answers the blocks as Windows does. It answers any other value by bit 1 too, but its heap does not lay blocks at KERNEL's alignments: four records of values inside or beside a block, or freed, differ, and the record of the bits.
- [[measured]] Write reads its blocks through the handle itself, `[handle]`, rather than `LocalLock`, for every font in its list. winbox.js kept those words only in its own bookkeeping, not in the segment the program reads. Write read an address of FFFFh, and measured a string from there round and round the segment.

## How much there is

- [[measured]] [[probe:freemem]], under DOSBox: `GlobalCompact(0)` answers the largest block there could be, 14,480K, a little less than `GetFreeSpace(0)`'s 15,086K. The numbers are the machine's own. winbox.js answers the same for both, and keeps the one within the other.
- [[measured]] `LocalHandleDelta(0)` answers 32, how many handles a local heap makes room for at a time. Given a number, it sets it and answers it.
- Write asks both as it starts, and both were stubs answering 0. Its "Not enough memory" came from elsewhere, the current directory ([[topic:directory-lists]]); answering these was not what cured it.

## Locking and resizing a local block

- [[documented]] `LocalLock` answers a local block's address: for a moveable block, the address its handle holds; for a fixed block, the pointer itself.
- [[documented]] `LocalReAlloc` gives a block a new size and keeps the bytes that fit:
  - a moveable block keeps its handle;
  - a fixed block moves only with `LMEM_MOVEABLE`;
  - nought with `LMEM_MOVEABLE` discards a moveable block, leaving its handle standing for nothing until it is given a size again;
  - `LMEM_MODIFY` changes only the flags.
- [[documented]] `GlobalReAlloc` to nought with `GMEM_MOVEABLE` discards a block. Its handle stays, `GlobalLock` answers NULL, `GlobalFlags` has `GMEM_DISCARDED`, and a later size gives it memory again. With `GMEM_MODIFY`, only whether it may be discarded changes. Program Manager discards its groups' blocks, and reads a group back in when the lock answers NULL.
- [[documented]] `LocalAlloc` of nought bytes, moveable, gives a handle to a block already discarded, which `LocalReAlloc` gives a size to later. Calendar makes its blocks this way.
- [[measured]] Notepad reads a file into a block grown with `LocalReAlloc` and addressed with `LocalLock` ([[topic:multi-line-edit-controls]]). Both were stubs before, and every file was "too large".

## What `LocalReAlloc` keeps

[[measured]] [[probe:localre]] fills blocks with a pattern through their pointers and gives them new sizes. For each step it records whether the block moved, its size after, how much of the pattern it kept, and the bytes past it where they are defined. winbox.js agrees with all 29 records.

- [[measured]] A moveable block grown past its neighbour moves, keeps its handle, and keeps every byte. A fixed block does too, with `LMEM_MOVEABLE`; without it, it answers nought.
- [[measured]] A moveable block shrunk stays where it is and keeps its bytes, the ones past its new size too. Its new block is `LocalAlloc`'s rounding, but never under 12 bytes: asking for 1 to 10 bytes gives 10, 12 gives 14, 30 gives 30. The rest becomes free only when it is 20 bytes or more. With less, the block keeps its old size: from 66 bytes, 46 gives 46, but 50 is still 66.
- [[measured]] A moveable block with free space right after it grows where it is, and with `LMEM_ZEROINIT` the bytes it gains are noughts. The one block the probe grows with nothing after it moved. That rule is fitted to these two cases.
- [[measured]] Without `LMEM_ZEROINIT`, the bytes a block gains are whatever the heap held there: leftovers from earlier blocks. The probe does not record them.
- A block's bytes are the program's, in its segment, where it writes them through the pointer `LocalLock` gave it. winbox.js once moved a block by copying its own record of the bytes instead, which the program had never written to, so a moved block arrived empty. Windows Help keeps a table of its menus in such a block. When the table grew, its entries vanished, and Help said "Unable to add menu item." It now opens to its title screen.

## Shrinking a local heap

- [[read out]] [[fn:KERNEL.LocalShrink]] shrinks a heap as far as what is in it allows, and answers the heap's span, from its first arena to past its last. `LocalCompact` answers the largest free block less six instead. [[measured]] [[probe:minis3]] finds the two answers differ for the caller's own heap. winbox.js's heaps do not shrink, and `LocalShrink` answers the heap's size.

## Selectors made from others

[[probe:selalias]] makes selectors from a block's, and reads each one's access rights with `LAR`. [[measured]]

- [[fn:KERNEL.AllocSelector]] of a selector makes a new one sharing its memory, data like it (`F3h`). Given nought, it makes one for nothing yet: data not yet accessed (`F2h`).
- [[fn:KERNEL.PrestoChangoSelector]] makes the second selector a copy of the first, code for data and data for code, and answers the second: a block's data selector copied becomes code (`FBh`), and a copy of that becomes data again.
- [[fn:KERNEL.AllocDSToCSAlias]] gives a data segment a code selector (`FBh`). The probe of [[probe:enumregs]] runs code it writes through one.
- [[fn:KERNEL.FreeSelector]] answers nought, and `LAR` refuses the selector after.

## Descriptors through DPMI

A program can read and write a selector's descriptor itself, through the DPMI host Windows runs under: `INT 31h`. SimTower reads its own code segment's with function 000Bh, sets the D bit to make it 32-bit code, and writes it back with 000Ch, to run a 386 row copier with 32-bit offsets.

- [[measured]] [[probe:dpmidesc]] uses a selector of its own from [[fn:KERNEL.AllocSelector]]. Function 000Bh copies its eight bytes to `ES:DI`, carry clear. The base and limit in them are what [[fn:KERNEL.GetSelectorBase]] and [[fn:KERNEL.GetSelectorLimit]] answer, and the access byte of a data selector is `F3h`.
- [[measured]] Function 000Ch takes eight bytes back, carry clear. With byte 6 or'd with `40h` and the base moved on `10h`, 000Bh reads the D bit back, and `GetSelectorBase` has moved by `10h`.
- [[measured]] 000Bh of selector 0FFFh, which the program never had, answers with the carry clear and AX unchanged.
- winbox.js answers both functions from its descriptor tables. A DPMI call used to leave the program stopped where it made it: the interrupt's handler never said to go on.

## The BIOS's data

[[documented]] Windows keeps selector 40h for the BIOS's data area, at 400h, and KERNEL exports it as `__0040H`. [[measured]] A C runtime's start-up reads the clock with `INT 1Ah` and, when AL says a day has turned, clears the BIOS's own flag through selector 40h: Hearts, Cribbage and Solitaire programs of the corpus do. It is in winbox.js's global descriptor table, which holds nothing else.

## A module's segments

[[read out]] Each segment a module is loaded into is a block of global memory like any other, with a handle and a size: its minimum allocation, 64K for none, and for the data segment its stack and heap more (`KRNL386.EXE` seg1 `7660`). [[measured]] A Visual Basic program asks [[fn:KERNEL.GlobalHandle]] for its own data segment's handle as it starts and grows the segment with [[fn:KERNEL.GlobalReAlloc]], and ends at once when either fails. A segment with no bytes in the file, at offset nought, is only its minimum allocation: a Visual Basic program's data segment is two bytes.

## USER's and GDI's heaps

- [[measured]] [[probe:sysheap]]: TOOLHELP's [[fn:TOOLHELP.SystemHeapInfo]] answers 1 when `dwSize` is the structure's size, 12. It fills in USER's and GDI's percentages free, the same as [[fn:USER.GetFreeSystemResources]] gives for 2 and 1, and the two modules' data segments. With another size it answers nought and writes nothing.
- [[measured]] Each data segment is a selector: [[fn:TOOLHELP.GlobalHandleToSel]] gives it back unchanged, and its module's instance, as [[fn:KERNEL.LoadLibrary]] answers it, is one below it, as a program's is. winbox.js now gives USER and GDI a data segment each, and their module handles are one below them.
- [[measured]] `GlobalHandleToSel` gives a moveable block's handle the selector `GlobalLock` gives, leaves a fixed block's as it is, and gives 1 for nought: the handle with its lowest bit set.
- Bubble Girl of the corpus brings a library that looks for a bitmap it made among GDI's objects, in GDI's data segment, and draws into the bitmap's bits directly: see [[topic:gdi-objects]].

## Growing past 64 KiB

- [[measured]] [[probe:grow]]: [[fn:KERNEL.GlobalReAlloc]] grows a block past what its selectors reach — 32 KiB to 84 KiB — by moving it. The answer is a new handle, for a moveable block and a fixed one alike, and even for one that is locked. The contents are kept, the size is exactly what was asked, and `GMEM_ZEROINIT` makes the new part nought.
- [[measured]] The first selector's limit reaches the whole block, 14FFFh, and the next one, a huge step on, reaches what is left, 4FFFh, as [[fn:KERNEL.GetSelectorLimit]] reads them. Shrunk back under 64 KiB, the handle is kept, and the second selector reads nought.
- winbox.js did not grow a block past its selectors. Bubble Girl's engine grows its buffers so, and ended on "Not enough memory".

## What a fresh block holds

- [[measured]] [[probe:gfresh]] asks for a program's first three global blocks without `GMEM_ZEROINIT`, as Borland's run-time library asks for its far heap: moveable, 1000h bytes, then 2100h twice. Read before anything writes them, they are mostly not nought: 3,869 of 4,096 bytes, then 7,415 and 6,673 of 8,448. The bytes are what Windows' memory held before, leftovers of the machine's earlier use. That is the state of the machine, not anything Windows does, and winbox.js's memory starts as nought. The three records are a known gap.
- TC Trekwar faults on this. [[read out]] Its game object is 8Ah bytes from `new` (`TREKWAR.EXE` seg15 `1A80`), which is Borland's `malloc` (seg1 `422C`). That takes blocks from [[fn:KERNEL.GlobalAlloc]] with the library's flags, nought at DS:0027, and `GMEM_MOVEABLE` (seg1 `4B0A`). The constructor never writes the object's far pointer at 82h. Only three kinds of object set it, each to a field of its own, as they update: seg10 `07F2`, when a value seg15 `0B8F` works out for it, divided by 55, is within 0.2 of nought, and seg17 `0932` and seg18 `078D`, when nearer than any before it in the same round. Another kind writes 9 through the pointer once it is within 186h on both axes of the game's point at 68h and 6Ch (seg9 `1ECB`, `les bx,[es:bx+82h]`, then `1ED0`, `mov byte [es:bx],9`). [[measured]] Under winbox.js, with made-up input (`trace --input`), seed 6 reaches that write at 34.9 seconds and seed 2 at 2.2. In neither run had any of the three set the pointer, so it was still nought, and the write through selector nought is a general protection fault at 0009:1ED0. Seeds 3, 5 and 7 had it set, to that first object's field. [[inferred]] In Windows the pointer holds whatever its memory held, so the same write goes through leftovers, and whether it faults depends on them. The made-up input drove the program into its own bug.

## Pointer checks

[[fn:KERNEL.IsBadReadPtr]], [[fn:KERNEL.IsBadWritePtr]], [[fn:KERNEL.IsBadCodePtr]], [[fn:KERNEL.IsBadStringPtr]], [[fn:KERNEL.IsBadHugeReadPtr]] and [[fn:KERNEL.IsBadHugeWritePtr]] look at no tables. [[read out]] Each loads the pointer, touches the memory, and answers 1 if that faults: KERNEL's fault handler goes on from where each expects one (`KRNL386.EXE` seg1 `4b62` to `4c70`).

- The read and write checks answer nought for a count of nought, touching nothing. A range that wraps past offset FFFFh answers 1. Otherwise they read the range's last byte, or write it back as it was.
- The huge forms also touch the last byte of each 64 KiB tile the range crosses, the selector stepping by 8.
- `IsBadCodePtr` runs `LAR` on the selector: it must be code. It then reads the byte at the offset.
- `IsBadStringPtr` scans for the nought, faulting where a byte cannot be read. It answers 1 too if the string and its nought are longer than the count.

[[measured]] [[probe:badptr]] asks 31 cases of a 40-byte block, a 70000-byte one, code, and the null and a nonsense selector. DOSBox, which records it, raises no fault for the null selector, an offset past a segment's limit, or a write to code. For those 12 cases it answered 0 where a real processor faults and KERNEL answers 1. winbox.js asks the same accesses of the descriptors, as the processor would check them, and follows the processor: all 19 other records agree, and the 12 are a known gap. The stubs these were before left AX as it happened to be, and Bubble Girl's engine read that as a bad pointer.

## Not yet measured

- A program's data segment's limit. Windows gives the `dpmidesc` probe's the segment's size, 2F9Fh; winbox.js gives it the whole 64 KiB.

`LocalLock`'s lock count, which is not kept. `LocalReAlloc` of a fixed block that shrinks or has room after it, and what decides where a moved block goes. Discardable blocks actually being discarded, whether `GMEM_ZEROINIT` or `LMEM_ZEROINIT` zeroes anything, local requests for zero bytes, blocks and resizes beyond 64 KiB, freeing twice, what a freed handle turns into, and anything recorded in enhanced mode.

## In winbox.js

`src/win16/selectors.ts` states the encoding once, and the allocator works in descriptor indices, converting at the API boundary. Segments live in the LDT, written by `GlobalAllocator.map` with Windows' access rights, and a block's limits by `Allocator` as it is made and resized. Global blocks never move, and `GlobalFree` empties a block's descriptors but does not give their slots back. A program's own segments keep a limit of 64 KiB: its data segment's heap and stack are laid out differently from Windows', so its real size cannot be given yet. `Heap.blockFor` in `src/win16/heap.ts` does the local rounding, and `Heap.grow` the growth of a moveable data segment's heap. winbox.js keeps a two-byte header rather than Windows' four, so its block offsets do not match [[probe:localgro]]'s, and it does not report the data segment's size; `test/win16/task_test.ts` holds the growth rule instead. How to record these probes again is in [[guide:reproducing]].
