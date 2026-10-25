#!/usr/bin/env python3
"""
Expand Win32s' disks for scripts/kb/win32s-inventory.py.

    python3 -I scripts/kb/win32s-expand.py WIN32S_DIR OUT_DIR

WIN32S_DIR holds DISK1 and DISK2 as the disc carries them; OUT_DIR is a new
folder the expanded files go to (never inside the repository: they are
Microsoft's files). A file COMPRESS made (kb/formats/szdd.md) is expanded and
named as 32SINST.INF names it, the last letter given back; a plain file is
copied.
"""
import os
import struct
import sys


def szdd(b):
    assert b[:4] == b'SZDD' and b[8] == 0x41
    size = struct.unpack_from('<I', b, 10)[0]
    ring = bytearray(b' ' * 4096)
    rp = 4096 - 16
    out = bytearray()
    i = 14
    while len(out) < size and i < len(b):
        c = b[i]
        i += 1
        for k in range(8):
            if len(out) >= size or i >= len(b):
                break
            if c >> k & 1:
                v = b[i]
                i += 1
                out.append(v)
                ring[rp] = v
                rp = (rp + 1) & 4095
            else:
                b1, b2 = b[i], b[i + 1]
                i += 2
                pos = b1 | ((b2 & 0xF0) << 4)
                for j in range((b2 & 15) + 3):
                    v = ring[(pos + j) & 4095]
                    out.append(v)
                    ring[rp] = v
                    rp = (rp + 1) & 4095
    return bytes(out[:size])


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=False)
    names = set()
    for line in open(src + '/DISK1/32SINST.INF', encoding='latin-1'):
        line = line.split("=", 1)[1] if line.lstrip().startswith(chr(34)) and "=" in line else line
        parts = line.strip().split(",")
        if len(parts) > 2 and parts[0].strip().isdigit():
            names.add(parts[1].strip().upper())
    for d in ('DISK1', 'DISK2'):
        for f in sorted(os.listdir(src + '/' + d)):
            b = open(src + '/' + d + '/' + f, 'rb').read()
            name = f
            if b[:4] == b'SZDD':
                b = szdd(b)
                stem, ext = f.rsplit('.', 1)
                for n in names:
                    s, _, e = n.rpartition('.')
                    if s == stem and e.startswith(ext.rstrip('_')) and len(e) == len(ext):
                        name = n
                        break
            open(dst + '/' + name, 'wb').write(b)
            print(d, f, '->', name, len(b))


if __name__ == '__main__':
    main()
