---
kind: topic
name: Multimedia files
summary: MMSYSTEM's buffered file I/O, the mmio functions — the MMIOINFO structure and its buffer pointers, I/O procedures and the DOS and memory ones, RIFF chunks, and every error — read out of MMSYSTEM.DLL and measured against Windows 3.1, with Sound Recorder's saves held to the byte.
probes: [mmio, sndrec]
---

A program reads and writes a waveform file, or any RIFF file, through `MMSYSTEM.DLL`'s `mmio` functions. They buffer the file, find the chunks of a RIFF file, and pass the I/O itself to an I/O procedure: the DOS one for a file on a disk, the memory one for a file that is a block of memory, or one the program installs. Sound Recorder opens, saves, inserts and mixes files with them.

Everything here is [[read out]] of `MMSYSTEM.DLL` seg7 (`0`-`188f`), its handles seg4 `2e6`-`350` and seg1 `1e8`, and [[measured]] by two probes. [[probe:mmio]] opens, reads, writes, seeks and buffers files of each kind and records every error; winbox.js agrees with all 313 of its records, on both engines. [[probe:sndrec]] has Windows' own Sound Recorder change three files with its Effects menu and save them, and reads the files back; winbox.js agrees with all 75 records, and the Rust engine with all 72 of the recording on the installation with a sound card.

## The structure

A file open is an `MMIOINFO`, 42h bytes, in MMSYSTEM's local heap. A program reads it with [[fn:MMSYSTEM.mmioGetInfo]] and writes it back with [[fn:MMSYSTEM.mmioSetInfo]]; an I/O procedure is handed a far pointer to it.

| Offset | Field                        | What it holds                                                                                                                                    |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 00h    | `dwFlags`                    | The open's flags, with `MMIO_ALLOCBUF` (10000h) while MMSYSTEM owns the buffer and `MMIO_DIRTY` (10000000h) while it holds bytes not yet written |
| 04h    | `fccIOProc`                  | The I/O procedure's four-character code                                                                                                          |
| 08h    | `pIOProc`                    | The I/O procedure                                                                                                                                |
| 0Ch    | `wErrorRet`                  | Why `mmioOpen` failed                                                                                                                            |
| 0Eh    | `htask`                      | The task whose I/O procedures are looked in; nought for the caller's                                                                             |
| 10h    | `cchBuffer`                  | The buffer's size                                                                                                                                |
| 14h    | `pchBuffer`                  | The buffer, a huge pointer                                                                                                                       |
| 18h    | `pchNext`                    | Where the next byte is read or written                                                                                                           |
| 1Ch    | `pchEndRead`                 | The end of what the buffer holds                                                                                                                 |
| 20h    | `pchEndWrite`                | The buffer's end                                                                                                                                 |
| 24h    | `lBufOffset`                 | The file's offset of the buffer's first byte                                                                                                     |
| 28h    | `lDiskOffset`                | Where the I/O procedure is in the file; its own to keep                                                                                          |
| 2Ch    | `adwInfo[3]`                 | The I/O procedure's own: the DOS file handle in the first, a memory file's step to grow by                                                       |
| 38h    | `dwReserved1`, `dwReserved2` | Untouched                                                                                                                                        |
| 40h    | `hmmio`                      | The file's own handle                                                                                                                            |

An `MMCKINFO`, 14h bytes, describes a chunk: `ckid` at 0, `cksize` at 4, `fccType` at 8, `dwDataOffset` at 0Ch (the file's offset of the chunk's data, past its header), `dwFlags` at 10h.

- [[read out]] The handle is the block's offset in MMSYSTEM's data segment, past a header of six bytes: the next block of MMSYSTEM's, the block's kind, 5 for a file, and the task that made it (seg4 `2e6`, `LocalAlloc(LMEM_ZEROINIT)`). Every function checks the kind at the handle less 4 first (seg1 `1e8`); a freed block's kind is cleared (`31b`).
- [[measured]] The structure an I/O procedure is handed is MMSYSTEM's data segment at the handle: its offset is the `hmmio` it holds. [[fn:MMSYSTEM.mmioRename]]'s is a block made for the while, whose `hmmio` is nought.
- [[measured]] `htask` is what the program's structure had, nought where none was given.

## I/O procedures

An I/O procedure is `LRESULT FAR PASCAL IOProc(LPSTR lpmmioinfo, UINT wMsg, LPARAM lParam1, LPARAM lParam2)`. MMSYSTEM calls it with its own data segment in DS (`call far [bx+8]`).

| Message            | Number | `lParam1`           | `lParam2`                            | Answer                  |
| ------------------ | ------ | ------------------- | ------------------------------------ | ----------------------- |
| `MMIOM_READ`       | 0      | The buffer          | How many bytes                       | How many read, or -1    |
| `MMIOM_WRITE`      | 1      | The bytes           | How many                             | How many written, or -1 |
| `MMIOM_SEEK`       | 2      | The offset          | `SEEK_SET`, `SEEK_CUR` or `SEEK_END` | The new offset, or -1   |
| `MMIOM_OPEN`       | 3      | The name, or nought | Nought                               | Nought, or an error     |
| `MMIOM_CLOSE`      | 4      | `mmioClose`'s flags | Nought                               | Nought, or an error     |
| `MMIOM_WRITEFLUSH` | 5      | The buffer          | How many                             | How many written        |
| `MMIOM_RENAME`     | 6      | The old name        | The new name                         | Nought, or an error     |

- [[read out]] A file's procedure is found as it opens (`bf`): the structure's `pIOProc` where it gives one, and the code left as it is, even nought ([[measured]]); else by the code -- the structure's `fccIOProc`, or else the extension before the last `+` in the name, its first four characters made capital (`FOO.xyz+inner` is `XYZ `), or else `DOS `. The extension is found by going back from the `+` to a `.`, `:` or `\`; a `.` must be what is found.
- [[read out]] The code is looked for among the procedures installed for the task -- the structure's `htask`, or the current task -- and then among the global ones (`0`). `DOS ` and `MEM ` are installed in MMSYSTEM's own data, global, marked never to be removed (`DS:26h`, `DS:34h`, the list's head at `DS:42h`). A code found nowhere is the DOS procedure's: a name `FOO.XYZ+inner` with no `XYZ ` installed is opened by DOS as it is, and is not there (101h, [[measured]]).
- [[measured]] The DOS procedure, the memory one, and a program's are each called with the structure in MMSYSTEM's data segment; a program's sees `lDiskOffset` as it left it.

[[fn:MMSYSTEM.mmioInstallIOProc]] takes the code, the procedure and one of `MMIO_INSTALLPROC` (10000h), `MMIO_REMOVEPROC` (20000h) and `MMIO_FINDPROC` (40000h), with `MMIO_GLOBALPROC` (10000000h) to install for every task (`f6e`):

- [[measured]] A flag but those -- any of the low word, or a high bit but 1, 2, 4 and 1000h -- answers NULL. So does a code of nought.
- [[measured]] Installing answers the procedure, put first in the list; a procedure `IsBadCodePtr` refuses is not installed. A global one's block is given no task, so it outlives the task.
- [[measured]] Removing or finding with a procedure given answers NULL. Finding answers the task's procedure, else a global one: `MEM ` and `DOS ` are found. Removing takes the task's, else a global one, and answers it; `MEM ` cannot be removed, and answers NULL.
- [[fn:MMSYSTEM.mmioSendMessage]] sends any message to a file's procedure and answers what it answers; nought for a handle not open (`1073`).

### The DOS procedure

The DOS procedure (`117b`) works through KERNEL on the DOS handle in `adwInfo[0]`:

- [[read out]] Reading and writing are `_hread` and `_hwrite`, `lDiskOffset` moved on by what was done. Seeking is `_llseek`, `lDiskOffset` made its answer. Each answers what KERNEL answered.
- [[read out]] Opening a name is `OpenFile` with the low word of the open's flags, which are `OpenFile`'s own: `MMIO_CREATE` is `OF_CREATE`, `MMIO_PARSE` `OF_PARSE`, `MMIO_EXIST` `OF_EXIST`, `MMIO_DELETE` `OF_DELETE`, and the read, write and sharing flags the same. The handle goes in `adwInfo[0]`'s low word, and `lDiskOffset` is where the file is, `_llseek(h, 0, SEEK_CUR)`.
- [[measured]] With no name, the handle already in `adwInfo[0]` is the file: one the program opened, read from where it is. `MMIO_FHOPEN` (10h) to [[fn:MMSYSTEM.mmioClose]] leaves it open; without it, closing closes it.
- [[measured]] A file not there answers `MMIOERR_FILENOTFOUND` (101h); one not there to delete, `MMIOERR_CANNOTWRITE` (106h).
- [[measured]] `MMIO_PARSE` and `MMIO_EXIST` give the path `OpenFile` made back in the name's place, through `OemToAnsi`: `C:\oracle\.\mmio.wav` parses to `C:\ORACLE\MMIO.WAV`, as does a file not there. `mmioOpen` answers TRUE for these and for `MMIO_DELETE`, and keeps no file open.
- [[measured]] `MMIO_GETTEMP` (20000h) makes a temporary file's name with `GetTempFileName`: the drive the name's first character, the prefix from its fourth, the number `adwInfo[0]`. `C:\MMX` with 1234h is `C:\WINDOWS\~MMX1234.TMP` on the oracle's installation.
- [[read out]] Closing is `_lclose`, which failing answers `MMIOERR_CANNOTCLOSE` (104h). Renaming is DOS's function 56h, which failing answers 101h.

### The memory procedure

The memory procedure (`1301`) has no file: the file is the buffer.

- [[read out]] It refuses reading, writing and seeking, -1; MMSYSTEM does them in the buffer itself.
- [[measured]] Opening takes only the read and write and sharing flags, `MMIO_CREATE` and `MMIO_ALLOCBUF`; any other, `MMIO_EXIST` say, answers `MMSYSERR_INVALFLAG` (10). Without `MMIO_CREATE` the whole buffer is the file, `pchEndRead` at its end; with it, the file is empty.
- [[measured]] Writing past the buffer's end grows it, where `adwInfo[0]` is not nought: by what is wanted, or by `adwInfo[0]` where that is more, the buffer reallocated where it is with `GlobalReAlloc` -- the program's own block if it gave one. With `adwInfo[0]` nought the write answers -1 and nothing is written (`MMIOERR_CANNOTEXPAND`, 108h, within).
- [[measured]] A seek past the file's end answers -1. A file with no buffer reads nothing.

## Opening

[[fn:MMSYSTEM.mmioOpen]]`(szFilename, lpmmioinfo, dwOpenFlags)` answers the handle, or NULL (`2a5`):

1. [[measured]] A flag in the high word but `MMIO_ALLOCBUF` and `MMIO_GETTEMP` answers NULL at once, `wErrorRet` untouched.
2. [[read out]] A structure given is checked writable, its `wErrorRet` cleared, and a procedure in it checked with `IsBadCodePtr`; failing either answers NULL.
3. [[read out]] The block is made -- failing, `wErrorRet` is `MMIOERR_OUTOFMEMORY` (102h) -- and the structure copied into it whole; `dwFlags` is then the open's, and `hmmio` the handle. With `MMIO_ALLOCBUF`, a buffer size of nought is made 8192, and the flag taken out until the buffer is made.
4. [[read out]] The procedure is found, and the buffer made with [[fn:MMSYSTEM.mmioSetBuffer]] from the structure's `pchBuffer` and `cchBuffer`. A size with no buffer makes one of MMSYSTEM's, `MMIO_ALLOCBUF` or not.
5. [[read out]] The procedure is sent `MMIOM_OPEN`. An answer but nought is put in `wErrorRet` and the block freed.
6. [[measured]] `MMIO_PARSE`, `MMIO_DELETE`, `MMIO_EXIST` and `MMIO_GETTEMP` free the buffer and the block and answer TRUE. Else `lBufOffset` is made `lDiskOffset` and the handle answered.

[[fn:MMSYSTEM.mmioClose]] flushes the buffer -- a failure only marks it clean -- and sends `MMIOM_CLOSE` with its flags. The block and buffer are freed only if the procedure answers nought; its answer is answered (`457`). A handle not open is `MMSYSERR_INVALHANDLE` (5).

## The buffer

- [[measured]] MMSYSTEM's own buffer is `GlobalAlloc(GMEM_MOVEABLE)`, locked: its offset is nought. A program's is used as it is, and not freed.
- [[measured]] [[fn:MMSYSTEM.mmioSetBuffer]] with a buffer or with none writes out a dirty buffer and empties it, moving `lBufOffset` on to `pchNext`; frees MMSYSTEM's own; and takes the new one, making it MMSYSTEM's own where a size is given with no pointer. All the pointers are then at its start, `pchEndWrite` at its end. A size of nought leaves the file unbuffered.
- [[measured]] Asked again for MMSYSTEM's own buffer with no pointer and a size, it reallocates it where it is and keeps what it holds as far as it fits: emptied first while `pchNext` is past the new size (`aee`).
- [[measured]] A flag answers `MMSYSERR_INVALFLAG` (10); a buffer not writable, `MMSYSERR_INVALPARAM` (11).

### Reading and writing

- [[measured]] [[fn:MMSYSTEM.mmioRead]] takes what the buffer holds first. While what is left fits the buffer it fills the buffer again with [[fn:MMSYSTEM.mmioAdvance]], stopping at the file's end; what is left that does not fit is read straight from the procedure, after the buffer is emptied, at `lBufOffset`. It answers how many bytes, or -1, even where some were read before the procedure failed.
- [[measured]] [[fn:MMSYSTEM.mmioWrite]] puts what fits in the buffer, sets `MMIO_DIRTY`, and moves `pchEndRead` up to `pchNext` where it has passed it. While what is left fits the buffer, the buffer is written out and emptied; what does not is written straight, after the buffer is emptied.
- [[measured]] Unbuffered, each read or write goes straight to the procedure, a seek to `lBufOffset` first where `lDiskOffset` is elsewhere (`10a9`); `lBufOffset` is then `lDiskOffset`.
- [[measured]] Reading a file just written, from where the writing left it, its end, answers nought.

### Seeking

[[fn:MMSYSTEM.mmioSeek]]`(hmmio, lOffset, iOrigin)` (`7e9`):

- [[measured]] `SEEK_SET` (0) is the offset; `SEEK_CUR` (1) is the offset from `pchNext`'s place; `SEEK_END` (2) asks the procedure for the end, `MMIOM_SEEK` to nought from the end, and takes the offset back from it: the end less the offset, not plus. -4 from the end of a 74-byte file is 78. A memory file's end is the end of what the buffer holds. Any other origin answers -1.
- [[measured]] A place within what the buffer holds -- from `lBufOffset` to `pchEndRead`'s place -- only moves `pchNext`. Any other writes out a dirty buffer, empties it, and makes the place `lBufOffset`; the procedure is not asked to seek until a read or write. A memory file refuses it, -1.
- [[measured]] A place before nought is taken: -3 answers -3, and is `lBufOffset`.
- [[measured]] A file being written whose buffer has not been written out has no end on the disk yet: `SEEK_END` there answers nought, and 4 from that end -4.

### Flushing and advancing

- [[measured]] [[fn:MMSYSTEM.mmioFlush]] writes a dirty buffer, `pchBuffer` to `pchEndRead`, with `MMIOM_WRITEFLUSH`, failing short with `MMIOERR_CANNOTWRITE` (106h), and clears `MMIO_DIRTY`. `MMIO_EMPTYBUF` (10h) then empties it. Any other flag is 10. A memory file, or one with no buffer, has nothing to flush.
- [[measured]] [[fn:MMSYSTEM.mmioAdvance]] lets a program use the buffer itself, as `mmioGetInfo` gives it. The structure given is taken in first, as `mmioSetInfo` takes it; the buffer is written out where `MMIO_DIRTY` is set, and emptied; for `MMIO_READ` (0) it is filled from the file, `MMIOERR_CANNOTREAD` (105h) where the procedure fails; and the structure is given back. Its last read past the end answers nought with `pchNext` and `pchEndRead` at the buffer's start. Bytes put in the buffer without `MMIO_DIRTY` set are not written.
- [[measured]] A file with no buffer answers `MMIOERR_UNBUFFERED` (10Ah); a flag but `MMIO_WRITE`, 10. A memory file is not filled, and for writing is grown only where less than `adwInfo[0]` is left; then it answers nought without giving the structure back.
- [[measured]] [[fn:MMSYSTEM.mmioSetInfo]] copies the structure in whole and moves `pchEndRead` up to `pchNext`. It checks the buffer writable and the procedure with `IsBadCodePtr`, 11, and a flag, 10. [[fn:MMSYSTEM.mmioGetInfo]] copies it out; 10 for a flag.

## Four-character codes

[[fn:MMSYSTEM.mmioStringToFOURCC]] reads four bytes whatever they are (`ed3`):

- [[measured]] A nought is a space, and the reading goes on past it: `ab`, nought, `cd` is `ab c`; nought, `xyz` is ` xyz`. Past four bytes nothing is read: `abcdef` is `abcd`.
- [[measured]] `MMIO_TOUPPER` (10h) makes each byte but a nought capital, by `AnsiUpper`: `Fm1` is `FM1 `. Any other flag answers FFFFFFFFh. A string `IsBadStringPtr` refuses answers nought.

## RIFF chunks

- [[measured]] [[fn:MMSYSTEM.mmioCreateChunk]] writes a chunk's header where the file is: the `ckid` and `cksize` the structure has, and for `MMIO_CREATERIFF` (20h) `RIFF` and the `fccType`, for `MMIO_CREATELIST` (40h) `LIST` and the type. `dwDataOffset` is the place after the eight bytes of id and size -- for a `RIFF` or `LIST`, the type's place -- and `dwFlags` is `MMIO_DIRTY` (`16a5`).
- [[measured]] [[fn:MMSYSTEM.mmioAscend]] of a chunk marked dirty writes a nought where its data is odd, and writes its size back where it is not the structure's: `cksize` is made where the file is less `dwDataOffset`. It then seeks past the data and its pad byte (`1562`). The structure stays marked.
- [[measured]] [[fn:MMSYSTEM.mmioDescend]] reads chunk headers into the program's structure one after another from where the file is (`1360`): for `MMIO_FINDCHUNK` (10h) until one has the `ckid` given; for `MMIO_FINDRIFF` (20h) and `MMIO_FINDLIST` (40h) until a `RIFF` or `LIST` has the `fccType` given; with no flag, the first. Each not wanted is ascended out of. A `RIFF` or `LIST` has its type read; any other chunk's `fccType` is nought.
- [[measured]] A header that would start at or past the parent's end -- its `dwDataOffset` and `cksize` -- or the file's end answers `MMIOERR_CHUNKNOTFOUND` (109h), the structure holding the last chunk passed and the file at its end.
- [[measured]] A flag but these answers 10 from each.

## Errors

| Answer                  | Value | From                                                                                                                                                                                  |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MMSYSERR_INVALHANDLE`  | 5     | A handle not open: `mmioClose`, `mmioGetInfo`, `mmioSetInfo`, `mmioSetBuffer`, `mmioFlush`, `mmioAdvance`. `mmioRead`, `mmioWrite` and `mmioSeek` answer -1, `mmioSendMessage` nought |
| `MMSYSERR_INVALFLAG`    | 10    | A flag a function does not take; the memory procedure's open                                                                                                                          |
| `MMSYSERR_INVALPARAM`   | 11    | A structure or buffer not readable or writable                                                                                                                                        |
| `MMIOERR_FILENOTFOUND`  | 101h  | A file not there; a rename refused                                                                                                                                                    |
| `MMIOERR_OUTOFMEMORY`   | 102h  | No block for the file, or no buffer                                                                                                                                                   |
| `MMIOERR_CANNOTCLOSE`   | 104h  | `_lclose` failed                                                                                                                                                                      |
| `MMIOERR_CANNOTREAD`    | 105h  | Filling the buffer failed                                                                                                                                                             |
| `MMIOERR_CANNOTWRITE`   | 106h  | A flush written short; a chunk's size not written; a file not there to delete                                                                                                         |
| `MMIOERR_CANNOTSEEK`    | 107h  | A seek failed in a chunk function: with no handle, each of them                                                                                                                       |
| `MMIOERR_CANNOTEXPAND`  | 108h  | A memory file that cannot grow                                                                                                                                                        |
| `MMIOERR_CHUNKNOTFOUND` | 109h  | No such chunk; with no handle, `mmioDescend`                                                                                                                                          |
| `MMIOERR_UNBUFFERED`    | 10Ah  | `mmioAdvance` with no buffer                                                                                                                                                          |

[[read out]] A flag refused is also logged with `LogParamError`, `ERR_BAD_FLAGS` (6002h), which the retail KERNEL does nothing with.

## Sound Recorder

[[measured]] [[probe:sndrec]] starts Sound Recorder on a file of the probe's, posts it commands of its Effects menu and then Save, and reads the file back: 101 samples reversed and made louder; 3001 made faster and given an echo; 1500 made quieter and slower. What Sound Recorder saves is a RIFF `WAVE` of its `fmt ` chunk and its `data`, a pad byte after an odd `data`. winbox.js writes every byte the same, on the installation with a sound card and without one. Without one Sound Recorder says it cannot record or play back, in a message box that a posted OK does not close, and takes the commands all the same.

Before, every `mmio` function was a stub answering nought, and Sound Recorder said there was not enough disk space for any file ([[topic:accessories]]).

## Not yet done

- The I/O procedures a task installs, and the files it leaves open, are not freed as it ends. MMSYSTEM's blocks carry their task for that; not read out.
- `MMIO_TOUPPER` hands `AnsiUpper` each byte as a far pointer whose high word is the byte's sign: a byte of 80h and up is a pointer, not a character. winbox.js leaves such a byte as it is: not followed.
- A rename is not told to `FileCdr`'s procedure.
- Not yet measured: a file larger than 64 KB through a huge buffer; `MMIOERR_OUTOFMEMORY`; the I/O procedures called by a program at the addresses it is handed.
- Timings are not measured.

## In winbox.js

The functions are `crates/winbox-win16/src/mmsystem/mmio.rs` and `src/win16/mmsystem/mmio.ts`, the same in each. The structure lives in MMSYSTEM's data segment, where a program's I/O procedure is handed it; the handles' numbers are winbox.js's own, blocks from 8006h in steps of 50h. MMSYSTEM calls KERNEL and KEYBOARD through their own entries, as Windows' does. The DOS and memory procedures are winbox.js's, at MMSYSTEM's ordinals 1200 and 1201, where Windows exports nothing: a program handed their addresses can call them, but `GetProcAddress` does not find them.

Two things outside MMSYSTEM were changed for it. `MakeProcInstance`'s thunks are now in a code segment, as Windows' are: `IsBadCodePtr` refused a program's I/O procedure ([[topic:dynamic-link-libraries]]). And `OpenFile` with `OF_PARSE` makes the name whole as it does before a search, capital and with `.` gone.

`MCIWAVE.DRV` and `sndPlaySound` are winbox.js's own and read a waveform file themselves, not through these functions ([[topic:sound-devices]]).
