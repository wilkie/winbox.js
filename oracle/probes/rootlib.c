/*
 * A program and the library it imports with their files in the root of C:,
 * started by `WinExec` from a program whose current directory is
 * elsewhere. KERNEL keeps the directory of a module's file as its path up
 * to the last `\`, `/` or `:` before its name, "C:" for C:\ROOTLIBC.EXE
 * (`KRNL386.EXE` seg1 `55d9`-`55e9`, `5a0e`), and makes a path of a place
 * by adding a `\` where it does not end in one, and the name (seg1
 * `5667`-`5687`): C:\ROOTLIBD.DLL, the root.
 *
 * ROOTLIBC.EXE (`rootlib.child.c`), ROOTLIBD.DLL (`rootlib.dll.c`), a copy
 * of it with its module's name made ROOTLIBL, and ROOTLIB.DAT are put in
 * C:\ alone; the probe's current directory is C:\ORACLE.
 *
 * * `exec`: `WinExec`'s answer for C:\ROOTLIBC.EXE.
 * * `self`, `import`, `library`, `openfile`: what the program found (see
 *   `rootlib.child.c`).
 */

#define PROBE_FLUSH
#include "probe.h"
#include <direct.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\ROOTLIB.OUT"

static char buffer[1024];
static char text[1200];

static void gone(LPCSTR path)
{
    OFSTRUCT of;

    OpenFile(path, &of, OF_DELETE);
}

/*
 * A file copied, a kilobyte at a time; with `last` not nought, the last
 * letter of its module's name, the first in its resident-name table,
 * changed to it, so that the copy is another module.
 */
static void copyAs(LPCSTR from, LPCSTR to, char last)
{
    HFILE in = _lopen(from, OF_READ);
    HFILE out = _lcreat(to, 0);
    long at = 0;
    long letter = -1;
    WORD header;
    WORD table;
    BYTE length;
    UINT got;

    if (in == HFILE_ERROR || out == HFILE_ERROR) {
        _lclose(in);
        _lclose(out);
        return;
    }

    if (last) {
        _llseek(in, 0x3cL, 0);
        _lread(in, &header, 2);
        _llseek(in, (long)header + 0x26, 0);
        _lread(in, &table, 2);
        _llseek(in, (long)header + table, 0);
        _lread(in, &length, 1);
        letter = (long)header + table + length;
        _llseek(in, 0L, 0);
    }

    while ((got = _lread(in, buffer, sizeof(buffer))) > 0 && got != (UINT)HFILE_ERROR) {
        if (letter >= at && letter < at + (long)got) {
            buffer[(int)(letter - at)] = last;
        }

        _lwrite(out, buffer, got);
        at += got;
    }

    _lclose(in);
    _lclose(out);
}

/* Lets the others run until a module is gone, or a while has passed. */
static void waitGone(LPCSTR module, DWORD wait)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetModuleHandle(module) && GetTickCount() - start < wait) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* The other program's lines, each a record: function, what it found. */
static void recordLines(void)
{
    HFILE in = _lopen("C:\\ORACLE\\ROOTLIBC.TXT", OF_READ);
    LPSTR line = text;
    LPSTR at;
    LPSTR result;
    int got = 0;

    if (in != HFILE_ERROR) {
        got = _lread(in, text, sizeof(text) - 1);
        _lclose(in);
    }

    text[got < 0 ? 0 : got] = '\0';

    while (*line) {
        result = "";

        for (at = line; *at && *at != '\r' && *at != '\n'; at++) {
            if (*at == '\t' && !*result) {
                *at = '\0';
                result = at + 1;
            }
        }

        while (*at == '\r' || *at == '\n') {
            *at++ = '\0';
        }

        probe(line, "", result);
        line = at;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT answer;

    probeOpen(OUTPUT);
    SetErrorMode(SEM_NOOPENFILEERRORBOX | SEM_FAILCRITICALERRORS);

    copyAs("C:\\WINDOWS\\ROOTLIBC.EXE", "C:\\ROOTLIBC.EXE", 0);
    copyAs("C:\\WINDOWS\\ROOTLIBD.DLL", "C:\\ROOTLIBD.DLL", 0);
    copyAs("C:\\WINDOWS\\ROOTLIBD.DLL", "C:\\ROOTLIBL.DLL", 'L');
    copyAs("C:\\WINDOWS\\WIN.INI", "C:\\ROOTLIB.DAT", 0);
    gone("C:\\WINDOWS\\ROOTLIBC.EXE");
    gone("C:\\WINDOWS\\ROOTLIBD.DLL");
    gone("C:\\ORACLE\\ROOTLIBC.TXT");

    chdir("C:\\ORACLE");

    answer = WinExec("C:\\ROOTLIBC.EXE", SW_SHOWMINNOACTIVE);
    if (answer < 32) {
        wsprintf(probeResult, "error=%u", answer);
    } else {
        lstrcpy(probeResult, "inst");
    }
    probe("exec", "C:\\ROOTLIBC.EXE", probeResult);
    waitGone("ROOTLIBC", 5000);
    recordLines();

    gone("C:\\ROOTLIBC.EXE");
    gone("C:\\ROOTLIBD.DLL");
    gone("C:\\ROOTLIBL.DLL");
    gone("C:\\ROOTLIB.DAT");
    gone("C:\\ORACLE\\ROOTLIBC.TXT");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
