'use strict';

/** @namespace Gdi */

import {
  CreatePalette,
  GetNearestPaletteIndex,
  GetPaletteEntries,
  GetSystemPaletteEntries,
  GetSystemPaletteUse,
  ResizePalette,
  SetPaletteEntries,
  SetSystemPaletteUse,
} from './gdi/palettes.js';
import { SetTextJustification } from './gdi/justify.js';
import { RECT } from './user.js';
import { Escape } from './gdi/Escape.js';
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
import { CreatePen } from './gdi/CreatePen.js';
import { CreateSolidBrush } from './gdi/CreateSolidBrush.js';
import { CreateDC, CreateIC } from './gdi/CreateDC.js';
import { DeleteDC } from './gdi/DeleteDC.js';
import { DeleteObject } from './gdi/DeleteObject.js';
import { GetBitmapBits } from './gdi/GetBitmapBits.js';
import { GetGlyphOutline } from './gdi/GetGlyphOutline.js';
import { CreateScalableFontResource } from './gdi/CreateScalableFontResource.js';
import { GetDeviceCaps } from './gdi/GetDeviceCaps.js';
import { GetObject } from './gdi/GetObject.js';
import { GetRasterizerCaps } from './gdi/GetRasterizerCaps.js';
import { GetTextExtent } from './gdi/GetTextExtent.js';
import { PtVisible, RectVisible } from './gdi/RectVisible.js';
import { EnumFontFamilies, EnumFonts } from './gdi/EnumFontFamilies.js';
import { EnumObjects } from './gdi/EnumObjects.js';
import { SetObjectOwner } from './gdi/SetObjectOwner.js';
import { GetSpoolJob } from './gdi/GetSpoolJob.js';
import { GetCharWidth } from './gdi/GetCharWidth.js';
import { GetTextFace } from './gdi/GetTextFace.js';
import { GetTextMetrics } from './gdi/GetTextMetrics.js';
import { GetStockObject } from './gdi/GetStockObject.js';
import { LineTo } from './gdi/LineTo.js';
import { Polygon } from './gdi/Polygon.js';
import { Polyline } from './gdi/Polyline.js';
import { SetDIBitsToDevice, StretchDIBits } from './gdi/dib-to-device.js';
import { GetCurrentPosition, MoveTo } from './gdi/MoveTo.js';
import { PatBlt } from './gdi/PatBlt.js';
import { Rectangle } from './gdi/Rectangle.js';
import { RoundRect } from './gdi/RoundRect.js';
import { Ellipse } from './gdi/Ellipse.js';
import { CreateDIBitmap } from './gdi/CreateDIBitmap.js';
import { GetROP2, SetROP2 } from './gdi/SetROP2.js';
import {
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
import { GetNearestColor } from './gdi/GetNearestColor.js';
import { GetTextColor, SetTextColor } from './gdi/SetTextColor.js';
import { TextOut } from './gdi/TextOut.js';
import { ExtTextOut } from './gdi/ExtTextOut.js';

/**
 * The Win16 GDI library.
 *
 * @memberof Win16
 */
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
      [Gdi.stub, 'SetRelAbs', 4],
      [Gdi.stub, 'SetPolyFillMode', 4],
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
      [Gdi.stub, 'Arc', 18],
      [Ellipse, 'Ellipse', 10, [HDC, INT, INT, INT, INT], BOOL],
      [Gdi.stub, 'FloodFill', 10],
      [Gdi.stub, 'Pie', 18],
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
      [Gdi.stub, '__GP'],
      [CombineRgn, 'CombineRgn', 8, [HRGN, HRGN, HRGN, INT], INT],
      [CreateBitmap, 'CreateBitmap', 12, [INT, INT, UINT, UINT, FARPTR], HBITMAP],
      [Gdi.stub, 'CreateBitmapIndirect', 4],
      // 50 //
      [Gdi.stub, 'CreateBrushIndirect', 4],
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
      [Gdi.stub, 'CreateHatchBrush', 6],
      [Gdi.stub, 'WEP', 2],
      // 60 //
      [CreatePatternBrush, 'CreatePatternBrush', 2, [HBITMAP], HBRUSH],
      [CreatePen, 'CreatePen', 8, [INT, INT, COLORREF], HPEN],
      [Gdi.stub, 'CreatePenIndirect', 4],
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
      [Gdi.stub, 'ExcludeVisRect', 10],
      [GetBitmapBits, 'GetBitmapBits', 10, [HBITMAP, LONG, FARPTR], LONG],
      [GetBkColor, 'GetBkColor', 2, [HDC], COLORREF],
      [Gdi.stub, 'GetBkMode', 2],
      [GetClipBox, 'GetClipBox', 6, [HDC, [RECT]], INT],
      [GetCurrentPosition, 'GetCurrentPosition', 2, [HDC], DWORD],
      [Gdi.stub, 'GetDCOrg', 2],
      // 80 //
      [GetDeviceCaps, 'GetDeviceCaps', 4, [HDC, INT], INT],
      [GetMapMode, 'GetMapMode', 2, [HDC], INT],
      [GetObject, 'GetObject', 8, [HGDIOBJ, INT, FARPTR], INT],
      [GetPixel, 'GetPixel', 6, [HDC, INT, INT], COLORREF],
      [Gdi.stub, 'GetPolyfillMode', 2],
      [GetROP2, 'GetRop2', 2, [HDC], INT],
      [Gdi.stub, 'GetRelAbs', 2],
      [GetStockObject, 'GetStockObject', 2, [INT], HGDIOBJ],
      [GetStretchBltMode, 'GetStretchBltMode', 2, [HDC], INT],
      [Gdi.stub, 'GetTextCharacterExtra', 2],
      // 90 //
      [GetTextColor, 'GetTextColor', 2, [HDC], COLORREF],
      [GetTextExtent, 'GetTextExtent', 8, [HDC, LPCSTR, INT], DWORD],
      [GetTextFace, 'GetTextFace', 8, [HDC, INT, FARPTR], INT],
      [GetTextMetrics, 'GetTextMetrics', 6, [HDC, [TEXTMETRIC]], BOOL],
      [GetViewportExt, 'GetViewportExt', 2, [HDC], DWORD],
      [GetViewportOrg, 'GetViewportOrg', 2, [HDC], DWORD],
      [GetWindowExt, 'GetWindowExt', 2, [HDC], DWORD],
      [GetWindowOrg, 'GetWindowOrg', 2, [HDC], DWORD],
      [Gdi.stub, 'IntersectVisRect', 10],
      [LPtoDP, 'LPToDP', 8, [HDC, FARPTR, INT], BOOL],
      // 100 //
      [Gdi.stub, 'LineDDA', 16],
      [OffsetRgn, 'OffsetRgn', 6, [HRGN, INT, INT], INT],
      [Gdi.stub, 'OffsetVisRgn', 6],
      [PtVisible, 'PtVisible', 6, [HDC, INT, INT], BOOL],
      [RectVisible, 'RectVisible', 6, [HDC, FARPTR], BOOL],
      [Gdi.stub, 'SelectVisRgn', 4],
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
      [Gdi.stub, 'SetDCOrg', 6],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'AddFontResource', 4],
      // 120 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'Death', 2],
      [Gdi.stub, 'Resurrection', 14],
      [Gdi.stub, 'PlayMetafile', 4],
      [Gdi.stub, 'GetMetafile', 4],
      [Gdi.stub, 'CreateMetafile', 4],
      [Gdi.stub, 'CloseMetafile', 2],
      [Gdi.stub, 'DeleteMetafile', 2],
      [MulDiv, 'MulDiv', 6, [INT, INT, INT], INT],
      [Gdi.stub, 'SaveVisRgn', 2],
      // 130 //
      [Gdi.stub, 'RestoreVisRgn', 2],
      [Gdi.stub, 'InquireVisRgn', 2],
      [Gdi.stub, 'SetEnvironment', 10],
      [Gdi.stub, 'GetEnvironment', 10],
      [GetRgnBox, 'GetRgnBox', 6, [HRGN, [RECT]], INT],
      [Gdi.stub, 'ScanLR', 12],
      [Gdi.stub, 'RemoveFontResource', 4],
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
      [Gdi.stub, 'CopyMetafile', 6],
      [Gdi.stub, 'unknown'],
      [CreateIC, 'CreateIC', 16, [LPCSTR, LPCSTR, LPCSTR, FARPTR], HDC],
      [GetNearestColor, 'GetNearestColor', 6, [HDC, COLORREF], COLORREF],
      [Gdi.stub, 'QueryAbort', 4],
      [CreateCompatibleBitmap, 'CreateDiscardableBitmap', 6, [HDC, INT, INT], HANDLE],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'GetMetafileBits', 2],
      // 160 //
      [Gdi.stub, 'SetMetafileBits', 2],
      [PtInRegion, 'PtInRegion', 6, [HRGN, INT, INT], BOOL],
      [Gdi.stub, 'GetBitmapDimension', 2],
      [Gdi.stub, 'SetBitmapDimension', 6],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'IsDCDirty', 6],
      // 170 //
      [Gdi.stub, 'SetDCStatus', 8],
      [Gdi.stub, 'unknown'],
      [SetRectRgn, 'SetRectRgn', 10, [HRGN, INT, INT, INT, INT]],
      [Gdi.stub, 'GetClipRgn', 2],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'EnumMetafile', 12],
      [Gdi.stub, 'PlayMetafileRecord', 12],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'GetDCState', 2],
      // 180 //
      [Gdi.stub, 'SetDCState', 4],
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
      [Gdi.stub, 'SetDCHook', 10],
      [Gdi.stub, 'GetDCHook', 6],
      [Gdi.stub, 'SetHookFlags', 4],
      [Gdi.stub, 'SetBoundsRect', 8],
      [Gdi.stub, 'GetBoundsRect', 8],
      [Gdi.stub, 'SelectBitmap', 4],
      [Gdi.stub, 'SetMetafileBitsBetter', 2],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 200 //
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'DMBitBlt', 0],
      [Gdi.stub, 'DMColorInfo', 0],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'DMEnumDFonts', 16],
      [Gdi.stub, 'DMEnumObj', 0],
      [Gdi.stub, 'DMOutput', 0],
      [Gdi.stub, 'DMPixel', 0],
      // 210 //
      [Gdi.stub, 'DMRealizeObject', 0],
      [Gdi.stub, 'DMStrBlt', 30],
      [Gdi.stub, 'DMScanLR', 0],
      [Gdi.stub, 'Brute', 0],
      [Gdi.stub, 'DMExtTextOut', 40],
      [Gdi.stub, 'DMGetCharWidth', 0],
      [Gdi.stub, 'DMStretchBlt', 0],
      [Gdi.stub, 'DMDibBits', 0],
      [Gdi.stub, 'DMStretchDIBits', 0],
      [Gdi.stub, 'DMSetDibToDev', 0],
      // 220 //
      [Gdi.stub, 'DMTranspose', 10],
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
      [Gdi.stub, 'CreatePQ', 2],
      [Gdi.stub, 'MinPQ', 2],
      [Gdi.stub, 'ExtractPQ', 2],
      [Gdi.stub, 'InsertPQ', 6],
      [Gdi.stub, 'SizePQ', 4],
      [Gdi.stub, 'DeletePQ', 2],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 240 //
      [Gdi.stub, 'OpenJob', 10],
      [Gdi.stub, 'WriteSpool', 8],
      [Gdi.stub, 'WriteDialog', 8],
      [Gdi.stub, 'CloseJob', 2],
      [Gdi.stub, 'DeleteJob', 4],
      [GetSpoolJob, 'GetSpoolJob', 6, [UINT, LONG], LONG],
      [Gdi.stub, 'StartSpoolPage', 2],
      [Gdi.stub, 'EndSpoolPage', 2],
      [Gdi.stub, 'QueryJob', 4],
      [Gdi.stub, 'unknown'],
      // 250 //
      [Gdi.stub, 'Copy', 10],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'DeleteSpoolPage', 2],
      [Gdi.stub, 'SpoolFile', 16],
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
      [Gdi.stub, 'EngineEnumerateFont', 12],
      [Gdi.stub, 'EngineDeleteFont', 4],
      [Gdi.stub, 'EngineRealizeFont', 12],
      [Gdi.stub, 'EngineGetCharWidth', 12],
      [Gdi.stub, 'EngineSetFontContext', 6], // TODO: this errored by disassembler
      [Gdi.stub, 'EngineGetGlyphBmp', 22],
      [Gdi.stub, 'EngineMakeFontDir', 10],
      [Gdi.stub, 'GetCharAbcWidths', 10],
      [Gdi.stub, 'GetOutlineTextMetrics', 8],
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
      [Gdi.stub, 'GetFontData', 18],
      [Gdi.stub, 'ConvertOutlineFontFile', 12],
      [GetRasterizerCaps, 'GetRasterizerCaps', 6, [[RASTERIZER_STATUS], INT], BOOL],
      [Gdi.stub, 'EngineExtTextOut', 42],
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
      [Gdi.stub, 'GetKerningPairs', 8],
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
      [Gdi.stub, 'GetTextAlign', 2],
      [SetTextAlign, 'SetTextAlign', 4, [HDC, UINT], UINT],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'Chord', 18],
      [Gdi.stub, 'SetMapperFlags', 6],
      // 350 //
      [GetCharWidth, 'GetCharWidth', 10, [HDC, UINT, UINT, FARPTR], BOOL],
      [ExtTextOut, 'ExtTextOut', 22, [HDC, INT, INT, UINT, FARPTR, LPCSTR, UINT, FARPTR], BOOL],
      [Gdi.stub, 'GetPhysicalFontHandle', 2],
      [Gdi.stub, 'GetAspectRatioFilter', 2],
      [Gdi.stub, 'ShrinkGDIHeap', 0],
      [Gdi.stub, 'FTrapping0'], // TODO: floating-point instructions
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 360 //
      [CreatePalette, 'CreatePalette', 4, [FARPTR], HANDLE],
      [Gdi.stub, 'GDISelectPalette', 6],
      [Gdi.stub, 'GDIRealizePalette', 2],
      [GetPaletteEntries, 'GetPaletteEntries', 10, [HANDLE, UINT, UINT, FARPTR], UINT],
      [SetPaletteEntries, 'SetPaletteEntries', 10, [HANDLE, UINT, UINT, FARPTR], UINT],
      [Gdi.stub, 'RealizeDefaultPalette', 2],
      [Gdi.stub, 'UpdateColors', 2],
      [Gdi.stub, 'AnimatePalette', 10],
      [ResizePalette, 'ResizePalette', 4, [HANDLE, UINT], BOOL],
      [Gdi.stub, 'unknown'],
      // 370 //
      [GetNearestPaletteIndex, 'GetNearestPaletteIndex', 6, [HANDLE, COLORREF], UINT],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'ExtFloodFill', 12],
      [SetSystemPaletteUse, 'SetSystemPaletteUse', 4, [HDC, UINT], UINT],
      [GetSystemPaletteUse, 'GetSystemPaletteUse', 2, [HDC], UINT],
      [GetSystemPaletteEntries, 'GetSystemPaletteEntries', 10, [HDC, UINT, UINT, FARPTR], UINT],
      [Gdi.stub, 'ResetDC', 6],
      [Gdi.stub, 'StartDoc', 6],
      [Gdi.stub, 'EndDoc', 2],
      [Gdi.stub, 'StartPage', 2],
      // 380 //
      [Gdi.stub, 'EndPage', 2],
      [Gdi.stub, 'SetAbortProc', 6],
      [Gdi.stub, 'AbortDoc', 2],
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
      [Gdi.stub, 'FastWindowFrame', 14],
      [Gdi.stub, 'GDIMoveBitmap', 2],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'GDIInit2', 4],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'FinalGDIInit', 2],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'CreateUserBitmap', 12],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'CreateUserDiscardableBitmap', 6],
      // 410 //
      [Gdi.stub, 'IsValidMetafile', 2],
      [Gdi.stub, 'GetCurLogFont', 2],
      [Gdi.stub, 'IsDCCurrentPalette', 2],
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
      [Gdi.stub, 'SetDIBits', 18],
      [Gdi.stub, 'GetDIBits', 18],
      [CreateDIBitmap, 'CreateDIBitmap', 20, [HDC, FARPTR, DWORD, FARPTR, FARPTR, UINT], HANDLE],
      [
        SetDIBitsToDevice,
        'SetDIBitsToDevice',
        28,
        [HDC, INT, INT, INT, INT, INT, INT, UINT, UINT, FARPTR, FARPTR, UINT],
        INT,
      ],
      [CreateRoundRectRgn, 'CreateRoundRectRgn', 12, [INT, INT, INT, INT, INT, INT], HRGN],
      [Gdi.stub, 'CreateDIBPatternBrush', 4],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'DeviceColorMatch', 8],
      // 450 // https://devblogs.microsoft.com/oldnewthing/20190731-00/?p=102743 :)
      [Gdi.stub, 'PolyPolygon', 12],
      [CreatePolyPolygonRgn, 'CreatePolyPolygonRgn', 12, [FARPTR, FARPTR, INT, INT], HRGN],
      [Gdi.stub, 'GDISeeGDIDo', 8],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      [Gdi.stub, 'unknown'],
      // 460 //
      [Gdi.stub, 'GDITaskTermination', 2],
      [SetObjectOwner, 'SetObjectOwner', 4, [HGDIOBJ, HANDLE]],
      [Gdi.stub, 'IsGDIObject', 2],
      [Gdi.stub, 'MakeObjectPrivate', 4],
      [Gdi.stub, 'FixUpBogusPublisherMetafile', 6],
      [Gdi.stub, 'RectVisible_Ehh', 6],
      [Gdi.stub, 'RectInRegion_Ehh', 6],
      [Gdi.stub, 'UnicodeToAnsi', 8],
      [Gdi.stub, 'GetBitmapDimensionEx', 6],
      [Gdi.stub, 'GetBrushOrgEx', 6],
      // 470 //
      [Gdi.stub, 'GetCurrentPositionEx', 6],
      [Gdi.stub, 'GetTextExtEntPoint', 12],
      [Gdi.stub, 'GetViewportExtEx', 6],
      [Gdi.stub, 'GetViewportOrgEx', 6],
      [Gdi.stub, 'GetWindowExtEx', 6],
      [Gdi.stub, 'GetWindowOrgEx', 6],
      [Gdi.stub, 'OffsetViewportOrgEx', 10],
      [Gdi.stub, 'OffsetWindowOrgEx', 10],
      [Gdi.stub, 'SetBitmapDimensionEx', 10],
      [Gdi.stub, 'SetViewportExtEx', 10],
      // 480 //
      [Gdi.stub, 'SetViewportOrgEx', 10],
      [Gdi.stub, 'SetWindowExtEx', 10],
      [Gdi.stub, 'SetWindowOrgEx', 10],
      [Gdi.stub, 'MoveToEx', 10],
      [Gdi.stub, 'ScaleViewportExtEx', 14],
      [Gdi.stub, 'ScaleWindowExtEx', 14],
      [Gdi.stub, 'GetAspectRatioFilterEx', 6],
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
