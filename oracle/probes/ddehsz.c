/*
 * `DdeFreeStringHandle` in the cases the other probes leave, as read out of
 * `DDEML.DLL` seg1 `1a40`: the instance found by the low word of its id and
 * checked against the serial in the high word, the instance's last error
 * cleared, a count taken out of the instance's array of the string handles
 * it made or kept (`29d8`), and the atom deleted, answering 1 where
 * `GlobalDeleteAtom` answers nought (`2ddc`). `DdeUninitialize` deletes
 * each handle left in the array once more.
 *
 * Whether a string is still an atom is written `there` or `gone`, by
 * `GlobalFindAtom`. Where a count is to be seen, this program holds one of
 * its own with `GlobalAddAtom`, and lets it go only where it knows the atom
 * is still there: deleting one gone reads a freed entry (`ddeleft`).
 *
 * * `nought`: an id of nought, which names no instance; `DdeGetLastError`
 *   of nought after it.
 * * `other serial`: an id whose serial is not the instance's, after an
 *   error was set; the error after.
 * * `clears`: the instance's own id, after an error was set; the error
 *   after.
 * * `high word`: a handle with a high word that is not nought.
 * * `integer`: 5, an integer atom, which is no string handle.
 * * `another instance's`: a handle one instance made, freed by another of
 *   the same program; then the first ended with `DdeUninitialize`.
 * * `made twice`: made twice and freed once, then the instance ended.
 * * `kept`: made, kept with `DdeKeepStringHandle`, then the instance ended.
 * * `freed twice`: made twice and freed twice, then the instance ended.
 */

#include "probe.h"
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDEHSZ.OUT"

static FARPROC callback;

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

static DWORD start(void)
{
    DWORD id = 0;

    DdeInitialize(&id, (PFNCALLBACK)callback, APPCMD_CLIENTONLY, 0L);
    return id;
}

static LPCSTR there(LPCSTR name)
{
    return GlobalFindAtom(name) ? "there" : "gone";
}

/* An error set in the instance: a code page DDEML does not take. */
static void fail(DWORD id)
{
    DdeCreateStringHandle(id, "HszBad", 999);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    DWORD a;
    DWORD b;
    DWORD c;
    HSZ hsz;
    HSZ second;
    BOOL answer;
    UINT error;
    UINT again;
    char *now;

    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);
    callback = MakeProcInstance((FARPROC)Callback, module);
    a = start();
    b = start();

    hsz = DdeCreateStringHandle(a, "HszNought", CP_WINANSI);
    answer = DdeFreeStringHandle(0L, hsz);
    now = (char *)there("HszNought");
    error = DdeGetLastError(0L);
    wsprintf(probeResult, "%d,%s,nought's error=%x", answer, (LPSTR)now, error);
    probe("DdeFreeStringHandle", "nought", probeResult);
    answer = DdeFreeStringHandle(a, hsz);
    wsprintf(probeResult, "%d,%s", answer, (LPSTR)there("HszNought"));
    probe("DdeFreeStringHandle", "nought,then its own", probeResult);

    hsz = DdeCreateStringHandle(a, "HszSerial", CP_WINANSI);
    fail(a);
    answer = DdeFreeStringHandle(MAKELONG(LOWORD(a), HIWORD(a) + 1), hsz);
    error = DdeGetLastError(a);
    wsprintf(probeResult, "%d,err=%x,%s", answer, error, (LPSTR)there("HszSerial"));
    probe("DdeFreeStringHandle", "other serial", probeResult);

    fail(a);
    answer = DdeFreeStringHandle(a, hsz);
    error = DdeGetLastError(a);
    wsprintf(probeResult, "%d,err=%x,%s", answer, error, (LPSTR)there("HszSerial"));
    probe("DdeFreeStringHandle", "clears", probeResult);

    hsz = DdeCreateStringHandle(a, "HszHigh", CP_WINANSI);
    answer = DdeFreeStringHandle(a, (HSZ)MAKELONG(LOWORD((DWORD)hsz), 0x1234));
    error = DdeGetLastError(a);
    wsprintf(probeResult, "%d,err=%x,%s", answer, error, (LPSTR)there("HszHigh"));
    probe("DdeFreeStringHandle", "high word", probeResult);

    fail(a);
    answer = DdeFreeStringHandle(a, (HSZ)5L);
    error = DdeGetLastError(a);
    wsprintf(probeResult, "%d,err=%x", answer, error);
    probe("DdeFreeStringHandle", "integer", probeResult);

    /* Made by c, held once here, freed by b: then c ended. */
    c = start();
    hsz = DdeCreateStringHandle(c, "HszShared", CP_WINANSI);
    GlobalAddAtom("HszShared");
    answer = DdeFreeStringHandle(b, hsz);
    error = DdeGetLastError(b);
    now = (char *)there("HszShared");
    DdeUninitialize(c);
    wsprintf(probeResult, "%d,err=%x,%s,ended:%s", answer, error, (LPSTR)now,
             (LPSTR)there("HszShared"));
    probe("DdeFreeStringHandle", "another instance's", probeResult);

    /* Made twice, held once here, freed once: then the instance ended. */
    c = start();
    hsz = DdeCreateStringHandle(c, "HszTwice", CP_WINANSI);
    second = DdeCreateStringHandle(c, "HszTwice", CP_WINANSI);
    GlobalAddAtom("HszTwice");
    answer = DdeFreeStringHandle(c, hsz);
    DdeUninitialize(c);
    now = (char *)there("HszTwice");

    if (GlobalFindAtom("HszTwice")) {
        GlobalDeleteAtom(GlobalFindAtom("HszTwice"));
    }

    wsprintf(probeResult, "%d,same=%d,ended:%s,let go:%s", answer, hsz == second, (LPSTR)now,
             (LPSTR)there("HszTwice"));
    probe("DdeFreeStringHandle", "made twice", probeResult);

    /* Made and kept, held once here: then the instance ended. */
    c = start();
    hsz = DdeCreateStringHandle(c, "HszKept", CP_WINANSI);
    DdeKeepStringHandle(c, hsz);
    GlobalAddAtom("HszKept");
    DdeUninitialize(c);
    now = (char *)there("HszKept");

    if (GlobalFindAtom("HszKept")) {
        GlobalDeleteAtom(GlobalFindAtom("HszKept"));
    }

    wsprintf(probeResult, "ended:%s,let go:%s", (LPSTR)now, (LPSTR)there("HszKept"));
    probe("DdeFreeStringHandle", "kept", probeResult);

    /* Made twice, held once here, freed twice: then the instance ended. */
    c = start();
    hsz = DdeCreateStringHandle(c, "HszFreed", CP_WINANSI);
    DdeCreateStringHandle(c, "HszFreed", CP_WINANSI);
    GlobalAddAtom("HszFreed");
    answer = DdeFreeStringHandle(c, hsz);
    again = DdeFreeStringHandle(c, hsz);
    DdeUninitialize(c);
    now = (char *)there("HszFreed");

    if (GlobalFindAtom("HszFreed")) {
        GlobalDeleteAtom(GlobalFindAtom("HszFreed"));
    }

    wsprintf(probeResult, "%d,%d,ended:%s,let go:%s", answer, again, (LPSTR)now,
             (LPSTR)there("HszFreed"));
    probe("DdeFreeStringHandle", "freed twice", probeResult);

    DdeUninitialize(b);
    DdeUninitialize(a);
    probeFinish();
    return 0;
}
