/*
 * SHELL's AboutDlgProc, the About box's procedure, given to a box of the
 * probe's own made from its template 100 (`aboutdp.rc`, with SHELL's
 * box's ids), with a block laid out as ShellAbout lays it: the icon at 0, the program's name at 2, the other
 * text at 6.
 *
 * * `made`: whether the box was made, its caption, the line under the
 *   name (101), the other text (115), and whether its icon control (111)
 *   has WS_VISIBLE -- with no icon, and with the program's own.
 * * `answer`: what the procedure answers WM_TIMER, which it does nothing
 *   for.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\ABOUTDP.OUT"

static struct {
    HICON icon;
    LPCSTR app;
    LPCSTR other;
} block;

static char app[64];
static HINSTANCE self;

static void one(LPCSTR name, HINSTANCE shell, FARPROC proc, HICON icon)
{
    HWND box;
    char caption[80];
    char line[80];
    char other[80];

    lstrcpy(app, "Probe App#The first line");
    block.icon = icon;
    block.app = app;
    block.other = "Other text";

    box = CreateDialogParam(self, MAKEINTRESOURCE(100), NULL, (DLGPROC)proc, (LPARAM)(LPVOID)&block);

    (void)shell;

    if (!box) {
        probe("made", name, "no box");
        return;
    }

    GetWindowText(box, caption, sizeof(caption));
    GetDlgItemText(box, 101, line, sizeof(line));
    GetDlgItemText(box, 115, other, sizeof(other));
    wsprintf(probeResult, "caption=%s,line=%s,other=%s,icon=%s", (LPSTR)caption, (LPSTR)line,
             (LPSTR)other, (LPSTR)(GetWindowLong(GetDlgItem(box, 111), GWL_STYLE) & WS_VISIBLE ? "shown" : "hidden"));
    probe("made", name, probeResult);
    DestroyWindow(box);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE shell = LoadLibrary("SHELL.DLL");
    FARPROC proc = GetProcAddress(shell, MAKEINTRESOURCE(33));

    self = instance;

    probeOpen(OUTPUT);

    one("no-icon", shell, proc, NULL);
    one("icon", shell, proc, LoadIcon(NULL, IDI_ASTERISK));

    wsprintf(probeResult, "%x",
             (WORD)((BOOL(FAR PASCAL *)(HWND, UINT, WPARAM, LPARAM))proc)(NULL, WM_TIMER, 0, 0L));
    probe("answer", "WM_TIMER", probeResult);

    FreeLibrary(shell);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
