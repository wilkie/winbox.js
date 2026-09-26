/*
 * The registration database, through SHELL's calls: keys opened, made,
 * enumerated, given values, read and deleted, and what each call answers.
 *
 * The probe works on the installation's own `REG.DAT` (a scratch copy), under
 * `HKEY_CLASSES_ROOT`, and cleans up the key it makes.
 *
 * Records:
 *
 * * `enum`: `RegEnumKey` of the classes root at each index until it fails:
 *   the answer and the name.
 * * `query`: `RegQueryValue` of a path, with a buffer size: the answer, the
 *   size it wrote back, and the text.
 * * `answer`: what a call answered.
 */

#include "probe.h"
#include <shellapi.h>

#define OUTPUT "C:\\ORACLE\\REGISTRY.OUT"

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%ld", value);
    probe("answer", what, probeResult);
}

static void query(HKEY key, LPCSTR name, LPCSTR path, LONG size)
{
    char buffer[80];
    LONG cb = size;
    LONG result;
    int index;

    for (index = 0; index < (int)sizeof(buffer); index++) {
        buffer[index] = '#';
    }

    buffer[sizeof(buffer) - 1] = '\0';
    result = RegQueryValue(key, path, buffer, &cb);
    buffer[40] = '\0';
    wsprintf(probeArgs, "%s,%s,%ld", name, path ? (*path ? path : "(empty)") : "NULL", size);
    wsprintf(probeResult, "%ld,cb=%ld,text=%s", result, cb, (LPSTR)buffer);
    probe("query", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HKEY key;
    HKEY made;
    HKEY again;
    char name[80];
    LONG result;
    DWORD index;

    probeOpen(OUTPUT);

    /* Every key under the classes root, in the order enumerated, and past it. */
    for (index = 0; index < 64; index++) {
        name[0] = '\0';
        result = RegEnumKey(HKEY_CLASSES_ROOT, index, name, sizeof(name));
        wsprintf(probeArgs, "%ld", index);
        wsprintf(probeResult, "%ld,%s", result, (LPSTR)name);
        probe("enum", probeArgs, probeResult);

        if (result != ERROR_SUCCESS) {
            break;
        }
    }

    /* Values, whole, cut short and with no room. */
    query(HKEY_CLASSES_ROOT, "root", ".txt", 80);
    query(HKEY_CLASSES_ROOT, "root", ".TXT", 80);
    query(HKEY_CLASSES_ROOT, "root", ".txt", 4);
    query(HKEY_CLASSES_ROOT, "root", ".txt", 1);
    query(HKEY_CLASSES_ROOT, "root", "txtfile\\shell\\open\\command", 80);
    query(HKEY_CLASSES_ROOT, "root", "txtfile\\shell", 80);
    query(HKEY_CLASSES_ROOT, "root", "nothing", 80);
    query(HKEY_CLASSES_ROOT, "root", "txtfile\\", 80);
    query(HKEY_CLASSES_ROOT, "root", "", 80);
    query(HKEY_CLASSES_ROOT, "root", NULL, 80);

    /* A key opened, and read through its handle. */
    answer("open-txtfile", RegOpenKey(HKEY_CLASSES_ROOT, "txtfile", &key));
    query(key, "txtfile", "shell\\print\\command", 80);
    query(key, "txtfile", NULL, 80);
    answer("open-missing", RegOpenKey(HKEY_CLASSES_ROOT, "nothing", &again));

    /* Its children, in order. */
    for (index = 0; index < 8; index++) {
        name[0] = '\0';
        result = RegEnumKey(key, index, name, sizeof(name));
        wsprintf(probeArgs, "txtfile,%ld", index);
        wsprintf(probeResult, "%ld,%s", result, (LPSTR)name);
        probe("enum", probeArgs, probeResult);

        if (result != ERROR_SUCCESS) {
            break;
        }
    }

    answer("close-txtfile", RegCloseKey(key));

    /* A key made, given values, read, and taken away again. */
    answer("create", RegCreateKey(HKEY_CLASSES_ROOT, "ProbeKey\\Sub", &made));
    answer("set", RegSetValue(made, NULL, REG_SZ, "Probe value", 11));
    answer("set-type", RegSetValue(made, NULL, 7, "Other", 5));
    answer("set-path", RegSetValue(HKEY_CLASSES_ROOT, "ProbeKey\\Other", REG_SZ, "Second", 6));
    query(HKEY_CLASSES_ROOT, "made", "ProbeKey\\Sub", 80);
    query(HKEY_CLASSES_ROOT, "made", "probekey\\other", 80);
    answer("set-empty", RegSetValue(made, NULL, REG_SZ, "", 0));
    query(HKEY_CLASSES_ROOT, "emptied", "ProbeKey\\Sub", 80);

    for (index = 0; index < 4; index++) {
        name[0] = '\0';
        result = RegEnumKey(HKEY_CLASSES_ROOT, index, name, sizeof(name));
        wsprintf(probeArgs, "after,%ld", index);
        wsprintf(probeResult, "%ld,%s", result, (LPSTR)name);
        probe("enum", probeArgs, probeResult);
    }

    answer("close-made", RegCloseKey(made));
    answer("delete", RegDeleteKey(HKEY_CLASSES_ROOT, "ProbeKey"));
    answer("delete-again", RegDeleteKey(HKEY_CLASSES_ROOT, "ProbeKey"));
    answer("delete-empty", RegDeleteKey(HKEY_CLASSES_ROOT, ""));
    query(HKEY_CLASSES_ROOT, "deleted", "ProbeKey\\Sub", 80);

    /* A close with nothing open. */
    answer("close-none", RegCloseKey(HKEY_CLASSES_ROOT));

    probeFinish();

    return 0;
}
