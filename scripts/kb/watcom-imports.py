#!/usr/bin/env python3
"""
Counts the functions Open Watcom's import libraries name, by the module that
exports them: a measure of an API's size that needs no file of the system's
own. Used by kb/guides/win32.md and kb/guides/os2.md.

    python3 -I scripts/kb/watcom-imports.py oracle/.cache/watcom/lib286/os2/os2.lib ...

An import library is an OMF library (the toolchain fetch-toolchain.mjs keeps);
each import is a COMENT record (88h) of class A0h, subtype 01h (IMPDEF): a
flag byte (ordinal or name), the internal name, the module's name, then the
entry's name or ordinal. Prints, for each library, the count of distinct
entries by module, as JSON. Names nothing but modules and counts.
"""
import json
import struct
import sys


def counted(b, o):
    n = b[o]
    return b[o + 1:o + 1 + n].decode('latin-1'), o + 1 + n


def imports(path):
    data = open(path, 'rb').read()
    modules = {}
    o = 0
    # Records: a type byte, a 16-bit length, the body (with a checksum last).
    # The library's header (F0h) and dictionary are skipped by their lengths;
    # records past the end marker (F1h) are the dictionary, not read.
    while o + 3 <= len(data):
        kind = data[o]
        length = struct.unpack_from('<H', data, o + 1)[0]
        body = data[o + 3:o + 3 + length]
        if kind == 0xF0:
            # The header's length is the page size less three.
            page = length + 3
            o += page
            continue
        if kind == 0xF1:
            break
        if kind == 0x88 and len(body) > 4 and body[1] == 0xA0 and body[2] == 0x01:
            p = 3
            by_ordinal = body[p]
            p += 1
            internal, p = counted(body, p)
            module, p = counted(body, p)
            if by_ordinal:
                entry = '#%d' % struct.unpack_from('<H', body, p)[0]
            else:
                entry, p = counted(body, p)
                entry = entry or internal
            modules.setdefault(module.upper(), set()).add(entry.upper())
        o += 3 + length
        if kind == 0x8A or kind == 0x8B:
            # A module ends; the next starts on the library's page boundary.
            o = (o + page - 1) // page * page
    return {module: len(entries) for module, entries in sorted(modules.items())}


print(json.dumps({path: imports(path) for path in sys.argv[1:]}, indent=1))
