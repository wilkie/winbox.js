/*
 * Which selectors KERNEL gives again once a program or a library has ended
 * and its segments are freed, and in what order.
 *
 * Every selector is named as the probe meets it; a later one is recorded as
 * the name of the earlier one with the same descriptor (the same value
 * shifted right by three), the latest first, or `new`.
 *
 * * `fixed`: four fixed blocks, `f1` to `f4`; `f2`, `f4` and `f3` freed in
 *   that order, and three more, `g1` to `g3`, allocated.
 * * `library`: `SEGFREED.DLL` loaded -- its code segment's selector, its
 *   instance, its module -- and freed; then six fixed blocks, `a1` to `a6`.
 * * `child`: `SEGFREEC.EXE` run to its end twice. Each run writes down its
 *   code segment, data segment, instance, module, task, program segment
 *   prefix and environment, `c1.` and `c2.`; the second run's are named by
 *   the first's. Between the runs, eight fixed blocks, `p1` to `p8`, are
 *   allocated and freed again in the reverse order, which shows what the
 *   first run's end freed without changing what the second run is given.
 *   After the second, ten fixed blocks, `b1` to `b10`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SEGFREE.OUT"
#define LIBRARY "SEGFREED.DLL"
#define NAMES 64

typedef int(FAR PASCAL *CODEPROC)(void);

static char names[NAMES][16];
static WORD indices[NAMES];
static int count = 0;

static LPCSTR nameOf(WORD value)
{
    int i;

    for (i = count - 1; i >= 0; i--) {
        if (indices[i] == (value >> 3)) {
            return names[i];
        }
    }

    return "new";
}

/* Records what a selector was, and names it. */
static void meet(LPCSTR what, LPCSTR name, WORD value)
{
    probe(what, name, value ? nameOf(value) : "0");

    if (count < NAMES && value) {
        lstrcpy(names[count], name);
        indices[count] = value >> 3;
        count++;
    }
}

static HGLOBAL fixed(LPCSTR what, LPCSTR name)
{
    HGLOBAL block = GlobalAlloc(GMEM_FIXED, 32);

    meet(what, name, (WORD)block);
    return block;
}

static BOOL runChild(LPCSTR prefix)
{
    static const char *const FIELDS[7] = {"cs", "ds", "instance", "module", "task", "pdb", "env"};
    WORD values[8];
    UINT started;
    DWORD start;
    MSG msg;
    HFILE file;
    OFSTRUCT of;
    int i;

    OpenFile("C:\\ORACLE\\SEGFREE.DAT", &of, OF_DELETE);
    started = WinExec("C:\\WINDOWS\\SEGFREEC.EXE", SW_SHOWMINNOACTIVE);
    start = GetTickCount();

    while (GetModuleHandle("SEGFREEC") && GetTickCount() - start < 5000) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }

    wsprintf(probeResult, "started=%d ended=%d", started >= 32, GetModuleHandle("SEGFREEC") == NULL);
    probe("child", prefix, probeResult);

    file = _lopen("C:\\ORACLE\\SEGFREE.DAT", OF_READ);

    if (file == HFILE_ERROR) {
        probe("child", prefix, "no file");
        return FALSE;
    }

    _lread(file, values, sizeof(values));
    _lclose(file);
    OpenFile("C:\\ORACLE\\SEGFREE.DAT", &of, OF_DELETE);

    for (i = 0; i < 7; i++) {
        char name[16];

        wsprintf(name, "%s.%s", prefix, (LPSTR)FIELDS[i]);
        meet("child", name, values[i]);
    }

    return TRUE;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL f[5];
    HINSTANCE library;
    CODEPROC code;
    int i;

    probeOpen(OUTPUT);

    probeNote("fixed blocks freed and allocated again");
    f[1] = fixed("fixed", "f1");
    f[2] = fixed("fixed", "f2");
    f[3] = fixed("fixed", "f3");
    f[4] = fixed("fixed", "f4");
    GlobalFree(f[2]);
    GlobalFree(f[4]);
    GlobalFree(f[3]);
    fixed("fixed", "g1");
    fixed("fixed", "g2");
    fixed("fixed", "g3");

    probeNote("a library loaded and freed");
    library = LoadLibrary(LIBRARY);

    if ((UINT)library >= 32) {
        code = (CODEPROC)GetProcAddress(library, "SEGFREECODE");
        meet("library", "lib.code", code ? SELECTOROF(code) : 0);
        meet("library", "lib.instance", (WORD)library);
        meet("library", "lib.module", (WORD)GetModuleHandle("SEGFREED"));
        FreeLibrary(library);
        wsprintf(probeResult, "%d", GetModuleHandle("SEGFREED") != NULL);
        probe("library", "loaded after", probeResult);

        for (i = 1; i <= 6; i++) {
            char name[8];

            wsprintf(name, "a%d", i);
            fixed("library", name);
        }
    } else {
        wsprintf(probeResult, "%u", (UINT)library);
        probe("LoadLibrary", LIBRARY, probeResult);
    }

    probeNote("a program run twice");

    if (runChild("c1")) {
        HGLOBAL popped[8];

        /* What the first run's end freed, last first: taken, and freed again
         * last first, so the second run is given them as they were. */
        for (i = 0; i < 8; i++) {
            char name[8];

            wsprintf(name, "p%d", i + 1);
            popped[i] = fixed("between", name);
        }

        while (i-- > 0) {
            GlobalFree(popped[i]);
        }
    }

    if (runChild("c2")) {
        for (i = 1; i <= 10; i++) {
            char name[8];

            wsprintf(name, "b%d", i);
            fixed("child", name);
        }
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
