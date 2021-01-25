"use strict";

/** @namespace Gdi */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, LONG, ULONG,
         DWORD, HLOCAL, HGLOBAL, HANDLE, ATOM, LRESULT,
         HMENU, HINSTANCE, WPARAM, LPARAM, HDC, HGDIOBJ,
         HBRUSH, HPEN, HICON, HCURSOR, WNDPROC, COLORREF, HBITMAP,
         BOOL, NEARPTR, FARPTR, LPCSTR, HWND, Struct } from './types.js';

import { BitBlt } from './gdi/BitBlt.js';
import { CreateBitmap } from './gdi/CreateBitmap.js';
import { CreateCompatibleBitmap } from './gdi/CreateCompatibleBitmap.js';
import { CreateCompatibleDC } from './gdi/CreateCompatibleDC.js';
import { CreatePen } from './gdi/CreatePen.js';
import { CreateSolidBrush } from './gdi/CreateSolidBrush.js';
import { DeleteDC } from './gdi/DeleteDC.js';
import { DeleteObject } from './gdi/DeleteObject.js';
import { GetBitmapBits } from './gdi/GetBitmapBits.js';
import { GetDeviceCaps } from './gdi/GetDeviceCaps.js';
import { GetObject } from './gdi/GetObject.js';
import { GetRasterizerCaps } from './gdi/GetRasterizerCaps.js';
import { GetTextExtent } from './gdi/GetTextExtent.js';
import { GetTextMetrics } from './gdi/GetTextMetrics.js';
import { GetStockObject } from './gdi/GetStockObject.js';
import { LineTo } from './gdi/LineTo.js';
import { MoveTo } from './gdi/MoveTo.js';
import { PatBlt } from './gdi/PatBlt.js';
import { Rectangle } from './gdi/Rectangle.js';
import { SelectObject } from './gdi/SelectObject.js';
import { SetBitmapBits } from './gdi/SetBitmapBits.js';
import { SetBkColor } from './gdi/SetBkColor.js';
import { SetPixel } from './gdi/SetPixel.js';
import { SetTextColor } from './gdi/SetTextColor.js';
import { TextOut } from './gdi/TextOut.js';

/**
 * The Win16 GDI library.
 *
 * @memberof Win16
 */
export class Gdi extends Module {
    static get name() {
        return "GDI";
    }

    static get path() {
        return "C:\\WINDOWS\\SYSTEM\\GDI.EXE";
    }

    static get exports() {
        return [
            // 0 //
            null,
            [SetBkColor, "SetBkColor", 6, [HDC, COLORREF], COLORREF],
            [Gdi.stub, "SetBkMode", 4],
            [Gdi.stub, "SetMapMode", 4],
            [Gdi.stub, "SetRop2", 4],
            [Gdi.stub, "SetRelAbs", 6],
            [Gdi.stub, "SetPolyFillMode", 4],
            [Gdi.stub, "SetStretchBltMode", 4],
            [Gdi.stub, "SetTextCharacterExtra", 4],
            [SetTextColor, "SetTextColor", 6, [HDC, COLORREF], COLORREF],
            // 10 //
            [Gdi.stub, "SetTextJustification", 6],
            [Gdi.stub, "SetWindowOrg", 6],
            [Gdi.stub, "SetWindowExt", 6],
            [Gdi.stub, "SetViewportOrg", 6],
            [Gdi.stub, "SetViewportExt", 6],
            [Gdi.stub, "OffsetWindowOrg", 6],
            [Gdi.stub, "ScaleWindowExt", 10],
            [Gdi.stub, "OffsetViewportOrg", 6],
            [Gdi.stub, "ScaleViewportExt", 10],
            [LineTo, "LineTo", 6, [HDC, INT, INT], BOOL],
            // 20 //
            [MoveTo, "MoveTo", 6, [HDC, INT, INT], DWORD],
            [Gdi.stub, "ExcludeClipRect", 10],
            [Gdi.stub, "IntersectClipRect", 10],
            [Gdi.stub, "Arc", 18],
            [Gdi.stub, "Ellipse", 10],
            [Gdi.stub, "FloodFill", 10],
            [Gdi.stub, "Pie", 18],
            [Rectangle, "Rectangle", 10, [HDC, INT, INT, INT, INT], BOOL],
            [Gdi.stub, "RoundRect", 14],
            [PatBlt, "PatBlt", 14, [HDC, INT, INT, INT, INT, DWORD], BOOL],
            // 30 //
            [Gdi.stub, "SaveDC", 2],
            [SetPixel, "SetPixel", 10, [HDC, INT, INT, COLORREF], COLORREF],
            [Gdi.stub, "OffsetClipRgn", 6],
            [TextOut, "TextOut", 12, [HDC, INT, INT, LPCSTR, INT], BOOL],
            [BitBlt, "BitBlt", 20, [HDC, INT, INT, INT, INT, HDC, INT, INT, DWORD], BOOL],
            [Gdi.stub, "StretchBlt", 24],
            [Gdi.stub, "Polygon", 8],
            [Gdi.stub, "Polyline", 8],
            [Gdi.stub, "Escape", 14],
            [Gdi.stub, "RestoreDC", 4],
            // 40 //
            [Gdi.stub, "FillRgn", 6],
            [Gdi.stub, "FrameRgn", 10],
            [Gdi.stub, "InvertRgn", 4],
            [Gdi.stub, "PaintRgn", 4],
            [Gdi.stub, "SelectClipRgn", 4],
            [SelectObject, "SelectObject", 4, [HDC, HGDIOBJ], HGDIOBJ],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "CombineRgn", 8],
            [CreateBitmap, "CreateBitmap", 12, [INT, INT, UINT, UINT, FARPTR], HBITMAP],
            [Gdi.stub, "CreateBitmapIndirect", 4],
            // 50 //
            [Gdi.stub, "CreateBrushIndirect", 4],
            [CreateCompatibleBitmap, "CreateCompatibleBitmap", 6, [HDC, INT, INT], HBITMAP],
            [CreateCompatibleDC, "CreateCompatibleDC", 2, [HDC], HDC],
            [Gdi.stub, "CreateDC", 16],
            [Gdi.stub, "CreateEllipticRgn", 8],
            [Gdi.stub, "CreateEllipticRgnIndirect", 4],
            [Gdi.stub, "CreateFont", 30],
            [Gdi.stub, "CreateFontIndirect", 4],
            [Gdi.stub, "CreateHatchBrush", 6],
            [Gdi.stub, "unknown"],
            // 60 //
            [Gdi.stub, "CreatePatternBrush", 2],
            [CreatePen, "CreatePen", 8, [INT, INT, COLORREF], HPEN],
            [Gdi.stub, "CreatePenIndirect", 4],
            [Gdi.stub, "CreatePolygonRgn", 8],
            [Gdi.stub, "CreateRectRgn", 8],
            [Gdi.stub, "CreateRectRgnIndirect", 4],
            [CreateSolidBrush, "CreateSolidBrush", 4, [COLORREF], HBRUSH],
            [Gdi.stub, "DPToLP", 8],
            [DeleteDC, "DeleteDC", 2, [HDC], BOOL],
            [DeleteObject, "DeleteObject", 2, [HGDIOBJ], BOOL],
            // 70 //
            [Gdi.stub, "EnumFonts", 14],
            [Gdi.stub, "EnumObjects", 12],
            [Gdi.stub, "EqualRgn", 4],
            [Gdi.stub, "ExcludeVisRect", 10],
            [GetBitmapBits, "GetBitmapBits", 10, [HBITMAP, LONG, FARPTR], LONG],
            [Gdi.stub, "GetBkColor", 2],
            [Gdi.stub, "GetBkMode", 2],
            [Gdi.stub, "GetClipBox", 6],
            [Gdi.stub, "GetCurrentPosition", 2],
            [Gdi.stub, "GetDCOrg", 2],
            // 80 //
            [GetDeviceCaps, "GetDeviceCaps", 4, [HDC, INT], INT],
            [Gdi.stub, "GetMapMode", 2],
            [GetObject, "GetObject", 8, [HGDIOBJ, INT, FARPTR], INT],
            [Gdi.stub, "GetPixel", 6],
            [Gdi.stub, "GetPolyfillMode", 2],
            [Gdi.stub, "GetRop2", 2],
            [Gdi.stub, "GetRelAbs", 2],
            [GetStockObject, "GetStockObject", 2, [INT], HGDIOBJ],
            [Gdi.stub, "GetStretchBltMode", 2],
            [Gdi.stub, "GetTextCharacterExtra", 2],
            // 90 //
            [Gdi.stub, "GetTextColor", 2],
            [GetTextExtent, "GetTextExtent", 8, [HDC, LPCSTR, INT], DWORD],
            [Gdi.stub, "GetTextFace", 8],
            [GetTextMetrics, "GetTextMetrics", 6, [HDC, [TEXTMETRIC]], BOOL],
            [Gdi.stub, "GetViewportExt", 2],
            [Gdi.stub, "GetViewportOrg", 2],
            [Gdi.stub, "GetWindowExt", 2],
            [Gdi.stub, "GetWindowOrg", 2],
            [Gdi.stub, "IntersectVisRect", 10],
            [Gdi.stub, "LPToDP", 8],
            // 100 //
            [Gdi.stub, "LineDDA", 16],
            [Gdi.stub, "OffsetRgn", 6],
            [Gdi.stub, "OffsetVisRgn", 6],
            [Gdi.stub, "PtVisible", 6],
            [Gdi.stub, "RectVisible", 6],
            [Gdi.stub, "SelectVisRgn", 4],
            [SetBitmapBits, "SetBitmapBits", 10, [HBITMAP, DWORD, FARPTR], LONG],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 110 //
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "SetDCOrg", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "AddFontResource", 4],
            // 120 //
            [Gdi.stub, "unknown"],
            [Gdi.stub, "Death", 2],
            [Gdi.stub, "Resurrection", 14],
            [Gdi.stub, "PlayMetafile", 4],
            [Gdi.stub, "GetMetafile", 4],
            [Gdi.stub, "CreateMetafile", 4],
            [Gdi.stub, "CloseMetafile", 2],
            [Gdi.stub, "DeleteMetafile", 2],
            [Gdi.stub, "MulDiv", 6],
            [Gdi.stub, "SaveVisRgn", 2],
            // 130 //
            [Gdi.stub, "RestoreVisRgn", 2],
            [Gdi.stub, "InquireVisRgn", 2],
            [Gdi.stub, "SetEnvironment", 10],
            [Gdi.stub, "GetEnvironment", 10],
            [Gdi.stub, "GetRgnBox", 6],
            [Gdi.stub, "ScanLR", 12],
            [Gdi.stub, "RemoveFontResource", 4],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 140 //
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "SetBrushOrg", 6],
            [Gdi.stub, "GetBrushOrg", 2],
            // 150 //
            [Gdi.stub, "UnrealizeObject", 2],
            [Gdi.stub, "CopyMetafile", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "CreateIC", 16],
            [Gdi.stub, "GetNearestColor", 6],
            [Gdi.stub, "QueryAbort", 4],
            [Gdi.stub, "CreateDiscardableBitmap", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "GetMetafileBits", 2],
            // 160 //
            [Gdi.stub, "SetMetafileBits", 2],
            [Gdi.stub, "PtInRegion", 6],
            [Gdi.stub, "GetBitmapDimension", 2],
            [Gdi.stub, "SetBitmapDimension", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "IsDCDirty", 6],
            // 170 //
            [Gdi.stub, "SetDCStatus", 8],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "SetRectRgn", 10],
            [Gdi.stub, "GetClipRgn", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "EnumMetafile", 12],
            [Gdi.stub, "PlayMetafileRecord", 12],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "GetDCState", 2],
            // 180 //
            [Gdi.stub, "SetDCState", 4],
            [Gdi.stub, "RectInRegion", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 190 //
            [Gdi.stub, "SetDCHook", 10],
            [Gdi.stub, "GetDCHook", 6],
            [Gdi.stub, "SetHookFlags", 4],
            [Gdi.stub, "SetBoundsRect", 8],
            [Gdi.stub, "GetBoundsRect", 8],
            [Gdi.stub, "SelectBitmap", 4],
            [Gdi.stub, "SetMetafileBitsBetter", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 200 //
            [Gdi.stub, "unknown"],
            [Gdi.stub, "DMBitBlt", 16],
            [Gdi.stub, "DMColorInfo", 16],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "DMEnumDFonts", 16],
            [Gdi.stub, "DMEnumObj", 0],
            [Gdi.stub, "DMOutput", 16],
            [Gdi.stub, "DMPixel", 16],
            // 210 //
            [Gdi.stub, "DMRealizeObject", 16],
            [Gdi.stub, "DMStrBlt", 30],
            [Gdi.stub, "DMScanLR", 0],
            [Gdi.stub, "Brute", 0],
            [Gdi.stub, "DMExtTextOut", 40],
            [Gdi.stub, "DMGetCharWidth", 16],
            [Gdi.stub, "DMStretchBlt", 16],
            [Gdi.stub, "DMDibBits", 16],
            [Gdi.stub, "DMStretchDIBits", 16],
            [Gdi.stub, "DMSetDibToDev", 16],
            // 220 //
            [Gdi.stub, "DMTranspose"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 230 //
            [Gdi.stub, "CreatePQ", 2],
            [Gdi.stub, "MinPQ", 2],
            [Gdi.stub, "ExtractPQ", 2],
            [Gdi.stub, "InsertPQ", 6],
            [Gdi.stub, "SizePQ", 4],
            [Gdi.stub, "DeletePQ", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 240 //
            [Gdi.stub, "OpenJoba, 10"],
            [Gdi.stub, "WriteSpool", 8],
            [Gdi.stub, "WriteDialog", 8],
            [Gdi.stub, "CloseJob", 2],
            [Gdi.stub, "DeleteJob", 4],
            [Gdi.stub, "GetSpoolJob", 6],
            [Gdi.stub, "StartSpoolPage", 2],
            [Gdi.stub, "EndSpoolPage", 2],
            [Gdi.stub, "QueryJob", 4],
            [Gdi.stub, "unknown"],
            // 250 //
            [Gdi.stub, "Copy", 10],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "DeleteSpoolPage", 2],
            [Gdi.stub, "SpoolFile", 16],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 260 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 270 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 280 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 290 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 300 //
            [Gdi.stub, "EngineEnumerateFont", 12],
            [Gdi.stub, "EngineDeleteFont", 4],
            [Gdi.stub, "EngineRealizeFont", 12],
            [Gdi.stub, "EngineGetCharWidth", 12],
            [Gdi.stub, "EngineSetFontContext"], // TODO: this errored by disassembler
            [Gdi.stub, "EngineGetGlyphBmp", 22],
            [Gdi.stub, "EngineMakeFontDir", 10],
            [Gdi.stub, "GetCharAbcWidths", 10],
            [Gdi.stub, "GetOutlineTextMetrics", 8],
            [Gdi.stub, "GetGlyphOutline", 22],
            // 310 //
            [Gdi.stub, "CreateScalableFontResource", 12],
            [Gdi.stub, "GetFontData", 18],
            [Gdi.stub, "ConvertOutlineFontFile", 12],
            [GetRasterizerCaps, "GetRasterizerCaps", 6, [[RASTERIZER_STATUS], INT], BOOL],
            [Gdi.stub, "EngineExtTextOut", 42],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 320 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 330 //
            [Gdi.stub, "EnumFontFamilies", 14],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "GetKerningPairs", 8],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 340 //
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "GetTextAlign", 2],
            [Gdi.stub, "SetTextAlign", 4],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "Chord", 18],
            [Gdi.stub, "SetMapperFlags", 6],
            // 350 //
            [Gdi.stub, "GetCharWidth", 10],
            [Gdi.stub, "ExtTextOut", 22],
            [Gdi.stub, "GetPhysicalFontHandle", 2],
            [Gdi.stub, "GetAspectRatioFilter", 2],
            [Gdi.stub, "ShrinkGDIHeap", 0],
            [Gdi.stub, "FTrapping0"], // TODO: floating-point instructions
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            // 360 //
            [Gdi.stub, "CreatePalette", 4],
            [Gdi.stub, "GDISelectPalette", 6],
            [Gdi.stub, "GDIRealizePalette", 2],
            [Gdi.stub, "GetPaletteEntries", 10],
            [Gdi.stub, "SetPaletteEntries", 10],
            [Gdi.stub, "RealizeDefaultPalette", 2],
            [Gdi.stub, "UpdateColors", 2],
            [Gdi.stub, "AnimatePalette", 10],
            [Gdi.stub, "ResizePalette", 4],
            [Gdi.stub, "unknown"],
            // 370 //
            [Gdi.stub, "GetNearestPaletteIndex", 6],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "ExtFloodFill", 12],
            [Gdi.stub, "SetSystemPaletteUse", 4],
            [Gdi.stub, "GetSystemPaletteUse", 2],
            [Gdi.stub, "GetSystemPaletteEntries", 10],
            [Gdi.stub, "ResetDC", 6],
            [Gdi.stub, "StartDoc", 6],
            [Gdi.stub, "EndDoc", 2],
            [Gdi.stub, "StartPage", 2],
            // 380 //
            [Gdi.stub, "EndPage", 2],
            [Gdi.stub, "SetAbortProc", 6],
            [Gdi.stub, "AbortDoc", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 390 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 400 //
            [Gdi.stub, "FastWindowFrame", 14],
            [Gdi.stub, "GDIMoveBitmap", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "GDIInit2", 4],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "FinalGDIInit", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "CreateUserBitmap", 12],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "CreateUserDiscardableBitmap", 6],
            // 410 //
            [Gdi.stub, "IsValidMetafile", 2],
            [Gdi.stub, "GetCurLogFont", 2],
            [Gdi.stub, "IsDCCurrentPalette", 2],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 420 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 430 //
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "StretchDIBits", 32],
            // 440 //
            [Gdi.stub, "SetDIBits", 18],
            [Gdi.stub, "GetDIBits", 18],
            [Gdi.stub, "CreateDIBitmap", 20],
            [Gdi.stub, "SetDIBitsToDevice", 28],
            [Gdi.stub, "CreateRoundRectRgn", 12],
            [Gdi.stub, "CreateDIBPatternBrush", 4],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "DeviceColorMatch", 8],
            // 450 // https://devblogs.microsoft.com/oldnewthing/20190731-00/?p=102743 :)
            [Gdi.stub, "PolyPolygon", 12],
            [Gdi.stub, "CreatePolyPolygonRgn", 12],
            [Gdi.stub, "GDISeeGDIDo", 8],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"],
            [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"], [Gdi.stub, "unknown"],
            // 460 //
            [Gdi.stub, "GDITaskTermination", 2],
            [Gdi.stub, "SetObjectOwner", 4],
            [Gdi.stub, "IsGDIObject", 0],
            [Gdi.stub, "MakeObjectPrivate", 4],
            [Gdi.stub, "FixUpBogusPublisherMetafile", 6],
            [Gdi.stub, "RectVisible_Ehh", 6],
            [Gdi.stub, "RectInRegion_Ehh", 6],
            [Gdi.stub, "UnicodeToAnsi", 8],
            [Gdi.stub, "GetBitmapDimensionEx", 6],
            [Gdi.stub, "GetBrushOrgEx", 6],
            // 470 //
            [Gdi.stub, "GetCurrentPositionEx", 6],
            [Gdi.stub, "GetTextExtEntPoint", 12],
            [Gdi.stub, "GetViewportExtEx", 6],
            [Gdi.stub, "GetViewportOrgEx", 6],
            [Gdi.stub, "GetWindowExtEx", 6],
            [Gdi.stub, "GetWindowOrgEx", 6],
            [Gdi.stub, "OffsetViewportOrgEx", 10],
            [Gdi.stub, "OffsetWindowOrgEx", 10],
            [Gdi.stub, "SetBitmapDimensionEx", 10],
            [Gdi.stub, "SetViewportExtEx", 10],
            // 480 //
            [Gdi.stub, "SetViewportOrgEx", 10],
            [Gdi.stub, "SetWindowExtEx", 10],
            [Gdi.stub, "SetWindowOrgEx", 10],
            [Gdi.stub, "MoveToEx", 10],
            [Gdi.stub, "ScaleViewportExtEx", 14],
            [Gdi.stub, "ScaleWindowExtEx", 14],
            [Gdi.stub, "GetAspectRatioFilterEx", 6],
        ];
    }

    static stub() {
        console.log("Stub called!");
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
 * The **BITMAP** structure defines the height, width, color format, and bit
 * values of a logical bitmap.
 */
export class BITMAP extends Struct {
    constructor() {
        super([
            ['bmType', INT],
            ['bmWidth', INT],
            ['bmHeight', INT],
            ['bmWidthBytes', INT],
            ['bmPlanes', BYTE],
            ['bmBitsPixel', BYTE],
            ['bmBits', FARPTR]
        ]);
    }
}

/**
 * The **TEXTMETRIC** structure contains basic information about a physical
 * font. For system versions 3.1 and later, the {@link Gdi.EnumFonts EnumFonts}
 * and {@link Gdi.EnumFontFamilies EnumFontFamilies} functions return
 * information about TrueType fonts in a NEWTEXTMETRIC structure.
 */
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
Gdi.HORTSIZE = 0x4;
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
Gdi.TT_AVAILABLE    = 0x0001;
Gdi.TT_ENABLED      = 0x0002;
