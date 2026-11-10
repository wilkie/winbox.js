/*
 * What `FindResource` answers when a module carries an old-style name
 * table (`RT_NAMETABLE`, type 15), whose entries give names to numbered
 * types and resources. Modern resource compilers write none:
 * `build-probes.mjs` lays this probe's out from named constants
 * (`NAME_TABLES`) and binds it in as resource 1 of type 15 of the library
 * NAMETABD.DLL, beside the resources in `nametab.dll.rc`, and as
 * resource 2 of type 15 of the program itself.
 *
 * The library's table, entry by entry: the type word, the id word, the
 * type's name and the resource's.
 *
 *    1. FF01h 2720h "PALT" ""        as DOGZDLL.DLL's are laid out
 *    2. FF01h 2810h "PALT" ""        two bytes past its strings
 *    3. FF01h A811h "PALT" ""        the id with its high bit
 *    4. FF01h A812h "PALT" "SECOND"
 *    5. 7F02h 2900h "NOHI" ""        the type without its high bit
 *    6. 7F03h 8005h ""     "BYNUM"
 *    7. FF04h 8007h ""     "VIANUM"
 *    8. FF01h A813h "PALT" "DUP"
 *    9. FF01h A814h "PALT" "DUP"
 *
 * Each record is `FindResource`'s arguments -- a number as `n=` and its
 * hex, a string in quotes -- and what it found: the tag the resource
 * holds (`LoadResource`, `LockResource`) and `SizeofResource`, or `0`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\NAMETAB.OUT"

/* A resource asked for: what it was found by, and what was found. */
static void find(HINSTANCE module, LPCSTR label, LPCSTR name, LPCSTR type)
{
    HRSRC found = FindResource(module, name, type);
    char args[96];

    if (HIWORD((DWORD)name)) {
        wsprintf(args, "%s:\"%s\",", label, name);
    } else {
        wsprintf(args, "%s:n=%x,", label, LOWORD((DWORD)name));
    }

    if (HIWORD((DWORD)type)) {
        wsprintf(args + lstrlen(args), "\"%s\"", type);
    } else {
        wsprintf(args + lstrlen(args), "n=%x", LOWORD((DWORD)type));
    }

    if (!found) {
        probe("FindResource", args, "0");
        return;
    }

    {
        DWORD size = SizeofResource(module, found);
        HGLOBAL loaded = LoadResource(module, found);
        LPSTR bytes = loaded ? (LPSTR)LockResource(loaded) : NULL;

        wsprintf(probeResult, "%s,%ld", bytes ? bytes : (LPSTR)"(none)", size);
        probe("FindResource", args, probeResult);

        if (bytes) {
            GlobalUnlock(loaded);
        }

        if (loaded) {
            FreeResource(loaded);
        }
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;

    probeOpen(OUTPUT);

    library = LoadLibrary("NAMETABD.DLL");
    wsprintf(probeResult, "%s", (LPSTR)((UINT)library >= 32 ? "loaded" : "failed"));
    probe("LoadLibrary", "NAMETABD.DLL", probeResult);

    if ((UINT)library >= 32) {
        /* The table itself, as KERNEL finds it. */
        {
            HRSRC table = FindResource(library, MAKEINTRESOURCE(1), MAKEINTRESOURCE(15));

            wsprintf(probeResult, "%s,%ld", (LPSTR)(table ? "found" : "0"),
                     table ? SizeofResource(library, table) : 0L);
            probe("FindResource", "dll:n=1,n=f", probeResult);
        }

        /* DOGZDLL's: a numbered resource of a type the table names. */
        find(library, "dll", MAKEINTRESOURCE(0x2720), "PALT");
        find(library, "dll", MAKEINTRESOURCE(0x2810), "PALT");
        /* Case. */
        find(library, "dll", MAKEINTRESOURCE(0x2810), "palt");
        find(library, "dll", MAKEINTRESOURCE(0x2810), "Palt");
        /* A resource of the type the table names that no entry holds; the
         * resource table's own type PALT holds one of that number. */
        find(library, "dll", MAKEINTRESOURCE(0x2721), "PALT");
        /* An entry whose id has its high bit, asked by the number. */
        find(library, "dll", MAKEINTRESOURCE(0x2811), "PALT");
        find(library, "dll", MAKEINTRESOURCE(0xa811), "PALT");
        /* Both by name, in either case. */
        find(library, "dll", "SECOND", "PALT");
        find(library, "dll", "second", "palt");
        /* A name only the resource table's own type PALT holds. */
        find(library, "dll", "NAME1", "PALT");
        /* An entry whose type has no high bit. */
        find(library, "dll", MAKEINTRESOURCE(0x2900), "NOHI");
        /* A name of a numbered type, the type by number. */
        find(library, "dll", "BYNUM", MAKEINTRESOURCE(0x7f03));
        find(library, "dll", "VIANUM", MAKEINTRESOURCE(0x7f04));
        find(library, "dll", "VIANUM", MAKEINTRESOURCE(0xff04));
        find(library, "dll", "SECOND", MAKEINTRESOURCE(0x7f01));
        /* Two entries with the same names. */
        find(library, "dll", "DUP", "PALT");
        /* `#` numbers, which ask by number. */
        find(library, "dll", "#10016", "PALT");
        find(library, "dll", MAKEINTRESOURCE(0x2720), "#32513");
        find(library, "dll", "#10016", "#32513");
        /* A number as plain digits. */
        find(library, "dll", "10016", "PALT");
        /* What neither table holds. */
        find(library, "dll", MAKEINTRESOURCE(0x2722), "PALT");
        find(library, "dll", "NOSUCH", "PALT");
        find(library, "dll", MAKEINTRESOURCE(0x2720), "NOSUCH");

        FreeLibrary(library);
    }

    /* The program's own: its table is resource 2 of type 15. */
    {
        HRSRC table = FindResource(instance, MAKEINTRESOURCE(2), MAKEINTRESOURCE(15));

        wsprintf(probeResult, "%s,%ld", (LPSTR)(table ? "found" : "0"),
                 table ? SizeofResource(instance, table) : 0L);
        probe("FindResource", "exe:n=2,n=f", probeResult);
    }

    find(instance, "exe", MAKEINTRESOURCE(0x2720), MAKEINTRESOURCE(0x7f01));
    find(instance, "exe", MAKEINTRESOURCE(0x2720), "PALT");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
