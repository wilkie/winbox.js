/*
 * What `GetDriveType` answers for each drive number, 0 for A: to 25 for Z:,
 * and for numbers past them. File Manager shows a drive for each letter it
 * does not answer nought for.
 *
 * The oracle's Windows runs under DOSBox, whose drives are its own: the
 * installation's C:, and DOSBox's Z:.
 *
 * Records `answer`: each drive's type.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRIVETYP.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int drive;

    probeOpen(OUTPUT);

    for (drive = 0; drive < 28; drive++) {
        wsprintf(probeArgs, "%d", drive);
        wsprintf(probeResult, "%u", GetDriveType(drive));
        probe("answer", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%u", GetDriveType(-1));
    probe("answer", "-1", probeResult);

    probeFinish();

    return 0;
}
