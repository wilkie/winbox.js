/**
 * The programs kept in this browser, each with the way to put it on C: and
 * to forget it, and its own Program Manager groups beneath it, read-only:
 * each group's name and its items, each with its icon drawn from the group
 * file's own bits on the group window's colour (`iconPixels`), its name, and
 * its command line and working directory as the title and, opened, beneath.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useEffect, useMemo, useRef } from 'react';
import { actions } from '../page/actions.js';
import { type KeptGroup, type KeptItem } from '../page/groups.js';
import { type KeptRow, type PageView } from '../page/view.js';
import { iconPixels } from '../group-icon.js';
import { useConfirm } from './confirm.js';
import { Actions, Code, Row, Rows } from './panels.js';
import { Note, Section } from './section.js';

/** An item's icon, drawn once from its bits; nothing where it has none. */
export function Icon({ item, display }: { item: Pick<KeptItem, 'icon'>; display: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const icon = item.icon;
  const pixels = useMemo(() => (icon ? iconPixels(icon, display) : null), [icon, display]);

  useEffect(() => {
    if (icon && pixels) {
      canvas.current?.getContext('2d')?.putImageData(new ImageData(pixels, icon.cx, icon.cy), 0, 0);
    }
  }, [icon, pixels]);

  return icon && pixels ? (
    <Box
      component="canvas"
      ref={canvas}
      width={icon.cx}
      height={icon.cy}
      aria-hidden="true"
      sx={{ imageRendering: 'pixelated', flex: 'none' }}
    />
  ) : null;
}

function Groups({ row, groups }: { row: KeptRow; groups: KeptGroup[] }) {
  return (
    <Box
      component="ul"
      aria-label={`${row.name}'s Program Manager groups`}
      sx={{ listStyle: 'none', m: 0, p: 0, flexBasis: '100%' }}
    >
      {groups.map((group) => {
        return (
          <Box component="li" key={group.file} sx={{ pl: 2, py: 0.25 }}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {group.refusal ? group.file : group.name}
            </Box>
            {group.refusal ? (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {` would not load, as Program Manager would refuse it: ${group.refusal}`}
              </Box>
            ) : (
              <Box
                component="ul"
                aria-label={`Items of ${group.name}`}
                sx={{ listStyle: 'none', m: 0, p: 0 }}
              >
                {group.items.map((item, at) => (
                  <Box component="li" key={at} sx={{ pl: 2, py: 0.25 }}>
                    <details>
                      <Box
                        component="summary"
                        title={
                          item.directory ? `${item.command} (in ${item.directory})` : item.command
                        }
                        sx={{ cursor: 'pointer' }}
                      >
                        <Box
                          component="span"
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.75,
                            verticalAlign: 'middle',
                          }}
                        >
                          <Icon item={item} display={row.display} />
                          {item.name}
                        </Box>
                      </Box>
                      <Box component="p" sx={{ m: 0, ml: 3, color: 'text.secondary' }}>
                        <code>{item.command}</code>
                        {item.directory && (
                          <>
                            {' in '}
                            <code>{item.directory}</code>
                          </>
                        )}
                      </Box>
                    </details>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function KeptPanel({ view }: { view: PageView }) {
  const confirm = useConfirm();

  return (
    <Section id="kept-section" title="Kept programs" hidden={!view.kept.length}>
      <Note id="kept-note">{view.keptNote}</Note>
      <Rows id="kept-programs">
        {view.kept.map((row) => (
          <Row key={row.name}>
            <Code>{row.label}</Code>
            <Actions>
              {/* Shown, its machine's tab has its Close. */}
              {!row.shown && (
                <Button
                  disabled={!row.here}
                  aria-label={row.openLabel}
                  onClick={() => actions.open(row.name)}
                >
                  {row.openText}
                </Button>
              )}
              <Button
                color="error"
                aria-label={`Forget ${row.name}`}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Forget ${row.name}?`,
                      text:
                        `This browser forgets ${row.name}: what was installed or dropped as it, ` +
                        'and what it wrote. It cannot be undone.',
                      action: 'Forget program',
                    })
                  ) {
                    actions.forgetProgram(row.name);
                  }
                }}
              >
                Forget
              </Button>
            </Actions>
            {row.groups?.length ? <Groups row={row} groups={row.groups} /> : null}
          </Row>
        ))}
      </Rows>
    </Section>
  );
}
