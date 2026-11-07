/**
 * The page's banner: its one first-level heading, the launcher's menu
 * button beside it (`launcher.tsx`) -- in the banner, so that it is in the
 * same place, the first control after the skip link, at every width and
 * whatever the side shows, as a host's own start menu is -- the engine
 * running with the way to the other, and the status line.
 *
 * The status line is a live region: polite for what the page tells, and
 * assertive for an error. Its words are written into it as each line is
 * told, not rendered by React, so that a line told again is announced again,
 * and each line arrives as a node of its own, as it always has (what an
 * observer of the line, `e2e/run.spec.ts`'s among them, reads).
 */

import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useLayoutEffect, useRef } from 'react';
import { actions } from '../page/actions.js';
import { type PageView } from '../page/view.js';
import { Launcher } from './launcher.js';
import { useStatusLine } from './use.js';

function StatusLine() {
  const line = useStatusLine();
  const place = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = place.current!;

    /* Its liveness set before its words, for the words to be told with it. */
    element.setAttribute('aria-live', line.kind === 'error' ? 'assertive' : 'polite');
    element.dataset.kind = line.kind;
    element.textContent = line.message;
  }, [line]);

  return (
    <Box
      id="status"
      role="status"
      aria-live="polite"
      ref={place}
      sx={(theme) => ({
        typography: 'body2',
        color: 'text.secondary',
        '&[data-kind="error"]': {
          color: 'error.dark',
          border: 1,
          borderColor: 'currentColor',
          borderRadius: 1,
          px: 1,
          ...theme.applyStyles('dark', { color: 'error.light' }),
        },
      })}
    />
  );
}

export function Header({ view }: { view: PageView | null }) {
  const engine = view?.engine;

  return (
    <AppBar
      component="header"
      position="static"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          columnGap: 3,
          rowGap: 0.5,
          px: 2,
          py: 1.5,
        }}
      >
        <Typography variant="h6" component="h1">
          Run Windows 3.1 programs
        </Typography>
        <Launcher launcher={view?.launcher ?? null} />
        <Typography id="engine" variant="body2" color="text.secondary">
          {engine && (
            <>
              {engine.text}
              <Link
                href={engine.href}
                onClick={(event) => {
                  /* What the machine wrote kept before the page is left for the other's. */
                  event.preventDefault();
                  actions.switchEngine(engine.href);
                }}
              >
                {engine.link}
              </Link>
            </>
          )}
        </Typography>
        <StatusLine />
      </Box>
    </AppBar>
  );
}
