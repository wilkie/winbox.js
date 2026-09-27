/*
 * `FileCdr`, the hook through which KERNEL tells one program -- File
 * Manager -- that a file has changed. The probe sets a callback of its own,
 * asks for it back, changes files in each way there is, and clears it.
 *
 * * `answer`: what `FileCdr` answered: setting, 1 or 0; asking (a segment of
 *   FFFFh), whether it gave back the probe's callback (`same`), nothing
 *   (`0`), or another (`other`).
 * * `told`: what the callback was told by one change, each call as the DOS
 *   function in hexadecimal -- AH, or AX for 43h -- and the path it was
 *   handed: `none` for no call.
 */

#include "probe.h"

#include <direct.h>
#include <dos.h>
#include <stdio.h>

#define OUTPUT "C:\\ORACLE\\FILECDR.OUT"

typedef LONG(FAR PASCAL *CDRPROC)(FARPROC);

static char told[1200];

BOOL FAR PASCAL _export Notify(WORD function, LPSTR path)
{
    char one[160];

    /* AL is whatever the caller had there -- the C runtime's is the low byte
     * of the path's selector -- so only AH is kept, and AL for 43h, where it
     * is the subfunction. */
    if ((function >> 8) == 0x43) {
        wsprintf(one, "%s%x:%s", (LPSTR)(told[0] ? "," : ""), function, path);
    } else {
        wsprintf(one, "%s%x:%s", (LPSTR)(told[0] ? "," : ""), function >> 8, path);
    }

    if (lstrlen(told) + lstrlen(one) < sizeof(told) - 1) {
        lstrcat(told, one);
    }

    return TRUE;
}

static void step(LPCSTR name)
{
    probe("told", name, told[0] ? told : "none");
    told[0] = '\0';
}

static void answer(LPCSTR what, LONG value, FARPROC mine)
{
    if (what[0] == 'a') {
        probe("answer", what, (LPSTR)(value == (LONG)mine ? "same" : value == 0 ? "0" : "other"));
    } else {
        wsprintf(probeResult, "%ld", value & 0xffffL);
        probe("answer", what, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    CDRPROC cdr;
    FARPROC mine;
    OFSTRUCT of;
    int file;

    probeOpen(OUTPUT);

    cdr = (CDRPROC)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(130));
    mine = MakeProcInstance((FARPROC)Notify, instance);

    answer("asked-before", cdr((FARPROC)MAKELONG(0, 0xffff)), mine);
    answer("set", cdr(mine), mine);
    answer("asked", cdr((FARPROC)MAKELONG(0, 0xffff)), mine);
    answer("set-again", cdr(mine), mine);

    file = _lcreat("C:\\ORACLE\\ONE.TXT", 0);
    step("lcreat");
    _lwrite(file, "abc", 3);
    step("lwrite");
    _lclose(file);
    step("lclose");

    file = OpenFile("C:\\ORACLE\\TWO.TXT", &of, OF_CREATE | OF_WRITE);
    step("openfile-create");
    _lclose(file);
    step("openfile-close");

    file = _lopen("C:\\ORACLE\\ONE.TXT", OF_READ);
    step("lopen");
    _lclose(file);

    rename("C:\\ORACLE\\ONE.TXT", "C:\\ORACLE\\THREE.TXT");
    step("rename");

    mkdir("C:\\ORACLE\\SUB");
    step("mkdir");
    rmdir("C:\\ORACLE\\SUB");
    step("rmdir");

    _dos_setfileattr("C:\\ORACLE\\THREE.TXT", _A_RDONLY);
    step("setattr");
    _dos_setfileattr("C:\\ORACLE\\THREE.TXT", _A_NORMAL);
    step("setattr-back");

    {
        int made;

        if (_dos_creatnew("C:\\ORACLE\\FIVE.TXT", _A_NORMAL, &made) == 0) {
            _dos_close(made);
        }

        step("creatnew");
        remove("C:\\ORACLE\\FIVE.TXT");
        step("remove-five");
    }

    remove("C:\\ORACLE\\NOSUCH.TXT");
    step("remove-missing");

    remove("C:\\ORACLE\\THREE.TXT");
    step("remove");

    OpenFile("C:\\ORACLE\\TWO.TXT", &of, OF_DELETE);
    step("openfile-delete");

    answer("clear", cdr((FARPROC)0), mine);
    answer("asked-after", cdr((FARPROC)MAKELONG(0, 0xffff)), mine);

    file = _lcreat("C:\\ORACLE\\FOUR.TXT", 0);
    _lclose(file);
    OpenFile("C:\\ORACLE\\FOUR.TXT", &of, OF_DELETE);
    step("cleared");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
