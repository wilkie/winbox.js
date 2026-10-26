#!/usr/bin/env python3
"""
Win32s inventory: what Widget Workshop's 32-bit files import, and what Win32s
1.25 is made of.

Reads nothing but the directories given on its command line and writes the JSON
to stdout. Nothing of the disc is copied into the output but names, ordinals,
sizes and counts.

    python3 -I scripts/kb/win32s-inventory.py WWDISC WIN32S_EXPANDED > out.json

WWDISC          the disc's WIN31 folder, as extracted (it holds WIDGET, WING,
                COMDLL, WIN32S/DISK1 and DISK2)
WIN32S_EXPANDED a folder holding Win32s' compressed files expanded (SZDD, the
                format kb/formats/szdd.md describes), each under the name
                32SINST.INF names, with the last letter given back
                (WIN32S16.DLL, W32S.386...). scripts/kb/win32s-expand.py
                makes it.

Then `npx tsx scripts/kb/win32s-coverage.ts out.json` adds which of the Win16
functions the 16-bit modules need WinBox already has.
"""
import json
import os
import struct
import sys


def u16(b, o):
    return struct.unpack_from('<H', b, o)[0]


def u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def cstr(b, o):
    e = b.index(b'\0', o)
    return b[o:e].decode('latin-1')


# ---------------------------------------------------------------- PE ------


def parse_pe(b, pe):
    machine, nsec = struct.unpack_from('<HH', b, pe + 4)
    optsize = u16(b, pe + 20)
    chars = u16(b, pe + 22)
    opt = pe + 24
    magic = u16(b, opt)
    sub = u16(b, opt + 68)
    osv = [u16(b, opt + 40), u16(b, opt + 42)]
    ssv = [u16(b, opt + 48), u16(b, opt + 50)]
    exp_rva, exp_size = struct.unpack_from('<II', b, opt + 96)
    imp_rva, _ = struct.unpack_from('<II', b, opt + 96 + 8)
    secs = [struct.unpack_from('<8sIIII', b, opt + optsize + 40 * i) for i in range(nsec)]

    def off(r):
        for n, vs, va, rs, ro in secs:
            if va <= r < va + max(vs, rs):
                return r - va + ro
        return None

    info = {
        'format': 'PE',
        'machine': hex(machine),
        'dll': bool(chars & 0x2000),
        'subsystem': sub,
        'osVersion': osv,
        'subsystemVersion': ssv,
        'sections': [s[0].rstrip(b'\0').decode('latin-1') for s in secs],
    }
    imports = {}
    o = off(imp_rva) if imp_rva else None
    while o is not None:
        ilt, ts, fc, name, iat = struct.unpack_from('<IIIII', b, o)
        if name == 0:
            break
        dll = cstr(b, off(name))
        t = off(ilt or iat)
        lst = []
        while t is not None:
            v = u32(b, t)
            if v == 0:
                break
            if v & 0x80000000:
                lst.append({'ordinal': v & 0xFFFF})
            else:
                ho = off(v)
                lst.append({'hint': u16(b, ho), 'name': cstr(b, ho + 2)})
            t += 4
        imports[dll.upper()] = lst
        o += 20
    info['imports'] = imports
    exports = []
    if exp_rva:
        o = off(exp_rva)
        (_, _, _, _, nameRva, base, nfunc, nnames, aof, aon, aoo) = struct.unpack_from('<IIHHIIIIIII', b, o)
        info['exportName'] = cstr(b, off(nameRva))
        funcs = off(aof)
        names = off(aon)
        ords = off(aoo)
        byord = {}
        for i in range(nnames):
            nm = cstr(b, off(u32(b, names + 4 * i)))
            byord[u16(b, ords + 2 * i)] = nm
        for i in range(nfunc):
            rva = u32(b, funcs + 4 * i)
            if rva == 0:
                continue
            e = {'ordinal': base + i}
            if i in byord:
                e['name'] = byord[i]
            if exp_rva <= rva < exp_rva + exp_size:
                e['forward'] = cstr(b, off(rva))
            exports.append(e)
    info['exports'] = exports
    return info


# ---------------------------------------------------------------- NE ------


def parse_ne(b, ne):
    flags = u16(b, ne + 0x0C)
    entry_off = u16(b, ne + 4)
    entry_len = u16(b, ne + 6)
    nseg = u16(b, ne + 0x1C)
    nmod = u16(b, ne + 0x1E)
    segtab = ne + u16(b, ne + 0x22)
    resnames = ne + u16(b, ne + 0x26)
    modtab = ne + u16(b, ne + 0x28)
    impnames = ne + u16(b, ne + 0x2A)
    nonres = u32(b, ne + 0x2C)
    nonres_len = u16(b, ne + 0x20)
    shift = u16(b, ne + 0x32)
    target = b[ne + 0x36]
    mods = []
    for i in range(nmod):
        no = u16(b, modtab + 2 * i)
        n = b[impnames + no]
        mods.append(b[impnames + no + 1:impnames + no + 1 + n].decode('latin-1').upper())

    names = {}
    modname = None

    def table(o, end=None):
        nonlocal modname
        first = True
        while True:
            n = b[o]
            if n == 0:
                break
            nm = b[o + 1:o + 1 + n].decode('latin-1')
            ordv = u16(b, o + 1 + n)
            o += n + 3
            if first and end is None:
                modname = nm
                first = False
                continue
            first = False
            if ordv:
                names[ordv] = nm
    table(resnames)
    desc = None
    if nonres_len:
        n = b[nonres]
        desc = b[nonres + 1:nonres + 1 + n].decode('latin-1')
        o = nonres + 1 + n + 2
        while True:
            n = b[o]
            if n == 0:
                break
            nm = b[o + 1:o + 1 + n].decode('latin-1')
            ordv = u16(b, o + 1 + n)
            o += n + 3
            if ordv:
                names[ordv] = nm

    # entry table: which ordinals exist, in which segment, exported or not
    entries = {}
    o = ne + entry_off
    end = o + entry_len
    ordn = 1
    while o < end:
        cnt = b[o]
        ind = b[o + 1]
        o += 2
        if cnt == 0:
            break
        if ind == 0:
            ordn += cnt
            continue
        for _ in range(cnt):
            if ind == 0xFF:
                fl = b[o]
                seg = b[o + 3]
                off_ = u16(b, o + 4)
                o += 6
            else:
                fl = b[o]
                seg = ind
                off_ = u16(b, o + 1)
                o += 3
            entries[ordn] = {'segment': seg, 'offset': off_, 'exported': bool(fl & 1)}
            ordn += 1
    exports = []
    for ordv in sorted(set(entries) | set(names)):
        e = {'ordinal': ordv}
        if ordv in names:
            e['name'] = names[ordv]
        if ordv in entries:
            e.update(entries[ordv])
        exports.append(e)

    # imports: the relocations of every segment
    imports = {}
    segs = []
    for i in range(nseg):
        so, sl, sf, sm = struct.unpack_from('<HHHH', b, segtab + 8 * i)
        segs.append((so, sl, sf))
        if not (sf & 0x100) or so == 0:
            continue
        data_off = so << shift
        data_len = sl if sl else 0x10000
        if sf & 0x1 == 0 and False:
            pass
        ro = data_off + data_len
        nrel = u16(b, ro)
        ro += 2
        for _ in range(nrel):
            at, rt, offs, a, c = struct.unpack_from('<BBHHH', b, ro)
            ro += 8
            kind = rt & 3
            if kind == 1:
                m = mods[a - 1]
                imports.setdefault(m, {})[('o', c)] = True
            elif kind == 2:
                m = mods[a - 1]
                no = impnames + c
                n = b[no]
                nm = b[no + 1:no + 1 + n].decode('latin-1')
                imports.setdefault(m, {})[('n', nm)] = True
    outimp = {}
    for m, d in imports.items():
        lst = []
        for (k, v) in d:
            lst.append({'ordinal': v} if k == 'o' else {'name': v})
        lst.sort(key=lambda x: (x.get('ordinal', 0), x.get('name', '')))
        outimp[m] = lst
    return {
        'format': 'NE',
        'moduleName': modname,
        'description': desc,
        'dll': bool(flags & 0x8000),
        'targetOs': target,
        'segments': nseg,
        'moduleReferences': mods,
        'imports': outimp,
        'exports': exports,
    }


# ---------------------------------------------------------------- LE ------


def parse_le(b, le):
    sig = b[le:le + 2].decode('latin-1')
    cpu = u16(b, le + 8)
    os_ = u16(b, le + 10)
    mflags = u32(b, le + 0x10)
    npages = u32(b, le + 0x14)
    nobj = u32(b, le + 0x44)
    info = {
        'format': sig,
        'cpu': cpu,
        'os': os_,
        'moduleFlags': hex(mflags),
        'pages': npages,
        'objects': nobj,
    }
    # the VxD's device descriptor block begins with 'DDB' fields; its name is
    # 8 bytes at offset 12 of the block. It is found by the entry the module
    # header names (object 1 : offset), if the object table says so.
    objtab = le + u32(b, le + 0x40)
    pagemap = le + u32(b, le + 0x48)
    datapages = u32(b, le + 0x80)
    pagesize = u32(b, le + 0x28)
    shift_last = u32(b, le + 0x2C)
    eip_obj = u32(b, le + 0x18)
    eip = u32(b, le + 0x1C)
    objs = []
    for i in range(nobj):
        vs, base, fl, pmi, pmc, _ = struct.unpack_from('<IIIIII', b, objtab + 24 * i)
        objs.append({'size': vs, 'flags': hex(fl), 'firstPage': pmi, 'pages': pmc})
    info['objectTable'] = objs
    info['entry'] = {'object': eip_obj, 'offset': eip}
    return info


def classify(path):
    b = open(path, 'rb').read()
    info = {'size': len(b)}
    if b[:2] != b'MZ':
        info['format'] = 'data'
        return info
    if len(b) < 0x40:
        info['format'] = 'DOS MZ'
        return info
    lfa = u32(b, 0x3C)
    if lfa + 4 > len(b) or lfa < 0x40:
        info['format'] = 'DOS MZ'
        return info
    sig = b[lfa:lfa + 2]
    if b[lfa:lfa + 4] == b'PE\0\0':
        info.update(parse_pe(b, lfa))
    elif sig == b'NE':
        info.update(parse_ne(b, lfa))
    elif sig in (b'LE', b'LX'):
        info.update(parse_le(b, lfa))
    else:
        info['format'] = 'DOS MZ'
    return info


def parse_inf(path):
    section = None
    listed = []
    for line in open(path, encoding='latin-1').read().splitlines():
        line = line.strip()
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
            continue
        if section in ('WindowsSystemWin32s', 'WindowsSystem', 'Win32appFreecell', 'Files',
                       'Win32sSystemObsoleteFiles') and line and not line.startswith(';'):
            if line.startswith('"'):
                line = line.split('=', 1)[1].strip()
            parts = [x.strip() for x in line.split(',')]
            listed.append({'section': section, 'disk': int(parts[0]), 'name': parts[1],
                           'date': parts[5], 'size': int(parts[15]) if parts[15] else 0,
                           'version': parts[-2] if len(parts) > 2 else ''})
    return listed


# The 32-bit DLLs Win32s answers from W32SCOMB.DLL: the files the install list
# removes from the system folder (Win32sSystemObsoleteFiles) and W32SCOMB.DLL
# exports under their names.
COMBINED = ('KERNEL32.DLL', 'USER32.DLL', 'GDI32.DLL', 'ADVAPI32.DLL', 'NTDLL.DLL', 'MPR.DLL')



def resolve(pe_files, imports_of, provider_exports):
    """For each import list of one PE file, which file exports it."""
    res = {}
    for dll, lst in imports_of.items():
        prov = None
        if dll in COMBINED:
            prov = 'W32SCOMB.DLL'
        elif dll in provider_exports:
            prov = dll
        else:
            res[dll] = {'provider': None, 'count': len(lst), 'resolved': 0,
                        'unresolved': [x.get('name', '#%d' % x.get('ordinal', 0)) for x in lst]}
            continue
        ex = provider_exports[prov]
        miss = []
        for x in lst:
            if 'name' in x:
                ok = x['name'] in ex['names']
            else:
                ok = x['ordinal'] in ex['ordinals']
            if not ok:
                miss.append(x.get('name', '#%d' % x.get('ordinal', 0)))
        res[dll] = {'provider': prov, 'count': len(lst), 'resolved': len(lst) - len(miss),
                    'unresolved': miss}
    return res


def main():
    ww, expanded = sys.argv[1], sys.argv[2]
    extras = sys.argv[3:]
    out = {'generated': 'scripts/kb/win32s-inventory.py', 'widget': {}, 'win32s': {}}

    # Widget Workshop's disc: every EXE/DLL/DRV/386 of the WIN31 folder but Win32s'
    for root, dirs, files in os.walk(ww):
        dirs.sort()
        rel = os.path.relpath(root, ww).replace(os.sep, '/')
        if rel.startswith('WIN32S'):
            continue
        for f in sorted(files):
            ext = f.rsplit('.', 1)[-1].upper() if '.' in f else ''
            if ext not in ('EXE', 'DLL', 'DRV', '386'):
                continue
            key = f if rel == '.' else rel + '/' + f
            out['widget'][key] = classify(os.path.join(root, f))
    for p in extras:
        out['widget']['(extra) ' + os.path.basename(p)] = classify(p)
    # the 16-bit and DOS files on the disc are listed by format and the counts of their
    # imports and exports; the 32-bit ones in full
    for k, i in out['widget'].items():
        if i.get('format') != 'PE':
            if 'imports' in i:
                i['imports'] = {m: len(l) for m, l in i['imports'].items()}
            if 'exports' in i:
                i['exportCount'] = len(i.pop('exports'))

    out['win32s']['installLists'] = parse_inf(os.path.join(ww, 'WIN32S/DISK1/32SINST.INF'))
    files = {}
    for f in sorted(os.listdir(expanded)):
        if f.upper().endswith(('.NLS', '.INC', '.HLP', '.MST', '.LST', '.INF')):
            files[f] = {'size': os.path.getsize(os.path.join(expanded, f)), 'format': 'data'}
        else:
            files[f] = classify(os.path.join(expanded, f))
    out['win32s']['files'] = files

    # exports of every PE file that can answer an import
    provider_exports = {}

    def add_provider(name, info):
        provider_exports[name.upper()] = {
            'names': set(e['name'] for e in info['exports'] if 'name' in e),
            'ordinals': set(e['ordinal'] for e in info['exports'])}
    for n, i in files.items():
        if i.get('format') == 'PE' and i.get('dll'):
            add_provider(n, i)
    for k, i in out['widget'].items():
        if i.get('format') == 'PE' and i.get('dll'):
            add_provider(os.path.basename(k), i)

    # Widget Workshop's 32-bit files: imports resolved
    pe32 = [k for k, i in out['widget'].items() if i.get('format') == 'PE']
    out['widgetCrossReference'] = {}
    for k in pe32:
        i = out['widget'][k]
        out['widgetCrossReference'][k] = resolve(pe32, i['imports'], provider_exports)
    # the Win32s DLLs' own imports, resolved the same way
    out['win32sCrossReference'] = {}
    for n, i in files.items():
        if i.get('format') == 'PE' and i['imports']:
            out['win32sCrossReference'][n] = resolve(pe32, i['imports'], provider_exports)

    # DLL names the five files carry as text (a LoadLibrary's argument leaves them there)
    names = set()
    for n in list(files) + [os.path.basename(k) for k in out['widget']]:
        if n.upper().endswith(('.DLL', '.DRV')):
            names.add(n.upper())
    out['namedInTheFiles'] = {}
    for root, dirs, fs in os.walk(ww):
        for f in fs:
            key = f if os.path.relpath(root, ww) == '.' else os.path.relpath(root, ww).replace(os.sep, '/') + '/' + f
            if key in pe32:
                data = open(os.path.join(root, f), 'rb').read().upper()
                found = sorted(n for n in names if n.encode() in data and n != f.upper())
                out['namedInTheFiles'][key] = found
                mfc = sorted(set(w.decode() for w in
                                 __import__('re').findall(rb'(?:MFC|MSVCRT|MSVCR|CRTDLL)[0-9A-Z_]*\.DLL', data)))
                if mfc:
                    out['namedInTheFiles'][key + ' (MFC/CRT dll names)'] = mfc

    def default(o):
        if isinstance(o, set):
            return sorted(o)
        raise TypeError
    json.dump(out, sys.stdout, indent=1, default=default)


if __name__ == '__main__':
    main()
