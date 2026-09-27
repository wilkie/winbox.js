---
kind: function
module: KERNEL
name: SizeofResource
ordinal: 65
summary: Answers a resource's size as its module's resource table gives it, rounded up to the table's alignment.
versions:
  '3.1': exact
probes: [accres]
source: src/win16/kernel/AccessResource.ts
---

## Observed behaviour

- [[measured]] The size is the resource table's length shifted by its alignment, not the resource's own length. [[probe:accres]]'s program is aligned to 2 bytes, and its resources of 1, 17 and 5 bytes are 2, 18 and 6; 300 is 300. The resource compiler writes raw data without a nought of its own, as the 300, four strings together, shows.
- [[measured]] winbox.js reads the same table and agrees with all four sizes, and with the fifth record, a resource the program does not have.
