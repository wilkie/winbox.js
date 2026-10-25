/*
 * SOUND's calls not in `sndplay`: GetThresholdEvent, before, while and
 * after the probe has the sound opened, as the pointer's offset and the
 * word it points at, or the offset alone where it is nought; OpenSound twice; DoBeep, which answers nothing
 * meaningful and is called for not failing; and WEP.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SNDDRV.OUT"

typedef int(FAR PASCAL *VOIDPROC)(void);
typedef LPINT(FAR PASCAL *EVENTPROC)(void);
typedef int(FAR PASCAL *INTPROC)(int);

static HMODULE driver;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(driver, MAKEINTRESOURCE(ordinal));
}

static void threshold(LPCSTR what)
{
    LPINT event = ((EVENTPROC)entry(14))();

    /* Only the offset where it is nought: the selector is then whatever
     * DX held as the call was made. */
    if (LOWORD((DWORD)event)) {
        wsprintf(probeResult, "%04x=%d", LOWORD((DWORD)event), *event);
    } else {
        lstrcpy(probeResult, "0000");
    }

    probe("threshold", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    driver = GetModuleHandle("SOUND");

    threshold("before");
    wsprintf(probeResult, "%d", ((VOIDPROC)entry(1))());
    probe("open", "first", probeResult);
    wsprintf(probeResult, "%d", ((VOIDPROC)entry(1))());
    probe("open", "again", probeResult);
    threshold("open");
    wsprintf(probeResult, "%d", ((VOIDPROC)entry(15))());
    probe("status", "open", probeResult);
    ((VOIDPROC)entry(2))();
    threshold("closed");
    wsprintf(probeResult, "%d", ((VOIDPROC)entry(15))());
    probe("status", "closed", probeResult);
    wsprintf(probeResult, "%d", ((VOIDPROC)entry(1))());
    probe("open", "after close", probeResult);
    threshold("open again");
    ((VOIDPROC)entry(2))();

    ((INTPROC)entry(17))(-1);
    probe("beep", "-1", "returned");
    ((INTPROC)entry(17))(0x30);
    probe("beep", "30h", "returned");

    wsprintf(probeResult, "%d", ((INTPROC)entry(18))(0));
    probe("wep", "0", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
