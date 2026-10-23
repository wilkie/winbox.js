/*
 * A floppy disk image as DOSBox mounts it (`imgmount a ... -t floppy`):
 * `images/imgflop.img`, a 1.44 MB FAT12 floppy made by
 * `scripts/oracle/make-images.mjs` -- a label entry, files in the order
 * they were copied (ZEBRA.TXT before APPLE.TXT), a deleted entry between,
 * a long name's VFAT entries, a hidden, system and read-only file, folders
 * two deep, and every entry's creation, access and modification stamps set
 * apart.
 *
 * Records as `imgprobe.h` describes them, for A:.
 */

#include "probe.h"
#include "imgprobe.h"

#define OUTPUT "C:\\ORACLE\\IMGFLOP.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    listFolder("entry", "A:", 1);
    label("A:");
    match("A:\\*.TXT", 0);
    match("A:\\*.*", 0);
    match("A:\\*.*", _A_HIDDEN | _A_SYSTEM);
    match("A:\\SUBDIR", _A_SUBDIR);
    match("A:\\?????.TXT", 0);
    readAll();
    openAs("A:\\readme.txt");
    openAs("A:\\LONGFI~1.TXT");
    openAs("A:\\Long File Name.txt");
    openAs("A:\\DELETED.TXT");
    openAs("A:\\SUBDIR\\..\\README.TXT");
    attr("A:\\README.TXT");
    attr("A:\\HIDDEN.SYS");
    attr("A:\\SUBDIR");
    attr("A:\\SUBDIR\\NESTED");
    attr("A:\\NOPE.TXT");
    space("space", 1);
    ioctls(1);
    writes("A:", 1, "ZEBRA.TXT");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
