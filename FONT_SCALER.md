# Font Scaler Data Structures

This document describes the data structures, graphics state, client interface, and error handling used by a font-scaling/rasterization engine. Function names, field names, and parameter names have been generalized to avoid exposing the original API identifiers.

## 1. Input and output data structures

The engine exchanges information with the host program through two primary records:

- **Input record** — contains configuration, callbacks, transformation information, glyph selection, clipping information, and pointers to client-allocated memory. 

- **Output record** — contains memory requirements, glyph metrics, outline data, bitmap information, and other results produced by the engine. 

The input record includes concepts such as:

| **Anonymized field** | **Purpose** |
| :-: | :-: |
| `version` | Identifies the version of the input structure. |
| `memoryPointers` | Array of pointers to memory blocks allocated by the client in response to engine memory requests. |
| `fontDirectoryPointer` | Legacy field; should be null. |
| `fontDataReader` | Callback used to retrieve portions of the font data. Receives a client identifier, an offset, and a requested length, and returns a pointer to the requested data. |
| `fontDataReleaser` | Callback used when previously retrieved font data is no longer needed. |
| `clientIdentifier` | Client-defined identifier passed to the font-data callback. |
| `platformIdentifier` / `platformSpecificIdentifier` | Select the appropriate character-mapping subtable. |
| `pointSize` | Requested display size in points. |
| `horizontalResolution` / `verticalResolution` | Device resolution in dots per inch. |
| `pixelDiameter` | Effective pixel diameter used to compensate for non-ideal pixel geometry. |
| `transformationMatrix` | 3×3 matrix controlling scaling, rotation, skewing, or other glyph transformations. |
| `traceCallback` | Optional debugging callback invoked before individual instructions execute. |
| `characterIdentifier` | Character code used to select a glyph. A special value can instead request direct glyph-index selection. |
| `glyphIdentifier` | Direct glyph index when character-code lookup is bypassed. |
| `styleCallback` | Legacy/unsupported callback; should be null. |
| `outlineCachePointer` | Client-allocated storage used to save and restore outlines. |
| `lowerClip` / `upperClip` | Scan-line boundaries used when rasterizing only a horizontal band of a glyph. |

The output record contains corresponding results, including:

- **`memoryRequirements`** — sizes of memory blocks that the engine needs the client to allocate. 

- **`glyphIdentifier`** — resolved glyph index. 

- **`bytesConsumed`** — number of bytes consumed while reading a character code. 

- **`metrics`** — advance width and side-bearing information. 

- **`bitmapInfo`** — bitmap pointer, row size, and bitmap bounds. 

- **`outlineCacheSize`** — storage required for caching an outline. 

- **`outlinePresent`** — indicates whether the glyph has an outline. 

- **`contourCount`** — number of contours in the outline. 

- **`xCoordinates` / `yCoordinates`** — outline point coordinates in fixed-point representation. 

- **`contourStarts` / `contourEnds`** — identify the points beginning and ending each contour. 

- **`curveFlags`** — identifies whether outline points lie on the curve. 

- **`scaledControlValues`** — scaled values from the font's control-value table, available when tracing is enabled. 


## 2. Graphics state

The engine maintains two levels of graphics state:

- **Local state** — applies to the current glyph. 

- **Global state** — applies across glyphs for a font. 

The local state is initialized during glyph processing, while the global state is initialized when a transformation is established or, when tracing is disabled, during the first subsequent glyph operation.

### Local graphics state

The local state includes generalized concepts such as:

- Pointers to character/point elements used by instructions. 

- Projection, freedom, and previous-projection vectors. 

- A pointer into the interpreter stack. 

- A pointer to the next instruction. 

- A pointer to the global graphics state. 

- Projection-related helper values. 

- Point-moving and projection callbacks. 

- Control-value and single-width accessors. 

- Interpreter and tracing callbacks. 

- Rounding-rule selection. 

- Loop count. 

- Three reference points used by various instructions. 

- Current instruction code. 

- Error and instruction-boundary information. 

- Control-value manipulation callbacks. 

- Scaling/stretch information. 

### Character-element state

Each character element stores multiple representations of the glyph points:

- **Current coordinates** — include scaling and all instructions executed so far. 

- **Scaled/original coordinates** — include scaling but not instruction effects. 

- **Unscaled original coordinates** — contain the original font coordinates. 

- **On-curve flags** — indicate whether points lie on the outline curve. 

- **Contour count**. 

- **Contour start/end arrays**. 

- **Touched-point flags** — identify whether instructions have acted on points in each coordinate direction. 


## 3. Global graphics state

The global state contains resources shared by glyph processing, including:

- Instruction-definition and function-definition tables. 

- Interpreter stack and storage areas. 

- Control-value table. 

- Program pointers. 

- Scaling callbacks. 

- Default and local parameter blocks. 

- Pixels-per-em and point-size information. 

- Fixed and fractional scaling factors. 

- Transformation characteristics. 

- Horizontal and vertical stretch factors. 

- Angle/transformation information. 

- Program-execution status and program index. 

- Instruction-definition counts. 

- Font profile and control-value counts. 

- Composite-glyph state. 

- Interpolation and metric scaling factors. 


# Font Scaler Operations

The client interface follows a generally ordered workflow. The client is responsible for allocating memory requested by the engine and supplying pointers to that memory.

Every operation returns an error status. A nonzero status indicates failure and should be handled by the client.

## Initialization and font selection

### Open the engine

Opens the font-scaling engine and reports initial memory requirements.

### Initialize the engine

The client supplies the memory blocks requested during opening. This must occur before other processing.

### Load a font

Registers a new font data structure and supplies callbacks for reading and releasing font data. It also establishes platform-specific character mapping information and reports additional memory requirements.

This operation is repeated when switching fonts or when relevant font-profile information changes.

### Establish transformation

Supplies:

- Point size 

- Device resolution 

- Pixel geometry 

- Transformation matrix 

- Optional tracing callback 

The operation must be repeated whenever any of these parameters change.


## Glyph processing

### Select glyph

Converts a character identifier into a glyph identifier. Alternatively, a special character value allows the caller to provide the glyph index directly.

The result includes the resolved glyph identifier and the number of character-code bytes consumed.

### Obtain advance width

Returns the glyph's advance width without generating its complete outline.

This is useful when only text measurement is required. Unlike full grid-fitting, it does not account for hinting that may alter the final advance width.

### Obtain a range of hinted widths

A helper operation can return hinted advance widths for an inclusive range of glyph indices. The caller provides the destination array.


## Outline generation

### Generate hinted outline

Executes the glyph instructions and produces a grid-fitted outline.

The output contains coordinates, contour boundaries, curve flags, contour count, scaled control values, and an indication of whether an outline exists.

### Generate unhinted outline

Produces an outline without executing the glyph's instructions.

This allows the caller to compare the raw glyph shape with its instruction-adjusted version.


# Bitmap generation

## Determine monochrome bitmap requirements

Calculates the amount of memory required to rasterize an outline into a bitmap and returns related metrics.

## Determine banding requirements

Calculates memory requirements for rasterizing a glyph in horizontal bands.

Two strategies are supported:

- **Small-memory banding** — minimizes workspace requirements by reducing allocations according to the selected band height. 

- **Fast banding** — uses additional persistent workspace to retain rendering information between bands and can preserve dropout-control behavior. 

The client should generally use the largest practical band size because each rasterization call has overhead.

## Determine grayscale requirements

Calculates the memory needed to create a grayscale bitmap. The caller specifies an oversampling factor and may request that the grayscale bounding box match the monochrome bounding box.

The oversampling factor determines the number of possible grayscale levels. Powers of two are recommended for efficiency.

## Determine grayscale banding requirements

Calculates workspace requirements for grayscale rasterization using the same small-memory and fast-banding approaches.

## Scan-convert to monochrome

Converts an outline into a bitmap.

The client supplies the required memory blocks and specifies the vertical range to process. Processing can cover the entire glyph or a selected horizontal band.

## Scan-convert to grayscale

Converts an outline into a grayscale bitmap. The resulting bitmap contains per-pixel coverage/count information, with the number of possible values determined by the oversampling factor.


# Outline caching

## Determine outline-cache size

Reports how much memory is required to cache the current outline.

## Save outline

Stores an outline in client-provided cache memory for later use.

## Restore outline

Reloads a previously cached outline and reconstructs the information required for subsequent bitmap generation.


# Memory-management model

The engine generally **does not allocate or relocate memory on behalf of the client**.

The general pattern is:

1. The engine reports required block sizes through the output record. 

2. The client allocates the blocks. 

3. The client places their addresses into the corresponding input-record pointer slots. 

4. The next engine operation consumes those blocks. 

Except for opening and closing the engine, the interface generally does not allocate, free, or relocate these objects itself. If the client moves an allocated block, its corresponding pointer must be updated before the next call.

Font-data callbacks must likewise avoid moving memory that the engine is actively using.


# Error handling

Each interface operation returns an error code, and the output record also contains an error status.

Representative error categories include:

| **Anonymized error** | **Meaning** |
| :-: | :-: |
| `NULL\_MEMORY\_POINTER` | A required memory pointer was unexpectedly null. |
| `NULL\_INPUT\_POINTER` | The input record pointer was null. |
| `NULL\_MEMORY\_ARRAY` | The input record's memory-pointer array was null. |
| `INVALID\_CALL\_ORDER` | An interface operation was invoked out of sequence. |
| `NULL\_FONT\_DIRECTORY` | A font-directory reference was unexpectedly null. |
| `NULL\_FONT\_DATA\_CALLBACK` | The font-data retrieval callback was missing. |
| `NULL\_OUTPUT\_POINTER` | The output record pointer was null. |
| `INVALID\_GLYPH\_IDENTIFIER` | The requested glyph exceeds the font's declared glyph range. |
| `BAND\_TOO\_LARGE` | A requested rasterization band exceeds the size established during banding setup. |

In general, a nonzero error indicates that processing did not complete successfully and should be handled by the client.


# Overall processing flow

A typical client interaction can therefore be summarized as:

```
Open engine

    ↓

Initialize engine memory

    ↓

Load/select font

    ↓

Set size, resolution, and transformation

    ↓

Select glyph

    ↓

 ┌─────────────────────────────┐

 │ Measure only                │ → Obtain advance width

 │                             │

 │ Generate outline            │

 │   ├─ hinted                 │

 │   └─ unhinted               │

 │                             │

 │ Cache outline (optional)    │

 │                             │

 │ Determine bitmap memory     │

 │   ├─ monochrome             │

 │   └─ grayscale              │

 │                             │

 │ Configure banding (optional)│

 │                             │

 │ Scan-convert                │

 │   ├─ monochrome             │

 │   └─ grayscale              │

 └─────────────────────────────┘

    ↓

Repeat for additional glyphs

    ↓

Close engine
```

The essential architecture is therefore **client-managed memory + font-data callbacks + transformation state + glyph selection + outline generation + optional caching + rasterization**, with the graphics state controlling how glyph instructions are interpreted.

