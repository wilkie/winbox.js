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
        "only=one\r\n";

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
    probeWrite("Plain", "added", "new value");
    probeWrite("Plain", "entry", "replaced");
    probeWrite("Fresh", "first", "in a new section");
    probeWrite("Plain", "added", NULL);
    probeWrite("Plain", "spaced", "  untrimmed  ");

    /* The file as it now stands, which shows what the writes did to the order
     * of the entries and whether they disturbed anything around them.
     */
    probeSection("Plain", 128);

    probeNote("WIN.INI, which is what programs actually read");
    probeWindows("intl", "s1159", "<default>");
    probeWindows("intl", "s2359", "<default>");
    probeWindows("intl", "sTime", "<default>");
    probeWindows("intl", "sShortDate", "<default>");
    probeWindows("windows", "device", "<default>");
    probeWindows("Absent", "absent", "<default>");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
