/*
 * DDEML let go with an instance still open, and its `WEP`.
 *
 * Read out of `DDEML.DLL`: `WEP` (seg2 `002c`) answers 1 for
 * `WEP_FREE_DLL` and `WEP_SYSTEM_EXIT`, and for anything else what AX held
 * as it was called -- DDEML's data segment, which the entry's prologue
 * loads there -- and does nothing else. No instance is ended by it, and no
 * window of DDEML's has anything to do as it goes (`DMGWNDPROC`, `5558`).
 *
 * This program does not import DDEML. DDEWEPC.EXE (`ddewep.child.c`) does:
 * it makes an instance, two string handles and a name, writes the serial
 * in its instance's id to C:\ORACLE\DDEWEP.TXT, and ends when told,
 * without `DdeUninitialize`. Its library goes with it.
 *
 * * `before`, `running`, `gone`: whether DDEML is loaded
 *   (`GetModuleHandle`), and whether the child's strings are still atoms,
 *   before the child, while it runs, and once it has gone.
 * * `LoadLibrary`: DDEML loaded again by this program; an instance made
 *   through `GetProcAddress`, its serial beside the child's (`same` where
 *   DDEML started again from its file's data), and ended.
 * * `WEP`: `WEP` called with 0, 1 and 2, each answer named as 1, or as the
 *   library's instance or one more than it, else `other`.
 * * `FreeLibrary`: whether DDEML is loaded after.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>

#define OUTPUT "C:\\ORACLE\\DDEWEP.OUT"
#define LOG "C:\\ORACLE\\DDEWEP.TXT"

typedef UINT(WINAPI *INITIALIZE)(LPDWORD, PFNCALLBACK, DWORD, DWORD);
typedef BOOL(WINAPI *UNINITIALIZE)(DWORD);
typedef int(WINAPI *WEPPROC)(int);

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)conv;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

static void state(LPCSTR when)
{
    wsprintf(probeResult, "ddeml=%s,WepLeft=%s,WepSrv=%s",
             (LPSTR)(GetModuleHandle("DDEML") ? "loaded" : "none"),
             (LPSTR)(GlobalFindAtom("WepLeft") ? "there" : "gone"),
             (LPSTR)(GlobalFindAtom("WepSrv") ? "there" : "gone"));
    probe("state", when, probeResult);
}

/* What `WEP` answered, by name. */
static LPCSTR named(int answer, HINSTANCE library)
{
    if (answer == 1) {
        return "1";
    }

    if ((UINT)answer == (UINT)library) {
        return "instance";
    }

    if ((UINT)answer == (UINT)library + 1) {
        return "instance+1";
    }

    return "other";
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    HWND child;
    HINSTANCE library;
    INITIALIZE initialize;
    UNINITIALIZE uninitialize;
    WEPPROC wep;
    DWORD id = 0;
    UINT made;
    char serial[40];
    HFILE file;
    int length;
    int i;
    int zero;
    int one;
    int two;

    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);
    file = _lcreat(LOG, 0);
    _lclose(file);

    state("before");
    WinExec("DDEWEPC.EXE", SW_SHOWNOACTIVATE);

    for (i = 0; i < 300 && !FindWindow(NULL, "Wep Child"); i++) {
        settle(1);
    }

    settle(20);
    child = FindWindow(NULL, "Wep Child");
    state(child ? "running" : "no child");

    if (!child) {
        probeFinish();
        return 0;
    }

    PostMessage(child, WM_USER + 9, 0, 0L);

    for (i = 0; i < 300 && (IsWindow(child) || GetModuleHandle("DDEWEPC")); i++) {
        settle(1);
    }

    settle(20);
    state(GetModuleHandle("DDEWEPC") ? "still running" : "gone");

    file = _lopen(LOG, OF_READ);
    length = file == HFILE_ERROR ? 0 : _lread(file, serial, sizeof(serial) - 1);

    if (file != HFILE_ERROR) {
        _lclose(file);
    }

    serial[length < 0 ? 0 : length] = '\0';

    library = LoadLibrary("DDEML.DLL");
    initialize = (INITIALIZE)GetProcAddress(library, "DdeInitialize");
    uninitialize = (UNINITIALIZE)GetProcAddress(library, "DdeUninitialize");
    made = initialize ? initialize(&id, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                                   APPCMD_CLIENTONLY, 0L)
                      : 0xffff;
    wsprintf(probeArgs, "%x", HIWORD(id));
    wsprintf(probeResult, "%s,made=%u,serial=%s", (LPSTR)(library >= (HINSTANCE)32 ? "ok" : "failed"),
             made, (LPSTR)(lstrcmp(probeArgs, serial) == 0 ? "same" : "differ"));
    probe("LoadLibrary", "DDEML.DLL", probeResult);

    if (uninitialize && id) {
        uninitialize(id);
    }

    wep = (WEPPROC)GetProcAddress(library, "WEP");
    zero = wep ? wep(0) : -1;
    one = wep ? wep(1) : -1;
    two = wep ? wep(2) : -1;
    wsprintf(probeResult, "%s,%s,%s", (LPSTR)named(zero, library), (LPSTR)named(one, library),
             (LPSTR)named(two, library));
    probe("WEP", "0,1,2", probeResult);

    FreeLibrary(library);
    settle(5);
    wsprintf(probeResult, "ddeml=%s", (LPSTR)(GetModuleHandle("DDEML") ? "loaded" : "none"));
    probe("FreeLibrary", "DDEML", probeResult);
    probeFinish();
    return 0;
}
