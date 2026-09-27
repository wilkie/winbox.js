/*
 * The environment a program started by LoadModule is given: one of the
 * probe's own making, named by the block's segment, and none (nought).
 *
 * * `load`: LoadModule's answer, `inst` for an instance.
 * * `env`: what the program wrote -- its environment's strings, the word
 *   after them, and the path after that. With nought, whether its strings
 *   are the probe's own, whether they hold `windir`, and the rest as with
 *   an environment given.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOADENV.OUT"
#define LOG "C:\\ORACLE\\CHILD.TXT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

typedef struct {
    WORD environment;
    LPSTR commandLine;
    UINT FAR *show;
    DWORD reserved;
} PARAMETERS;

static char text[1024];

static void settle(void)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < 500) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

static void readLog(void)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = file == HFILE_ERROR ? 0 : _lread(file, text, sizeof(text) - 1);

    if (file != HFILE_ERROR) {
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';
}

/* The strings of an environment, each ended by a nought, to its end. */
static int stringsLength(LPSTR at)
{
    LPSTR start = at;

    while (*at) {
        at += lstrlen(at) + 1;
    }

    return (int)(at - start);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char own[] = "ALPHA=one\0Beta=Two Three\0\0\1\0C:\\OWN\\PATH.EXE\0";
    static UINT showing[2] = { 2, SW_SHOWNORMAL };
    static char tail[] = "\0";
    PARAMETERS parameters;
    HGLOBAL block;
    LPSTR ours;
    LPSTR at;
    UINT answer;
    int length;
    int i;

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_MOVEABLE, sizeof(own));
    ours = GlobalLock(block);

    for (i = 0; i < sizeof(own); i++) {
        ours[i] = own[i];
    }

    parameters.environment = HIWORD((DWORD)ours);
    parameters.commandLine = tail;
    parameters.show = showing;
    parameters.reserved = 0;
    answer = (UINT)LoadModule("LOADENVC.EXE", &parameters);
    probe("load", "own environment", (LPSTR)(answer > 32 ? "inst" : "error"));
    settle();
    readLog();
    probe("env", "own environment", text);
    GlobalUnlock(block);
    GlobalFree(block);

    parameters.environment = 0;
    answer = (UINT)LoadModule("LOADENVC.EXE", &parameters);
    probe("load", "none", (LPSTR)(answer > 32 ? "inst" : "error"));
    settle();
    readLog();

    /* The probe's own strings, as the program would write them. */
    at = GetDOSEnvironment();
    length = stringsLength(at);
    {
        char mine[1024];
        LPSTR out = mine;
        LPSTR from = at;

        while (*from) {
            lstrcpy(out, from);
            lstrcat(out, "\r\n");
            out += lstrlen(out);
            from += lstrlen(from) + 1;
        }

        *out = '\0';
        probe("env", "none, strings are the probe's",
              (LPSTR)(_fstrncmp(text, mine, lstrlen(mine)) == 0 ? "yes" : "no"));
        probe("env", "none, rest", text + lstrlen(mine));
    }

    probe("env", "none, has windir", (LPSTR)(_fstrstr(text, "windir=") ? "yes" : "no"));

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    (void)length;
    return 0;
}
