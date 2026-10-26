/*
 * What `visrgn` and `visfam` share: GDI's visible-region calls, got by
 * ordinal, and two ways of writing a set of pixels down as text.
 *
 * A set of pixels is written as bands: `top-bottom:left-right,left-right;`
 * for each run of rows whose runs of columns are alike, the bottom and right
 * edges outside, as a region's are. Nothing is `-`.
 */

#ifndef VISPROBE_H
#define VISPROBE_H

typedef int(FAR PASCAL *SELECTVISRGNPROC)(HDC, HRGN);
typedef int(FAR PASCAL *VISRECTPROC)(HDC, int, int, int, int);
typedef int(FAR PASCAL *OFFSETVISRGNPROC)(HDC, int, int);
typedef HRGN(FAR PASCAL *SAVEVISRGNPROC)(HDC);
typedef int(FAR PASCAL *RESTOREVISRGNPROC)(HDC);
typedef HRGN(FAR PASCAL *INQUIREVISRGNPROC)(HDC);
typedef DWORD(FAR PASCAL *SETDCORGPROC)(HDC, int, int);
typedef HDC(FAR PASCAL *GETDCSTATEPROC)(HDC);
typedef void(FAR PASCAL *SETDCSTATEPROC)(HDC, HDC);
typedef BOOL(FAR PASCAL *FASTWINDOWFRAMEPROC)(HDC, LPRECT, int, int, DWORD);
typedef UINT(FAR PASCAL *SETHOOKFLAGSPROC)(HDC, UINT);
typedef HRGN(FAR PASCAL *GETCLIPRGNPROC)(HDC);
typedef HDC(FAR PASCAL *GETDCEXPROC)(HWND, HRGN, DWORD);

static SELECTVISRGNPROC pSelectVisRgn;
static VISRECTPROC pIntersectVisRect;
static VISRECTPROC pExcludeVisRect;
static OFFSETVISRGNPROC pOffsetVisRgn;
static SAVEVISRGNPROC pSaveVisRgn;
static RESTOREVISRGNPROC pRestoreVisRgn;
static INQUIREVISRGNPROC pInquireVisRgn;
static SETDCORGPROC pSetDCOrg;
static GETDCSTATEPROC pGetDCState;
static SETDCSTATEPROC pSetDCState;
static FASTWINDOWFRAMEPROC pFastWindowFrame;
static SETHOOKFLAGSPROC pSetHookFlags;
static GETCLIPRGNPROC pGetClipRgn;
static GETDCEXPROC pGetDCEx;

static FARPROC gdiOrdinal(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static void visImports(void)
{
    pExcludeVisRect = (VISRECTPROC)gdiOrdinal(73);
    pIntersectVisRect = (VISRECTPROC)gdiOrdinal(98);
    pOffsetVisRgn = (OFFSETVISRGNPROC)gdiOrdinal(102);
    pSelectVisRgn = (SELECTVISRGNPROC)gdiOrdinal(105);
    pSetDCOrg = (SETDCORGPROC)gdiOrdinal(117);
    pSaveVisRgn = (SAVEVISRGNPROC)gdiOrdinal(129);
    pRestoreVisRgn = (RESTOREVISRGNPROC)gdiOrdinal(130);
    pInquireVisRgn = (INQUIREVISRGNPROC)gdiOrdinal(131);
    pGetClipRgn = (GETCLIPRGNPROC)gdiOrdinal(173);
    pGetDCState = (GETDCSTATEPROC)gdiOrdinal(179);
    pSetDCState = (SETDCSTATEPROC)gdiOrdinal(180);
    pSetHookFlags = (SETHOOKFLAGSPROC)gdiOrdinal(192);
    pFastWindowFrame = (FASTWINDOWFRAMEPROC)gdiOrdinal(400);
    pGetDCEx = (GETDCEXPROC)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(359));
}

#define MAXRUNS 24

static int bandRuns[2][MAXRUNS * 2];
static int bandCount[2];
static char *bandAt;
static int bandTop;

/* Writes the band that ends at `bottom`, if it has any runs. */
static void bandFlush(int which, int bottom)
{
    int i;

    if (bandTop < 0 || !bandCount[which]) {
        return;
    }

    bandAt += wsprintf(bandAt, "%d-%d:", bandTop, bottom);

    for (i = 0; i < bandCount[which]; i++) {
        bandAt += wsprintf(bandAt, "%s%d-%d", i ? "," : "", bandRuns[which][i * 2],
                           bandRuns[which][i * 2 + 1]);
    }

    *bandAt++ = ';';
    *bandAt = '\0';
}

typedef BOOL (*PIXELTEST)(int x, int y);

/* The pixels of a rectangle that pass `test`, as bands, into `out`. */
static void bandsOf(LPSTR out, int left, int top, int right, int bottom, PIXELTEST test)
{
    int y;
    int x;
    int now = 0;

    bandAt = out;
    *bandAt = '\0';
    bandTop = -1;
    bandCount[0] = bandCount[1] = 0;

    for (y = top; y < bottom; y++) {
        int next = 1 - now;
        int n = 0;
        int start = -1;
        BOOL same;
        int i;

        for (x = left; x <= right; x++) {
            BOOL in = x < right && test(x, y);

            if (in && start < 0) {
                start = x;
            } else if (!in && start >= 0) {
                if (n < MAXRUNS) {
                    bandRuns[next][n * 2] = start;
                    bandRuns[next][n * 2 + 1] = x;
                    n++;
                }
                start = -1;
            }
        }

        bandCount[next] = n;
        same = bandTop >= 0 && n == bandCount[now];

        for (i = 0; same && i < n * 2; i++) {
            same = bandRuns[next][i] == bandRuns[now][i];
        }

        if (!same) {
            bandFlush(now, y);
            bandTop = n ? y : -1;
        }

        if (bandTop < 0 && n) {
            bandTop = y;
        }

        now = next;
    }

    bandFlush(now, bottom);

    if (bandAt == out) {
        lstrcpy(out, "-");
    }
}

static HRGN bandRegion;
static HDC bandScreen;

static BOOL inBandRegion(int x, int y)
{
    return PtInRegion(bandRegion, x, y);
}

static BOOL blackOnScreen(int x, int y)
{
    return GetPixel(bandScreen, x, y) == RGB(0, 0, 0);
}

/* A region's kind, box and bands. */
static void regionText(LPSTR out, HRGN region)
{
    RECT box;
    int kind;
    LPSTR at;

    if (!region) {
        lstrcpy(out, "none");
        return;
    }

    kind = GetRgnBox(region, &box);
    at = out + wsprintf(out, "%d %d,%d,%d,%d ", kind, box.left, box.top, box.right, box.bottom);
    bandRegion = region;
    bandsOf(at, box.left, box.top, box.right, box.bottom, inBandRegion);
}

/* Where the screen is black within a rectangle, as bands. */
static void blackText(LPSTR out, int left, int top, int right, int bottom)
{
    bandScreen = GetDC(NULL);
    bandsOf(out, left, top, right, bottom, blackOnScreen);
    ReleaseDC(NULL, bandScreen);
}

/* Whitens a rectangle of the screen, through the screen's own context. */
static void whiten(int left, int top, int right, int bottom)
{
    HDC screen = GetDC(NULL);

    PatBlt(screen, left, top, right - left, bottom - top, WHITENESS);
    ReleaseDC(NULL, screen);
}

/* A device context's origin, clip box and visible region, as one line. */
static void dcText(LPSTR out, HDC dc)
{
    RECT box;
    int kind;
    DWORD origin;
    LPSTR at;

    if (!dc) {
        lstrcpy(out, "null");
        return;
    }

    origin = GetDCOrg(dc);
    kind = GetClipBox(dc, &box);
    at = out + wsprintf(out, "org %d,%d clip %d %d,%d,%d,%d vis ", (int)LOWORD(origin),
                        (int)HIWORD(origin), kind, box.left, box.top, box.right, box.bottom);
    regionText(at, pInquireVisRgn(dc));
}

#endif
