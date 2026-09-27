/*
 * A library loaded by its whole path, as WinHelp loads COMMDLG:
 *
 * * `loadpath`: whether it loaded, its module's file name, whether its
 *   exports are found, what CommDlgExtendedError answers from it, and what
 *   GetFileTitle makes of a path.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOADPATH.OUT"

typedef DWORD(FAR PASCAL *ERRORPROC)(void);
typedef int(FAR PASCAL *TITLEPROC)(LPCSTR, LPSTR, UINT);

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    ERRORPROC error;
    TITLEPROC title;
    char name[128];

    probeOpen(OUTPUT);

    library = LoadLibrary("C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL");
    probe("loadpath", "loaded", (LPSTR)(library >= HINSTANCE_ERROR ? "yes" : "no"));

    if (library >= HINSTANCE_ERROR) {
        name[0] = '\0';
        GetModuleFileName(library, name, sizeof(name));
        probe("loadpath", "file", name);
        probe("loadpath", "GetOpenFileName",
              (LPSTR)(GetProcAddress(library, "GetOpenFileName") ? "found" : "none"));
        error = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");
        wsprintf(probeResult, "%lu", error ? error() : 0xffffffffUL);
        probe("loadpath", "CommDlgExtendedError", probeResult);
        title = (TITLEPROC)GetProcAddress(library, "GetFileTitle");
        lstrcpy(name, "untouched");
        wsprintf(probeResult, "%d:", title ? title("C:\\DIR\\FILE.TXT", name, sizeof(name)) : -99);
        lstrcat(probeResult, name);
        probe("loadpath", "GetFileTitle", probeResult);
        FreeLibrary(library);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
