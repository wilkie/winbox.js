/*
 * VER's reading of version information and resources out of files, and
 * its language names.
 *
 * * `size`: GetFileVersionInfoSize of Windows' own files, programs, a font,
 *   files that are no program, a name alone, the probe itself (its version
 *   in `verinfo.rc`), and a copy of SYSTEM.DRV in COMPRESS's format: its
 *   answer and the handle (the resource's place in the file) it gives.
 * * `info`: GetFileVersionInfo with that handle: its answer, and the block
 *   -- its length, its value's, its key, and a sum of its bytes.
 * * `getinfo`: GetFileVersionInfo with a handle of nought, too few bytes,
 *   too many, a handle that is not the resource's, and past the file's end.
 * * `query`: VerQueryValue on the blocks, by many paths: its answer, where
 *   the value is in the block, its length, and the value; and whether the
 *   block is as it was after.
 * * `rsize`, `rget`: GetFileResourceSize and GetFileResource of other
 *   types and numbers.
 * * `lang`: VerLanguageName of languages known and not, into buffers of
 *   several sizes.
 */

#include "probe.h"
#include <ver.h>

#pragma library("ver")

#define OUTPUT "C:\\ORACLE\\VERINFO.OUT"

static unsigned char far *block;
static unsigned char far *other;

/* Where the probe itself is: it runs from where the recorder put it. */
static char ownPath[128];

static unsigned int sumOf(const unsigned char far *bytes, unsigned int count)
{
    unsigned int sum = 0;
    unsigned int i;

    for (i = 0; i < count; i++) sum = (sum << 1 | sum >> 15) ^ bytes[i];

    return sum;
}

static void hexOf(LPSTR out, const unsigned char far *bytes, unsigned int count)
{
    unsigned int i;

    for (i = 0; i < count; i++) out += wsprintf(out, "%02x", bytes[i]);

    *out = 0;
}

static const char *FILES[] = {
    "C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL",
    "C:\\WINDOWS\\SYSTEM\\USER.EXE",
    "C:\\WINDOWS\\SYSTEM\\GDI.EXE",
    "C:\\WINDOWS\\SYSTEM\\KRNL386.EXE",
    "C:\\WINDOWS\\SYSTEM\\SHELL.DLL",
    "C:\\WINDOWS\\SYSTEM\\MMSYSTEM.DLL",
    "C:\\WINDOWS\\SYSTEM\\VGASYS.FON",
    "C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV",
    "C:\\WINDOWS\\SYSTEM\\WIN87EM.DLL",
    "C:\\WINDOWS\\NOTEPAD.EXE",
    "C:\\WINDOWS\\PROGMAN.EXE",
    "C:\\WINDOWS\\CALC.EXE",
    "C:\\WINDOWS\\WIN.INI",
    "C:\\WINDOWS\\SYSTEM\\ARIAL.TTF",
    "C:\\WINDOWS\\SYSTEM\\NONE.DLL",
    "C:\\WINDOWS",
    "COMMDLG.DLL",
    "commdlg.dll",
    "C:\\ORACLE\\OWNCOPY.EXE",
    "C:\\ORACLE\\VCOPY.DRV",
    "C:\\ORACLE\\VCOPY.DR_",
    "C:\\ORACLE\\SHORT.EXE",
    "C:\\ORACLE\\MZONLY.EXE",
};

/* SYSTEM.DRV in COMPRESS's format, of literals alone; and two files too short to be programs. */
static void makeFiles(void)
{
    static const unsigned char HEAD[] = { 'S', 'Z', 'D', 'D', 0x88, 0xf0, 0x27, 0x33, 'A', 'L' };
    HFILE from = _lopen("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", OF_READ);
    HFILE to = _lcreat("C:\\ORACLE\\VCOPY.DR_", 0);
    long size = _llseek(from, 0, 2);
    unsigned char group[9];
    long at;

    _llseek(from, 0, 0);
    _lwrite(to, (LPCSTR)HEAD, 10);
    _lwrite(to, (LPCSTR)&size, 4);

    for (at = 0; at < size; at += 8) {
        int n = _lread(from, (LPSTR)group + 1, 8);

        group[0] = 0xff;
        _lwrite(to, (LPCSTR)group, n + 1);
    }

    _lclose(to);
    _lclose(from);

    /* The probe's own program, copied. */
    from = _lopen(ownPath, OF_READ);
    to = _lcreat("C:\\ORACLE\\OWNCOPY.EXE", 0);

    for (;;) {
        int n = _lread(from, (LPSTR)block, 4096);

        if (n <= 0) {
            break;
        }

        _lwrite(to, (LPCSTR)block, n);
    }

    _lclose(to);
    _lclose(from);

    to = _lcreat("C:\\ORACLE\\SHORT.EXE", 0);
    _lwrite(to, "MZ", 2);
    _lclose(to);

    /* A DOS program's header, its new header's place past the file's end. */
    to = _lcreat("C:\\ORACLE\\MZONLY.EXE", 0);
    _fmemset(block, 0, 64);
    block[0] = 'M';
    block[1] = 'Z';
    block[0x3c] = 0x00;
    block[0x3d] = 0x10;
    _lwrite(to, (LPCSTR)block, 64);
    _lclose(to);
}

static void sizes(void)
{
    int i;

    for (i = 0; i < (int)(sizeof(FILES) / sizeof(FILES[0])); i++) {
        DWORD handle = 0xdeadbeefUL;
        DWORD size = GetFileVersionInfoSize((LPSTR)FILES[i], &handle);

        wsprintf(probeResult, "%lu|%lx", size, handle);
        probe("size", FILES[i], probeResult);

        if (size) {
            BOOL answer;

            _fmemset(block, 0xcc, 4096);
            answer = GetFileVersionInfo((LPSTR)FILES[i], handle, size, block);
            wsprintf(probeResult, "%d|%u|%u|%s|%04x|%02x", answer, *(UINT far *)block,
                     *(UINT far *)(block + 2), (LPSTR)(block + 4), sumOf(block, (unsigned int)size),
                     block[(unsigned int)size]);
            probe("info", FILES[i], probeResult);
        }
    }
}

static void getOne(LPCSTR file, DWORD handle, DWORD length)
{
    char hex[40];
    BOOL answer;

    _fmemset(block, 0xcc, 4096);
    answer = GetFileVersionInfo((LPSTR)file, handle, length, block);
    hexOf(hex, block, 8);
    wsprintf(probeArgs, "%s,%lx,%lu", file, handle, length);
    wsprintf(probeResult, "%d|%s|%04x|%02x", answer, (LPSTR)hex, sumOf(block, (unsigned int)length),
             block[(unsigned int)length]);
    probe("getinfo", probeArgs, probeResult);
}

static void getInfos(void)
{
#define CD "C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL"
    DWORD handle;
    DWORD size = GetFileVersionInfoSize(CD, &handle);
    HFILE file = _lopen(CD, OF_READ);
    DWORD end = _llseek(file, 0, 2);

    _lclose(file);
    getOne(CD, 0, size);
    getOne(CD, 0, 16);
    getOne(CD, 0, 1000);
    getOne(CD, handle, 16);
    getOne(CD, handle, 1000);
    getOne(CD, handle + 2, size);
    getOne(CD, 0x40, 16);
    getOne(CD, end + 100, 16);
    getOne(CD, end - 8, 16);
    getOne(CD, end - 8, 8);
    getOne(CD, handle, 0);
    getOne("C:\\WINDOWS\\WIN.INI", 0, 16);
    getOne("C:\\WINDOWS\\WIN.INI", 4, 16);
    getOne("C:\\WINDOWS\\SYSTEM\\NONE.DLL", 4, 16);

    size = GetFileVersionInfoSize("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", &handle);
    getOne("C:\\ORACLE\\VCOPY.DRV", handle, 16);
    getOne("C:\\ORACLE\\VCOPY.DRV", 0, size);
}

static const char *PATHS[] = {
    "\\",
    "",
    "\\\\",
    "\\VarFileInfo\\Translation",
    "VarFileInfo\\Translation",
    "\\varfileinfo\\translation",
    "\\VarFileInfo\\Translation\\",
    "\\\\VarFileInfo\\\\Translation",
    "\\VarFileInfo",
    "\\VarFileInfo\\Trans",
    "\\StringFileInfo",
    "\\StringFileInfo\\040904E4",
    "\\StringFileInfo\\040904e4\\CompanyName",
    "\\StringFileInfo\\040904E4\\FileVersion",
    "\\StringFileInfo\\040904E4\\ProductName",
    "\\StringFileInfo\\040904E4\\LegalCopyright",
    "\\StringFileInfo\\040904E4\\OriginalFilename",
    "\\StringFileInfo\\040904E4\\Odd",
    "\\StringFileInfo\\040904E4\\Empty",
    "\\StringFileInfo\\040704E4\\CompanyName",
    "\\StringFileInfo\\040704E4\\FileVersion",
    "\\StringFileInfo\\040904E4\\None",
    "\\None",
    "\\StringFileInfo\\040904E4\\CompanyName\\More",
    "\\VS_VERSION_INFO",
};

static void queryOne(const char *name, const unsigned char far *what, const char *path)
{
    void far *value = (void far *)0x12345678L;
    UINT length = 0xbeef;
    char text[120];
    unsigned int before = sumOf(what, *(UINT far *)what);
    BOOL answer = VerQueryValue((void far *)what, (LPSTR)path, &value, &length);
    unsigned int after = sumOf(what, *(UINT far *)what);
    long offset = -1;

    text[0] = 0;

    if (answer && SELECTOROF(value) == SELECTOROF(what)) {
        offset = (long)OFFSETOF(value) - (long)OFFSETOF(what);

        if (length > 0 && length < 60 && ((const unsigned char far *)value)[length - 1] == 0) {
            lstrcpy(text, (LPCSTR)value);
        } else {
            hexOf(text, (const unsigned char far *)value, length < 16 ? length : 16);
        }
    }

    wsprintf(probeArgs, "%s,%s", (LPSTR)name, (LPSTR)path);
    wsprintf(probeResult, "%d|%ld|%u|%s|%s", answer, offset, length, (LPSTR)text,
             (LPSTR)(before == after ? "kept" : "changed"));
    probe("query", probeArgs, probeResult);
}

static void queries(void)
{
    DWORD handle;
    DWORD size;
    int i;

    size = GetFileVersionInfoSize(CD, &handle);
    GetFileVersionInfo(CD, handle, size, block);

    for (i = 0; i < (int)(sizeof(PATHS) / sizeof(PATHS[0])); i++) {
        queryOne("commdlg", block, PATHS[i]);
    }

    /* The probe's own program, open in KERNEL's hands as it runs: what
     * opening it answers, as VER opens it. */
    {
        OFSTRUCT of;
        HFILE file;

        file = OpenFile(ownPath, &of, OF_READ | OF_SHARE_DENY_NONE);
        wsprintf(probeResult, "%d|%d", file >= 0 ? 1 : -1, (int)of.nErrCode);
        probe("ownopen", "40", probeResult);
        _lclose(file);
        file = OpenFile(ownPath, &of, OF_READ);
        wsprintf(probeResult, "%d|%d", file >= 0 ? 1 : -1, (int)of.nErrCode);
        probe("ownopen", "0", probeResult);
        _lclose(file);

        size = GetFileResourceSize(ownPath, MAKEINTRESOURCE(16), MAKEINTRESOURCE(1), &handle);
        wsprintf(probeResult, "%lu|%lx", size, handle);
        probe("rsize", "self", probeResult);
    }

    /* A copy of it, whose block says it is longer than its resource: read
     * whole by its place, as GetFileVersionInfoSize will not. */
    size = GetFileResourceSize("C:\\ORACLE\\OWNCOPY.EXE", MAKEINTRESOURCE(16), MAKEINTRESOURCE(1),
                               &handle);
    wsprintf(probeResult, "%lu|%lx", size, handle);
    probe("rsize", "own", probeResult);
    GetFileVersionInfo("C:\\ORACLE\\OWNCOPY.EXE", handle, 0x200, other);

    for (i = 0; i < (int)(sizeof(PATHS) / sizeof(PATHS[0])); i++) {
        queryOne("own", other, PATHS[i]);
    }

    size = GetFileResourceSize("C:\\ORACLE\\OWNCOPY.EXE", MAKEINTRESOURCE(16), MAKEINTRESOURCE(2),
                               &handle);
    GetFileVersionInfo("C:\\ORACLE\\OWNCOPY.EXE", handle, 0x200, other);
    queryOne("own2", other, "\\");
    queryOne("own2", other, "\\VarFileInfo\\Translation");
    queryOne("own2", other, "\\StringFileInfo");

    /* Without a place for the length. */
    {
        void far *value = 0;
        BOOL answer = VerQueryValue(block, "\\VarFileInfo\\Translation", &value, NULL);

        wsprintf(probeResult, "%d|%d", answer, (int)(OFFSETOF(value) - OFFSETOF(block)));
        probe("query", "nolength", probeResult);
    }

    /* A block of four bytes, and one whose length is more than its parent's. */
    {
        void far *value = 0;
        UINT length = 0;
        BOOL answer;

        _fmemcpy(other, block, 512);
        *(UINT far *)other = 4;
        answer = VerQueryValue(other, "\\", &value, &length);
        wsprintf(probeResult, "%d|%u", answer, length);
        probe("query", "four", probeResult);

        *(UINT far *)other = 5;
        answer = VerQueryValue(other, "\\", &value, &length);
        wsprintf(probeResult, "%d|%u", answer, length);
        probe("query", "five", probeResult);

        _fmemcpy(other, block, 512);
        *(UINT far *)other = 0x50;
        length = 0;
        answer = VerQueryValue(other, "\\", &value, &length);
        wsprintf(probeResult, "%d|%u", answer, length);
        probe("query", "short", probeResult);
        answer = VerQueryValue(other, "\\VarFileInfo\\Translation", &value, &length);
        wsprintf(probeResult, "%d|%u", answer, length);
        probe("query", "shortpath", probeResult);
    }
}

static void resourceOne(LPCSTR file, LPCSTR type, LPCSTR id, const char *label)
{
    DWORD offset = 0xdeadbeefUL;
    DWORD size = GetFileResourceSize((LPSTR)file, (LPSTR)type, (LPSTR)id, &offset);
    char hex[40];
    BOOL answer;

    wsprintf(probeArgs, "%s,%s", file, (LPSTR)label);
    wsprintf(probeResult, "%lu|%lx", size, offset);
    probe("rsize", probeArgs, probeResult);

    _fmemset(block, 0xcc, 4096);
    answer = GetFileResource((LPSTR)file, (LPSTR)type, (LPSTR)id, 0, 24, block);
    hexOf(hex, block, 12);
    wsprintf(probeResult, "%d|%s", answer, (LPSTR)hex);
    probe("rget", probeArgs, probeResult);
}

static void resources(void)
{
    char hex[40];
    BOOL answer;

    resourceOne(CD, MAKEINTRESOURCE(6), MAKEINTRESOURCE(17), "6,17");
    resourceOne(CD, MAKEINTRESOURCE(6), MAKEINTRESOURCE(25), "6,25");
    resourceOne(CD, MAKEINTRESOURCE(6), MAKEINTRESOURCE(1), "6,1");
    resourceOne(CD, MAKEINTRESOURCE(16), MAKEINTRESOURCE(2), "16,2");
    resourceOne(CD, MAKEINTRESOURCE(0x8010), MAKEINTRESOURCE(1), "8010,1");
    resourceOne(CD, MAKEINTRESOURCE(16), MAKEINTRESOURCE(0x8001), "16,8001");
    resourceOne(CD, MAKEINTRESOURCE(5), MAKEINTRESOURCE(1536), "5,1536");
    resourceOne(CD, MAKEINTRESOURCE(5), MAKEINTRESOURCE(1), "5,1");
    resourceOne(CD, MAKEINTRESOURCE(2), MAKEINTRESOURCE(38), "2,38");
    resourceOne(CD, MAKEINTRESOURCE(14), MAKEINTRESOURCE(528), "14,528");
    resourceOne("C:\\WINDOWS\\NOTEPAD.EXE", MAKEINTRESOURCE(14), MAKEINTRESOURCE(1), "14,1");
    resourceOne("C:\\WINDOWS\\NOTEPAD.EXE", MAKEINTRESOURCE(3), MAKEINTRESOURCE(1), "3,1");
    resourceOne("C:\\WINDOWS\\NOTEPAD.EXE", MAKEINTRESOURCE(3), MAKEINTRESOURCE(2), "3,2");
    resourceOne("C:\\WINDOWS\\NOTEPAD.EXE", MAKEINTRESOURCE(6), MAKEINTRESOURCE(1), "6,1");
    resourceOne("C:\\ORACLE\\OWNCOPY.EXE", MAKEINTRESOURCE(16), MAKEINTRESOURCE(2), "16,2");
    resourceOne("C:\\WINDOWS\\WIN.INI", MAKEINTRESOURCE(16), MAKEINTRESOURCE(1), "16,1");
    resourceOne("C:\\ORACLE\\VCOPY.DRV", MAKEINTRESOURCE(16), MAKEINTRESOURCE(1), "16,1");

    /* A resource read at a place given, and past the file's end. */
    _fmemset(block, 0xcc, 64);
    answer = GetFileResource(CD, MAKEINTRESOURCE(6), MAKEINTRESOURCE(1), 0x3c, 4, block);
    hexOf(hex, block, 6);
    wsprintf(probeResult, "%d|%s", answer, (LPSTR)hex);
    probe("rget", "at3c", probeResult);

    _fmemset(block, 0xcc, 64);
    answer = GetFileResource(CD, MAKEINTRESOURCE(99), MAKEINTRESOURCE(99), 0x20000L, 16, block);
    hexOf(hex, block, 10);
    wsprintf(probeResult, "%d|%s", answer, (LPSTR)hex);
    probe("rget", "past", probeResult);

    _fmemset(block, 0xcc, 64);
    answer = GetFileResource("C:\\WINDOWS\\SYSTEM\\NONE.DLL", MAKEINTRESOURCE(6), MAKEINTRESOURCE(1),
                             0x3c, 4, block);
    wsprintf(probeResult, "%d", answer);
    probe("rget", "none", probeResult);
}

static void languages(void)
{
    static const UINT LANGUAGES[] = {
        0x409, 0x407, 0x40c, 0x411, 0x804, 0x809, 0xc0c, 0x100c, 0x41a, 0x81a,
        0x421, 0x0, 0x400, 0x422, 0x9999, 0x10c,
    };
    static const int SIZES[] = { 100, 5, 1 };
    char name[300];
    int i;
    int j;

    for (i = 0; i < (int)(sizeof(LANGUAGES) / sizeof(LANGUAGES[0])); i++) {
        for (j = 0; j < (int)(sizeof(SIZES) / sizeof(SIZES[0])); j++) {
            UINT answer;

            lstrcpy(name, "untouched");
            answer = VerLanguageName(LANGUAGES[i], name, SIZES[j]);
            wsprintf(probeArgs, "%x,%d", LANGUAGES[i], SIZES[j]);
            wsprintf(probeResult, "%u|%s", answer, (LPSTR)name);
            probe("lang", probeArgs, probeResult);
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    GetModuleFileName(instance, ownPath, sizeof(ownPath));

    block = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 4100));
    other = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 4100));

    makeFiles();
    sizes();
    getInfos();
    queries();
    resources();
    languages();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
