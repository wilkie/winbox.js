---
kind: function
module: SYSTEM
name: InquireSystem
ordinal: 1
summary: What the system driver says of the timer's resolution and of a drive: how KERNEL's GetDriveType asks.
versions:
  '3.1': exact
probes: [sysdrv]
records: [inquire]
topics: [system-driver, drives-and-disks]
source: crates/winbox-win16/src/system_driver.rs
---

## Observed behaviour

- [[measured]] [[probe:sysdrv]]: code 0 answers 54,925 (`0000d68d`), the timer's tick in microseconds, whatever the drive.
- [[measured]] Code 1 answers a drive's kind in AX, as [[fn:KERNEL.GetDriveType]] answers it -- A: 2, C: 3, D: none, nought, Z: 3 -- and in DX the drive whose disk the letter is another name of: B:, with one floppy drive, `00010000`.
- [[measured]] Codes 2, 3 and 100 answer nought.

## Inside Windows

- [[read out]] `SYSTEM.DRV` seg1 `0002`-`0169`. KERNEL's `GetDriveType` is a call of it with code 1, AX kept (`KRNL386.EXE` seg3 `0675`).
- [[read out]] Code 1 selects the drive (21h, 0Eh then 19h); asks IOCTL 4409h whether it is remote, 4408h whether it is removable, and 440Eh which letter it is now. 440Eh failing for B: where the BIOS's equipment word counts one floppy drive puts 1 in DX and the kind 0 in AX (`00fb`-`010b`).
- [[read out]] Code 2 saves, or puts back, DOS's single-floppy byte at 0:504h, before DOS 3.20 only; after it, nothing (`0110`-`015e`).

## Implementation

`crates/winbox-win16/src/system_driver.rs`. The drive is `driveInquiry` (`crates/winbox-win16/src/modules_kernel.rs`'s `drive_inquiry`), which `GetDriveType` answers the AX of. DOSBox's B: with nothing in it, which it selects, is what WinBox's missing B: answers as.
