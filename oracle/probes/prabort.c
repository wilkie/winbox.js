/*
 * Documents printed through the PostScript driver to a file, Print
 * Manager's spooler off, that do not go as planned: an abort procedure
 * that says to stop, a document dropped partway, a document on an
 * information context, and a document printed by the escapes, with the
 * abort procedure counted as each is written. Recorded on the
 * installation with a printer, `vgaprint`.
 *
 * * `call`: each call's answer.
 * * `calls`: how many times the abort procedure had been called, and the
 *   codes it was given, added together.
 * * `size`: the file's size once a document is done, or `none`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRABORT.OUT"
#define PRINTED "C:\\ORACLE\\PRABORT.PRN"
#define DRIVER "pscript"
#define DEVICE "Apple LaserWriter Plus"

static int calls;
static int codes;
static int limit;
static int others;
static HDC printer;

BOOL FAR PASCAL _export Aborting(HDC dc, int code)
{
    calls++;
    codes += code;

    if (dc != printer) {
        others++;
    }

    return limit == 0 || calls < limit;
}

static void call(LPCSTR name, int answer)
{
    wsprintf(probeResult, "%d", answer);
    probe("call", name, probeResult);
}

static void counted(LPCSTR name)
{
    wsprintf(probeResult, "%d,%d,%d", calls, codes, others);
    probe("calls", name, probeResult);
}

static void sized(LPCSTR name)
{
    OFSTRUCT info;
    HFILE file = OpenFile(PRINTED, &info, OF_READ);

    if (file == HFILE_ERROR) {
        probe("size", name, "none");
        return;
    }

    wsprintf(probeResult, "%ld", _llseek(file, 0, 2));
    _lclose(file);
    probe("size", name, probeResult);
}

static void begin(FARPROC aborting, int stop)
{
    OFSTRUCT info;

    OpenFile(PRINTED, &info, OF_DELETE);
    calls = 0;
    codes = 0;
    others = 0;
    limit = stop;
    printer = CreateDC(DRIVER, DEVICE, PRINTED, NULL);
    SetAbortProc(printer, (ABORTPROC)aborting);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static DOCINFO doc = {sizeof(DOCINFO), "Probe", NULL};
    static char name[] = "Escaped";
    FARPROC aborting;
    HDC ic;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    aborting = MakeProcInstance((FARPROC)Aborting, instance);

    /* The abort procedure says to stop at its fifth call. */
    begin(aborting, 5);
    call("StartDoc stopped", StartDoc(printer, &doc));
    counted("StartDoc stopped");
    call("StartPage stopped", StartPage(printer));
    call("EndPage stopped", EndPage(printer));
    call("EndDoc stopped", EndDoc(printer));
    counted("EndDoc stopped");
    call("DeleteDC stopped", DeleteDC(printer));
    sized("stopped");

    /* A document dropped with its page drawn. */
    begin(aborting, 0);
    call("StartDoc dropped", StartDoc(printer, &doc));
    call("StartPage dropped", StartPage(printer));
    call("TextOut dropped", TextOut(printer, 300, 300, "Dropped", 7));
    call("AbortDoc dropped", AbortDoc(printer));
    counted("AbortDoc dropped");
    sized("dropped");
    call("EndPage dropped", EndPage(printer));
    call("EndDoc dropped", EndDoc(printer));
    call("DeleteDC dropped", DeleteDC(printer));
    sized("dropped deleted");

    /* A document on an information context. */
    ic = CreateIC(DRIVER, DEVICE, PRINTED, NULL);
    call("StartDoc ic", StartDoc(ic, &doc));
    call("EndDoc ic", EndDoc(ic));
    call("DeleteDC ic", DeleteDC(ic));

    /* A document of two pages by the escapes, the abort procedure counted. */
    begin(aborting, 0);
    call("Escape STARTDOC", Escape(printer, STARTDOC, lstrlen(name), name, NULL));
    counted("STARTDOC");
    call("Escape NEWFRAME", Escape(printer, NEWFRAME, 0, NULL, NULL) > 0);
    counted("NEWFRAME");
    call("TextOut", TextOut(printer, 300, 300, "Second", 6));
    call("Escape NEWFRAME again", Escape(printer, NEWFRAME, 0, NULL, NULL) > 0);
    counted("NEWFRAME again");
    call("Escape ENDDOC", Escape(printer, ENDDOC, 0, NULL, NULL));
    counted("ENDDOC");
    call("DeleteDC escaped", DeleteDC(printer));
    sized("escaped");

    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
