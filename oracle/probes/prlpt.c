/*
 * GDI's spooler with a job to a printer's port, `LPT1`, Print Manager's
 * spooler off: what `OpenJob`, `WriteSpool` and `CloseJob` answer, each
 * found in GDI by its number, on the installation with a printer,
 * `vgaprint`, whose `[PrinterPorts]` names `LPT1` for its printer (the
 * probe writes the line again, as Setup does). Each
 * record is closed into the file as it is written, so a port that stops
 * Windows leaves the records before it.
 *
 * The port has no printer, so the write puts up GDI's box, system-modal:
 * a timer of the probe's, which the box's own loop runs, reads it and
 * presses its Cancel.
 *
 * * `open`: what `OpenJob` answered -- for a job, the size of the block
 *   its handle, shifted back left, names.
 * * `call`: each other call's answer.
 * * `box`: the box's title, and each of its windows' number and text.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRLPT.OUT"

typedef int(FAR PASCAL *OPENJOB)(LPSTR, LPSTR, HDC);
typedef int(FAR PASCAL *JOBCALL)(int);
typedef int(FAR PASCAL *JOBWRITE)(int, LPSTR, WORD);

static UINT timer;
static HINSTANCE self;

BOOL FAR PASCAL _export Child(HWND window, LPARAM data)
{
    char text[300];

    GetWindowText(window, text, sizeof(text));
    wsprintf(probeArgs, "%d", GetDlgCtrlID(window));
    probe("box", probeArgs, text);
    (void)data;
    return TRUE;
}

void FAR PASCAL _export Cancelling(HWND window, UINT message, UINT id, DWORD time)
{
    static char title[100];
    HWND box = GetActiveWindow();

    if (!box) {
        return;
    }

    KillTimer(NULL, timer);
    GetWindowText(box, title, sizeof(title));
    probe("box", "title", title);
    EnumChildWindows(box, (WNDENUMPROC)MakeProcInstance((FARPROC)Child, self), 0);
    PostMessage(box, WM_COMMAND, IDCANCEL, 0);
    (void)window;
    (void)message;
    (void)id;
    (void)time;
}

static void call(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char text[] = "hello\r\n";
    HMODULE gdi;
    OPENJOB openJob;
    JOBWRITE writeSpool;
    JOBCALL closeJob;
    JOBCALL startSpoolPage;
    int job;

    self = instance;
    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");

    /* The printer on the port, as Setup writes it: so the port is one of
     * `[PrinterPorts]`'s on any installation. */
    WriteProfileString("PrinterPorts", "Apple LaserWriter Plus", "pscript,LPT1:,15,90");

    gdi = GetModuleHandle("GDI");
    openJob = (OPENJOB)GetProcAddress(gdi, MAKEINTRESOURCE(240));
    writeSpool = (JOBWRITE)GetProcAddress(gdi, MAKEINTRESOURCE(241));
    closeJob = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(243));
    startSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(246));

    probe("begin", "", "");
    job = openJob("LPT1:", "Port", NULL);

    if (job > 0) {
        wsprintf(probeResult, "block %ld", GlobalSize((HGLOBAL)(job << 1)));
    } else {
        wsprintf(probeResult, "%d", job);
    }

    probe("open", "LPT1", probeResult);
    call("StartSpoolPage", startSpoolPage(job));
    timer = SetTimer(NULL, 0, 1000, (TIMERPROC)MakeProcInstance((FARPROC)Cancelling, instance));
    call("WriteSpool", writeSpool(job, text, 7));
    call("CloseJob", closeJob(job));

    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
