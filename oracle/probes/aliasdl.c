/*
 * A library imported by a name that is not its module's: ALIASDLD.DLL
 * (`aliasdl.dll.c`) copied into the root of C: with its module's name made
 * ALIASDLX, and C:\ALIASDLC.EXE (`aliasdl.child.c`), which imports
 * ALIASDLD, started by `WinExec`. KERNEL loads each module a program
 * references by its name, and where no module has that name by the file
 * of that name and `.DLL` (`KRNL386.EXE` seg2 `1923`-`19b6`), and keeps
 * the handle it got for each reference; an import is bound by that handle
 * (seg1 `73af`-`73c6`), whatever the module's own name. A program's
 * `CTL3D.DLL` that is `CTL3DV2` is such a file.
 *
 * * `exec`: `WinExec`'s answer for C:\ALIASDLC.EXE.
 * * `call`, `handle`, `file`, `usage`, `loadlib`: what the program found
 *   (see `aliasdl.child.c`).
 */

#define PROBE_FLUSH
#include "probe.h"
#include <direct.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\ALIASDL.OUT"

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
    HFILE in = _lopen("C:\\ORACLE\\ALIASDLC.TXT", OF_READ);
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

    copyAs("C:\\WINDOWS\\ALIASDLC.EXE", "C:\\ALIASDLC.EXE", 0);
    copyAs("C:\\WINDOWS\\ALIASDLD.DLL", "C:\\ALIASDLD.DLL", 'X');
    gone("C:\\WINDOWS\\ALIASDLC.EXE");
    gone("C:\\WINDOWS\\ALIASDLD.DLL");
    gone("C:\\ORACLE\\ALIASDLC.TXT");

    answer = WinExec("C:\\ALIASDLC.EXE", SW_SHOWMINNOACTIVE);
    if (answer < 32) {
        wsprintf(probeResult, "error=%u", answer);
    } else {
        lstrcpy(probeResult, "inst");
    }
    probe("exec", "C:\\ALIASDLC.EXE", probeResult);
    waitGone("ALIASDLC", 5000);
    recordLines();

    gone("C:\\ALIASDLC.EXE");
    gone("C:\\ALIASDLD.DLL");
    gone("C:\\ORACLE\\ALIASDLC.TXT");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
