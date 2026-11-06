/**
 * The Windows screen's place. The engine puts its screen in it (`makeScreen`,
 * `screenNote` in `../engines/engine.ts`): the canvas, the host around it
 * that takes the keyboard (role `application`, "Windows desktop"), and the
 * mirror of USER's windows a screen reader reads (`../aria-mirror.ts`).
 * React renders the place and never what is in it; the canvas keeps its own
 * pixels, drawn crisp, never themed.
 *
 * Beneath it, the way out for the keyboard (`../page/leave.ts`): Meta and
 * Escape take the focus to that line, from where Tab goes on through the
 * page.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';
import { start } from '../page/actions.js';
import { LEAVE_TEXT, leavesDesktop } from '../page/leave.js';

export function Desktop() {
  const place = useRef<HTMLElement>(null);
  const way = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const desktop = place.current!;

    /* Taken as it goes down to the screen's host, before the host gives it to Windows. */
    const leave = (event: KeyboardEvent) => {
      if (leavesDesktop(event)) {
        event.preventDefault();
        event.stopPropagation();
        way.current?.focus();
      }
    };

    /* The host, each time the engine makes it, told where the way out is said. */
    const describe = () =>
      desktop.querySelector('.screen-host')?.setAttribute('aria-describedby', 'desktop-keys');
    const made = new MutationObserver(describe);

    desktop.addEventListener('keydown', leave, true);
    made.observe(desktop, { childList: true });
    start(desktop);
    describe();

    return () => {
      desktop.removeEventListener('keydown', leave, true);
      made.disconnect();
    };
  }, []);

  return (
    <Box component="main" id="main" tabIndex={-1} sx={{ minWidth: 0, outline: 'none' }}>
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
          '&:has(.screen)': { minHeight: 0 },
          '& .screen-note': { m: 2, typography: 'body2' },
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
          '& .screen': { display: 'block', maxWidth: '100%', imageRendering: 'pixelated' },
        }}
      />
      <Typography
        id="desktop-keys"
        ref={way}
        tabIndex={-1}
        variant="body2"
        color="text.secondary"
        sx={{ mt: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
      >
        {LEAVE_TEXT}
      </Typography>
    </Box>
  );
}
