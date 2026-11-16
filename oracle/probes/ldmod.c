/*
 * LoadModule of a library with a parameter block, as Math Blaster loads its
 * own (`MB4.EXE` at `177:1512` and `177:157b`, `MB4DLL.DLL` and
 * `MB4DLL2.DLL`). The library is the probe's own, LDMODD.DLL
 * (`ldmod.dll.c`), whose LibMain notes its calls, its instance and its
 * stack. The block is a program's: no environment of its own, an empty
 * command tail, and SW_SHOWNORMAL.
 *
 * * `before`: GetModuleHandle of the library, and the tasks there are.
 * * `loadmodule`: what LoadModule answers -- below 32 an error, else
 *   whether it is the library's instance -- and the tasks there are after.
 * * `libmain`: how many times LibMain ran, whether its instance was what
 *   LoadModule answered, whether it ran on the probe's own stack.
 * * `usage`: GetModuleUsage after LoadModule, after a LoadLibrary of it
 *   (whose answer is compared), and after each FreeLibrary; GetModuleHandle
 *   at the end.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LDMOD.OUT"
#define LIBRARY "LDMODD.DLL"

typedef WORD(FAR PASCAL *INFO)(int);

static char tail[2];
static WORD show[2];

static struct {
    WORD environment;
    LPSTR tail;
    LPWORD show;
    DWORD reserved;
} block;

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show_)
{
    HINSTANCE loaded, again;
    HMODULE module;
    INFO info;
    WORD ownSS;

    probeOpen(OUTPUT);

    _asm {
        mov ax, ss
        mov ownSS, ax
    }

    wsprintf(probeResult, "module=%u tasks=%u", GetModuleHandle("LDMODD") != 0, GetNumTasks());
    probe("before", "", probeResult);

    tail[0] = 0;
    tail[1] = 0;
    show[0] = 2;
    show[1] = SW_SHOWNORMAL;
    block.environment = 0;
    block.tail = tail;
    block.show = show;
    block.reserved = 0;

    loaded = LoadModule(LIBRARY, &block);
    module = GetModuleHandle("LDMODD");

    if ((UINT)loaded < 32) {
        wsprintf(probeResult, "error %u tasks=%u", (UINT)loaded, GetNumTasks());
        probe("loadmodule", LIBRARY, probeResult);
        probeFinish();
        return 0;
    }

    info = (INFO)GetProcAddress(module, "LDMODINFO");
    wsprintf(probeResult, "instance=%u module=%u tasks=%u",
             info && (WORD)loaded == info(1), module != 0, GetNumTasks());
    probe("loadmodule", LIBRARY, probeResult);

    if (info) {
        wsprintf(probeResult, "calls=%u own stack=%u", info(0), info(2) == ownSS);
    } else {
        lstrcpy(probeResult, "no LdmodInfo");
    }
    probe("libmain", "", probeResult);

    wsprintf(probeResult, "%u", GetModuleUsage(module));
    probe("usage", "after LoadModule", probeResult);

    again = LoadLibrary(LIBRARY);
    wsprintf(probeResult, "%u same=%u calls=%u", GetModuleUsage(module), again == loaded,
             info ? info(0) : 0);
    probe("usage", "after LoadLibrary", probeResult);

    FreeLibrary(again);
    wsprintf(probeResult, "%u", GetModuleUsage(module));
    probe("usage", "after one FreeLibrary", probeResult);

    FreeLibrary(loaded);
    wsprintf(probeResult, "%u", GetModuleHandle("LDMODD") != 0);
    probe("usage", "module there after two", probeResult);

    probeFinish();
    (void)instance;
    (void)previous;
    (void)command;
    (void)show_;
    return 0;
}
