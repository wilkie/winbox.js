/*
 * The network calls with no network installed: what `WNetGetConnection` and
 * `WNetGetCaps` answer. File Manager asks each drive whether it is connected,
 * and takes a success for a network drive.
 *
 * Records `answer`: each call's answer, and for `WNetGetConnection` the size
 * it left and the text it wrote.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NETCAPS.OUT"

/* Not in the headers this probe is built with, though USER exports it. */
WORD FAR PASCAL WNetGetCaps(WORD index);

static void connection(LPSTR drive)
{
    char text[64];
    UINT size = sizeof(text);
    UINT result;

    lstrcpy(text, "#");
    result = WNetGetConnection(drive, text, &size);
    wsprintf(probeArgs, "connection,%s", (LPSTR)drive);
    wsprintf(probeResult, "%u,size=%u,text=%s", result, size, (LPSTR)text);
    probe("answer", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WORD index;

    probeOpen(OUTPUT);

    connection("A:");
    connection("C:");
    connection("Z:");

    for (index = 0; index <= 13; index++) {
        wsprintf(probeArgs, "caps,%u", index);
        wsprintf(probeResult, "%u", WNetGetCaps(index));
        probe("answer", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%u", WNetGetCaps(0xffff));
    probe("answer", "caps,65535", probeResult);

    probeFinish();

    return 0;
}
