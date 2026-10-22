/*
 * A folder as DOS lists it and keeps it, on the oracle's C: -- a folder of
 * the host's under DOSBox (`mount c`), which the layered drives must look
 * exactly like. Everything happens in C:\ORACLE\DO, made afresh.
 *
 * * `order`: the names FindFirst (4Eh) and FindNext (4Fh) give for `*.*`
 *   with directories, hidden and system files asked for, in the order given,
 *   joined by commas: as the files were made (`made`), after two were
 *   deleted and made again (`remade`), after the search below (`after`),
 *   after a file was renamed (`renamed`), and of the folder a file and a
 *   folder were moved into (`moved-into`).
 * * `search`: one search kept open while files are made and deleted: the
 *   first name, then, after ADD.TXT and ZZZ.TXT were made and MID.TXT
 *   deleted, the names the rest of the search gave.
 * * `rename`, `rmdir`: AX after 56h or 3Ah, nought for success, or DOS's
 *   error.
 * * `stamp`: whether a file's date and time, as FindFirst gives them, are
 *   the `same` as before or `different`, four seconds after it was written:
 *   renamed, opened for writing and closed unwritten, written nought bytes
 *   at its end, made again with 3Ch and not written, and written. With
 *   `-handle`, the stamp 5700h gives through a handle opened after.
 * * `folder`: the same for a folder's own entry in its parent, when a file
 *   in it was written, a file made in it, a file deleted from it, a file in
 *   it renamed, and the folder itself renamed; and whether its `.` entry
 *   gives the folder's stamp and its `..` its parent's.
 *   With `moved`, the renamed folder's stamp four seconds later, after it
 *   was moved into another folder, against its stamp after the rename.
 * * `root`: whether `.` and `..` are listed in C:\, each `yes` or `no`.
 */

#include "probe.h"

#include <dos.h>

#define OUTPUT "C:\\ORACLE\\DIRORDER.OUT"
#define DO "C:\\ORACLE\\DO"

extern unsigned DosPath(unsigned function, LPCSTR path);
#pragma aux DosPath = "push ds" "mov ds,dx" "mov dx,ax" "mov ah,bl" "int 21h" "jc bad" \
    "xor ax,ax" "bad:" "pop ds" parm[bx][dx ax] value[ax] modify[dx];

extern unsigned DosRename(LPCSTR from, LPCSTR to);
#pragma aux DosRename = "push ds" "mov ds,dx" "mov dx,ax" "mov ah,56h" "int 21h" "jc bad" \
    "xor ax,ax" "bad:" "pop ds" parm[dx ax][es di] value[ax] modify[dx];

extern unsigned long Stamp(unsigned handle);
#pragma aux Stamp = "mov ax,5700h" "int 21h" "jnc done" "xor cx,cx" "xor dx,dx" "done:" \
    "mov ax,cx" parm[bx] value[dx ax] modify[cx];

#define FIND_ALL (_A_HIDDEN | _A_SYSTEM | _A_SUBDIR)

static char text[1024];

static void answer(LPCSTR what, LPCSTR args, unsigned ax)
{
    wsprintf(probeResult, "%u", ax);
    probe(what, args, probeResult);
}

/* The names a folder lists, in the order given, into `text`. */
static void listing(LPCSTR folder)
{
    struct find_t found;
    char pattern[80];
    unsigned done;

    wsprintf(pattern, "%s\\*.*", folder);
    text[0] = '\0';

    for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
        if (lstrlen(text) + 14 < sizeof text) {
            if (text[0]) {
                lstrcat(text, ",");
            }

            lstrcat(text, found.name);
        }
    }
}

static void order(LPCSTR args, LPCSTR folder)
{
    listing(folder);
    probe("order", args, text);
}

/* The stamp a folder's listing gives an entry by name, nought for none. */
static DWORD stampIn(LPCSTR folder, LPCSTR name)
{
    struct find_t found;
    char pattern[80];
    unsigned done;

    wsprintf(pattern, "%s\\*.*", folder);

    for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
        if (lstrcmp(found.name, name) == 0) {
            return MAKELONG(found.wr_time, found.wr_date);
        }
    }

    return 0;
}

/* The stamp 5700h gives a file through a handle. */
static DWORD stampThrough(LPCSTR path)
{
    int handle;
    DWORD stamp;

    if (_dos_open(path, 0, &handle) != 0) {
        return 0;
    }

    stamp = Stamp(handle);
    _dos_close(handle);
    return stamp;
}

static void relation(LPCSTR what, LPCSTR args, DWORD before, DWORD after)
{
    probe(what, args, (LPSTR)(!before || !after ? "missing" : before == after ? "same" : "different"));
}

/* Makes a file holding what is given, nought bytes for none. */
static void make(LPCSTR path, LPCSTR holding)
{
    int handle;
    unsigned wrote;

    if (_dos_creat(path, _A_NORMAL, &handle) == 0) {
        if (holding) {
            _dos_write(handle, (void far *)holding, lstrlen(holding), &wrote);
        }

        _dos_close(handle);
    }
}

/* Takes a folder away with all it holds. The names are taken first, then
 * deleted, so that no search is open while its folder changes. */
static void wipe(LPCSTR folder)
{
    struct find_t found;
    char pattern[80];
    char names[24][13];
    BYTE folders[24];
    unsigned done;
    int count;
    int i;

    wsprintf(pattern, "%s\\*.*", folder);

    do {
        count = 0;

        for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0 && count < 24;
             done = _dos_findnext(&found)) {
            if (lstrcmp(found.name, ".") && lstrcmp(found.name, "..")) {
                lstrcpy(names[count], found.name);
                folders[count++] = (BYTE)((found.attrib & _A_SUBDIR) != 0);
            }
        }

        for (i = 0; i < count; i++) {
            char path[80];

            wsprintf(path, "%s\\%s", folder, (LPSTR)names[i]);

            if (folders[i]) {
                wipe(path);
            } else {
                DosPath(0x41, path);
            }
        }
    } while (count);

    DosPath(0x3a, folder);
}

static void settle(void)
{
    DWORD start = GetTickCount();

    while (GetTickCount() - start < 4000) {
    }
}

static const char *made[] = {"MID.TXT", "ZED.TXT", "A.TXT", "A!.TXT", "-DASH.TXT", "$DOL.TXT",
                             "1ONE.TXT", "_UND.TXT", "~TIL.TXT", "B", "AB.C", "A.CD"};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char path[80];
    unsigned i;
    DWORD folderRenamedAfter = 0;

    probeOpen(OUTPUT);
    wipe(DO);
    DosPath(0x39, DO);

    /* The order of a listing. */
    for (i = 0; i < sizeof made / sizeof made[0]; i++) {
        wsprintf(path, DO "\\%s", (LPSTR)made[i]);
        make(path, "x");
    }

    DosPath(0x39, DO "\\SUB");
    DosPath(0x39, DO "\\AAA");
    DosPath(0x39, DO "\\!D");
    order("made", DO);

    DosPath(0x41, DO "\\ZED.TXT");
    make(DO "\\ZED.TXT", "x");
    DosPath(0x41, DO "\\A.TXT");
    make(DO "\\NEW.TXT", "x");
    order("remade", DO);

    /* A search kept open while its folder changes. */
    {
        struct find_t found;
        unsigned done;

        done = _dos_findfirst(DO "\\*.TXT", FIND_ALL, &found);
        probe("search", "first", (LPSTR)(done ? "none" : found.name));

        make(DO "\\ADD.TXT", "x");
        make(DO "\\ZZZ.TXT", "x");
        DosPath(0x41, DO "\\MID.TXT");

        text[0] = '\0';

        for (done = done ? done : _dos_findnext(&found); done == 0; done = _dos_findnext(&found)) {
            if (text[0]) {
                lstrcat(text, ",");
            }

            lstrcat(text, found.name);
        }

        probe("search", "rest", text);
    }

    order("after", DO);

    /* Stamps: each file and folder is written, its stamp taken, and four
     * seconds later each is changed in one way. */
    {
        DWORD renamed, renamedHandle, unwritten, nothing, recreated, written;
        DWORD fileWritten, fileMade, fileDeleted, fileRenamed, folderRenamed;
        int handle;
        unsigned wrote;

        make(DO "\\REN.TXT", "x");
        make(DO "\\OPEN.TXT", "x");
        make(DO "\\NOTHING.TXT", "x");
        make(DO "\\AGAIN.TXT", "x");
        make(DO "\\WRITE.TXT", "x");
        DosPath(0x39, DO "\\FW");
        make(DO "\\FW\\IN.TXT", "x");
        DosPath(0x39, DO "\\FM");
        DosPath(0x39, DO "\\FD");
        make(DO "\\FD\\IN.TXT", "x");
        DosPath(0x39, DO "\\FR");
        make(DO "\\FR\\IN.TXT", "x");
        DosPath(0x39, DO "\\FF");
        make(DO "\\FF\\IN.TXT", "x");

        renamed = stampIn(DO, "REN.TXT");
        renamedHandle = stampThrough(DO "\\REN.TXT");
        unwritten = stampIn(DO, "OPEN.TXT");
        nothing = stampIn(DO, "NOTHING.TXT");
        recreated = stampIn(DO, "AGAIN.TXT");
        written = stampIn(DO, "WRITE.TXT");
        fileWritten = stampIn(DO, "FW");
        fileMade = stampIn(DO, "FM");
        fileDeleted = stampIn(DO, "FD");
        fileRenamed = stampIn(DO, "FR");
        folderRenamed = stampIn(DO, "FF");

        settle();

        answer("rename", "file", DosRename(DO "\\REN.TXT", DO "\\QQQ.TXT"));

        if (_dos_open(DO "\\OPEN.TXT", 2, &handle) == 0) {
            _dos_close(handle);
        }

        if (_dos_open(DO "\\NOTHING.TXT", 2, &handle) == 0) {
            long end;

            end = _llseek(handle, 0L, 2);
            _dos_write(handle, (void far *)"", 0, &wrote);
            _dos_close(handle);
            (void)end;
        }

        make(DO "\\AGAIN.TXT", NULL);

        if (_dos_open(DO "\\WRITE.TXT", 2, &handle) == 0) {
            _dos_write(handle, (void far *)"y", 1, &wrote);
            _dos_close(handle);
        }

        if (_dos_open(DO "\\FW\\IN.TXT", 2, &handle) == 0) {
            _dos_write(handle, (void far *)"y", 1, &wrote);
            _dos_close(handle);
        }

        make(DO "\\FM\\IN.TXT", "x");
        DosPath(0x41, DO "\\FD\\IN.TXT");
        DosRename(DO "\\FR\\IN.TXT", DO "\\FR\\OUT.TXT");
        answer("rename", "folder", DosRename(DO "\\FF", DO "\\FG"));

        relation("stamp", "renamed", renamed, stampIn(DO, "QQQ.TXT"));
        relation("stamp", "renamed-handle", renamedHandle, stampThrough(DO "\\QQQ.TXT"));
        relation("stamp", "open-unwritten", unwritten, stampIn(DO, "OPEN.TXT"));
        relation("stamp", "written-nothing", nothing, stampIn(DO, "NOTHING.TXT"));
        relation("stamp", "made-again", recreated, stampIn(DO, "AGAIN.TXT"));
        relation("stamp", "written", written, stampIn(DO, "WRITE.TXT"));
        relation("folder", "file-written", fileWritten, stampIn(DO, "FW"));
        relation("folder", "file-made", fileMade, stampIn(DO, "FM"));
        relation("folder", "file-deleted", fileDeleted, stampIn(DO, "FD"));
        relation("folder", "file-renamed", fileRenamed, stampIn(DO, "FR"));
        folderRenamedAfter = stampIn(DO, "FG");
        relation("folder", "renamed", folderRenamed, folderRenamedAfter);
        relation("folder", "dot", stampIn(DO, "FM"), stampIn(DO "\\FM", "."));
        relation("folder", "dotdot", stampIn("C:\\ORACLE", "DO"), stampIn(DO "\\FM", ".."));
    }

    order("renamed", DO);

    /* Folders and files moved, and the errors of 56h and 3Ah. */
    settle();
    answer("rename", "folder-moved", DosRename(DO "\\FG", DO "\\SUB\\FH"));
    relation("folder", "moved", folderRenamedAfter, stampIn(DO "\\SUB", "FH"));
    listing(DO "\\SUB\\FH");
    probe("order", "moved-folder", text);
    answer("rename", "file-moved", DosRename(DO "\\B", DO "\\SUB\\B"));
    order("moved-into", DO "\\SUB");
    answer("rename", "into-itself", DosRename(DO "\\SUB", DO "\\SUB\\FH\\X"));
    answer("rename", "missing", DosRename(DO "\\NONE.TXT", DO "\\NONE2.TXT"));
    answer("rename", "exists", DosRename(DO "\\QQQ.TXT", DO "\\ZZZ.TXT"));
    answer("rename", "missing-onto-existing", DosRename(DO "\\NONE.TXT", DO "\\ZZZ.TXT"));
    answer("rename", "no-folder", DosRename(DO "\\QQQ.TXT", DO "\\NODIR\\QQQ.TXT"));
    answer("rename", "folder-onto-file", DosRename(DO "\\AAA", DO "\\ZZZ.TXT"));
    answer("rmdir", "not-empty", DosPath(0x3a, DO "\\SUB"));
    answer("rmdir", "missing", DosPath(0x3a, DO "\\NODIR"));
    answer("rmdir", "file", DosPath(0x3a, DO "\\ZZZ.TXT"));

    /* The root. */
    {
        char dots[16];

        listing("C:");
        wsprintf(dots, "%s %s", (LPSTR)(stampIn("C:", ".") ? "yes" : "no"),
                 (LPSTR)(stampIn("C:", "..") ? "yes" : "no"));
        probe("root", "dots", dots);
    }

    wipe(DO);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
