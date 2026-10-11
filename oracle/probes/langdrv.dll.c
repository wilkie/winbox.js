/*
 * A language driver for `langdrv.c`: the procedure USER finds by ordinal 1
 * (`USER.EXE` seg3 `1f87`) and calls in place of its own string functions
 * while the driver is loaded (seg11), given the function's number, a word
 * and a far pointer: 1 for `lstrcmp` (the word 0) and `lstrcmpi` (1), the
 * pointer to the caller's two pointers as they are on its stack, the
 * second string's first; 2 and 3 for `AnsiUpper` and `AnsiLower`, the
 * pointer their argument; 4 and 5 for `AnsiUpperBuff` and `AnsiLowerBuff`,
 * the word the length and the pointer the buffer; 6 to 9 for
 * `IsCharAlpha`, `IsCharAlphaNumeric`, `IsCharUpper` and `IsCharLower`, the
 * word the character and the pointer null.
 *
 * Each call is written down -- the number, the word and what the pointer
 * shows: the two strings for 1, `s:` and the text where the pointer has a
 * selector, `c:` and the offset where it has none -- for `LangLog` to hand
 * back. The answers are made to be told apart: 1, 40 and the word; 2 to
 * 5, the text's first character made the number's digit, and the pointer
 * with the number added to its offset (2 and 3), or 100 and the word (4
 * and 5); 6 to 9, a hundred times the number and the word.
 */

#include <windows.h>

static char log[600];

static void add(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) + 2 < sizeof(log)) {
        if (log[0]) {
            lstrcat(log, "|");
        }

        lstrcat(log, text);
    }
}

LONG FAR PASCAL _export LangProc(WORD function, WORD word, LPVOID pointer)
{
    char line[120];

    if (function == 1) {
        LPSTR FAR *strings = (LPSTR FAR *)pointer;

        wsprintf(line, "%u,%u,%s/%s", function, word, strings[1], strings[0]);
        add(line);
        return 40 + word;
    }

    if (HIWORD((DWORD)pointer)) {
        wsprintf(line, "%u,%u,s:%s", function, word, (LPSTR)pointer);
    } else {
        wsprintf(line, "%u,%u,c:%u", function, word, LOWORD((DWORD)pointer));
    }

    add(line);

    if (function >= 2 && function <= 5) {
        if (HIWORD((DWORD)pointer)) {
            *(LPSTR)pointer = (char)('0' + function);
        }

        if (function <= 3) {
            return (LONG)(DWORD)pointer + function;
        }

        return 100 + word;
    }

    return 100L * function + word;
}

/* The calls written down since last asked, and forgotten. */
void FAR PASCAL _export LangLog(LPSTR out)
{
    lstrcpy(out, log[0] ? log : "none");
    log[0] = '\0';
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}
