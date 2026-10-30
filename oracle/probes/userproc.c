/*
 * USER's window procedures and resource handlers that are exported only for
 * USER and KERNEL to reach them.
 *
 * * `classproc`: the desktop's window procedure (`GCL_WNDPROC`) and that of
 *   the classes `#32768` to `#32772` and the controls' (`GetClassInfo`),
 *   each as `301`
 *   (BozosLiveHere), `306` (Bear306) where it is that ordinal's address,
 *   else `other`.
 * * `handler`: the resource handler `SetResourceHandler` answers for the
 *   probe's own module for `RT_ICON`, `RT_CURSOR` and `RT_GROUP_ICON`, as
 *   the USER ordinal whose address it is -- 336 LoadCursorIconHandler, 356
 *   LoadDIBCursorHandler, 357 LoadDIBIconHandler, 456 LoadIconHandler --
 *   or `kernel` where its selector is KERNEL's code's, else `other`; the
 *   handler is put back after each; `kernel` is KERNEL's code's selector,
 *   `FatalExit`'s.
 * * `iconres`: the probe's own icon resource (`RT_ICON`) loaded with
 *   `LoadResource` and locked: its first twelve bytes as words, and its
 *   block's size.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USERPROC.OUT"

typedef FARPROC(FAR PASCAL *SETHANDLER)(HINSTANCE, LPCSTR, FARPROC);

static HMODULE user;
static WORD kernelCode;

static LPCSTR which(FARPROC proc)
{
    static char text[16];
    static const int ordinals[] = { 301, 306, 336, 356, 357, 456 };
    int at;

    for (at = 0; at < 6; at++) {
        if (proc == GetProcAddress(user, MAKEINTRESOURCE(ordinals[at]))) {
            wsprintf(text, "%d", ordinals[at]);
            return text;
        }
    }

    if (!proc) {
        return "none";
    }

    return HIWORD(proc) == kernelCode ? "kernel" : "other";
}

HGLOBAL FAR PASCAL __export Dummy(HGLOBAL block, HINSTANCE instance, HRSRC resource)
{
    (void)instance;
    (void)resource;
    return block;
}

/* A null procedure fails KERNEL's check of the argument (`KRNL386.EXE` seg3
 * `0049`) and changes nothing, so a procedure of the probe's is set and the
 * one it had put back. */
static void handler(SETHANDLER set, HINSTANCE instance, LPCSTR type, LPCSTR what)
{
    FARPROC old = set(instance, type, (FARPROC)Dummy);

    probe("handler", what, which(old));
    set(instance, type, old);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    SETHANDLER setResourceHandler;
    HRSRC found = NULL;
    HGLOBAL loaded;
    WORD FAR *words;
    UINT id;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    setResourceHandler =
        (SETHANDLER)GetProcAddress(GetModuleHandle("KERNEL"), "SetResourceHandler");
    kernelCode = HIWORD(GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(1)));

    probe("classproc", "desktop",
          which((FARPROC)GetClassLong(GetDesktopWindow(), GCL_WNDPROC)));

    if (GetClassInfo(NULL, "#32768", &wc)) {
        probe("classproc", "#32768", which((FARPROC)wc.lpfnWndProc));
    } else {
        probe("classproc", "#32768", "no class");
    }

    for (id = 32769; id <= 32772; id++) {
        char name[8];

        wsprintf(name, "#%u", id);

        if (GetClassInfo(NULL, name, &wc)) {
            probe("classproc", name, which((FARPROC)wc.lpfnWndProc));
        } else {
            probe("classproc", name, "no class");
        }
    }

    {
        static const char *names[] = { "Button", "Edit", "Static", "ListBox", "ScrollBar",
                                        "ComboBox", "ComboLBox", "MDIClient" };

        for (id = 0; id < 8; id++) {
            if (GetClassInfo(NULL, names[id], &wc)) {
                probe("classproc", names[id], which((FARPROC)wc.lpfnWndProc));
            } else {
                probe("classproc", names[id], "no class");
            }
        }
    }

    handler(setResourceHandler, instance, RT_ICON, "icon");
    handler(setResourceHandler, instance, RT_CURSOR, "cursor");
    handler(setResourceHandler, instance, RT_GROUP_ICON, "group icon");

    for (id = 1; id < 20 && !found; id++) {
        found = FindResource(instance, MAKEINTRESOURCE(id), RT_ICON);
    }

    if (found) {
        loaded = LoadResource(instance, found);
        words = (WORD FAR *)LockResource(loaded);
        wsprintf(probeResult, "%04x %04x %04x %04x %04x %04x size=%lu", words[0], words[1],
                 words[2], words[3], words[4], words[5], GlobalSize(loaded));
        probe("iconres", "header", probeResult);
        UnlockResource(loaded);
        FreeResource(loaded);
    } else {
        probe("iconres", "header", "not found");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
