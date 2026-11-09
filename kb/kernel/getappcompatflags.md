---
kind: function
module: KERNEL
name: GetAppCompatFlags
ordinal: 354
summary: A task's compatibility flags: nought for a program made for Windows 3.1, else what WIN.INI's [Compatibility] gives its module.
versions:
  '3.1': exact
probes: [ktask]
records: [module]
source: crates/winbox-win16/src/kernel_calls/tasks.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `9eeb`-`9f0e`: the double word at 4Eh of the task's database, the running task's for nought. It is nought with no task.
- [[read out]] seg2 `2a38`-`2ab6`, as KERNEL makes the task: nought where the module was made for Windows 3.10 or later. Otherwise KERNEL looks up the entry `[Compatibility]` gives eight bytes of the module's name, reading eleven characters at most. The entry must start `0x` or `0X`, and each character after is a hexadecimal digit until one comes below `0`.
- [[measured]] [[probe:ktask]]: nought for the probe. It is made for 3.0, but the installation's `WIN.INI` names no `KTASK`.

## Implementation

KERNEL reads the flags as it makes the task. winbox.js reads them the first time they are asked for, from `WIN.INI` as it is then.
