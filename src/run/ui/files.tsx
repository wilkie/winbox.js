/**
 * The file browser: a modal dialog, the whole screen on a narrow one, over
 * the drives the page has -- C: and each drive of images -- one folder at a
 * time, its entries as DOS lists them (`../page/files.ts`), read from what
 * the page has of each drive (`../page/browse.ts`), never written.
 *
 * The folder is a grid, the WAI-ARIA data grid pattern: one stop for Tab,
 * the arrow keys moving from cell to cell (the column headers the first
 * row, each a button that sorts by its column, `aria-sort` saying how),
 * Home and End to the row's first and last cells, Ctrl+Home and Ctrl+End to
 * the first and last rows, Page Up and Page Down ten rows; the row with the
 * focus is the one selected (`aria-selected`), which the buttons beneath
 * act on. Enter opens a folder, Backspace or Alt+Up goes up to the folder
 * it is in, the focus put on the folder come from. A double click opens a
 * folder too. What is done is said in the dialog's own status line, as the
 * page's is hidden while the dialog is open.
 */

import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  browse,
  type Browsing,
  browsing,
  downloadFile,
  drivesToBrowse,
  forget,
  isProgram,
  type Listing,
  listFolder,
  runFile,
  stopBrowsing,
} from '../page/browse.js';
import {
  dosDate,
  dosSize,
  type FileEntry,
  pathText,
  type SortKey,
  type Sorting,
  sortEntries,
} from '../page/files.js';
import { useStatusLine } from './use.js';

/** The grid's columns: the first three sort it. */
const COLUMNS: { key: SortKey | 'mark'; text: string; align: 'left' | 'right' }[] = [
  { key: 'name', text: 'Name', align: 'left' },
  { key: 'size', text: 'Size', align: 'right' },
  { key: 'modified', text: 'Date', align: 'left' },
  { key: 'mark', text: 'Changes', align: 'left' },
];

/** How many rows Page Up and Page Down move. */
const PAGE = 10;

/** A mark as its cell says it. */
const MARKS = { changed: 'Changed', kept: 'Kept' };

/** The cell with the focus: row 0 the headers, 1 on the entries; and its column. */
interface Cursor {
  row: number;
  col: number;
}

export function FileBrowser() {
  const at = useSyncExternalStore(browsing.subscribe, browsing.get);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  /* The folder as last read, and which it was: shown only while it is the folder browsed. */
  const [read, setRead] = useState<{ of: Browsing; listing: Listing } | null>(null);
  const [sorting, setSorting] = useState<Sorting>({ key: 'name', ascending: true });
  const [cursor, setCursor] = useState<Cursor>({ row: 1, col: 0 });
  /* Read afresh: counted up by Refresh. */
  const [reading, setReading] = useState(0);
  /* The name to put the focus on once the folder is read: the folder come up from. */
  const landOn = useRef<string | null>(null);
  /* Whether the focus follows the cursor: once the keyboard has moved it in the grid. */
  const focusing = useRef(false);
  const grid = useRef<HTMLTableElement>(null);
  const said = useStatusLine();

  const listing = read && read.of === at ? read.listing : null;
  const letter = at?.letter ?? 'C';
  const parts = useMemo(() => at?.parts ?? [], [at]);
  const path = pathText(letter, parts);
  const entries = useMemo(
    () => (listing ? sortEntries(listing.entries, sorting) : []),
    [listing, sorting]
  );
  const rows = Math.max(1, entries.length);
  const selected = cursor.row >= 1 ? (entries[cursor.row - 1] ?? null) : null;

  /* The folder read, as it is opened, and afresh as asked. */
  useEffect(() => {
    if (!at) {
      return;
    }

    let current = true;

    listFolder(at.letter, at.parts).then((listing) => {
      if (!current) {
        return;
      }

      const sorted = sortEntries(listing.entries, sorting);
      const found = landOn.current
        ? sorted.findIndex((entry) => entry.name === landOn.current)
        : -1;

      landOn.current = null;
      setRead({ of: at, listing });
      setCursor({ row: found >= 0 ? found + 1 : 1, col: 0 });
    });

    return () => {
      current = false;
    };
    /* Sorting is read for where the focus lands, not to read the folder again. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, reading]);

  /* The focus on the cursor's cell, where the keyboard moved it. */
  useLayoutEffect(() => {
    if (!focusing.current || !listing) {
      return;
    }

    grid.current?.querySelector<HTMLElement>(`[data-cell="${cursor.row}-${cursor.col}"]`)?.focus();
  }, [cursor, listing]);

  const go = (to: string[], from: string | null = null) => {
    landOn.current = from;
    focusing.current = true;
    browsing.set({ ...at!, parts: to });
  };
  const up = () => parts.length && go(parts.slice(0, -1), parts.at(-1)!);
  const open = (entry: FileEntry | null) => entry?.folder && go([...parts, entry.name]);
  const sortBy = (key: SortKey) =>
    setSorting((was) => ({ key, ascending: was.key === key ? !was.ascending : true }));

  const onKey = (event: KeyboardEvent) => {
    const move = (row: number, col = cursor.col) => {
      event.preventDefault();
      focusing.current = true;
      setCursor({
        row: Math.max(0, Math.min(rows, row)),
        col: Math.max(0, Math.min(COLUMNS.length - 1, col)),
      });
    };

    if ((event.key === 'ArrowUp' && event.altKey) || event.key === 'Backspace') {
      event.preventDefault();
      up();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        return move(cursor.row + 1);
      case 'ArrowUp':
        return move(cursor.row - 1);
      case 'ArrowRight':
        return move(cursor.row, cursor.col + 1);
      case 'ArrowLeft':
        return move(cursor.row, cursor.col - 1);
      case 'Home':
        return event.ctrlKey ? move(1, cursor.col) : move(cursor.row, 0);
      case 'End':
        return event.ctrlKey ? move(rows, cursor.col) : move(cursor.row, COLUMNS.length - 1);
      case 'PageDown':
        return move(cursor.row + PAGE);
      case 'PageUp':
        return move(Math.max(1, cursor.row - PAGE));
      case 'Enter':
        if (cursor.row >= 1 && selected?.folder) {
          event.preventDefault();
          open(selected);
        }
    }
  };

  /* Each cell's place in the grid: one Tab stop, the cursor's. */
  const cell = (row: number, col: number) => ({
    'data-cell': `${row}-${col}`,
    tabIndex: cursor.row === row && cursor.col === col ? 0 : -1,
    onFocus: () => setCursor({ row, col }),
  });

  const close = () => {
    stopBrowsing();
    forget();
  };
  const program = selected && !selected.folder && isProgram(selected.name);
  const selectedPath = selected ? pathText(letter, [...parts, selected.name]) : '';

  return (
    <Dialog
      open={Boolean(at)}
      onClose={close}
      fullScreen={narrow}
      fullWidth
      maxWidth="md"
      aria-labelledby="files-title"
      aria-describedby="files-keys"
    >
      <DialogTitle id="files-title">Files</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Typography component="label" htmlFor="files-drive" variant="body2">
            Drive
          </Typography>
          <NativeSelect
            value={letter}
            onChange={(event) => browse(event.target.value)}
            input={<OutlinedInput size="small" />}
            inputProps={{ id: 'files-drive' }}
          >
            {drivesToBrowse().map((drive) => (
              <option key={drive.letter} value={drive.letter}>
                {drive.text}
              </option>
            ))}
          </NativeSelect>
          <Button
            startIcon={<ArrowUpwardOutlined />}
            disabled={!parts.length}
            aria-label={parts.length ? `Up to ${pathText(letter, parts.slice(0, -1))}` : 'Up'}
            onClick={up}
          >
            Up
          </Button>
          <Button
            onClick={() => {
              forget();
              setReading((count) => count + 1);
            }}
          >
            Read again
          </Button>
        </Stack>
        <Breadcrumbs aria-label="Folder" sx={{ fontFamily: 'monospace' }}>
          {[...parts.map((_, at) => at), parts.length].map((depth) =>
            depth === parts.length ? (
              <Typography
                key={depth}
                id="files-path"
                aria-current="location"
                sx={{ fontFamily: 'monospace', color: 'text.primary' }}
              >
                {depth ? parts[depth - 1] : `${letter}:\\`}
              </Typography>
            ) : (
              <Link
                key={depth}
                component="button"
                type="button"
                underline="hover"
                aria-label={pathText(letter, parts.slice(0, depth))}
                sx={{ fontFamily: 'monospace' }}
                onClick={() => go(parts.slice(0, depth), parts[depth])}
              >
                {depth ? parts[depth - 1] : `${letter}:\\`}
              </Link>
            )
          )}
        </Breadcrumbs>
        <Typography id="files-keys" variant="body2" color="text.secondary">
          The arrow keys move in the list; Enter opens a folder, Backspace goes up. Nothing here is
          written to any drive.
        </Typography>
        <TableContainer
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: narrow ? 'none' : '55vh',
          }}
        >
          <Table
            ref={grid}
            role="grid"
            size="small"
            stickyHeader
            aria-label={`Files in ${path}`}
            aria-rowcount={entries.length + 1}
            onKeyDown={onKey}
            sx={{
              '& td, & th': { whiteSpace: 'nowrap', py: 0.5 },
              '& [data-cell]:focus-visible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: -2,
              },
            }}
          >
            <TableHead>
              <TableRow aria-rowindex={1}>
                {COLUMNS.map((column, col) =>
                  column.key === 'mark' ? (
                    <TableCell key={column.key} align={column.align} {...cell(0, col)}>
                      {column.text}
                    </TableCell>
                  ) : (
                    <TableCell
                      key={column.key}
                      align={column.align}
                      aria-sort={
                        sorting.key === column.key
                          ? sorting.ascending
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <TableSortLabel
                        active={sorting.key === column.key}
                        direction={
                          sorting.key === column.key && !sorting.ascending ? 'desc' : 'asc'
                        }
                        onClick={() => sortBy(column.key as SortKey)}
                        {...cell(0, col)}
                      >
                        {column.text}
                      </TableSortLabel>
                    </TableCell>
                  )
                )}
              </TableRow>
            </TableHead>
            <TableBody sx={{ fontFamily: 'monospace' }}>
              {!listing || !entries.length ? (
                <TableRow aria-rowindex={2}>
                  <TableCell colSpan={COLUMNS.length} {...cell(1, 0)}>
                    {!listing ? 'Reading…' : (listing.note ?? 'This folder is empty.')}
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry, at) => {
                  const row = at + 1;

                  return (
                    <TableRow
                      key={entry.name}
                      hover
                      selected={cursor.row === row}
                      aria-selected={cursor.row === row}
                      aria-rowindex={row + 1}
                      onDoubleClick={() => open(entry)}
                    >
                      <TableCell {...cell(row, 0)} sx={{ fontFamily: 'monospace' }}>
                        <Box
                          component="span"
                          sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center' }}
                        >
                          {entry.folder ? (
                            <FolderOutlined fontSize="small" color="action" />
                          ) : (
                            <InsertDriveFileOutlined fontSize="small" color="action" />
                          )}
                          {entry.name}
                        </Box>
                        {entry.was && ' '}
                        {entry.was && (
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 1 }}
                          >
                            (was {entry.was})
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell {...cell(row, 1)} align="right" sx={{ fontFamily: 'monospace' }}>
                        {dosSize(entry)}
                      </TableCell>
                      <TableCell
                        {...cell(row, 2)}
                        sx={{ fontFamily: 'monospace', whiteSpace: 'pre' }}
                      >
                        {dosDate(entry.modified)}
                      </TableCell>
                      <TableCell {...cell(row, 3)}>{entry.mark ? MARKS[entry.mark] : ''}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center', minHeight: 32 }}
          role="toolbar"
          aria-label="Selected"
        >
          {selected?.folder && (
            <Button
              startIcon={<FolderOpenOutlined />}
              aria-label={`Open ${selectedPath}`}
              onClick={() => open(selected)}
            >
              Open
            </Button>
          )}
          {selected && !selected.folder && (
            <Button
              startIcon={<DownloadOutlined />}
              aria-label={`Download ${selectedPath}`}
              onClick={() => downloadFile(letter, [...parts, selected.name])}
            >
              Download
            </Button>
          )}
          {program && (
            <Button
              variant="contained"
              startIcon={<PlayArrowOutlined />}
              aria-label={`Run ${selectedPath}`}
              onClick={() => {
                close();
                runFile(letter, [...parts, selected!.name]);
              }}
            >
              Run
            </Button>
          )}
        </Stack>
        <Typography
          role="status"
          variant="body2"
          color="text.secondary"
          sx={{ minHeight: '1.5em' }}
        >
          {at && said.seq > at.since ? said.message : ''}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
