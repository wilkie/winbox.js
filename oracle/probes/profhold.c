/*
 * When KERNEL lets a private profile's buffer go and loads the file again.
 *
 * A value written with spaces at its start reads back with them while the
 * buffer it was written into is held, and without them once the file is
 * loaded again, since loading trims them. So each case writes such a
 * value and reads it back, and the spaces tell which buffer answered.
 *
 * Read out of KRNL386.EXE: a profile call first compares, when a DOS call
 * has been made since the last check (seg1 `1b68` sets the flag on every
 * INT 21h; `62f9`-`6363`), the date and time the file has now with those
 * its buffer was opened with, and lets the buffer go where they differ
 * (`6b33`). A buffer written is put on the disk at the next DOS call
 * (`1b6d`-`1b8c`, `708b`), reopened first (`70a7`), which takes the
 * file's stamp before the write. One private file is held at a time, by
 * its whole path; another's name lets it go (`63e7`-`6438`). DOS keeps
 * times to two seconds, so each case starts at the start of a two-second
 * step of DOS's clock (INT 21h 2Ch) and says how many steps it waits.
 *
 * The records are kept in memory and written at the end, so that the
 * probe's own writing makes no DOS call between a write and its read.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PROFHOLD.OUT"
#define FILE1 "PROFHOLD.INI"
#define FILE2 "PROFHLD2.INI"
#define PATH1 "C:\\WINDOWS\\PROFHOLD.INI"

static char kept[24][100];
static int count;

static BYTE second;
static BYTE minute;

/* A DOS call that changes nothing: the time of day. */
static void dos(void)
{
    _asm {
        mov ah, 2ch
        int 21h
        mov second, dh
        mov minute, cl
    }
}

/* Waits for DOS's clock to step to the next even second. */
static void step(void)
{
    BYTE first;
    BYTE at;

    dos();
    first = (BYTE)(second / 2);
    at = minute;

    do {
        dos();
    } while (second / 2 == first && minute == at);
}

static void write1(LPCSTR entry, LPCSTR value)
{
    WritePrivateProfileString("Hold", entry, value, FILE1);
}

static void read1(LPCSTR label, LPCSTR section, LPCSTR entry)
{
    char value[40];

    GetPrivateProfileString(section, entry, "none", value, sizeof(value), FILE1);
    wsprintf(kept[count++], "%s\t%s=[%s]", label, entry, (LPSTR)value);
}

static void append(LPCSTR text)
{
    HFILE file = _lopen(PATH1, OF_READWRITE);

    _llseek(file, 0L, 2);
    _lwrite(file, text, lstrlen(text));
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT of;
    char value[40];
    int i;

    probeOpen(OUTPUT);
    OpenFile(FILE1, &of, OF_DELETE);
    OpenFile(FILE2, &of, OF_DELETE);
    WritePrivateProfileString(NULL, NULL, NULL, FILE1);

    /* A file made by the write. */
    step();
    write1("a", "   one");
    dos();
    read1("made", "Hold", "a");

    /* Written again in the same two seconds. */
    write1("b", "   two");
    dos();
    read1("same-step", "Hold", "b");

    /* Written in the next two seconds. */
    step();
    write1("c", "   three");
    dos();
    read1("next-step", "Hold", "c");

    /* Read with no DOS call between, then after one. */
    step();
    write1("d", "   four");
    read1("no-dos", "Hold", "d");
    dos();
    read1("then-dos", "Hold", "d");

    /* Written again in the same two seconds. */
    write1("e", "   five");
    dos();
    read1("same-again", "Hold", "e");

    /* Another private file read between. */
    write1("f", "   six");
    GetPrivateProfileString("Other", "x", "none", value, sizeof(value), FILE2);
    read1("other-file", "Hold", "f");

    /* WIN.INI read between. */
    write1("g", "   seven");
    GetProfileString("windows", "Beep", "none", value, sizeof(value));
    read1("win-ini", "Hold", "g");

    /* The same file named with its path. */
    write1("h", "   eight");
    GetPrivateProfileString("Hold", "h", "none", value, sizeof(value), PATH1);
    wsprintf(kept[count++], "path\th=[%s]", (LPSTR)value);

    /* A read leaves its buffer: the file changed by DOS within the two
     * seconds is not seen, and in the next two it is. */
    step();
    append("[Raw]\r\nr=1\r\n");
    read1("raw-one", "Raw", "r");
    append("[Raw2]\r\nq=2\r\n");
    read1("raw-same", "Raw2", "q");
    step();
    append("[Raw3]\r\np=3\r\n");
    read1("raw-next", "Raw2", "q");

    for (i = 0; i < count; i++) {
        LPSTR at = kept[i];
        LPSTR tab = at;

        while (*tab != '\t') {
            tab++;
        }

        *tab = '\0';
        probe("held", at, tab + 1);
    }

    OpenFile(FILE1, &of, OF_DELETE);
    OpenFile(FILE2, &of, OF_DELETE);
    probeFinish();

    (void)module;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
