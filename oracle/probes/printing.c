/*
 * Printing, as a program does it: the default printer from WIN.INI, a device
 * context for it, and a document of pages, by the Windows 3.1 calls and by
 * the older escapes. Only what does not depend on the printer's driver is
 * recorded: which calls succeed, in what order the abort procedure is
 * called, and what answers a call out of order gets.
 *
 * Print Manager's spooler is turned off first with `WriteProfileString`, and
 * the printer's output goes to a file named as its port, so no other program
 * runs and nothing waits on a printer.
 *
 * * `default`: whether WIN.INI names a default printer, as its device,
 *   driver and port.
 * * `dc`: whether `CreateDC` of it, the port a file, gave a device context.
 * * `call`: each call's answer, as its sign: `+` above nought, `0`, `-`
 *   below; the out-of-order calls exactly. `SetAbortProc` answers a number
 *   that is the driver's; only its sign is kept.
 * * `abort`: after the first document, whether the abort procedure was
 *   called, and whether every call was given the printer's device context
 *   and nought. How often is the driver's: GDI calls it as the driver's
 *   output is written, 43 times for the PostScript driver's `StartDoc`
 *   alone.
 * * `file`: whether the output file holds anything after the document.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRINTING.OUT"
#define PRINTED "C:\\ORACLE\\PRINTED.PRN"

static HDC printer;
static int abortCalls;
static int abortOther;

BOOL FAR PASCAL _export Abort(HDC hdc, int code)
{
    abortCalls++;

    if (hdc != printer || code != 0) {
        abortOther++;
    }

    return TRUE;
}

static void sign(LPCSTR name, int answer)
{
    probe("call", name, answer > 0 ? "+" : answer == 0 ? "0" : "-");
}

static void exact(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

static void aborted(LPCSTR after)
{
    wsprintf(probeResult, "%s,%s", (LPSTR)(abortCalls ? "called" : "not"),
             (LPSTR)(abortOther ? "other" : "printer0"));
    probe("abort", after, probeResult);
}

static void box(HDC hdc)
{
    Rectangle(hdc, 100, 100, 400, 300);
    TextOut(hdc, 120, 120, "Printed", 7);
}

static long sizeOf(LPCSTR path)
{
    OFSTRUCT info;
    HFILE file = OpenFile(path, &info, OF_READ);
    long size;

    if (file == HFILE_ERROR) {
        return -1;
    }

    size = _llseek(file, 0, 2);
    _lclose(file);
    return size;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char device[128];
    static DOCINFO doc = {sizeof(DOCINFO), "Probe", NULL};
    LPSTR name;
    LPSTR driver;
    LPSTR port;
    FARPROC proc;
    OFSTRUCT info;

    probeOpen(OUTPUT);

    WriteProfileString("windows", "spooler", "no");
    GetProfileString("windows", "device", "", device, sizeof(device));

    /* "device,driver,port" */
    name = device;
    driver = name;

    while (*driver && *driver != ',') {
        driver++;
    }

    if (*driver) {
        *driver++ = '\0';
    }

    port = driver;

    while (*port && *port != ',') {
        port++;
    }

    if (*port) {
        *port++ = '\0';
    }

    probe("default", "set", *name && *driver && *port ? "1" : "0");

    OpenFile(PRINTED, &info, OF_DELETE);
    printer = CreateDC(driver, name, PRINTED, NULL);
    probe("dc", "made", printer ? "1" : "0");

    if (!printer) {
        probeFinish();
        return 0;
    }

    proc = MakeProcInstance((FARPROC)Abort, instance);
    sign("SetAbortProc", SetAbortProc(printer, (ABORTPROC)proc));

    exact("StartPage before StartDoc", StartPage(printer));
    exact("EndPage before StartDoc", EndPage(printer));
    exact("EndDoc before StartDoc", EndDoc(printer));

    sign("StartDoc", StartDoc(printer, &doc));
    sign("StartPage", StartPage(printer));
    box(printer);
    sign("EndPage", EndPage(printer));
    sign("StartPage 2", StartPage(printer));
    box(printer);
    sign("EndPage 2", EndPage(printer));
    sign("EndDoc", EndDoc(printer));
    aborted("document");
    aborted("EndDoc");
    probe("file", "document", sizeOf(PRINTED) > 0 ? "1" : "0");

    /* By the escapes. */
    OpenFile(PRINTED, &info, OF_DELETE);
    sign("Escape STARTDOC", Escape(printer, STARTDOC, 3, "Esc", NULL));
    box(printer);
    sign("Escape NEWFRAME", Escape(printer, NEWFRAME, 0, NULL, NULL));
    sign("Escape ENDDOC", Escape(printer, ENDDOC, 0, NULL, NULL));
    probe("file", "escapes", sizeOf(PRINTED) > 0 ? "1" : "0");

    /* Abandoned. */
    OpenFile(PRINTED, &info, OF_DELETE);
    sign("StartDoc 3", StartDoc(printer, &doc));
    sign("StartPage 3", StartPage(printer));
    box(printer);
    sign("AbortDoc", AbortDoc(printer));
    exact("EndPage after AbortDoc", EndPage(printer));
    exact("EndDoc after AbortDoc", EndDoc(printer));

    DeleteDC(printer);
    FreeProcInstance(proc);
    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
