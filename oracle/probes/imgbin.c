/*
 * imgcd's records of its disc as D:, the disc the raw image
 * `images/imgcd.bin` mounted as it is (`imgmount d imgcd.bin -t iso`):
 * DOSBox's `LoadCueSheet` refuses it, and `LoadIsoFile` finds its 2,352-byte
 * mode 1 sectors. See imgcd.c and kb/topics/cd-rom.md, "Cue sheets".
 */

#define OUTPUT "C:\\ORACLE\\IMGBIN.OUT"

#include "imgcd.c"
