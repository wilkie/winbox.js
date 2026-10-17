---
kind: format
name: COMPRESS files (SZDD)
summary: The format Microsoft's COMPRESS writes and LZEXPAND reads — a 14-byte header signed "SZDD", the expanded length and the name's lost last letter, then an LZ77 stream over a ring of 4096 bytes — read out of LZEXPAND.DLL's decoder and checked byte by byte against it on DOSBox.
---

A file on the Windows 3.1 setup disks named `NOTEPAD.EX_` or `COMMDLG.DL_` is a file compressed by Microsoft's `COMPRESS`. [[fn:LZEXPAND.LZCopy]], [[fn:LZEXPAND.LZRead]] and the rest of `LZEXPAND` give back what it holds ([[topic:compressed-files]]); SETUP and [[fn:VER.VerInstallFile]] expand files this way.

## The header

[[read out]] Fourteen bytes, read in one `_lread` (`LZEXPAND.DLL` seg8 `00aa`):

| Offset | Bytes | What                                                                                                                  |
| ------ | ----- | --------------------------------------------------------------------------------------------------------------------- |
| 0      | 8     | the signature `SZDD` 88h F0h 27h 33h, compared with USER's `lstrcmp` as a string (seg8 `01a2`, the copy at `[0060h]`) |
| 8      | 1     | the algorithm: `A`, the only one LZEXPAND knows                                                                       |
| 9      | 1     | the last character of the file's name, which COMPRESS replaced with `_`; nought where it had none                     |
| 10     | 4     | the length of the expanded file                                                                                       |

[[read out]] Because the signature is compared as a string, a nought among its eight bytes ends it there, and the file is not taken for COMPRESS's. [[measured]] A signature one letter wrong is a plain file to every call ([[probe:lzfiles]], `BADSIG.TX_`): read, copied and named as it is.

[[measured]] Another algorithm's letter is refused: [[fn:LZEXPAND.LZInit]] and [[fn:LZEXPAND.LZCopy]] answer -8, `LZERROR_UNKNOWNALG` ([[probe:lzfiles]], `ALGB.TX_`).

## The stream

[[read out]] After the header, the stream as the decoder reads it (seg9 `0000`):

- A **ring** of 4096 bytes. Its places 0 to FEFh are spaces before the first byte; the last 16 are left as they were -- nought in a block just allocated with `GMEM_ZEROINIT` (`[270h]`, 10h). Bytes are written into it from FF0h on, and the place wraps at 1000h.
- A **flag byte**, whose bits, from the lowest, say what each of the next eight items is: 1 a literal byte, 0 a pair.
- A **literal** is one byte, put out and into the ring.
- A **pair** is two bytes: the first is the low eight bits of a place in the ring, the second's high four bits its top four; the second's low four bits are the length less three. The bytes are copied from the ring one at a time, each put out and into the ring as it is copied, so a pair may name places it is itself filling: a run.
- The stream ends where the file does. The header's length is not a limit on the decoder: it decodes until it has made more bytes than the caller wants (see [[fn:LZEXPAND.LZRead]]) or the input ends.

[[read out]] A pair read where the input ends -- its second byte missing -- or a flag byte with no item after it, is an error of reading, -3 `LZERROR_READ` (seg9 `0173`, `0231`).

## Making one

No compressor ships with Windows 3.1. `scripts/oracle/szdd.mjs` makes this format from the read-out: a greedy search of the whole ring for the longest match, three to eighteen bytes, matching only places the decoder has filled -- the spaces, or what it has written. [[measured]] [[probe:lzfiles]] writes three of its files and expands them through Windows' own `LZEXPAND.DLL` on DOSBox, every byte of every one of them the data the probe makes itself, read in pieces of 1 to 30000 bytes and by [[fn:LZEXPAND.LZCopy]].
