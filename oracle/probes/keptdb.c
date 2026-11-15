/*
 * The module databases of Windows' own modules, the ones WinBox keeps with
 * no file (`crates/winbox-win16/src/kept.rs`), as KERNEL lays them out in
 * memory: read through each module's handle, which is its database's
 * selector, as `moddb` reads the probe's own.
 *
 * Self-loading programs read them: a sound mixer built into 69 of the
 * compatibility catalog's programs reads word 1Ch of MMSYSTEM's database
 * and of the wave driver's, and asks `GetCodeHandle` for each segment by
 * the module's handle and its number, to page-lock it.
 *
 * Each record's arguments start with the module's name.
 *
 * * `handle`: whether `GetModuleHandle` finds the module, `loaded` or `none`.
 * * One record for each of the header's words, by what it is: `sig` (word
 *   0), `usage` (2), `flags` (0Ch), `autodata` (0Eh), `heap` (10h), `stack`
 *   (12h), `csip` (16h:14h), `sssp` (1Ah:18h), `segcount` (1Ch),
 *   `refcount` (1Eh), `nonres` (20h, and the dword at 2Ch), `movable`
 *   (30h), `shift` (32h), `rescount` (34h), `os` (36h), `gang` (38h, 3Ah,
 *   each less the imported names' offset), `swap` (3Ch), `version` (3Eh);
 *   `tables` the offsets of words 4, 8, 0Ah, 22h, 24h, 26h, 28h and 2Ah.
 *   Word 6, the next module, is not recorded.
 * * `segment`: each entry of the segment table, by its number: its sector,
 *   its length, its flags, its minimum allocation in hexadecimal, and its
 *   handle's kind: `none`, `odd` (a fixed segment's: its selector) or
 *   `even` (a moveable one's: one below).
 * * `autohandle`: the data segment's handle, as the table has it, against
 *   the module's instance as `LoadLibrary` answers it: `same`, `none`,
 *   `other`.
 * * `codehandle`: `GetCodeHandle` of the module's handle and the segment's
 *   number as a far pointer, as the mixer asks it: AX against the table's
 *   handle after (`same`, `none` for nought, `other`), DX against AX
 *   (`ax|1`, `ax`, `none`, `other`). After the segment records: it loads
 *   a segment that is not.
 * * `modname`: the resident names' first entry, the module's name and its
 *   ordinal; `resident` the others, each `name@ordinal`.
 * * `refs`: each module reference's module, by the name its database
 *   gives, `-` for nought.
 * * `ordinals`: the ordinals the entry table has, as runs.
 * * `entries`: each bundle's entries by their bundle's place: each one's
 *   type, flags and segment in hexadecimal, a run of the same as `xN`.
 * * `fileinfo`: the first byte less the path's length, `fFixedDisk`,
 *   `nErrCode`, then the path.
 * * `size`: `GlobalSize` of the module's handle, in hexadecimal.
 */

#include "probe.h"
#include <commdlg.h>
#include <shellapi.h>
#include <toolhelp.h>
#include <ddeml.h>
#include <lzexpand.h>
#include <ver.h>
#include <mmsystem.h>

#pragma library("commdlg")
#pragma library("shell")
#pragma library("ddeml")
#pragma library("lzexpand")
#pragma library("ver")

#define OUTPUT "C:\\ORACLE\\KEPTDB.OUT"

static const char *NAMES[] = {
    "KERNEL", "USER",    "GDI",      "MMSYSTEM", "SOUND",   "KEYBOARD", "SYSTEM",
    "DISPLAY", "COMMDLG", "SHELL",   "TOOLHELP", "DDEML",   "TIMER",    "WIN87EM",
    "LZEXPAND", "VER",    "MCIWAVE", "MCISEQ",
};

static WORD at(HMODULE module, WORD offset)
{
    return *(WORD FAR *)MAKELP(module, offset);
}

static BYTE byteAt(HMODULE module, WORD offset)
{
    return *(BYTE FAR *)MAKELP(module, offset);
}

static void word(LPCSTR function, LPCSTR name, HMODULE module, WORD offset)
{
    wsprintf(probeResult, "%04x", at(module, offset));
    probe(function, name, probeResult);
}

static void kindOf(LPSTR out, WORD handle)
{
    lstrcpy(out, handle == 0 ? "none" : (handle & 1) ? "odd" : "even");
}

static void relation(LPSTR out, WORD value, WORD against)
{
    lstrcpy(out, value == 0 ? "none" : value == against ? "same" : "other");
}

/* A module's name as its database's resident names start, by its handle. */
static void nameOf(LPSTR out, HMODULE module)
{
    WORD names = at(module, 0x26);
    BYTE length = byteAt(module, names);
    BYTE i;

    for (i = 0; i < length && i < 15; i++) {
        out[i] = byteAt(module, names + 1 + i);
    }

    out[i] = '\0';
}

static void header(LPCSTR name, HMODULE module)
{
    WORD imported = at(module, 0x2a);

    word("sig", name, module, 0x00);
    word("usage", name, module, 0x02);
    word("flags", name, module, 0x0c);
    word("autodata", name, module, 0x0e);
    word("heap", name, module, 0x10);
    word("stack", name, module, 0x12);

    wsprintf(probeResult, "%04x:%04x", at(module, 0x16), at(module, 0x14));
    probe("csip", name, probeResult);
    wsprintf(probeResult, "%04x:%04x", at(module, 0x1a), at(module, 0x18));
    probe("sssp", name, probeResult);

    word("segcount", name, module, 0x1c);
    word("refcount", name, module, 0x1e);

    wsprintf(probeResult, "%04x %04x%04x", at(module, 0x20), at(module, 0x2e), at(module, 0x2c));
    probe("nonres", name, probeResult);

    word("movable", name, module, 0x30);
    word("shift", name, module, 0x32);
    word("rescount", name, module, 0x34);
    word("os", name, module, 0x36);

    wsprintf(probeResult, "%d %d", (int)(at(module, 0x38) - imported),
             (int)(at(module, 0x3a) - imported));
    probe("gang", name, probeResult);

    word("swap", name, module, 0x3c);
    word("version", name, module, 0x3e);

    wsprintf(probeResult, "%04x %04x %04x %04x %04x %04x %04x %04x", at(module, 0x04),
             at(module, 0x08), at(module, 0x0a), at(module, 0x22), at(module, 0x24),
             at(module, 0x26), at(module, 0x28), at(module, 0x2a));
    probe("tables", name, probeResult);
}

static void segments(LPCSTR name, HMODULE module)
{
    WORD table = at(module, 0x22);
    WORD count = at(module, 0x1c);
    WORD i;
    char kind[8];

    for (i = 0; i < count; i++) {
        WORD entry = table + i * 10;

        kindOf(kind, at(module, entry + 8));
        wsprintf(probeArgs, "%s %d", (LPSTR)name, i + 1);
        wsprintf(probeResult, "%04x %04x %04x %04x %s", at(module, entry), at(module, entry + 2),
                 at(module, entry + 4), at(module, entry + 6), (LPSTR)kind);
        probe("segment", probeArgs, probeResult);
    }

    if (at(module, 0x0e)) {
        HINSTANCE instance = LoadLibrary(name);
        WORD handle = at(module, table + (at(module, 0x0e) - 1) * 10 + 8);
        char kind[8];

        relation(kind, handle, (WORD)instance);
        probe("autohandle", name, kind);

        if ((UINT)instance >= 32) {
            FreeLibrary(instance);
        }
    }
}

/* `GetCodeHandle` answers the handle in AX and the selector in DX, where
 * the header declares a handle alone. */
typedef DWORD(FAR PASCAL *CODEHANDLE)(FARPROC);

static void codeHandles(LPCSTR name, HMODULE module)
{
    CODEHANDLE getCodeHandle = (CODEHANDLE)GetCodeHandle;
    WORD table = at(module, 0x22);
    WORD count = at(module, 0x1c);
    WORD i;

    for (i = 0; i < count; i++) {
        DWORD answer = getCodeHandle((FARPROC)MAKELP(module, i + 1));
        WORD ax = LOWORD(answer);
        WORD dx = HIWORD(answer);
        WORD handle = at(module, table + i * 10 + 8);
        char first[8];
        char second[8];

        relation(first, ax, handle);

        if (dx == 0) {
            lstrcpy(second, "none");
        } else if (dx == (ax | 1)) {
            lstrcpy(second, "ax|1");
        } else if (dx == ax) {
            lstrcpy(second, "ax");
        } else {
            lstrcpy(second, "other");
        }

        wsprintf(probeArgs, "%s %d", (LPSTR)name, i + 1);
        wsprintf(probeResult, "%s %s", (LPSTR)first, (LPSTR)second);
        probe("codehandle", probeArgs, probeResult);
    }
}

static void names(LPCSTR name, HMODULE module)
{
    WORD walk = at(module, 0x26);
    WORD end = at(module, 0x28);
    BOOL first = TRUE;
    char text[64];

    probeResult[0] = '\0';

    while (walk < end && byteAt(module, walk)) {
        BYTE length = byteAt(module, walk);
        BYTE i;

        for (i = 0; i < length && i < 40; i++) {
            text[i] = byteAt(module, walk + 1 + i);
        }

        text[i] = '\0';

        if (first) {
            wsprintf(probeArgs, "%s %d", (LPSTR)text, at(module, walk + 1 + length));
            probe("modname", name, probeArgs);
            first = FALSE;
        } else if (lstrlen(probeResult) < sizeof(probeResult) - 64) {
            wsprintf(probeResult + lstrlen(probeResult), "%s%s@%d", (LPSTR)(probeResult[0] ? " " : ""),
                     (LPSTR)text, at(module, walk + 1 + length));
        }

        walk += length + 3;
    }

    probe("resident", name, probeResult);
}

static void references(LPCSTR name, HMODULE module)
{
    WORD table = at(module, 0x28);
    WORD count = at(module, 0x1e);
    WORD i;
    char other[16];

    probeResult[0] = '\0';

    for (i = 0; i < count; i++) {
        HMODULE each = (HMODULE)at(module, table + 2 * i);

        if (each) {
            nameOf(other, each);
        } else {
            lstrcpy(other, "-");
        }

        wsprintf(probeResult + lstrlen(probeResult), "%s%s", (LPSTR)(i ? " " : ""), (LPSTR)other);
    }

    probe("refs", name, probeResult);
}

/* An entry's type, flags and segment as a word, for runs of the same. */
static WORD entryKey(HMODULE module, WORD entry)
{
    return (WORD)byteAt(module, entry) << 8 | byteAt(module, entry + 1);
}

static void entries(LPCSTR name, HMODULE module)
{
    WORD bundle = at(module, 0x04);
    WORD place = 0;
    WORD runFirst = 0;
    WORD runLast = 0;
    BOOL inRun = FALSE;
    char runs[2048];

    runs[0] = '\0';

    while (bundle && place < 512) {
        WORD first = at(module, bundle);
        WORD last = at(module, bundle + 2);
        WORD next = at(module, bundle + 4);
        WORD i;

        /* The bundle's ordinals, first + 1 to last, joined to the run before
         * where they follow it. */
        if (last > first) {
            if (inRun && runLast == first) {
                runLast = last;
            } else {
                if (inRun && lstrlen(runs) < sizeof(runs) - 24) {
                    wsprintf(runs + lstrlen(runs), "%s%d-%d", (LPSTR)(runs[0] ? " " : ""),
                             runFirst, runLast);
                }

                runFirst = first + 1;
                runLast = last;
                inRun = TRUE;
            }

            probeResult[0] = '\0';

            for (i = 0; i < last - first;) {
                WORD entry = bundle + 6 + i * 5;
                WORD key = entryKey(module, entry);
                BYTE segment = byteAt(module, entry + 2);
                WORD same = 1;

                while (i + same < last - first && entryKey(module, entry + same * 5) == key &&
                       byteAt(module, entry + same * 5 + 2) == segment) {
                    same++;
                }

                if (lstrlen(probeResult) < sizeof(probeResult) - 32) {
                    wsprintf(probeResult + lstrlen(probeResult), "%s%02x/%02x/%02x",
                             (LPSTR)(probeResult[0] ? " " : ""), key >> 8, key & 0xff, segment);

                    if (same > 1) {
                        wsprintf(probeResult + lstrlen(probeResult), "x%d", same);
                    }
                }

                i += same;
            }

            wsprintf(probeArgs, "%s %d", (LPSTR)name, place);
            probe("entries", probeArgs, probeResult);
        }

        place++;
        bundle = next;
    }

    if (inRun) {
        wsprintf(runs + lstrlen(runs), "%s%d-%d", (LPSTR)(runs[0] ? " " : ""), runFirst, runLast);
    }

    probe("ordinals", name, runs);
}

static void fileInfo(LPCSTR name, HMODULE module)
{
    WORD info = at(module, 0x0a);
    WORD length = 0;
    WORD i;
    char path[130];

    if (!info) {
        probe("fileinfo", name, "none");
        return;
    }

    for (i = 0; i < 128 && byteAt(module, info + 8 + i); i++) {
        path[i] = byteAt(module, info + 8 + i);
        length++;
    }

    path[i] = '\0';
    wsprintf(probeResult, "%02x %02x %04x %s", byteAt(module, info) - length,
             byteAt(module, info + 1), at(module, info + 2), (LPSTR)path);
    probe("fileinfo", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD n;

    probeOpen(OUTPUT);

    for (n = 0; n < sizeof(NAMES) / sizeof(NAMES[0]); n++) {
        LPCSTR name = NAMES[n];
        HMODULE module = GetModuleHandle(name);

        probe("handle", name, module ? "loaded" : "none");

        if (!module) {
            continue;
        }

        header(name, module);
        segments(name, module);
        names(name, module);
        references(name, module);
        entries(name, module);
        fileInfo(name, module);

        wsprintf(probeResult, "%lx", GlobalSize((HGLOBAL)module));
        probe("size", name, probeResult);
    }

    /* Last: GetCodeHandle loads a segment that is not loaded. */
    for (n = 0; n < sizeof(NAMES) / sizeof(NAMES[0]); n++) {
        HMODULE module = GetModuleHandle(NAMES[n]);

        if (module) {
            codeHandles(NAMES[n], module);
        }
    }

    probeFinish();

    /* Each library imported, so Windows loads it for the probe: called
     * only for a command line no run gives. */
    if (command[0] == '\x7f') {
        TIMERINFO timer;
        DWORD handle;

        timer.dwSize = sizeof(timer);
        CommDlgExtendedError();
        DragAcceptFiles(NULL, FALSE);
        TimerCount(&timer);
        DdeGetLastError(0);
        LZClose(-1);
        GetFileVersionInfoSize("X", &handle);
        timeGetTime();
    }

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
