---
kind: topic
name: GDI's priority queue
summary: The priority queue GDI exports for the spooler -- a global block of four header words and key-and-tag entries, kept in order while keys come in order and made a heap once one does not, keys compared unsigned; read out of GDI.EXE seg27 and recorded.
probes: [gdipq]
---

GDI exports a small priority queue, which the spooler keeps its jobs in: [[fn:GDI.CreatePQ]], [[fn:GDI.InsertPQ]], [[fn:GDI.MinPQ]], [[fn:GDI.ExtractPQ]], [[fn:GDI.SizePQ]] and [[fn:GDI.DeletePQ]]. [[measured]] [[probe:gdipq]] makes a queue of four, fills it, empties it, grows it and shrinks it, and after each call reads the block itself; WinBox agrees with all 37 records.

## The block

[[read out]] A global block, `GMEM_MOVEABLE | GMEM_DDESHARE` (`GDI.EXE` seg1 `1f6d`), of four words and then entries of two words each, the key and then the tag (seg27 `0000`):

| Word | Holds                                                     |
| ---- | --------------------------------------------------------- |
| 0    | Where the entries end, in bytes from the first.           |
| 1    | The room for entries, in bytes: four for each.            |
| 2    | The last key appended; 4000h once the entries are a heap. |
| 3    | Where the first entry still queued starts, in bytes.      |

## In order, then a heap

- [[read out]] While each key is not below the last, unsigned, it is appended and becomes word 2; [[fn:GDI.ExtractPQ]] takes the first by moving word 3 on, leaving the entry where it was (seg27 `0045`, `00fe`).
- [[read out]] A key below word 2 moves the entries down to the first (seg27 `025a`), sets word 2 to 4000h, and is sifted up a binary heap: its parent the entry at `((offset >> 1) - 2) & ~3`, swapped while the child's key is the smaller. Taking from a heap puts its last entry first and sifts it down the smaller child -- the right where they tie -- to the end, swapping where it is the smaller and never stopping early.
- [[measured]] Keys are compared unsigned: -5 inserted into a heap is FFFBh, not below 4000h, and so is appended at the end and becomes word 2 -- and the heap, with word 2 still at or above 4000h, is taken from as a heap.
- [[read out]] The last entry taken empties words 0, 2 and 3, and the queue is in order again.

## Answers

- [[read out]] [[fn:GDI.InsertPQ]] answers the queue's handle, -1 where its entries from word 3 on fill it; [[fn:GDI.MinPQ]] and [[fn:GDI.ExtractPQ]] the first entry's tag, -1 for an empty queue.
- [[read out]] [[fn:GDI.SizePQ]] answers what its last `GlobalUnlock` answers, nought for the moveable block, whether it was asked the room or given a size too small; -1 only where the block does not lock or `GlobalReAlloc` fails.

## Not yet done

- The spooler's own use of the queue: WinBox's spooler keeps its jobs its own way (`kb/topics/printing.md`).

## In winbox.js

`crates/winbox-win16/src/gdi/priority_queue.rs`, both on the block itself.
