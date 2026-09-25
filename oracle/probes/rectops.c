/*
 * USER's rectangle arithmetic, at its edges.
 *
 * Each record is one call: its answer, then the rectangle it left, as
 * `left:top:right:bottom`.
 *
 * * `intersect`: overlapping, touching at an edge, apart, and with an empty
 *   rectangle.
 * * `union`: with and without an empty rectangle, and two empty ones.
 * * `subtract`: a rectangle cut by one covering its width, its height, its
 *   middle, and all of it.
 * * `empty`: `IsRectEmpty` of an ordinary, a flat and an inverted rectangle.
 * * `inflate`, `offset`: moved and grown, and shrunk past nothing.
 * * `equal`: `EqualRect` of the same, and of two empty ones that differ.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\RECTOPS.OUT"

static void result(LPCSTR function, LPCSTR args, int answer, const RECT FAR *rect)
{
    wsprintf(probeResult, "%d,%d:%d:%d:%d", answer, rect->left, rect->top, rect->right, rect->bottom);
    probe(function, args, probeResult);
}

static RECT rect(int left, int top, int right, int bottom)
{
    RECT r;

    SetRect(&r, left, top, right, bottom);
    return r;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    RECT a, b, out;
    int answer;

    probeOpen(OUTPUT);

    a = rect(0, 0, 10, 10);

    b = rect(5, 5, 15, 15);
    SetRect(&out, 7, 7, 7, 7);
    answer = IntersectRect(&out, &a, &b);
    result("intersect", "overlap", answer, &out);

    b = rect(10, 0, 20, 10);
    SetRect(&out, 7, 7, 7, 7);
    answer = IntersectRect(&out, &a, &b);
    result("intersect", "touching", answer, &out);

    b = rect(20, 20, 30, 30);
    SetRect(&out, 7, 7, 7, 7);
    answer = IntersectRect(&out, &a, &b);
    result("intersect", "apart", answer, &out);

    b = rect(3, 3, 3, 8);
    SetRect(&out, 7, 7, 7, 7);
    answer = IntersectRect(&out, &a, &b);
    result("intersect", "empty", answer, &out);

    b = rect(20, 20, 30, 30);
    answer = UnionRect(&out, &a, &b);
    result("union", "apart", answer, &out);

    b = rect(50, 50, 50, 60);
    answer = UnionRect(&out, &a, &b);
    result("union", "empty", answer, &out);

    b = rect(50, 50, 50, 60);
    SetRect(&out, 7, 7, 7, 7);
    {
        RECT c = rect(40, 40, 30, 50);

        answer = UnionRect(&out, &b, &c);
    }
    result("union", "both-empty", answer, &out);

    b = rect(-5, 4, 15, 20);
    answer = SubtractRect(&out, &a, &b);
    result("subtract", "width", answer, &out);

    b = rect(4, -5, 20, 15);
    answer = SubtractRect(&out, &a, &b);
    result("subtract", "height", answer, &out);

    b = rect(3, 3, 6, 6);
    answer = SubtractRect(&out, &a, &b);
    result("subtract", "middle", answer, &out);

    b = rect(-1, -1, 11, 11);
    answer = SubtractRect(&out, &a, &b);
    result("subtract", "all", answer, &out);

    result("empty", "ordinary", IsRectEmpty(&a), &a);
    b = rect(5, 5, 5, 9);
    result("empty", "flat", IsRectEmpty(&b), &b);
    b = rect(9, 9, 5, 5);
    result("empty", "inverted", IsRectEmpty(&b), &b);

    b = a;
    InflateRect(&b, 3, -2);
    result("inflate", "3,-2", 0, &b);
    b = a;
    InflateRect(&b, -7, -7);
    result("inflate", "-7,-7", 0, &b);
    b = a;
    OffsetRect(&b, -4, 6);
    result("offset", "-4,6", 0, &b);

    b = a;
    result("equal", "same", EqualRect(&a, &b), &b);
    {
        RECT c = rect(1, 1, 1, 1);
        RECT d = rect(2, 2, 2, 2);

        result("equal", "empties", EqualRect(&c, &d), &c);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
