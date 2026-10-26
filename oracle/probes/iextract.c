/*
 * SHELL's InternalExtractIcon: a block of a file's icons' handles, which
 * ExtractIcon takes the first word of. Each record: the block's size, its
 * flags, and each word -- `icon` for a handle of an icon, else the number.
 *
 * * `progman`: Program Manager's icons from 0, three; from 1, two; -1, two
 *   (the first the count); from past the last two, two.
 * * `none`: no icons asked for: the answer.
 * * `missing`: a file that is not there: the answer.
 * * `text`: WIN.INI, no program, from 0 and -1: the words.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>
#include <shellapi.h>

#pragma library("shell")

#define OUTPUT "C:\\ORACLE\\IEXTRACT.OUT"

typedef HGLOBAL(FAR PASCAL *Extract)(HINSTANCE, LPCSTR, UINT, UINT);

static Extract extract;
static HINSTANCE self;

/* A word as the record shows it: `icon` for an icon's handle. */
static void wordOf(LPSTR at, WORD word)
{
    if (word && GlobalSize((HGLOBAL)word) && GlobalSize((HGLOBAL)word) < 0x1000 && word > 0x20 &&
        (word & 3) == 2) {
        lstrcpy(at, "icon");
    } else {
        wsprintf(at, "%x", word);
    }
}

static void one(LPCSTR name, LPCSTR file, int index, UINT count)
{
    HGLOBAL block = extract(self, file, (UINT)index, count);
    WORD FAR *words;
    char text[16];
    UINT at;
    LPSTR to = probeResult;

    if (!block) {
        probe("extract", name, "0");
        return;
    }

    to += wsprintf(to, "size=%lx,flags=%x:", GlobalSize(block), GlobalFlags(block));
    words = (WORD FAR *)GlobalLock(block);

    for (at = 0; at < count; at++) {
        wordOf(text, words[at]);
        to += wsprintf(to, " %s", (LPSTR)text);
    }

    GlobalUnlock(block);
    GlobalFree(block);
    probe("extract", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE shell = LoadLibrary("SHELL.DLL");
    int count;

    self = instance;
    extract = (Extract)GetProcAddress(shell, MAKEINTRESOURCE(39));
    probeOpen(OUTPUT);

    count = (int)(UINT)ExtractIcon(instance, "C:\\WINDOWS\\PROGMAN.EXE", (UINT)-1);
    wsprintf(probeResult, "%d", count);
    probe("extract", "progman-count", probeResult);

    one("progman-0-3", "C:\\WINDOWS\\PROGMAN.EXE", 0, 3);
    one("progman-1-2", "C:\\WINDOWS\\PROGMAN.EXE", 1, 2);
    one("progman-minus1-2", "C:\\WINDOWS\\PROGMAN.EXE", -1, 2);
    one("progman-past-2", "C:\\WINDOWS\\PROGMAN.EXE", count - 1, 2);
    one("none", "C:\\WINDOWS\\PROGMAN.EXE", 0, 0);
    one("missing", "C:\\WINDOWS\\NOWHERE.EXE", 0, 1);
    one("text-0", "C:\\WINDOWS\\WIN.INI", 0, 2);
    one("text-minus1", "C:\\WINDOWS\\WIN.INI", -1, 2);

    FreeLibrary(shell);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
