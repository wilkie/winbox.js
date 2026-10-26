/*
 * The keyboard driver's Enable and Disable, which USER calls to take the
 * keyboard's interrupt and give it back. The driver's data is its instance
 * (`LoadLibrary("KEYBOARD")`); the BIOS's shift flags are at 40:17h.
 *
 * * `before`: after a call of the driver's `GetKeyboardType`, whether the
 *   event procedure the driver keeps (its data at
 *   FAh) is USER's `keybd_event`, and whether it is enabled (12Eh).
 * * `enable`: Enable again with the procedure it had and a key-state table
 *   of 256 bytes all EEh: the bytes it set (10h, 11h, 12h, 14h, 90h, 91h)
 *   against the BIOS's flags, one it did not (13h), and AX.
 * * `disable`: Disable: whether it is enabled after, and the BIOS's flags'
 *   bits 8 and 9 before and after; then Enable once more: enabled.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <string.h>

#define OUTPUT "C:\\ORACLE\\KBENABLE.OUT"

typedef WORD(FAR PASCAL *Enable)(FARPROC, LPBYTE);
typedef WORD(FAR PASCAL *Disable)(void);

static BYTE state[256];

static WORD bios(void)
{
    WORD selector = (WORD)(DWORD)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(193));

    return *(WORD FAR *)MAKELP(selector, 0x17);
}

/* What a BIOS flag's bit gives a key-state byte: `on` where it is set. */
static LPSTR as(WORD flags, WORD bit, BYTE byte, BYTE on)
{
    if (byte == ((flags & bit) ? on : 0)) {
        return "bios";
    }

    return byte == 0xee ? "untouched" : "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE keyboard = LoadLibrary("KEYBOARD");
    HMODULE user = GetModuleHandle("USER");
    WORD data = (WORD)keyboard;
    FARPROC proc;
    Enable enable = (Enable)GetProcAddress(keyboard, MAKEINTRESOURCE(2));
    Disable disable = (Disable)GetProcAddress(keyboard, MAKEINTRESOURCE(3));
    WORD flags;
    WORD answer;
    WORD after;

    probeOpen(OUTPUT);

    /* A call of the driver's first, so that its state is laid out where a
     * driver lays it out as it is first called. */
    ((WORD(FAR PASCAL *)(int))GetProcAddress(keyboard, "GetKeyboardType"))(0);
    proc = *(FARPROC FAR *)MAKELP(data, 0xfa);

    wsprintf(probeResult, "proc=%s,enabled=%x",
             (LPSTR)(proc == GetProcAddress(user, "keybd_event") ? "keybd_event"
                     : proc                                     ? "other"
                                                                : "0"),
             (WORD) * (BYTE FAR *)MAKELP(data, 0x12e));
    probe("kb", "before", probeResult);

    _fmemset(state, 0xee, sizeof(state));
    flags = bios();
    answer = enable(proc, state);
    wsprintf(probeResult, "shift=%s,control=%s,alt=%s,caps=%s,num=%s,scroll=%s,13=%x",
             as(flags, 0x03, state[0x10], 0x80), as(flags, 0x04, state[0x11], 0x80),
             as(flags, 0x08, state[0x12], 0x80), as(flags, 0x40, state[0x14], 1),
             as(flags, 0x20, state[0x90], 1), as(flags, 0x10, state[0x91], 1), (WORD)state[0x13]);
    probe("kb", "enable", probeResult);

    flags = bios();
    disable();
    after = bios();
    wsprintf(probeResult, "enabled=%x,bits=%x,%x", (WORD) * (BYTE FAR *)MAKELP(data, 0x12e),
             flags & 0x0300, after & 0x0300);
    probe("kb", "disable", probeResult);

    enable(proc, state);
    wsprintf(probeResult, "enabled=%x", (WORD) * (BYTE FAR *)MAKELP(data, 0x12e));
    probe("kb", "enable-again", probeResult);

    FreeLibrary(keyboard);
    probeFinish();

    (void)answer;
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
