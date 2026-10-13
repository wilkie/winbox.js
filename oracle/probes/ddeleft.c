/*
 * What is left behind in the shared memory and atoms DDE passes between
 * programs, where KERNEL's and USER's own bookkeeping decides it:
 *
 * * `owned`: blocks of global memory DDELEFTC.EXE (`ddeleft.child.c`),
 *   "Left Server", allocated -- plain, `GMEM_DDESHARE`, plain made shared by
 *   `GlobalReAlloc` with `GMEM_MODIFY`, and fixed `GMEM_DDESHARE` -- by
 *   `GlobalFlags` and `GlobalSize` while it runs, after it has gone with a
 *   second copy of it still running ("Left Server 2"), and after that copy
 *   has gone too. Read out of `KRNL386.EXE`: a block is its task's, unless
 *   `GMEM_DDESHARE`, which makes it the module's whose code asked for it
 *   (seg1 `0d12`-`0d2a`; the task's otherwise, `0c62`).
 * * `GlobalDeleteAtom`: an atom deleted once more than it was added. USER
 *   looks for the string its freed entry held (`KRNL386.EXE` seg1 `4a80`)
 *   and answers what was left in AX.
 * * `DdeFreeStringHandle`: a string handle freed once more than it was
 *   made or kept, which DDEML answers by that `GlobalDeleteAtom`.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDELEFT.OUT"

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

static void describe(LPCSTR name, HGLOBAL handle)
{
    wsprintf(probeResult, "flags=%x,size=%lu", GlobalFlags(handle), GlobalSize(handle));
    probe("owned", name, probeResult);
}

/* Until a window of that title is there, or is gone. */
static void await(LPCSTR title, BOOL there)
{
    int i;

    for (i = 0; i < 300 && (FindWindow(NULL, title) ? !there : there); i++) {
        settle(1);
    }

    settle(40);
}

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV conv, HSZ hsz1, HSZ hsz2,
                                    HDDEDATA data, DWORD data1, DWORD data2)
{
    (void)type;
    (void)format;
    (void)conv;
    (void)hsz1;
    (void)hsz2;
    (void)data;
    (void)data1;
    (void)data2;
    return 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND target;
    DWORD pair;
    HGLOBAL plain, shared, modified, fixed;
    ATOM atom;
    UINT first, second;
    DWORD client = 0;
    HSZ counted;
    BOOL freed[3];

    probeOpen(OUTPUT);

    WinExec("DDELEFTC.EXE", SW_SHOWNOACTIVATE);
    await("Left Server", TRUE);
    target = FindWindow(NULL, "Left Server");

    pair = SendMessage(target, WM_USER + 8, 0, 0L);
    plain = (HGLOBAL)LOWORD(pair);
    shared = (HGLOBAL)HIWORD(pair);
    pair = SendMessage(target, WM_USER + 10, 0, 0L);
    modified = (HGLOBAL)LOWORD(pair);
    fixed = (HGLOBAL)HIWORD(pair);
    describe("plain,running", plain);
    describe("shared,running", shared);
    describe("modified,running", modified);
    describe("fixed,running", fixed);

    WinExec("DDELEFTC.EXE 2", SW_SHOWNOACTIVATE);
    await("Left Server 2", TRUE);
    SendMessage(target, WM_USER + 9, 0, 0L);
    await("Left Server", FALSE);
    describe("plain,gone", plain);
    describe("shared,gone", shared);
    describe("modified,gone", modified);
    describe("fixed,gone", fixed);

    SendMessage(FindWindow(NULL, "Left Server 2"), WM_USER + 9, 0, 0L);
    await("Left Server 2", FALSE);
    describe("plain,module gone", plain);
    describe("shared,module gone", shared);
    describe("modified,module gone", modified);
    describe("fixed,module gone", fixed);

    atom = GlobalAddAtom("Twice");
    first = GlobalDeleteAtom(atom);
    second = GlobalDeleteAtom(atom);
    wsprintf(probeResult, "%s,%s", (LPSTR)(first ? "nonzero" : "0"),
             (LPSTR)(second ? "nonzero" : "0"));
    probe("GlobalDeleteAtom", "Twice,again", probeResult);

    DdeInitialize(&client, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, instance),
                  APPCMD_CLIENTONLY, 0L);
    counted = DdeCreateStringHandle(client, "Counted", CP_WINANSI);
    DdeKeepStringHandle(client, counted);
    freed[0] = DdeFreeStringHandle(client, counted);
    freed[1] = DdeFreeStringHandle(client, counted);
    freed[2] = DdeFreeStringHandle(client, counted);
    wsprintf(probeResult, "%d,%d,%d,err=%x", freed[0], freed[1], freed[2],
             DdeGetLastError(client));
    probe("DdeFreeStringHandle", "Counted,made and kept,x3", probeResult);
    DdeUninitialize(client);

    probeFinish();
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
