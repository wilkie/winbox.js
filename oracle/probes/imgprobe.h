/*
 * What the image probes (`imgflop`, `imgcd`, `imghdd`) ask of a drive that
 * is a disk or disc image (`<probe>.mounts`): its folders as DOS lists
 * them, each file found by the name listed and read, attributes and stamps,
 * its room, its label, how its IOCTL and `GetDriveType` answer, and what
 * becomes of writing to it.
 *
 * Records, each a function, its args and its result:
 *
 * * `entry` `<folder> <n>`: the n-th entry FindFirst (4Eh) and FindNext
 *   (4Fh) give for `*.*` with hidden, system, read-only and folders asked
 *   for: its name, attributes, size, date and time, in hexadecimal; and
 *   `<folder> end`, how many, and the error that ended the search.
 * * `label`: FindFirst of `*.*` with the volume label's attribute alone
 *   (08h): the entry, or the error.
 * * `match` `<pattern> <attributes>`: the names a search gives, joined by
 *   commas, or the error.
 * * `read` `<path>`: each file the listings gave, opened by the name given
 *   (3Dh), its size by seeking to its end, its first 16 bytes in
 *   hexadecimal, and 5700h's date and time; or the error.
 * * `open` `<path>`: a file opened by another spelling, its size or the
 *   error.
 * * `attr` `<path>`: 4300h's attributes, or the error.
 * * `space`: AX, BX, CX and DX after 36h for the drive.
 * * `ioctl` `<call>`: as `drvioctl` records them, for the drive; `type`,
 *   `GetDriveType`.
 * * `write` `<what>`: a file made (3Ch) and written, a folder made (39h),
 *   a file renamed (56h) and deleted (41h): nought, or the error; and the
 *   listing and room after, as `entry` and `space`, under `after`.
 */

#ifndef IMGPROBE_H
#define IMGPROBE_H

#include <dos.h>
#include <direct.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>

#include "regcall.h"

#define FIND_ALL (_A_HIDDEN | _A_SYSTEM | _A_SUBDIR | _A_RDONLY | _A_ARCH)

/* Every file the listings gave, by its path, to be read after. */
#define FILES 32
static char files[FILES][80];
static unsigned fileCount;

static char text[1024];

static void hex(char *into, const unsigned char far *bytes, unsigned count)
{
    unsigned i;

    for (i = 0; i < count; i++) {
        wsprintf(into + i * 2, "%02x", bytes[i]);
    }

    into[count * 2] = '\0';
}

/* A folder's listing, an entry a record; its files kept to be read, and
 * its folders other than `.` and `..` listed after it. */
static void listFolder(LPCSTR function, LPCSTR folder, int keep)
{
    struct find_t found;
    char pattern[80];
    char folders[8][80];
    unsigned folderCount = 0;
    unsigned done;
    unsigned n = 0;
    unsigned i;

    wsprintf(pattern, "%s\\*.*", folder);

    for (done = _dos_findfirst(pattern, FIND_ALL, &found); done == 0;
         done = _dos_findnext(&found)) {
        wsprintf(probeArgs, "%s %u", folder, n++);
        wsprintf(probeResult, "%s %02x %lx %04x %04x", (LPSTR)found.name, found.attrib,
                 found.size, found.wr_date, found.wr_time);
        probe(function, probeArgs, probeResult);

        if (found.name[0] == '.') {
            continue;
        }

        if (found.attrib & _A_SUBDIR) {
            if (folderCount < 8) {
                wsprintf(folders[folderCount++], "%s\\%s", folder, (LPSTR)found.name);
            }
        } else if (keep && fileCount < FILES) {
            wsprintf(files[fileCount++], "%s\\%s", folder, (LPSTR)found.name);
        }
    }

    wsprintf(probeArgs, "%s end", folder);
    wsprintf(probeResult, "%u %u", n, done);
    probe(function, probeArgs, probeResult);

    for (i = 0; i < folderCount; i++) {
        listFolder(function, folders[i], keep);
    }
}

static void label(LPCSTR drive)
{
    struct find_t found;
    char pattern[16];
    unsigned done;

    wsprintf(pattern, "%s\\*.*", drive);
    done = _dos_findfirst(pattern, _A_VOLID, &found);

    if (done) {
        wsprintf(probeResult, "error %u", done);
    } else {
        wsprintf(probeResult, "%s %02x %lx %04x %04x", (LPSTR)found.name, found.attrib,
                 found.size, found.wr_date, found.wr_time);
    }

    probe("label", pattern, probeResult);
}

static void match(LPCSTR pattern, unsigned attributes)
{
    struct find_t found;
    unsigned done;

    text[0] = '\0';

    for (done = _dos_findfirst(pattern, attributes, &found); done == 0;
         done = _dos_findnext(&found)) {
        if (lstrlen(text) + 14 < sizeof text) {
            if (text[0]) {
                lstrcat(text, ",");
            }

            lstrcat(text, found.name);
        }
    }

    if (!text[0]) {
        wsprintf(text, "error %u", done);
    }

    wsprintf(probeArgs, "%s %02x", pattern, attributes);
    probe("match", probeArgs, text);
}

static void readFile(LPCSTR path)
{
    unsigned char bytes[16];
    unsigned date;
    unsigned time;
    unsigned got;
    long size;
    int handle;
    unsigned error = _dos_open(path, 0, &handle);

    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        size = lseek(handle, 0L, SEEK_END);
        lseek(handle, 0L, SEEK_SET);
        got = 0;
        _dos_read(handle, (void far *)bytes, sizeof bytes, &got);
        _dos_getftime(handle, &date, &time);
        _dos_close(handle);
        hex(text, bytes, got);
        wsprintf(probeResult, "%ld %s %04x %04x", size, (LPSTR)text, date, time);
    }

    probe("read", path, probeResult);
}

static void openAs(LPCSTR path)
{
    int handle;
    long size;
    unsigned error = _dos_open(path, 0, &handle);

    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        size = lseek(handle, 0L, SEEK_END);
        _dos_close(handle);
        wsprintf(probeResult, "%ld", size);
    }

    probe("open", path, probeResult);
}

static void attr(LPCSTR path)
{
    unsigned attributes;
    unsigned error = _dos_getfileattr(path, &attributes);

    if (error) {
        wsprintf(probeResult, "error %u", error);
    } else {
        wsprintf(probeResult, "%02x", attributes);
    }

    probe("attr", path, probeResult);
}

static void space(LPCSTR function, unsigned drive)
{
    regs.ax = 0x3600;
    regs.bx = 0x0b0b;
    regs.cx = 0x0c0c;
    regs.dx = drive;
    regs.ds = 0;
    call21();
    regsText(probeResult);
    probe(function, "36", probeResult);
}

static unsigned char ioBuffer[40];

static void ioctl(unsigned function, unsigned code, unsigned drive)
{
    unsigned char far *at = ioBuffer;
    unsigned i;

    for (i = 0; i < sizeof ioBuffer; i++) {
        ioBuffer[i] = 0xcc;
    }

    regs.ax = function;
    regs.bx = drive;
    regs.cx = code ? code : 0x0c0c;
    regs.dx = code ? (unsigned)(unsigned long)at : 0x0d0d;
    regs.ds = code ? (unsigned)((unsigned long)at >> 16) : 0;
    call21();
    regsText(probeResult);

    if (code) {
        lstrcat(probeResult, " ");
        hex(probeResult + lstrlen(probeResult), ioBuffer, sizeof ioBuffer);
        wsprintf(probeArgs, "%04x %04x", function, code);
    } else {
        wsprintf(probeArgs, "%04x", function);
    }

    probe("ioctl", probeArgs, probeResult);
}

/* IOCTL and `GetDriveType` for a drive, 1 for A:. */
static void ioctls(unsigned drive)
{
    ioctl(0x4408, 0, drive);
    ioctl(0x4409, 0, drive);
    ioctl(0x440d, 0x0860, drive);
    ioctl(0x440e, 0, drive);
    wsprintf(probeResult, "%u", GetDriveType(drive - 1));
    probe("ioctl", "type", probeResult);
}

/* Every file the listings gave, read by the name given. */
static void readAll(void)
{
    unsigned i;

    for (i = 0; i < fileCount; i++) {
        readFile(files[i]);
    }
}

static void result(LPCSTR what, unsigned error)
{
    wsprintf(probeResult, "%u", error);
    probe("write", what, probeResult);
}

/* A file made, written and closed; a folder made; the file renamed and
 * another deleted; then the drive listed again, and its room. */
static void writes(LPCSTR drive, unsigned number, LPCSTR victim)
{
    char path[80];
    char to[80];
    int handle;
    unsigned wrote = 0;
    unsigned error;

    wsprintf(path, "%s\\NEW.TXT", drive);
    error = _dos_creat(path, _A_NORMAL, &handle);
    result("create", error);

    if (!error) {
        result("write", _dos_write(handle, (void far *)"written\r\n", 9, &wrote));
        wsprintf(probeResult, "%u", wrote);
        probe("write", "wrote", probeResult);
        result("close", _dos_close(handle));
    }

    wsprintf(path, "%s\\NEWDIR", drive);
    result("mkdir", mkdir(path) ? (unsigned)_doserrno : 0);

    wsprintf(path, "%s\\NEW.TXT", drive);
    wsprintf(to, "%s\\RENAMED.TXT", drive);
    result("rename", rename(path, to) ? (unsigned)_doserrno : 0);

    wsprintf(path, "%s\\%s", drive, victim);
    result("delete", remove(path) ? (unsigned)_doserrno : 0);

    listFolder("after", drive, 0);
    space("after", number);
}

#endif
