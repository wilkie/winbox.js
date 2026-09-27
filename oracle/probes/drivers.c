/*
 * The installable drivers USER keeps, as `GetNextDriver` walks them: Control
 * Panel walks them for applets of their own, such as the MIDI Mapper's.
 *
 * * `walk`: each driver in turn, as its alias from `GetDriverInfo` and its
 *   module's file name, walked forwards (flags 0), backwards (2), and first
 *   instances only (1).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRIVERS.OUT"

typedef struct {
    UINT length;
    HANDLE hDriver;
    HINSTANCE hModule;
    char szAliasName[128];
} DRIVERINFO;

typedef HANDLE(FAR PASCAL *NEXTPROC)(HANDLE, DWORD);
typedef BOOL(FAR PASCAL *INFOPROC)(HANDLE, DRIVERINFO FAR *);
typedef HINSTANCE(FAR PASCAL *MODULEPROC)(HANDLE);

static NEXTPROC next;
static INFOPROC info;
static MODULEPROC module;

static void walk(LPCSTR what, DWORD flags)
{
    static char list[1500];
    char file[128];
    char one[200];
    DRIVERINFO driver;
    HANDLE handle;
    int count;
    LPSTR base;
    LPSTR at;

    list[0] = '\0';
    count = 0;
    handle = next(0, flags);

    while (handle && count < 16) {
        driver.length = sizeof(driver);
        driver.szAliasName[0] = '\0';

        if (!info(handle, &driver)) {
            lstrcpy(driver.szAliasName, "?");
        }

        file[0] = '\0';
        GetModuleFileName(module(handle), file, sizeof(file));
        base = file;

        for (at = file; *at; at++) {
            if (*at == '\\') {
                base = at + 1;
            }
        }

        wsprintf(one, "%s%s=%s", (LPSTR)(count ? "," : ""), (LPSTR)driver.szAliasName, base);

        if (lstrlen(list) + lstrlen(one) < sizeof(list) - 1) {
            lstrcat(list, one);
        }

        count++;
        handle = next(handle, flags);
    }

    wsprintf(probeResult, "%d:", count);
    lstrcat(probeResult, list);
    probe("walk", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE user;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    next = (NEXTPROC)GetProcAddress(user, MAKEINTRESOURCE(257));
    info = (INFOPROC)GetProcAddress(user, MAKEINTRESOURCE(256));
    module = (MODULEPROC)GetProcAddress(user, MAKEINTRESOURCE(254));

    walk("forwards", 0);
    walk("backwards", 2);
    walk("first-instances", 1);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
