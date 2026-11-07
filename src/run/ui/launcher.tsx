/**
 * The launcher (`kb/guides/launcher.md`): a menu button in the banner,
 * "Programs", opening a menu of every kept program's groups, each opening
 * to its items, each with its icon drawn from the group file's own bits.
 * Choosing an item runs it on its install's stack as Program Manager runs
 * it (`actions.launch`). An item that cannot run is there, disabled but
 * reachable, saying why. A working directory that is not there is asked
 * about first, as Program Manager asks -- its box is Program Manager's own,
 * so the question is WinBox's dialog, with Program Manager's words.
 *
 * The WAI-ARIA menu button and menu, with submenus: the button opens the
 * menu on a click, Enter, Space or Down, its first group focused; Up and
 * Down move among a menu's entries, Home and End to its first and last, a
 * letter to the next beginning with it (MUI's `MenuList`); Right, Enter or
 * Space on a group opens its items, the first focused, and Left or Escape
 * there goes back to the group; Escape on the groups closes the menu, the
 * focus back on the button.
 */

import AppsIcon from '@mui/icons-material/Apps';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { type KeyboardEvent, useState } from 'react';
import { actions } from '../page/actions.js';
import { type LauncherGroup, type LauncherItem, type LauncherView } from '../page/view.js';
import { useConfirm } from './confirm.js';
import { Icon } from './kept.js';

/** What Program Manager's box says of a working directory that is not there (strings 34h, 8Eh). */
const INVALID_PATH = { title: 'Invalid Path', text: 'The working directory is invalid.' };

/**
 * A disabled entry: not MUI's dimming of the whole entry, which would take
 * its reason below AA's contrast, but its name and icon greyed as a
 * disabled control's are (the theme's `text.disabled`, and the icon faded
 * and without colour), and its reason in the secondary text's colour, AA
 * on the menu's paper in both schemes.
 */
const legible = {
  '&.Mui-disabled': { opacity: 1 },
  whiteSpace: 'normal',
  maxWidth: '24rem',
} as const;

/** An icon greyed, as a disabled entry's. */
const greyed = { filter: 'grayscale(1)', opacity: 0.45 } as const;

function ItemEntry({ item, choose }: { item: LauncherItem; choose: (item: LauncherItem) => void }) {
  return (
    <MenuItem
      disabled={Boolean(item.reason)}
      title={item.directory ? `${item.command} (in ${item.directory})` : item.command}
      onClick={() => choose(item)}
      sx={legible}
    >
      <ListItemIcon
        sx={{ minWidth: 0, width: 32, height: 32, mr: 1.5, ...(item.reason ? greyed : {}) }}
      >
        <Icon item={item} display={item.display} />
      </ListItemIcon>
      {/* Named by what it shows: its name, and why it cannot run -- a space
       * between them in its words, for its name to be read as it is seen. */}
      <ListItemText
        primary={item.reason ? `${item.name} ` : item.name}
        secondary={item.reason ? `Cannot run: ${item.reason}.` : null}
        slotProps={{
          primary: { color: item.reason ? 'text.disabled' : undefined },
          secondary: { color: 'text.secondary' },
        }}
      />
    </MenuItem>
  );
}

function GroupItems({
  group,
  index,
  anchor,
  close,
  closeAll,
  choose,
}: {
  group: LauncherGroup;
  index: number;
  anchor: HTMLElement;
  close: () => void;
  closeAll: () => void;
  choose: (item: LauncherItem) => void;
}) {
  return (
    <Menu
      id={`launcher-items-${index}`}
      anchorEl={anchor}
      open
      onClose={(_, reason) => (reason === 'escapeKeyDown' ? close() : closeAll())}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      variant="menu"
      slotProps={{
        list: {
          'aria-labelledby': `launcher-group-${index}`,
          disabledItemsFocusable: true,
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              close();
            }
          },
        },
      }}
    >
      {group.note ? (
        <MenuItem disabled sx={legible}>
          {group.note}
        </MenuItem>
      ) : (
        group.items.map((item) => <ItemEntry key={item.item} item={item} choose={choose} />)
      )}
    </Menu>
  );
}

export function Launcher({ launcher }: { launcher: LauncherView | null }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const [sub, setSub] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const confirm = useConfirm();
  const closeAll = () => {
    setSub(null);
    setAnchor(null);
  };
  const choose = async (item: LauncherItem) => {
    if (item.reason) {
      return;
    }

    closeAll();

    if (
      !item.directoryThere &&
      !(await confirm({ ...INVALID_PATH, action: 'OK', destructive: false }))
    ) {
      return;
    }

    actions.launch(item.install, item.group, item.item);
  };
  const groups = launcher?.groups ?? [];
  const opening = (index: number) => (event: { currentTarget: HTMLElement }) =>
    setSub({ index, anchor: event.currentTarget });

  return (
    <>
      <Button
        id="launcher"
        variant="contained"
        startIcon={<AppsIcon />}
        aria-haspopup="menu"
        aria-controls={open ? 'launcher-menu' : undefined}
        aria-expanded={open ? 'true' : 'false'}
        disabled={!launcher}
        onClick={(event) => setAnchor(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setAnchor(event.currentTarget);
          }
        }}
        sx={{ alignSelf: 'center' }}
      >
        Programs
      </Button>
      <Menu
        id="launcher-menu"
        anchorEl={anchor}
        open={open && Boolean(launcher)}
        onClose={closeAll}
        variant="menu"
        slotProps={{ list: { 'aria-labelledby': 'launcher', disabledItemsFocusable: true } }}
      >
        {launcher?.empty ? (
          <MenuItem disabled sx={legible}>
            {launcher.empty}
          </MenuItem>
        ) : (
          groups.map((group, index) => (
            <MenuItem
              key={index}
              id={`launcher-group-${index}`}
              aria-haspopup="menu"
              aria-expanded={sub?.index === index ? 'true' : 'false'}
              aria-controls={sub?.index === index ? `launcher-items-${index}` : undefined}
              onClick={opening(index)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  opening(index)(event);
                }
              }}
            >
              <ListItemText primary={group.label} />
              <Box component="span" aria-hidden="true" sx={{ display: 'flex', ml: 2 }}>
                <ChevronRightIcon fontSize="small" />
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>
      {sub && groups[sub.index] && (
        <GroupItems
          group={groups[sub.index]}
          index={sub.index}
          anchor={sub.anchor}
          close={() => setSub(null)}
          closeAll={closeAll}
          choose={choose}
        />
      )}
    </>
  );
}
