/*
 * GDI's spooler, called as a printer's driver calls it: `OpenJob`,
 * `StartSpoolPage`, `WriteSpool`, `EndSpoolPage`, `WriteDialog`,
 * `CloseJob` and `DeleteJob`, each found in GDI by its number; and
 * `QueryAbort`. Each job is to a file named as its port. Recorded on the
 * installation with a printer, `vgaprint`, whose PostScript driver gives
 * the device context for the abort procedure.
 *
 * * `open`: what `OpenJob` answered -- for a job, the size of the block
 *   its handle, shifted back left, names.
 * * `message`: each message 40h a window of the probe's was sent, as
 *   GDI broadcasts it: the word, the low word of the long, and the size of
 *   the block the high word names (the job's, freed by then as it closes).
 * * `call`: each other call's answer.
 * * `size`: the file's size, or `none`.
 * * `head`: the file's first bytes.
 * * `abort`: the abort procedure's arguments, as it was called.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRSPOOL.OUT"
#define FIRST "C:\\ORACLE\\PRSPOOL1.PRN"
#define SECOND "C:\\ORACLE\\PRSPOOL2.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

typedef int(FAR PASCAL *OPENJOB)(LPSTR, LPSTR, HDC);
typedef int(FAR PASCAL *JOBCALL)(int);
typedef int(FAR PASCAL *JOBWRITE)(int, LPSTR, WORD);
typedef int(FAR PASCAL *JOBDELETE)(int, WORD);
typedef BOOL(FAR PASCAL *QUERYABORT)(HDC, int);

static OPENJOB openJob;
static JOBWRITE writeSpool;
static JOBWRITE writeDialog;
static JOBCALL closeJob;
static JOBDELETE deleteJob;
static JOBCALL startSpoolPage;
static JOBCALL endSpoolPage;
static QUERYABORT queryAbort;

static int job;
static HDC printer;

static void call(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

/* An answer of `OpenJob`: the size of the job's block, or the error. */
static void opened(LPCSTR name, int answer)
{
    if (answer > 0) {
        wsprintf(probeResult, "block %ld", GlobalSize((HGLOBAL)(answer << 1)));
    } else {
        wsprintf(probeResult, "%d", answer);
    }

    probe("open", name, probeResult);
}

static void sized(LPCSTR name, LPCSTR path)
{
    OFSTRUCT info;
    HFILE file = OpenFile(path, &info, OF_READ);

    if (file == HFILE_ERROR) {
        probe("size", name, "none");
        return;
    }

    wsprintf(probeResult, "%ld", _llseek(file, 0, 2));
    _lclose(file);
    probe("size", name, probeResult);
}

static void head(LPCSTR name, LPCSTR path)
{
    static char bytes[24];
    OFSTRUCT info;
    HFILE file = OpenFile(path, &info, OF_READ);
    int read;
    int at;

    if (file == HFILE_ERROR) {
        probe("head", name, "none");
        return;
    }

    read = _lread(file, bytes, 20);
    _lclose(file);

    for (at = 0; at < read; at++) {
        wsprintf(probeResult + at * 2, "%02x", (BYTE)bytes[at]);
    }

    probeResult[read * 2] = '\0';
    probe("head", name, probeResult);
}

LRESULT FAR PASCAL _export Catcher(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == 0x40) {
        wsprintf(probeArgs, "%u", wParam);
        wsprintf(probeResult, "%u,%ld", LOWORD(lParam), GlobalSize((HGLOBAL)HIWORD(lParam)));
        probe("message", probeArgs, probeResult);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

BOOL FAR PASCAL _export Aborting(HDC dc, int code)
{
    wsprintf(probeResult, "%d,%d", code, dc == printer);
    probe("abort", "called", probeResult);
    return 3;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char text[] = "hello\r\n";
    static char block[300];
    WNDCLASS kind;
    HMODULE gdi;
    OFSTRUCT info;
    FARPROC aborting;
    HDC screen;
    int second;
    int i;

    probeOpen(OUTPUT);
    OpenFile(FIRST, &info, OF_DELETE);
    OpenFile(SECOND, &info, OF_DELETE);

    gdi = GetModuleHandle("GDI");
    openJob = (OPENJOB)GetProcAddress(gdi, MAKEINTRESOURCE(240));
    writeSpool = (JOBWRITE)GetProcAddress(gdi, MAKEINTRESOURCE(241));
    writeDialog = (JOBWRITE)GetProcAddress(gdi, MAKEINTRESOURCE(242));
    closeJob = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(243));
    deleteJob = (JOBDELETE)GetProcAddress(gdi, MAKEINTRESOURCE(244));
    startSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(246));
    endSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(247));
    queryAbort = (QUERYABORT)GetProcAddress(gdi, MAKEINTRESOURCE(155));

    kind.style = 0;
    kind.lpfnWndProc = Catcher;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PrSpool";
    RegisterClass(&kind);
    CreateWindow("PrSpool", "Spool", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance,
                 NULL);

    for (i = 0; i < sizeof(block); i++) {
        block[i] = (char)('A' + i % 26);
    }

    opened("null", openJob(NULL, "Probe", NULL));
    opened("empty", openJob("", "Probe", NULL));

    job = openJob(FIRST, "Probe", NULL);
    opened("file", job);
    sized("opened", FIRST);

    call("StartSpoolPage", startSpoolPage(job));
    call("WriteSpool 7", writeSpool(job, text, 7));
    call("WriteSpool 300", writeSpool(job, block, 300));
    call("EndSpoolPage", endSpoolPage(job));
    call("WriteDialog", writeDialog(job, "Message", 7));
    call("WriteSpool 7 again", writeSpool(job, text, 7));
    call("CloseJob", closeJob(job));
    sized("closed", FIRST);
    head("closed", FIRST);
    call("WriteSpool closed", writeSpool(job, text, 7));

    call("StartSpoolPage -2", startSpoolPage(-2));
    call("WriteSpool -5", writeSpool(-5, text, 7));
    call("EndSpoolPage -1", endSpoolPage(-1));
    call("CloseJob -4", closeJob(-4));
    call("DeleteJob -3", deleteJob(-3, 0));
    call("WriteDialog -1", writeDialog(-1, "Message", 7));

    second = openJob(SECOND, "Second", NULL);
    opened("second", second);
    call("WriteSpool second", writeSpool(second, block, 300));
    call("DeleteJob", deleteJob(second, 0));
    sized("deleted", SECOND);

    call("QueryAbort none", queryAbort(NULL, 0));
    screen = GetDC(NULL);
    call("QueryAbort screen", queryAbort(screen, 0));
    ReleaseDC(NULL, screen);

    printer = CreateDC(DRIVER, DEVICE, FIRST, NULL);
    call("QueryAbort printer", queryAbort(printer, 0));
    aborting = MakeProcInstance((FARPROC)Aborting, instance);
    call("SetAbortProc is segment",
         SetAbortProc(printer, (ABORTPROC)aborting) == (int)HIWORD((DWORD)aborting));
    call("QueryAbort set", queryAbort(printer, 7));
    DeleteDC(printer);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
