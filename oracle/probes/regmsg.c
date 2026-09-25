/*
 * What `RegisterWindowMessage` gives.
 *
 * Notepad registers the Find dialog's message before it opens its window,
 * and gives up if that fails. The number itself depends on what else was
 * registered first, so this records how it relates to the string rather
 * than any one value:
 *
 * * `register`: the message for a string, the same string again, the same in
 *   another case, and a second string.
 * * `atom`: what `GlobalFindAtom` says of each string, and what
 *   `GlobalGetAtomName` says the message is called.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\REGMSG.OUT"

static const char *STRINGS[] = { "commdlg_FindReplace", "commdlg_FindReplace",
                                 "COMMDLG_FINDREPLACE", "winbox_probe_message" };

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT messages[4];
    char name[64];
    int index;

    probeOpen(OUTPUT);

    for (index = 0; index < 4; index++) {
        messages[index] = RegisterWindowMessage(STRINGS[index]);
    }

    wsprintf(probeResult, "first=%04x,range=%d", messages[0],
             messages[0] >= 0xc000 ? 1 : 0);
    probe("register", "first", probeResult);

    wsprintf(probeResult, "again=%d,case=%d,other=%d,next=%d", messages[1] == messages[0],
             messages[2] == messages[0], messages[3] != messages[0],
             (int)(messages[3] - messages[0]));
    probe("register", "compare", probeResult);

    for (index = 0; index < 4; index += 3) {
        ATOM atom = GlobalFindAtom(STRINGS[index]);

        name[0] = '\0';
        GlobalGetAtomName((ATOM)messages[index], name, sizeof(name));
        wsprintf(probeArgs, "%s", (LPSTR)STRINGS[index]);
        wsprintf(probeResult, "find=%d,name=%s", atom == messages[index], (LPSTR)name);
        probe("atom", probeArgs, probeResult);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
