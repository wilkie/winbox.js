/*
 * COMMDLG's GetFileTitle, on names of every shape its parser tells apart:
 *
 * * `title`: for each name, what GetFileTitle answers, the title it wrote
 *   (`untouched` where it wrote none), and the name as GetFileTitle left
 *   it -- COMMDLG's parser strips leading spaces, trailing spaces and a
 *   trailing period in place.
 * * `size`: a name's title asked for with buffers too small, exactly
 *   large enough, and of nought.
 * * `error`: CommDlgExtendedError after them all: GetFileTitle sets none.
 */

#include "probe.h"
#include <commdlg.h>

#pragma library("commdlg")

#define OUTPUT "C:\\ORACLE\\FTITLE.OUT"

static const char *NAMES[] = {
    "C:\\DIR\\FILE.TXT",
    "FILE.TXT",
    "file.txt",
    "C:FILE.TXT",
    "\\FILE",
    "FILE.",
    "FILE",
    ".TXT",
    "  LEAD.TXT",
    "TRAIL.TXT  ",
    "IN SIDE.TXT",
    "",
    "   ",
    "C:\\",
    "C:\\DIR\\",
    "C:",
    "1:\\FILE",
    "C:\\DIR\\*.TXT",
    "FI?E.TXT",
    "C:\\D*R\\FILE.TXT",
    "LONGFILENAME.TXT",
    "FILE.TEXT",
    "FILE.T.X",
    "TOOLONGNAME",
    "A+B.TXT",
    "A,B",
    "A;B",
    "A=B",
    "A[B]",
    "A|B",
    "A\"B",
    "A<B>",
    "C:\\..\\FILE",
    "..\\FILE.TXT",
    ".\\FILE.TXT",
    "..",
    ".",
    "\\.\\FILE",
    "\\..\\FILE",
    "C:\\DIR\\\\FILE",
    "C:/DIR/FILE.TXT",
    "\\\\SERVER\\SHARE\\FILE.TXT",
    "\\\\SERVER\\SHARE",
    "\\\\SERVER\\",
    "\\\\SERVERNAMEXX\\SHARE\\F",
    "C:\\DIR.EXT\\FILE",
    "\xe9T\xe9.TXT",
    "A\tB",
    "*.*",
    "FILE.TXT;*.DOC",
};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char name[128];
    char title[128];
    int answer;
    int i;
    static const int SIZES[] = {0, 1, 8, 9, 10, 64};

    probeOpen(OUTPUT);

    for (i = 0; i < (int)(sizeof(NAMES) / sizeof(NAMES[0])); i++) {
        lstrcpy(name, NAMES[i]);
        lstrcpy(title, "untouched");
        answer = GetFileTitle(name, title, sizeof(title));
        wsprintf(probeResult, "%d|%s|%s", answer, (LPSTR)title, (LPSTR)name);
        probe("title", NAMES[i], probeResult);
    }

    for (i = 0; i < (int)(sizeof(SIZES) / sizeof(SIZES[0])); i++) {
        lstrcpy(name, "C:\\DIR\\FILE.TXT");
        lstrcpy(title, "untouched");
        answer = GetFileTitle(name, title, SIZES[i]);
        wsprintf(probeArgs, "%d", SIZES[i]);
        wsprintf(probeResult, "%d|%s", answer, (LPSTR)title);
        probe("size", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%lx", CommDlgExtendedError());
    probe("error", "", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
