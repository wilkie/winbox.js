//! Program Manager's groups (`kb/formats/grp.md`): its `.GRP` files and
//! `PROGMAN.INI`'s `[Groups]` and `Order=`, read and written as
//! `PROGMAN.EXE` reads and writes them, as pure code -- no task, no disk.
//!
//! - `read_group` / `write_group`: a group file as a model (`Group`,
//!   `Item`) and back, byte for byte, the checksum included. The model keeps
//!   where each block lay (`layout`) and the order of the tags (`tags`), so
//!   a file Program Manager wrote comes back as it was; a model made fresh
//!   is laid out as Program Manager lays out a group made and filled in
//!   slot order.
//! - `GroupFile`: the group's block as Program Manager keeps it in memory,
//!   and its own operations on it (seg4 `0741` new slot, `0899` add data,
//!   `081e` delete data, `0ae6` add tag, `1061` an item made, `15a8`
//!   deleted, `248f` renamed, `2518` saved, `17ae` icons refreshed, `04a5`
//!   written): what a stand-in changes a group with, so its files are
//!   Program Manager's.
//! - `group_keys` / `groups_ini_writes`: `PROGMAN.INI` read as start-up
//!   reads it (seg3 `06c1`-`08a3`) and written as `CreateGroup` and saving
//!   write it (seg4 `2662`-`2826`); `groups_of` the groups on a flattened
//!   stack.
//!
//! Strings are bytes. The TypeScript engine's twin is
//! `src/layers/groups.ts`; the two are held to `test/layers/groups.json`
//! (`tests/groups.rs`).

use std::collections::{BTreeMap, BTreeSet};

use crate::layers::Flat;
use crate::profile::Profile;

/// `PMCC`, the first four bytes of a group file and of its tag section.
const MAGIC: [u8; 4] = *b"PMCC";

/// The header's size before `rgiItems`.
const HEADER: usize = 0x22;

/// An item's `ITEMDEF`.
const ITEMDEF: usize = 0x18;

/// The first tag, `PMCC` after it (seg4 `00fd`-`0120`).
pub const TAG_START: u16 = 0x8000;
/// The program's directory, a string.
pub const TAG_DIRECTORY: u16 = 0x8101;
/// The hot key, a word.
pub const TAG_HOTKEY: u16 = 0x8102;
/// Run minimized, no data.
pub const TAG_MINIMIZED: u16 = 0x8103;
/// The end of the tags.
pub const TAG_END: u16 = 0xffff;

/// Slots a group may hold: slot 32h is refused with message 73h (seg4 `1263`).
pub const MAX_SLOTS: u16 = 0x32;

/// Message 4Ah, out of memory: a group past 64K (seg4 `0793`, `08da`).
pub const ERROR_MEMORY: u16 = 0x4a;
/// Message 73h, "already contains the maximum number of items" (seg4 `1268`).
pub const ERROR_FULL: u16 = 0x73;

/// The tags an item's fields make, in the order `CreateNewItem` adds them.
const ITEM_TAGS: [u16; 3] = [TAG_HOTKEY, TAG_MINIMIZED, TAG_DIRECTORY];

/// The screen's icon: `SM_CXICON`, `SM_CYICON`, `BITSPIXEL`, `PLANES`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconMetrics {
    pub cx: u16,
    pub cy: u16,
    pub bits_pixel: u8,
    pub planes: u8,
}

/// An item's icon as `DumpIcon` gave it (`CURSORICONINFO`, then the AND
/// plane, then the XOR plane). `header` is kept only where the header is
/// not the 12 bytes these fields are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Icon {
    pub hot_x: u16,
    pub hot_y: u16,
    pub cx: u16,
    pub cy: u16,
    pub width_bytes: u16,
    pub planes: u8,
    pub bits_pixel: u8,
    pub and: Vec<u8>,
    pub xor: Vec<u8>,
    pub header: Option<Vec<u8>>,
}

/// An item of a group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// Its slot in `rgiItems`.
    pub slot: u16,
    pub name: Vec<u8>,
    /// The command as Program Manager runs it: the program's directory, its
    /// file name and arguments (seg4 `2967`).
    pub command: Vec<u8>,
    /// The working directory, as read back (seg4 `2a52`-`2a70`).
    pub directory: Vec<u8>,
    /// `pCommand` as stored: the working directory, the file name and
    /// arguments (seg4 `1071`-`116b`).
    pub stored: Vec<u8>,
    /// Tag `8101h`: the program's directory, its trailing `\` kept; none
    /// without the tag.
    pub program_directory: Option<Vec<u8>>,
    pub icon_path: Vec<u8>,
    pub icon_index: u16,
    /// The icon's top left in the group's window, as last written.
    pub x: i16,
    pub y: i16,
    /// Tag `8102h`, 0 without it.
    pub hot_key: u16,
    /// Tag `8103h`.
    pub minimized: bool,
    /// None where the item has no icon blocks (pointers and sizes nought).
    pub icon: Option<Icon>,
}

/// A block of an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemPart {
    Item,
    ItemName,
    Command,
    IconPath,
    Header,
    And,
    Xor,
}

impl ItemPart {
    /// The order `CreateNewItem` adds them (seg4 `127f`-`1387`).
    const ALL: [Self; 7] = [
        Self::Item,
        Self::ItemName,
        Self::Command,
        Self::IconPath,
        Self::Header,
        Self::And,
        Self::Xor,
    ];

    /// Its name, as the fixture writes it.
    pub fn name(self) -> &'static str {
        match self {
            Self::Item => "item",
            Self::ItemName => "itemName",
            Self::Command => "command",
            Self::IconPath => "iconPath",
            Self::Header => "header",
            Self::And => "and",
            Self::Xor => "xor",
        }
    }

    /// Its pointer within the ITEMDEF.
    fn field(self) -> usize {
        match self {
            Self::Item => 0,
            Self::ItemName => 0x12,
            Self::Command => 0x14,
            Self::IconPath => 0x16,
            Self::Header => 0x0c,
            Self::And => 0x0e,
            Self::Xor => 0x10,
        }
    }

    fn icon(self) -> bool {
        matches!(self, Self::Header | Self::And | Self::Xor)
    }
}

/// A block of a group's data, in the order the file has them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Name,
    Item { part: ItemPart, slot: u16 },
    Gap(Vec<u8>),
}

/// A tag record in the file's order. `data` is kept where it is not what
/// the item's field would make (a second record of the same tag, an id
/// Program Manager does not write, a size it does not use); otherwise the
/// record is made from the item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tag {
    pub id: u16,
    pub item: u16,
    pub data: Option<Vec<u8>>,
}

/// A group file's contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub name: Vec<u8>,
    /// `nCmdShow`: nought until settings are saved.
    pub show: u16,
    pub rc_normal: [i16; 4],
    pub pt_min: [i16; 2],
    pub cx_icon: u16,
    pub cy_icon: u16,
    pub bits_pixel: u8,
    pub planes: u8,
    /// The word at `1Eh`.
    pub reserved: u16,
    /// `cItems`: slots, not items.
    pub slots: u16,
    /// In slot order.
    pub items: Vec<Item>,
    /// Where the blocks lie; none to lay them out as a group filled in slot
    /// order does.
    pub layout: Option<Vec<Block>>,
    /// The tags between the first and the end; none where the file has no
    /// tag section.
    pub tags: Option<Vec<Tag>>,
}

/// A string's bytes and its nought.
fn sz(text: &[u8]) -> Vec<u8> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    bytes
}

fn word(data: &[u8], at: usize) -> u16 {
    let low = data.get(at).copied().unwrap_or(0);
    let high = data.get(at + 1).copied().unwrap_or(0);

    u16::from_le_bytes([low, high])
}

fn set_word(data: &mut [u8], at: usize, value: u16) {
    data[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// The string at an offset, to its nought or the end of the data.
fn c_string(data: &[u8], at: usize) -> Vec<u8> {
    let rest = data.get(at..).unwrap_or(&[]);
    let end = rest
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(rest.len());

    rest[..end].to_vec()
}

/// Bytes `from..to` of the data, as much of them as there is.
fn span(data: &[u8], from: usize, to: usize) -> Vec<u8> {
    let to = to.min(data.len());

    data.get(from.min(to)..to).unwrap_or(&[]).to_vec()
}

/// Whether the tag section begins as Program Manager's must (seg4
/// `00e6`-`0120`).
fn tags_begin(data: &[u8]) -> bool {
    let at = usize::from(word(data, 6));

    at + 10 <= data.len()
        && word(data, at) == TAG_START
        && word(data, at + 2) == 0xffff
        && word(data, at + 4) == 10
        && data[at + 6..at + 10] == MAGIC
}

/// How much of the block is the file (seg4 `00d5`): through the end tag
/// where the tag section is valid, else `cbGroup`. Program Manager walks to
/// its block's `GlobalSize`; here the block is as long as its bytes. A tag
/// of size nought, which Program Manager would walk forever, ends the walk.
pub fn group_length(data: &[u8]) -> usize {
    let cb_group = usize::from(word(data, 6));

    if !tags_begin(data) {
        return cb_group;
    }

    let mut at = cb_group;

    while at + 6 <= data.len() {
        if word(data, at) == TAG_END {
            return at + 6;
        }

        let size = usize::from(word(data, at + 4));

        if size == 0 {
            break;
        }

        at += size;
    }

    cb_group
}

/// The 16-bit sum of the file's words (seg4 `014c`); an odd last byte is
/// left out.
pub fn group_sum(data: &[u8]) -> u16 {
    (0..group_length(data) / 2).fold(0u16, |sum, at| sum.wrapping_add(word(data, at * 2)))
}

/// Why Program Manager would not load a file, or none: message 4Bh,
/// "invalid or damaged", for a file shorter than `24h`, `cbGroup` past its
/// end, a sum not nought, no `PMCC` (seg4 `0389`-`03b3`), no slots or an
/// item's offset past `cbGroup` (`1c95`-`1d1e`). An item whose `ITEMDEF`
/// runs past the file, which Program Manager would read beyond its block,
/// is refused too.
pub fn group_refusal(data: &[u8]) -> Option<String> {
    if data.len() < 0x24 {
        return Some("shorter than its header".into());
    }

    let cb_group = word(data, 6);

    if usize::from(cb_group) > data.len() {
        return Some("cbGroup past the end".into());
    }

    if group_sum(data) != 0 {
        return Some("checksum".into());
    }

    if data[..4] != MAGIC {
        return Some("not PMCC".into());
    }

    let slots = word(data, 0x20);

    if slots == 0 {
        return Some("no slots".into());
    }

    for slot in 0..slots {
        let def = usize::from(word(data, HEADER + usize::from(slot) * 2));

        if def == 0 {
            continue;
        }

        if def + ITEMDEF > data.len() {
            return Some(format!("item {slot} past the end"));
        }

        if [0x12, 0x14, 0x16, 0x0c, 0x0e, 0x10]
            .iter()
            .any(|field| word(data, def + field) > cb_group)
        {
            return Some(format!("item {slot} past cbGroup"));
        }
    }

    None
}

/// A tag's value as `GetTagValue` reads one (seg4 `0c5a`): size 6 is 1, 7
/// a byte, 8 a word, else nought.
fn tag_value(data: &[u8]) -> u16 {
    match data.len() {
        0 => 1,
        1 => u16::from(data[0]),
        2 => word(data, 0),
        _ => 0,
    }
}

/// Where a command's path ends (after its last `:` or `\`) and its program
/// part ends (at its first space, or `stop`), as seg4 `1095`-`10d5` and
/// `29fa`-`2a29` walk it.
fn command_parts(command: &[u8], stop_at_nought: bool) -> (usize, usize) {
    let mut end = 0;
    let mut file = 0;

    while end < command.len() && command[end] != b' ' && !(stop_at_nought && command[end] == 0) {
        end += 1;

        if command[end - 1] == b':' || command[end - 1] == b'\\' {
            file = end;
        }
    }

    (file, end)
}

/// A command stored, and the program's directory tag, as `CreateNewItem`
/// makes them (`store_command`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stored {
    pub stored: Vec<u8>,
    pub program_directory: Vec<u8>,
}

/// The stored command and the program's directory tag for a command and a
/// working directory, as `CreateNewItem` makes them (seg4 `1071`-`116b`):
/// with a directory (its leading spaces dropped and cut at a space, seg6
/// `0000`; a `\` added where the directory as given does not end in one),
/// the directory, the program's file name and its arguments; without, the
/// command as given. The tag is the command's path up to its last `:` or
/// `\`, empty where there is none.
pub fn store_command(command: &[u8], directory: Option<&[u8]>) -> Stored {
    let (file, end) = command_parts(command, true);
    let program_directory = command[..file].to_vec();
    let stored = match directory {
        None => command.to_vec(),
        Some(directory) => {
            let start = directory
                .iter()
                .position(|&byte| byte != b' ')
                .unwrap_or(directory.len());
            let kept = &directory[start..];
            let cut = kept
                .iter()
                .position(|&byte| byte == b' ')
                .unwrap_or(kept.len());
            let mut stored = kept[..cut].to_vec();

            if directory.last().is_some_and(|&last| last != b'\\') {
                stored.push(b'\\');
            }

            stored.extend_from_slice(&command[file..end]);
            stored.extend_from_slice(&command[end..]);
            stored
        }
    };

    Stored {
        stored,
        program_directory,
    }
}

/// The command and working directory an item runs with, from its stored
/// command and directory tag (seg4 `2967`-`2a85`): the tag, then the stored
/// command's file name and arguments; the stored command's path, its last
/// `\` dropped unless it follows a `:`.
pub fn command_of(stored: &[u8], program_directory: Option<&[u8]>) -> (Vec<u8>, Vec<u8>) {
    let (file, end) = command_parts(stored, false);
    let mut command = program_directory.unwrap_or(&[]).to_vec();

    command.extend_from_slice(&stored[file..end]);
    command.extend_from_slice(&stored[end..]);

    let mut directory = stored[..file].to_vec();

    if file > 0 && directory[file - 1] == b'\\' && (file < 2 || directory[file - 2] != b':') {
        directory.truncate(file - 1);
    }

    (command, directory)
}

/// An icon's header, the 12 bytes of `CURSORICONINFO`.
fn icon_header(icon: &Icon) -> Vec<u8> {
    if let Some(header) = &icon.header {
        return header.clone();
    }

    let mut header = vec![0; 12];

    set_word(&mut header, 0, icon.hot_x);
    set_word(&mut header, 2, icon.hot_y);
    set_word(&mut header, 4, icon.cx);
    set_word(&mut header, 6, icon.cy);
    set_word(&mut header, 8, icon.width_bytes);
    header[10] = icon.planes;
    header[11] = icon.bits_pixel;
    header
}

fn icon_of(header: Vec<u8>, and: Vec<u8>, xor: Vec<u8>) -> Icon {
    Icon {
        hot_x: word(&header, 0),
        hot_y: word(&header, 2),
        cx: word(&header, 4),
        cy: word(&header, 6),
        width_bytes: word(&header, 8),
        planes: header.get(10).copied().unwrap_or(0),
        bits_pixel: header.get(11).copied().unwrap_or(0),
        and,
        xor,
        header: (header.len() != 12).then_some(header),
    }
}

/// A block's bytes, made from the model.
fn block_bytes(
    group: &Group,
    block: &Block,
    items: &BTreeMap<u16, &Item>,
) -> Result<Vec<u8>, String> {
    let (part, slot) = match block {
        Block::Gap(bytes) => return Ok(bytes.clone()),
        Block::Name => return Ok(sz(&group.name)),
        Block::Item { part, slot } => (*part, *slot),
    };
    let item = items
        .get(&slot)
        .ok_or_else(|| format!("a block of slot {slot}, which has no item"))?;
    let icon = || {
        item.icon
            .as_ref()
            .ok_or_else(|| format!("an icon block of slot {slot}, which has no icon"))
    };

    Ok(match part {
        ItemPart::Item => vec![0; ITEMDEF],
        ItemPart::ItemName => sz(&item.name),
        ItemPart::Command => sz(&item.stored),
        ItemPart::IconPath => sz(&item.icon_path),
        ItemPart::Header => icon_header(icon()?),
        ItemPart::And => icon()?.and.clone(),
        ItemPart::Xor => icon()?.xor.clone(),
    })
}

/// A block's place and size in the file, as `read_group` finds them.
struct Span {
    at: usize,
    size: usize,
    block: Block,
}

/// An item read from its ITEMDEF at `def`, and its blocks' spans; false
/// where its icon's pointers and sizes cannot be laid out again.
fn read_item(data: &[u8], slot: u16, def: usize, spans: &mut Vec<Span>) -> (Item, bool) {
    let at = |field: usize| usize::from(word(data, def + field));
    let name = c_string(data, at(0x12));
    let stored = c_string(data, at(0x14));
    let icon_path = c_string(data, at(0x16));
    let sizes = [at(0x06), at(0x08), at(0x0a)];
    let places = [at(0x0c), at(0x0e), at(0x10)];
    let has_icon = places.iter().all(|&place| place != 0);
    let laid_out = has_icon || places.iter().chain(&sizes).all(|&value| value == 0);
    let icon = has_icon.then(|| {
        icon_of(
            span(data, places[0], places[0] + sizes[0]),
            span(data, places[1], places[1] + sizes[1]),
            span(data, places[2], places[2] + sizes[2]),
        )
    });
    let mut push = |at: usize, size: usize, part: ItemPart| {
        spans.push(Span {
            at,
            size,
            block: Block::Item { part, slot },
        });
    };

    push(def, ITEMDEF, ItemPart::Item);
    push(at(0x12), name.len() + 1, ItemPart::ItemName);
    push(at(0x14), stored.len() + 1, ItemPart::Command);
    push(at(0x16), icon_path.len() + 1, ItemPart::IconPath);

    if has_icon {
        push(places[0], sizes[0], ItemPart::Header);
        push(places[1], sizes[1], ItemPart::And);
        push(places[2], sizes[2], ItemPart::Xor);
    }

    let item = Item {
        slot,
        name,
        command: Vec::new(),
        directory: Vec::new(),
        stored,
        program_directory: None,
        icon_path,
        icon_index: word(data, def + 4),
        x: word(data, def) as i16,
        y: word(data, def + 2) as i16,
        hot_key: 0,
        minimized: false,
        icon,
    };

    (item, laid_out)
}

/// The blocks in the order they lie, or none where they overlap or run
/// past `cbGroup`. Program Manager's blocks lie end to end after the
/// table: each added at `cbGroup`, each deleted closed up (seg4 `0899`,
/// `081e`). Bytes between them, which it never leaves, are kept.
fn layout_of(data: &[u8], mut spans: Vec<Span>, start: usize) -> Option<Vec<Block>> {
    let cb_group = usize::from(word(data, 6));
    let mut layout = Vec::new();
    let mut next = start;

    spans.sort_by_key(|span| span.at);

    for span in spans {
        if span.at < next || span.size == 0 {
            return None;
        }

        if span.at > next {
            layout.push(Block::Gap(data[next..span.at].to_vec()));
        }

        layout.push(span.block);
        next = span.at + span.size;
    }

    if next > cb_group {
        return None;
    }

    if next < cb_group {
        layout.push(Block::Gap(data[next..cb_group].to_vec()));
    }

    Some(layout)
}

/// A group file read into the model; refused where Program Manager would
/// not load it (`group_refusal`).
pub fn read_group(data: &[u8]) -> Result<Group, String> {
    if let Some(refusal) = group_refusal(data) {
        return Err(format!("not a group file Program Manager loads: {refusal}"));
    }

    let slots = word(data, 0x20);
    let p_name = usize::from(word(data, 0x16));
    let name = c_string(data, p_name);
    let mut items = Vec::new();
    let mut spans = vec![Span {
        at: p_name,
        size: name.len() + 1,
        block: Block::Name,
    }];
    let mut laid_out = true;

    for slot in 0..slots {
        let def = usize::from(word(data, HEADER + usize::from(slot) * 2));

        if def != 0 {
            let (item, item_laid_out) = read_item(data, slot, def, &mut spans);

            laid_out &= item_laid_out;
            items.push(item);
        }
    }

    let layout = layout_of(data, spans, HEADER + usize::from(slots) * 2).filter(|_| laid_out);
    let tags = read_tags(data, &mut items);

    for item in &mut items {
        (item.command, item.directory) =
            command_of(&item.stored, item.program_directory.as_deref());
    }

    let signed = |at: usize| word(data, at) as i16;

    Ok(Group {
        name,
        show: word(data, 0x08),
        rc_normal: [signed(0x0a), signed(0x0c), signed(0x0e), signed(0x10)],
        pt_min: [signed(0x12), signed(0x14)],
        cx_icon: word(data, 0x18),
        cy_icon: word(data, 0x1a),
        bits_pixel: data[0x1c],
        planes: data[0x1d],
        reserved: word(data, 0x1e),
        slots,
        items,
        layout,
        tags,
    })
}

/// The tag records between the first and the end, the items' tag fields
/// set from the first record of each (`FindTag` seg4 `096d` takes the
/// first). None without a valid section that reaches its end tag (seg4
/// `00d5`).
fn read_tags(data: &[u8], items: &mut [Item]) -> Option<Vec<Tag>> {
    let cb_group = usize::from(word(data, 6));

    if !tags_begin(data) || group_length(data) == cb_group {
        return None;
    }

    let mut seen = BTreeSet::new();
    let mut tags = Vec::new();
    let mut at = cb_group + 10;

    while word(data, at) != TAG_END {
        let size = usize::from(word(data, at + 4));
        let (id, slot) = (word(data, at), word(data, at + 2));
        let bytes = span(data, at + 6, at + size.max(6));
        let item = items.iter_mut().find(|item| item.slot == slot);
        let mut made = false;

        if let Some(item) = item
            && seen.insert((id, slot))
        {
            match id {
                TAG_DIRECTORY => {
                    let text = c_string(&bytes, 0);

                    made = bytes.len() == text.len() + 1;
                    item.program_directory = Some(text);
                }
                TAG_HOTKEY => {
                    item.hot_key = tag_value(&bytes);
                    made = bytes.len() == 2;
                }
                TAG_MINIMIZED => {
                    item.minimized = tag_value(&bytes) != 0;
                    made = bytes.is_empty();
                }
                _ => {}
            }
        }

        tags.push(Tag {
            id,
            item: slot,
            data: (!made).then_some(bytes),
        });
        at += size;
    }

    Some(tags)
}

/// A tag record's data made from its item.
fn tag_data(id: u16, item: &Item) -> Vec<u8> {
    match id {
        TAG_DIRECTORY => sz(item.program_directory.as_deref().unwrap_or(&[])),
        TAG_HOTKEY => item.hot_key.to_le_bytes().to_vec(),
        _ => Vec::new(),
    }
}

/// Whether an item has a value for a tag, as `CreateNewItem` adds them
/// (seg4 `13f5`-`1450`).
fn has_tag(id: u16, item: &Item) -> bool {
    match id {
        TAG_HOTKEY => item.hot_key != 0,
        TAG_MINIMIZED => item.minimized,
        _ => item
            .program_directory
            .as_ref()
            .is_some_and(|text| !text.is_empty()),
    }
}

/// A tag record: id, item, size counting its own six bytes (nought for the
/// end), data.
fn tag_record(id: u16, item: u16, data: &[u8], end: bool) -> Vec<u8> {
    let size = if end { 0 } else { data.len() as u16 + 6 };
    let mut record = Vec::with_capacity(6 + data.len());

    record.extend_from_slice(&id.to_le_bytes());
    record.extend_from_slice(&item.to_le_bytes());
    record.extend_from_slice(&size.to_le_bytes());
    record.extend_from_slice(data);
    record
}

/// The tag section `write_group` writes: `tags`' records, then any an item
/// has that are not listed; none without either.
fn tag_records(group: &Group, items: &BTreeMap<u16, &Item>) -> Vec<Vec<u8>> {
    let any = items
        .values()
        .any(|item| ITEM_TAGS.iter().any(|&id| has_tag(id, item)));

    if group.tags.is_none() && !any {
        return Vec::new();
    }

    let mut listed = BTreeSet::new();
    let mut records = vec![tag_record(TAG_START, 0xffff, &MAGIC, false)];

    for tag in group.tags.iter().flatten() {
        let item = items.get(&tag.item);

        if item.is_some() {
            listed.insert((tag.id, tag.item));
        }

        if let Some(data) = &tag.data {
            records.push(tag_record(tag.id, tag.item, data, false));
        } else if let Some(item) = item {
            records.push(tag_record(tag.id, tag.item, &tag_data(tag.id, item), false));
        }
    }

    for item in items.values() {
        for id in ITEM_TAGS {
            if has_tag(id, item) && !listed.contains(&(id, item.slot)) {
                records.push(tag_record(id, item.slot, &tag_data(id, item), false));
            }
        }
    }

    records.push(tag_record(TAG_END, 0xffff, &[], true));
    records
}

/// A group file from the model, as Program Manager writes it (seg4
/// `04a5`): the header, the table, the blocks in `layout`'s order (a group
/// filled in slot order's where it is none: its name, then each item's
/// `ITEMDEF`, name, command, icon path, icon header, AND and XOR planes),
/// the tags in `tags`' order and then any an item has that are not listed
/// (in slot order, `8102h`, `8103h`, `8101h`, as `CreateNewItem` adds
/// them), and the checksum.
pub fn write_group(group: &Group) -> Result<Vec<u8>, String> {
    let items: BTreeMap<u16, &Item> = group.items.iter().map(|item| (item.slot, item)).collect();
    let slots = items
        .keys()
        .map(|&slot| slot + 1)
        .fold(group.slots.max(1), u16::max);
    let canonical = || {
        let mut layout = vec![Block::Name];

        for item in items.values() {
            for part in ItemPart::ALL {
                if item.icon.is_some() || !part.icon() {
                    layout.push(Block::Item {
                        part,
                        slot: item.slot,
                    });
                }
            }
        }

        layout
    };
    let layout = group.layout.clone().unwrap_or_else(canonical);
    let blocks = layout
        .iter()
        .map(|block| block_bytes(group, block, &items))
        .collect::<Result<Vec<_>, _>>()?;
    let records = tag_records(group, &items);
    let start = HEADER + usize::from(slots) * 2;
    let cb_group = start + blocks.iter().map(Vec::len).sum::<usize>();
    let length = cb_group + records.iter().map(Vec::len).sum::<usize>();

    if length > 0x10000 {
        return Err("a group past 64K".into());
    }

    let mut data = vec![0; length];

    data[..4].copy_from_slice(&MAGIC);
    set_word(&mut data, 0x06, cb_group as u16);
    set_word(&mut data, 0x08, group.show);

    for (index, value) in group.rc_normal.iter().chain(&group.pt_min).enumerate() {
        set_word(&mut data, 0x0a + index * 2, *value as u16);
    }

    set_word(&mut data, 0x18, group.cx_icon);
    set_word(&mut data, 0x1a, group.cy_icon);
    data[0x1c] = group.bits_pixel;
    data[0x1d] = group.planes;
    set_word(&mut data, 0x1e, group.reserved);
    set_word(&mut data, 0x20, slots);
    place_blocks(&mut data, &layout, &blocks, &items, start);

    let mut at = cb_group;

    for record in &records {
        data[at..at + record.len()].copy_from_slice(record);
        at += record.len();
    }

    let sum = group_sum(&data);

    set_word(&mut data, 4, sum.wrapping_neg());
    Ok(data)
}

/// The blocks put in their places from `start`, the header's and each
/// ITEMDEF's pointers set. An ITEMDEF may lie after its own blocks, so its
/// pointers are set once every block has its place.
fn place_blocks(
    data: &mut [u8],
    layout: &[Block],
    blocks: &[Vec<u8>],
    items: &BTreeMap<u16, &Item>,
    start: usize,
) {
    let mut places = Vec::new();
    let mut at = start;

    for (block, bytes) in layout.iter().zip(blocks) {
        data[at..at + bytes.len()].copy_from_slice(bytes);

        match block {
            Block::Name => set_word(data, 0x16, at as u16),
            Block::Item {
                part: ItemPart::Item,
                slot,
            } => {
                let item = items[slot];
                let icon = item.icon.as_ref();

                set_word(data, HEADER + usize::from(*slot) * 2, at as u16);
                set_word(data, at, item.x as u16);
                set_word(data, at + 0x02, item.y as u16);
                set_word(data, at + 0x04, item.icon_index);
                set_word(
                    data,
                    at + 0x06,
                    icon.map_or(0, |icon| icon_header(icon).len() as u16),
                );
                set_word(
                    data,
                    at + 0x08,
                    icon.map_or(0, |icon| icon.and.len() as u16),
                );
                set_word(
                    data,
                    at + 0x0a,
                    icon.map_or(0, |icon| icon.xor.len() as u16),
                );
            }
            Block::Item { part, slot } => places.push((*slot, part.field(), at)),
            Block::Gap(_) => {}
        }

        at += bytes.len();
    }

    for (slot, field, place) in places {
        let def = usize::from(word(data, HEADER + usize::from(slot) * 2));

        set_word(data, def + field, place as u16);
    }
}

/// What `CreateNewItem` puts in a group for an item (seg4 `1254`-`1450`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub name: Vec<u8>,
    /// As stored (`store_command`).
    pub stored: Vec<u8>,
    pub icon_path: Vec<u8>,
    /// As `ExtractAssociatedIcon` wrote it back.
    pub icon_index: u16,
    /// `DumpIcon`'s three blocks.
    pub header: Vec<u8>,
    pub and: Vec<u8>,
    pub xor: Vec<u8>,
    /// Where the item was placed: its icon's top left.
    pub x: i16,
    pub y: i16,
    pub hot_key: u16,
    pub minimized: bool,
    /// Tag `8101h`'s string; none where empty.
    pub program_directory: Vec<u8>,
}

/// An icon extracted again for `GroupFile::refresh_icons`: the index
/// written back and `DumpIcon`'s three blocks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extracted {
    pub icon_index: u16,
    pub header: Vec<u8>,
    pub and: Vec<u8>,
    pub xor: Vec<u8>,
}

/// A window's placement as saving puts it in the header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub show: u16,
    pub rc_normal: [i16; 4],
    pub pt_min: [i16; 2],
}

/// An item of the group's window, in the window's order, for saving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placed {
    pub slot: u16,
    pub x: i16,
    pub y: i16,
}

/// A group's block as Program Manager keeps it in memory, and its
/// operations on it, each as read out of seg4. Program Manager writes the
/// block after each change (`bytes()` is what it writes); where a change
/// fails it lets the block go and reads the file again (seg4
/// `157c`-`1589`), which here is the block as it was before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupFile {
    pub data: Vec<u8>,
}

impl GroupFile {
    pub fn new(data: &[u8]) -> Self {
        Self {
            data: data.to_vec(),
        }
    }

    /// A new group (seg4 `2178`-`229e`): the header, one empty slot, the
    /// name.
    pub fn create(name: &[u8], metrics: IconMetrics) -> Self {
        let mut data = vec![0; name.len() + 0x25];
        let length = data.len() as u16;

        data[..4].copy_from_slice(&MAGIC);
        set_word(&mut data, 0x06, length);
        set_word(&mut data, 0x16, 0x24);
        set_word(&mut data, 0x18, metrics.cx);
        set_word(&mut data, 0x1a, metrics.cy);
        data[0x1c] = metrics.bits_pixel;
        data[0x1d] = metrics.planes;
        set_word(&mut data, 0x20, 1);
        data[0x24..0x24 + name.len()].copy_from_slice(name);

        let sum = group_sum(&data);

        set_word(&mut data, 4, sum.wrapping_neg());
        Self { data }
    }

    fn word(&self, at: usize) -> u16 {
        word(&self.data, at)
    }

    fn at(&self, at: usize) -> usize {
        usize::from(self.word(at))
    }

    fn set_word(&mut self, at: usize, value: u16) {
        set_word(&mut self.data, at, value);
    }

    fn cb_group(&self) -> usize {
        self.at(6)
    }

    fn slots(&self) -> u16 {
        self.word(0x20)
    }

    /// The offset of a slot's ITEMDEF, nought for an empty slot.
    pub fn def(&self, slot: u16) -> usize {
        self.at(HEADER + usize::from(slot) * 2)
    }

    pub fn length(&self) -> usize {
        group_length(&self.data)
    }

    /// What `WriteGroup` writes (seg4 `04ed`-`05e4`): the checksum set, the
    /// file's length of the block.
    pub fn bytes(&mut self) -> Vec<u8> {
        self.set_word(4, 0);

        let sum = group_sum(&self.data);

        self.set_word(4, sum.wrapping_neg());
        self.data[..self.length()].to_vec()
    }

    /// Every offset at or past `threshold` moved by `delta` (seg4 `066d`):
    /// `pName`, the table, each item's six pointers.
    pub fn fixup(&mut self, threshold: usize, delta: i32) {
        let moved = |value: u16| (i32::from(value) + delta) as u16;

        if self.at(0x16) >= threshold {
            self.set_word(0x16, moved(self.word(0x16)));
        }

        for slot in 0..self.slots() {
            let entry = HEADER + usize::from(slot) * 2;

            if self.at(entry) == 0 {
                continue;
            }

            if self.at(entry) >= threshold {
                self.set_word(entry, moved(self.word(entry)));
            }

            let def = self.at(entry);

            for field in [0x0c, 0x0e, 0x10, 0x12, 0x14, 0x16] {
                if self.at(def + field) >= threshold {
                    self.set_word(def + field, moved(self.word(def + field)));
                }
            }
        }
    }

    /// A slot for an item (seg4 `0741`): the first empty one; else the
    /// table grows by a word, everything after it moved up two and every
    /// offset mended. None past 64K.
    pub fn new_slot(&mut self) -> Option<u16> {
        if let Some(slot) = (0..self.slots()).find(|&slot| self.def(slot) == 0) {
            return Some(slot);
        }

        let length = self.length();

        if length + 2 > 0x10000 {
            return None;
        }

        let slot = self.slots();
        let end = HEADER + usize::from(slot) * 2;
        let cb_group = self.word(6);

        self.data.resize(length + 2, 0);
        self.set_word(6, cb_group + 2);
        self.data.copy_within(end..length, end + 2);
        self.set_word(end, 0);
        self.set_word(0x20, slot + 1);
        self.fixup(1, 2);
        Some(slot)
    }

    /// Bytes added at `cbGroup` (seg4 `0899`), the tags moved up after
    /// them: `size` bytes of `source`, or `source`'s string and nought where
    /// `size` is nought, or noughts without a source. Its offset; nought
    /// past 64K.
    pub fn add_data(&mut self, source: Option<&[u8]>, size: usize) -> usize {
        let size = match source {
            Some(source) if size == 0 => {
                source
                    .iter()
                    .position(|&byte| byte == 0)
                    .unwrap_or(source.len())
                    + 1
            }
            _ => size,
        };
        let length = self.length();

        if length + size > 0x10000 {
            return 0;
        }

        let at = self.cb_group();

        self.data.resize(length + size, 0);
        self.data.copy_within(at..length, at + size);
        self.set_word(6, (at + size) as u16);

        match source {
            Some(source) => {
                let copied = size.min(source.len());

                self.data[at..at + copied].copy_from_slice(&source[..copied]);
                self.data[at + copied..at + size].fill(0);
            }
            None => self.data[at..at + size].fill(0),
        }

        at
    }

    /// The block a pointer at `field` names taken out (seg4 `081e`): the
    /// pointer set nought, everything after the block moved down,
    /// `cbGroup` less, every offset past it mended. `size` nought is the
    /// string's.
    pub fn delete_data(&mut self, field: usize, size: usize) {
        let at = self.at(field);

        if at == 0 {
            return;
        }

        self.set_word(field, 0);

        let size = if size == 0 {
            c_string(&self.data, at).len() + 1
        } else {
            size
        };
        let length = self.length();
        let cb_group = self.cb_group();

        self.data.copy_within(at + size..length, at);
        self.set_word(6, (cb_group - size) as u16);
        self.fixup(at, -(size as i32));
    }

    /// The first tag of `item` (and of `id`, unless nought) from the
    /// section's start (seg4 `096d`).
    pub fn find_tag(&self, id: u16, item: u16) -> Option<usize> {
        if !tags_begin(&self.data) {
            return None;
        }

        let mut at = self.cb_group();

        while at + 6 <= self.data.len() {
            if self.word(at + 2) == item && (id == 0 || self.word(at) == id) {
                return Some(at);
            }

            if self.word(at) == TAG_END || self.word(at + 4) == 0 {
                return None;
            }

            at += self.at(at + 4);
        }

        None
    }

    /// The first tag of `id` and `item` taken out, the rest moved down
    /// (seg4 `0a69`).
    pub fn delete_tag(&mut self, id: u16, item: u16) {
        let Some(at) = self.find_tag(id, item) else {
            return;
        };
        let length = self.length();
        let size = self.at(at + 4);

        self.data.copy_within(at + size..length, at);
        self.data.truncate(length - size);
    }

    /// A tag added (seg4 `0ae6`): any of the same id and item taken out,
    /// the record put where the end tag was and the end after it; the first
    /// and the end written at `cbGroup` where there is no end tag. False
    /// past 64K.
    pub fn add_tag(&mut self, id: u16, item: u16, data: Option<&[u8]>) -> bool {
        self.delete_tag(id, item);

        let data = data.unwrap_or(&[]);
        let end = self.find_tag(TAG_END, 0xffff);
        let mut at = end.unwrap_or_else(|| self.cb_group());
        let need = data.len() + if end.is_none() { 0x16 } else { 0x0c };

        if at + need > 0xffff {
            return false;
        }

        self.data.resize(at + need, 0);

        let mut put = |at: usize, record: Vec<u8>| {
            self.data[at..at + record.len()].copy_from_slice(&record);
            record.len()
        };

        if end.is_none() {
            at += put(at, tag_record(TAG_START, 0xffff, &MAGIC, false));
        }

        at += put(at, tag_record(id, item, data, false));
        put(at, tag_record(TAG_END, 0xffff, &[], true));
        true
    }

    /// Every tag of item `from` made item `to` (seg4 `0d62`).
    pub fn retag(&mut self, from: u16, to: u16) {
        while let Some(at) = self.find_tag(0, from) {
            self.set_word(at + 2, to);
        }
    }

    /// An item put in the group as `CreateNewItem` puts it (seg4
    /// `1254`-`1450`): a slot, its ITEMDEF, name, command, icon path, icon
    /// header, AND and XOR planes, then its tags `8102h`, `8103h`, `8101h`.
    /// The slot, or the message Program Manager gives (`ERROR_MEMORY`,
    /// `ERROR_FULL`), the block then as it was.
    pub fn add_item(&mut self, item: &NewItem) -> Result<u16, u16> {
        let before = self.data.clone();
        let result = self.put_item(item);

        if result.is_err() {
            self.data = before;
        }

        result
    }

    fn put_item(&mut self, item: &NewItem) -> Result<u16, u16> {
        let slot = self.new_slot().ok_or(ERROR_MEMORY)?;

        if slot >= MAX_SLOTS {
            return Err(ERROR_FULL);
        }

        let def = self.add_data(None, ITEMDEF);

        if def == 0 {
            return Err(ERROR_MEMORY);
        }

        self.set_word(HEADER + usize::from(slot) * 2, def as u16);

        for (field, source, size) in [
            (0x12, sz(&item.name), 0),
            (0x14, sz(&item.stored), 0),
            (0x16, sz(&item.icon_path), 0),
            (0x0c, item.header.clone(), item.header.len()),
            (0x0e, item.and.clone(), item.and.len()),
            (0x10, item.xor.clone(), item.xor.len()),
        ] {
            let at = self.add_data(Some(&source), size);

            if at == 0 {
                return Err(ERROR_MEMORY);
            }

            self.set_word(def + field, at as u16);
        }

        self.set_word(def, item.x as u16);
        self.set_word(def + 0x02, item.y as u16);
        self.set_word(def + 0x04, item.icon_index);
        self.set_word(def + 0x06, item.header.len() as u16);
        self.set_word(def + 0x08, item.and.len() as u16);
        self.set_word(def + 0x0a, item.xor.len() as u16);

        if item.hot_key != 0 {
            self.add_tag(TAG_HOTKEY, slot, Some(&item.hot_key.to_le_bytes()));
        }

        if item.minimized {
            self.add_tag(TAG_MINIMIZED, slot, None);
        }

        if !item.program_directory.is_empty() {
            self.add_tag(TAG_DIRECTORY, slot, Some(&sz(&item.program_directory)));
        }

        Ok(slot)
    }

    /// An item taken out (seg4 `15e6`-`16d0`): its name, command, icon
    /// path, AND, XOR and header, then its ITEMDEF, the slot left nought;
    /// then every tag of its slot.
    pub fn delete_item(&mut self, slot: u16) {
        let def = self.def(slot);

        self.delete_data(def + 0x12, 0);
        self.delete_data(def + 0x14, 0);
        self.delete_data(def + 0x16, 0);
        self.delete_data(def + 0x0e, self.at(def + 0x08));
        self.delete_data(def + 0x10, self.at(def + 0x0a));
        self.delete_data(def + 0x0c, self.at(def + 0x06));
        self.delete_data(HEADER + usize::from(slot) * 2, ITEMDEF);

        while let Some(at) = self.find_tag(0, slot) {
            let (id, item) = (self.word(at), self.word(at + 2));

            self.delete_tag(id, item);
        }
    }

    /// The group's name taken out and added again, at the end of its data
    /// (seg4 `24cc`-`24fa`).
    pub fn rename(&mut self, name: &[u8]) {
        self.delete_data(0x16, 0);

        let at = self.add_data(Some(&sz(name)), 0);

        self.set_word(0x16, at as u16);
    }

    /// Settings saved into the group (seg4 `2518`-`2651`): its window's
    /// placement into the header; each item's place, from the window's
    /// items in their order; the slots made that order, the tags renumbered
    /// through the ITEMDEFs' offsets as keys, the slots after them nought.
    /// The new slot of each item given, in that order.
    pub fn save(&mut self, placement: Placement, items: &[Placed]) -> Vec<u16> {
        self.set_word(0x08, placement.show);

        for (index, value) in placement
            .rc_normal
            .iter()
            .chain(&placement.pt_min)
            .enumerate()
        {
            self.set_word(0x0a + index * 2, *value as u16);
        }

        let keys: Vec<usize> = items
            .iter()
            .map(|item| {
                let def = self.def(item.slot);

                self.set_word(def, item.x as u16);
                self.set_word(def + 2, item.y as u16);
                self.retag(item.slot, def as u16);
                def
            })
            .collect();

        for (slot, &def) in keys.iter().enumerate() {
            self.retag(def as u16, slot as u16);
            self.set_word(HEADER + slot * 2, def as u16);
        }

        for slot in keys.len()..usize::from(self.slots()) {
            self.set_word(HEADER + slot * 2, 0);
        }

        (0..keys.len() as u16).collect()
    }

    /// The icons made again for another display (seg4 `18b6`-`1aef`): the
    /// header's icon format and size; each item's header, AND and XOR taken
    /// out and its icon extracted again (`extract` given its icon path and
    /// index) and added at the end, in slot order. An item left without
    /// all three has none, its sizes nought.
    pub fn refresh_icons(
        &mut self,
        metrics: IconMetrics,
        mut extract: impl FnMut(&[u8], u16) -> Option<Extracted>,
    ) {
        self.data[0x1c] = metrics.bits_pixel;
        self.data[0x1d] = metrics.planes;
        self.set_word(0x18, metrics.cx);
        self.set_word(0x1a, metrics.cy);

        for slot in 0..self.slots() {
            let def = self.def(slot);

            if def == 0 {
                continue;
            }

            self.delete_icon(def);

            let icon = extract(
                &c_string(&self.data, self.at(def + 0x16)),
                self.word(def + 0x04),
            );
            let mut places = [0; 3];

            if let Some(icon) = icon {
                self.set_word(def + 0x04, icon.icon_index);

                for (place, block) in places.iter_mut().zip([&icon.header, &icon.and, &icon.xor]) {
                    *place = if block.is_empty() {
                        0
                    } else {
                        self.add_data(Some(block), block.len())
                    };
                }

                self.set_word(def + 0x0c, places[0] as u16);
                self.set_word(def + 0x0e, places[1] as u16);
                self.set_word(def + 0x10, places[2] as u16);
                self.set_word(def + 0x06, icon.header.len() as u16);
                self.set_word(def + 0x08, icon.and.len() as u16);
                self.set_word(def + 0x0a, icon.xor.len() as u16);
            }

            if places.contains(&0) {
                self.delete_icon(def);
                self.set_word(def + 0x06, 0);
                self.set_word(def + 0x08, 0);
                self.set_word(def + 0x0a, 0);
            }
        }
    }

    /// An item's header, AND and XOR taken out (seg4 `1900`-`1959`).
    fn delete_icon(&mut self, def: usize) {
        self.delete_data(def + 0x0c, self.at(def + 0x06));
        self.delete_data(def + 0x0e, self.at(def + 0x08));
        self.delete_data(def + 0x10, self.at(def + 0x0a));
    }
}

/// A `[Groups]` key as start-up loads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupKey {
    /// The key, upper case as start-up makes it (`AnsiUpper`, seg3 `0715`).
    pub key: Vec<u8>,
    /// Its number: the digits after `GROUP`; nought for none, which
    /// `LoadGroup` replaces.
    pub n: u16,
    /// The value: the group file's path.
    pub path: Vec<u8>,
}

/// `PROGMAN.INI`'s groups as start-up reads them (`group_keys`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupKeys {
    /// `Order=` as read.
    pub order: Vec<u8>,
    pub keys: Vec<GroupKey>,
}

/// A list of names as `GetPrivateProfileString` with no entry gives them
/// into a buffer of `size` bytes (`copyOutList`): two bytes held back, the
/// last name cut and ended; read as start-up reads it, to the first empty
/// name.
fn key_list(names: &[Vec<u8>], size: usize) -> Vec<Vec<u8>> {
    let text: Vec<u8> = names
        .iter()
        .flat_map(|name| name.iter().copied().chain([0]))
        .collect();
    let count = text.len().min(size - 2);

    text[..count.saturating_sub(1)]
        .split(|&byte| byte == 0)
        .take_while(|name| !name.is_empty())
        .map(<[u8]>::to_vec)
        .collect()
}

/// Whether a key is `GROUP`, then no nought, then only digits (seg3
/// `05e2`).
fn group_key(key: &[u8]) -> bool {
    key.starts_with(b"GROUP")
        && key.get(5) != Some(&b'0')
        && key[5..].iter().all(u8::is_ascii_digit)
}

/// `Order=`'s numbers matched to the keys as start-up matches them (seg3
/// `075d`-`07ff`): each key found moved to the end, the rest then moved
/// after them one by one in the file's order.
fn ordered(mut keys: Vec<Vec<u8>>, order: &[u8]) -> Vec<Vec<u8>> {
    let mut unmatched = keys.len() as u16;
    let mut at = 0;

    loop {
        while order.get(at) == Some(&b' ') {
            at += 1;
        }

        if !order.get(at).is_some_and(u8::is_ascii_digit) {
            break;
        }

        let mut wanted = b"GROUP".to_vec();

        while let Some(&digit) = order.get(at).filter(|digit| digit.is_ascii_digit()) {
            wanted.push(digit);
            at += 1;
        }

        if let Some(index) = keys.iter().position(|key| *key == wanted) {
            let key = keys.remove(index);

            keys.push(key);
            unmatched = unmatched.wrapping_sub(1);
        }
    }

    if !keys.is_empty() {
        for _ in 0..unmatched {
            let key = keys.remove(0);

            keys.push(key);
        }
    }

    keys
}

/// `PROGMAN.INI`'s groups in the order start-up loads them (seg3
/// `06c1`-`08a3`): `[Groups]`' keys (a buffer of 140h), upper case, those
/// of `GROUP` and digits not beginning with nought; those `Order=` (a
/// buffer of 7Fh) names, in its order, then the rest; each with a value (a
/// buffer of 78h) loaded, its number the digits'.
pub fn group_keys(ini: &[u8]) -> GroupKeys {
    let profile = Profile::new(ini);
    let keys: Vec<Vec<u8>> = key_list(&profile.entries(b"Groups"), 0x140)
        .into_iter()
        .map(|key| key.to_ascii_uppercase())
        .filter(|key| group_key(key))
        .collect();
    let mut order = profile.get(b"Settings", b"Order", true).unwrap_or_default();

    order.truncate(0x7e);

    let keys = ordered(keys, &order)
        .into_iter()
        .filter_map(|key| {
            let mut path = profile.get(b"Groups", &key, true).unwrap_or_default();

            path.truncate(0x77);

            let n = key[5..].iter().fold(0u16, |n, digit| {
                n.wrapping_mul(10).wrapping_add(u16::from(digit - b'0'))
            });

            (!path.is_empty()).then_some(GroupKey { key, n, path })
        })
        .collect();

    GroupKeys { order, keys }
}

/// A profile write: `[section]` `entry=value`, a value of none taking the
/// entry out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IniWrite {
    pub section: Vec<u8>,
    pub entry: Vec<u8>,
    pub value: Option<Vec<u8>>,
}

/// What `CreateGroup` and saving write of the groups (seg4
/// `2662`-`2826`): for each group window from the bottom of the MDI
/// client's children up (icon titles left out, and those whose path
/// `OpenFile`'s `OF_PARSE` refuses), `[Groups]` `GroupN=` its parsed path;
/// then `[Settings]` `Order=` a space and N for each. A 41st stops it.
pub fn groups_ini_writes(groups: &[(u16, Vec<u8>)]) -> Vec<IniWrite> {
    let mut writes = Vec::new();
    let mut order = Vec::new();

    for (n, path) in groups.iter().take(41) {
        let n = *n as i16;

        writes.push(IniWrite {
            section: b"Groups".to_vec(),
            entry: format!("Group{n}").into_bytes(),
            value: Some(path.clone()),
        });
        order.extend_from_slice(format!(" {n}").as_bytes());
    }

    writes.push(IniWrite {
        section: b"Settings".to_vec(),
        entry: b"Order".to_vec(),
        value: Some(order),
    });
    writes
}

/// What `DeleteGroup` writes (seg4 `23af`-`2417`): its key, and not
/// `Order=`.
pub fn delete_group_write(n: u16) -> IniWrite {
    IniWrite {
        section: b"Groups".to_vec(),
        entry: format!("Group{}", n as i16).into_bytes(),
        value: None,
    }
}

/// Profile writes applied to a file's text as `WritePrivateProfileString`
/// applies them: a value's trailing spaces and tabs dropped, one the same
/// as the file's left alone.
pub fn apply_ini_writes(ini: &[u8], writes: &[IniWrite]) -> Vec<u8> {
    let mut profile = Profile::new(ini);

    for write in writes {
        let value = write.value.as_ref().map(|value| {
            let end = value
                .iter()
                .rposition(|&byte| byte != b' ' && byte != b'\t')
                .map_or(0, |at| at + 1);

            value[..end].to_vec()
        });

        if value.is_some() && profile.get(&write.section, &write.entry, false) == value {
            continue;
        }

        profile.set(&write.section, &write.entry, value.as_deref());
    }

    profile.text()
}

/// The Windows directory on a stack, Program Manager's current directory.
const WINDOWS: &str = "WINDOWS";

/// A group file's path on the flattened drive, as `_lopen` from the
/// Windows directory finds it: `C:` and absolute, from the root, or from
/// the Windows directory; none for another drive. Letters made upper case
/// as the drive's paths are; a byte is a character, as a path's on the
/// flattened drive.
pub fn group_path(path: &[u8]) -> Option<String> {
    let upper = path.to_ascii_uppercase();
    let mut rest = upper.as_slice();

    if rest.len() >= 2 && rest[0].is_ascii_uppercase() && rest[1] == b':' {
        if rest[0] != b'C' {
            return None;
        }

        rest = &rest[2..];
    }

    let mut names: Vec<String> = if rest.first() == Some(&b'\\') {
        Vec::new()
    } else {
        vec![WINDOWS.to_string()]
    };

    for name in rest.split(|&byte| byte == b'\\') {
        match name {
            b"" | b"." => {}
            b".." => {
                names.pop();
            }
            _ => names.push(name.iter().map(|&byte| char::from(byte)).collect()),
        }
    }

    Some(names.join("\\"))
}

/// A group on a stack: its key, number and file, and the group, or why it
/// would not load.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StackGroup {
    pub key: GroupKey,
    pub file: Option<String>,
    pub group: Option<Group>,
    pub refusal: Option<String>,
}

/// The groups of a stack: `Order=` as read, and each group in the order
/// start-up loads them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Groups {
    pub order: Vec<u8>,
    pub groups: Vec<StackGroup>,
}

/// The groups on a flattened stack, as Program Manager would load them at
/// start-up: `PROGMAN.INI` in the Windows directory read by `group_keys`,
/// each file read by `read_group`. A key with no number takes the lowest
/// not yet taken by a group loaded (seg4 `1d5c`-`1d6d`). A stack without
/// `PROGMAN.INI` has no groups.
pub fn groups_of(flat: &Flat) -> Groups {
    let files: BTreeMap<&str, &[u8]> = flat
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.data.as_slice()))
        .collect();
    let Some(ini) = files.get(format!("{WINDOWS}\\PROGMAN.INI").as_str()) else {
        return Groups {
            order: Vec::new(),
            groups: Vec::new(),
        };
    };
    let GroupKeys { order, keys } = group_keys(ini);
    let mut taken = BTreeSet::new();
    let mut groups = Vec::new();

    for mut key in keys {
        if key.n == 0 {
            key.n = (1..=u16::MAX).find(|n| !taken.contains(n)).unwrap_or(0);
        }

        let file = group_path(&key.path);
        let data = file.as_deref().and_then(|file| files.get(file).copied());
        let refusal = data.map_or_else(|| Some("cannot be opened".to_string()), group_refusal);
        let group = data
            .filter(|_| refusal.is_none())
            .and_then(|data| read_group(data).ok());

        if group.is_some() {
            taken.insert(key.n);
        }

        groups.push(StackGroup {
            key,
            file,
            group,
            refusal,
        });
    }

    Groups { order, groups }
}
