/*
 * LZEXPAND, every export, on compressed files and plain ones.
 *
 * The probe writes its files to C:\ORACLE first: three made by
 * scripts/oracle/szdd.mjs (`lzdata.h`), the COMPRESS format of text and of
 * runs; one it makes itself of literals alone; those altered -- cut short,
 * another algorithm, a wrong signature; and plain files, one shorter than a
 * header. It makes each file's data itself too, as the script did, and
 * holds what LZEXPAND gives back to it byte by byte.
 *
 * * `name`: GetExpandedName of each, and of a name not there.
 * * `open`: LZOpenFile -- its answer, an LZ handle (400h on) or DOS's, the
 *   structure's error and path -- in the ways a file can be asked for.
 * * `read`: LZRead in pieces of several sizes, each piece's answer, and
 *   whether all it gave is the file's data.
 * * `seek`: LZSeek from each origin, past the end and before the start,
 *   and LZRead after it.
 * * `init`: LZInit on DOS's handles of compressed and plain files.
 * * `copy`: LZCopy and CopyLZFile into new files, what they answer, and
 *   the file made.
 * * `handles`: as many LZ handles as LZEXPAND has room for, and one more.
 * * `bad`: each call with a handle that is none.
 * * `start`: LZStart and LZDone around copies.
 */

#include "probe.h"
#include <lzexpand.h>
#include <direct.h>

#pragma library("lzexpand")

#include "lzdata.h"

#define OUTPUT "C:\\ORACLE\\LZFILES.OUT"

/* The data each compressed file holds, made again. */
static unsigned long lcg;

static unsigned char lzNext(void)
{
    lcg = lcg * 1103515245UL + 12345UL;
    return (unsigned char)(lcg >> 16);
}

static const char *WORDS[] = {
    "the ", "quick ", "brown ", "fox ", "jumps ", "over ", "lazy ", "dog ", "\r\n", "Windows ", "  ",
};

static void lzText(unsigned long seed, unsigned int count, unsigned char far *out)
{
    unsigned int at = 0;

    lcg = seed;

    while (at < count) {
        const char *word = WORDS[lzNext() % 11];

        while (*word && at < count) {
            out[at++] = (unsigned char)*word++;
        }
    }
}

static unsigned int lzRuns(unsigned char far *out)
{
    unsigned int at = 0;
    unsigned int i;

    for (i = 0; i < 100; i++) out[at++] = ' ';
    for (i = 0; i < 200; i++) out[at++] = 'A';
    for (i = 0; i < 100; i++) { out[at++] = 'A'; out[at++] = 'B'; }
    for (i = 0; i < 256; i++) out[at++] = (unsigned char)i;

    return at;
}

/* The expected data of each file, and what was read. */
static unsigned char far *expected;
static unsigned int expectedSize;
static unsigned char far *got;

static void expect(const char *which)
{
    if (lstrcmp(which, "TEXT") == 0) {
        lzText(1, 3000, expected);
        expectedSize = 3000;
    } else if (lstrcmp(which, "BIG") == 0) {
        lzText(2, 20000, expected);
        expectedSize = 20000;
    } else if (lstrcmp(which, "RUNS") == 0) {
        expectedSize = lzRuns(expected);
    } else if (lstrcmp(which, "LIT") == 0) {
        lzText(3, 700, expected);
        expectedSize = 700;
    } else {
        /* A plain file: PLAIN.TXT. */
        lzText(4, 1500, expected);
        expectedSize = 1500;
    }
}

static void putFile(LPCSTR name, const unsigned char far *bytes, unsigned int count)
{
    HFILE file = _lcreat(name, 0);

    _lwrite(file, (LPCSTR)bytes, count);
    _lclose(file);
}

/* A header of COMPRESS's: its algorithm and the name's last character. */
static void header(unsigned char *at, char algorithm, char last, unsigned long size)
{
    static const unsigned char MAGIC[] = { 'S', 'Z', 'D', 'D', 0x88, 0xf0, 0x27, 0x33 };
    int i;

    for (i = 0; i < 8; i++) at[i] = MAGIC[i];
    at[8] = (unsigned char)algorithm;
    at[9] = (unsigned char)last;
    at[10] = (unsigned char)size;
    at[11] = (unsigned char)(size >> 8);
    at[12] = (unsigned char)(size >> 16);
    at[13] = (unsigned char)(size >> 24);
}

/* A compressed file of literals alone: a flag byte of eight ones before each eight bytes. */
static void literals(LPCSTR name, const unsigned char far *data, unsigned int count, char last)
{
    unsigned char head[14];
    unsigned char group[9];
    HFILE file = _lcreat(name, 0);
    unsigned int at;

    header(head, 'A', last, count);
    _lwrite(file, (LPCSTR)head, 14);

    for (at = 0; at < count; at += 8) {
        unsigned int n = count - at < 8 ? count - at : 8;
        unsigned int i;

        group[0] = 0xff;

        for (i = 0; i < n; i++) group[1 + i] = data[at + i];

        _lwrite(file, (LPCSTR)group, n + 1);
    }

    _lclose(file);
}

static void makeFiles(void)
{
    unsigned char head[14];
    HFILE file;

    mkdir("C:\\ORACLE\\LZ");

    putFile("C:\\ORACLE\\LZ\\TEXT.TX_", LZ_TEXT, LZ_TEXT_SIZE);
    putFile("C:\\ORACLE\\LZ\\BIG.DA_", LZ_BIG, LZ_BIG_SIZE);
    putFile("C:\\ORACLE\\LZ\\RUNS.BI_", LZ_RUNS, LZ_RUNS_SIZE);

    lzText(3, 700, expected);
    literals("C:\\ORACLE\\LZ\\LIT.DA_", expected, 700, 'T');
    literals("C:\\ORACLE\\LZ\\NOEXT._", expected, 700, 0);
    literals("C:\\ORACLE\\LZ\\ODD.X_", expected, 700, 'y');
    literals("C:\\ORACLE\\LZ\\LOW.TX_", expected, 700, 't');
    literals("C:\\ORACLE\\LZ\\DIGIT.TX_", expected, 700, '1');

    /* Cut short: its header's size, three hundred bytes of its data. */
    putFile("C:\\ORACLE\\LZ\\CUT.TX_", LZ_TEXT, 314);

    /* Another algorithm's letter. */
    file = _lcreat("C:\\ORACLE\\LZ\\ALGB.TX_", 0);
    header(head, 'B', 'T', 3000);
    _lwrite(file, (LPCSTR)head, 14);
    _lwrite(file, (LPCSTR)(LZ_TEXT + 14), LZ_TEXT_SIZE - 14);
    _lclose(file);

    /* A signature one letter wrong. */
    file = _lcreat("C:\\ORACLE\\LZ\\BADSIG.TX_", 0);
    header(head, 'A', 'T', 3000);
    head[3] = 'E';
    _lwrite(file, (LPCSTR)head, 14);
    _lwrite(file, (LPCSTR)(LZ_TEXT + 14), LZ_TEXT_SIZE - 14);
    _lclose(file);

    lzText(4, 1500, expected);
    putFile("C:\\ORACLE\\LZ\\PLAIN.TXT", expected, 1500);
    putFile("C:\\ORACLE\\LZ\\SMALL.TXT", (const unsigned char far *)"short", 5);
    putFile("C:\\ORACLE\\LZ\\EMPTY.TXT", (const unsigned char far *)"", 0);
    /* Only a header, saying a file of 100 bytes. */
    file = _lcreat("C:\\ORACLE\\LZ\\HEAD.TX_", 0);
    header(head, 'A', 'T', 100);
    _lwrite(file, (LPCSTR)head, 14);
    _lclose(file);
}

/* A handle as the records give it: an LZ handle's slot, or DOS's handle. */
static void handleText(LPSTR out, int handle)
{
    if (handle >= 0x400 && handle < 0x410) {
        wsprintf(out, "lz%d", handle - 0x400);
    } else {
        wsprintf(out, "%d", handle);
    }
}

static unsigned int checksum(const unsigned char far *bytes, unsigned int count)
{
    unsigned int sum = 0;
    unsigned int i;

    for (i = 0; i < count; i++) sum = (sum << 1 | sum >> 15) ^ bytes[i];

    return sum;
}

/* How many of `count` bytes read from `at` are the expected data's. */
static unsigned int same(unsigned long at, unsigned int count)
{
    unsigned int i;

    for (i = 0; i < count; i++) {
        if (at + i >= expectedSize || got[i] != expected[(unsigned int)(at + i)]) {
            return i;
        }
    }

    return count;
}

static void names(void)
{
    static const char *NAMES[] = {
        "C:\\ORACLE\\LZ\\TEXT.TX_",
        "c:\\oracle\\lz\\text.tx_",
        "C:\\ORACLE\\LZ\\LOW.TX_",
        "c:\\oracle\\lz\\low.tx_",
        "1:\\ORACLE\\LZ\\LOW.TX_",
        "C:\\ORACLE\\LZ\\NOEXT._",
        "C:\\ORACLE\\LZ\\ODD.X_",
        "C:\\ORACLE\\LZ\\DIGIT.TX_",
        "C:\\ORACLE\\LZ\\BIG.DA_",
        "C:\\ORACLE\\LZ\\ALGB.TX_",
        "C:\\ORACLE\\LZ\\BADSIG.TX_",
        "C:\\ORACLE\\LZ\\CUT.TX_",
        "C:\\ORACLE\\LZ\\PLAIN.TXT",
        "C:\\ORACLE\\LZ\\SMALL.TXT",
        "C:\\ORACLE\\LZ\\EMPTY.TXT",
        "C:\\ORACLE\\LZ\\HEAD.TX_",
        "C:\\ORACLE\\LZ\\NONE.TX_",
        "C:\\ORACLE\\NOWHERE\\X.TX_",
    };
    char buffer[128];
    int i;

    for (i = 0; i < (int)(sizeof(NAMES) / sizeof(NAMES[0])); i++) {
        int answer;

        lstrcpy(buffer, "untouched");
        answer = GetExpandedName(NAMES[i], buffer);
        wsprintf(probeResult, "%d|%s", answer, (LPSTR)buffer);
        probe("name", NAMES[i], probeResult);
    }
}

static int openOne(LPCSTR name, UINT style)
{
    OFSTRUCT of;
    char handle[16];
    int answer;

    _fmemset(&of, 0xcc, sizeof(of));
    answer = LZOpenFile((LPSTR)name, &of, style);
    handleText(handle, answer);
    wsprintf(probeArgs, "%s,%04x", name, style);
    wsprintf(probeResult, "%s|%d|%d|%s", (LPSTR)handle, (int)of.cBytes, (int)of.nErrCode,
             (LPSTR)of.szPathName);
    probe("open", probeArgs, probeResult);

    return answer;
}

static void opens(void)
{
    int handle;

    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TX_", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TXT", OF_READ | OF_SHARE_DENY_NONE);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TXT", OF_READ | OF_SHARE_DENY_WRITE);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TXT", OF_EXIST);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TX_", OF_READWRITE);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\PLAIN.TXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\PLAIN.TX", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\SMALL.TXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\EMPTY.TXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\ALGB.TXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\BADSIG.TX_", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\NOEXT", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\NONE.TXT", OF_READ);
    handle = openOne("C:\\ORACLE\\NOWHERE\\NONE.TXT", OF_READ);
    handle = openOne("C:\\ORACLE\\LZ\\DIGIT.TXX", OF_READ);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\NEW.TXT", OF_CREATE);
    LZClose(handle);
    handle = openOne("C:\\ORACLE\\LZ\\NEW.TXT", OF_DELETE);
    handle = openOne("C:\\ORACLE\\LZ\\TEXT.TXT", OF_PARSE);
}

/* A whole file read in pieces of `piece`, each read's answer kept short: the run of the same answer. */
static void readAll(LPCSTR name, const char *which, int piece)
{
    OFSTRUCT of;
    int handle = LZOpenFile((LPSTR)name, &of, OF_READ);
    unsigned long at = 0;
    unsigned int good = 0;
    unsigned int sum = 0;
    char answers[256];
    LPSTR to = answers;
    int last = -32768;
    int runs = 0;
    int answer;

    expect(which);
    answers[0] = 0;

    for (;;) {
        answer = LZRead(handle, (LPSTR)got, piece);

        if (answer != last) {
            if (runs > 0 && to - answers < 200) {
                to += wsprintf(to, "x%d ", runs);
            }

            if (to - answers < 200) {
                to += wsprintf(to, "%d", answer);
            }

            last = answer;
            runs = 0;
        }

        runs++;

        if (answer <= 0) {
            break;
        }

        good += same(at, answer);
        sum = sum + checksum(got, answer);
        at += answer;
    }

    if (to - answers < 200) {
        wsprintf(to, "x%d", runs);
    }

    LZClose(handle);
    wsprintf(probeArgs, "%s,%d", name, piece);
    wsprintf(probeResult, "%lu|%u|%u|%04x|%s", at, good, expectedSize, sum, (LPSTR)answers);
    probe("read", probeArgs, probeResult);
}

static void reads(void)
{
    static const int PIECES[] = { 1, 7, 100, 1024, 1025, 4096, 30000 };
    int i;

    for (i = 0; i < (int)(sizeof(PIECES) / sizeof(PIECES[0])); i++) {
        readAll("C:\\ORACLE\\LZ\\BIG.DAT", "BIG", PIECES[i]);
    }

    readAll("C:\\ORACLE\\LZ\\TEXT.TXT", "TEXT", 512);
    readAll("C:\\ORACLE\\LZ\\RUNS.BIN", "RUNS", 100);
    readAll("C:\\ORACLE\\LZ\\LIT.DAT", "LIT", 64);
    readAll("C:\\ORACLE\\LZ\\PLAIN.TXT", "PLAIN", 600);
    readAll("C:\\ORACLE\\LZ\\CUT.TXT", "TEXT", 100);
    readAll("C:\\ORACLE\\LZ\\CUT.TXT", "TEXT", 3000);
    readAll("C:\\ORACLE\\LZ\\HEAD.TXT", "TEXT", 50);
    readAll("C:\\ORACLE\\LZ\\BADSIG.TX_", "TEXT", 100);
}

/* One seek, and a read of `count` after it: their answers and the bytes'. */
static void seekOne(int handle, long offset, int origin, int count)
{
    long to = LZSeek(handle, offset, origin);
    int answer;
    unsigned int good;

    _fmemset(got, 0, count > 0 ? count : 1);
    answer = count >= 0 ? LZRead(handle, (LPSTR)got, count) : 0;
    good = answer > 0 && to >= 0 ? same(to, answer) : 0;
    wsprintf(probeArgs, "%ld,%d,%d", offset, origin, count);
    wsprintf(probeResult, "%ld|%d|%u|%02x%02x%02x%02x", to, answer, good, got[0], got[1], got[2],
             got[3]);
    probe("seek", probeArgs, probeResult);
}

static void seeks(void)
{
    OFSTRUCT of;
    int handle = LZOpenFile("C:\\ORACLE\\LZ\\BIG.DAT", &of, OF_READ);

    expect("BIG");
    seekOne(handle, 0, 1, 10);
    seekOne(handle, 15000, 0, 100);
    seekOne(handle, 0, 1, 100);
    seekOne(handle, 100, 0, 100);
    seekOne(handle, -50, 1, 100);
    seekOne(handle, -100, 2, 200);
    seekOne(handle, 0, 2, 10);
    seekOne(handle, 10, 2, 10);
    seekOne(handle, 19999, 0, 10);
    seekOne(handle, 5000, 0, 2000);
    seekOne(handle, 4000, 0, 2000);
    seekOne(handle, 6990, 0, 20);
    seekOne(handle, 7000, 0, 20);
    seekOne(handle, -1, 0, 10);
    seekOne(handle, -30000, 1, 10);
    seekOne(handle, 0, 3, 10);
    seekOne(handle, 0, -1, 10);
    seekOne(handle, 12345, 0, -1);
    seekOne(handle, 12, 0, 0);
    seekOne(handle, 70000L, 0, 10);
    LZClose(handle);

    handle = LZOpenFile("C:\\ORACLE\\LZ\\PLAIN.TXT", &of, OF_READ);
    expect("PLAIN");
    seekOne(handle, 0, 1, 10);
    seekOne(handle, 700, 0, 100);
    seekOne(handle, -10, 2, 100);
    seekOne(handle, 0, 2, 10);
    seekOne(handle, 2000, 0, 10);
    seekOne(handle, -1, 0, 10);
    seekOne(handle, 0, 3, 10);
    seekOne(handle, 5, 0, -1);
    LZClose(handle);
}

static void inits(void)
{
    static const char *FILES[] = {
        "C:\\ORACLE\\LZ\\TEXT.TX_",
        "C:\\ORACLE\\LZ\\PLAIN.TXT",
        "C:\\ORACLE\\LZ\\SMALL.TXT",
        "C:\\ORACLE\\LZ\\EMPTY.TXT",
        "C:\\ORACLE\\LZ\\ALGB.TX_",
        "C:\\ORACLE\\LZ\\BADSIG.TX_",
        "C:\\ORACLE\\LZ\\HEAD.TX_",
    };
    char handle[16];
    char before[16];
    int i;

    for (i = 0; i < (int)(sizeof(FILES) / sizeof(FILES[0])); i++) {
        HFILE file = _lopen(FILES[i], OF_READ);
        int answer;
        long where;

        _llseek(file, 5, 0);
        answer = LZInit(file);
        handleText(handle, answer);
        handleText(before, file);
        where = _llseek(file, 0, 1);
        wsprintf(probeResult, "%s|%s|%ld", (LPSTR)before, (LPSTR)handle, where);
        probe("init", FILES[i], probeResult);

        if (answer < 0x400) {
            _lclose(file);
        } else {
            LZClose(answer);
        }
    }

    /* LZInit of a handle that is not open, and of one already LZEXPAND's. */
    {
        int answer = LZInit(40);
        OFSTRUCT of;
        int lz = LZOpenFile("C:\\ORACLE\\LZ\\TEXT.TX_", &of, OF_READ);

        handleText(handle, answer);
        probe("init", "40", handle);
        answer = LZInit(lz);
        handleText(handle, answer);
        probe("init", "lz", handle);
        LZClose(lz);
    }
}

/* The file a copy made: its size, and how much of it is the data. */
static void made(LPSTR out, LPCSTR name)
{
    HFILE file = _lopen(name, OF_READ);
    long size;
    int count;

    if (file == HFILE_ERROR) {
        wsprintf(out, "none");
        return;
    }

    size = _llseek(file, 0, 2);
    _llseek(file, 0, 0);
    count = _lread(file, (LPSTR)got, 30000);
    _lclose(file);
    wsprintf(out, "%ld|%u|%04x", size, count > 0 ? same(0, count) : 0, count > 0 ? checksum(got, count) : 0);
}

static void copyOne(LPCSTR from, const char *which, int lz, int flavour)
{
    OFSTRUCT of;
    int source;
    HFILE to;
    long answer;
    char handle[16];
    char file[64];

    expect(which);
    source = lz ? LZOpenFile((LPSTR)from, &of, OF_READ) : _lopen(from, OF_READ);

    if (lz == 2) {
        /* Partly read first. */
        LZRead(source, (LPSTR)got, 1000);
    }

    to = _lcreat("C:\\ORACLE\\LZ\\OUT.DAT", 0);
    answer = flavour ? CopyLZFile(source, to) : LZCopy(source, to);
    _lclose(to);

    if (lz) {
        LZClose(source);
    } else {
        _lclose(source);
    }

    handleText(handle, source);
    made(file, "C:\\ORACLE\\LZ\\OUT.DAT");
    wsprintf(probeArgs, "%s,%d,%d", from, lz, flavour);
    wsprintf(probeResult, "%s|%ld|%s", (LPSTR)handle, answer, (LPSTR)file);
    probe("copy", probeArgs, probeResult);
    OpenFile("C:\\ORACLE\\LZ\\OUT.DAT", &of, OF_DELETE);
}

static void copies(void)
{
    OFSTRUCT of;
    HFILE to;
    HFILE from;
    long answer;

    copyOne("C:\\ORACLE\\LZ\\TEXT.TX_", "TEXT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\BIG.DA_", "BIG", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\RUNS.BI_", "RUNS", 0, 1);
    copyOne("C:\\ORACLE\\LZ\\LIT.DA_", "LIT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\PLAIN.TXT", "PLAIN", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\SMALL.TXT", "PLAIN", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\EMPTY.TXT", "PLAIN", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\CUT.TX_", "TEXT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\ALGB.TX_", "TEXT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\HEAD.TX_", "TEXT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\BADSIG.TX_", "TEXT", 0, 0);
    copyOne("C:\\ORACLE\\LZ\\TEXT.TXT", "TEXT", 1, 0);
    copyOne("C:\\ORACLE\\LZ\\BIG.DAT", "BIG", 2, 1);
    copyOne("C:\\ORACLE\\LZ\\PLAIN.TXT", "PLAIN", 1, 0);

    /* Into a handle that is none, and from handles that are none. */
    from = _lopen("C:\\ORACLE\\LZ\\TEXT.TX_", OF_READ);
    answer = LZCopy(from, 45);
    _lclose(from);
    wsprintf(probeResult, "%ld", answer);
    probe("copy", "badout", probeResult);

    to = _lcreat("C:\\ORACLE\\LZ\\OUT.DAT", 0);
    answer = LZCopy(0x40f, to);
    wsprintf(probeResult, "%ld", answer);
    probe("copy", "lz15", probeResult);
    answer = LZCopy(45, to);
    wsprintf(probeResult, "%ld", answer);
    probe("copy", "45", probeResult);
    _lclose(to);
    OpenFile("C:\\ORACLE\\LZ\\OUT.DAT", &of, OF_DELETE);
}

static void handles(void)
{
    OFSTRUCT of;
    int open[18];
    char text[200];
    LPSTR at = text;
    int i;

    /* Room for more DOS handles than LZEXPAND has slots. */
    SetHandleCount(40);

    for (i = 0; i < 18; i++) {
        open[i] = LZOpenFile("C:\\ORACLE\\LZ\\TEXT.TX_", &of, OF_READ);
        at += wsprintf(at, "%x ", open[i]);
    }

    probe("handles", "18", text);

    /* Two let go, then two more taken: which slots they get. */
    LZClose(open[3]);
    LZClose(open[9]);
    at = text;

    for (i = 0; i < 2; i++) {
        int one = LZOpenFile("C:\\ORACLE\\LZ\\TEXT.TX_", &of, OF_READ);

        at += wsprintf(at, "%x ", one);
        open[i == 0 ? 3 : 9] = one;
    }

    probe("handles", "again", text);

    for (i = 0; i < 18; i++) {
        if (open[i] >= 0) {
            LZClose(open[i]);
        }
    }

    /* One more, after all were let go. */
    i = LZOpenFile("C:\\ORACLE\\LZ\\TEXT.TX_", &of, OF_READ);
    wsprintf(text, "%x", i);
    probe("handles", "after", text);
    LZClose(i);
}

static void bad(void)
{
    static const int HANDLES[] = { -5, 0x40f, 0x410, 0x7fff, 50 };
    int i;

    for (i = 0; i < (int)(sizeof(HANDLES) / sizeof(HANDLES[0])); i++) {
        long seek = LZSeek(HANDLES[i], 0, 0);
        int read = LZRead(HANDLES[i], (LPSTR)got, 10);

        LZClose(HANDLES[i]);
        wsprintf(probeArgs, "%x", HANDLES[i]);
        wsprintf(probeResult, "%ld|%d", seek, read);
        probe("bad", probeArgs, probeResult);
    }
}

static void starts(void)
{
    int first = LZStart();
    int second = LZStart();

    wsprintf(probeResult, "%d|%d", first, second);
    probe("start", "twice", probeResult);
    copyOne("C:\\ORACLE\\LZ\\TEXT.TX_", "TEXT", 0, 0);
    LZDone();
    copyOne("C:\\ORACLE\\LZ\\RUNS.BI_", "RUNS", 0, 0);
    LZDone();
    LZDone();
    copyOne("C:\\ORACLE\\LZ\\LIT.DA_", "LIT", 0, 0);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    expected = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 30000));
    got = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 30000));

    makeFiles();
    names();
    opens();
    reads();
    seeks();
    inits();
    copies();
    handles();
    bad();
    starts();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
