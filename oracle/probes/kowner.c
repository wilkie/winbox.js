/*
 * KERNEL's ordinals 404 and 403, called by ordinal: a global block's owner,
 * got and set (`KRNL386.EXE` seg1 `29ae`, `29f1`).
 *
 * * `get`: ordinal 404 of a block, named as what it is equal to -- `module`
 *   (the probe's module), `task` (the probe's task), `pdb` (its prefix),
 *   `instance` (its data segment's handle), `user` and `kernel` (those
 *   modules' handles), `ffff`, `zero`, else `other`. The blocks: the probe's
 *   data segment and code segment (by selector), a `GlobalAlloc` block, a
 *   `GMEM_SHARE` one, the task's database, its prefix, the probe's module's
 *   database, USER's data segment (ordinal 285's answer), a selector of
 *   nought and one that is no block's.
 * * `set`: ordinal 403 to make a block another's, and 404 of it after;
 *   AX as it comes back, as `kept` where it is the selector passed (403
 *   leaves AX as its callee left it); `GlobalFree` of the block after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KOWNER.OUT"

typedef WORD(FAR PASCAL *GETOWNER)(WORD);
typedef WORD(FAR PASCAL *SETOWNER)(WORD, WORD);
typedef WORD(FAR PASCAL *W2)(WORD, WORD);

WORD getDs(void);
#pragma aux getDs = "mov ax, ds" value [ax];
WORD getCs(void);
#pragma aux getCs = "mov ax, cs" value [ax];

static GETOWNER getOwner;
static SETOWNER setOwner;
static HMODULE module;
static HTASK task;
static WORD pdb;
static HINSTANCE own;
static HMODULE user;
static HMODULE kernel;

static LPCSTR named(WORD owner)
{
    if (!owner) {
        return "zero";
    }

    if (owner == 0xffff) {
        return "ffff";
    }

    if (owner == (WORD)module) {
        return "module";
    }

    if (owner == (WORD)task) {
        return "task";
    }

    if (owner == pdb) {
        return "pdb";
    }

    if (owner == (WORD)own) {
        return "instance";
    }

    if (owner == (WORD)user) {
        return "user";
    }

    if (owner == (WORD)kernel) {
        return "kernel";
    }

    return "other";
}

static void get(LPCSTR what, WORD selector)
{
    probe("get", what, named(getOwner(selector)));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    HGLOBAL shared;
    WORD selector;
    WORD answer;
    W2 bear285;

    probeOpen(OUTPUT);

    kernel = GetModuleHandle("KERNEL");
    user = GetModuleHandle("USER");
    getOwner = (GETOWNER)GetProcAddress(kernel, MAKEINTRESOURCE(404));
    setOwner = (SETOWNER)GetProcAddress(kernel, MAKEINTRESOURCE(403));
    bear285 = (W2)GetProcAddress(user, MAKEINTRESOURCE(285));
    own = instance;
    module = GetModuleHandle("KOWNER");
    task = GetCurrentTask();
    pdb = GetCurrentPDB();

    get("data segment", getDs());
    get("code segment", getCs());

    block = GlobalAlloc(GMEM_MOVEABLE, 64);
    get("moveable block", (WORD)block);
    selector = HIWORD(GlobalLock(block));
    get("moveable selector", selector);
    GlobalUnlock(block);

    shared = GlobalAlloc(GMEM_MOVEABLE | GMEM_SHARE, 64);
    get("shared block", (WORD)shared);

    get("task database", (WORD)task);
    get("prefix", pdb);
    get("module database", (WORD)module);
    get("user data", bear285(0, 0));
    get("nought", 0);
    get("no block", 0xfff7);

    answer = setOwner((WORD)block, (WORD)user);
    probe("set", "moveable to user, ax", answer == (WORD)block ? "kept" : named(answer));
    get("moveable after set", (WORD)block);
    answer = setOwner((WORD)block, (WORD)pdb);
    get("moveable set back", (WORD)block);

    wsprintf(probeResult, "%u", (UINT)GlobalFree(block));
    probe("set", "GlobalFree after", probeResult);
    wsprintf(probeResult, "%u", (UINT)GlobalFree(shared));
    probe("set", "GlobalFree shared", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
