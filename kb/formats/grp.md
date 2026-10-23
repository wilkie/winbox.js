---
kind: format
name: .GRP program group files
summary: Program Manager's group files in Windows 3.1 — the header, the table of items and each item, the icons' bits, the tags after the group's data, the checksum — and how PROGMAN.EXE writes them, loads them, rejects them and rewrites them for another display, as read out of it and recorded by the pm probes.
probes: [progdde, pmbare, pmfiles, pmgroups, pmsyntax]
---

A `.GRP` file is one of Program Manager's groups: its name, the place of its window, and each item's name, command, directory, icon and place, with the icon's bits as the display had them. `PROGMAN.INI`'s `[Groups]` names each file as `GroupN=` ([[topic:program-manager-dde]]). Installers make them through Program Manager's DDE, and some copy one in themselves. The format is [[documented]] in Microsoft's description of the 3.1 group file; what follows is that layout as `PROGMAN.EXE` reads and writes it, read out of it, and held to the files the probes record whole in hexadecimal ([[probe:pmbare]], [[probe:pmfiles]]).

Everything read out here is `PROGMAN.EXE`; its group code is segment 4.

## The header

[[documented]] [[read out]] All words little-endian (seg4 `21e5`-`2268` writes a new one):

| Offset | Size | Field                             | A new group's                  |
| ------ | ---- | --------------------------------- | ------------------------------ |
| `00`   | 4    | `PMCC`                            |                                |
| `04`   | 2    | checksum                          | see below                      |
| `06`   | 2    | `cbGroup`: where the tags begin   | `24h` + name + nought          |
| `08`   | 2    | `nCmdShow`                        | 0                              |
| `0A`   | 8    | `rcNormal`                        | 0, 0, 0, 0                     |
| `12`   | 4    | `ptMin`                           | 0, 0                           |
| `16`   | 2    | `pName`, the group's name         | `24h`                          |
| `18`   | 2    | `cxIcon`, `SM_CXICON`             | 32                             |
| `1A`   | 2    | `cyIcon`, `SM_CYICON`             | 32                             |
| `1C`   | 2    | icon format: bits a pixel, planes | `0401h` on the VGA and the EGA |
| `1E`   | 2    | reserved                          | 0                              |
| `20`   | 2    | `cItems`: slots in the table      | 1                              |
| `22`   | 2n   | `rgiItems`: each item's offset    | one empty slot                 |

- [[read out]] `cItems` counts slots, not items. An empty slot is nought; a new item takes the first empty slot, else the table grows by a word and everything after it moves up two bytes (seg4 `0741`-`081b`). A group holds at most 50 slots (`1263`-`126d`).
- [[measured]] A group made by `[CreateGroup]` is 37 bytes and its name: `24h` of header, the one empty slot, the name and its nought ([[probe:progdde]]). The icon format and size are the screen's (`GetDeviceCaps` `BITSPIXEL` and `PLANES`, `GetSystemMetrics`; seg4 `2214`-`225e`): on both the VGA and the EGA `0401h` and 32 by 32 ([[probe:pmbare]]).
- [[read out]] `nCmdShow`, `rcNormal` and `ptMin` are nought until settings are saved, when they are the group window's `GetWindowPlacement` (seg4 `2518`). [[measured]] After `[ExitProgman(1)]` a normal group's header read 1; 0, 0, 514, 252; and -1, -1 on the VGA ([[probe:pmbare]]). The installation's MAIN.GRP, ACCESSOR.GRP and STARTUP.GRP hold the MDI cascade's places, 0, 22 and 44 across and down, 416 by 202.

## An item

[[documented]] [[read out]] `18h` bytes at the offset its slot gives (seg4 `066d`-`073e`):

| Offset | Field                                                       |
| ------ | ----------------------------------------------------------- |
| `00`   | `pt`, the icon's top left in the group's window, x then y   |
| `04`   | the icon's index, as `ExtractAssociatedIcon` wrote it back  |
| `06`   | the icon header's size, 12                                  |
| `08`   | the AND plane's size, then at `0A` the XOR plane's          |
| `0C`   | offsets of the icon header, the AND plane and the XOR plane |
| `12`   | offsets of the name, the command and the icon's path        |

- [[read out]] A new item's blocks are appended at `cbGroup`, in this order: the item, its name, its command, its icon's path, the icon header, the AND plane, the XOR plane (seg4 `12b3`-`1387`, `0899`-`096a`). [[measured]] [[probe:progdde]]'s first item: item `3E`, name `56`, command `5E`, path `75`, header `8C`, AND `98`, XOR `118`.
- [[read out]] The icon is `DumpIcon`'s: a 12-byte header — hot spot, width, height, the AND plane's bytes a row, planes, bits a pixel — then the AND plane, then the XOR plane, rows top first, a 4-plane bitmap's planes one after another within each row ([[fn:USER.DumpIcon]]). [[measured]] On the VGA and the EGA, 128 and 512 bytes for a 32 by 32 icon.
- [[read out]] The icon's path is stored as the caller gave it, and the index as `ExtractAssociatedIcon` wrote it back (seg4 `1302`, `11a6`-`1238`): an item whose program is not found has its path as given, or empty, and index 6, with Program Manager's own icon 2 ([[fn:SHELL.ExtractAssociatedIcon]]).
- [[read out]] The command holds the working directory and the program's file name and arguments; the program's own directory is a tag (below). Read back, the command is the tag and the file name and arguments, and the working directory is the stored command's folder (seg4 `1071`-`116b`, `2967`-`2a85`).
- [[read out]] Deleting an item takes out its blocks, moves everything after them down and mends every offset; its slot becomes nought and is reused (seg4 `15e6`-`1726`, `081e`-`0896`).

## Tags

[[documented]] [[read out]] After `cbGroup`, records of a word id, a word item (its slot), a word size that counts the record's own six bytes, and data (seg4 `0ae6`-`0c2a`):

- `8000h`, item `FFFFh`, size `0Ah`, `PMCC`: the first, written when the first tag is.
- `8101h`: the program's directory, with its trailing `\`, and a nought.
- `8102h`: the hot key, a word, only when it is not nought.
- `8103h`: run minimized, no data, only when set.
- `FFFFh`, item `FFFFh`, size nought: the end.

- [[read out]] An item's tags are written in the order `8102h`, `8103h`, `8101h`, each one deleted first if it was there and added before the end record, so later items' tags follow earlier ones' (seg4 `13f5`-`1450`, `0b1f`). A group never given a tag has none at all: the installation's three groups have none.
- [[measured]] Caribbean Treasure's item, `c:\windows\games`, has `8101h` with `c:\windows\games\`, in its own case ([[probe:pmbare]]).

## The checksum

[[read out]] The word at `04` makes the 16-bit sum of the file's words nought: it is set to nought, the words are summed through the end tag, or to `cbGroup` where there are no tags, and the negation is stored (seg4 `014c`-`0187`, `04ed`-`0500`, `22a3`-`22b4`). [[measured]] The installation's group files, and every one the probes record, sum to nought.

## Writing

- [[read out]] A group file is written whole after each item added or deleted, a rename, its icons refreshed, and settings saved (seg4 `147c`, `1726`, `2509`, `1b14`, `2849`); not after auto-arrange, so the file keeps the places of the last write. A read-only file is not written (`04ca`-`04d5`).
- [[read out]] Where the file must grow, one byte is written at its new end first, a full disk reported so; then the whole group from the start, then a write of nought bytes ends the file there (seg4 `056c`-`05f2`). [[measured]] [[probe:pmbare]]'s files are their groups' bytes and nothing after.
- [[read out]] Saving settings writes each group's place into its header, each item's place, and the slots compacted into the order of the window's items, the rest nought, `cItems` kept (seg4 `2534`-`2651`). [[measured]] After `[ExitProgman(1)]` the two items of [[probe:pmbare]]'s first group had changed slots.

## Loading

[[read out]] `LoadGroup` (seg4 `1d4d`) makes the group's window, reads the file (`018a`) and refuses it as "invalid or damaged" (message `4Bh`) where it is shorter than `24h`, the read comes up short, `cbGroup` is past its end, the sum is not nought, it does not begin `PMCC` (`0389`-`03b3`), `cItems` is nought, or any item's offset is past `cbGroup` (`1c95`-`1d1e`). A file it cannot open asks whether to try it again in future, No taking its `GroupN=` out of `PROGMAN.INI` (`0313`-`0387`). Either way the window goes and nothing is loaded. Under DDE the boxes are not shown at all ([[topic:program-manager-dde]]). [[measured]] As Program Manager starts they are: a first version of [[probe:pmfiles]] that gave it such files stopped there, the box letting no other task run, the probe included, until DOSBox's time ran out. Program Manager's boxes go through one routine (seg1 `00ec`), its callers giving `MB_SYSTEMMODAL` (`1010h`, `1030h`).

- [[read out]] A group whose `nCmdShow` is not nought is placed by `SetWindowPlacement`, its icon at `ptMin` (`WPF_SETMINPOSITION`); one never saved keeps the MDI default (seg4 `1f04`-`1f51`). [[measured]] Two groups loaded from the same file's bytes lie at the same icon place ([[probe:pmfiles]], [[probe:pmraw]]).
- [[read out]] Each group loaded is checked against the display: where `SYSTEM.INI`'s `display.drv=` is not `PROGMAN.INI`'s `[Settings]` `display.drv=` (compared with case), or the header's icon format or size is not the screen's, every item's icon is extracted again from its path and appended anew, and the file is written (seg4 `17ae`-`1b3d`). Program Manager writes `display.drv=` only after every group is loaded (seg3 `08ab`-`08d8`), so a `PROGMAN.INI` without it rewrites every group. [[measured]] With `display.drv=other.drv`, MAIN.GRP kept its size, 5115 bytes, and 3833 of its bytes changed: its icons moved to its end ([[probe:pmfiles]]).

## The block's own operations

[[read out]] Every change is made to the group's block in memory by a handful of routines in seg4, and the file is the block's bytes as `WriteGroup` finds its length:

- **Room for data** (`0899`): the bytes go at `cbGroup`, the tags moved up after them, and `cbGroup` grows; a size of nought means the source's string and its nought. **Taking it out** (`081e`): the pointer to it is set nought, everything after it moved down, and every offset at or past it mended (`066d`: `pName`, the table's entries and each item's six pointers). Past 64K, room is refused.
- **A new slot** (`0741`): the first nought in the table, else the table grows by a word and every offset moves up two.
- **Tags** (`096d`, `0a69`, `0ae6`): found from the first, by item and, unless asked for any, by id; one taken out by moving the rest down; one added where the end tag was, after any of the same id and item is taken out, the first tag and the end written at `cbGroup` where there is no end tag. `GetTagValue` (`0c5a`) reads a record of six bytes as 1, seven as its byte, eight as its word, any other as nought.
- **An item made** (`1254`-`1450`): a slot, the `ITEMDEF` (zeroed), name, command, icon path, header, AND and XOR, each a block of its own; the place, index and sizes into the `ITEMDEF`; then the tags. The slot is taken before the 50-slot test, so a full group grows by a slot it then refuses; on any failure Program Manager lets the block go (`157c`-`1589`) and the next use reads the file again.
- **An item taken out** (`15e6`-`16d0`): its name, command, icon path, AND, XOR, header, then the `ITEMDEF` through the table's entry, which is left nought; then every tag of its slot.
- **Renamed** (`24cc`-`24fa`): the name taken out and added again, so it moves to the end of the data.
- **Saved** (`2518`-`2651`): each item of the window, in the window's order, gets its place, and its tags are renumbered to its `ITEMDEF`'s offset, a key no slot can be (`0d62`); then each, in turn, to its new slot, the table made that order, the slots after it nought.
- **The icons refreshed** (`18b6`-`1aef`): the header's icon format and size, then for each slot in turn its header, AND and XOR taken out and the three added again at the end. An item left without all three keeps none, its sizes nought.
- [[measured]] These give the probes' files byte for byte: [[probe:pmbare]]'s three groups made again from their items in the order their `ITEMDEF`s lie, its first group saved by `[ExitProgman(1)]`, and [[probe:pmfiles]]' MAIN.GRP refreshed with each item's icon as it was.

## PROGMAN.INI's groups

[[read out]] Start-up's reading of `[Groups]` (seg3 `06c1`-`08a3`, beside [[topic:program-manager-dde]]):

- The keys come from `GetPrivateProfileString` with no entry into a buffer of 140h bytes, so a list longer than that ends in a name cut short, which may be a key of its own (`Group41` read as `Group4`). Each key is made upper case; one is kept where it is `GROUP`, then not `0`, then only digits -- none at all included (`05e2`).
- `Order=` (a buffer of 7Fh) is read number by number, spaces skipped, up to anything else. The key each number names, `GROUP` and its digits compared without case, is moved to the end of the list, and a count of keys not yet named goes down; then that many keys are moved from the front to the end. A number named twice is counted twice, so a key not named stays in front.
- Each key's value (a buffer of 78h) that is not empty is a group to load, its number its digits taken as a 16-bit number; a key with no digits is number nought, which `LoadGroup` makes the lowest number not in use by a group loaded.

[[read out]] Writing them (seg4 `2662`-`2826`): the MDI client's children from the bottom up, icon titles left out, each group's path through `OpenFile`'s `OF_PARSE` (a group without a file first given one, `0ea5`), written as `GroupN=` with `wsprintf`'s `%d`, and its number added to `Order=` after a space; a 41st stops it with a beep. `Order=` is written last.

## Not yet done

- The damaged and missing files' boxes recorded: they are system-modal as Program Manager starts.
- A group loaded at its saved minimized place on another display.
- [[read out]] and not followed: Program Manager bounds its walks of the tags by its block's `GlobalSize`, which may be more than the file; a tag of size nought it walks forever; a block of size nought is added and taken out as a string's; the digits of an `Order=` number go into a 15-byte buffer. WinBox's reader bounds the walk by the file, stops at a tag of size nought, and takes an icon block of size nought as no icon.

## In WinBox

Program Manager is Microsoft's, run from the installation, and both engines run its files as above byte for byte ([[probe:pmbare]] on the VGA and the EGA, [[probe:pmfiles]]).

WinBox's own reader and writer is pure code in both engines, `src/layers/groups.ts` and `crates/winbox-win16/src/groups.rs`, for the stand-in and for a launcher's list of groups ([[topic:program-manager-dde]]):

- A group file read into a model of the header and the items, each item's command and working directory as Program Manager reads them back, its hot key and minimized flag from its tags, and its icon's header and planes; and written again. The model keeps where each block lay and the order of the tags, so a file Program Manager wrote is written again byte for byte, the checksum included; a model made afresh is laid out as a group made and filled in slot order.
- The block's operations above, each as read out, for a stand-in to change a group with: a new group, an item made, taken out, the name changed, settings saved, icons refreshed, and the bytes `WriteGroup` writes.
- `PROGMAN.INI` read as start-up reads it and written as `CreateGroup`, saving and `DeleteGroup` write it; and the groups on a flattened stack of layers, as start-up would load them.
- [[measured]] Held to Program Manager's own files: the installation's MAIN.GRP, ACCESSOR.GRP and STARTUP.GRP on each display's drive of the oracle's (VGA, EGA, Hercules, SVGA, 8514/A, the 256-colour and XGA drivers), read and written again byte for byte, and its `PROGMAN.INI`'s groups in the order Accessories, StartUp, Main; and every group file the pm probes recorded ([[probe:pmbare]], [[probe:pmfiles]], [[probe:pmsyntax]]). The two engines are held to each other by `test/layers/groups.json`, groups made by the operations above from made-up items.
