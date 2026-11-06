/**
 * The drives of images, each with what may be done with it -- and images
 * dropped on a drive's row go in its set, as "Add to" chooses them from the
 * keyboard -- and the images a kept program asks for again.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import { useRef, useState } from 'react';
import { actions } from '../page/actions.js';
import { type DriveRow, type NeededRow, type PageView } from '../page/view.js';
import { Actions, Code, Row, Rows } from './panels.js';
import { Note, Section } from './section.js';

/** The extensions of the images a drive takes. */
const IMAGES = '.img,.ima,.dsk,.vfd,.iso,.bin,.cue';

function Drive({ drive }: { drive: DriveRow }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { letter } = drive;

  return (
    <Box
      component="li"
      aria-label={drive.label}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        actions.drop(event.dataTransfer, letter);
      }}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        outline: over ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
      }}
    >
      <Code title={drive.kind}>{drive.text}</Code>
      <Actions>
        {drive.next && (
          <>
            <NativeSelect
              value={String(drive.current)}
              onChange={(event) => actions.insertDisk(letter, Number(event.target.value))}
              input={<OutlinedInput size="small" />}
              inputProps={{ 'aria-label': `Disk in ${letter}:` }}
              sx={{ maxWidth: '100%' }}
            >
              {drive.disks.map((disk, at) => (
                <option key={at} value={String(at)}>
                  {disk}
                </option>
              ))}
            </NativeSelect>
            <Button aria-label={`Next disk in ${letter}:`} onClick={() => actions.nextDisk(letter)}>
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
          <Button aria-label={`Eject ${letter}:`} onClick={() => actions.ejectDisk(letter)}>
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
        <Button aria-label={`Remove ${letter}:`} onClick={() => actions.removeDrive(letter)}>
          Remove
        </Button>
      </Actions>
    </Box>
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
      <Box
        component="ul"
        id="drives"
        aria-label="Drives of images"
        sx={{ listStyle: 'none', m: 0, p: 0 }}
      >
        {view.drives.map((drive) => (
          <Drive key={drive.letter} drive={drive} />
        ))}
      </Box>
      <Rows id="needed" label="Images to choose again" hidden={!view.needed.length}>
        {view.needed.map((needed) => (
          <Needed key={`${needed.letter}\n${needed.name}`} needed={needed} />
        ))}
      </Rows>
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
