/*
 * The program `mmioext.c` starts, to end with files of MMSYSTEM's open:
 *
 * * CHILD1.DAT made with a buffer of MMSYSTEM's, ten bytes written into the
 *   buffer and never flushed;
 * * the I/O procedure `CHD ` installed for the task and `GLB ` for every
 *   task, both this program's `ChildProc`, which writes each message it is
 *   sent to CHILDLOG.TXT -- the message, in hex, a line each -- and answers
 *   nought;
 * * a file `X.CHD+Y` opened through `CHD `.
 *
 * It sends the probe's window `WM_USER` with the two files' handles, and
 * then returns from WinMain without closing anything.
 */

#include <windows.h>
#include <mmsystem.h>

#define LOG "C:\\ORACLE\\CHILDLOG.TXT"

static void note(LPCSTR text)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

LRESULT FAR PASCAL _export ChildProc(LPSTR lpmmioinfo, UINT msg, LPARAM lParam1, LPARAM lParam2)
{
    char line[40];

    wsprintf(line, "%x", msg);
    note(line);
    (void)lpmmioinfo;
    (void)lParam1;
    (void)lParam2;
    return 0;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    LPMMIOPROC proc = (LPMMIOPROC)MakeProcInstance((FARPROC)ChildProc, instance);
    HMMIO first;
    HMMIO second;
    HWND probe;

    first = mmioOpen("C:\\ORACLE\\CHILD1.DAT", NULL, MMIO_CREATE | MMIO_WRITE | MMIO_ALLOCBUF);
    mmioWrite(first, "0123456789", 10);
    mmioInstallIOProc(mmioFOURCC('C', 'H', 'D', ' '), proc, MMIO_INSTALLPROC);
    mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), proc, MMIO_INSTALLPROC | MMIO_GLOBALPROC);
    second = mmioOpen("X.CHD+Y", NULL, MMIO_READ);

    probe = FindWindow("MmioExt", NULL);
    SendMessage(probe, WM_USER, (WPARAM)first, MAKELPARAM(second, 0));

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
