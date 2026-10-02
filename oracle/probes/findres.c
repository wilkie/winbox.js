/*
 * What `FindResource` answers, call after call, for resources the probe
 * carries in `findres.rc`: two by number and one by name.
 *
 * * `same`: one resource found twice, the two answers equal (`same`) or not
 *   (`differ`).
 * * `other`: a second resource's answer against the first's: `same` or
 *   `differ`, and the second less the first.
 * * `named`: the named resource's answer against the first's, the same way.
 * * `many`: one resource found 20,000 times without anything freed: how many
 *   of the answers were nought, and how many differed from the first.
 * * `load`: `LoadResource` of one resource twice, the two handles `same` or
 *   `differ`.
 * * `free`: `FreeResource` of the second handle, what it answered -- nought,
 *   or the handle given it (`handle`), or another number (`other`) -- and
 *   whether the resource's bytes are still where `LockResource` of the first
 *   finds them (`kept`, `gone`) -- then `FreeResource` of the first, what it
 *   answered as before, and `LoadResource` again: `same` handle as before or
 *   `differ`.
 * * `loads`: the other resource loaded 20,000 times without a free: how many
 *   of the handles were nought, and how many differed from the first.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\FINDRES.OUT"

/* What `FreeResource` answered: nought, the handle it was given, or another. */
static LPSTR answer(int freed, HGLOBAL given)
{
    return freed == 0 ? "0" : freed == (int)given ? "handle" : "other";
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HRSRC first;
    HRSRC again;
    HRSRC second;
    HRSRC named;
    long zero = 0;
    long differ = 0;
    long i;

    probeOpen(OUTPUT);

    first = FindResource(instance, MAKEINTRESOURCE(1), RT_RCDATA);
    again = FindResource(instance, MAKEINTRESOURCE(1), RT_RCDATA);
    probe("same", "1", first == again ? "same" : "differ");

    second = FindResource(instance, MAKEINTRESOURCE(2), RT_RCDATA);
    wsprintf(probeResult, "%s,%d", (LPSTR)(second == first ? "same" : "differ"),
             (int)second - (int)first);
    probe("other", "2", probeResult);

    named = FindResource(instance, "WORDS", RT_RCDATA);
    wsprintf(probeResult, "%s,%d", (LPSTR)(named == first ? "same" : "differ"),
             (int)named - (int)first);
    probe("named", "WORDS", probeResult);

    for (i = 0; i < 20000L; i++) {
        HRSRC found = FindResource(instance, MAKEINTRESOURCE(1), RT_RCDATA);

        if (!found) {
            zero++;
        } else if (found != first) {
            differ++;
        }
    }

    wsprintf(probeResult, "zero=%ld,differ=%ld", zero, differ);
    probe("many", "20000", probeResult);

    {
        HGLOBAL one = LoadResource(instance, first);
        HGLOBAL two = LoadResource(instance, first);
        HGLOBAL three;
        HGLOBAL loaded;
        BYTE FAR *bytes;
        int freed;

        probe("load", "twice", one == two ? "same" : "differ");

        freed = FreeResource(two);
        bytes = (BYTE FAR *)LockResource(one);
        wsprintf(probeResult, "%s,%s", answer(freed, two),
                 (LPSTR)(bytes && bytes[0] == 'A' ? "kept" : "gone"));
        probe("free", "second", probeResult);

        if (bytes) {
            GlobalUnlock(one);
        }

        freed = FreeResource(one);
        three = LoadResource(instance, first);
        wsprintf(probeResult, "%s,%s", answer(freed, one), (LPSTR)(three == one ? "same" : "differ"));
        probe("free", "first", probeResult);
        FreeResource(three);

        zero = 0;
        differ = 0;
        loaded = LoadResource(instance, second);

        for (i = 0; i < 20000L; i++) {
            HGLOBAL again = LoadResource(instance, second);

            if (!again) {
                zero++;
            } else if (again != loaded) {
                differ++;
            }
        }

        wsprintf(probeResult, "zero=%ld,differ=%ld", zero, differ);
        probe("loads", "20000", probeResult);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
