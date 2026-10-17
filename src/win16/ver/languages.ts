'use strict';

/**
 * VER's names of languages: its string table's strings, by their numbers,
 * as `VER.DLL` holds them (its `RT_STRING` resources 1, 65-67, 129, 130,
 * 193 and 257). `VerLanguageName` gives these; a number with none gives
 * string nought's. As `crates/winbox-win16/src/ver/languages.rs`.
 */
export const LANGUAGES = new Map<number, string>([
  [0x401, 'Arabic'],
  [0x402, 'Bulgarian'],
  [0x403, 'Catalan'],
  [0x404, 'Traditional Chinese'],
  [0x405, 'Czech'],
  [0x406, 'Danish'],
  [0x407, 'German'],
  [0x408, 'Greek'],
  [0x409, 'U.S. English'],
  [0x40a, 'Castilian Spanish'],
  [0x40b, 'Finnish'],
  [0x40c, 'French'],
  [0x40d, 'Hebrew'],
  [0x40e, 'Hungarian'],
  [0x40f, 'Icelandic'],
  [0x410, 'Italian'],
  [0x411, 'Japanese'],
  [0x412, 'Korean'],
  [0x413, 'Dutch'],
  [0x414, 'Norwegian - Bokmal'],
  [0x415, 'Polish'],
  [0x416, 'Brazilian Portuguese'],
  [0x417, 'Rhaeto-Romanic'],
  [0x418, 'Romanian'],
  [0x419, 'Russian'],
  [0x41a, 'Croato-Serbian (latin)'],
  [0x41b, 'Slovak'],
  [0x41c, 'Albanian'],
  [0x41d, 'Swedish'],
  [0x41e, 'Thai'],
  [0x41f, 'Turkish'],
  [0x420, 'Urdu'],
  [0x421, 'Bahasa'],
  [0x804, 'Simplified Chinese'],
  [0x807, 'Swiss German'],
  [0x809, 'U.K. English'],
  [0x80a, 'Mexican Spanish'],
  [0x80c, 'Belgian French'],
  [0x810, 'Swiss Italian'],
  [0x813, 'Belgian Dutch'],
  [0x814, 'Norwegian - Nynorsk'],
  [0x816, 'Portuguese'],
  [0x81a, 'Serbo-Croatian (cyrillic)'],
  [0xc0c, 'Canadian French'],
  [0x100c, 'Swiss French'],
]);

/** String nought's: the name of a language VER has none for. */
export const UNKNOWN_LANGUAGE = 'Unknown Language';
