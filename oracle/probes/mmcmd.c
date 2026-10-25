/*
 * MCI's command tables: the number `mciLoadCommandResource` gives a table,
 * and what `mciFreeCommandResource` answers, as tables come and go -- the
 * probe's own, MMSYSTEM's core table, MCIWAVE's own and the waveaudio
 * type's, which opening and closing a device loads and lets go.
 *
 * * `load`: a table loaded from the probe's own resources, by name: a good
 *   one, one with no command in it, and one there is not.
 * * `free`: tables let go, again, and numbers there are none of.
 * * `open`, `close`: a waveaudio device opened and closed between them.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMCMD.OUT"

typedef UINT(FAR PASCAL *LOADPROC)(HINSTANCE, LPCSTR, UINT);
typedef BOOL(FAR PASCAL *FREEPROC)(UINT);

static HINSTANCE self;
static LOADPROC load;
static FREEPROC freeTable;

static UINT loaded(LPCSTR what, LPCSTR name, UINT type)
{
    UINT table = load(self, name, type);

    wsprintf(probeArgs, "%s,%s,%x", what, name, type);
    wsprintf(probeResult, "%x", table);
    probe("load", probeArgs, probeResult);
    return table;
}

static void freed(LPCSTR what, UINT table)
{
    wsprintf(probeArgs, "%s,%x", what, table);
    wsprintf(probeResult, "%d", freeTable(table));
    probe("free", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE mmsystem = GetModuleHandle("MMSYSTEM");
    MCI_OPEN_PARMS open;
    UINT first, second, third, fourth;
    DWORD result;
    UINT id;

    probeOpen(OUTPUT);
    self = instance;
    load = (LOADPROC)GetProcAddress(mmsystem, "MCILOADCOMMANDRESOURCE");
    freeTable = (FREEPROC)GetProcAddress(mmsystem, "MCIFREECOMMANDRESOURCE");

    freed("none-yet", 1);
    first = loaded("first", "MMCMDTBL", 0);
    loaded("empty", "EMPTYTBL", 0);
    loaded("missing", "NOSUCH", 0);
    second = loaded("second", "MMCMDTBL", 0x20a);
    freed("core", 0);
    freed("past", 0x20);
    freed("first", first);
    freed("first-again", first);
    third = loaded("third", "MMCMDTBL", 0);

    open.lpstrDeviceType = "waveaudio";
    result = mciSendCommand(0, MCI_OPEN, MCI_OPEN_TYPE, (DWORD)(LPVOID)&open);
    id = open.wDeviceID;
    wsprintf(probeResult, "%lx,%u", result, id);
    probe("open", "waveaudio", probeResult);

    fourth = loaded("fourth", "MMCMDTBL", 0);
    freed("two", 2);
    freed("three", 3);
    freed("four", 4);
    freed("five", 5);

    wsprintf(probeResult, "%lx", mciSendCommand(id, MCI_CLOSE, 0L, 0L));
    probe("close", "waveaudio", probeResult);

    loaded("after-close", "MMCMDTBL", 0);
    freed("two-after", 2);
    freed("three-after", 3);
    freed("second", second);
    freed("third", third);
    freed("fourth", fourth);

    probeFinish();

    return 0;
}
