/*
 * A disc swapped under files open on it, as DOSBox swaps one: D: a set of
 * two discs (`imgmount d imgsw1.iso imgsw2.iso -t iso`, `imgswap.mounts`),
 * made by `scripts/oracle/make-images.mjs` -- each a `BIG.DAT` of four
 * sectors at the same place, every 16-byte line of it naming its disc and
 * sector (`disc1 sector 0\r\n`); a file of its own, `ONLY1.TXT` or
 * `ONLY2.TXT`, at the same place; a `SHARED` folder on both; a `SUB1`
 * folder on the first alone.
 *
 * The probe asks for the swap with a record of `swap`, `<n>` `request`:
 * the recorder presses DOSBox's swap key, Ctrl+F4 (`swapimg`), once it
 * sees one (`record.mjs`), and the harnesses swap the next disc in as the
 * record is written. The probe then waits until a file of the other disc
 * is there (4300h), and writes `swap` `<n>` `done` -- or `timeout` after a
 * minute.
 *
 * Records, besides those of `imgprobe.h` (`label`, `space`, `ioctl`,
 * `match`, `entry`, `attr`):
 *
 * * `cwd` `D:`: D:'s current folder (`_getdcwd`, 47h), or the error.
 * * `chdir` `<path>`: 3Bh's error, nought for none.
 * * `open` `<slot> <path>`: a file opened to read (3Dh) and kept, its
 *   handle in a slot; nought, or the error.
 * * `read` `<slot> <count>`: bytes read from where the file is (3Fh): how
 *   many, where it then is, and the first and last 16 of them as text.
 * * `seek` `<slot> <to> <how>`: where 42h moves it.
 * * `stamp` `<slot>`: 5700h's date and time.
 * * `find` `first`/`next`: a search of `D:\*.*` begun before the swap and
 *   carried on after it: the name found, or the error.
 * * `150b`, `1500`: MSCDEX's answers, as `imgcd` records them.
 * * `close` `<slot>`: 3Eh's error.
 */

#define PROBE_FLUSH
#include "probe.h"
#include "imgprobe.h"

#define OUTPUT "C:\\ORACLE\\IMGSWAP.OUT"

static int handles[4];
static unsigned char bytes[2100];
static struct find_t pending;

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

static void cwd(void)
{
    char folder[80];

    if (_getdcwd(4, folder, sizeof folder)) {
        probe("cwd", "D:", folder);
    } else {
        wsprintf(probeResult, "error %u", (unsigned)_doserrno);
        probe("cwd", "D:", probeResult);
    }
}

static void changeTo(LPCSTR path)
{
    wsprintf(probeResult, "%u", chdir(path) ? (unsigned)_doserrno : 0);
    probe("chdir", path, probeResult);
}

static void openKept(unsigned slot, LPCSTR path)
{
    unsigned error = _dos_open(path, 0, &handles[slot]);

    wsprintf(probeArgs, "%u %s", slot, path);
    wsprintf(probeResult, "%u", error);
    probe("open", probeArgs, probeResult);
}

/* Up to 16 bytes as text, ending the string. */
static void textOf(char *into, const unsigned char *from, unsigned count)
{
    unsigned i;

    for (i = 0; i < count && i < 16; i++) {
        into[i] = from[i] ? (char)from[i] : '.';
    }

    into[i] = '\0';
}

static void readOn(unsigned slot, unsigned count)
{
    char first[17];
    char last[17];
    unsigned got = 0;
    unsigned error = _dos_read(handles[slot], (void far *)bytes, count, &got);
    long at = lseek(handles[slot], 0L, SEEK_CUR);

    wsprintf(probeArgs, "%u %u", slot, count);

    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        textOf(first, bytes, got);
        textOf(last, got > 16 ? bytes + got - 16 : bytes, got);
        wsprintf(probeResult, "%u %ld [%s] [%s]", got, at, (LPSTR)first, (LPSTR)last);
    }

    probe("read", probeArgs, probeResult);
}

static void seekTo(unsigned slot, long to, int how)
{
    wsprintf(probeArgs, "%u %ld %d", slot, to, how);
    wsprintf(probeResult, "%ld", lseek(handles[slot], to, how));
    probe("seek", probeArgs, probeResult);
}

static void stampOf(unsigned slot)
{
    unsigned date = 0;
    unsigned time = 0;
    unsigned error = _dos_getftime(handles[slot], &date, &time);

    wsprintf(probeArgs, "%u", slot);
    wsprintf(probeResult, "%u %04x %04x", error, date, time);
    probe("stamp", probeArgs, probeResult);
}

static void closeKept(unsigned slot)
{
    wsprintf(probeArgs, "%u", slot);
    wsprintf(probeResult, "%u", _dos_close(handles[slot]));
    probe("close", probeArgs, probeResult);
}

static void found(LPCSTR how, unsigned error)
{
    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        wsprintf(probeResult, "%s %02x %lx", (LPSTR)pending.name, pending.attrib, pending.size);
    }

    probe("find", how, probeResult);
}

/* The swap asked for, and waited for: until `expect`, a file of the disc
 * coming in, is there. */
static void swapDiscs(LPCSTR number, LPCSTR expect)
{
    unsigned attributes;
    DWORD start;

    probe("swap", number, "request");
    start = GetTickCount();

    while (_dos_getfileattr(expect, &attributes) != 0) {
        if (GetTickCount() - start > 60000L) {
            probe("swap", number, "timeout");
            return;
        }
    }

    probe("swap", number, "done");
}

static void drive(void)
{
    label("D:");
    space("space", 4);
    ioctls(4);
    multiplex("150b", "3", 0x150b, 3);
    multiplex("1500", "", 0x1500, 0x0c0c);
    cwd();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    probeNote("the first disc");
    drive();
    changeTo("D:\\SUB1");
    cwd();
    match("D:*.*", FIND_ALL);
    openKept(0, "D:\\BIG.DAT");
    readOn(0, 32);
    readOn(0, 2048);
    openKept(1, "D:\\ONLY1.TXT");
    openKept(2, "D:\\SUB1\\IN1.TXT");
    readOn(2, 8);
    found("first", _dos_findfirst("D:\\*.*", FIND_ALL, &pending));
    found("next", _dos_findnext(&pending));

    swapDiscs("1", "D:\\ONLY2.TXT");

    probeNote("the second disc, files open on the first");
    found("next", _dos_findnext(&pending));
    readOn(0, 16);
    readOn(0, 2048);
    readOn(2, 8);
    readOn(2, 64);
    readOn(1, 64);
    seekTo(0, 0L, SEEK_SET);
    readOn(0, 16);
    stampOf(0);
    stampOf(1);
    seekTo(0, 0L, SEEK_END);
    drive();
    match("D:*.*", FIND_ALL);
    listFolder("entry", "D:", 0);
    attr("D:\\ONLY1.TXT");
    attr("D:\\ONLY2.TXT");
    attr("D:\\SUB1");
    openKept(3, "D:\\ONLY2.TXT");
    readOn(3, 16);
    changeTo("D:\\");
    cwd();

    swapDiscs("2", "D:\\ONLY1.TXT");

    probeNote("the first disc again");
    readOn(3, 4);
    seekTo(3, 0L, SEEK_SET);
    readOn(3, 16);
    seekTo(0, 0L, SEEK_SET);
    readOn(0, 16);
    readOn(1, 64);
    stampOf(3);
    drive();
    listFolder("entry", "D:", 0);
    closeKept(0);
    closeKept(1);
    closeKept(2);
    closeKept(3);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
