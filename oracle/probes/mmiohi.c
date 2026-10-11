/*
 * mmioStringToFOURCC with MMIO_TOUPPER and bytes of 80h and above.
 *
 * MMSYSTEM hands `AnsiUpper` each byte as a far pointer made of the byte
 * widened with its sign (`MMSYSTEM.DLL` seg7 `0f47`, `cbw`, `cwd`): a byte
 * under 80h has a high word of nought, a character; one of 80h and above a
 * high word of FFFFh, a pointer to a string at FFFFh:FF80h and up.
 *
 * * `fourcc`: the string's bytes in hex, the flags, and the code's four
 *   bytes in hex.
 * * `upper`: AnsiUpper itself of the same far pointer, what it answered.
 *
 * Each record is on the disk once written, so a run stopped partway keeps
 * what came before.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMIOHI.OUT"

static void one(LPCSTR name, LPCSTR text, UINT flags)
{
    FOURCC value = mmioStringToFOURCC(text, flags);

    wsprintf(probeArgs, "%s,%x", name, flags);
    wsprintf(probeResult, "%02x%02x%02x%02x", (BYTE)value, (BYTE)(value >> 8),
             (BYTE)(value >> 16), (BYTE)(value >> 24));
    probe("fourcc", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char first[] = "\x80" "abc";
    static char second[] = "a\xe9" "b\xff";
    static char third[] = "\xe0\xe9\xf6\xfc";
    static char fourth[] = "z\x7f" "a\xc0";
    DWORD upper;

    probeOpen(OUTPUT);

    one("80abc", first, 0);
    one("a-e9-b-ff", second, 0);
    one("e0e9f6fc", third, 0);
    one("z7fac0", fourth, 0);

    upper = (DWORD)AnsiUpper((LPSTR)MAKELP(0, 0xe9));
    wsprintf(probeResult, "%lx", upper);
    probe("upper", "0:e9", probeResult);

    upper = (DWORD)AnsiUpper((LPSTR)MAKELP(0xffff, 0xffe9));
    wsprintf(probeResult, "%lx", upper);
    probe("upper", "ffff:ffe9", probeResult);

    one("z7fac0", fourth, MMIO_TOUPPER);
    one("80abc", first, MMIO_TOUPPER);
    one("a-e9-b-ff", second, MMIO_TOUPPER);
    one("e0e9f6fc", third, MMIO_TOUPPER);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
