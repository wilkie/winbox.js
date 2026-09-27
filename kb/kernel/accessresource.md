---
kind: function
module: KERNEL
name: AccessResource
ordinal: 64
summary: Opens a new handle on the file a resource is in, with the pointer at the resource's first byte.
versions:
  '3.1': exact
probes: [accres]
source: src/win16/kernel/AccessResource.ts
---

## Observed behaviour

[[probe:accres]] finds four resources of its own, raw data of 1, 17 and 300 bytes and one found by name, and reads each from the handle. winbox.js agrees with all of its records.

- [[measured]] The pointer is left at the resource's offset in the module's resource table, in bytes: the table's value shifted by the table's alignment. The bytes read there are the ones [[fn:KERNEL.LockResource]] gives for the same resource.
- [[measured]] Each call opens the file again: two calls for one resource give two different handles, and each has to be closed.
- [[measured]] Reading past the resource reads on in the file. The last resource of the probe's program ends the file, and a read of 8 bytes there gives the 6 that are left.

## Nuances

- [[measured]] Windows Help calls it once as it starts, to check that it can reach its resources, and closes the handle straight away. While this was a stub, Help closed handle 0, which it had never opened.
- Not yet measured: a resource of a module other than the caller's, a handle that is not a resource, and the mode the file is opened in.
