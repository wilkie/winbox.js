/*
 * The program's own module database, as KERNEL lays it out in memory from
 * the file's header (`KRNL386.EXE` seg2 `0d66`): read through the module's
 * handle, which is its selector.
 *
 * * `header`: each word of the first 40h bytes, by its offset, in
 *   hexadecimal -- the file's own, some rewritten, and the tables' offsets
 *   in memory; but word 6:
 * * `next`: word 6, the next module's handle in KERNEL's list, `next` or
 *   `none`.
 * * `segment`: each entry of the segment table, by its number: its sector,
 *   its length, its flags and its minimum allocation in hexadecimal, then
 *   how its handle stands to the program's selectors -- `cs`, `cs-1`,
 *   `ds` or `ds-1`, `none` for nought, or the handle in hexadecimal.
 * * `names`: the resident names table's bytes in hexadecimal, from its
 *   offset to the module references'.
 * * `reference`: each word of the module references, by its index, with the
 *   name the imported names table gives it, and whether it is
 *   `GetModuleHandle`'s answer for that name.
 * * `imported`: the imported names table's first bytes in hexadecimal.
 * * `bundle`: each bundle of the entry table in memory, by its offset from
 *   the table's start: its three words and its entries' bytes, in
 *   hexadecimal.
 * * `fileinfo`: the first four bytes at word 0Ah's offset, in hexadecimal,
 *   the first less the length of the path that follows the eight (the next
 *   four are the file's date and time, the host's); then the path's file
 *   name, the folder it ran from being the recorder's.
 * * `size`: `GlobalSize` of the module's handle, in hexadecimal.
 *
 * `First` and `Second` are exported so the entry table has entries.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MODDB.OUT"

int FAR PASCAL _export First(int value)
{
    return value + 1;
}

int FAR PASCAL _export Second(int value)
{
    return value + 2;
}

static WORD at(HMODULE module, WORD offset)
{
    return *(WORD FAR *)MAKELP(module, offset);
}

static BYTE byteAt(HMODULE module, WORD offset)
{
    return *(BYTE FAR *)MAKELP(module, offset);
}

static void hexBytes(LPSTR out, HMODULE module, WORD from, WORD count)
{
    WORD i;

    out[0] = '\0';

    for (i = 0; i < count; i++) {
        wsprintf(out + lstrlen(out), i ? " %02x" : "%02x", byteAt(module, from + i));
    }
}

static void handleRelation(LPSTR out, WORD handle, WORD code, WORD data)
{
    if (handle == 0) {
        lstrcpy(out, "none");
    } else if (handle == code) {
        lstrcpy(out, "cs");
    } else if (handle + 1 == code) {
        lstrcpy(out, "cs-1");
    } else if (handle == data) {
        lstrcpy(out, "ds");
    } else if (handle + 1 == data) {
        lstrcpy(out, "ds-1");
    } else {
        wsprintf(out, "%x", handle);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE module;
    WORD offset;
    WORD count;
    WORD i;
    WORD code;
    WORD data;
    WORD table;
    WORD bundle;
    WORD guard;
    char relation[32];
    char name[32];

    probeOpen(OUTPUT);

    _asm {
        mov ax, cs
        mov code, ax
        mov ax, ds
        mov data, ax
    }

    module = GetModuleHandle("MODDB");

    for (offset = 0; offset < 0x40; offset += 2) {
        wsprintf(probeArgs, "%02x", offset);
        /* Word 6 is the next module's handle in KERNEL's list: whether
         * there is one, a record of its own. */
        if (offset == 0x06) {
            probe("next", "", at(module, offset) ? "next" : "none");
            continue;
        }

        wsprintf(probeResult, "%04x", at(module, offset));
        probe("header", probeArgs, probeResult);
    }

    table = at(module, 0x22);
    count = at(module, 0x1c);

    for (i = 0; i < count; i++) {
        WORD entry = table + i * 10;

        handleRelation(relation, at(module, entry + 8), code, data);
        wsprintf(probeArgs, "%d", i + 1);
        wsprintf(probeResult, "%04x %04x %04x %04x %s", at(module, entry), at(module, entry + 2),
                 at(module, entry + 4), at(module, entry + 6), relation);
        probe("segment", probeArgs, probeResult);
    }

    hexBytes(probeResult, module, at(module, 0x26), at(module, 0x28) - at(module, 0x26));
    probe("names", "", probeResult);

    for (i = 0; i < at(module, 0x1e); i++) {
        WORD handle = at(module, at(module, 0x28) + i * 2);
        BYTE length;

        /* The imported names, after their table's first byte, in the
         * module references' order. */
        name[0] = '\0';

        {
            WORD walk = at(module, 0x2a) + 1;
            WORD n;

            for (n = 0; n < i; n++) {
                walk += byteAt(module, walk) + 1;
            }

            length = byteAt(module, walk);

            for (n = 0; n < length && n < sizeof(name) - 1; n++) {
                name[n] = byteAt(module, walk + 1 + n);
            }

            name[n] = '\0';
        }

        wsprintf(probeArgs, "%d %s", i, (LPSTR)name);
        wsprintf(probeResult, "%s", handle == (WORD)GetModuleHandle(name) ? (LPSTR)"same" : (LPSTR)"other");
        probe("reference", probeArgs, probeResult);
    }

    hexBytes(probeResult, module, at(module, 0x2a), 16);
    probe("imported", "", probeResult);

    bundle = at(module, 0x04);

    for (guard = 0; bundle && guard < 16; guard++) {
        WORD first = at(module, bundle);
        WORD last = at(module, bundle + 2);
        WORD next = at(module, bundle + 4);

        wsprintf(probeArgs, "%x", bundle - at(module, 0x04));
        wsprintf(probeResult, "%04x %04x %s ", first, last, next ? (LPSTR)"next" : (LPSTR)"end");
        hexBytes(probeResult + lstrlen(probeResult), module, bundle + 6, (last - first) * 5);
        probe("bundle", probeArgs, probeResult);
        bundle = next;
    }

    if (at(module, 0x0a)) {
        WORD info = at(module, 0x0a);
        WORD length = 0;
        WORD last = 0;

        for (i = 0; i < 128 && byteAt(module, info + 8 + i); i++) {
            if (byteAt(module, info + 8 + i) == '\\') {
                last = i + 1;
            }

            length++;
        }

        /* The first byte less the path's length; the path's file name. */
        wsprintf(probeResult, "%02x ", byteAt(module, info) - length);
        hexBytes(probeResult + 3, module, info + 1, 3);
        lstrcat(probeResult, " ");

        for (i = last; i < length; i++) {
            name[0] = byteAt(module, info + 8 + i);
            name[1] = '\0';
            lstrcat(probeResult, name);
        }

        probe("fileinfo", "", probeResult);
    } else {
        probe("fileinfo", "", "none");
    }

    wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)module));
    probe("size", "", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    (void)First;
    (void)Second;
    return 0;
}
