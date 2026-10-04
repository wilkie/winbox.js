#!/usr/bin/env python3
"""
Clicks the left button at a point of Windows' screen, in DOSBox on an X
display: for a box of Windows' that takes no key -- one that has no focus,
as MCI's sequencer puts up -- which a person would click. See `runShooting`
in record.mjs.

    xclick.py :93 410,237

DOSBox moves Windows' pointer by the X pointer's motion, not to where the X
pointer is, and Windows makes a fast move faster; but a move of one pixel at
a time is a pixel. So the pointer is found on the screen -- two screens
taken a few pixels' move apart, and where they differ -- and moved there a
pixel at a time, found again, and the button pressed. The X pointer is kept
inside DOSBox's window, which is at the display's corner at 640 by 480: out
of it, DOSBox hears no motion.
"""

import ctypes
import os
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageChops

x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
xtst = ctypes.cdll.LoadLibrary('libXtst.so.6')

x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                      ctypes.c_ulong]
xtst.XTestFakeRelativeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                              ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

WIDTH, HEIGHT = 640, 480
NUDGE = 8


def screen(name):
    """The screen, as DOSBox shows it."""
    path = os.path.join(tempfile.gettempdir(), f'xclick-{os.getpid()}.png')
    subprocess.run(['import', '-display', name, '-window', 'root', '-crop',
                    f'{WIDTH}x{HEIGHT}+0+0', path], check=True)
    image = Image.open(path).convert('RGB')
    os.remove(path)
    return image


def step(display, dx, dy):
    """A move of a pixel at a time, which Windows does not make faster."""
    for i in range(max(abs(dx), abs(dy))):
        xtst.XTestFakeRelativeMotionEvent(display, (dx > 0) - (dx < 0) if i < abs(dx) else 0,
                                          (dy > 0) - (dy < 0) if i < abs(dy) else 0, 0)
        x11.XFlush(display)
        time.sleep(0.01)

    time.sleep(0.3)


def find(display, name):
    """Where Windows' pointer is: the top left of what moves with it."""
    before = screen(name)
    step(display, NUDGE, NUDGE)
    after = screen(name)
    step(display, -NUDGE, -NUDGE)
    box = ImageChops.difference(before, after).getbbox()

    if not box:
        sys.exit('xclick: the pointer could not be found')

    return box[0], box[1]


def main():
    name = sys.argv[1]
    x, y = map(int, sys.argv[2].split(','))
    display = x11.XOpenDisplay(name.encode())

    if not display:
        sys.exit(f'cannot open display {name}')

    for _ in range(4):
        at = find(display, name)
        dx, dy = x - at[0], y - at[1]

        if (dx, dy) == (0, 0):
            break

        # The X pointer put where the move has room inside DOSBox's window;
        # Windows' pointer moves with it, so it is found again.
        start = (min(max(WIDTH // 2 - dx // 2, NUDGE), WIDTH - NUDGE - 1),
                 min(max(HEIGHT // 2 - dy // 2, NUDGE), HEIGHT - NUDGE - 1))
        xtst.XTestFakeMotionEvent(display, -1, start[0], start[1], 0)
        x11.XFlush(display)
        time.sleep(0.3)
        at = find(display, name)
        step(display, x - at[0], y - at[1])
    else:
        sys.exit(f'xclick: the pointer did not come to {x},{y}')

    xtst.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.15)
    xtst.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    time.sleep(0.3)
    x11.XCloseDisplay(display)


main()
