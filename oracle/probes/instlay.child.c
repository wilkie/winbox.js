/*
 * The program `instlay.c` installs into C:\INSTLAY and starts from there:
 * it reads back what the installer left on C:, and adds its records to
 * the installer's file, `c.` before each. It makes no window and writes
 * nothing else, and ends as it is done.
 *
 * * `c.module`: where it was started from.
 * * `c.list`: C:\INSTLAY, every entry, in the order of their names: each
 *   name, its attributes, its size and a sum of its bytes.
 * * `c.found`: the files of C:\WINDOWS\SYSTEM named INSTLAY.*, and of
 *   C:\WINDOWS named INSTLAY.IN? -- not the installer beside them, which
 *   is media -- each name, size and sum.
 * * `c.there`: what the installer deleted, or made and deleted, or
 *   unpacked and deleted: whether each is there.
 * * `c.bytes`: whether the two files expanded hold what was compressed.
 * * `c.profile`: what WIN.INI and each INSTLAY.INI say, by
 *   GetProfileString and GetPrivateProfileString; `c.text`, each
 *   INSTLAY.INI's bytes and WIN.INI's from its [InstLay] on.
 * * `c.stamp`: for each file and folder the installer wrote, whether its
 *   stamp is README.TXT's; and SYSTEM\MIDIMAP.CFG's, which it did not.
 */

#include <windows.h>
#include <dos.h>

#define OUTPUT "C:\\ORACLE\\INSTLAY.OUT"
#define HOME "C:\\INSTLAY"

static unsigned char far *buffer;
static char line[1400];
static char text[1200];

static LPSTR escape(LPSTR out, LPCSTR in)
{
    while (*in) {
        switch (*in) {
        case '\\': *out++ = '\\'; *out++ = '\\'; break;
        case '\t': *out++ = '\\'; *out++ = 't';  break;
        case '\r': *out++ = '\\'; *out++ = 'r';  break;
        case '\n': *out++ = '\\'; *out++ = 'n';  break;
        default:   *out++ = *in;                 break;
        }

        in++;
    }

    *out = '\0';
    return out;
}

/* One record, added to the installer's file as it stands. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    HFILE file = _lopen(OUTPUT, OF_READWRITE);
    LPSTR at = line;

    if (file == HFILE_ERROR) {
        file = _lcreat(OUTPUT, 0);
    }

    at = escape(at, "c.");
    at = escape(at, function);
    *at++ = '\t';
    at = escape(at, args);
    *at++ = '\t';
    at = escape(at, result);
    *at++ = '\r';
    *at++ = '\n';

    _llseek(file, 0L, 2);
    _lwrite(file, line, (int)(at - line));
    _lclose(file);
}

static unsigned int sumOf(const unsigned char far *bytes, unsigned int count)
{
    unsigned int sum = 0;
    unsigned int i;

    for (i = 0; i < count; i++) sum = (sum << 1 | sum >> 15) ^ bytes[i];

    return sum;
}

/* A file's bytes into the buffer: how many, or -1 where it is not there. */
static long readAll(LPCSTR path)
{
    HFILE file = _lopen(path, OF_READ);
    long size;

    if (file == HFILE_ERROR) {
        return -1;
    }

    size = _lread(file, (LPSTR)buffer, 30000);
    _lclose(file);
    return size;
}

/* The entries a pattern finds, sorted by name, into `text`. */
static void listing(LPCSTR pattern, LPCSTR folder, unsigned attributes)
{
    struct find_t found;
    char names[16][13];
    unsigned char kinds[16];
    int count = 0;
    int i;
    int j;
    unsigned done;
    LPSTR out = text;

    for (done = _dos_findfirst(pattern, attributes, &found); done == 0 && count < 16;
         done = _dos_findnext(&found)) {
        lstrcpy(names[count], found.name);
        kinds[count++] = found.attrib;
    }

    for (i = 0; i < count; i++) {
        for (j = i + 1; j < count; j++) {
            if (lstrcmp(names[j], names[i]) < 0) {
                char swap[13];
                unsigned char kind = kinds[i];

                lstrcpy(swap, names[i]);
                lstrcpy(names[i], names[j]);
                lstrcpy(names[j], swap);
                kinds[i] = kinds[j];
                kinds[j] = kind;
            }
        }
    }

    *out = 0;

    for (i = 0; i < count; i++) {
        char path[80];
        long size;

        wsprintf(path, "%s\\%s", folder, (LPSTR)names[i]);
        size = kinds[i] & _A_SUBDIR ? 0 : readAll(path);
        out += wsprintf(out, "%s:%02x:%ld:%04x ", (LPSTR)names[i], kinds[i], size,
                        size > 0 ? sumOf(buffer, (unsigned int)size) : 0);
    }
}

static void there(LPCSTR path)
{
    struct find_t found;

    record("there", path,
           _dos_findfirst(path, _A_NORMAL | _A_SUBDIR | _A_HIDDEN | _A_SYSTEM, &found) == 0
               ? "yes"
               : "no");
}

/* The data each compressed file holds, made again, as `lzfiles` makes it. */
static unsigned long lcg;

static unsigned char lzNext(void)
{
    lcg = lcg * 1103515245UL + 12345UL;
    return (unsigned char)(lcg >> 16);
}

static const char *WORDS[] = {
    "the ", "quick ", "brown ", "fox ", "jumps ", "over ", "lazy ", "dog ", "\r\n", "Windows ", "  ",
};

static int textAt(unsigned long seed, unsigned int count, long size)
{
    unsigned int at = 0;

    lcg = seed;

    if (size != (long)count) {
        return -2;
    }

    while (at < count) {
        const char *word = WORDS[lzNext() % 11];

        while (*word && at < count) {
            if (buffer[at] != (unsigned char)*word) {
                return (int)at;
            }

            at++;
            word++;
        }
    }

    return -1;
}

static int runsAt(long size)
{
    static unsigned char runs[756];
    unsigned int at = 0;
    unsigned int i;

    for (i = 0; i < 100; i++) runs[at++] = ' ';
    for (i = 0; i < 200; i++) runs[at++] = 'A';
    for (i = 0; i < 100; i++) { runs[at++] = 'A'; runs[at++] = 'B'; }
    for (i = 0; i < 256; i++) runs[at++] = (unsigned char)i;

    if (size != (long)at) {
        return -2;
    }

    for (i = 0; i < at; i++) {
        if (buffer[i] != runs[i]) {
            return (int)i;
        }
    }

    return -1;
}

static void bytes(LPCSTR path, int at)
{
    wsprintf(text, at == -1 ? "same" : at == -2 ? "size" : "differs at %d", at);
    record("bytes", path, text);
}

static void profiles(void)
{
    GetProfileString("InstLay", "Path", "(none)", text, sizeof(text));
    record("profile", "WIN.INI [InstLay] Path", text);
    GetProfileString("InstLay", "Media", "(none)", text, sizeof(text));
    record("profile", "WIN.INI [InstLay] Media", text);
    GetPrivateProfileString("Settings", "Level", "(none)", text, sizeof(text),
                            HOME "\\INSTLAY.INI");
    record("profile", HOME "\\INSTLAY.INI [Settings] Level", text);
    GetPrivateProfileString("Settings", "Name", "(none)", text, sizeof(text), HOME "\\INSTLAY.INI");
    record("profile", HOME "\\INSTLAY.INI [Settings] Name", text);
    GetPrivateProfileString("Installed", "From", "(none)", text, sizeof(text), "INSTLAY.INI");
    record("profile", "INSTLAY.INI [Installed] From", text);
}

/* A file's text, from a place in it on: its bytes as they are. */
static void textOf(LPCSTR path, LPCSTR from)
{
    long size = readAll(path);
    long at = 0;
    long start = -1;
    int length = lstrlen(from);
    int i;

    if (size < 0) {
        record("text", path, "(none)");
        return;
    }

    for (at = 0; *from && at + length <= size && start < 0; at++) {
        for (i = 0; i < length && buffer[at + i] == (unsigned char)from[i]; i++) {
        }

        if (i == length) {
            start = at;
        }
    }

    if (!*from) {
        start = 0;
    }

    if (start < 0) {
        record("text", path, "(not found)");
        return;
    }

    for (i = 0; start + i < size && i < (int)sizeof(text) - 1; i++) {
        text[i] = buffer[start + i] ? buffer[start + i] : '.';
    }

    text[i] = 0;
    record("text", path, text);
}

static int stampOf(LPCSTR path, unsigned *date, unsigned *time)
{
    struct find_t found;

    *date = *time = 0;

    if (_dos_findfirst(path, _A_NORMAL | _A_SUBDIR | _A_HIDDEN | _A_SYSTEM, &found)) {
        return 0;
    }

    *date = found.wr_date;
    *time = found.wr_time;
    return 1;
}

static void stamps(void)
{
    static const char *WRITTEN[] = {
        HOME "\\INSTLAYC.EXE",
        HOME "\\INSTLAY.INI",
        "C:\\WINDOWS\\SYSTEM\\INSTLAY.DLL",
        "C:\\WINDOWS\\INSTLAY.INI",
        "C:\\WINDOWS\\WIN.INI",
        HOME,
        "C:\\WINDOWS",
        "C:\\WINDOWS\\SYSTEM",
        "C:\\WINDOWS\\TEMP",
        "C:\\WINDOWS\\SYSTEM\\MIDIMAP.CFG",
    };
    unsigned date;
    unsigned time;
    unsigned readmeDate;
    unsigned readmeTime;
    int i;

    stampOf(HOME "\\README.TXT", &readmeDate, &readmeTime);

    for (i = 0; i < 10; i++) {
        int found = stampOf(WRITTEN[i], &date, &time);

        record("stamp", WRITTEN[i],
               !found                                           ? "(none)"
               : date == readmeDate && time == readmeTime ? "as README.TXT"
                                                                : "other");
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[144];

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 30000));

    GetModuleFileName(instance, path, sizeof(path));
    record("module", "", path);

    listing(HOME "\\*.*", HOME, _A_NORMAL | _A_SUBDIR | _A_RDONLY | _A_HIDDEN | _A_SYSTEM);
    record("list", HOME, text);
    listing("C:\\WINDOWS\\SYSTEM\\INSTLAY.*", "C:\\WINDOWS\\SYSTEM", _A_NORMAL);
    record("found", "C:\\WINDOWS\\SYSTEM\\INSTLAY.*", text);
    /* Not INSTLAY.*: the installer itself is there, its media, which
     * is not kept once it has installed (`kb/formats/layer.md`). */
    listing("C:\\WINDOWS\\INSTLAY.IN?", "C:\\WINDOWS", _A_NORMAL);
    record("found", "C:\\WINDOWS\\INSTLAY.IN?", text);

    there("C:\\WINDOWS\\SYSTEM\\SETUP.REG");
    there("C:\\WINDOWS\\TEMP\\INSTLAY.TX_");
    there("C:\\WINDOWS\\TEMP\\INSTLAY.DL_");
    there(HOME "\\TMP");
    there("C:\\WINDOWS\\INSTTMP");

    bytes(HOME "\\README.TXT", textAt(1, 3000, readAll(HOME "\\README.TXT")));
    bytes("C:\\WINDOWS\\SYSTEM\\INSTLAY.DLL", runsAt(readAll("C:\\WINDOWS\\SYSTEM\\INSTLAY.DLL")));

    profiles();
    textOf(HOME "\\INSTLAY.INI", "");
    textOf("C:\\WINDOWS\\INSTLAY.INI", "");
    textOf("C:\\WINDOWS\\WIN.INI", "[InstLay]");

    stamps();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
