/*
 * Atoms: USER's global atom table, a program's own local one, and the
 * clipboard formats registered by name.
 *
 * An atom's number depends on where its string lands in the table's heap, so
 * the numbers themselves are not recorded -- only what they say of each other
 * and of the strings:
 *
 * * `global`, `local`: each step's answer, as a relation where it is an atom
 *   (`A1` for the first string's atom, `new` for one not seen before, `0`),
 *   and as it is otherwise. Where only the heap decides the number -- a
 *   string atom that may take a deleted one's place, a delete that fails --
 *   only its kind.
 * * `name`: what `GlobalGetAtomName` or `GetAtomName` copies, and answers.
 * * `format`: `RegisterClipboardFormat` beside `RegisterWindowMessage` and
 *   the global atoms, and `GetClipboardFormatName`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ATOMS.OUT"

static ATOM seen[16];
static int count;

/* An atom as a relation: 0, an integer atom as #n, one seen before as An, or
 * new -- then seen. Also whether a string atom is in C000h to FFFFh. */
static void describe(LPSTR out, ATOM atom)
{
    int index;

    if (atom == 0) {
        lstrcpy(out, "0");
        return;
    }

    if (atom < 0xC000) {
        wsprintf(out, "#%u", atom);
        return;
    }

    for (index = 0; index < count; index++) {
        if (seen[index] == atom) {
            wsprintf(out, "A%d", index + 1);
            return;
        }
    }

    seen[count++] = atom;
    wsprintf(out, "new=A%d", count);
}

static void record(LPCSTR function, LPCSTR step, ATOM atom)
{
    describe(probeResult, atom);
    probe(function, step, probeResult);
}

/* What an answer is, where its number would say only where the heap put it:
 * 0, an integer atom as #n, a string atom, or anything else nonzero. */
static void kind(LPCSTR function, LPCSTR step, ATOM atom)
{
    if (atom == 0) {
        lstrcpy(probeResult, "0");
    } else if (atom < 0xC000) {
        wsprintf(probeResult, "#%u", atom);
    } else {
        lstrcpy(probeResult, "string");
    }

    probe(function, step, probeResult);
}

static void named(LPCSTR step, UINT answer, LPCSTR buffer)
{
    wsprintf(probeResult, "%u,%s", answer, buffer);
    probe("name", step, probeResult);
}

static void globals(void)
{
    char buffer[300];
    char text[300];
    ATOM one;
    int index;

    one = GlobalAddAtom("WinboxAtomOne");
    record("global", "add", one);
    record("global", "add-again-lower", GlobalAddAtom("winboxatomone"));
    record("global", "add-other", GlobalAddAtom("WinboxAtomTwo"));
    record("global", "find-upper", GlobalFindAtom("WINBOXATOMONE"));
    record("global", "find-missing", GlobalFindAtom("WinboxAtomNone"));

    named("global-name", GlobalGetAtomName(one, buffer, sizeof(buffer)), buffer);
    lstrcpy(buffer, "xxxxxxxx");
    named("global-name-short", GlobalGetAtomName(one, buffer, 4), buffer);
    lstrcpy(buffer, "xxxxxxxx");
    named("global-name-zero", GlobalGetAtomName(one, buffer, 0), buffer);

    /* Added twice: the first delete leaves it. */
    record("global", "delete-1", GlobalDeleteAtom(one));
    record("global", "find-after-1", GlobalFindAtom("WinboxAtomOne"));
    record("global", "delete-2", GlobalDeleteAtom(one));
    record("global", "find-after-2", GlobalFindAtom("WinboxAtomOne"));
    record("global", "delete-3", GlobalDeleteAtom(one));
    lstrcpy(buffer, "xxxxxxxx");
    named("global-name-deleted", GlobalGetAtomName(one, buffer, sizeof(buffer)), buffer);

    /* Integer atoms, by string and by number. */
    record("global", "int-string", GlobalAddAtom("#1234"));
    record("global", "int-make", GlobalAddAtom(MAKEINTATOM(77)));
    record("global", "int-find", GlobalFindAtom("#1234"));
    record("global", "int-find-make", GlobalFindAtom(MAKEINTATOM(1234)));
    record("global", "int-zero", GlobalAddAtom("#0"));
    record("global", "int-c000", GlobalAddAtom("#49152"));
    record("global", "int-bffff", GlobalAddAtom("#49151"));
    record("global", "int-leading-zero", GlobalAddAtom("#0012"));
    kind("global", "int-sign", GlobalAddAtom("#-5"));
    kind("global", "int-letters", GlobalAddAtom("#12ab"));
    record("global", "int-delete", GlobalDeleteAtom(1234));
    named("global-name-int", GlobalGetAtomName(1234, buffer, sizeof(buffer)), buffer);
    named("global-name-int77", GlobalGetAtomName(77, buffer, sizeof(buffer)), buffer);

    record("global", "empty", GlobalAddAtom(""));
    record("global", "hash-only", GlobalAddAtom("#"));

    /* The longest string an atom takes. */
    for (index = 0; index < 255; index++) {
        text[index] = 'a' + index % 26;
    }

    text[255] = '\0';
    record("global", "long-255", GlobalAddAtom(text));
    named("global-name-255", GlobalGetAtomName(GlobalFindAtom(text), buffer, sizeof(buffer)),
          lstrlen(buffer) == 255 ? "all" : buffer);
    text[255] = 'z';
    text[256] = '\0';
    record("global", "long-256", GlobalAddAtom(text));
}

static void locals(void)
{
    char buffer[64];
    ATOM one;

    record("local", "add", one = AddAtom("WinboxLocalOne"));
    record("local", "add-again-upper", AddAtom("WINBOXLOCALONE"));
    record("local", "find", FindAtom("winboxlocalone"));
    record("local", "global-find", GlobalFindAtom("WinboxLocalOne"));
    named("local-name", GetAtomName(one, buffer, sizeof(buffer)), buffer);
    record("local", "delete-1", DeleteAtom(one));
    record("local", "delete-2", DeleteAtom(one));
    record("local", "find-after", FindAtom("WinboxLocalOne"));
    probe("local", "delete-3", DeleteAtom(one) ? "nonzero" : "0");
    record("local", "int", AddAtom("#300"));
    named("local-name-int", GetAtomName(300, buffer, sizeof(buffer)), buffer);
}

static void formats(void)
{
    char buffer[64];
    UINT format;
    UINT message;

    format = RegisterClipboardFormat("WinboxFormat");
    message = RegisterWindowMessage("WinboxFormat");
    wsprintf(probeResult, "%s", (LPSTR)(format >= 0xC000 ? "C000+" : "low"));
    probe("format", "register", probeResult);
    probe("format", "same-as-message", format == message ? "yes" : "no");
    probe("format", "again-upper",
          RegisterClipboardFormat("WINBOXFORMAT") == format ? "same" : "different");
    record("format", "global-find", GlobalFindAtom("WinboxFormat"));
    wsprintf(probeResult, "%d,%s", GetClipboardFormatName(format, buffer, sizeof(buffer)),
             (LPSTR)buffer);
    probe("format", "name", probeResult);
    wsprintf(probeResult, "%d", GetClipboardFormatName(CF_TEXT, buffer, sizeof(buffer)));
    probe("format", "name-cf-text", probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    globals();
    locals();
    formats();

    probeFinish();

    return 0;
}
