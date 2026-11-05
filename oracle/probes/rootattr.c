/* rootattr: what DOS 4300h (get file attributes) answers for a drive's
 * root and for folders written with and without a trailing backslash.
 *
 * Microsoft's setup toolkit (SimTower's SETUP.EXE, MSCOMSTF/MSSHLSTF) checks
 * a destination such as C:\SIMTOWER by asking 4300h of it and, when it is
 * not there, of its parent, C:\; a path whose parent does not answer as a
 * folder it calls "not valid".
 *
 * DOSBox's C: is a folder of the host's (`localDrive`): its answer is the
 * host's `stat` of the path DOS_MakeName made, 20h, 10h added for a folder.
 * The last records ask of a file the same.
 *
 * Each record is `attr <path>`: the attributes in hex, or `error <n>`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ROOTATTR.OUT"

static void attr(LPCSTR path)
{
    unsigned attributes;
    unsigned error = _dos_getfileattr(path, &attributes);

    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        wsprintf(probeResult, "%02x", attributes);
    }

    probe("attr", path, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    attr("C:\\");
    attr("\\");
    attr("C:");
    attr("C:.");
    attr("C:\\.");
    attr("C:\\WINDOWS");
    attr("C:\\WINDOWS\\");
    attr("C:\\WINDOWS\\.");
    attr("C:\\WINDOWS\\..");
    attr("C:\\NOSUCH");
    attr("C:\\NOSUCH\\");
    attr("C:\\NOSUCH\\X");
    attr("C:\\..");
    attr("C:\\WINDOWS\\SYSTEM\\..");
    attr("C:\\WINDOWS\\WIN.INI");
    attr("C:\\WINDOWS\\WIN.INI\\");
    attr("C:\\WINDOWS\\WIN.INI\\X");
    attr("C:\\WINDOWS\\WIN.INI\\..");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
