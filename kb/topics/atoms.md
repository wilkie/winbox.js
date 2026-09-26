---
kind: topic
name: Atoms
summary: Windows 3.1's atom tables — USER's global one and a program's local ones — how a string or an integer becomes an atom, how atoms are counted and named, and how clipboard formats registered by name relate to them, read out of KRNL386.EXE and measured.
probes: [atoms, regmsg]
---

An atom is a number that stands for a string. Two programs that agree on a string can pass its atom between them, as DDE and OLE do. USER keeps one table for the whole system: the global atoms, `GlobalAddAtom` and its fellows. KERNEL keeps a table in any data segment that asks for one: the local atoms, `AddAtom` and its fellows. Both run the same KERNEL code (`KRNL386.EXE` seg1 `4944`); USER's functions run it on USER's own table.

[[measured]] [[probe:atoms]] adds, finds, names and deletes atoms of both kinds, and registers a clipboard format by name. An atom's number depends on where its string lands in the table's heap, so the probe records only what the numbers say of each other: the same atom, a new one, an integer, or 0. winbox.js agrees with all 49 of its records.

## Integers

- [[read out]] A pointer whose segment is 0 is `MAKEINTATOM`: its offset is the atom. A string that is `#` followed by digits is the atom its decimal value is. The value wraps at 16 bits as it is read (seg1 `4994`).
- [[measured]] An integer atom must be 1 to BFFFh. `#1234` is 1234, `#0012` is 12, and `#49151` is 49151. `#0`, `#49152` and `#` alone are 0, a failure.
- [[measured]] A `#` followed by anything but digits is an ordinary string: `#-5` and `#12ab` are string atoms.
- [[measured]] Deleting an integer atom answers 0, and does nothing. Its name is `#` and its digits: `#1234`, answering 5.

## Strings

- [[read out]] A string atom is C000h or more: the offset of its entry in the table's heap, divided by four (seg1 `4a67`). winbox.js counts them up from C000h instead, one numbering across every table, and uses a deleted atom's number again in its table.
- [[measured]] A string is 1 to 255 characters: an empty one and one of 256 fail with 0.
- [[measured]] Case does not matter: `winboxatomone` and `WINBOXATOMONE` find `WinboxAtomOne`'s atom. [[read out]] The comparison is in capitals, and the capitals are Latin-1's: `a` to `z`, and E0h to FEh but F7h, less 20h (seg1 `83e9`). The string is kept as it was first added.
- [[measured]] Adding a string again counts it. Each delete counts it down and answers 0, and at 0 it is gone: an atom added twice is still found after one delete, and not after two.
- [[measured]] A string that takes a deleted atom's place in the heap can be given its number. Programs cannot rely on an atom's number outliving its string.
- [[read out]] Deleting an atom that is not there is not checked: KERNEL looks up the string the entry held, and answers what was left in AX (seg1 `4a80`). [[measured]] For a local atom that was nonzero. USER's `GlobalDeleteAtom` answered 0.

## Names

- [[measured]] [[fn:USER.GlobalGetAtomName]] copies as much of the string as fits with its 0, and answers the length copied: 13 for `WinboxAtomOne`, and 3, `Win`, into 4 bytes.
- [[measured]] With a size of 0 it answers 0 and writes nothing. For an atom that is gone it answers 0, and the buffer is emptied.
- [[read out]] An integer atom's name wants at least two bytes, `#` and its 0. Short of room for every digit, it keeps the lowest ones (seg1 `4b1a`).

## Local and global

- [[measured]] The local table is not the global one: [[fn:USER.GlobalFindAtom]] does not find a string added with [[fn:KERNEL.AddAtom]].
- [[read out]] A local table is made the first time an atom is added, with a default size, if [[fn:KERNEL.InitAtomTable]] has not made one (seg1 `4961`).
- [[read out]] [[fn:KERNEL.GetAtomHandle]] answers a string atom's entry, four times the atom, and 0 for an integer (seg1 `4aa3`).

## Clipboard formats and window messages

- [[read out]] [[fn:USER.RegisterClipboardFormat]] and [[fn:USER.RegisterWindowMessage]] are one function in USER (seg1 `8214`).
- [[measured]] So a format and a message registered with the same string are the same number, C000h or more, in any case of the string. [[probe:regmsg]] found the same of messages.
- [[measured]] Their table is neither atom table: `GlobalFindAtom` does not find a registered format.
- [[measured]] [[fn:USER.GetClipboardFormatName]] gives the string as it was first registered, and answers its length. For `CF_TEXT` it answers 0.

## Why it mattered

`OLECLI.DLL` and `OLESVR.DLL` add 21 global atoms as they start: the names of their DDE conversations. They register their clipboard formats, `Native`, `ObjectLink` and `OwnerLink`, by name. Both were answering 0. Paintbrush said "Failed to register server", and Sound Recorder that Windows did not recognize it as a server application. Atoms alone did not cure that: `OLESVR.DLL` also checks each pointer with `VERR` and `VERW`, which needed the processor instructions and Windows' own descriptors ([[topic:global-and-local-memory]]). With all three, both programs register.

## In winbox.js

`src/win16/atoms.ts` holds the tables and the eight functions. `src/win16/user/RegisterWindowMessage.ts` holds the table of registered names, which `RegisterClipboardFormat` shares.
