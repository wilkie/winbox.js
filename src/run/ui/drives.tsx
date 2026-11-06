/**
 * The drives, each a card that says what it is at a glance: C:, the hard
 * disk Windows and the programs are on; each drive of images -- a floppy
 * drive's set and the disk in it, a CD-ROM drive's disc, a hard disk's
 * image -- with what may be done with it; and the images a kept program
 * asks for again. Each card's kind is said in words beside its icon, and
 * each disk's state in words beside its mark, so nothing is told by an
 * icon or a colour alone. Images dropped on a drive's card go in its set,
 * as "Add…" chooses them from the keyboard.
 */

import AlbumOutlined from '@mui/icons-material/AlbumOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import EjectOutlined from '@mui/icons-material/EjectOutlined';
import ImageSearchOutlined from '@mui/icons-material/ImageSearchOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import RadioButtonChecked from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode, useRef, useState } from 'react';
import { actions } from '../page/actions.js';
import { type CDriveView, type DriveRow, type NeededRow, type PageView } from '../page/view.js';
import { useConfirm } from './confirm.js';
import { Code, Row, Rows } from './panels.js';
import { Note, Section } from './section.js';

/** The extensions of the images a drive takes. */
const IMAGES = '.img,.ima,.dsk,.vfd,.iso,.bin,.cue';

/** Each kind's icon: a floppy disk, a disc, a hard disk. Its words are always beside it. */
const ICONS = {
  floppy: SaveOutlined,
  'CD-ROM': AlbumOutlined,
  'hard disk': StorageOutlined,
};

/** A drive's card: its icon, its letter and kind as its heading, what is in it, and what may be done. */
function DriveCard({
  icon,
  letter,
  kind,
  label,
  children,
  actions: buttons,
  component = 'div',
  ...rest
}: {
  icon: ReactNode;
  letter: string;
  kind: string;
  label: string;
  children: ReactNode;
  actions: ReactNode;
  component?: 'li' | 'div';
  [more: string]: unknown;
}) {
  return (
    <Card component={component} variant="outlined" aria-label={label} {...rest}>
      <CardContent sx={{ p: 1.5, pb: 0.5, '&:last-child': { pb: 0.5 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ color: 'text.secondary', pt: 0.25, display: 'flex' }}>{icon}</Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" variant="subtitle2" sx={{ lineHeight: 1.4 }}>
              {letter}{' '}
              <Box component="span" sx={{ fontWeight: 'normal' }}>
                {kind}
              </Box>
            </Typography>
            {children}
          </Box>
        </Stack>
      </CardContent>
      <CardActions sx={{ flexWrap: 'wrap', gap: 0.5, px: 1.5, pt: 0.5, pb: 1.5 }} disableSpacing>
        {buttons}
      </CardActions>
    </Card>
  );
}

/** A line of a card, in the secondary text's colour, an icon before it where it has one. */
function Fact({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{
        display: 'flex',
        gap: 0.5,
        alignItems: 'flex-start',
        overflowWrap: 'anywhere',
        '& svg': { fontSize: '1rem', mt: '0.15em' },
      }}
    >
      {icon}
      <span>{children}</span>
    </Typography>
  );
}

/** C:, the hard disk: Windows, what is kept over it, and what programs wrote. */
function HardDiskC({ c }: { c: CDriveView }) {
  return (
    <DriveCard
      id="drive-c"
      icon={<StorageOutlined />}
      letter="C:"
      kind="hard disk"
      label={c.label}
      actions={null}
    >
      <Fact>{c.windows}</Fact>
      <Fact>{c.programs}</Fact>
      <Fact>{c.changes}</Fact>
    </DriveCard>
  );
}

function Drive({ drive }: { drive: DriveRow }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const { letter } = drive;
  const Icon = ICONS[drive.kind];

  return (
    <DriveCard
      component="li"
      icon={<Icon />}
      letter={`${letter}:`}
      kind={drive.kindText}
      label={drive.label}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        actions.drop(event.dataTransfer, letter);
      }}
      sx={{
        listStyle: 'none',
        outline: over ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
      }}
      actions={
        <>
          {drive.next && (
            <>
              <NativeSelect
                value={String(drive.current)}
                onChange={(event) => actions.insertDisk(letter, Number(event.target.value))}
                input={<OutlinedInput size="small" />}
                inputProps={{ 'aria-label': `Disk in ${letter}:` }}
                sx={{ maxWidth: '100%', fontSize: '0.8125rem' }}
              >
                {drive.disks.map((disk, at) => (
                  <option key={at} value={String(at)}>
                    {disk}
                  </option>
                ))}
              </NativeSelect>
              <Button
                aria-label={`Next disk in ${letter}:`}
                onClick={() => actions.nextDisk(letter)}
              >
                Next
              </Button>
            </>
          )}
          {drive.insert && (
            <Button
              aria-label={`Insert the disk in ${letter}:`}
              onClick={() => actions.nextDisk(letter)}
            >
              Insert
            </Button>
          )}
          {drive.eject && (
            <Button
              aria-label={`Eject ${letter}:`}
              startIcon={<EjectOutlined />}
              onClick={() => actions.ejectDisk(letter)}
            >
              Eject
            </Button>
          )}
          {drive.save && (
            <Button
              aria-label={`Save the image in ${letter}:`}
              onClick={() => actions.saveImage(letter)}
            >
              Save image…
            </Button>
          )}
          {drive.add && (
            <>
              <Button
                aria-label={`Add images to ${letter}:`}
                onClick={() => actions.chooseImages(input.current!, letter)}
              >
                Add…
              </Button>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={IMAGES}
                aria-label={`Images to add to ${letter}:`}
                onChange={(event) => {
                  actions.imagesChosen([...(event.target.files ?? [])], letter);
                  event.target.value = '';
                }}
              />
            </>
          )}
          {drive.installer && (
            <Button
              aria-label={`Install from ${letter}:`}
              onClick={() => actions.installFromDrive(letter, drive.installer!)}
            >
              Install
            </Button>
          )}
          <Button
            aria-label={`Remove ${letter}:`}
            color="error"
            onClick={async () => {
              if (
                await confirm({
                  title: `Remove ${letter}:?`,
                  text: drive.removing,
                  action: 'Remove',
                })
              ) {
                actions.removeDrive(letter);
              }
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <Fact icon={drive.ejected ? <EjectOutlined /> : undefined}>{drive.state}</Fact>
      {drive.volume && <Fact>Volume {drive.volume}</Fact>}
      {drive.readOnly ? (
        <Fact icon={<LockOutlined />}>Read-only</Fact>
      ) : (
        <Fact>Writes go to a copy: the image is never changed.</Fact>
      )}
      {(drive.set.length > 1 || drive.set.some((disk) => disk.written)) && (
        <List dense disablePadding aria-label={`Disks for ${letter}:`}>
          {drive.set.map((disk, at) => (
            <ListItem key={at} disableGutters sx={{ py: 0, alignItems: 'flex-start' }}>
              <ListItemIcon sx={{ minWidth: 24, mt: '3px', '& svg': { fontSize: '1rem' } }}>
                {disk.inserted ? <RadioButtonChecked /> : <RadioButtonUnchecked />}
              </ListItemIcon>
              <ListItemText
                primary={
                  <>
                    {disk.text}
                    {disk.written && (
                      <EditOutlined
                        sx={{ fontSize: '0.9rem', ml: 0.5, verticalAlign: 'text-bottom' }}
                      />
                    )}
                  </>
                }
                slotProps={{
                  primary: {
                    variant: 'body2',
                    sx: { fontWeight: disk.inserted ? 600 : 'normal', overflowWrap: 'anywhere' },
                  },
                }}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Fact>{drive.kept}</Fact>
    </DriveCard>
  );
}

function Needed({ needed }: { needed: NeededRow }) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <Row>
      <Code>{needed.text}</Code>
      <Button aria-label={needed.label} onClick={() => actions.chooseImages(input.current!)}>
        Choose…
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={needed.accept}
        aria-label={`Choose ${needed.name} again`}
        onChange={(event) => actions.imagesChosen([...(event.target.files ?? [])])}
      />
    </Row>
  );
}

export function DrivesPanel({ view }: { view: PageView }) {
  const images = useRef<HTMLInputElement>(null);

  return (
    <Section id="drives-section" headingId="drives-heading" labelled title="Drives">
      <Note id="drives-note">{view.drivesNote}</Note>
      <HardDiskC c={view.c} />
      <Box
        component="ul"
        id="drives"
        aria-label="Drives of images"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {view.drives.map((drive) => (
          <Drive key={drive.letter} drive={drive} />
        ))}
      </Box>
      <Card
        variant="outlined"
        hidden={!view.needed.length}
        sx={view.needed.length ? { p: 1.5 } : { display: 'none' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ color: 'text.secondary', pt: 0.25, display: 'flex' }}>
            <ImageSearchOutlined />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" variant="subtitle2" id="needed-heading">
              Images to choose again
            </Typography>
            <Note>
              A kept program is run with these; the page could not open them again. Choose or drop
              each.
            </Note>
            <Rows id="needed" label="Images to choose again" hidden={!view.needed.length}>
              {view.needed.map((needed) => (
                <Needed key={`${needed.letter}\n${needed.name}`} needed={needed} />
              ))}
            </Rows>
          </Box>
        </Stack>
      </Card>
      <Box>
        <Button id="choose-images" onClick={() => actions.chooseImages(images.current!)}>
          Add images…
        </Button>
        <input
          id="image-picker"
          ref={images}
          type="file"
          multiple
          hidden
          accept={IMAGES}
          aria-label="Images to add as drives"
          onChange={(event) => {
            actions.imagesChosen([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </Box>
      <FormControlLabel
        control={
          <Checkbox
            id="keep-images"
            size="small"
            checked={view.keepImages}
            onChange={(event) => actions.setKeepImages(event.target.checked)}
          />
        }
        label="Keep copies of a kept program's images in this browser"
      />
    </Section>
  );
}
