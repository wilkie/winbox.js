/*
 * GetOpenFileName and GetSaveFileName asked for what they refuse, and
 * CommDlgExtendedError after each:
 *
 * * `struct`: a structure's size not 72 -- 0, 71, 73.
 * * `template`: OFN_ENABLETEMPLATE with no template's name, with no
 *   instance, and with a name the instance has no dialog of.
 * * `hook`: OFN_ENABLEHOOK with no hook.
 * * `name`: a file name COMMDLG's parser refuses, given as the dialog
 *   starts: the dialog ends at once. With OFN_NOVALIDATE it is let be and
 *   the dialog shown; its hook ends it at once by IDABORT with 7.
 * * `stale`: the error left by one call read after a call that succeeded
 *   (a hook that ends the dialog by IDABORT with 1).
 * * `flags`: the flags as the structure has them after a call that showed
 *   the dialog, for each flag asked for; and asked for without
 *   OFN_ENABLEHOOK, a hook's pointer given, the dialog cancelled by a
 *   timer: the flags, and `hook after`, whether the pointer was kept.
 */

#include "probe.h"
#include <commdlg.h>

#pragma library("commdlg")

#define OUTPUT "C:\\ORACLE\\OFNERR.OUT"

static OPENFILENAME ofn;
static char file[260];
static HINSTANCE self;
static WORD abortWith;

UINT FAR PASCAL _export Hook(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        PostMessage(dialog, WM_COMMAND, 3, MAKELPARAM(abortWith, 0));
        return TRUE;
    }

    (void)wParam;
    (void)lParam;
    return FALSE;
}

/* Ends a dialog its caller cannot reach: the active window cancelled. */
void FAR PASCAL _export Closer(HWND window, UINT message, UINT id, DWORD time)
{
    HWND active = GetActiveWindow();

    if (active) {
        PostMessage(active, WM_COMMAND, IDCANCEL, 0L);
    }

    (void)window;
    (void)message;
    (void)id;
    (void)time;
}

static void reset(void)
{
    _fmemset(&ofn, 0, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.lpstrFile = file;
    ofn.nMaxFile = sizeof(file);
    ofn.lpstrFilter = "All (*.*)\0*.*\0";
    file[0] = '\0';
}

static void run(LPCSTR what, LPCSTR args, BOOL save)
{
    BOOL answer = save ? GetSaveFileName(&ofn) : GetOpenFileName(&ofn);

    wsprintf(probeResult, "%d|%lx|flags=%lx|file=%s", answer ? 1 : 0, CommDlgExtendedError(),
             ofn.Flags, (LPSTR)file);
    probe(what, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    FARPROC hook;
    FARPROC closer;
    UINT timer;
    static const char *NAMES[] = {"A;B", "IN SIDE", "C:\\D*R\\X", "FILE.TEXT", "1:\\X",
                                  "*.TXT;*.DOC", "   ", "X.TXT"};
    static const DWORD FLAGS[] = {0, OFN_READONLY, OFN_HIDEREADONLY, OFN_SHOWHELP,
                                  OFN_FILEMUSTEXIST, OFN_CREATEPROMPT, OFN_NOCHANGEDIR,
                                  OFN_PATHMUSTEXIST, 0x70000000L, 0x80000000L};
    int i;

    probeOpen(OUTPUT);
    self = instance;
    hook = MakeProcInstance((FARPROC)Hook, instance);
    closer = MakeProcInstance((FARPROC)Closer, instance);

    reset();
    ofn.lStructSize = 0;
    run("struct", "0", FALSE);
    reset();
    ofn.lStructSize = 71;
    run("struct", "71", FALSE);
    reset();
    ofn.lStructSize = 73;
    run("struct", "73 save", TRUE);

    reset();
    ofn.Flags = OFN_ENABLETEMPLATE;
    ofn.hInstance = instance;
    run("template", "no name", FALSE);
    reset();
    ofn.Flags = OFN_ENABLETEMPLATE;
    ofn.lpTemplateName = "NOSUCH";
    run("template", "no instance", FALSE);
    reset();
    ofn.Flags = OFN_ENABLETEMPLATE;
    ofn.hInstance = instance;
    ofn.lpTemplateName = "NOSUCH";
    run("template", "not found", FALSE);
    reset();
    ofn.Flags = OFN_ENABLETEMPLATE;
    ofn.hInstance = instance;
    ofn.lpTemplateName = MAKEINTRESOURCE(1536);
    run("template", "1536 of the probe's", FALSE);

    reset();
    ofn.Flags = OFN_ENABLEHOOK;
    run("hook", "none", FALSE);

    for (i = 0; i < (int)(sizeof(NAMES) / sizeof(NAMES[0])); i++) {
        reset();
        lstrcpy(file, NAMES[i]);
        ofn.Flags = OFN_ENABLEHOOK;
        ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;
        abortWith = 7;
        run("name", NAMES[i], FALSE);
        reset();
        lstrcpy(file, NAMES[i]);
        ofn.Flags = OFN_ENABLEHOOK | OFN_NOVALIDATE;
        ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;
        run("name novalidate", NAMES[i], FALSE);
    }

    reset();
    ofn.lStructSize = 0;
    run("stale", "refused", FALSE);
    reset();
    ofn.Flags = OFN_ENABLEHOOK;
    ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;
    abortWith = 1;
    run("stale", "ended 1", FALSE);

    for (i = 0; i < (int)(sizeof(FLAGS) / sizeof(FLAGS[0])); i++) {
        reset();
        ofn.Flags = FLAGS[i] | OFN_ENABLEHOOK;
        ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;
        abortWith = 0;
        wsprintf(probeArgs, "%lx", FLAGS[i]);
        run("flags", probeArgs, i & 1);
        reset();
        ofn.Flags = FLAGS[i];
        ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))hook;
        timer = SetTimer(NULL, 0, 300, (TIMERPROC)closer);
        run("flags without hook", probeArgs, i & 1);
        KillTimer(NULL, timer);
        probe("hook after", probeArgs, ofn.lpfnHook ? (LPSTR) "kept" : (LPSTR) "cleared");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
