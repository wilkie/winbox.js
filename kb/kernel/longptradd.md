---
kind: function
module: KERNEL
name: LONGPTRADD
ordinal: 180
summary: A far pointer moved on by a number of bytes, by moving its selector's base: the same selector, the offset's last four bits.
versions:
  '3.1': exact
probes: [kmore]
records: [longptr]
source: crates/winbox-win16/src/kernel_calls/more.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `26b9`-`2722`. The selector's descriptor is read; its base is moved on by the offset's paragraphs (the offset less its last four bits) and by the number; a number of 16 MiB or more (its high word's high byte not nought) is refused, nought in DX:AX, and nothing is changed. `LSL` gives how many selectors the limit reaches, one a 64 KiB, or one where it gives nothing. Each of them is written from the first's descriptor (`2223`-`2251`): the next a 64 KiB further on and with a limit 64 KiB less (sixteen pages less where the limit counts pages). The answer is the selector in DX and the offset's last four bits in AX.
- [[measured]] [[probe:kmore]]: offset 1234h moved on 10h answers offset 4 and the same selector, the base 1240h further on and the limit as it was; 1000000h answers nought and leaves the base; a block of 20000h moved on 100h moves both of its selectors' bases 100h, their limits 1FFFFh and FFFFh.

## Implementation

`crates/winbox-win16/src/kernel_calls/more.rs`.
