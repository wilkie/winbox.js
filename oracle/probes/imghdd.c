/*
 * A hard disk image as DOSBox mounts it (`imgmount d ... -t hdd`):
 * `images/imghdd.img`, made by `scripts/oracle/make-images.mjs` -- 6
 * cylinders of 16 heads and 63 sectors, a master boot record with one
 * partition from sector 63, FAT16 of 512-byte clusters on it labelled
 * WBHARD, two files and a folder with a file in it.
 *
 * Records as `imgprobe.h` describes them, for D:.
 */

#include "probe.h"
#include "imgprobe.h"

#define OUTPUT "C:\\ORACLE\\IMGHDD.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    listFolder("entry", "D:", 1);
    label("D:");
    match("D:\\*.TXT", 0);
    readAll();
    openAs("D:\\first.txt");
    attr("D:\\FIRST.TXT");
    attr("D:\\HARDSUB");
    space("space", 4);
    ioctls(4);
    writes("D:", 4, "SECOND.TXT");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
