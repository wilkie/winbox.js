/*
 * The handles of Windows' own modules, as a program sees them: whether each
 * is 32 or more -- below that, LoadLibrary's answer is an error -- and how
 * LoadLibrary's answer, the instance, stands to GetModuleHandle's, the
 * module. CTL3D, which BG of the corpus ships, loads USER.EXE by name and
 * goes on only when the answer is 32 or more.
 *
 * * `module`: the module's name; GetModuleHandle's answer as `big` (32 or
 *   more), `small` or `none`, and its low two bits. `driver` the same, for
 *   the system and display drivers.
 * * `load`: the file's name; LoadLibrary's answer, the same way, and whether
 *   it is GetModuleHandle's handle (`same`), one more or less (`plus1`,
 *   `minus1`), or `other`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MODHAND.OUT"

static LPCSTR size(UINT handle)
{
    return !handle ? "none" : handle >= 32 ? "big" : "small";
}

static void module(LPCSTR function, LPCSTR name)
{
    HMODULE handle = GetModuleHandle(name);

    wsprintf(probeResult, "%s %d", size((UINT)handle), (UINT)handle & 3);
    probe(function, name, probeResult);
}

static void load(LPCSTR file, LPCSTR name)
{
    HINSTANCE instance = LoadLibrary(file);
    UINT module = (UINT)GetModuleHandle(name);
    UINT got = (UINT)instance;

    wsprintf(probeResult, "%s %d %s", size(got), got & 3,
             (LPSTR)(got == module       ? "same"
                     : got == module + 1 ? "plus1"
                     : got == module - 1 ? "minus1"
                                         : "other"));
    probe("load", file, probeResult);

    if (got >= 32) {
        FreeLibrary(instance);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    module("module", "KERNEL");
    module("module", "USER");
    module("module", "GDI");
    module("module", "KEYBOARD");
    module("driver", "SYSTEM");
    module("module", "SOUND");
    module("module", "MMSYSTEM");
    module("driver", "DISPLAY");

    load("user.exe", "USER");
    load("gdi.exe", "GDI");
    load("krnl386.exe", "KERNEL");
    load("sound.drv", "SOUND");
    load("mmsystem.dll", "MMSYSTEM");
    load("keyboard.drv", "KEYBOARD");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
