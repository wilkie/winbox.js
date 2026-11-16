---
kind: guide
name: The oracle beyond DOSBox
summary: A design for recording Windows 95 and OS/2 the way the oracle records Windows 3.1 — six emulators compared on what each runs, how deterministic and scriptable it is, its speed, licence and packaging, and how a probe's records would come out of it; QEMU recommended for Windows 95 and OS/2 2.x and later, DOSBox kept for Win32s, a harness sketched on record.mjs's model, what is never committed, what must be tried first, and the owner's decisions.
---

This page is a design, not built. Nothing here was installed or run for it: what it says of each emulator is from that emulator's documentation, its bug trackers and community reports, each cited and labelled. It belongs to [[guide:beyond-windows-31]], beside [[guide:win32]] and [[guide:os2]], and follows the model of [[guide:enhanced-mode]].

## What the oracle is today

The oracle runs real Windows 3.1 under DOSBox 0.74-3 (`oracle/README.md`, "The pipeline"):

1. **Media.** `fetch-windows.mjs` fetches the floppies; nothing of Windows is committed (`oracle/README.md`, "On the media").
2. **Install.** Windows' own `SETUP.EXE`, unattended, under DOSBox, into a host folder, `oracle/build/drive-c/`.
3. **Probes.** Small programs, built by Open Watcom on the host (`build-probes.mjs`).
4. **Record.** `record.mjs` starts DOSBox with the installation and the probe as Windows' shell. The probe writes its records to a file on C:, a host folder DOSBox mounts; it calls `ExitWindows`, DOS comes back and DOSBox ends. The records become `oracle/fixtures/<probe>.json`. Screens are DOSBox's own captures (`--shoot`), keys are sent by the recorder (`--then`).
5. **Determinism.** DOSBox runs at `cycles=max` for probes, and at a fixed rate where timing matters (`--cycles`, as SimTower's recordings use 80,000 a millisecond). A small probe takes about two seconds ([[guide:enhanced-mode]], "How long it takes").

What a second oracle must give, then: an installation made once from the owner's media; a probe started without a person; its records written to a file the host reads; screens and keys under the script's control; the same records on every run; and seconds, not minutes, per probe.

[[measured]] On this host (2026-11-15, Ubuntu 24.04 under WSL2), as the package list and the device show, without running anything: QEMU 8.2.2 (`qemu-system-x86`, `qemu-system-gui`) and Bochs 2.7 are installed from Ubuntu's packages; 86Box, PCem, VirtualBox and DOSBox-X are not; `/dev/kvm` exists, and the user is not in its `kvm` group. `mtools` is installed, as the oracle's drive stage already uses it.

## What each must run

| System                   | What it needs of a PC                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Win32s on Windows 3.1    | 386 enhanced mode with virtual memory ([[topic:win32s]]: `W32SYS.DLL`'s messages), which the oracle's DOSBox already runs ([[guide:enhanced-mode]])                                                                       |
| Windows 95               | A 386DX or later, an IDE disk and a CD-ROM to install from; a VGA. Its drivers' timing loops fail on fast processors (below)                                                                                              |
| OS/2 2.x, Warp 3, Warp 4 | A 386 or later, an IDE disk, and an emulator OS/2's kernel and drivers accept; the 32-bit LX loader ([[guide:os2]])                                                                                                       |
| OS/2 1.x                 | A 286 or later; 1.0 to 1.3 retail divide by zero in the keyboard driver on processors faster than a 386, and IBM's 1.0 and 1.1 reset the processor to leave protected mode, which no virtualiser does (below, VirtualBox) |

## The candidates

Labels: [[documented]] where the emulator's own documentation says it, with the address; [[inferred]] where a forum, a bug tracker or a blog says it, or where it follows from what is documented and was not tried.

| Emulator       | Windows 95                  | OS/2 2.x to Warp 4              | OS/2 1.x                  | Deterministic                                     | Scripted                                  | Records out                                | Speed                   | Licence                        | On Linux and WSL2                    |
| -------------- | --------------------------- | ------------------------------- | ------------------------- | ------------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ----------------------- | ------------------------------ | ------------------------------------ |
| **QEMU**       | yes, with care              | yes, version by version         | not known                 | **yes**: `-icount`, and record and replay         | **yes**: QMP keys, mouse, `screendump`    | serial port to a file; a disk image after  | moderate without KVM    | GPL 2                          | Ubuntu's package, installed here     |
| **DOSBox-X**   | yes, its own guide          | not yet (Warp's kernel, 2026)   | no report                 | `cycles=fixed`, as DOSBox                         | as DOSBox: the command line, its captures | a disk image after (folders become images) | fast enough             | GPL 2                          | packages and builds; no KVM needed   |
| **Bochs**      | yes, a chapter of its guide | no report                       | no report                 | **yes**: instructions per second, `sync=slowdown` | little: no control interface              | serial port to a file; port E9h            | slowest                 | LGPL                           | Ubuntu's package, installed here     |
| **86Box**      | yes                         | yes (Warp 3 guides)             | **yes**, the usual choice | no: the host's clock                              | no: a window and its menus only           | a disk image after                         | about real time at best | GPL 2 or later                 | builds; ROMs from a separate project |
| **PCem**       | yes                         | partly                          | yes (1.1 to 1.3 reported) | no                                                | no                                        | a disk image after                         | as 86Box                | GPL 2                          | last release 2020                    |
| **VirtualBox** | "limited testing"           | Warp 4.5 (MCP2) only, supported | 1.30.1 on                 | no: hardware virtualisation                       | yes: `VBoxManage controlvm`               | serial port to a file                      | fast                    | GPL 3; the extension pack PUEL | its kernel module, not under WSL2    |

### QEMU

- [[documented]] **Determinism.** `-icount shift=N` "execute[s] one instruction every 2^N ns of virtual time"; with `sleep=off` the virtual clock does not wait for the host's, and `rr=record` or `rr=replay` record and replay a run's inputs ([QEMU's manual page](https://www.qemu.org/docs/master/system/qemu-manpage.html)). Record and replay needs icount; it replays the keyboard, mouse, serial port, network and sound, and disks go through `blkreplay` ([Record/replay](https://qemu.readthedocs.io/en/master/system/replay.html)). icount turns off multi-threaded translation (same page). [[inferred]] It is translation only (TCG): KVM runs at the host's pace and is not counted, so the oracle would not use KVM, and `/dev/kvm`'s permissions do not matter.
- [[inferred]] **The project's clock.** WinBox's virtual clock is instructions at a fixed rate ([[topic:timing]]); DOSBox's `cycles=fixed` is the same idea, and `-icount` is QEMU's form of it. A Windows 95 recording on icount is the counterpart of SimTower's at 80,000 a millisecond.
- [[documented]] **Control.** QMP, QEMU's JSON control socket, has `send-key` (with a hold time), `input-send-event` (keys, the mouse's moves and buttons) and `screendump`, which writes the screen as PPM, other formats in newer versions ([qemu-qmp-ref](https://man.archlinux.org/man/qemu-qmp-ref.7.en.txt)). `-serial file:PATH` writes the guest's first serial port to a host file (manual page). `-display none` runs with no window.
- [[inferred]] **A shared folder.** `-drive file=fat:rw:DIR` (vvfat) shows a host folder as a FAT disk, but it is "use at own risk", and two reports have a guest's writes lost: sectors read back as nought ([QEMU issue 4446](https://gitlab.com/qemu-project/qemu/-/work_items/4446)) and writes the host never sees ([issue 1176](https://gitlab.com/qemu-project/qemu/-/issues/1176)). A raw FAT image read with `mtools` once QEMU has ended is safer, and the serial port safer still.
- [[inferred]] **Windows 95.** Community reports: `-cpu pentium` and the `FIX95CPU` patch at the first restart ([a guide](https://lysator.liu.se/~jonass/qemu_win95m1.html)); regressions by version, "8.1.0 is fine, 8.1.3 and later fail" ([Launchpad 1819289](https://bugs.launchpad.net/qemu/+bug/1819289)), and a setup that stops at its licence screen ([issue 2012](https://gitlab.com/qemu-project/qemu/-/issues/2012)). The host's QEMU is 8.2.2, after that regression: whether it installs Windows 95 is the first thing to try.
- [[inferred]] **OS/2.** Warp 3 broke in QEMU 2.11 ([Launchpad 1743214](https://bugs.launchpad.net/qemu/+bug/1743214)); "Warp can not be installed on 7.1.0 nor 6.2.0 but 5.2.0 works" ([qemu-discuss, 2022-12](https://lists.gnu.org/archive/html/qemu-discuss/2022-12/msg00034.html)). OS/2 1.x under QEMU: one report of "COUNTRY.SYS incorrect", nothing more found. The oracle would pin a version, as `fetch-toolchain.mjs` pins Open Watcom's build ("An oracle that changes underneath you is not an oracle", `oracle/README.md`).

### DOSBox-X

- [[documented]] **Windows 95.** Its wiki installs RTM, OSR1 and OSR2: `cputype=pentium_mmx`, `core=normal` for the install and `dynamic_x86` after (a DOS window crashes outside `normal`), up to 480 MB, the disk an image mounted with `IMGMOUNT … -ide` and booted with `BOOT C:` ([Guide: Installing Windows 95](https://dosbox-x.com/wiki/Guide:Installing-Windows-95)). The guide does not say what `cycles` to use.
- [[documented]] **Folders.** A folder mounted before booting becomes an emulated FAT disk (`boot -convertfat`), converted as Windows 95 reads it and not written back unless saved as an image (same page). [[inferred]] So a probe's records would not reach the host's folder as they do in DOSBox: a second disk image, read with `mtools` after, would carry them. Whether `serial1=file` writes a file is not documented.
- [[inferred]] **OS/2.** A build of 2026-05-22 fixed the 16-bit `LDS`/`LES` fault that stopped Warp booting, but "the OS/2 Warp kernel [is not] acceptable" yet ([retro-replay.com](https://retro-replay.com/dosbox-x-git-version-may-22-2026/)).
- [[inferred]] **What it would bring.** The harness the project already has: the same configuration file, `cycles=fixed`, the same captures. It is the cheapest second witness for Windows 95, but not for OS/2.

### Bochs

- [[documented]] **Determinism.** Its clock, `clock: sync=`, has three modes: `none`, the default, by instructions per second alone; `slowdown`, which "sacrifices performance to preserve reproducibility"; `realtime`, which gives reproducibility up. `time0` fixes the date it starts at. Serial ports can write to a file (`mode=file`), and `port_e9_hack` gives a one-instruction console: a byte written to port E9h reaches the host, with `all_rings` from ring 3 ([bochsrc](https://bochs.sourceforge.io/doc/docbook/user/bochsrc.html)).
- [[documented]] Windows 95 has a chapter of Bochs' guide ([guest-win95](https://bochs.sourceforge.io/doc/docbook/user/guest-win95.html)). Bochs 3.1 was released on 2026-08-23 ([bochs.sourceforge.io](https://bochs.sourceforge.io/)); this host has 2.7.
- [[inferred]] No control interface was found: keys by its paste, screens through its debugger or a display plugin of the project's own. It is the slowest of the six. It is the fallback where QEMU fails a system and the records matter more than the time.

### 86Box and PCem

- [[documented]] 86Box emulates period machines chip by chip, mostly on one thread, and below 100% speed the host is too slow ([README](https://github.com/86Box/86Box), [FAQ](https://86box.net/faq)). Its clock follows the host's (the real-time clock is synchronised with the host's; the PIT has fast and slow modes; [machine settings](https://86box.readthedocs.io/en/latest/settings/machine.html)). Its command line takes a machine's folder (`-P`) and a ROM folder (`-R`); the ROMs are a separate project ([ROMs](https://86box.readthedocs.io/en/stable/usage/roms.html)).
- [[inferred]] It is the usual choice for OS/2 1.x, on a 386SX or 486 machine, where the retail kernels' timing loops pass ([BetaWiki](https://betawiki.net/wiki/Draft:Recommended_VM_configurations/OS/2)); Warp 3 has install guides for it. But it is neither deterministic nor scripted: a harness would drive its window with `xdotool` and read a disk image after.
- [[inferred]] PCem's last release was v17, in 2020, and its author retired in 2021; 86Box continues it. It is not considered further.

### VirtualBox

- [[documented]] Its guest list puts DOS, Windows 3.x and Windows 95/98/ME under "limited testing", with no Guest Additions; of OS/2 "only MCP2 is supported", with hardware virtualisation required ([guest OS support](https://docs.oracle.com/en/virtualization/virtualbox/6.0/user/guestossupport.html)). `VBoxManage controlvm` takes `keyboardputscancode`, `keyboardputstring` and `screenshotpng` ([VBoxManage](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/vboxmanage.html)).
- [[inferred]] It runs on the processor, so nothing in it is counted: not deterministic. Its kernel module needs a custom kernel under WSL2 and conflicts with Hyper-V on the Windows host ([WSL issue 733](https://github.com/Microsoft/BashOnWindows/issues/733)). OS/2 1.x 1.30.1 and later install; IBM's 1.0 and 1.1 cannot, in any virtualiser, as they reset the processor to switch modes ([OS/2 Museum](http://www.os2museum.com/wp/installing-os2-1-x-in-a-virtualbox-vm/)). Not considered further.

### Windows 95 on a fast processor

- [[documented]] Microsoft's KB Q192841: timing loops in drivers' initialisation "that do not execute properly at 350 MHz and faster" stop Windows 95 on AMD K6-2 processors; `Amdk6upd.exe` fixes OSR2, 2.1 and 2.5, not the retail release ([KB 192841](https://ftp.zx.net.nz/pub/archive/ftp.microsoft.com/MISC/KB/en-us/192/841.HTM)).
- [[inferred]] `NDIS.VXD` fails similarly near 2.1 GHz, and the community's `FIX95CPU` patches both ([MSFN](https://msfn.org/board/topic/141402-windows-95-21ghz-cpu-limit-broken/?page=5)). The loops calibrate against the emulated clock, so under icount the question is the rate `shift` sets, not the host's speed: a slow enough rate might need no patch. That is to be tried. A patched Windows 95 is a different installation from the retail one, and the fixtures would say which.

### Unattended installation

- [[documented]] Windows 95's Setup takes a script: `BATCH.EXE` writes `BSETUP.INF`, renamed `MSBATCH.INF` and given to `SETUP.EXE`; `Express=1` asks nothing ([Setup script parameters](https://technet.microsoft.com/en-us/library/cc751129.aspx)). [[inferred]] That is Windows 3.1's unattended Setup again, which the oracle's install stage already uses, and it is the same in every emulator; the hardware detection may still stop or ask.

## The recommendation

1. **Win32s: DOSBox 0.74-3, as now.** Win32s is Windows 3.1 in 386 enhanced mode with Win32s installed, and the oracle records enhanced mode already ([[guide:enhanced-mode]]). Only the installation changes, a layer over the oracle's (below, "Installations").
2. **Windows 95 and OS/2 2.x and later: QEMU, translated (TCG), with `-icount shift=N,sleep=off`, a version pinned.** It is the only candidate whose determinism is documented as instruction counting, the only one with a control interface for keys, the mouse and the screen, and its serial port writes a host file. It is already installed here.
3. **DOSBox-X as the second witness for Windows 95,** where QEMU's answer is in doubt, with `cycles=fixed`.
4. **OS/2 1.x: to be tried in QEMU first; 86Box, driven by hand or by `xdotool`, only if QEMU cannot run it.** Its recordings would not be deterministic, and would be recorded as such.

## The harness

A sketch of `record.mjs`'s model on QEMU. [[inferred]] throughout; nothing of it is built.

### Installations

- **Media.** The owner's own, as Windows 3.1's are: the CD-ROM's image or floppies, kept in `oracle/.cache/` (gitignored), named by their SHA-256 in a committed list of media the scripts accept, never committed themselves.
- **Installing.** Once, by Setup with an `MSBATCH.INF` the project writes and commits (a script of answers, not Microsoft's file), into a raw disk image in `oracle/build/` (gitignored), QEMU booted from the CD's image. The image is then never written again: every recording boots it with `-snapshot`, so writes go to a temporary overlay that QEMU discards.
- **Layers.** A variant (Windows 95 with DirectX 3, with a patched timer, OS/2 Warp 4 with FixPak 15) is a qcow2 overlay over the base image (`qemu-img create -b`), made once, as the oracle's 256-colour installation is a variant of its VGA one. A variant's name is in the fixture's `host`.
- **Win32s.** An installation of Win32s over the oracle's Windows 3.1 tree, as a layer of its own (as [[topic:win32s]]'s inventory read the disc's), run with `--mode enhanced`.

### A probe's run

1. `build-probes.mjs` builds the probe: for Win32s, a PE program by Open Watcom's 386 compiler linked `system win32s`; for Windows 95, `system win95`; for OS/2 2.x, an LX program (`system os2v2`, `os2v2_pm`); for OS/2 1.x, an NE one (`system os2`, `os2_pm`). [[measured]] The toolchain the oracle already fetches holds them all, as its cache lists them: the linker's file (`binl64/wlink.lnk`) has those systems, `win32s` with the libraries "Win32s (Windows 3.x)" offers; Open Watcom's Win32 headers and import libraries (`h/nt`, 319 headers; `lib386/nt`, 126 libraries, and `lib386/nt/directx`); its OS/2 2.x ones (`h/os2`, `lib386/os2/os2386.lib`) and its OS/2 1.x ones (`h/os21x`, `lib286/os2/os2.lib`).
2. The probe and a small start script are put on a second disk, a raw FAT image of a few megabytes made by `mkfs.fat` and `mcopy`, as the drive stage makes `win31.img`.
3. **Starting it.** Windows 95 runs what `SYSTEM.INI`'s `[boot] shell=` names, as Windows 3.1 does, so the probe can be the shell, as now ([[inferred]]: to be checked on Windows 95, whose Explorer is a shell in that line). Else the probe is named in the registry's `RunOnce`, written into the overlay before booting. OS/2: `CONFIG.SYS`'s `PROTSHELL` and `RUNWORKPLACE`, or `STARTUP.CMD`.
4. **Records.** The probe writes its records to COM1, which QEMU writes to a host file (`-serial file:probe.out`); or, as now, to a file on the second disk, read with `mcopy` after QEMU ends. The serial port has two merits: records survive a guest that hangs, which the oracle's DOSBox does not give (an empty `.OUT` on a hang, the reason `record.mjs` reopens the file for each record), and the harness can read the end marker as it comes.
5. **Ending.** Windows 95 does not switch the machine off without APM; the probe's last record is an end marker, on which the harness sends QMP `quit`. A timeout in virtual time ends a probe that never writes it.
6. **Screens and keys.** At a record of the probe's (`--shoot` today) the harness sends `screendump`; keys and the mouse (`--then`) are `send-key` and `input-send-event`, at points in virtual time. The screens are compared by palette index, as DOSBox's are.
7. **The fixture.** As now: `oracle/fixtures/<system>/<probe>.json`, the system's folder as enhanced mode's is `enhanced/`, with `host` naming QEMU's version, the machine, the icount rate and the installation's variant.

### What it costs

- [[inferred]] A probe's run is QEMU's boot of the system to the probe, then the probe. Windows 95's boot under translation is tens of seconds, not DOSBox's two; a snapshot of the running system taken once at the desktop (`savevm`, and `-loadvm` for each probe) would start every probe from there. Whether a snapshot is deterministic under icount is to be tried.
- The harness: a QMP client and the image handling in `scripts/oracle/`, beside `record.mjs`, sharing its fixtures' format; the probes' logging helpers again for Win32 and OS/2.

## What is never committed

As with Windows 3.1 ([[guide:without-windows]], "Whose assets they are"; `oracle/README.md`, "On the media"): no installation medium, no installed disk image or overlay, no file of the system's own (no `KERNEL32.DLL`, no `DOSCALLS.DLL`), no snapshot (a snapshot holds the system's memory), and no screen beyond what a fixture already keeps. What is committed: the scripts, the answer files the project writes (`MSBATCH.INF`, OS/2's response file), the probes' sources, the fixtures, and the list of media by SHA-256.

## What must be tried first

Each a short trial, in this order, with its result recorded in this page:

1. QEMU 8.2.2, TCG, `-cpu pentium`, the `pc` and `isapc` machines: does Windows 95 (retail and OSR2) install from an `MSBATCH.INF`, and boot, with and without `FIX95CPU`, at two icount rates?
2. Two runs of the same probe with `-icount shift=N,sleep=off`, no record and replay: byte-identical `.OUT` and screens? And after `-loadvm` of a snapshot?
3. Does a probe named as `shell=` start in place of Explorer?
4. OS/2 Warp 3 and Warp 4 under QEMU 8.2.2; if not, under the last version reported to work (5.2.0), built to a pinned tag.
5. OS/2 1.3 under QEMU and Bochs: the `COUNTRY.SYS` report, and the keyboard driver's division by zero.
6. DOSBox-X: Windows 95 with `cycles=fixed`, and whether `serial1=file` writes a file.
7. Bochs 2.7, `sync=slowdown`: Windows 95's install time.
8. Win32s 1.25 in the oracle's DOSBox: does `32SINST.MST`'s check for `SHARE.EXE` pass under DOSBox ([[topic:win32s]])?

## The owner's decisions

1. **The emulator.** QEMU for Windows 95 and OS/2 2.x and later, DOSBox-X as a second witness, or another choice.
2. **The media.** Which releases are the reference: Windows 95 retail (4.00.950) or OSR2 (4.00.950B, FAT32, the later USER and GDI), with or without DirectX; OS/2 2.1, Warp 3 or Warp 4, and which FixPak. The owner's own copies, as for Windows 3.1.
3. **A patched Windows 95.** If the timer's loops fail at every icount rate tried, is a recording made with `FIX95CPU` a reference?
4. **OS/2 1.x without determinism.** If only 86Box runs it, are its recordings accepted, marked as not reproducible?
5. **Where fixtures go.** `oracle/fixtures/win95/` and `oracle/fixtures/os2/`, as `enhanced/` is, or a tree of their own.

## Not yet done

Everything: no emulator was run for this page, and each claim about one is its documentation's or a report's. The trials above come first.
