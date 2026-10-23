---
kind: topic
name: CD-ROM drives
summary: What a Windows 3.1 program sees of a CD-ROM drive under DOSBox — MSCDEX's register calls with and without a disc, a disc's drive as IOCTL and GetDriveType answer for it, and an ISO 9660 image's names, stamps, attributes and room — measured; neither engine mounts a disc yet.
probes: [mscdex, imgcd]
---

Programs of the time find their CD-ROM by asking MSCDEX through `INT 2Fh`, then read its files through DOS like any drive's. Under DOSBox, where the oracle's Windows runs, a disc is an ISO 9660 image mounted with `IMGMOUNT -t iso` (see [[topic:drives-and-disks]], "Disk and CD images", for how the probes mount one and the design that will mount one here).

## MSCDEX

- [[measured]] [[probe:mscdex]], with no disc: 1500h answers AL FFh -- installed -- BX 0 drives, CX as it was; 150Bh answers AX 0 and BX ADADh for every drive; 150Ch BX 0217h, version 2.23; 1100h AL FFh.
- [[measured]] [[probe:imgcd]], a disc as D:: 1500h BX 1, CX 3 (D:, from nought for A:); 150Bh AX 5AD8h for D:, nought for the others.
- [[read out]] DOSBox installs its own MSCDEX whether or not a disc is mounted (`dos_mscdex.cpp` 1312-1322).
- Both engines answer these four as DOSBox does, a drive removable and remote counted a CD-ROM ([[topic:drives-and-disks]], "MSCDEX").

## The drive

- [[measured]] [[probe:imgcd]]: IOCTL 4408h is error 1; 4409h DX 1000h, remote; 440Dh and 440Eh error 1; `GetDriveType` 4, `DRIVE_REMOTE`. [[read out]] `isoDrive` is remote and removable (`drive_iso.cpp` 374-380), and `SYSTEM.DRV` takes a remote drive for `DRIVE_REMOTE` before asking anything else.
- [[measured]] 36h: 1 sector to a cluster, nought free, 2,048 bytes to a sector, 60,000 clusters, whatever the disc.

## The disc's files

- [[measured]] Names lose their `;1` and a trailing dot, are cut to eight characters before the dot and twelve in all, and are listed in capitals, in the disc's order. The root has no `.` and `..`; a folder lists them first. A folder whose name was cut cannot be entered by either name.
- [[measured]] A file is found by its listed name, its whole name, in either case.
- [[measured]] Attributes listed: 20h a file, 10h a folder, 02h added where the record is marked hidden. 4300h adds read-only: 21h, 23h, 31h.
- [[measured]] Stamps are the record's own, the offset from GMT ignored.
- [[measured]] The label search answers the volume's name made 8.3 with a dot: `WINBOXCD.202` for `WINBOXCD2026`.
- [[measured]] Making, deleting and renaming a file answer error 2, making a folder error 3.

## Not yet done

- An ISO 9660 image as a drive in either engine, and MSCDEX's answers with it (phase 5 of the design in [[topic:drives-and-disks]]).
- MSCDEX's calls that take a buffer (1501h, 1505h, 150Dh, 150Fh, 1510h), which through Windows need DPMI's real-mode calls and memory below 1 MB.
- CUE/BIN images, their data track and then CD audio.
- A swapped disc with a file open on it.
