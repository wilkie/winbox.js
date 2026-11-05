/*
 * What is in a loaded segment past the bytes its file holds.
 *
 * KERNEL loads a segment into a block of its minimum allocation and two
 * bytes, reads the file's bytes into its start, and fills the rest of the
 * block with nought (`KRNL286.EXE` seg1 `71e1`-`720f`, `72a6`-`7314`,
 * `732d`-`7348`; `KRNL386.EXE` seg1 `7968`-`7981`, `7a43`-`7aa5`,
 * `7ab6`-`7ae2`, to the segment's limit). Microsoft's setup toolkit
 * (`MSCOMSTF.DLL` segment 32) ends a function with a `retf 8` whose last
 * byte is past its segment's length of FD0h, inside its minimum allocation
 * of FD1h: the nought it pops nothing more by is KERNEL's.
 *
 * Memory is made dirty first -- blocks filled with A5h and freed, and a
 * program, SEGTAILC.EXE (`segtail.child.c`), started and let end -- so
 * that memory the library's segments come to has had something in it. Then
 * SEGTAILD.DLL (`segtail.dll.c`) is loaded, and its file read for its
 * segments' lengths and minimum allocations.
 *
 * * `dirty`: how many blocks of FFF0h were filled and freed.
 * * `child`: whether WinExec started the program, and whether it ended
 *   within five seconds.
 * * `segment`: each of the library's segments as its file has it: its
 *   flags, its length and its minimum allocation.
 * * `code`: the segment `SegtailCode` is in, found by its first bytes, and
 *   how many bytes are not nought past its length, to its minimum
 *   allocation and two bytes; and those bytes.
 * * `data`: how many of the 1024 bytes of `tail`, an uninitialised array of
 *   the library's data segment, are not nought; and its offset there.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SEGTAIL.OUT"
#define LIBRARY "SEGTAILD.DLL"
#define DIRTY 16

typedef int(FAR PASCAL *CODEPROC)(void);
typedef LPSTR(FAR PASCAL *DATAPROC)(void);

static HGLOBAL blocks[DIRTY];

/* Blocks filled with A5h and freed. */
static void dirty(void)
{
    int count = 0;
    int i;

    for (i = 0; i < DIRTY; i++) {
        BYTE huge *bytes;
        WORD at;

        blocks[i] = GlobalAlloc(GMEM_FIXED, 0xfff0L);

        if (!blocks[i]) {
            break;
        }

        bytes = (BYTE huge *)GlobalLock(blocks[i]);

        for (at = 0; at < 0xfff0; at++) {
            bytes[at] = 0xa5;
        }

        GlobalUnlock(blocks[i]);
        count++;
    }

    while (i-- > 0) {
        GlobalFree(blocks[i]);
    }

    wsprintf(probeResult, "%d", count);
    probe("dirty", "", probeResult);
}

static WORD word(BYTE *at)
{
    return (WORD)(at[0] | (at[1] << 8));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[128];
    BYTE header[64];
    BYTE table[8 * 16];
    HINSTANCE library;
    HFILE file;
    WORD ne, count, i;
    CODEPROC code;
    DATAPROC data;

    probeOpen(OUTPUT);

    dirty();

    /* A program started and let end: the library's segments may come to
     * the memory its segments had. */
    {
        UINT started = WinExec("C:\\WINDOWS\\SEGTAILC.EXE", SW_SHOWMINNOACTIVE);
        DWORD start = GetTickCount();
        MSG msg;

        while (GetModuleHandle("SEGTAILC") && GetTickCount() - start < 5000) {
            if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
                DispatchMessage(&msg);
            } else {
                Yield();
            }
        }

        wsprintf(probeResult, "started=%d ended=%d", started >= 32,
                 GetModuleHandle("SEGTAILC") == NULL);
        probe("child", "SEGTAILC.EXE", probeResult);
    }

    library = LoadLibrary(LIBRARY);

    if ((UINT)library < 32) {
        wsprintf(probeResult, "%u", (UINT)library);
        probe("LoadLibrary", LIBRARY, probeResult);
        probeFinish();
        return 0;
    }

    GetModuleFileName(library, path, sizeof(path));
    file = _lopen(path, OF_READ);
    _lread(file, header, 64);
    ne = word(header + 0x3c);
    _llseek(file, ne, 0);
    _lread(file, header, 64);
    count = word(header + 0x1c);

    if (count > 16) {
        count = 16;
    }

    _llseek(file, ne + word(header + 0x22), 0);
    _lread(file, table, 8 * count);

    for (i = 0; i < count; i++) {
        BYTE *entry = table + 8 * i;

        wsprintf(probeArgs, "%u", i + 1);
        wsprintf(probeResult, "flags=%04X length=%04X minimum=%04X", word(entry + 4),
                 word(entry + 2), word(entry + 6));
        probe("segment", probeArgs, probeResult);
    }

    code = (CODEPROC)GetProcAddress(library, "SEGTAILCODE");
    data = (DATAPROC)GetProcAddress(library, "SEGTAILDATA");

    if (code) {
        BYTE FAR *bytes = (BYTE FAR *)MAKELP(SELECTOROF(code), 0);
        int found = 0;

        for (i = 0; i < count && !found; i++) {
            BYTE *entry = table + 8 * i;
            BYTE first[16];
            WORD k;
            int same = 1;

            if (word(entry + 4) & 1) {
                continue;
            }

            _llseek(file, (LONG)word(entry) << word(header + 0x32), 0);
            _lread(file, first, 16);

            for (k = 0; k < 16; k++) {
                same = same && first[k] == bytes[k];
            }

            if (same) {
                DWORD length = word(entry + 2) ? word(entry + 2) : 0x10000L;
                DWORD end = (word(entry + 6) ? word(entry + 6) : 0x10000L) + 2;
                DWORD at;
                int nonzero = 0;
                char *out = probeResult;

                if (end > 0x10000L) {
                    end = 0x10000L;
                }

                out += wsprintf(out, "segment=%u", i + 1);

                for (at = length; at < end; at++) {
                    nonzero += bytes[(WORD)at] != 0;
                }

                out += wsprintf(out, " nonzero=%d bytes=", nonzero);

                for (at = length; at < end && at < length + 16; at++) {
                    out += wsprintf(out, "%02X", bytes[(WORD)at]);
                }

                found = 1;
                probe("code", "SegtailCode", probeResult);
            }
        }

        if (!found) {
            probe("code", "SegtailCode", "not found");
        }
    }

    if (data) {
        LPSTR tail = data();
        int nonzero = 0;
        WORD k;

        for (k = 0; k < 1024; k++) {
            nonzero += tail[k] != 0;
        }

        wsprintf(probeResult, "nonzero=%d offset=%04X", nonzero, OFFSETOF(tail));
        probe("data", "tail", probeResult);
    }

    _lclose(file);
    FreeLibrary(library);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
