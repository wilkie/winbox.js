/*
 * An installable driver that keeps a log of every call Windows makes to its
 * `DriverProc`, for `drvmsg.c` to read back: the identifier, the driver's
 * handle, the message and both parameters, what it answered, and for
 * `DRV_OPEN` the text its first parameter points to.
 *
 * Its answers are chosen so each can be told apart where it comes back:
 * `DRV_LOAD` and `DRV_ENABLE` 1, `DRV_OPEN` 101h, 102h... for each open, or
 * nought when the open's own parameter is DEADh, `DRV_CLOSE` 1,
 * `DRV_DISABLE` and `DRV_FREE` 1, and any other message the sum of its
 * parameters.
 *
 * The log is a file, `C:\ORACLE\DRVMSG.BIN`, an entry appended as each call
 * is made, so that it outlives the driver: a driver that has been freed can
 * hand nothing back.
 */

#include <windows.h>

#define LOG "C:\\ORACLE\\DRVMSG.BIN"

typedef struct {
    DWORD id;
    WORD driver;
    WORD message;
    LONG first;
    LONG second;
    LONG answer;
    char text[24];
} ENTRY;

static int opens;

static void append(ENTRY *entry)
{
    int file;

    /* Read and write: 2. */
    file = _lopen(LOG, 2);

    if (file == -1) {
        file = _lcreat(LOG, 0);
    }

    if (file == -1) {
        return;
    }

    _llseek(file, 0L, 2);
    _lwrite(file, (LPCSTR)(ENTRY FAR *)entry, sizeof(ENTRY));
    _lclose(file);
}

LONG FAR PASCAL _export DriverProc(DWORD id, HANDLE driver, WORD message, LONG first, LONG second)
{
    ENTRY entry;
    LONG answer;
    int index;

    switch (message) {
    case DRV_LOAD:
    case DRV_ENABLE:
    case DRV_CLOSE:
    case DRV_DISABLE:
    case DRV_FREE:
        answer = 1;
        break;

    case DRV_OPEN:
        answer = second == 0xdeadL ? 0 : 0x100 + ++opens;
        break;

    default:
        answer = first + second;
        break;
    }

    entry.id = id;
    entry.driver = (WORD)driver;
    entry.message = message;
    entry.first = first;
    entry.second = second;
    entry.answer = answer;
    entry.text[0] = '\0';

    if (message == DRV_OPEN && first) {
        LPCSTR from = (LPCSTR)first;

        for (index = 0; index < (int)sizeof(entry.text) - 1 && from[index]; index++) {
            entry.text[index] = from[index];
        }

        entry.text[index] = '\0';
    }

    append(&entry);

    return answer;
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}

int FAR PASCAL _export WEP(int exiting)
{
    (void)exiting;
    return 1;
}
