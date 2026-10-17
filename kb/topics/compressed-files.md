---
kind: topic
name: Compressed files
summary: LZEXPAND, Windows 3.1's expansion of the files COMPRESS made — LZ handles and DOS handles, its table of sixteen, how a plain file passes through, the errors, the buffers and the window LZRead reads through — read out of LZEXPAND.DLL and recorded, and WinBox's own with no file.
probes: [lzfiles]
---

`LZEXPAND.DLL` reads the files Microsoft's `COMPRESS` made ([[format:szdd]]): Windows' SETUP, [[fn:VER.VerInstallFile]], and any installer of a program use it to expand files from their disks. It is WinBox's own: with or without the file on the drive, a program's calls are WinBox's code ([[guide:without-windows]]).

## What the library holds

[[read out]] Twelve segments: eleven of code, written in C with Microsoft's C library, and one of data.

| Segment | What                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| seg1    | the copying buffers made and let go (entries 22, 23); opening a file by its name (entry 24)                                                                  |
| seg2    | [[fn:LZEXPAND.LZInit]], [[fn:LZEXPAND.GetExpandedName]], [[fn:LZEXPAND.LZOpenFile]], [[fn:LZEXPAND.LZSeek]], [[fn:LZEXPAND.LZRead]], [[fn:LZEXPAND.LZClose]] |
| seg3    | [[fn:LZEXPAND.WEP]]                                                                                                                                          |
| seg4    | [[fn:LZEXPAND.LZStart]], [[fn:LZEXPAND.LZDone]], [[fn:LZEXPAND.CopyLZFile]], [[fn:LZEXPAND.LZCopy]]                                                          |
| seg5    | a handle's state made current and kept (entries 17-19)                                                                                                       |
| seg6    | the output written out and the input read in (entries 26, 27)                                                                                                |
| seg7    | a plain file's copy, and the copy of one file into another (entry 21)                                                                                        |
| seg8    | the header read and its signature checked (entries 15, 16)                                                                                                   |
| seg9    | the decoder (entry 20)                                                                                                                                       |
| seg10   | names: a path's last part, its extension, the compressed and expanded names (entries 13, 14), the time copied (entry 25)                                     |
| seg11   | the C library: the file's time asked and set (entries 28, 29), its start and end, [[fn:LZEXPAND.___EXPORTEDSTUB]] (entry 12)                                 |
| seg12   | the data segment                                                                                                                                             |

[[read out]] It has no entry point: its data segment is as the file holds it, all nought but the C library's and its strings -- the signature at `[0060h]`, `\`, `_` and `._` at `[0072h]` to `[0076h]`.

| Ordinal | Export                            | What                                                 | WinBox's own |
| ------- | --------------------------------- | ---------------------------------------------------- | ------------ |
| 1       | [[fn:LZEXPAND.LZCopy]]            | a file copied into another, expanded                 | yes          |
| 2       | [[fn:LZEXPAND.LZOpenFile]]        | a file opened, its compressed name tried             | yes          |
| 3       | [[fn:LZEXPAND.LZInit]]            | an LZ handle for a DOS handle                        | yes          |
| 4       | [[fn:LZEXPAND.LZSeek]]            | a place in the expanded file                         | yes          |
| 5       | [[fn:LZEXPAND.LZRead]]            | bytes of the expanded file                           | yes          |
| 6       | [[fn:LZEXPAND.LZClose]]           | a handle let go                                      | yes          |
| 7       | [[fn:LZEXPAND.LZStart]]           | the copying buffers made                             | yes          |
| 8       | [[fn:LZEXPAND.CopyLZFile]]        | `LZCopy`                                             | yes          |
| 9       | [[fn:LZEXPAND.LZDone]]            | the copying buffers let go                           | yes          |
| 10      | [[fn:LZEXPAND.GetExpandedName]]   | the name a compressed file had                       | yes          |
| 11      | [[fn:LZEXPAND.WEP]]               | the exit procedure                                   | yes          |
| 12      | [[fn:LZEXPAND.___EXPORTEDSTUB]]   | answers nought                                       | yes          |
| 13-30   | [[fn:LZEXPAND.Ordinal 13]] and on | entries of its own far calls, not exported (flags 0) | no           |

## LZ handles and DOS handles

[[read out]] Every call that takes a handle takes either kind: a DOS handle, as `OpenFile` or `_lopen` gave it, below 400h; or an LZ handle, 400h to 40Fh, one of sixteen slots (seg2 `0307`). A DOS handle is passed to KERNEL as it is -- `_llseek`, `_lread`, `_lclose` -- so a plain file is read through LZEXPAND as it would be without it. A handle below nought or past 40Fh is -1, `LZERROR_BADINHANDLE`. [[measured]] So are 410h and 7FFFh; an empty slot, 40Fh, is -6, `LZERROR_GLOBLOCK`: its block's handle is nought, and `GlobalLock` of nought fails ([[probe:lzfiles]], `bad`).

[[read out]] An LZ handle is made by [[fn:LZEXPAND.LZInit]] for a DOS handle of a compressed file: a block of global memory, 18A5h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT`, holding the DOS handle at 0, the algorithm at 2, a word of flags at 3, the expanded length at 5, the compressed file's length at 9, the place in the expanded file at 0Dh, and the file's own buffers:

| Offset | What                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| 11h    | the input: the byte before the last read, then 400h bytes read from the file                                     |
| 413h   | the ring, 1000h bytes                                                                                            |
| 1493h  | the window: the last 400h bytes made                                                                             |
| 1893h  | the decoder's state kept between calls: its flags and ring place, the input's places, the window's fill and size |
| 18A1h  | the place in the expanded file of the window's first byte                                                        |

[[read out]] The slots are taken in turn, from the one after the last taken, wrapping (`[30h]`, seg2 `006e`); none free is -5, `LZERROR_GLOBALLOC`. [[measured]] Sixteen are given, 409h on round to 408h, and the seventeenth and eighteenth are -5 (FFFBh); two let go and two more asked for take the next free after the last, not the ones let go ([[probe:lzfiles]], `handles`). Each LZ handle holds its DOS handle open: [[measured]] with a task's twenty DOS handles, fourteen files can be open, and the fifteenth fails in `OpenFile` before LZEXPAND sees it -- the probe raises its count with `SetHandleCount` to reach the sixteen.

## A plain file

[[read out]] A file whose first fourteen bytes are not COMPRESS's header is passed through: [[fn:LZEXPAND.LZInit]] answers its DOS handle, sought back to its start; [[fn:LZEXPAND.LZOpenFile]] answers it; [[fn:LZEXPAND.LZCopy]] copies it as it is; [[fn:LZEXPAND.GetExpandedName]] gives its name unchanged. [[measured]] A file of fewer than fourteen bytes, or none, is plain; one whose header cannot be read at all, 14 bytes or longer, is -1 ([[probe:lzfiles]], `init`).

## The errors

| Answer | Name                   | When                                                                                                           |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| -1     | `LZERROR_BADINHANDLE`  | a handle out of range; a file that cannot be sought or read                                                    |
| -2     | `LZERROR_BADOUTHANDLE` | the output cannot be sought, or `_lwrite` answers -1                                                           |
| -3     | `LZERROR_READ`         | the stream ends before the expanded length, or within a pair                                                   |
| -4     | `LZERROR_WRITE`        | `_lwrite` writes fewer bytes than given                                                                        |
| -5     | `LZERROR_GLOBALLOC`    | no slot free; the copying buffers or a handle's block cannot be allocated                                      |
| -6     | `LZERROR_GLOBLOCK`     | a block cannot be locked: an empty slot's                                                                      |
| -7     | `LZERROR_BADVALUE`     | a negative count to [[fn:LZEXPAND.LZRead]]; a place before the start or a bad origin to [[fn:LZEXPAND.LZSeek]] |
| -8     | `LZERROR_UNKNOWNALG`   | the header's algorithm is not `A`                                                                              |

## The buffers

[[read out]] The decoder ([[format:szdd]]) works with one set of buffers at a time, its places kept in the data segment (seg5). [[fn:LZEXPAND.LZRead]] makes a handle's own current and puts the state back in its block when it is done; [[fn:LZEXPAND.LZCopy]] uses the copying buffers [[fn:LZEXPAND.LZStart]] makes -- a ring of 1080h bytes and an input and an output of 8000h each, `GMEM_DDESHARE | GMEM_ZEROINIT`, 400h less each time either cannot be had -- calling `LZStart` and [[fn:LZEXPAND.LZDone]] itself, so they live as long as a program's own `LZStart` keeps them.

[[read out]] A handle's output is a window of the last 400h bytes made, not a buffer of the file: [[fn:LZEXPAND.LZRead]] copies what it wants from the window, and decodes on, the window begun again each time, until the place it reads at is in it. A place before the window's start begins the stream again from its fourteenth byte. [[measured]] Reading the 20000 bytes of a compressed text in pieces of 1, 7, 100, 1024, 1025, 4096 and 30000 bytes gives every byte; seeking forward, back past the window and back within it, and reading after, gives the bytes at each place ([[probe:lzfiles]], `read`, `seek`).

## WinBox's code

`src/win16/lzexpand/lz.ts` and `crates/winbox-win16/src/lzexpand/mod.rs` follow each routine: the slots and the current buffers are a state of the system's own (`State`), and the blocks and buffers are global memory, allocated with the same flags and sizes, laid out as LZEXPAND lays them out. Files are read, written and sought through KERNEL's own `_lread`, `_lwrite` and `_llseek`, and the file's time through `Dos3Call`, as the library calls them. With `LZEXPAND.DLL` on the drive the file is loaded, and every import of an export is linked to WinBox's stub (`src/win16/own-modules.ts`, `crates/winbox-win16/src/own_modules.rs`); with none, `LoadLibrary("LZEXPAND.DLL")` finds WinBox's. Both engines agree with every record of [[probe:lzfiles]], with the file on the drive and without it (`test/win16/ver_lzexpand_test.ts`, `crates/winbox-win16/tests/ver_lzexpand.rs`).

## Not yet done

- [[fn:LZEXPAND.LZCopy]] of an LZ handle past 40Fh reads past LZEXPAND's table into its other data (seg4 `0185`); WinBox answers it as an empty slot, -1.
- The copying buffers' smaller sizes, where 8000h bytes cannot be allocated: WinBox's global heap always has them.
- `LZERROR_WRITE`, a disk that takes fewer bytes than given: no probe fills a disk.
- A file opened only for reading given to [[fn:LZEXPAND.LZCopy]] as its output: DOSBox refuses the write, and neither engine's DOS knows a file's mode yet; the probe uses a handle that is none (-2) instead.
- The C library's start and end (seg11), and the entries reached only from them, which LZEXPAND's exports never call: opening a file by its name (entry 24) and seg7 `01e0`.
