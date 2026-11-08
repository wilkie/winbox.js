/*
 * What WATCOM's Win386 supervisor gives the 32-bit program it starts, as
 * the program finds it (`kb/topics/win386.md`): its segment registers'
 * selectors, read with `LAR` and `LSL` from the 32-bit code itself, the
 * stack it runs on, and a 16-bit alias of one of its pointers. Recorded in
 * 386 enhanced mode only (`record.mjs --mode enhanced`); in standard mode
 * the supervisor stops at its box. Built by `build-probes.mjs` as
 * `buildWin386` builds every `oracle/probes/win386` program.
 *
 * * `segment <reg>`: the selector's table and privilege (its low three
 *   bits); `LAR`'s access byte and flags (bits 8 to 23: the access byte,
 *   then the granularity and default-size bits); `LSL`'s limit, in bytes.
 * * `supervisor gs`: the same of GS, which holds the supervisor's own data
 *   segment, the program's 16-bit one.
 * * `segment same`: whether SS, ES, FS and GS are DS.
 * * `stack`: the 32-bit stack's ESP at `WinMain`, whose stack the
 *   supervisor sets from the program's image; and that pushing moves ESP
 *   whole.
 * * `alias`: `AllocAlias16` of a local, the 16:16 pointer's selector's
 *   rights and limit, and that a byte written through the flat pointer is
 *   read back through the alias' offset.
 */

#include <stdio.h>
#include <stdlib.h>

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\W386ENV.OUT"

/* `LAR` of a selector: its rights, or nought with `*valid` nought. */
static unsigned long rightsOf(unsigned short selector, int *valid)
{
    unsigned long rights = 0;
    int ok = 0;

    _asm {
        movzx ecx, selector
        lar eax, ecx
        jnz refused
        mov rights, eax
        mov ok, 1
    refused:
    }

    *valid = ok;
    return rights;
}

/* `LSL` of a selector: its limit in bytes. */
static unsigned long limitOf(unsigned short selector)
{
    unsigned long limit = 0;

    _asm {
        movzx ecx, selector
        lsl eax, ecx
        jnz refused
        mov limit, eax
    refused:
    }

    return limit;
}

static void segment(const char *group, const char *name, unsigned short selector)
{
    int valid;
    unsigned long rights = rightsOf(selector, &valid);

    if (!valid) {
        wsprintf(probeResult, "low %u, LAR refused", selector & 7);
    } else {
        wsprintf(probeResult, "low %u, rights %06lx, limit %08lx", selector & 7,
                 (rights >> 8) & 0xffffffL, limitOf(selector));
    }

    probe(group, name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    unsigned short sCS, sDS, sSS, sES, sFS, sGS;
    unsigned long sESP, pushed;
    unsigned long alias;
    static char local[16];

    probeOpen(OUTPUT);

    _asm {
        mov ax, cs
        mov sCS, ax
        mov ax, ds
        mov sDS, ax
        mov ax, ss
        mov sSS, ax
        mov ax, es
        mov sES, ax
        mov ax, fs
        mov sFS, ax
        mov ax, gs
        mov sGS, ax
        mov sESP, esp
    }

    segment("segment", "cs", sCS);
    segment("segment", "ds", sDS);
    segment("segment", "ss", sSS);
    segment("segment", "es", sES);
    segment("segment", "fs", sFS);
    segment("supervisor", "gs", sGS);

    wsprintf(probeResult, "ss %s, es %s, fs %s, gs %s", sSS == sDS ? "is" : "is not",
             sES == sDS ? "is" : "is not", sFS == sDS ? "is" : "is not",
             sGS == sDS ? "is" : "is not");
    probe("segment", "same", probeResult);

    wsprintf(probeResult, "%08lx", sESP);
    probe("stack", "esp", probeResult);

    _asm {
        mov eax, esp
        push eax
        mov ecx, esp
        pop eax
        sub eax, ecx
        mov pushed, eax
    }

    wsprintf(probeResult, "%lu", pushed);
    probe("stack", "push moves esp by", probeResult);

    local[3] = 0x5a;
    alias = AllocAlias16(local);

    if (alias == 0) {
        probe("alias", "AllocAlias16", "refused");
    } else {
        unsigned short selector = (unsigned short)(alias >> 16);
        unsigned char *back = (unsigned char *)MapAliasToFlat(alias + 3);

        probe("alias", "AllocAlias16", "given");
        segment("segment", "alias", selector);
        wsprintf(probeResult, "%02x", back == &local[3] ? (unsigned)*back : 0xffu);
        probe("alias", "MapAliasToFlat", probeResult);
        FreeAlias16(alias);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
