/*
 * Program Manager started, with nothing of its own on the drive, and closed:
 * the probe deletes PROGMAN.INI and the installation's group files, as
 * pmbare does, starts PROGMAN.EXE and waits for its frame, then records
 * what it is -- its module found by name, its instance's file, its frame's
 * title, place and visibility, its MDI client's room -- and what it wrote
 * as it started; a second start of it, which ends after handing the first
 * the turn; and the first closed with WM_CLOSE, its window gone, what it
 * wrote as it closed, and its module gone.
 *
 * What WinBox's own Program Manager, with no PROGMAN.EXE on the drive, is
 * held to (`crates/winbox-win16/tests/progman.rs`, `test/win16/progman_test.ts`).
 * No DDE: that is pmbare's and the rest's.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PMSTART.OUT"

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

static void removeFile(LPCSTR path)
{
    OFSTRUCT of;

    wsprintf(probeResult, "%d", OpenFile(path, &of, OF_DELETE) != HFILE_ERROR);
    probe("delete", path, probeResult);
}

/* A file's bytes as text, or "none", under a function's name of its own. */
static void text(LPCSTR function, LPCSTR label, LPCSTR path)
{
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);
    int got;

    if (file == HFILE_ERROR) {
        probe(function, label, "none");
        return;
    }

    got = _lread(file, probeResult, sizeof(probeResult) - 1);
    _lclose(file);
    probeResult[got < 0 ? 0 : got] = '\0';
    probe(function, label, probeResult);
}

static void rect(LPCSTR label, RECT FAR *r)
{
    wsprintf(probeResult, "%d,%d,%d,%d", r->left, r->top, r->right, r->bottom);
    probe("rect", label, probeResult);
}

/* How many top-level windows of class Progman there are. */
static int frames(void)
{
    HWND each = GetWindow(GetDesktopWindow(), GW_CHILD);
    char name[32];
    int count = 0;

    for (; each; each = GetWindow(each, GW_HWNDNEXT)) {
        GetClassName(each, name, sizeof(name));

        if (!lstrcmpi(name, "Progman")) {
            count++;
        }
    }

    return count;
}

static HWND waitFrame(void)
{
    HWND frame = NULL;
    int i;

    for (i = 0; i < 400 && !frame; i++) {
        settle(1);
        frame = FindWindow("Progman", NULL);
    }

    return frame;
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    HWND frame;
    HWND client;
    RECT r;
    char name[80];
    HINSTANCE instance;
    int i;

    (void)module;
    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);

    removeFile("C:\\WINDOWS\\PROGMAN.INI");
    removeFile("C:\\WINDOWS\\MAIN.GRP");
    removeFile("C:\\WINDOWS\\ACCESSOR.GRP");
    removeFile("C:\\WINDOWS\\STARTUP.GRP");

    wsprintf(probeResult, "%d", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32);
    probe("WinExec", "PROGMAN.EXE", probeResult);

    frame = waitFrame();
    probe("FindWindow", "Progman", frame ? "found" : "none");

    if (!frame) {
        probeFinish();
        return 0;
    }

    settle(20);

    /* What it is. */
    wsprintf(probeResult, "%d", GetModuleHandle("PROGMAN") != 0);
    probe("module", "PROGMAN", probeResult);
    instance = (HINSTANCE)GetWindowWord(frame, GWW_HINSTANCE);
    GetModuleFileName(instance, name, sizeof(name));
    probe("GetModuleFileName", "frame's instance", name);
    GetWindowText(frame, name, sizeof(name));
    probe("GetWindowText", "frame", name);
    wsprintf(probeResult, "%d", IsWindowVisible(frame) != 0);
    probe("visible", "frame", probeResult);
    GetWindowRect(frame, &r);
    rect("frame", &r);
    client = GetWindow(frame, GW_CHILD);
    GetClassName(client, name, sizeof(name));
    probe("GetClassName", "frame's child", name);
    GetClientRect(client, &r);
    rect("client", &r);
    wsprintf(probeResult, "%d", GetWindow(client, GW_CHILD) != 0);
    probe("groups", "client", probeResult);

    /* What it wrote as it started. */
    text("text", "started", "C:\\WINDOWS\\PROGMAN.INI");

    /* A second start: it hands the first the turn and ends. */
    wsprintf(probeResult, "%d", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32);
    probe("WinExec", "second", probeResult);
    settle(20);
    wsprintf(probeResult, "%d", frames());
    probe("frames", "after second", probeResult);
    wsprintf(probeResult, "%d", FindWindow("Progman", NULL) == frame);
    probe("FindWindow", "the first", probeResult);

    /* Closed. */
    PostMessage(frame, WM_CLOSE, 0, 0L);

    for (i = 0; i < 400 && IsWindow(frame); i++) {
        settle(1);
    }

    settle(20);
    probe("IsWindow", "closed", IsWindow(frame) ? "running" : "gone");
    text("saved", "closed", "C:\\WINDOWS\\PROGMAN.INI");
    wsprintf(probeResult, "%d", GetModuleHandle("PROGMAN") != 0);
    probe("left", "PROGMAN", probeResult);

    probeFinish();
    return 0;
}
