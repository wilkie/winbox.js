/*
 * The rest of GDI's spooler, called as a printer's driver and Print
 * Manager call it, each found in GDI by its number: `QueryJob`,
 * `DeleteSpoolPage` and `SpoolFile`, with `GetSpoolJob` where Print
 * Manager would give GDI its window and its disk space. The probe's window
 * stands for Print Manager's. Each job is to a file named as its port.
 *
 * * `query`: `QueryJob`'s answer, for a job and for what is not one,
 *   whether it is valid (30) and whether there is disk space (1004h).
 * * `spooljob`: `GetSpoolJob`'s answer.
 * * `call`: each other call's answer.
 * * `file`: a file's size, the sum of its bytes each by its place, and its
 *   first bytes.
 * * `message`: each message 1001h the window was sent, as `SpoolFile`
 *   hands a job to Print Manager: the size of the block the word names,
 *   the long, and the job's words 0, 2, 4, 6, 8, 0Ah, 110h and 112h, its
 *   name at 11Ah, and the size of the block at 13Ah.
 * * `broadcast`: each message 40h the window was sent, the word and the
 *   low word of the long.
 * * `spoolfile`: what `SpoolFile` answered: -1, or the size of the block
 *   it names; `freed`: the size of the block the last message named, once
 *   `SpoolFile` answered.
 *
 * WIN.INI is put back as it was at the end.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDISPOOL.OUT"
#define FIRST "C:\\ORACLE\\GDISPL1.PRN"
#define SECOND "C:\\ORACLE\\GDISPL2.PRN"
#define SPOOLED "C:\\ORACLE\\GDISPL3.PRN"
#define MISSING "C:\\ORACLE\\GDISPL9.PRN"
#define PRINTER "Probe Printer"

typedef int(FAR PASCAL *OPENJOB)(LPSTR, LPSTR, HDC);
typedef int(FAR PASCAL *JOBCALL)(int);
typedef int(FAR PASCAL *JOBWRITE)(int, LPSTR, WORD);
typedef int(FAR PASCAL *QUERYJOB)(int, int);
typedef HANDLE(FAR PASCAL *SPOOLFILE)(LPSTR, LPSTR, LPSTR, LPSTR);
typedef LONG(FAR PASCAL *GETSPOOLJOB)(int, LONG);

static OPENJOB openJob;
static JOBWRITE writeSpool;
static JOBCALL closeJob;
static JOBCALL startSpoolPage;
static JOBCALL endSpoolPage;
static QUERYJOB queryJob;
static JOBCALL deleteSpoolPage;
static SPOOLFILE spoolFile;
static GETSPOOLJOB getSpoolJob;

static LRESULT reply;
static HGLOBAL lastJob;

static void call(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

static void query(LPCSTR name, int job, int code)
{
    wsprintf(probeArgs, "%s %d", name, code);
    wsprintf(probeResult, "%d", queryJob(job, code));
    probe("query", probeArgs, probeResult);
}

static void spoolJob(LPCSTR name, int option, LONG param)
{
    wsprintf(probeArgs, "%s %x", name, option);
    wsprintf(probeResult, "%ld", getSpoolJob(option, param));
    probe("spooljob", probeArgs, probeResult);
}

static void described(LPCSTR name, LPCSTR path)
{
    static BYTE bytes[512];
    OFSTRUCT info;
    HFILE file = OpenFile(path, &info, OF_READ);
    WORD sum = 0;
    int read;
    int at;

    if (file == HFILE_ERROR) {
        probe("file", name, "none");
        return;
    }

    read = _lread(file, bytes, sizeof(bytes));
    _lclose(file);

    for (at = 0; at < read; at++) {
        sum += (WORD)(bytes[at] * (at + 1));
    }

    wsprintf(probeResult, "%d %u ", read, sum);

    for (at = 0; at < read && at < 24; at++) {
        wsprintf(probeResult + lstrlen(probeResult), "%02x", bytes[at]);
    }

    probe("file", name, probeResult);
}

static void spooled(LPCSTR name, LPSTR printer, LPSTR port, LPSTR path)
{
    HANDLE answer;

    lastJob = 0;
    answer = spoolFile(printer, port, "Probe document", path);

    if ((int)answer < 0 || answer == 0) {
        wsprintf(probeResult, "%d", (int)answer);
    } else {
        wsprintf(probeResult, "block %ld same %d query %d,%d", GlobalSize(answer),
                 answer == lastJob, queryJob((int)answer, 30), queryJob((int)answer >> 1, 30));
        GlobalFree(answer);
    }

    probe("spoolfile", name, probeResult);

    if (lastJob) {
        wsprintf(probeResult, "%ld", GlobalSize(lastJob));
        probe("freed", name, probeResult);
    }
}

LRESULT FAR PASCAL _export Catcher(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == 0x1001) {
        WORD FAR *job = (WORD FAR *)GlobalLock((HGLOBAL)wParam);

        lastJob = (HGLOBAL)wParam;

        if (job) {
            wsprintf(probeResult, "block %ld long %ld words %x %x %x %x %x %x %x %x name %s page %ld",
                     GlobalSize((HGLOBAL)wParam), lParam, job[0], job[1], job[2], job[3], job[4],
                     job[5], job[0x88], job[0x89], (LPSTR)job + 0x11a,
                     GlobalSize((HGLOBAL)job[0x9d]));
            GlobalUnlock((HGLOBAL)wParam);
        } else {
            wsprintf(probeResult, "block %ld long %ld", GlobalSize((HGLOBAL)wParam), lParam);
        }

        probe("message", "1001", probeResult);
        return reply;
    }

    if (message == 0x40) {
        wsprintf(probeArgs, "%u", wParam);
        wsprintf(probeResult, "%u", LOWORD(lParam));
        probe("broadcast", probeArgs, probeResult);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char pageOne[] = "page one\r\n";
    static char block[300];
    static char spoolerWas[32];
    WNDCLASS kind;
    HMODULE gdi;
    OFSTRUCT info;
    HWND window;
    HGLOBAL small, big;
    int job;
    int i;

    probeOpen(OUTPUT);
    OpenFile(FIRST, &info, OF_DELETE);
    OpenFile(SECOND, &info, OF_DELETE);
    OpenFile(MISSING, &info, OF_DELETE);
    GetProfileString("windows", "spooler", "", spoolerWas, sizeof(spoolerWas));

    gdi = GetModuleHandle("GDI");
    openJob = (OPENJOB)GetProcAddress(gdi, MAKEINTRESOURCE(240));
    writeSpool = (JOBWRITE)GetProcAddress(gdi, MAKEINTRESOURCE(241));
    closeJob = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(243));
    getSpoolJob = (GETSPOOLJOB)GetProcAddress(gdi, MAKEINTRESOURCE(245));
    startSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(246));
    endSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(247));
    queryJob = (QUERYJOB)GetProcAddress(gdi, MAKEINTRESOURCE(248));
    deleteSpoolPage = (JOBCALL)GetProcAddress(gdi, MAKEINTRESOURCE(253));
    spoolFile = (SPOOLFILE)GetProcAddress(gdi, MAKEINTRESOURCE(254));

    kind.style = 0;
    kind.lpfnWndProc = Catcher;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "GdiSpool";
    RegisterClass(&kind);
    window = CreateWindow("GdiSpool", "Spool", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL,
                          instance, NULL);

    for (i = 0; i < sizeof(block); i++) {
        block[i] = (char)('A' + i % 26);
    }

    /* QueryJob. */
    job = openJob(FIRST, "Probe", NULL);
    query("job", job, 30);
    query("job", job, 0);
    query("job", job, 29);
    query("job", job, 31);
    query("job", job, 0x1004);

    for (i = -6; i <= 0; i++) {
        wsprintf(probeArgs, "given %d", i);
        query(probeArgs, i, 30);
    }

    small = GlobalAlloc(GMEM_MOVEABLE, 0x100);
    big = GlobalAlloc(GMEM_MOVEABLE, 0x148);
    query("small block", (int)small >> 1, 30);
    query("big block", (int)big >> 1, 30);
    GlobalFree(small);
    GlobalFree(big);

    spoolJob("disk space", 0x1b, 0x12345678L);
    query("job", job, 0x1004);
    query("nought", 0, 0x1004);
    spoolJob("disk space", 0x1b, 0L);
    query("job", job, 0x1004);
    spoolJob("disk space", 0x1b, 0x10000L);
    query("job", job, 0x1004);
    spoolJob("no window", 0x15, 0L);
    query("job", job, 0x1004);

    /* DeleteSpoolPage, with no Print Manager. */
    call("StartSpoolPage", startSpoolPage(job));
    call("WriteSpool 10", writeSpool(job, pageOne, 10));
    call("EndSpoolPage", endSpoolPage(job));
    call("StartSpoolPage", startSpoolPage(job));
    call("WriteSpool 300", writeSpool(job, block, 300));
    call("DeleteSpoolPage", deleteSpoolPage(job));
    described("deleted", FIRST);
    call("WriteSpool 5", writeSpool(job, block + 5, 5));
    call("DeleteSpoolPage again", deleteSpoolPage(job));
    call("WriteSpool 7", writeSpool(job, block + 7, 7));
    call("EndSpoolPage", endSpoolPage(job));
    call("CloseJob", closeJob(job));
    described("closed", FIRST);
    call("DeleteSpoolPage closed", deleteSpoolPage(job));
    query("closed", job, 30);

    for (i = -6; i <= 0; i++) {
        wsprintf(probeArgs, "DeleteSpoolPage %d", i);
        call(probeArgs, deleteSpoolPage(i));
    }

    /* With the window as Print Manager's: a page's start is kept. */
    spoolJob("window", 0x15, (LONG)(WORD)window);
    job = openJob(SECOND, "Probe", NULL);
    call("StartSpoolPage", startSpoolPage(job));
    call("WriteSpool 300", writeSpool(job, block, 300));
    call("EndSpoolPage", endSpoolPage(job));
    call("StartSpoolPage", startSpoolPage(job));
    call("WriteSpool 10", writeSpool(job, pageOne, 10));
    call("WriteSpool 300", writeSpool(job, block + 1, 300));
    call("DeleteSpoolPage", deleteSpoolPage(job));
    described("deleted", SECOND);
    call("WriteSpool 10", writeSpool(job, pageOne, 10));
    call("CloseJob", closeJob(job));
    described("closed", SECOND);

    /* SpoolFile: no queue, then a printer of the probe's. */
    OpenFile(SPOOLED, &info, OF_CREATE | OF_WRITE);
    i = OpenFile(SPOOLED, &info, OF_WRITE);
    _lwrite(i, block, 123);
    _lclose(i);

    spooled("no queue", PRINTER, "LPT1:", SPOOLED);
    WriteProfileString("PrinterPorts", PRINTER, "PSCRIPT,LPT1:,15,45");
    spoolJob("readied", 0x19, 0L);
    spoolJob("again", 0x1f, 0L);
    spoolJob("readied", 0x19, 0L);
    spoolJob("queues", 0x1d, 0L);
    spoolJob("timeout", 0x20, 0L);
    spoolJob("timeout", 0x21, 0L);

    reply = 0x0777;
    spooled("queue", PRINTER, "LPT1:", SPOOLED);
    spooled("queue no colon", PRINTER, "lpt1", SPOOLED);
    spooled("other printer", "Other", "LPT1:", SPOOLED);
    spooled("other port", PRINTER, "LPT2:", SPOOLED);
    spooled("missing file", PRINTER, "LPT1:", MISSING);
    reply = -1L;
    spooled("refused", PRINTER, "LPT1:", SPOOLED);
    reply = 0xffffL;
    spooled("refused low", PRINTER, "LPT1:", SPOOLED);

    /* The spooler off, and no Print Manager. */
    spoolJob("no window", 0x15, 0L);
    WriteProfileString("windows", "spooler", "no");
    spoolJob("again", 0x1f, 0L);
    spooled("spooler off", PRINTER, "LPT1:", SPOOLED);
    wsprintf(probeResult, "%d", GetModuleHandle("PRINTMAN") != 0);
    probe("printman", "running", probeResult);

    WriteProfileString("PrinterPorts", PRINTER, NULL);
    WriteProfileString("windows", "spooler", spoolerWas[0] ? spoolerWas : NULL);
    spoolJob("again", 0x1f, 0L);
    spoolJob("readied", 0x19, 0L);

    OpenFile(SPOOLED, &info, OF_DELETE);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
