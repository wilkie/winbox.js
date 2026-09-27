/*
 * The MCI devices `SYSTEM.INI`'s `[mci]` names, asked as Media Player asks
 * as it starts: each opened by its type, its capabilities and product asked,
 * and closed. The installation has no sound driver, `MCIWAVE.DRV` and
 * `MCISEQ.DRV` but no `MCICDA.DRV`.
 *
 * * `open`: what opening a device by type answered, in hexadecimal, and
 *   whether a device ID came back.
 * * `caps`: for an opened device, each capability item 1 to 11 as
 *   `item=answer/value`, the value in hexadecimal.
 * * `info`: its product name, `MCI_INFO_PRODUCT`: the answer, and the text.
 * * `close`: what closing it answered.
 * * `error`: `mciGetErrorString` for each error an open answered.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MCIDEVS.OUT"

static void device(LPCSTR type)
{
    MCI_OPEN_PARMS open;
    MCI_GETDEVCAPS_PARMS caps;
    MCI_INFO_PARMS info;
    MCI_GENERIC_PARMS generic;
    DWORD answer;
    char text[1024];
    char one[64];
    char product[128];
    DWORD item;

    open.dwCallback = 0;
    open.wDeviceID = 0;
    open.lpstrDeviceType = type;
    open.lpstrElementName = NULL;
    open.lpstrAlias = NULL;
    answer = mciSendCommand(0, MCI_OPEN, MCI_OPEN_TYPE, (DWORD)(LPVOID)&open);
    wsprintf(probeResult, "%lx,%s", answer, (LPSTR)(open.wDeviceID ? "id" : "none"));
    probe("open", type, probeResult);

    if (answer) {
        mciGetErrorString(answer, text, sizeof(text));
        probe("error", type, text);
        return;
    }

    text[0] = '\0';

    for (item = 1; item <= 11; item++) {
        caps.dwCallback = 0;
        caps.dwReturn = 0xdeadL;
        caps.dwItem = item;
        answer = mciSendCommand(open.wDeviceID, MCI_GETDEVCAPS, MCI_GETDEVCAPS_ITEM,
                                (DWORD)(LPVOID)&caps);
        wsprintf(one, "%s%lu=%lx/%lx", (LPSTR)(item > 1 ? "," : ""), item, answer, caps.dwReturn);
        lstrcat(text, one);
    }

    probe("caps", type, text);

    product[0] = '\0';
    info.dwCallback = 0;
    info.lpstrReturn = product;
    info.dwRetSize = sizeof(product);
    answer = mciSendCommand(open.wDeviceID, MCI_INFO, MCI_INFO_PRODUCT, (DWORD)(LPVOID)&info);
    wsprintf(probeResult, "%lx,%s", answer, (LPSTR)product);
    probe("info", type, probeResult);

    generic.dwCallback = 0;
    wsprintf(probeResult, "%lx", mciSendCommand(open.wDeviceID, MCI_CLOSE, 0, (DWORD)(LPVOID)&generic));
    probe("close", type, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    device("WaveAudio");
    device("Sequencer");
    device("CDAudio");
    device("NoSuchDevice");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
