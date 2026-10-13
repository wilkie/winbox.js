---
kind: function
module: USER
name: DumpIcon
ordinal: 459
summary: Where a locked icon's mask and picture are, and their sizes — how Program Manager copies an icon's bits into its group file.
versions:
  '3.1': exact
probes: [associco]
source: src/win16/user/icon-api.ts
---

## Observed behaviour

[[probe:associco]] calls it on icons from [[fn:SHELL.ExtractAssociatedIcon]], `ExtractIcon` and [[fn:USER.LoadIcon]], each locked with `LockResource`, and once with a null icon. All of its records agree on winbox.js.

- [[measured]] It writes 12, the size of the icon's header, to the count it is given.
- [[measured]] The mask starts 12 bytes into the lock and the picture follows it. For a 32-by-32 icon on the VGA, the picture starts at 140.
- [[measured]] The answer's low word is the mask's size and its high word the picture's: 128 and 512 on the VGA, where the header says four bytes a mask row, four planes and one bit a pixel.
- [[measured]] A null icon answers nought. The header's size is still written, and the two addresses are left alone.

## Nuances

- [[read out]] The sizes come from the header alone. The mask is the height times the bytes a row stored at `+8`. Each picture row is the width times the bits a pixel, rounded up to a whole word, then multiplied by the planes and the height. Each product is kept to 16 bits.
- [[read out]] Nothing checks that the address is an icon's.

## Inside Windows

[[read out]] `USER.EXE` seg12 `01bb`. The arguments are the icon, the count, then the two addresses to fill: the mask's first, then the picture's. It writes 12 to the count first (`01ca`). With a null icon it answers nought (`01d9`). Otherwise it reads the header's width, height, bytes a row, planes and bits (`01e3`-`0212`), writes the two addresses (`0215`-`022f`), and answers the two sizes.

## Implementation

`DumpIcon` in `src/win16/user/icon-api.ts` and `dump_icon` in `crates/winbox-win16/src/icons.rs`. The engines keep an icon in the same block layout as USER (`icon-block.ts`).
