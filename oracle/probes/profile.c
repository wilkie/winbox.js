/*
 * The initialisation file calls.
 *
 * Nearly everything Windows knows about itself is read through these, which
 * makes them load-bearing far out of proportion to how simple they look.
 * `WIN.INI` holds the locale -- Clock reads `[intl] s1159` to learn that noon
 * is written "PM" -- along with the installed fonts, the printer ports and the
 * font substitutions that decide what "Helv" actually draws as. A program's
 * own settings live in its own file, read through the private variants.
 *
 * The format is less obvious than it looks, and the parts that are not obvious
 * are precisely the parts programs depend on:
 *
 * * Whether a lookup is case-sensitive, on the section and on the entry.
 * * Whether the whitespace around a value is part of it.
 * * Whether a value wrapped in quotes keeps them.
 * * What a truncated answer returns, which the documentation states for the
 *   ordinary case and leaves open for the case where a whole section is being
 *   enumerated.
 * * What `GetProfileInt` does with a value that is not a number, is only
 *   partly a number, or is negative -- three different answers, none of them
 *   what `atoi` would give.
 *
 * The file this reads is written by the probe itself rather than shipped with
 * it, so the answers do not depend on what the installer happened to leave on
 * the disk. The `WIN.INI` cases at the end are the exception, and they are
 * there because they are what a real program actually asks for.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PROFILE.OUT"
#define SUBJECT "C:\\ORACLE\\PROBE.INI"

/* Fills a buffer with a marker, so that "wrote nothing" and "wrote an empty
 * string" are distinguishable afterwards. Written out rather than taken from
 * the SDK, which has no such call in this version.
 */
static void probeFill(LPSTR buffer, int size)
{
    while (size-- > 0) {
        *buffer++ = '#';
    }
}

/*
 * Records a string lookup.
 *
 * Both the returned count and the buffer contents are recorded: the count is
 * what the function returns, and the buffer is what it actually wrote, and the
 * two can disagree in ways that matter -- a truncated answer is still
 * null-terminated, and the count says how much of it is real.
 */
static void probeString(LPCSTR section, LPCSTR entry, LPCSTR fallback, int size)
{
    char buffer[128];
    int count;

    /* Filled with a marker first, so that a function which writes nothing at
     * all is distinguishable from one that writes an empty string.
     */
    probeFill(buffer, sizeof(buffer));

    count = GetPrivateProfileString(section, entry, fallback, buffer, size, SUBJECT);
    buffer[size < (int)sizeof(buffer) ? size : (int)sizeof(buffer) - 1] = '\0';

    wsprintf(probeArgs, "\"%s\",\"%s\",\"%s\",%d", (LPSTR)section, (LPSTR)entry,
             (LPSTR)fallback, size);
    wsprintf(probeResult, "%d,\"%s\"", count, (LPSTR)buffer);
    probe("GetPrivateProfileString", probeArgs, probeResult);
}

/*
 * Records the form that enumerates a whole section.
 *
 * The answer is a run of null-terminated names with a second null closing it,
 * which cannot be written to a tab-separated record as it stands. The nulls
 * become bars, which keeps the shape of the answer visible -- including
 * whether the closing null is there and whether a truncated list keeps its
 * terminator.
 */
static void probeSection(LPCSTR section, int size)
{
    char buffer[128];
    char shown[256];
    int count;
    int at;

    probeFill(buffer, sizeof(buffer));

    count = GetPrivateProfileString(section, NULL, "", buffer, size, SUBJECT);

    for (at = 0; at < count; at++) {
        shown[at] = buffer[at] ? buffer[at] : '|';
    }

    shown[count] = '\0';

    wsprintf(probeArgs, "\"%s\",NULL,%d", (LPSTR)section, size);
    wsprintf(probeResult, "%d,\"%s\"", count, (LPSTR)shown);
    probe("GetPrivateProfileString", probeArgs, probeResult);
}

/* Records an integer lookup. */
static void probeInt(LPCSTR section, LPCSTR entry, int fallback)
{
    UINT value = GetPrivateProfileInt(section, entry, fallback, SUBJECT);

    wsprintf(probeArgs, "\"%s\",\"%s\",%d", (LPSTR)section, (LPSTR)entry, fallback);
    wsprintf(probeResult, "%u", value);
    probe("GetPrivateProfileInt", probeArgs, probeResult);
}

/* Records what `WIN.INI` says, through the calls that read it. */
static void probeWindows(LPCSTR section, LPCSTR entry, LPCSTR fallback)
{
    char buffer[128];
    int count;

    count = GetProfileString(section, entry, fallback, buffer, sizeof(buffer));

    wsprintf(probeArgs, "\"%s\",\"%s\",\"%s\"", (LPSTR)section, (LPSTR)entry,
             (LPSTR)fallback);
    wsprintf(probeResult, "%d,\"%s\"", count, (LPSTR)buffer);
    probe("GetProfileString", probeArgs, probeResult);
}

/*
 * Records a write and then reads it back.
 *
 * What a write returns is worth having, but what it did to the file is worth
 * more, and reading it back through the same API is the only way to ask that
 * without depending on how the file is laid out on disk.
 */
static void probeWrite(LPCSTR section, LPCSTR entry, LPCSTR value)
{
    char buffer[128];
    BOOL ok;

    ok = WritePrivateProfileString(section, entry, value, SUBJECT);

    GetPrivateProfileString(section, entry ? entry : "x", "<gone>", buffer,
                            sizeof(buffer), SUBJECT);

    wsprintf(probeArgs, "\"%s\",\"%s\",\"%s\"", (LPSTR)section,
             entry ? (LPSTR)entry : (LPSTR)"NULL", value ? (LPSTR)value : (LPSTR)"NULL");
    wsprintf(probeResult, "%d,\"%s\"", (int)ok, (LPSTR)buffer);
    probe("WritePrivateProfileString", probeArgs, probeResult);
}

/*
 * Whether a write changes the caller's own string.
 *
 * `probeWrite` prints the value it passed after the write has happened, and the
 * first recording printed `"  untrimmed  "` as `"  untrimmed"`: the trailing
 * spaces were gone from the probe's own string, not only from the file. So ask
 * it directly. The value is copied into a buffer of the probe's, and the record
 * is that buffer's length before and after the write, what it holds afterwards,
 * and what reads back.
 */
static void probeWriteInPlace(LPCSTR entry, LPCSTR value)
{
    char copy[64];
    char buffer[128];
    int before;
    BOOL ok;

    lstrcpy(copy, value);
    before = lstrlen(copy);

    ok = WritePrivateProfileString("Plain", entry, copy, SUBJECT);

    GetPrivateProfileString("Plain", entry, "<gone>", buffer, sizeof(buffer), SUBJECT);

    wsprintf(probeArgs, "\"%s\",\"%s\"", (LPSTR)entry, (LPSTR)value);
    wsprintf(probeResult, "%d,%d,%d,\"%s\",\"%s\"", (int)ok, before, lstrlen(copy),
             (LPSTR)copy, (LPSTR)buffer);
    probe("WritePrivateProfileString in place", probeArgs, probeResult);
}

/*
 * A value read again once the cache is flushed. Named apart from the first
 * reads because what it answers depends on every write before it.
 */
static void probeReread(LPCSTR section, LPCSTR entry, LPCSTR when)
{
    char buffer[128];
    char name[64];
    int count;

    count = GetPrivateProfileString(section, entry, "<default>", buffer, sizeof(buffer), SUBJECT);

    wsprintf(name, "GetPrivateProfileString %s", (LPSTR)when);
    wsprintf(probeArgs, "\"%s\",\"%s\"", (LPSTR)section, (LPSTR)entry);
    wsprintf(probeResult, "%d,\"%s\"", count, (LPSTR)buffer);
    probe(name, probeArgs, probeResult);
}

/*
 * The file's bytes, in hex, so that what a line-by-line dump cannot show --
 * a carriage return in the middle of a line, a stray byte after a value --
 * is on the record exactly. Taken after each write, so that each write's
 * own effect on the file can be told from the next one's.
 */
static void probeFileHex(LPCSTR label)
{
    static const char HEX[] = "0123456789abcdef";
    static char text[1024];
    static char hex[2049];
    HFILE file;
    int length;
    int at;

    file = _lopen(SUBJECT, OF_READ);

    if (file == HFILE_ERROR) {
        probe("file bytes", label, "open failed");
        return;
    }

    length = _lread(file, text, sizeof(text));
    _lclose(file);

    if (length < 0) {
        length = 0;
    }

    for (at = 0; at < length; at++) {
        hex[at * 2] = HEX[(text[at] >> 4) & 0xf];
        hex[at * 2 + 1] = HEX[text[at] & 0xf];
    }

    hex[length * 2] = '\0';
    probe("file bytes", label, hex);
}

/*
 * The file as Windows left it, a line at a time.
 *
 * What reads back says whether a value survived a write, not how the writer
 * kept it: a value with spaces at its start reads back with them, where the
 * reader trims the spaces from an unquoted one. Only the bytes can say whether
 * the writer quoted it. So after the writes, record every line of the file.
 */
static void probeFile(void)
{
    static char text[4096];
    HFILE file;
    int length;
    int start;
    int at;
    int line;

    file = _lopen(SUBJECT, OF_READ);

    if (file == HFILE_ERROR) {
        probe("file line", "open", "failed");
        return;
    }

    length = _lread(file, text, sizeof(text) - 1);
    _lclose(file);

    if (length < 0) {
        length = 0;
    }

    text[length] = '\0';

    for (start = 0, at = 0, line = 1; at <= length; at++) {
        if (at == length || text[at] == '\n') {
            int end = at;

            if (end > start && text[end - 1] == '\r') {
                end--;
            }

            if (at < length || end > start) {
                char saved = text[end];

                text[end] = '\0';
                wsprintf(probeArgs, "%d", line);
                probe("file line", probeArgs, text + start);
                text[end] = saved;
                line++;
            }

            start = at + 1;
        }
    }
}

/*
 * Lays down the file the lookups run against.
 *
 * Written a line at a time through the file API rather than through
 * `WritePrivateProfileString`, because the point is to control exactly what
 * the file contains -- the odd spacing and the quotes are the cases being
 * measured, and a writer that tidies them up would erase them.
 */
static void writeSubject(void)
{
    static char text[] =
        "[Plain]\r\n"
        "entry=value\r\n"
        "spaced   =   padded value   \r\n"
        "quoted=\"  kept  \"\r\n"
        "single='  also  '\r\n"
        "empty=\r\n"
        "MiXeD=case test\r\n"
        "number=42\r\n"
        "trailing=40two\r\n"
        "negative=-1\r\n"
        "words=none\r\n"
        "quotednumber=\"7\"\r\n"
        "; a comment line\r\n"
        "semicolon=;\r\n"
        "equals=a=b\r\n"
        "\r\n"
        "[Second]\r\n"
        "only=one\r\n"
        "\r\n"
        "[Spacing]\r\n"
        "after=   after only\r\n"
        "before   =before only\r\n"
        "around   =   around both\r\n"
        "tabbed=\tafter a tab\r\n"
        "ends=  both ends  \r\n"
        "\r\n"
        "[Odd]   \r\n"
        "  indented  =  in  \r\n"
        "bare line  \r\n"
        "one=x \r\n";

    HFILE handle = _lcreat(SUBJECT, 0);

    if (handle != HFILE_ERROR) {
        _lwrite(handle, text, sizeof(text) - 1);
        _lclose(handle);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    writeSubject();

    probeNote("reading values, and what surrounds them");
    probeString("Plain", "entry", "<default>", 128);
    probeString("Plain", "spaced", "<default>", 128);
    probeString("Plain", "quoted", "<default>", 128);
    probeString("Plain", "single", "<default>", 128);
    probeString("Plain", "empty", "<default>", 128);
    probeString("Plain", "semicolon", "<default>", 128);
    probeString("Plain", "equals", "<default>", 128);

    /* Which whitespace the reader drops. `spaced` above has it on both sides of
     * the `=` and at the end, and reads back without any of it; a value
     * written with spaces at its start reads back with them. These separate
     * the places the spaces can be.
     */
    probeNote("whitespace on each side of the equals sign");
    probeString("Spacing", "after", "<default>", 128);
    probeString("Spacing", "before", "<default>", 128);
    probeString("Spacing", "around", "<default>", 128);
    probeString("Spacing", "tabbed", "<default>", 128);
    probeString("Spacing", "ends", "<default>", 128);
    probeString("Odd", "indented", "<default>", 128);
    probeString("Odd", "one", "<default>", 128);
    probeSection("Odd", 128);

    probeNote("case, on the entry and on the section");
    probeString("Plain", "mixed", "<default>", 128);
    probeString("Plain", "MIXED", "<default>", 128);
    probeString("PLAIN", "entry", "<default>", 128);
    probeString("plain", "entry", "<default>", 128);

    probeNote("what is not there");
    probeString("Plain", "absent", "<default>", 128);
    probeString("Absent", "entry", "<default>", 128);
    probeString("Plain", "absent", "", 128);

    probeNote("buffers too small to hold the answer");
    probeString("Plain", "entry", "<default>", 6);
    probeString("Plain", "entry", "<default>", 5);
    probeString("Plain", "entry", "<default>", 2);
    probeString("Plain", "entry", "<default>", 1);
    probeString("Plain", "absent", "<default>", 4);

    probeNote("enumerating a section");
    probeSection("Second", 128);
    probeSection("Plain", 128);
    probeSection("Absent", 128);
    probeSection("Second", 6);

    probeNote("values read as numbers");
    probeInt("Plain", "number", 99);
    probeInt("Plain", "trailing", 99);
    probeInt("Plain", "negative", 99);
    probeInt("Plain", "words", 99);
    probeInt("Plain", "empty", 99);
    probeInt("Plain", "quotednumber", 99);
    probeInt("Plain", "absent", 99);
    probeInt("Absent", "number", 99);

    probeNote("writing, and reading back what was written");
    probeFileHex("before any write");
    probeWrite("Plain", "added", "new value");
    probeFileHex("after added");
    probeWrite("Plain", "entry", "replaced");
    probeFileHex("after entry");
    probeWrite("Fresh", "first", "in a new section");
    probeFileHex("after first");
    probeWrite("Plain", "added", NULL);
    probeFileHex("after added removed");
    probeWrite("Plain", "spaced", "  untrimmed  ");
    probeFileHex("after spaced");

    /* The file as it now stands, which shows what the writes did to the order
     * of the entries and whether they disturbed anything around them.
     */
    probeSection("Plain", 128);

    probeNote("what a write does to the string it was given");
    probeWriteInPlace("both", "  both ends  ");
    probeWriteInPlace("trailing", "trailing only   ");
    probeWriteInPlace("leading", "   leading only");
    probeWriteInPlace("blank", "   ");
    probeWriteInPlace("tabbed", "tab\t");

    probeFileHex("after the in-place writes");

    probeNote("WIN.INI, which is what programs actually read");
    probeWindows("intl", "s1159", "<default>");
    probeWindows("intl", "s2359", "<default>");
    probeWindows("intl", "sTime", "<default>");
    probeWindows("intl", "sShortDate", "<default>");
    probeWindows("windows", "device", "<default>");
    probeWindows("Absent", "absent", "<default>");

    /* The written values again, now that other files have been read and the
     * cache flushed, so that what comes back is what the file says rather than
     * what the write left in memory.
     */
    probeNote("the written values, read again after a flush");
    wsprintf(probeResult, "%d", (int)WritePrivateProfileString(NULL, NULL, NULL, SUBJECT));
    probe("WritePrivateProfileString flush", "NULL,NULL,NULL", probeResult);
    probeReread("Plain", "spaced", "after flush");
    probeReread("Plain", "both", "after flush");
    probeReread("Plain", "leading", "after flush");
    probeReread("Plain", "tabbed", "after flush");
    probeReread("Spacing", "after", "after flush");

    /* Whether it is the flush that lets the written value go, or reading any
     * other file: write again, read WIN.INI, and read the value back.
     */
    probeNote("a written value, after another file is read");
    probeWriteInPlace("again", "  again  ");
    probeReread("Plain", "again", "after writing again");
    probeWindows("intl", "sTime", "<default>");
    probeReread("Plain", "again", "after reading WIN.INI");

    probeNote("replacing an entry under another spelling of its name");
    probeWrite("Plain", "ENTRY", "recased");

    probeNote("the file as the writes left it");
    probeFileHex("at the end");
    probeFile();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
