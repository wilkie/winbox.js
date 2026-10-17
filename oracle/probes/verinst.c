/*
 * VER's installing of files: VerFindFile and VerInstallFile, with their
 * flags, what they answer, and the files they leave.
 *
 * The probe makes its folders under C:\ORACLE\VI -- SRC to install from,
 * DST to install into, CUR for a copy found elsewhere -- and its sources:
 * copies of a driver, some with their version information changed (an
 * older or newer version, another type, another language or code page),
 * one in COMPRESS's format, and plain text with none -- of SYSTEM.DRV,
 * a file every installation has.
 *
 * * `find`: VerFindFile -- its answer, the folder it found the file in
 *   and the length it gives, the folder to install into and its length.
 * * `install`: VerInstallFile -- its answer, the temporary file's name and
 *   length it gives back; then `left`, the files in DST and CUR, each with
 *   its size and a sum of its bytes.
 */

#include "probe.h"
#include <ver.h>
#include <direct.h>
#include <dos.h>

#pragma library("ver")
#pragma library("lzexpand")

#define OUTPUT "C:\\ORACLE\\VERINST.OUT"

#define SRC "C:\\ORACLE\\VI\\SRC"
#define DST "C:\\ORACLE\\VI\\DST"
#define CUR "C:\\ORACLE\\VI\\CUR"

static unsigned char far *buffer;
static char ownPath[128];
static char ownDir[128];
static char ownName[16];

/* Where SYSTEM.DRV's version block is, and its Translation value in it. */
static DWORD block;
static UINT translation;

static unsigned int sumOf(const unsigned char far *bytes, unsigned int count)
{
    unsigned int sum = 0;
    unsigned int i;

    for (i = 0; i < count; i++) sum = (sum << 1 | sum >> 15) ^ bytes[i];

    return sum;
}

static void copyFile(LPCSTR from, LPCSTR to)
{
    HFILE in = _lopen(from, OF_READ);
    HFILE out = _lcreat(to, 0);

    for (;;) {
        int n = _lread(in, (LPSTR)buffer, 8192);

        if (n <= 0) {
            break;
        }

        _lwrite(out, (LPCSTR)buffer, n);
    }

    _lclose(out);
    _lclose(in);
}

static void poke(LPCSTR path, DWORD at, const void far *bytes, int count)
{
    HFILE file = _lopen(path, OF_READWRITE);

    _llseek(file, at, 0);
    _lwrite(file, (LPCSTR)bytes, count);
    _lclose(file);
}

/* A copy of SYSTEM.DRV with its version, type and language as given. */
static void variant(LPCSTR path, DWORD ms, DWORD ls, DWORD type, UINT language, UINT codepage)
{
    UINT words[2];

    copyFile("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", path);
    poke(path, block + 0x1c, &ms, 4);
    poke(path, block + 0x20, &ls, 4);
    poke(path, block + 0x38, &type, 4);
    words[0] = language;
    words[1] = codepage;
    poke(path, block + translation, words, 4);
}

static void text(LPCSTR path, LPCSTR words)
{
    HFILE file = _lcreat(path, 0);

    _lwrite(file, words, lstrlen(words));
    _lclose(file);
}

/* SYSTEM.DRV in COMPRESS's format, of literals alone. */
static void compressed(LPCSTR path)
{
    static const unsigned char HEAD[] = { 'S', 'Z', 'D', 'D', 0x88, 0xf0, 0x27, 0x33, 'A', 'L' };
    HFILE from = _lopen("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", OF_READ);
    HFILE to = _lcreat(path, 0);
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
}

/* Every file in a folder taken away. */
static void empty(LPCSTR folder)
{
    struct find_t found;
    char pattern[80];
    char path[80];
    OFSTRUCT of;

    wsprintf(pattern, "%s\\*.*", folder);

    while (_dos_findfirst(pattern, _A_NORMAL | _A_RDONLY | _A_HIDDEN | _A_SYSTEM, &found) == 0) {
        wsprintf(path, "%s\\%s", folder, (LPSTR)found.name);
        _dos_setfileattr(path, _A_NORMAL);

        if (OpenFile(path, &of, OF_DELETE) == HFILE_ERROR) {
            break;
        }
    }
}

/* The files in a folder, in the order of their names: their names, sizes and sums. */
static void listing(LPSTR out, LPCSTR folder)
{
    struct find_t found;
    char pattern[80];
    char names[12][13];
    int count = 0;
    int i;
    int j;
    unsigned done;

    wsprintf(pattern, "%s\\*.*", folder);
    *out = 0;

    for (done = _dos_findfirst(pattern, _A_NORMAL | _A_RDONLY, &found); done == 0 && count < 12;
         done = _dos_findnext(&found)) {
        lstrcpy(names[count++], found.name);
    }

    for (i = 0; i < count; i++) {
        for (j = i + 1; j < count; j++) {
            if (lstrcmp(names[j], names[i]) < 0) {
                char swap[13];

                lstrcpy(swap, names[i]);
                lstrcpy(names[i], names[j]);
                lstrcpy(names[j], swap);
            }
        }
    }

    for (i = 0; i < count; i++) {
        char path[80];
        HFILE file;
        int n;
        long size;

        wsprintf(path, "%s\\%s", folder, (LPSTR)names[i]);
        file = _lopen(path, OF_READ);
        size = file == HFILE_ERROR ? -1 : _llseek(file, 0, 2);

        if (file != HFILE_ERROR) {
            _llseek(file, 0, 0);
            n = _lread(file, (LPSTR)buffer, 30000);
            _lclose(file);
        } else {
            n = 0;
        }

        out += wsprintf(out, "%s:%ld:%04x ", (LPSTR)names[i], size, n > 0 ? sumOf(buffer, n) : 0);
    }
}

static void findOne(const char *label, UINT flags, LPCSTR file, LPCSTR app, UINT curLength,
                    UINT destLength, BOOL dest);

static void installOne(const char *label, UINT flags, LPCSTR source, LPCSTR dest, LPCSTR from,
                       LPCSTR to, LPCSTR current, LPCSTR temporary, UINT length)
{
    char tmp[64];
    char dst[400];
    char cur[300];
    UINT given = length;
    DWORD answer;

    lstrcpy(tmp, temporary);
    answer = VerInstallFile(flags, (LPSTR)source, (LPSTR)dest, (LPSTR)from, (LPSTR)to,
                            (LPSTR)current, tmp, &length);
    wsprintf(probeArgs, "%s,%x,%s,%s,%u", (LPSTR)label, flags, (LPSTR)source, (LPSTR)dest, given);
    wsprintf(probeResult, "%lx|%s|%u", answer, (LPSTR)tmp, length);
    probe("install", probeArgs, probeResult);
    listing(dst, DST);
    listing(cur, CUR);
    wsprintf(probeResult, "%s| %s", (LPSTR)dst, (LPSTR)cur);
    probe("left", label, probeResult);
}

static void installs(void)
{
    text(DST "\\..\\README.TXT", "not a program");

    /* Into a folder that has none of it. */
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    installOne("new", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    /* The same again. */
    installOne("same", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);

    /* An older version: left in a temporary file. */
    variant(SRC "\\A.DLL", 0x00030009UL, 0x67, 2, 0x409, 1252);
    installOne("older", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    /* Forced, with the temporary file it made. */
    installOne("force", VIFF_FORCEINSTALL, "A.DLL", "A.DLL", SRC, DST, "", "TEMP.000", 64);

    /* Older in its second half; newer; another type; another language. */
    variant(SRC "\\A.DLL", 0x00030009UL, 0x66, 2, 0x409, 1252);
    installOne("olderls", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    empty(DST);
    variant(DST "\\A.DLL", 0x00030009UL, 0x67, 2, 0x409, 1252);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    installOne("newer", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 1, 0x409, 1252);
    installOne("type", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    empty(DST);
    variant(DST "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x407, 1252);
    installOne("lang", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    empty(DST);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1250);
    variant(DST "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    installOne("codepage", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);

    /* The installed one of code page nought: any but 1200 agrees. */
    empty(DST);
    variant(DST "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 0);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1250);
    installOne("cp0", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    empty(DST);
    variant(DST "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 0);
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1200);
    installOne("cp1200", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);

    /* An installed file with no version information, and a source with none. */
    empty(DST);
    text(DST "\\A.DLL", "plain text");
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    installOne("noinfo", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    text(SRC "\\B.DLL", "plain text, no version");
    installOne("srcnoinfo", 0, "B.DLL", "A.DLL", SRC, DST, "", "", 64);

    /* A source not there; one in COMPRESS's format, named as expanded. */
    empty(DST);
    installOne("nosrc", 0, "NONE.DLL", "NONE.DLL", SRC, DST, "", "", 64);
    compressed(SRC "\\C.DL_");
    installOne("compressed", 0, "C.DLL", "C.DLL", SRC, DST, "", "", 64);

    /* Too little room for the temporary file's name. */
    variant(SRC "\\A.DLL", 0x0003000aUL, 0x67, 2, 0x409, 1252);
    variant(DST "\\A.DLL", 0x0003000bUL, 0x67, 2, 0x409, 1252);
    installOne("small", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 3);
    installOne("nine", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 9);
    installOne("eight", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 8);

    /* Temporary names taken: the next is made. */
    empty(DST);
    variant(DST "\\A.DLL", 0x0003000bUL, 0x67, 2, 0x409, 1252);
    text(DST "\\TEMP.000", "taken");
    text(DST "\\TEMP.001", "taken");
    installOne("taken", 0, "A.DLL", "A.DLL", SRC, DST, "", "", 64);
    /* Forced, naming a temporary file that is not there. */
    installOne("forcenone", VIFF_FORCEINSTALL, "A.DLL", "A.DLL", SRC, DST, "", "NONE.TMP", 64);

    /* A copy where it was found before: deleted, or kept. */
    empty(DST);
    text(CUR "\\A.DLL", "the old copy");
    installOne("curdir", 0, "A.DLL", "A.DLL", SRC, DST, CUR, "", 64);
    text(CUR "\\A.DLL", "the old copy");
    installOne("keepold", VIFF_DONTDELETEOLD, "A.DLL", "A.DLL", SRC, DST, CUR, "", 64);
    installOne("curisdest", 0, "A.DLL", "A.DLL", SRC, DST, DST, "", 64);
    installOne("curlower", 0, "A.DLL", "A.DLL", SRC, DST, "c:\\oracle\\vi\\dst", "", 64);
    empty(CUR);

    /* Installed under another name, and with folders that end in a backslash. */
    installOne("rename", 0, "A.DLL", "Z.DLL", SRC "\\", DST "\\", "", "", 64);

    /* No read-only file: DOSBox does not set a file's attributes, only
     * says it did (`DOS_SetFileAttr`), so VIF_WRITEPROT cannot be recorded. */

    /* A library loaded from the file being replaced: in use, and left. */
    copyFile("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", SRC "\\COMMDLG.DLL");
    {
        HINSTANCE library = LoadLibrary("COMMDLG.DLL");

        installOne("inuse", 0, "COMMDLG.DLL", "COMMDLG.DLL", SRC, "C:\\WINDOWS\\SYSTEM", "", "", 64);
        findOne("inuse", 0, "COMMDLG.DLL", DST, 64, 64, TRUE);
        FreeLibrary(library);
    }
}

static void findOne(const char *label, UINT flags, LPCSTR file, LPCSTR app, UINT curLength,
                    UINT destLength, BOOL dest)
{
    char cur[300];
    char to[300];
    UINT cl = curLength;
    UINT dl = destLength;
    UINT answer;

    lstrcpy(cur, "untouched");
    lstrcpy(to, "untouched");
    answer = VerFindFile(flags, (LPSTR)file, "X:\\NOT\\WINDOWS", (LPSTR)app, cur, &cl,
                         dest ? to : NULL, &dl);
    wsprintf(probeArgs, "%s,%x,%s", (LPSTR)label, flags, (LPSTR)file);
    wsprintf(probeResult, "%x|%s|%u|%s|%u", answer, (LPSTR)cur, cl, (LPSTR)to, dl);
    probe("find", probeArgs, probeResult);
}

static void finds(void)
{
    char here[128];

    empty(DST);
    text(DST "\\A.DLL", "here");
    findOne("user", 0, "USER.EXE", DST, 64, 64, TRUE);
    findOne("user", VFFF_ISSHAREDFILE, "USER.EXE", DST, 64, 64, TRUE);
    findOne("notepad", 0, "NOTEPAD.EXE", "C:\\WINDOWS", 64, 64, TRUE);
    findOne("notepad", VFFF_ISSHAREDFILE, "NOTEPAD.EXE", "C:\\WINDOWS", 64, 64, TRUE);
    findOne("notepadapp", 0, "NOTEPAD.EXE", DST, 64, 64, TRUE);
    findOne("a", 0, "A.DLL", DST, 64, 64, TRUE);
    findOne("a", VFFF_ISSHAREDFILE, "A.DLL", DST, 64, 64, TRUE);
    findOne("lower", 0, "a.dll", "c:\\oracle\\vi\\dst", 64, 64, TRUE);
    findOne("none", 0, "NONE.DLL", DST, 64, 64, TRUE);
    findOne("none", VFFF_ISSHAREDFILE, "NONE.DLL", DST, 64, 64, TRUE);
    findOne("noapp", VFFF_ISSHAREDFILE, "USER.EXE", NULL, 64, 64, TRUE);
    findOne("nodest", 0, "USER.EXE", DST, 64, 64, FALSE);
    findOne("small", 0, "USER.EXE", DST, 17, 5, TRUE);
    findOne("exact", 0, "USER.EXE", DST, 18, 18, TRUE);
    findOne("zero", 0, "NONE.DLL", DST, 0, 0, TRUE);
    findOne("slash", 0, "A.DLL", DST "\\", 64, 64, TRUE);
    findOne("root", 0, "A.DLL", "C:\\", 64, 64, TRUE);
    findOne("gdi", VFFF_ISSHAREDFILE, "GDI.EXE", DST, 64, 64, TRUE);

    /* Found only where OpenFile looks for a name alone: the current folder. */
    text(CUR "\\HERE.DLL", "here");
    getcwd(here, sizeof(here));
    chdir(CUR);
    findOne("cwd", 0, "HERE.DLL", DST, 64, 64, TRUE);
    chdir(here);
    empty(CUR);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    DWORD offset;
    int slash;
    int i;

    probeOpen(OUTPUT);

    buffer = (unsigned char far *)GlobalLock(GlobalAlloc(GMEM_FIXED, 30000));

    GetModuleFileName(instance, ownPath, sizeof(ownPath));
    slash = 0;

    for (i = 0; ownPath[i]; i++) {
        if (ownPath[i] == '\\') {
            slash = i;
        }
    }

    lstrcpy(ownName, ownPath + slash + 1);
    /* Its folder, with its backslash: C:\ where it is in the root. */
    lstrcpy(ownDir, ownPath);
    ownDir[slash + 1] = 0;

    GetFileResourceSize("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", MAKEINTRESOURCE(16), MAKEINTRESOURCE(1),
                        &offset);
    block = offset;

    /* Its Translation value's place in its block. */
    {
        DWORD size = GetFileVersionInfoSize("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", &offset);
        void far *value;
        UINT length;

        GetFileVersionInfo("C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV", offset, size, buffer);
        VerQueryValue(buffer, "\\VarFileInfo\\Translation", &value, &length);
        translation = OFFSETOF(value) - OFFSETOF(buffer);
    }

    mkdir("C:\\ORACLE\\VI");
    mkdir(SRC);
    mkdir(DST);
    mkdir(CUR);

    installs();
    finds();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
