/**
 * The page for running real Windows 3.1 programs: drop zip archives on it, and
 * it puts them on a C: drive and offers every Windows program on it to run.
 *
 * A zip of a Windows installation gives the programs Windows' own fonts and
 * files; it is found by what it holds and remembered in this browser, so it is
 * dropped once. In its place, the user's Windows 3.1 setup disks -- their
 * images -- make WinBox's asset bundle here, in the browser
 * (`kb/topics/asset-bundle.md`), or a bundle already made is dropped; the
 * bundle is remembered as an installation is, and C: is the base it composes
 * for the display chosen, with no installation at all. A zip of programs
 * dropped over either is kept as a program of its own, a layer over that
 * Windows (`kb/formats/layer.md`), and listed on every visit, each run on
 * its own stack. What programs write on C: is remembered too, as the changes
 * against what was dropped (`changes.ts`), and put back on the drive each time
 * it is made, on either engine. Nothing is uploaded anywhere. Each program's
 * API calls are traced as it runs -- the functions it needed, and which of
 * those reached nothing -- which is what testing a real program against this
 * implementation and the oracle's recordings starts from.
 *
 * The page's state and actions are plain modules (`page/`); what it shows is
 * React and MUI (`ui/`), rendered from what they publish. See ARCHITECTURE.md,
 * "The run page".
 *
 * Served by `pnpm dev` at `/run.html`. Not part of the distributed bundle.
 */

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DeviceBitmap } from '../raster/device-bitmap.js';
import { Presenter } from '../raster/presenter.js';
import { App } from './ui/app.js';
import { ConfirmProvider } from './ui/confirm.js';
import { theme } from './ui/theme.js';

/* Handy for prodding the presenter from the browser console, and for the
 * browser test that reads a presented bitmap back. */
Object.assign(globalThis as Record<string, unknown>, { DeviceBitmap, Presenter });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ThemeProvider>
  </StrictMode>
);
