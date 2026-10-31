'use strict';

/** @namespace Gdi */

import { ExportedData, emptyGpTable } from './exported-data.js';

import { AbortDoc, EndDoc, EndPage, SetAbortProc, StartDoc, StartPage } from './gdi/printing.js';
import {
  CloseMetaFile,
  CopyMetaFile,
  CreateMetaFile,
  DeleteMetaFile,
  EnumMetaFile,
  GetMetaFile,
  GetMetaFileBits,
  IsValidMetaFile,
  PlayMetaFile,
  PlayMetaFileRecord,
  SetMetaFileBits,
} from './gdi/metafile.js';
import { ExtFloodFill, FloodFill, LineDDA, PolyPolygon, SetDIBits } from './gdi/gdi-draw.js';
import {
  CreateBitmapIndirect,
  GetAspectRatioFilter,
  GetAspectRatioFilterEx,
  GetBitmapDimension,
  GetBitmapDimensionEx,
  GetBkMode,
  GetDCOrg,
  GetTextAlign,
  GetTextCharacterExtra,
  IsGDIObject,
  SetBitmapDimension,
  SetBitmapDimensionEx,
  SetMapperFlags,
} from './gdi/queries.js';
import {
  CreatePalette,
  GDIRealizePalette,
  GDISelectPalette,
  IsDCCurrentPalette,
  RealizeDefaultPalette,
  UpdateColors,
  GetNearestPaletteIndex,
  GetPaletteEntries,
  GetSystemPaletteEntries,
  AnimatePalette,
  GetSystemPaletteUse,
  ResizePalette,
  SetPaletteEntries,
  SetSystemPaletteUse,
} from './gdi/palettes.js';
import { SetTextJustification } from './gdi/justify.js';
import { RECT } from './user.js';
import { Escape } from './gdi/Escape.js';
import {
  Death,
  ExcludeVisRect,
  FastWindowFrame,
  GetDCState,
  InquireVisRgn,
  IntersectVisRect,
  OffsetVisRgn,
  RestoreVisRgn,
  Resurrection,
  SaveVisRgn,
  SelectVisRgn,
  SetDCOrg,
  SetDCState,
} from './gdi/visible-region.js';
import { CreateRectRgn, CreateRectRgnIndirect } from './gdi/gdi-objects.js';
import {
  CombineRgn,
  CreateEllipticRgn,
  CreateEllipticRgnIndirect,
  CreatePolygonRgn,
  CreatePolyPolygonRgn,
  CreateRoundRectRgn,
  EqualRgn,
  FillRgn,
  FrameRgn,
  GetRgnBox,
  InvertRgn,
  OffsetRgn,
  PaintRgn,
  PtInRegion,
  RectInRegion,
  SetRectRgn,
} from './gdi/regions.js';
import { Module } from './module.js';

import {
  HRGN,
  BYTE,
  INT,
  UINT,
  LONG,
  DWORD,
  HANDLE,
  LPARAM,
  HDC,
  HGDIOBJ,
  HBRUSH,
  HPEN,
  COLORREF,
  HGLOBAL,
  HBITMAP,
  BOOL,
  FARPTR,
  LPCSTR,
  CHARARRAY,
  Struct,
} from './types.js';

import { BitBlt } from './gdi/BitBlt.js';
import { CreateBitmap } from './gdi/CreateBitmap.js';
import { CreateFont } from './gdi/CreateFont.js';
import { CreateFontIndirect } from './gdi/CreateFontIndirect.js';
import { CreateCompatibleBitmap } from './gdi/CreateCompatibleBitmap.js';
import { CreateCompatibleDC } from './gdi/CreateCompatibleDC.js';
import { CreatePen, CreatePenIndirect } from './gdi/CreatePen.js';
import { CreateSolidBrush } from './gdi/CreateSolidBrush.js';
import { CreateDC, CreateIC } from './gdi/CreateDC.js';
import { DeleteDC } from './gdi/DeleteDC.js';
import { DeleteObject } from './gdi/DeleteObject.js';
import { GetBitmapBits } from './gdi/GetBitmapBits.js';
import { GetGlyphOutline } from './gdi/GetGlyphOutline.js';
import { CreateScalableFontResource } from './gdi/CreateScalableFontResource.js';
import { AddFontResource, RemoveFontResource } from './gdi/AddFontResource.js';
import { UnicodeToAnsi } from './gdi/UnicodeToAnsi.js';
import { GetDeviceCaps } from './gdi/GetDeviceCaps.js';
import { GetObject } from './gdi/GetObject.js';
import { GetRasterizerCaps } from './gdi/GetRasterizerCaps.js';
import { GetTextExtent, GetTextExtentPoint } from './gdi/GetTextExtent.js';
import { GetPolyFillMode, SetPolyFillMode } from './gdi/fill-mode.js';
import { PtVisible, RectVisible } from './gdi/RectVisible.js';
import { EnumFontFamilies, EnumFonts } from './gdi/EnumFontFamilies.js';
import { EnumObjects } from './gdi/EnumObjects.js';
import { SetObjectOwner } from './gdi/SetObjectOwner.js';
import { GetSpoolJob } from './gdi/GetSpoolJob.js';
import {
  CloseJob,
  DeleteJob,
  DeleteSpoolPage,
  EndSpoolPage,
  OpenJob,
  QueryAbort,
  QueryJob,
  SpoolFile,
  StartSpoolPage,
  WriteDialog,
  WriteSpool,
} from './gdi/spooler.js';
import { GetCharWidth } from './gdi/GetCharWidth.js';
import { GetTextFace } from './gdi/GetTextFace.js';
import { GetTextMetrics } from './gdi/GetTextMetrics.js';
import { GetStockObject } from './gdi/GetStockObject.js';
import { LineTo } from './gdi/LineTo.js';
import { Polygon } from './gdi/Polygon.js';
import { Polyline } from './gdi/Polyline.js';
import { SetDIBitsToDevice, StretchDIBits } from './gdi/dib-to-device.js';
import { GetCurrentPosition, MoveTo, MoveToEx } from './gdi/MoveTo.js';
import { CreateBrushIndirect, CreateHatchBrush } from './gdi/CreateBrushIndirect.js';
import { GetDIBits } from './gdi/GetDIBits.js';
import { Arc, Chord, Pie } from './gdi/wedges.js';
import {
  GetBrushOrgEx,
  GetCurrentPositionEx,
  GetViewportExtEx,
  GetViewportOrgEx,
  GetWindowExtEx,
  GetWindowOrgEx,
  OffsetViewportOrgEx,
  OffsetWindowOrgEx,
  ScaleViewportExtEx,
  ScaleWindowExtEx,
  SetViewportExtEx,
  SetViewportOrgEx,
  SetWindowExtEx,
  SetWindowOrgEx,
} from './gdi/ex-forms.js';
import { PatBlt } from './gdi/PatBlt.js';
import { Rectangle } from './gdi/Rectangle.js';
import { RoundRect } from './gdi/RoundRect.js';
import { Ellipse } from './gdi/Ellipse.js';
import { CreateDIBitmap } from './gdi/CreateDIBitmap.js';
import { GetROP2, SetROP2 } from './gdi/SetROP2.js';
import {
  CreateDIBPatternBrush,
  CreatePatternBrush,
  GetBrushOrg,
  SetBrushOrg,
  UnrealizeObject,
} from './gdi/CreatePatternBrush.js';
import {
  ExcludeClipRect,
  GetClipBox,
  IntersectClipRect,
  OffsetClipRgn,
  SelectClipRgn,
} from './gdi/clipping.js';
import {
  DPtoLP,
  GetMapMode,
  GetViewportExt,
  GetViewportOrg,
  GetWindowExt,
  GetWindowOrg,
  LPtoDP,
  OffsetViewportOrg,
  OffsetWindowOrg,
  ScaleViewportExt,
  ScaleWindowExt,
  SetMapMode,
  SetViewportExt,
  SetViewportOrg,
  SetWindowExt,
  SetWindowOrg,
} from './gdi/mapping.js';
import { RestoreDC, SaveDC } from './gdi/SaveDC.js';
import { GetStretchBltMode, SetStretchBltMode, StretchBlt } from './gdi/StretchBlt.js';
import { SelectObject } from './gdi/SelectObject.js';
import { SetBitmapBits } from './gdi/SetBitmapBits.js';
import { GetBkColor, SetBkColor } from './gdi/SetBkColor.js';
import { SetBkMode } from './gdi/SetBkMode.js';
import { SetTextAlign } from './gdi/SetTextAlign.js';
import { SetTextCharacterExtra } from './gdi/SetTextCharacterExtra.js';
import { SetPixel } from './gdi/SetPixel.js';
import { GetPixel } from './gdi/GetPixel.js';
import { MulDiv } from './gdi/MulDiv.js';
import { EngineDeleteFont, EngineEnumerateFont, EngineRealizeFont } from './gdi/engine-font.js';
import {
  ConvertOutlineFontFile,
  EngineExtTextOut,
  EngineGetCharWidth,
  EngineGetGlyphBmp,
  EngineMakeFontDir,
  EngineSetFontContext,
} from './gdi/engine-glyphs.js';
import { GetPhysicalFontHandle } from './gdi/physical-font.js';
import { GetEnvironment, SetEnvironment } from './gdi/environment.js';
import { GetNearestColor } from './gdi/GetNearestColor.js';
import { GetTextColor, SetTextColor } from './gdi/SetTextColor.js';
import { TextOut } from './gdi/TextOut.js';
import {
  GetCharABCWidths,
  GetFontData,
  GetKerningPairs,
  GetOutlineTextMetrics,
} from './gdi/outline-queries.js';
import {
  GetClipRgn,
  GetCurLogFont,
  GetDCHook,
  GetRelAbs,
  ResetDC,
  SetDCHook,
  SetHookFlags,
  SetRelAbs,
} from './gdi/dc-internals.js';
import { GetBoundsRect, IsDCDirty, SetBoundsRect, SetDCStatus } from './gdi/bounds.js';
import { CreatePQ, DeletePQ, ExtractPQ, InsertPQ, MinPQ, SizePQ } from './gdi/priority-queue.js';
import {
  Copy,
  DMEnumDFonts,
  DeviceColorMatch,
  FixUpBogusPublisherMetafile,
  GDIMoveBitmap,
  GDITaskTermination,
  MakeObjectPrivate,
  SelectBitmap,
  ShrinkGDIHeap,
  GDISeeGDIDo,
  GDIInit2,
  FinalGDIInit,
  WEP,
} from './gdi/system-exports.js';
import {
  Brute,
  DMBitBlt,
  DMColorInfo,
  DMDibBits,
  DMEnumObj,
  DMExtTextOut,
  DMGetCharWidth,
  DMOutput,
  DMPixel,
  DMRealizeObject,
  DMScanLR,
  DMSetDibToDev,
  DMStrBlt,
  DMStretchBlt,
  DMStretchDIBits,
  DMTranspose,
  ScanLR,
} from './gdi/driver-helpers.js';
import { ExtTextOut } from './gdi/ExtTextOut.js';

/**
 * The Win16 GDI library.
 *
 * @memberof Win16
 */
/**
 * `FTrapping0`, ordinal 355: a word of GDI's data, at 2EFh (`GDI.EXE`'s
 * entry table, seg48 `02ef`), FFFFh in the file and nought once GDI has
 * hooked the divide fault as it starts (seg2 `011a`); GDI's own fault
 * handler reads it, 1 while its arithmetic is guarded (seg1 `54c5`-`5548`).
 * WinBox's GDI segment reads nought there. **Recorded** by `ugaps`.
 */
const FTRAPPING0 = new ExportedData({ offset: 0x2ef });

export class Gdi extends Module {
  declare static ANSI_FIXED_FONT: any;
  declare static ANSI_VAR_FONT: any;
  declare static ASPECTX: any;
  declare static ASPECTXY: any;
  declare static ASPECTY: any;
  declare static BITSPIXEL: any;
  declare static BLACKNESS: any;
  declare static BLACK_BRUSH: any;
  declare static BLACK_PEN: any;
  declare static CLIPCAPS: any;
  declare static COLORRES: any;
  declare static CURVECAPS: any;
  declare static DEFAULT_PALETTE: any;
  declare static DEVICE_DEFAULT_FONT: any;
  declare static DKGRAY_BRUSH: any;
  declare static DRIVERVERSION: any;
  declare static DSTINVERT: any;
  declare static GRAY_BRUSH: any;
  declare static HOLLOW_BRUSH: any;
  declare static HORZSIZE: any;
  declare static HORZRES: any;
  declare static LINECAPS: any;
  declare static LOGPIXELSX: any;
  declare static LOGPIXELSY: any;
  declare static LTGRAY_BRUSH: any;
  declare static MERGECOPY: any;
  declare static MERGEPAINT: any;
  declare static NOTSRCCOPY: any;
  declare static NOTSRCERASE: any;
  declare static NULL_BRUSH: any;
  declare static NULL_PEN: any;
  declare static NUMBRUSHES: any;
  declare static NUMCOLORS: any;
  declare static NUMFONTS: any;
  declare static NUMMARKERS: any;
  declare static NUMPENS: any;
  declare static NUMRESERVED: any;
  declare static OEM_FIXED_FONT: any;
  declare static PATCOPY: any;
  declare static PATINVERT: any;
  declare static PATPAINT: any;
  declare static PDEVICESIZE: any;
  declare static PLANES: any;
  declare static POLYGONALCAPS: any;
  declare static RASTERCAPS: any;
  declare static SIZEPALETTE: any;
  declare static SRCAND: any;
  declare static SRCCOPY: any;
  declare static SRCERASE: any;
  declare static SRCINVERT: any;
  declare static SRCPAINT: any;
  declare static SYSTEM_FIXED_FONT: any;
  declare static SYSTEM_FONT: any;
  declare static TECHNOLOGY: any;
  declare static TEXTCAPS: any;
  declare static TT_AVAILABLE: any;
  declare static TT_ENABLED: any;
  declare static VERTRES: any;
  declare static VERTSIZE: any;
  declare static WHITENESS: any;
  declare static WHITE_BRUSH: any;
  declare static WHITE_PEN: any;
  static get name(): string {
    return 'GDI';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\GDI.EXE';
  }

  static get exports() {
    return [
      // 0 //
      null,
      [SetBkColor, 'SetBkColor', 6, [HDC, COLORREF], COLORREF],
      [SetBkMode, 'SetBkMode', 4, [HDC, INT], INT],
      [SetMapMode, 'SetMapMode', 4, [HDC, INT], INT],
      [SetROP2, 'SetRop2', 4, [HDC, INT], INT],
      [SetRelAbs, 'SetRelAbs', 4, [HDC, INT], INT],
      [SetPolyFillMode, 'SetPolyFillMode', 4, [HDC, INT], INT],
      [SetStretchBltMode, 'SetStretchBltMode', 4, [HDC, INT], INT],
      [SetTextCharacterExtra, 'SetTextCharacterExtra', 4, [HDC, INT], INT],
      [SetTextColor, 'SetTextColor', 6, [HDC, COLORREF], COLORREF],
      // 10 //
      [SetTextJustification, 'SetTextJustification', 6, [HDC, INT, INT], INT],
      [SetWindowOrg, 'SetWindowOrg', 6, [HDC, INT, INT], DWORD],
      [SetWindowExt, 'SetWindowExt', 6, [HDC, INT, INT], DWORD],
      [SetViewportOrg, 'SetViewportOrg', 6, [HDC, INT, INT], DWORD],
      [SetViewportExt, 'SetViewportExt', 6, [HDC, INT, INT], DWORD],
      [OffsetWindowOrg, 'OffsetWindowOrg', 6, [HDC, INT, INT], DWORD],
      [ScaleWindowExt, 'ScaleWindowExt', 10, [HDC, INT, INT, INT, INT], DWORD],
      [OffsetViewportOrg, 'OffsetViewportOrg', 6, [HDC, INT, INT], DWORD],
      [ScaleViewportExt, 'ScaleViewportExt', 10, [HDC, INT, INT, INT, INT], DWORD],
      [LineTo, 'LineTo', 6, [HDC, INT, INT], BOOL],
      // 20 //
      [MoveTo, 'MoveTo', 6, [HDC, INT, INT], DWORD],
      [ExcludeClipRect, 'ExcludeClipRect', 10, [HDC, INT, INT, INT, INT], INT],
      [IntersectClipRect, 'IntersectClipRect', 10, [HDC, INT, INT, INT, INT], INT],
      [Arc, 'Arc', 18, [HDC, INT, INT, INT, INT, INT, INT, INT, INT], BOOL],
      [Ellipse, 'Ellipse', 10, [HDC, INT, INT, INT, INT], BOOL],
      [FloodFill, 'FloodFill', 10, [HDC, INT, INT, COLORREF], BOOL],
      [Pie, 'Pie', 18, [HDC, INT, INT, INT, INT, INT, INT, INT, INT], BOOL],
      [Rectangle, 'Rectangle', 10, [HDC, INT, INT, INT, INT], BOOL],
      [RoundRect, 'RoundRect', 14, [HDC, INT, INT, INT, INT, INT, INT], BOOL],
      [PatBlt, 'PatBlt', 14, [HDC, INT, INT, INT, INT, DWORD], BOOL],
      // 30 //
      [SaveDC, 'SaveDC', 2, [HDC], INT],
      [SetPixel, 'SetPixel', 10, [HDC, INT, INT, COLORREF], COLORREF],
      [OffsetClipRgn, 'OffsetClipRgn', 6, [HDC, INT, INT], INT],
      [TextOut, 'TextOut', 12, [HDC, INT, INT, LPCSTR, INT], BOOL],
      [BitBlt, 'BitBlt', 20, [HDC, INT, INT, INT, INT, HDC, INT, INT, DWORD], BOOL],
      [
        StretchBlt,
        'StretchBlt',
        24,
        [HDC, INT, INT, INT, INT, HDC, INT, INT, INT, INT, DWORD],
        BOOL,
      ],
      [Polygon, 'Polygon', 8, [HDC, FARPTR, INT], BOOL],
      [Polyline, 'Polyline', 8, [HDC, FARPTR, INT], BOOL],
      [Escape, 'Escape', 14, [HDC, INT, INT, FARPTR, FARPTR], INT],
      [RestoreDC, 'RestoreDC', 4, [HDC, INT], BOOL],
      // 40 //
      [FillRgn, 'FillRgn', 6, [HDC, HRGN, HBRUSH], BOOL],
      [FrameRgn, 'FrameRgn', 10, [HDC, HRGN, HBRUSH, INT, INT], BOOL],
      [InvertRgn, 'InvertRgn', 4, [HDC, HRGN], BOOL],
      [PaintRgn, 'PaintRgn', 4, [HDC, HRGN], BOOL],
      [SelectClipRgn, 'SelectClipRgn', 4, [HDC, HRGN], INT],
      [SelectObject, 'SelectObject', 4, [HDC, HGDIOBJ], HGDIOBJ],
      [emptyGpTable(), '__GP', 0],
      [CombineRgn, 'CombineRgn', 8, [HRGN, HRGN, HRGN, INT], INT],
      [CreateBitmap, 'CreateBitmap', 12, [INT, INT, UINT, UINT, FARPTR], HBITMAP],
      [CreateBitmapIndirect, 'CreateBitmapIndirect', 4, [FARPTR], HBITMAP],
      // 50 //
      [CreateBrushIndirect, 'CreateBrushIndirect', 4, [FARPTR], HBRUSH],
      [CreateCompatibleBitmap, 'CreateCompatibleBitmap', 6, [HDC, INT, INT], HBITMAP],
      [CreateCompatibleDC, 'CreateCompatibleDC', 2, [HDC], HDC],
      [CreateDC, 'CreateDC', 16, [LPCSTR, LPCSTR, LPCSTR, FARPTR], HDC],
      [CreateEllipticRgn, 'CreateEllipticRgn', 8, [INT, INT, INT, INT], HRGN],
      [CreateEllipticRgnIndirect, 'CreateEllipticRgnIndirect', 4, [[RECT]], HRGN],
      [
        CreateFont,
        'CreateFont',
        30,
        [INT, INT, INT, INT, INT, BYTE, BYTE, BYTE, BYTE, BYTE, BYTE, BYTE, BYTE, LPCSTR],
        HGDIOBJ,
      ],
      [CreateFontIndirect, 'CreateFontIndirect', 4, [[LOGFONT]], HGDIOBJ],
      [CreateHatchBrush, 'CreateHatchBrush', 6, [INT, COLORREF], HBRUSH],
      [WEP, 'WEP', 2, [INT], INT],
      // 60 //
      [CreatePatternBrush, 'CreatePatternBrush', 2, [HBITMAP], HBRUSH],
      [CreatePen, 'CreatePen', 8, [INT, INT, COLORREF], HPEN],
      [CreatePenIndirect, 'CreatePenIndirect', 4, [FARPTR], HPEN],
      [CreatePolygonRgn, 'CreatePolygonRgn', 8, [FARPTR, INT, INT], HRGN],
      [CreateRectRgn, 'CreateRectRgn', 8, [INT, INT, INT, INT], HRGN],
      [CreateRectRgnIndirect, 'CreateRectRgnIndirect', 4, [[RECT]], HRGN],
      [CreateSolidBrush, 'CreateSolidBrush', 4, [COLORREF], HBRUSH],
      [DPtoLP, 'DPToLP', 8, [HDC, FARPTR, INT], BOOL],
      [DeleteDC, 'DeleteDC', 2, [HDC], BOOL],
      [DeleteObject, 'DeleteObject', 2, [HGDIOBJ], BOOL],
      // 70 //
      [EnumFonts, 'EnumFonts', 14, [HDC, LPCSTR, FARPTR, LPARAM], INT],
      [EnumObjects, 'EnumObjects', 12, [HDC, INT, FARPTR, LPARAM], INT],
      [EqualRgn, 'EqualRgn', 4, [HRGN, HRGN], BOOL],
      [ExcludeVisRect, 'ExcludeVisRect', 10, [HDC, INT, INT, INT, INT], INT],
      [GetBitmapBits, 'GetBitmapBits', 10, [HBITMAP, LONG, FARPTR], LONG],
      [GetBkColor, 'GetBkColor', 2, [HDC], COLORREF],
      [GetBkMode, 'GetBkMode', 2, [HDC], INT],
      [GetClipBox, 'GetClipBox', 6, [HDC, [RECT]], INT],
      [GetCurrentPosition, 'GetCurrentPosition', 2, [HDC], DWORD],
      [GetDCOrg, 'GetDCOrg', 2, [HDC], DWORD],
      // 80 //
      [GetDeviceCaps, 'GetDeviceCaps', 4, [HDC, INT], INT],
      [GetMapMode, 'GetMapMode', 2, [HDC], INT],
      [GetObject, 'GetObject', 8, [HGDIOBJ, INT, FARPTR], INT],
      [GetPixel, 'GetPixel', 6, [HDC, INT, INT], COLORREF],
      [GetPolyFillMode, 'GetPolyFillMode', 2, [HDC], INT],
      [GetROP2, 'GetRop2', 2, [HDC], INT],
      [GetRelAbs, 'GetRelAbs', 2, [HDC], DWORD],
      [GetStockObject, 'GetStockObject', 2, [INT], HGDIOBJ],
      [GetStretchBltMode, 'GetStretchBltMode', 2, [HDC], INT],
      [GetTextCharacterExtra, 'GetTextCharacterExtra', 2, [HDC], INT],
      // 90 //
      [GetTextColor, 'GetTextColor', 2, [HDC], COLORREF],
      [GetTextExtent, 'GetTextExtent', 8, [HDC, LPCSTR, INT], DWORD],
      [GetTextFace, 'GetTextFace', 8, [HDC, INT, FARPTR], INT],
      [GetTextMetrics, 'GetTextMetrics', 6, [HDC, [TEXTMETRIC]], BOOL],
      [GetViewportExt, 'GetViewportExt', 2, [HDC], DWORD],
      [GetViewportOrg, 'GetViewportOrg', 2, [HDC], DWORD],
      [GetWindowExt, 'GetWindowExt', 2, [HDC], DWORD],
      [GetWindowOrg, 'GetWindowOrg', 2, [HDC], DWORD],
      [IntersectVisRect, 'IntersectVisRect', 10, [HDC, INT, INT, INT, INT], INT],
      [LPtoDP, 'LPToDP', 8, [HDC, FARPTR, INT], BOOL],
      // 100 //
      [LineDDA, 'LineDDA', 16, [INT, INT, INT, INT, FARPTR, LPARAM]],
      [OffsetRgn, 'OffsetRgn', 6, [HRGN, INT, INT], INT],
      [OffsetVisRgn, 'OffsetVisRgn', 6, [HDC, INT, INT], INT],
      [PtVisible, 'PtVisible', 6, [HDC, INT, INT], BOOL],
      [RectVisible, 'RectVisible', 6, [HDC, FARPTR], BOOL],
      [SelectVisRgn, 'SelectVisRgn', 4, [HDC, HRGN], INT],
      [SetBitmapBits, 'SetBitmapBits', 10, [HBITMAP, DWORD, FARPTR], LONG],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 110 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [SetDCOrg, 'SetDCOrg', 6, [HDC, INT, INT], DWORD],
      [Gdi.stub, 'unknown'],
      [AddFontResource, 'AddFontResource', 4, [LPCSTR], INT],
      // 120 //
      [Gdi.stub, 'unknown'],
      [Death, 'Death', 2, [HDC], INT],
      [Resurrection, 'Resurrection', 14, [HDC, UINT, UINT, UINT, UINT, UINT, UINT], INT],
      [PlayMetaFile, 'PlayMetafile', 4, [HDC, HANDLE], BOOL],
      [GetMetaFile, 'GetMetafile', 4, [LPCSTR], HANDLE],
      [CreateMetaFile, 'CreateMetafile', 4, [LPCSTR], HDC],
      [CloseMetaFile, 'CloseMetafile', 2, [HDC], HANDLE],
      [DeleteMetaFile, 'DeleteMetafile', 2, [HANDLE], BOOL],
      [MulDiv, 'MulDiv', 6, [INT, INT, INT], INT],
      [SaveVisRgn, 'SaveVisRgn', 2, [HDC], HRGN],
      // 130 //
      [RestoreVisRgn, 'RestoreVisRgn', 2, [HDC], INT],
      [InquireVisRgn, 'InquireVisRgn', 2, [HDC], HRGN],
      [SetEnvironment, 'SetEnvironment', 10, [FARPTR, FARPTR, UINT], INT],
      [GetEnvironment, 'GetEnvironment', 10, [FARPTR, FARPTR, UINT], INT],
      [GetRgnBox, 'GetRgnBox', 6, [HRGN, [RECT]], INT],
      [ScanLR, 'ScanLR', 12, [HDC, INT, INT, COLORREF, UINT], INT],
      [RemoveFontResource, 'RemoveFontResource', 4, [LPCSTR], BOOL],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 140 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [SetBrushOrg, 'SetBrushOrg', 6, [HDC, INT, INT], DWORD],
      [GetBrushOrg, 'GetBrushOrg', 2, [HDC], DWORD],
      // 150 //
      [UnrealizeObject, 'UnrealizeObject', 2, [HGDIOBJ], BOOL],
      [CopyMetaFile, 'CopyMetafile', 6, [HANDLE, LPCSTR], HANDLE],
      [Gdi.stub, 'unknown'],
      [CreateIC, 'CreateIC', 16, [LPCSTR, LPCSTR, LPCSTR, FARPTR], HDC],
      [GetNearestColor, 'GetNearestColor', 6, [HDC, COLORREF], COLORREF],
      [QueryAbort, 'QueryAbort', 4, [HDC, INT], BOOL],
      [CreateCompatibleBitmap, 'CreateDiscardableBitmap', 6, [HDC, INT, INT], HANDLE],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [GetMetaFileBits, 'GetMetafileBits', 2, [HANDLE], HANDLE],
      // 160 //
      [SetMetaFileBits, 'SetMetafileBits', 2, [HANDLE], HANDLE],
      [PtInRegion, 'PtInRegion', 6, [HRGN, INT, INT], BOOL],
      [GetBitmapDimension, 'GetBitmapDimension', 2, [HBITMAP], DWORD],
      [SetBitmapDimension, 'SetBitmapDimension', 6, [HBITMAP, INT, INT], DWORD],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [IsDCDirty, 'IsDCDirty', 6, [HDC, FARPTR], INT],
      // 170 //
      [SetDCStatus, 'SetDCStatus', 8, [HDC, INT, FARPTR], INT],
      [Gdi.stub, 'unknown'],
      [SetRectRgn, 'SetRectRgn', 10, [HRGN, INT, INT, INT, INT]],
      [GetClipRgn, 'GetClipRgn', 2, [HDC], HRGN],
      [Gdi.stub, 'unknown'],
      [EnumMetaFile, 'EnumMetafile', 12, [HDC, HANDLE, FARPTR, LPARAM], BOOL],
      [PlayMetaFileRecord, 'PlayMetafileRecord', 12, [HDC, FARPTR, FARPTR, UINT]],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [GetDCState, 'GetDCState', 2, [HDC], HDC],
      // 180 //
      [SetDCState, 'SetDCState', 4, [HDC, HDC]],
      [RectInRegion, 'RectInRegion', 6, [HRGN, [RECT]], BOOL],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 190 //
      [SetDCHook, 'SetDCHook', 10, [HDC, FARPTR, DWORD], DWORD],
      [GetDCHook, 'GetDCHook', 6, [HDC, FARPTR], DWORD],
      [SetHookFlags, 'SetHookFlags', 4, [HDC, UINT], DWORD],
      [SetBoundsRect, 'SetBoundsRect', 8, [HDC, FARPTR, UINT], UINT],
      [GetBoundsRect, 'GetBoundsRect', 8, [HDC, FARPTR, UINT], UINT],
      [SelectBitmap, 'SelectBitmap', 4, [HDC, HBITMAP], HBITMAP],
      [SetMetaFileBits, 'SetMetafileBitsBetter', 2, [HANDLE], HANDLE],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 200 //
      [Gdi.stub, 'unknown'],
      [
        DMBitBlt,
        'DMBitBlt',
        32,
        [FARPTR, INT, INT, FARPTR, INT, INT, INT, INT, DWORD, FARPTR, FARPTR],
        BOOL,
      ],
      [DMColorInfo, 'DMColorInfo', 12, [FARPTR, DWORD, FARPTR], DWORD],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [DMEnumDFonts, 'DMEnumDFonts', 16, [FARPTR, FARPTR, FARPTR, FARPTR], INT],
      [DMEnumObj, 'DMEnumObj', 14, [FARPTR, UINT, FARPTR, DWORD], INT],
      [DMOutput, 'DMOutput', 28, [FARPTR, UINT, UINT, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR], INT],
      [DMPixel, 'DMPixel', 16, [FARPTR, INT, INT, DWORD, FARPTR], DWORD],
      // 210 //
      [DMRealizeObject, 'DMRealizeObject', 18, [FARPTR, INT, FARPTR, FARPTR, FARPTR], DWORD],
      [
        DMStrBlt,
        'DMStrBlt',
        30,
        [FARPTR, INT, INT, FARPTR, FARPTR, INT, FARPTR, FARPTR, FARPTR],
        DWORD,
      ],
      [DMScanLR, 'DMScanLR', 14, [FARPTR, INT, INT, DWORD, UINT], INT],
      [Brute, 'Brute', 0, [], DWORD],
      [
        DMExtTextOut,
        'DMExtTextOut',
        40,
        [FARPTR, INT, INT, FARPTR, FARPTR, INT, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR, UINT],
        DWORD,
      ],
      [
        DMGetCharWidth,
        'DMGetCharWidth',
        24,
        [FARPTR, FARPTR, UINT, UINT, FARPTR, FARPTR, FARPTR],
        INT,
      ],
      [
        DMStretchBlt,
        'DMStretchBlt',
        40,
        [FARPTR, INT, INT, INT, INT, FARPTR, INT, INT, INT, INT, DWORD, FARPTR, FARPTR, FARPTR],
        INT,
      ],
      [DMDibBits, 'DMDibBits', 26, [FARPTR, UINT, UINT, UINT, FARPTR, FARPTR, FARPTR, FARPTR], INT],
      [
        DMStretchDIBits,
        'DMStretchDIBits',
        50,
        [
          FARPTR,
          UINT,
          INT,
          INT,
          INT,
          INT,
          INT,
          INT,
          INT,
          INT,
          FARPTR,
          FARPTR,
          FARPTR,
          DWORD,
          FARPTR,
          FARPTR,
          FARPTR,
        ],
        INT,
      ],
      [
        DMSetDibToDev,
        'DMSetDibToDev',
        32,
        [FARPTR, INT, INT, UINT, UINT, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR],
        INT,
      ],
      // 220 //
      [DMTranspose, 'DMTranspose', 10, [FARPTR, FARPTR, INT]],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 230 //
      [CreatePQ, 'CreatePQ', 2, [UINT], HANDLE],
      [MinPQ, 'MinPQ', 2, [HANDLE], INT],
      [ExtractPQ, 'ExtractPQ', 2, [HANDLE], INT],
      [InsertPQ, 'InsertPQ', 6, [HANDLE, UINT, UINT], INT],
      [SizePQ, 'SizePQ', 4, [HANDLE, UINT], INT],
      [DeletePQ, 'DeletePQ', 2, [HANDLE], INT],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 240 //
      [OpenJob, 'OpenJob', 10, [FARPTR, FARPTR, HDC], INT],
      [WriteSpool, 'WriteSpool', 8, [HANDLE, FARPTR, UINT], INT],
      [WriteDialog, 'WriteDialog', 8, [HANDLE, FARPTR, UINT], INT],
      [CloseJob, 'CloseJob', 2, [HANDLE], INT],
      [DeleteJob, 'DeleteJob', 4, [HANDLE, UINT], INT],
      [GetSpoolJob, 'GetSpoolJob', 6, [UINT, LONG], LONG],
      [StartSpoolPage, 'StartSpoolPage', 2, [HANDLE], INT],
      [EndSpoolPage, 'EndSpoolPage', 2, [HANDLE], INT],
      [QueryJob, 'QueryJob', 4, [HANDLE, INT], INT],
      [Gdi.stub, 'unknown'],
      // 250 //
      [Copy, 'Copy', 10, [FARPTR, FARPTR, UINT]],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [DeleteSpoolPage, 'DeleteSpoolPage', 2, [HANDLE], INT],
      [SpoolFile, 'SpoolFile', 16, [FARPTR, FARPTR, FARPTR, FARPTR], HANDLE],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 260 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 270 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 280 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 290 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 300 //
      [EngineEnumerateFont, 'EngineEnumerateFont', 12, [LPCSTR, FARPTR, DWORD], INT],
      [EngineDeleteFont, 'EngineDeleteFont', 4, [FARPTR], INT],
      [EngineRealizeFont, 'EngineRealizeFont', 12, [FARPTR, FARPTR, FARPTR], DWORD],
      [EngineGetCharWidth, 'EngineGetCharWidth', 12, [FARPTR, UINT, UINT, FARPTR], INT],
      [EngineSetFontContext, 'EngineSetFontContext', 6, [FARPTR, UINT], DWORD],
      [
        EngineGetGlyphBmp,
        'EngineGetGlyphBmp',
        22,
        [HDC, FARPTR, UINT, UINT, FARPTR, DWORD, FARPTR],
        DWORD,
      ],
      [EngineMakeFontDir, 'EngineMakeFontDir', 10, [UINT, FARPTR, LPCSTR], DWORD],
      [GetCharABCWidths, 'GetCharAbcWidths', 10, [HDC, UINT, UINT, FARPTR], BOOL],
      [GetOutlineTextMetrics, 'GetOutlineTextMetrics', 8, [HDC, UINT, FARPTR], UINT],
      [
        GetGlyphOutline,
        'GetGlyphOutline',
        22,
        [HDC, UINT, UINT, [GLYPHMETRICS], DWORD, FARPTR, [MAT2]],
        DWORD,
      ],
      // 310 //
      [
        CreateScalableFontResource,
        'CreateScalableFontResource',
        14,
        [UINT, LPCSTR, LPCSTR, LPCSTR],
        BOOL,
      ],
      [GetFontData, 'GetFontData', 18, [HDC, DWORD, DWORD, FARPTR, DWORD], DWORD],
      [ConvertOutlineFontFile, 'ConvertOutlineFontFile', 12, [FARPTR, FARPTR, FARPTR], UINT],
      [GetRasterizerCaps, 'GetRasterizerCaps', 6, [[RASTERIZER_STATUS], INT], BOOL],
      [
        EngineExtTextOut,
        'EngineExtTextOut',
        42,
        [HDC, FARPTR, INT, INT, FARPTR, FARPTR, INT, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR, UINT],
        DWORD,
      ],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 320 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 330 //
      [EnumFontFamilies, 'EnumFontFamilies', 14, [HDC, LPCSTR, FARPTR, LPARAM], INT],
      [Gdi.stub, 'unknown'],
      [GetKerningPairs, 'GetKerningPairs', 8, [HDC, INT, FARPTR], INT],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 340 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [GetTextAlign, 'GetTextAlign', 2, [HDC], UINT],
      [SetTextAlign, 'SetTextAlign', 4, [HDC, UINT], UINT],
      [Gdi.stub, 'unknown'],
      [Chord, 'Chord', 18, [HDC, INT, INT, INT, INT, INT, INT, INT, INT], BOOL],
      [SetMapperFlags, 'SetMapperFlags', 6, [HDC, DWORD], DWORD],
      // 350 //
      [GetCharWidth, 'GetCharWidth', 10, [HDC, UINT, UINT, FARPTR], BOOL],
      [ExtTextOut, 'ExtTextOut', 22, [HDC, INT, INT, UINT, FARPTR, LPCSTR, UINT, FARPTR], BOOL],
      [GetPhysicalFontHandle, 'GetPhysicalFontHandle', 2, [HDC], HANDLE],
      [GetAspectRatioFilter, 'GetAspectRatioFilter', 2, [HDC], DWORD],
      [ShrinkGDIHeap, 'ShrinkGDIHeap', 0, []],
      [FTRAPPING0, 'FTrapping0', 0],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 360 //
      [CreatePalette, 'CreatePalette', 4, [FARPTR], HANDLE],
      [GDISelectPalette, 'GDISelectPalette', 6, [HDC, HANDLE, UINT], HANDLE],
      [GDIRealizePalette, 'GDIRealizePalette', 2, [HDC], DWORD],
      [GetPaletteEntries, 'GetPaletteEntries', 10, [HANDLE, UINT, UINT, FARPTR], UINT],
      [SetPaletteEntries, 'SetPaletteEntries', 10, [HANDLE, UINT, UINT, FARPTR], UINT],
      [RealizeDefaultPalette, 'RealizeDefaultPalette', 2, [HDC], DWORD],
      [UpdateColors, 'UpdateColors', 2, [HDC], INT],
      [AnimatePalette, 'AnimatePalette', 10, [HANDLE, UINT, UINT, FARPTR]],
      [ResizePalette, 'ResizePalette', 4, [HANDLE, UINT], BOOL],
      [Gdi.stub, 'unknown'],
      // 370 //
      [GetNearestPaletteIndex, 'GetNearestPaletteIndex', 6, [HANDLE, COLORREF], UINT],
      [Gdi.stub, 'unknown'],
      [ExtFloodFill, 'ExtFloodFill', 12, [HDC, INT, INT, COLORREF, UINT], BOOL],
      [SetSystemPaletteUse, 'SetSystemPaletteUse', 4, [HDC, UINT], UINT],
      [GetSystemPaletteUse, 'GetSystemPaletteUse', 2, [HDC], UINT],
      [GetSystemPaletteEntries, 'GetSystemPaletteEntries', 10, [HDC, UINT, UINT, FARPTR], UINT],
      [ResetDC, 'ResetDC', 6, [HDC, FARPTR], HDC],
      [StartDoc, 'StartDoc', 6, [HDC, FARPTR], INT],
      [EndDoc, 'EndDoc', 2, [HDC], INT],
      [StartPage, 'StartPage', 2, [HDC], INT],
      // 380 //
      [EndPage, 'EndPage', 2, [HDC], INT],
      [SetAbortProc, 'SetAbortProc', 6, [HDC, FARPTR], INT],
      [AbortDoc, 'AbortDoc', 2, [HDC], INT],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 390 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 400 //
      [FastWindowFrame, 'FastWindowFrame', 14, [HDC, [RECT], INT, INT, DWORD], BOOL],
      [GDIMoveBitmap, 'GDIMoveBitmap', 2, [HBITMAP], INT],
      [Gdi.stub, 'unknown'],
      [GDIInit2, 'GDIInit2', 4, [HANDLE, UINT], UINT],
      [Gdi.stub, 'unknown'],
      [FinalGDIInit, 'FinalGDIInit', 2, [HANDLE], UINT],
      [Gdi.stub, 'unknown'],
      [CreateBitmap, 'CreateUserBitmap', 12, [INT, INT, UINT, UINT, FARPTR], HBITMAP],
      [Gdi.stub, 'unknown'],
      [CreateCompatibleBitmap, 'CreateUserDiscardableBitmap', 6, [HDC, INT, INT], HBITMAP],
      // 410 //
      [IsValidMetaFile, 'IsValidMetafile', 2, [HANDLE], BOOL],
      [GetCurLogFont, 'GetCurLogFont', 2, [HDC], HANDLE],
      [IsDCCurrentPalette, 'IsDCCurrentPalette', 2, [HDC], BOOL],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 420 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 430 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [
        StretchDIBits,
        'StretchDIBits',
        32,
        [HDC, INT, INT, INT, INT, INT, INT, INT, INT, FARPTR, FARPTR, UINT, DWORD],
        INT,
      ],
      // 440 //
      [SetDIBits, 'SetDIBits', 18, [HDC, HBITMAP, UINT, UINT, FARPTR, FARPTR, UINT], INT],
      [GetDIBits, 'GetDIBits', 18, [HDC, HBITMAP, UINT, UINT, FARPTR, FARPTR, UINT], INT],
      [CreateDIBitmap, 'CreateDIBitmap', 20, [HDC, FARPTR, DWORD, FARPTR, FARPTR, UINT], HANDLE],
      [
        SetDIBitsToDevice,
        'SetDIBitsToDevice',
        28,
        [HDC, INT, INT, INT, INT, INT, INT, UINT, UINT, FARPTR, FARPTR, UINT],
        INT,
      ],
      [CreateRoundRectRgn, 'CreateRoundRectRgn', 12, [INT, INT, INT, INT, INT, INT], HRGN],
      [CreateDIBPatternBrush, 'CreateDIBPatternBrush', 4, [HGLOBAL, UINT], HBRUSH],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [DeviceColorMatch, 'DeviceColorMatch', 8, [COLORREF, FARPTR], UINT],
      // 450 // https://devblogs.microsoft.com/oldnewthing/20190731-00/?p=102743 :)
      [PolyPolygon, 'PolyPolygon', 12, [HDC, FARPTR, FARPTR, INT], BOOL],
      [CreatePolyPolygonRgn, 'CreatePolyPolygonRgn', 12, [FARPTR, FARPTR, INT, INT], HRGN],
      [GDISeeGDIDo, 'GDISeeGDIDo', 8, [UINT, UINT, UINT, UINT], DWORD],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 460 //
      [GDITaskTermination, 'GDITaskTermination', 2, [HANDLE]],
      [SetObjectOwner, 'SetObjectOwner', 4, [HGDIOBJ, HANDLE]],
      [IsGDIObject, 'IsGDIObject', 2, [HANDLE], BOOL],
      [MakeObjectPrivate, 'MakeObjectPrivate', 4, [HGDIOBJ, UINT], UINT],
      [FixUpBogusPublisherMetafile, 'FixUpBogusPublisherMetafile', 6, [FARPTR, BOOL], INT],
      [RectVisible, 'RectVisible_Ehh', 6, [HDC, FARPTR], BOOL],
      [RectInRegion, 'RectInRegion_Ehh', 6, [HRGN, [RECT]], BOOL],
      [UnicodeToAnsi, 'UnicodeToAnsi', 8, [DWORD, DWORD], INT],
      [GetBitmapDimensionEx, 'GetBitmapDimensionEx', 6, [HBITMAP, FARPTR], BOOL],
      [GetBrushOrgEx, 'GetBrushOrgEx', 6, [HDC, FARPTR], BOOL],
      // 470 //
      [GetCurrentPositionEx, 'GetCurrentPositionEx', 6, [HDC, FARPTR], BOOL],
      [GetTextExtentPoint, 'GetTextExtentPoint', 12, [HDC, LPCSTR, INT, FARPTR], BOOL],
      [GetViewportExtEx, 'GetViewportExtEx', 6, [HDC, FARPTR], BOOL],
      [GetViewportOrgEx, 'GetViewportOrgEx', 6, [HDC, FARPTR], BOOL],
      [GetWindowExtEx, 'GetWindowExtEx', 6, [HDC, FARPTR], BOOL],
      [GetWindowOrgEx, 'GetWindowOrgEx', 6, [HDC, FARPTR], BOOL],
      [OffsetViewportOrgEx, 'OffsetViewportOrgEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [OffsetWindowOrgEx, 'OffsetWindowOrgEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [SetBitmapDimensionEx, 'SetBitmapDimensionEx', 10, [HBITMAP, INT, INT, FARPTR], BOOL],
      [SetViewportExtEx, 'SetViewportExtEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      // 480 //
      [SetViewportOrgEx, 'SetViewportOrgEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [SetWindowExtEx, 'SetWindowExtEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [SetWindowOrgEx, 'SetWindowOrgEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [MoveToEx, 'MoveToEx', 10, [HDC, INT, INT, FARPTR], BOOL],
      [ScaleViewportExtEx, 'ScaleViewportExtEx', 14, [HDC, INT, INT, INT, INT, FARPTR], BOOL],
      [ScaleWindowExtEx, 'ScaleWindowExtEx', 14, [HDC, INT, INT, INT, INT, FARPTR], BOOL],
      [GetAspectRatioFilterEx, 'GetAspectRatioFilterEx', 6, [HDC, FARPTR], BOOL],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * The **RASTERIZER_STATUS** structure contains information about whether
 * TrueType is installed. This structure is filled when an application calls the
 * {@link Gdi.GetRasterizerCaps GetRasterizerCaps} function.
 *
 * nSize: Specifies the size, in bytes, of the **RASTERIZER_STATUS** structure.
 * wFlags: Specifies whether or not at least one TrueType font is installed and
 * whether TrueType is enabled. This value is `TT_AVAILABLE` and/or `TT_ENABLED`
 * if TrueType is on the system.
 * nLanguageID: Specifies the language in the system's `SETUP.INF` file.
 */
export class RASTERIZER_STATUS extends Struct {
  constructor() {
    super([
      ['nSize', INT],
      ['wFlags', INT],
      ['nLanguageID', INT],
    ]);
  }
}

/**
 * The **GLYPHMETRICS** structure contains information about the placement and
 * orientation of a glyph in a character cell, as `GetGlyphOutline` returns it.
 *
 * gmBlackBoxX, gmBlackBoxY: the smallest rectangle that encloses the glyph.
 * gmptGlyphOriginX, gmptGlyphOriginY: the upper left corner of that
 * rectangle, from the character's origin -- the `POINT` `gmptGlyphOrigin`.
 * gmCellIncX, gmCellIncY: how far the origin moves to the next character.
 */
export class GLYPHMETRICS extends Struct {
  constructor() {
    super([
      ['gmBlackBoxX', UINT],
      ['gmBlackBoxY', UINT],
      ['gmptGlyphOriginX', INT],
      ['gmptGlyphOriginY', INT],
      ['gmCellIncX', INT],
      ['gmCellIncY', INT],
    ]);
  }
}

/**
 * The **MAT2** structure is the transformation matrix `GetGlyphOutline` is
 * given: four `FIXED` values, each a fraction word and then a value word.
 */
export class MAT2 extends Struct {
  constructor() {
    super([
      ['eM11fract', UINT],
      ['eM11value', INT],
      ['eM12fract', UINT],
      ['eM12value', INT],
      ['eM21fract', UINT],
      ['eM21value', INT],
      ['eM22fract', UINT],
      ['eM22value', INT],
    ]);
  }
}

/**
 * The **BITMAP** structure defines the height, width, color format, and bit
 * values of a logical bitmap.
 */
export class BITMAP extends Struct {
  declare bmBits: any;
  declare bmBitsPixel: any;
  declare bmHeight: any;
  declare bmPlanes: any;
  declare bmType: any;
  declare bmWidth: any;
  declare bmWidthBytes: any;
  constructor() {
    super([
      ['bmType', INT],
      ['bmWidth', INT],
      ['bmHeight', INT],
      ['bmWidthBytes', INT],
      ['bmPlanes', BYTE],
      ['bmBitsPixel', BYTE],
      ['bmBits', FARPTR],
    ]);
  }
}

/**
 * The **TEXTMETRIC** structure contains basic information about a physical
 * font. For system versions 3.1 and later, the {@link Gdi.EnumFonts EnumFonts}
 * and {@link Gdi.EnumFontFamilies EnumFontFamilies} functions return
 * information about TrueType fonts in a NEWTEXTMETRIC structure.
 */
/**
 * The **LOGFONT** structure defines the attributes of a font.
 *
 * It is a description rather than a font: every field is what the program
 * would like, and the font mapper answers with the closest thing installed.
 * `lfFaceName` is a fixed thirty-two bytes whether the name fills it or not.
 */
export class LOGFONT extends Struct {
  constructor() {
    super([
      ['lfHeight', INT],
      ['lfWidth', INT],
      ['lfEscapement', INT],
      ['lfOrientation', INT],
      ['lfWeight', INT],
      ['lfItalic', BYTE],
      ['lfUnderline', BYTE],
      ['lfStrikeOut', BYTE],
      ['lfCharSet', BYTE],
      ['lfOutPrecision', BYTE],
      ['lfClipPrecision', BYTE],
      ['lfQuality', BYTE],
      ['lfPitchAndFamily', BYTE],
      ['lfFaceName', CHARARRAY + 32],
    ]);
  }
}

export class TEXTMETRIC extends Struct {
  constructor() {
    super([
      ['tmHeight', INT],
      ['tmAscent', INT],
      ['tmDescent', INT],
      ['tmInternalLeading', INT],
      ['tmExternalLeading', INT],
      ['tmAveCharWidth', INT],
      ['tmMaxCharWidth', INT],
      ['tmWeight', INT],
      ['tmItalic', BYTE],
      ['tmUnderlined', BYTE],
      ['tmStruckOut', BYTE],
      ['tmFirstChar', BYTE],
      ['tmLastChar', BYTE],
      ['tmDefaultChar', BYTE],
      ['tmBreakChar', BYTE],
      ['tmPitchAndFamily', BYTE],
      ['tmCharSet', BYTE],
      ['tmOverhang', INT],
      ['tmDigitizedAspectX', INT],
      ['tmDigitizedAspectY', INT],
    ]);
  }
}

// GetDeviceCaps constants
Gdi.DRIVERVERSION = 0x0;
Gdi.TECHNOLOGY = 0x2;
Gdi.HORZSIZE = 0x4;
Gdi.VERTSIZE = 0x6;
Gdi.HORZRES = 0x8;
Gdi.VERTRES = 0xa;
Gdi.BITSPIXEL = 0xc;
Gdi.PLANES = 0xe;
Gdi.NUMBRUSHES = 0x10;
Gdi.NUMPENS = 0x12;
Gdi.NUMMARKERS = 0x14;
Gdi.NUMFONTS = 0x16;
Gdi.NUMCOLORS = 0x18;
Gdi.PDEVICESIZE = 0x1a;
Gdi.CURVECAPS = 0x1c;
Gdi.LINECAPS = 0x1e;
Gdi.POLYGONALCAPS = 0x20;
Gdi.TEXTCAPS = 0x22;
Gdi.CLIPCAPS = 0x24;
Gdi.RASTERCAPS = 0x26;
Gdi.ASPECTX = 0x28;
Gdi.ASPECTY = 0x2a;
Gdi.ASPECTXY = 0x2c;
Gdi.LOGPIXELSX = 0x58;
Gdi.LOGPIXELSY = 0x5a;
Gdi.SIZEPALETTE = 0x68;
Gdi.NUMRESERVED = 0x6a;
Gdi.COLORRES = 0x6c;

// GetStockObject types
Gdi.WHITE_BRUSH = 0x0;
Gdi.LTGRAY_BRUSH = 0x1;
Gdi.GRAY_BRUSH = 0x2;
Gdi.DKGRAY_BRUSH = 0x3;
Gdi.BLACK_BRUSH = 0x4;
Gdi.NULL_BRUSH = 0x5;
Gdi.HOLLOW_BRUSH = Gdi.NULL_BRUSH;
Gdi.WHITE_PEN = 0x6;
Gdi.BLACK_PEN = 0x7;
Gdi.NULL_PEN = 0x8;
Gdi.OEM_FIXED_FONT = 0xa;
Gdi.ANSI_FIXED_FONT = 0xb;
Gdi.ANSI_VAR_FONT = 0xc;
Gdi.SYSTEM_FONT = 0xd;
Gdi.DEVICE_DEFAULT_FONT = 0xe;
Gdi.DEFAULT_PALETTE = 0xf;
Gdi.SYSTEM_FIXED_FONT = 0x10;

// BitBlt flags
Gdi.SRCCOPY = 0xcc0020;
Gdi.SRCPAINT = 0xee0086;
Gdi.SRCAND = 0x8800c6;
Gdi.SRCINVERT = 0x660046;
Gdi.SRCERASE = 0x440328;
Gdi.NOTSRCCOPY = 0x330008;
Gdi.NOTSRCERASE = 0x1100a6;
Gdi.MERGECOPY = 0xc000ca;
Gdi.MERGEPAINT = 0xbb0226;
Gdi.PATCOPY = 0xf00021;
Gdi.PATPAINT = 0xfb0a09;
Gdi.PATINVERT = 0x5a0049;
Gdi.DSTINVERT = 0x550009;
Gdi.BLACKNESS = 0x000042;
Gdi.WHITENESS = 0xff0062;

// RASTERIZER_STATUS Flags
// -----------------------
Gdi.TT_AVAILABLE = 0x0001;
Gdi.TT_ENABLED = 0x0002;
