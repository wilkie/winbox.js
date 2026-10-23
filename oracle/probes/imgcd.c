/*
 * A CD-ROM image as DOSBox mounts it (`imgmount d ... -t iso`):
 * `images/imgcd.iso`, made by `scripts/oracle/make-images.mjs` -- an ISO
 * 9660 primary volume descriptor alone, names past 8.3 in mixed case with
 * their `;1` versions, a file with no extension, one marked hidden, one
 * whose record's offset from GMT is not nought, a folder whose name is past
 * 8.3 (LONGNAMEDFOLDER), an 8.3 one (SUBDIR) with a folder in it, and the
 * volume named WINBOXCD2026.
 *
 * Records as `imgprobe.h` describes them, for D:; and MSCDEX's register
 * calls with the disc mounted, as `mscdex` records them without one:
 * `1500`, `150b` for drives 0 to 5, `150c`.
 */

#include "probe.h"
#include "imgprobe.h"

#define OUTPUT "C:\\ORACLE\\IMGCD.OUT"

static void multiplex(LPCSTR name, LPCSTR args, unsigned ax, unsigned cx)
{
    regs.ax = ax;
    regs.bx = 0x0b0b;
    regs.cx = cx;
    regs.dx = 0x0d0d;
    call2f();
    regsText(probeResult);
    probe(name, args, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned drive;

    probeOpen(OUTPUT);

    listFolder("entry", "D:", 1);
    label("D:");
    match("D:\\*.TXT", 0);
    match("D:\\*.*", 0);
    match("D:\\*.*", _A_HIDDEN);
    match("D:\\LONGNAMEDFOLDER", _A_SUBDIR);
    match("D:\\LONGNAME", _A_SUBDIR);
    readAll();
    openAs("D:\\readme.txt");
    openAs("D:\\README.TXT;1");
    openAs("D:\\A_VERY_LONG_FILE_NAME.TEXT");
    openAs("D:\\A_VERY_L.TEX");
    openAs("D:\\NOEXT.");
    openAs("D:\\HIDDEN.TXT");
    openAs("D:\\LONGNAMEDFOLDER\\INNER.TXT");
    openAs("D:\\LONGNAME\\INNER.TXT");
    openAs("D:\\SUBDIR\\LONG_INNER_NAME.TXT");
    openAs("D:\\subdir\\deeper\\deep.txt");
    openAs("D:\\SUBDIR\\..\\README.TXT");
    attr("D:\\README.TXT");
    attr("D:\\HIDDEN.TXT");
    attr("D:\\LONGNAMEDFOLDER");
    attr("D:\\SUBDIR");
    attr("D:\\SUBDIR\\DEEPER");
    attr("D:\\NOPE.TXT");
    space("space", 4);
    ioctls(4);

    multiplex("1500", "", 0x1500, 0x0c0c);

    for (drive = 0; drive < 6; drive++) {
        wsprintf(probeArgs, "%u", drive);
        multiplex("150b", probeArgs, 0x150b, drive);
    }

    multiplex("150c", "", 0x150c, 0x0c0c);

    writes("D:", 4, "README.TXT");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
