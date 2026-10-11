/*
 * drvres -- the display driver's own resources, as a program reaches them.
 *
 * Control Panel's Color builds its "Windows Default" scheme out of the
 * display driver's `OEMBIN` resource: it asks `GetModuleHandle("DISPLAY")`,
 * looks for the driver's `GetDriverResourceID` (ordinal 450) with
 * `GetProcAddress`, and finds resource 1 of type `OEMBIN` with
 * `FindResource` (`MAIN.CPL` seg6 `2922`). Its custom colours' palette is
 * resource 2 (seg6 `24ef`). USER reads resource 1 at start-up for its
 * metrics and its default colours (`USER.EXE` seg3 `0c9f`).
 *
 * So this does what they do and writes down what it finds: the driver's
 * file, whether ordinal 450 is there, each `OEMBIN` resource's size and
 * bytes, and the system colours and metrics USER took from it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRVRES.OUT"

/* Bytes to a record, as hex. */
#define ROW 32

static const char HEX[] = "0123456789abcdef";

static void dump(HINSTANCE display, LPCSTR name, LPCSTR label)
{
    HRSRC found = FindResource(display, name, "OEMBIN");
    HGLOBAL loaded;
    BYTE FAR *bytes;
    DWORD size;
    DWORD at;

    if (!found) {
        probe("FindResource", label, "null");
        return;
    }

    size = SizeofResource(display, found);
    wsprintf(probeResult, "found size=%ld", size);
    probe("FindResource", label, probeResult);

    loaded = LoadResource(display, found);
    bytes = loaded ? (BYTE FAR *)LockResource(loaded) : NULL;

    if (!bytes) {
        probe("LockResource", label, "null");
        return;
    }

    for (at = 0; at < size; at += ROW) {
        LPSTR out = probeResult;
        DWORD index;

        for (index = at; index < at + ROW && index < size; index++) {
            *out++ = HEX[(bytes[(int)index] >> 4) & 0x0f];
            *out++ = HEX[bytes[(int)index] & 0x0f];
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,+%04x", label, (int)at);
        probe("bytes", probeArgs, probeResult);
    }

    GlobalUnlock(loaded);
    FreeResource(loaded);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const int metrics[] = {
        SM_CXVSCROLL, SM_CYHSCROLL, SM_CXICON, SM_CYICON, SM_CXCURSOR, SM_CYCURSOR,
        SM_CXBORDER, SM_CYBORDER, SM_CYKANJIWINDOW, SM_CXHSCROLL, SM_CYVSCROLL,
    };
    HINSTANCE display;
    FARPROC resourceId;
    char file[128];
    int index;

    probeOpen(OUTPUT);

    display = GetModuleHandle("DISPLAY");
    probe("GetModuleHandle", "DISPLAY", display ? "nonzero" : "0");

    GetModuleFileName(display, file, sizeof(file));
    probe("GetModuleFileName", "DISPLAY", file);

    resourceId = GetProcAddress(display, MAKEINTRESOURCE(450));
    probe("GetProcAddress", "DISPLAY,450", resourceId ? "found" : "null");

    dump(display, MAKEINTRESOURCE(1), "1");
    dump(display, MAKEINTRESOURCE(2), "2");
    dump(display, "FONTS", "FONTS");
    dump(display, MAKEINTRESOURCE(3), "3");

    for (index = 0; index <= COLOR_BTNHIGHLIGHT; index++) {
        wsprintf(probeArgs, "%d", index);
        wsprintf(probeResult, "%06lx", GetSysColor(index));
        probe("GetSysColor", probeArgs, probeResult);
    }

    for (index = 0; index < (int)(sizeof(metrics) / sizeof(metrics[0])); index++) {
        wsprintf(probeArgs, "%d", metrics[index]);
        wsprintf(probeResult, "%d", GetSystemMetrics(metrics[index]));
        probe("GetSystemMetrics", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
