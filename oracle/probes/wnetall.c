/*
 * USER's network calls with no network driver installed, each with
 * arguments it takes. Each record is the answer in decimal.
 *
 * * `ok`: every call.
 * * `text`: WNetErrorText for a few codes, the answer and the text.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\WNETALL.OUT"

typedef WORD(FAR PASCAL *P0)(void);
typedef WORD(FAR PASCAL *P1W)(WORD);
typedef WORD(FAR PASCAL *P1L)(LPVOID);
typedef WORD(FAR PASCAL *PLW)(LPVOID, WORD);
typedef WORD(FAR PASCAL *PWL)(WORD, LPVOID);
typedef WORD(FAR PASCAL *PLL)(LPVOID, LPVOID);
typedef WORD(FAR PASCAL *PLLL)(LPVOID, LPVOID, LPVOID);
typedef WORD(FAR PASCAL *PLWW)(LPVOID, WORD, WORD);
typedef WORD(FAR PASCAL *PWWL)(WORD, WORD, LPVOID);
typedef WORD(FAR PASCAL *PWLW)(WORD, LPVOID, WORD);
typedef WORD(FAR PASCAL *PWLL)(WORD, LPVOID, LPVOID);
typedef WORD(FAR PASCAL *PWLLW)(WORD, LPVOID, LPVOID, WORD);
typedef WORD(FAR PASCAL *PLLWL)(LPVOID, LPVOID, WORD, LPVOID);
typedef WORD(FAR PASCAL *PWLWW)(WORD, LPVOID, WORD, WORD);
typedef WORD(FAR PASCAL *PLWLW)(LPVOID, WORD, LPVOID, WORD);
typedef WORD(FAR PASCAL *PWW)(WORD, WORD);
typedef WORD(FAR PASCAL *PWWLX)(WORD, WORD, LPVOID);

static HMODULE user;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

static void answer(LPCSTR kind, LPCSTR what, WORD value)
{
    wsprintf(probeResult, "%u", value);
    probe(kind, what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char buffer[128];
    WORD size;
    WORD word;
    LPVOID data;
    HWND window;
    int code;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");
    window = CreateWindow("STATIC", "", WS_POPUP, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    answer("ok", "WNetOpenJob", ((PLLWL)entry(501))("LPT1:", "title", 1, &word));
    answer("ok", "WNetCloseJob", ((PWLL)entry(502))(5, &word, buffer));
    answer("ok", "WNetAbortJob", ((PLW)entry(503))("LPT1:", 5));
    answer("ok", "WNetHoldJob", ((PLW)entry(504))("LPT1:", 1));
    answer("ok", "WNetReleaseJob", ((PLW)entry(505))("LPT1:", 1));
    answer("ok", "WNetCancelJob", ((PLW)entry(506))("LPT1:", 1));
    answer("ok", "WNetSetJobCopies", ((PLWW)entry(507))("LPT1:", 1, 2));
    answer("ok", "WNetWatchQueue", ((PWLLW)entry(508))((WORD)window, "LPT1:", "me", 0));
    answer("ok", "WNetUnwatchQueue", ((P1L)entry(509))("LPT1:"));
    answer("ok", "WNetLockQueueData", ((PLLL)entry(510))("LPT1:", "me", &data));
    answer("ok", "WNetUnlockQueueData", ((P1L)entry(511))("LPT1:"));
    size = sizeof(buffer);
    answer("ok", "WNetGetConnection", ((PLLL)entry(512))("C:", buffer, &size));
    answer("ok", "WNetGetCaps 1", ((P1W)entry(513))(1));
    answer("ok", "WNetDeviceMode", ((P1W)entry(514))((WORD)window));
    answer("ok", "WNetDeviceMode null", ((P1W)entry(514))(0));
    answer("ok", "WNetBrowseDialog", ((PWWL)entry(515))((WORD)window, 1, buffer));
    size = sizeof(buffer);
    answer("ok", "WNetGetUser", ((PLL)entry(516))(buffer, &size));
    answer("ok", "WNetAddConnection", ((PLLL)entry(517))("\\\\SERVER\\SHARE", "", "E:"));
    answer("ok", "WNetCancelConnection", ((PLW)entry(518))("E:", 0));
    answer("ok", "WNetGetError", ((P1L)entry(519))(&word));
    size = sizeof(buffer);
    answer("ok", "WNetGetErrorText", ((PWLL)entry(520))(1, buffer, &size));
    answer("ok", "WNetEnable", ((P0)entry(521))());
    answer("ok", "WNetDisable", ((P0)entry(522))());
    answer("ok", "WNetRestoreConnection", ((PWL)entry(523))((WORD)window, "E:"));
    answer("ok", "WNetWriteJob", ((PWLL)entry(524))(5, buffer, &size));
    answer("ok", "WNetConnectDialog", ((PWW)entry(525))((WORD)window, 1));
    answer("ok", "WNetDisconnectDialog", ((PWW)entry(526))((WORD)window, 1));
    answer("ok", "WNetConnectionDialog", ((PWW)entry(527))((WORD)window, 1));
    answer("ok", "WNetViewQueueDialog", ((PWL)entry(528))((WORD)window, "LPT1:"));
    answer("ok", "WNetPropertyDialog", ((PWWLX)entry(529))((WORD)window, 0, "LPT1:"));
    answer("ok", "WNetGetDirectoryType", ((PLL)entry(530))("E:\\", &word));
    answer("ok", "WNetDirectoryNotify", ((PWLW)entry(531))((WORD)window, "E:\\", 1));
    answer("ok", "WNetGetPropertyText", ((PWWLX)entry(532))(0, 0, "LPT1:"));

    for (code = 0; code < 12; code++) {
        lstrcpy(buffer, "########");
        word = ((PWLW)entry(499))(code, buffer, sizeof(buffer));
        wsprintf(probeArgs, "%d", code);
        wsprintf(probeResult, "%u:%s", word, (LPSTR)buffer);
        probe("text", probeArgs, probeResult);
    }

    lstrcpy(buffer, "########");
    word = ((PWLW)entry(499))(0x45, buffer, sizeof(buffer));
    wsprintf(probeResult, "%u:%s", word, (LPSTR)buffer);
    probe("text", "45h", probeResult);
    lstrcpy(buffer, "########");
    word = ((PWLW)entry(499))(1, buffer, 8);
    wsprintf(probeResult, "%u:%s", word, (LPSTR)buffer);
    probe("text", "1 in 8", probeResult);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
