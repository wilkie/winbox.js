/*
 * A task's DOS environment, as Windows hands it over.
 *
 * A C runtime's start-up finds its program's path in the environment: past
 * the variables, the pair of zero bytes that ends them, and a word count, as
 * DOS 3 lays a program's environment out. This records what is there:
 *
 * * `pdb`: whether the environment word at 2Ch of the task's PSP is the same
 *   selector `GetDOSEnvironment` gives.
 * * `variable`: each string of the environment, in order.
 * * `count`: the word after the zero that ends them.
 * * `path`: the string after that, and `module`, what `GetModuleFileName`
 *   gives, to compare.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENVIRON.OUT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    LPSTR environment = GetDOSEnvironment();
    UINT pdb = GetCurrentPDB();
    UINT FAR *psp = (UINT FAR *)MAKELP(pdb, 0);
    LPSTR at = environment;
    int index = 0;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "psp=%04x,environment=%04x,offset=%04x", psp[0x2c / 2],
             SELECTOROF(environment), OFFSETOF(environment));
    probe("pdb", "", probeResult);

    while (*at) {
        wsprintf(probeArgs, "%d", index++);
        lstrcpyn(probeResult, at, sizeof(probeResult));
        probe("variable", probeArgs, probeResult);
        at += lstrlen(at) + 1;
    }

    wsprintf(probeResult, "at=%d,value=%u", (int)(at - environment),
             *(UINT FAR *)(at + 1));
    probe("count", "", probeResult);

    lstrcpyn(probeResult, at + 3, sizeof(probeResult));
    probe("path", "", probeResult);

    GetModuleFileName(instance, probeResult, sizeof(probeResult));
    probe("module", "", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
