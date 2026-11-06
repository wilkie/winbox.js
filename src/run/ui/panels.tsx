/**
 * The side's panels: the drop, Windows, what programs wrote, the display
 * and the machine, the install offered or under way, the programs to run
 * and the files on C:. Each renders what the page published (`PageView`)
 * and calls the page's actions.
 */

import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import SvgIcon from '@mui/material/SvgIcon';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useRef, useState } from 'react';
import { actions } from '../page/actions.js';
import { type PageView } from '../page/view.js';
import { useConfirm } from './confirm.js';
import { Note, Section } from './section.js';

/** A list of rows, each over a rule. */
export function Rows({
  id,
  label,
  hidden,
  children,
}: {
  id?: string;
  label?: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <List
      id={id}
      dense
      disablePadding
      aria-label={label}
      hidden={hidden}
      sx={hidden ? { display: 'none' } : undefined}
    >
      {children}
    </List>
  );
}

/** A row: what it is, and what may be done with it, side by side, wrapping where narrow. */
export function Row({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ListItem
      divider
      disableGutters
      aria-label={label}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'space-between' }}
    >
      {children}
    </ListItem>
  );
}

/** A path or name, in the monospace face, broken anywhere it must be. */
export function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Box
      component="code"
      title={title}
      sx={{ overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: '0.8125rem' }}
    >
      {children}
    </Box>
  );
}

/** Buttons side by side. */
export function Actions({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <Stack id={id} direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {children}
    </Stack>
  );
}

/**
 * Where zip archives and images are dropped, or chosen: the button opens the
 * same picker, so nothing is had by dragging alone.
 */
export function DropZone() {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Paper
      id="drop"
      variant="outlined"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        actions.drop(event.dataTransfer);
      }}
      sx={{
        p: 2,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderWidth: 2,
        borderColor: over ? 'primary.main' : 'divider',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        alignItems: 'center',
      }}
    >
      <Typography component="p" variant="subtitle2">
        Drop zip archives here
      </Typography>
      <Typography id="drop-note" variant="body2" color="text.secondary">
        or choose them: programs, and your Windows 3.1 -- its setup disks&apos; images, or an
        installed copy. Disk and CD images (.img, .iso, .cue with its .bin) beside Windows become
        drives. Nothing leaves this browser.
      </Typography>
      <Button
        variant="contained"
        aria-describedby="drop-note"
        onClick={() => picker.current?.click()}
      >
        Choose files…
      </Button>
      <input
        id="picker"
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label="Choose files"
        onChange={(event) => actions.choose([...(event.target.files ?? [])])}
      />
    </Paper>
  );
}

export function WindowsPanel({ view }: { view: PageView }) {
  const confirm = useConfirm();

  return (
    <Section title="Windows">
      <Note id="windows">{view.windows}</Note>
      {view.forgettable && (
        <Box>
          <Button
            id="forget"
            color="error"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Forget Windows?',
                  text:
                    'This browser forgets this Windows, every program kept on it, and what ' +
                    'programs wrote. It cannot be undone.',
                  action: 'Forget Windows',
                })
              ) {
                actions.forgetWindows();
              }
            }}
          >
            Forget it
          </Button>
        </Box>
      )}
    </Section>
  );
}

export function ChangesPanel({ view }: { view: PageView }) {
  const confirm = useConfirm();
  const { changes } = view;

  return (
    <Section title="Changes kept">
      <Note id="changes">{changes.text}</Note>
      <Rows id="changed">
        {changes.rows.map((row) => (
          <ListItem key={row} disableGutters sx={{ py: 0 }}>
            <Code>{row}</Code>
          </ListItem>
        ))}
      </Rows>
      {changes.forgettable && (
        <Box>
          <Button
            id="forget-changes"
            color="error"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Forget what programs wrote?',
                  text: 'This browser forgets what programs wrote on this C:. It cannot be undone.',
                  action: 'Forget changes',
                })
              ) {
                actions.forgetChanges();
              }
            }}
          >
            Forget changes
          </Button>
        </Box>
      )}
    </Section>
  );
}

export function DisplayPanel({ view }: { view: PageView }) {
  return (
    <Section title={<label htmlFor="display">Display</label>}>
      <NativeSelect
        value={view.display}
        onChange={(event) => actions.setDisplay(event.target.value)}
        input={<OutlinedInput size="small" />}
        inputProps={{ id: 'display' }}
      >
        {view.displays.map((display) => (
          <option key={display.value} value={display.value}>
            {display.text}
          </option>
        ))}
      </NativeSelect>
    </Section>
  );
}

export function MachinePanel({ view }: { view: PageView }) {
  return (
    <Section title="Machine">
      <FormControlLabel
        control={
          <Checkbox
            id="coprocessor"
            size="small"
            checked={view.coprocessor}
            onChange={(event) => actions.setCoprocessor(event.target.checked)}
          />
        }
        label="Math coprocessor"
      />
      <Note>
        Without one, programs&apos; floating-point instructions are emulated, as WIN87EM does.
      </Note>
      {view.soundOffered && (
        <Box id="sound-option">
          <FormControlLabel
            control={
              <Checkbox
                id="sound"
                size="small"
                checked={view.sound}
                onChange={(event) => actions.setSound(event.target.checked)}
              />
            }
            label="Sound"
          />
          <Note>
            WinBox&apos;s own sound card, from the next program run. MIDI is not played yet.
          </Note>
        </Box>
      )}
    </Section>
  );
}

export function InstallPanel({ view }: { view: PageView }) {
  const confirm = useConfirm();
  const { install } = view;

  return (
    <Section id="install-section" title="Install" hidden={!install.shown}>
      <Note id="install-note">{install.note}</Note>
      <Box
        id="install-target"
        hidden={!install.install}
        sx={install.install ? {} : { display: 'none' }}
      >
        <TextField
          select
          id="install-into"
          label="Install"
          size="small"
          fullWidth
          value={install.into}
          onChange={(event) => actions.setInstallInto(event.target.value)}
          slotProps={{ select: { native: true } }}
        >
          {install.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </TextField>
      </Box>
      <Actions>
        {install.install && (
          <Button id="install" variant="contained" onClick={() => actions.install()}>
            Install
          </Button>
        )}
        {install.keepAsProgram && (
          <Button id="keep-as-program" onClick={() => actions.keepAsProgram()}>
            Keep as a program
          </Button>
        )}
        {install.keep && (
          <Button id="install-keep" variant="contained" onClick={() => actions.keepInstalled()}>
            Keep
          </Button>
        )}
        {install.discard && (
          <Button
            id="install-discard"
            color="error"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Discard what the installer wrote?',
                  text: 'Everything the installer has written on C: is let go of. It cannot be undone.',
                  action: 'Discard',
                })
              ) {
                actions.discardInstall();
              }
            }}
          >
            Discard
          </Button>
        )}
      </Actions>
    </Section>
  );
}

export function ProgramsPanel({ view }: { view: PageView }) {
  return (
    <Section title="Programs">
      <Rows id="programs">
        {view.programs.map((row) => (
          <Row key={row.path}>
            <Code>{row.path}</Code>
            <Button
              disabled={!row.runnable}
              aria-label={row.label}
              onClick={() => actions.run(row.program)}
            >
              {row.runnable ? 'Run' : 'DOS'}
            </Button>
          </Row>
        ))}
        {view.programsEmpty && (
          <ListItem disableGutters className="empty">
            <Note>{view.programsEmpty}</Note>
          </ListItem>
        )}
      </Rows>
    </Section>
  );
}

export function FilesPanel({ view }: { view: PageView }) {
  return (
    <Accordion disableGutters variant="outlined" slotProps={{ heading: { component: 'h2' } }}>
      <AccordionSummary
        aria-controls="files-region"
        id="files-summary"
        expandIcon={
          <SvgIcon aria-hidden="true">
            <path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z" />
          </SvgIcon>
        }
      >
        {/* The summary is the h2 (its heading slot); its words styled as the other panels' headings. */}
        <Typography
          variant="overline"
          component="span"
          color="text.secondary"
          sx={{ lineHeight: 1.6, fontWeight: 600 }}
        >
          Files on C:
        </Typography>
      </AccordionSummary>
      <AccordionDetails id="files-region">
        <Rows id="files">
          {view.files.map((file) => (
            <ListItem key={file} disableGutters sx={{ py: 0 }}>
              <Code>{file}</Code>
            </ListItem>
          ))}
        </Rows>
      </AccordionDetails>
    </Accordion>
  );
}
