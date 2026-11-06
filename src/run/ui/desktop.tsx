/**
 * The Windows screen's place. The engine puts its screen in it (`makeScreen`,
 * `screenNote` in `../engines/engine.ts`): the canvas, the host around it
 * that takes the keyboard (role `application`, "Windows desktop"), and the
 * mirror of USER's windows a screen reader reads (`../aria-mirror.ts`).
 * React renders the place and never what is in it; the canvas keeps its own
 * pixels, never themed.
 *
 * The canvas is drawn as large as its place allows, in the display's shape
 * (`../page/screen.ts`): the place is as wide as its column, as tall as the
 * display's shape makes it up to the window's height, and the canvas is
 * sized within it, centred, as each time the place is resized
 * (`ResizeObserver`) or the engine sizes its canvas afresh -- never per
 * frame. The canvas has no border nor padding, so its box is its pixels,
 * which the mouse is mapped through (`attachInput`): the bands beside it
 * shift nothing. Above it, how it is fitted, and the way to show it on the
 * whole screen.
 *
 * Beneath it, the way out for the keyboard (`../page/leave.ts`): Meta and
 * Escape take the focus to that line, from where Tab goes on through the
 * page -- and leave the whole screen, where it is shown on it.
 */

import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { start } from '../page/actions.js';
import { LEAVE_TEXT, leavesDesktop } from '../page/leave.js';
import {
  chooseScale,
  displayAspect,
  SCALES,
  type ScreenScale,
  screenBox,
  screenScale,
} from '../page/screen.js';

/** The canvas sized to its place, as the scale chosen has it. */
function fit(place: HTMLElement, scale: ScreenScale) {
  const canvas = place.querySelector<HTMLCanvasElement>('canvas.screen');

  if (!canvas || !canvas.width || !canvas.height) {
    return;
  }

  const screen = { width: canvas.width, height: canvas.height };
  const aspect = String(displayAspect(screen));

  if (place.style.getPropertyValue('--screen-aspect') !== aspect) {
    place.style.setProperty('--screen-aspect', aspect);
  }

  const style = getComputedStyle(place);
  const room = {
    width: place.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: place.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
  };
  const box = screenBox(scale, room, screen, devicePixelRatio || 1);

  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  canvas.style.imageRendering = box.rendering;
}

/** Whether the browser lets the page ask for the whole screen. */
const fullscreenOffered = () =>
  typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

export function Desktop() {
  const frame = useRef<HTMLDivElement>(null);
  const place = useRef<HTMLElement>(null);
  const way = useRef<HTMLParagraphElement>(null);
  const scale = useSyncExternalStore(screenScale.subscribe, screenScale.get);
  /* On the whole screen (the Fullscreen API's), or on the whole window (the page's own, where that is refused). */
  const [full, setFull] = useState<'screen' | 'window' | null>(null);
  /* Whether Escape is the page's on the whole screen (the Keyboard Lock API's), so that it is held to leave. */
  const [locked, setLocked] = useState(false);

  const leaveFull = useCallback(async () => {
    setFull(null);

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const desktop = place.current!;

    /* Taken as it goes down to the screen's host, before the host gives it to Windows. */
    const leave = (event: KeyboardEvent) => {
      if (leavesDesktop(event)) {
        event.preventDefault();
        event.stopPropagation();
        leaveFull();
        way.current?.focus();
      }
    };

    /* The host, each time the engine makes it, told where the way out is said,
     * and its canvas sized; and sized again whenever the engine sizes the canvas afresh. */
    const resized = new MutationObserver(() => fit(desktop, screenScale.get()));
    const made = new MutationObserver(() => {
      desktop.querySelector('.screen-host')?.setAttribute('aria-describedby', 'desktop-keys');
      resized.disconnect();

      const canvas = desktop.querySelector('canvas.screen');

      if (canvas) {
        resized.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
      }

      fit(desktop, screenScale.get());
    });
    const room = new ResizeObserver(() => fit(desktop, screenScale.get()));

    desktop.addEventListener('keydown', leave, true);
    made.observe(desktop, { childList: true });
    room.observe(desktop);
    start(desktop);
    desktop.querySelector('.screen-host')?.setAttribute('aria-describedby', 'desktop-keys');

    return () => {
      desktop.removeEventListener('keydown', leave, true);
      made.disconnect();
      resized.disconnect();
      room.disconnect();
    };
  }, [leaveFull]);

  /* Sized afresh as the choice changes. */
  useEffect(() => fit(place.current!, scale), [scale]);

  /* The whole screen left by the browser's own way (Escape held, F11): the page's state follows. */
  useEffect(() => {
    const changed = () => {
      if (!document.fullscreenElement) {
        setFull((was) => (was === 'screen' ? null : was));
        (navigator as any).keyboard?.unlock?.();
      }
    };

    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const enterFull = async () => {
    const host = place.current?.querySelector<HTMLElement>('.screen-host');

    if (fullscreenOffered()) {
      try {
        await frame.current!.requestFullscreen({ navigationUI: 'hide' });
        /* Escape is Windows' key: where the browser lets the page have it,
         * the whole screen is left by holding it, as the browser then says. */
        const lock = (navigator as any).keyboard?.lock;

        setLocked(
          lock
            ? await lock
                .call((navigator as any).keyboard, ['Escape'])
                .then(() => true)
                .catch(() => false)
            : false
        );
        setFull('screen');
        host?.focus();
        return;
      } catch {
        /* Refused (a frame without leave, say): the window, then. */
      }
    }

    setFull('window');
    host?.focus();
  };

  return (
    <Box component="main" id="main" tabIndex={-1} sx={{ minWidth: 0, outline: 'none' }}>
      <Box
        ref={frame}
        id="screen-frame"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          ...(full && {
            position: 'fixed',
            inset: 0,
            zIndex: 'modal',
            p: 1,
            bgcolor: 'background.default',
          }),
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          role="toolbar"
          aria-label="Screen"
        >
          <Typography component="label" htmlFor="screen-scale" variant="body2">
            Screen size
          </Typography>
          <NativeSelect
            value={scale}
            onChange={(event) => chooseScale(event.target.value as ScreenScale)}
            input={<OutlinedInput size="small" />}
            inputProps={{ id: 'screen-scale' }}
          >
            {SCALES.map((one) => (
              <option key={one.value} value={one.value}>
                {one.text}
              </option>
            ))}
          </NativeSelect>
          {full ? (
            <Button startIcon={<FullscreenExitIcon />} onClick={leaveFull}>
              Leave full screen
            </Button>
          ) : (
            <Button startIcon={<FullscreenIcon />} onClick={enterFull}>
              Full screen
            </Button>
          )}
        </Stack>
        <Box
          component="section"
          id="desktop"
          aria-label="Desktop"
          ref={place}
          sx={{
            position: 'relative',
            minHeight: 480,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
            '&:has(.screen)': full
              ? { minHeight: 0, flex: '1 1 auto', bgcolor: '#000' }
              : {
                  minHeight: 0,
                  aspectRatio: 'var(--screen-aspect, 4 / 3)',
                  maxHeight: 'calc(100dvh - 10rem)',
                  bgcolor: '#000',
                },
            '& .screen-note': { m: 2, typography: 'body2' },
            '& .screen-host': {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
            '& .screen-host:focus-visible': {
              outline: '3px solid',
              outlineColor: 'primary.main',
              outlineOffset: '-3px',
            },
            /* Read, not seen: the canvas is what is seen. */
            '& .aria-mirror': {
              position: 'absolute',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
              clipPath: 'inset(50%)',
              whiteSpace: 'nowrap',
            },
            /* No border nor padding: its box is its pixels, which the mouse is mapped through. */
            '& .screen': { display: 'block', flex: 'none', border: 0, p: 0, m: 0 },
          }}
        />
        <Typography
          id="desktop-keys"
          ref={way}
          tabIndex={-1}
          variant="body2"
          color="text.secondary"
          sx={{ '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
        >
          {LEAVE_TEXT}
          {full === 'screen' &&
            (locked
              ? " On the whole screen, Esc is Windows' too: hold it down to leave the whole screen."
              : ' On the whole screen, Esc leaves it.')}
        </Typography>
      </Box>
    </Box>
  );
}
