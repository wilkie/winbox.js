/*
 * Writing to a floppy disk image as DOSBox writes to one (`imgmount a ...
 * -t floppy`): `images/imgwrite.img`, a 1.44 MB FAT12 floppy made by
 * `scripts/oracle/make-images.mjs` -- files in the order they were copied
 * (ONE.TXT, TWO.TXT, a deleted GONE.TXT, THREE.TXT, NOEXT with no
 * extension, BIG.TXT of 1,000 bytes), a folder SUBDIR and a hidden folder
 * HIDDIR with INSIDE.TXT in it. The recorder writes to a copy.
 *
 * Records, as `imgprobe.h` describes `entry`, `read`, `open`, `attr` and
 * `space`, and:
 *
 * * `noext`, `hidden`: a file with no extension, and a hidden folder in a
 *   path, opened, searched, changed to, made in, removed and deleted from.
 * * `seek` `<from> <offset>`: where `lseek` puts BIG.TXT; `seek read`, the
 *   bytes a read after the last gets.
 * * `mode` `<what>`: a write to a file opened to read, a read from one
 *   opened to write.
 * * `stale` `<what>`: a file open twice, written through one and read
 *   through the other, each closed, and read again.
 * * `zero`: a write of nought bytes inside a file, and its size after.
 * * `over`: a file made over one there, and the room after.
 * * `stamp`: 5701h then 5700h on a file made, and 5700h on one there.
 * * `attrib`: 4301h, and 4300h after; a file made hidden.
 * * `grow`: a file written to the end of its second cluster, its size,
 *   last bytes and the room after.
 * * `folder`: a folder made, a file in it, removed full and empty.
 * * `rename`: a file into a folder, a folder renamed, a folder deleted.
 * * `search` `<case>`: what a search finds when a file is made, renamed or
 *   deleted while it is open, as its names joined by commas, the error
 *   that ended it last.
 * * `quirk`: a folder made where a file has its name, a file made where a
 *   folder has its; then the root listed again (`final`), and its room.
 */

#include "probe.h"
#include "imgprobe.h"

#define OUTPUT "C:\\ORACLE\\IMGWRITE.OUT"

static void outcome(LPCSTR function, LPCSTR what, unsigned error)
{
    wsprintf(probeResult, "%u", error);
    probe(function, what, probeResult);
}

/* A file made, a text written to it, closed: the error, nought where none. */
static unsigned makeFile(LPCSTR path, unsigned attributes, LPCSTR text)
{
    int handle;
    unsigned wrote;
    unsigned error = _dos_creat(path, attributes, &handle);

    if (error) {
        return error;
    }

    if (text[0]) {
        _dos_write(handle, (void far *)text, lstrlen(text), &wrote);
    }

    return _dos_close(handle);
}

static unsigned errorOf(int failed)
{
    return failed ? (unsigned)_doserrno : 0;
}

static void noext(void)
{
    readFile("A:\\NOEXT");
    readFile("A:\\NOEXT.");
    openAs("A:\\noext");
    match("A:\\NOEXT", 0);
    match("A:\\NOEXT.*", 0);
    outcome("noext", "make", makeFile("A:\\BARE", _A_NORMAL, "bare"));
    match("A:\\B*.*", 0);
    attr("A:\\BARE");
}

static void hidden(void)
{
    char cwd[80];

    attr("A:\\HIDDIR");
    attr("A:\\HIDDIR\\INSIDE.TXT");
    openAs("A:\\HIDDIR\\INSIDE.TXT");
    match("A:\\HIDDIR\\*.*", FIND_ALL);
    match("A:\\HIDDIR", _A_SUBDIR | _A_HIDDEN);
    outcome("hidden", "chdir", errorOf(chdir("A:\\HIDDIR")));
    _getdcwd(1, cwd, sizeof cwd);
    probe("hidden", "cwd", cwd);
    space("hidden", 1);
    outcome("hidden", "mkdir", errorOf(mkdir("A:\\HIDDIR\\X")));
    space("hidden", 1);
    outcome("hidden", "create", makeFile("A:\\HIDDIR\\NEW.TXT", _A_NORMAL, ""));
    outcome("hidden", "delete", errorOf(remove("A:\\HIDDIR\\INSIDE.TXT")));
    outcome("hidden", "rmdir", errorOf(rmdir("A:\\HIDDIR")));
}

static void seekTo(LPCSTR from, int handle, long offset, int origin)
{
    wsprintf(probeArgs, "%s %ld", from, offset);
    wsprintf(probeResult, "%ld", lseek(handle, offset, origin));
    probe("seek", probeArgs, probeResult);
}

static void seeks(void)
{
    unsigned char bytes[16];
    unsigned got = 0;
    int handle;

    if (_dos_open("A:\\BIG.TXT", 0, &handle)) {
        probe("seek", "open", "failed");
        return;
    }

    seekTo("set", handle, 5000L, SEEK_SET);
    seekTo("cur", handle, 0L, SEEK_CUR);
    seekTo("end", handle, -10L, SEEK_END);
    _dos_read(handle, (void far *)bytes, sizeof bytes, &got);
    hex(text, bytes, got);
    probe("seek", "read", text);
    seekTo("cur", handle, -2000L, SEEK_CUR);
    seekTo("end", handle, 100L, SEEK_END);
    seekTo("set", handle, -5L, SEEK_SET);
    seekTo("set", handle, 512L, SEEK_SET);
    _dos_read(handle, (void far *)bytes, 4, &got);
    hex(text, bytes, got);
    probe("seek", "read 512", text);
    _dos_close(handle);
}

static void modes(void)
{
    unsigned char bytes[4];
    unsigned done = 0;
    int handle;

    _dos_open("A:\\THREE.TXT", 0, &handle);
    outcome("mode", "write read-only", _dos_write(handle, (void far *)"x", 1, &done));
    wsprintf(probeResult, "%u", done);
    probe("mode", "wrote", probeResult);
    _dos_close(handle);
    _dos_open("A:\\THREE.TXT", 1, &handle);
    done = 0;
    outcome("mode", "read write-only", _dos_read(handle, (void far *)bytes, 4, &done));
    wsprintf(probeResult, "%u", done);
    probe("mode", "read", probeResult);
    _dos_close(handle);
    readFile("A:\\THREE.TXT");
}

static void stale(void)
{
    unsigned char bytes[4];
    unsigned done = 0;
    int writer;
    int reader;

    makeFile("A:\\STALE.TXT", _A_NORMAL, "AAAA");
    _dos_open("A:\\STALE.TXT", 2, &writer);
    _dos_open("A:\\STALE.TXT", 0, &reader);
    _dos_write(writer, (void far *)"BBBB", 4, &done);
    _dos_read(reader, (void far *)bytes, 4, &done);
    hex(text, bytes, done);
    probe("stale", "read", text);
    _dos_close(writer);
    readFile("A:\\STALE.TXT");
    _dos_close(reader);
    readFile("A:\\STALE.TXT");
}

static void zero(void)
{
    unsigned done = 9;
    int handle;

    _dos_open("A:\\BIG.TXT", 2, &handle);
    lseek(handle, 100L, SEEK_SET);
    outcome("zero", "write", _dos_write(handle, (void far *)"", 0, &done));
    wsprintf(probeResult, "%u %ld", done, lseek(handle, 0L, SEEK_END));
    probe("zero", "size", probeResult);
    _dos_close(handle);
}

static void over(void)
{
    int handle;
    unsigned done;

    space("over", 1);
    outcome("over", "create", _dos_creat("A:\\ONE.TXT", _A_NORMAL, &handle));
    wsprintf(probeResult, "%ld", lseek(handle, 0L, SEEK_END));
    probe("over", "size", probeResult);
    _dos_close(handle);
    space("over", 1);
    _dos_open("A:\\ONE.TXT", 2, &handle);
    _dos_write(handle, (void far *)"1", 1, &done);
    _dos_close(handle);
    space("over", 1);
    readFile("A:\\ONE.TXT");
}

static void stamps(void)
{
    unsigned date;
    unsigned time;
    int handle;

    _dos_creat("A:\\STAMP.TXT", _A_NORMAL, &handle);
    outcome("stamp", "set", _dos_setftime(handle, 0x1c21, 0x6000));
    _dos_getftime(handle, &date, &time);
    wsprintf(probeResult, "%04x %04x", date, time);
    probe("stamp", "made", probeResult);
    _dos_close(handle);
    _dos_open("A:\\STAMP.TXT", 0, &handle);
    _dos_getftime(handle, &date, &time);
    wsprintf(probeResult, "%04x %04x", date, time);
    probe("stamp", "reopened", probeResult);
    _dos_close(handle);
    _dos_open("A:\\BIG.TXT", 0, &handle);
    _dos_getftime(handle, &date, &time);
    wsprintf(probeResult, "%04x %04x", date, time);
    probe("stamp", "there", probeResult);
    _dos_close(handle);
}

static void attributes(void)
{
    outcome("attrib", "set", _dos_setfileattr("A:\\TWO.TXT", _A_HIDDEN | _A_RDONLY));
    attr("A:\\TWO.TXT");
    outcome("attrib", "make hidden", makeFile("A:\\HID.TXT", _A_HIDDEN, "h"));
    attr("A:\\HID.TXT");
    match("A:\\HID.TXT", 0);
    match("A:\\HID.TXT", _A_HIDDEN);
}

static char block[1024];

static void grow(void)
{
    unsigned char bytes[4];
    unsigned done = 0;
    unsigned i;
    int handle;

    for (i = 0; i < sizeof block; i++) {
        block[i] = (char)('a' + i % 26);
    }

    space("grow", 1);
    _dos_creat("A:\\GROW.TXT", _A_NORMAL, &handle);
    _dos_write(handle, (void far *)block, sizeof block, &done);
    wsprintf(probeResult, "%u %ld", done, lseek(handle, 0L, SEEK_END));
    probe("grow", "wrote", probeResult);
    lseek(handle, -4L, SEEK_END);
    _dos_read(handle, (void far *)bytes, 4, &done);
    hex(text, bytes, done);
    probe("grow", "last", text);
    _dos_close(handle);
    space("grow", 1);
}

static void folders(void)
{
    outcome("folder", "mkdir", errorOf(mkdir("A:\\NEWDIR")));
    outcome("folder", "mkdir again", errorOf(mkdir("A:\\NEWDIR")));
    outcome("folder", "file", makeFile("A:\\NEWDIR\\IN.TXT", _A_NORMAL, "in"));
    listFolder("folder", "A:\\NEWDIR", 0);
    outcome("folder", "rmdir full", errorOf(rmdir("A:\\NEWDIR")));
    outcome("folder", "delete", errorOf(remove("A:\\NEWDIR\\IN.TXT")));
    outcome("folder", "rmdir", errorOf(rmdir("A:\\NEWDIR")));
    outcome("folder", "rmdir gone", errorOf(rmdir("A:\\NEWDIR")));
    space("folder", 1);
}

static void renames(void)
{
    outcome("rename", "into folder", errorOf(rename("A:\\TWO.TXT", "A:\\SUBDIR\\TWO.TXT")));
    listFolder("rename", "A:\\SUBDIR", 0);
    outcome("rename", "folder", errorOf(rename("A:\\SUBDIR", "A:\\SUBDIR2")));
    outcome("rename", "onto", errorOf(rename("A:\\THREE.TXT", "A:\\BIG.TXT")));
    outcome("rename", "none", errorOf(rename("A:\\NOPE.TXT", "A:\\NOPE2.TXT")));
    outcome("rename", "delete folder", errorOf(remove("A:\\SUBDIR")));
    openAs("A:\\SUBDIR");
}

/* A search of a folder, `stop` entries found before `act` is done, then
 * carried on to its end: the names it found, joined, and the error. */
static void searchWhile(LPCSTR what, LPCSTR pattern, unsigned stop, void (*act)(void))
{
    struct find_t found;
    unsigned done;
    unsigned n = 0;

    text[0] = '\0';

    for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
        if (text[0]) {
            lstrcat(text, ",");
        }

        lstrcat(text, found.name);

        if (++n == stop) {
            act();
        }
    }

    wsprintf(text + lstrlen(text), " %u", done);
    probe("search", what, text);
}

static void makeA4(void)
{
    makeFile("A:\\SEARCH\\A4.TXT", _A_NORMAL, "4");
}

static void renameB2(void)
{
    rename("A:\\SEARCH\\B2.TXT", "A:\\SEARCH\\C2.TXT");
}

static void makeTwo(void)
{
    makeFile("A:\\SEARCH\\D5.TXT", _A_NORMAL, "5");
    makeFile("A:\\SEARCH\\E6.TXT", _A_NORMAL, "6");
}

static void deleteA4(void)
{
    remove("A:\\SEARCH\\A4.TXT");
}

static void searches(void)
{
    struct find_t found;
    unsigned done;

    mkdir("A:\\SEARCH");
    makeFile("A:\\SEARCH\\A1.TXT", _A_NORMAL, "1");
    makeFile("A:\\SEARCH\\A2.TXT", _A_NORMAL, "2");
    makeFile("A:\\SEARCH\\A3.TXT", _A_NORMAL, "3");
    searchWhile("made ahead", "A:\\SEARCH\\*.*", 2, makeA4);
    remove("A:\\SEARCH\\A1.TXT");
    rename("A:\\SEARCH\\A2.TXT", "A:\\SEARCH\\B2.TXT");
    listFolder("search", "A:\\SEARCH", 0);
    searchWhile("renamed", "A:\\SEARCH\\*.TXT", 1, renameB2);
    searchWhile("made behind", "A:\\SEARCH\\*.TXT", 1, makeTwo);
    searchWhile("deleted ahead", "A:\\SEARCH\\*.TXT", 2, deleteA4);

    /* Once over, a file made and the search asked again. */
    for (done = _dos_findfirst("A:\\SEARCH\\*.TXT", FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
    }

    makeFile("A:\\SEARCH\\F7.TXT", _A_NORMAL, "7");
    done = _dos_findnext(&found);
    wsprintf(probeResult, "%u %s", done, done ? (LPSTR) "" : (LPSTR)found.name);
    probe("search", "after the end", probeResult);
    listFolder("search", "A:\\SEARCH", 0);
}

static void quirks(void)
{
    outcome("quirk", "mkdir over a file", errorOf(mkdir("A:\\THREE.TXT")));
    outcome("quirk", "create over a folder", makeFile("A:\\SUBDIR", _A_NORMAL, "s"));
    attr("A:\\THREE.TXT");
    attr("A:\\SUBDIR");
    openAs("A:\\SUBDIR");
    match("A:\\SUBDIR\\*.*", FIND_ALL);
    listFolder("final", "A:", 0);
    space("final", 1);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    listFolder("entry", "A:", 0);
    space("space", 1);
    noext();
    hidden();
    seeks();
    modes();
    stale();
    zero();
    over();
    stamps();
    attributes();
    grow();
    folders();
    renames();
    searches();
    quirks();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
