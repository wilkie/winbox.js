```markdown
# Font Error Handling Library

This library provides a set of functions to handle errors during the
execution of font-related operations. It includes functions for context
management, error reporting, and error handling during the execution loop.

## Functions

### `Context(int switch, char * string, unsigned short size, unsigned
short code)`

**Purpose**: Records context information for error reporting.

**Parameters**:
- `switch`: A switch indicating the type of context to record.
  - `ERR_CONTEXT_FILE`: Records the job name.
  - `ERR_CONTEXT_SIZE`: Records the character size.
  - `ERR_CONTEXT_CODE`: Records the character code / glyph index.
- `string`: The string to record, typically the job name.
- `size`: The character size.
- `code`: The character code / glyph index.

**Behavior**:
- Depending on the value of `switch`, records the appropriate context
information.
- Resets `errOpName` to an empty string.

### `Start(void)`

**Purpose**: Initializes error tracking for a new execution loop.

**Parameters**: None.

**Behavior**:
- Resets the instruction count (`errInstCount`) to zero.
- Resets the `errBreak` flag to 0 (do not break out of the execution
loop).
- Sets up the IF/EIF counter for the current level.

### `Record(int opc)`

**Purpose**: Records the current instruction and handles IF/EIF balancing.

**Parameters**:
- `opc`: The opcode of the current instruction.

**Behavior**:
- Increments the instruction count (`errInstCount`).
- Sets the current opcode (`errOpc`).
- Adjusts the IF/EIF counter based on the opcode.

### `Report(int flag, long value1, long value2, long value3, long value4)`

**Purpose**: Reports an error and sets the break flag to stop the
execution loop.

**Parameters**:
- `flag`: The error flag indicating the type of error.
- `value1`, `value2`, `value3`, `value4`: Additional parameters relevant
to the error.

**Behavior**:
- Calls `errPrint()` to log the error.
- Sets the `errBreak` flag to 1 to stop the execution loop.

### `Break(void)`

**Purpose**: Checks if the execution loop should break due to an error.

**Parameters**: None.

**Behavior**:
- Returns the value of `errBreak`.
- If non-zero, the main execution loop will terminate.

### `Opc(char *name)`

**Purpose**: Sets the actual opcode name for error reporting.

**Parameters**:
- `name`: The actual opcode name.

**Behavior**:
- Copies the actual opcode name into `errOpName`.

### `End(void)`

**Purpose**: Checks for balanced IF/EIF pairs and reports any unbalanced
pairs.

**Parameters**: None.

**Behavior**:
- If IF/EIF tracking is enabled (`errIfOk`), checks if there are any
unbalanced pairs.
- Reports any unbalanced IF/EIF pairs using `errPrint()`.
- Resets the IF/EIF tracking if necessary.

### `If(int value)`

**Purpose**: Records IF/EIF activity during conditional checks.

**Parameters**:
- `value`: The value to add to the IF/EIF counter.

**Behavior**:
- Adjusts the IF/EIF counter based on the value of `value`.
- This function is typically called from within conditional functions
(`If()`, `Else()`, `EndIf()`).

### `errPrint(int flag, long value1, long value2, long value3, long
value4)`

**Purpose**: Logs an error message.

**Parameters**:
- `flag`: The error flag indicating the type of error.
- `value1`, `value2`, `value3`, `value4`: Additional parameters relevant
to the error.

**Behavior**:
- Constructs an error message based on the error flag and parameters.
- Prints the error message using a function like `errOutput()`.

### `errOutput(char *message)`

**Purpose**: Outputs an error message.

**Parameters**:
- `message`: The error message to output.

**Behavior**:
- Outputs the error message to a destination (e.g., console, log file).

## Constants

- `ERR_MAX_FNAME`: Maximum length of the job name.
- `ERR_MAX_IFS`: Maximum number of nested IF/EIF pairs.

## Variables

- `errFname`: Stores the job name.
- `errSize`: Stores the character size.
- `errCode`: Stores the character code / glyph index.
- `errInstCount`: Tracks the number of executed instructions.
- `errBreak`: Flag to indicate if the execution loop should break.
- `errIfOk`: Flag to indicate if IF/EIF tracking is enabled.
- `errIfNdx`: Index of the current IF/EIF level.
- `errIfs[]`: Array to track IF/EIF nesting levels.
- `errOpc`: Current opcode.
- `errOpName`: Actual opcode name for error reporting.
- `errOpcs[]`: Array of opcode names.

## Notes

- The code uses `sprintf` to construct error messages, which may be unsafe
in some contexts.
- The `errOpName` variable is used to handle non-standard opcode names,
which can be a bit convoluted.
- The library provides a mechanism for tracking nested IF/EIF pairs to
ensure balanced execution.
```

```markdown
# Bitmap Operations Module

## Overview
This module provides a set of functions for performing various bitmap
operations, including rendering fonts, manipulating contours, and applying
shapes to bitmaps.

## Functions

### InitBitmap
Initializes a bitmap with the specified width and height.

- **Parameters:**
  - `width`: The width of the bitmap.
  - `height`: The height of the bitmap.

- **Returns:**
  - A pointer to the initialized bitmap.

### ClearBitmap
Clears the bitmap to a specified color.

- **Parameters:**
  - `bitmap`: The bitmap to clear.
  - `color`: The color to clear the bitmap with.

### DrawPixel
Draws a pixel at the specified coordinates with the given color.

- **Parameters:**
  - `bitmap`: The bitmap on which to draw.
  - `x`: The x-coordinate of the pixel.
  - `y`: The y-coordinate of the pixel.
  - `color`: The color of the pixel.

### FillRectangle
Fills a rectangle with the specified color.

- **Parameters:**
  - `bitmap`: The bitmap to fill.
  - `x`: The x-coordinate of the rectangle's top-left corner.
  - `y`: The y-coordinate of the rectangle's top-left corner.
  - `width`: The width of the rectangle.
  - `height`: The height of the rectangle.
  - `color`: The color to fill the rectangle with.

### BlitHorizontal
Blits a horizontal line onto the bitmap.

- **Parameters:**
  - `bitmap`: The bitmap to blit onto.
  - `x`: The x-coordinate of the start of the line.
  - `y`: The y-coordinate of the line.
  - `length`: The length of the line.
  - `color`: The color of the line.

### BlitVertical
Blits a vertical line onto the bitmap.

- **Parameters:**
  - `bitmap`: The bitmap to blit onto.
  - `x`: The x-coordinate of the line.
  - `y`: The y-coordinate of the start of the line.
  - `length`: The length of the line.
  - `color`: The color of the line.

### DrawShape
Draws a shape onto the bitmap.

- **Parameters:**
  - `bitmap`: The bitmap to draw the shape onto.
  - `shape`: The shape to draw.
  - `color`: The color of the shape.

### RenderFont
Renders a font onto the bitmap.

- **Parameters:**
  - `bitmap`: The bitmap to render the font onto.
  - `font`: The font to render.
  - `x`: The x-coordinate of the start of the text.
  - `y`: The y-coordinate of the start of the text.
  - `color`: The color of the text.

### GetPixel
Retrieves the color of a pixel at the specified coordinates.

- **Parameters:**
  - `bitmap`: The bitmap from which to retrieve the pixel.
  - `x`: The x-coordinate of the pixel.
  - `y`: The y-coordinate of the pixel.

- **Returns:**
  - The color of the pixel.

### SaveBitmap
Saves the bitmap to a file.

- **Parameters:**
  - `bitmap`: The bitmap to save.
  - `filename`: The filename to save the bitmap to.

- **Returns:**
  - `True` if the bitmap was saved successfully, `False` otherwise.
```

## File Description

This file contains several functions for processing and manipulating font
data, specifically focusing on retrieving glyph metrics, converting
character codes to glyph IDs, and extracting outline coordinates. The
functions utilize a font context structure (`SplineKey`) and various
helper functions to perform these operations.

## Function Descriptions

### `GetAdvanceHeights`

Retrieves the advance heights for a range of glyphs. If bitmap metrics are
found, they are used; otherwise, vmtx table metrics are read and scaled.

**Pseudocode:**

```pseudo
function GetAdvanceHeights(inputPtr, usFirstGlyph, usLastGlyph,
psvAdvanceHeights, psvTopSideBearings)
    key = setUpKey(inputPtr, INITIALIZED | NEWSFNT | NEWTRANS, error)
    if not key then return error

    pvGlobalGS = queryGlobalGS(key->memoryBases[PRIVATE_FONT_SPACE_BASE],
key->PrivateSpaceOffsets)

    if usLastGlyph > maxProfile.numGlyphs or usLastGlyph < usFirstGlyph
then return INVALID_GLYPH_INDEX

    if psvAdvanceHeights is null and psvTopSideBearings is null then
return NULL_INPUT_PTR_ERR

    usPPEM = queryPPEM(pvGlobalGS)
    usPPEMX, usPPEMY, usRotation = queryPPEMXY(pvGlobalGS,
key->TransformInfo)

    usNumLongVertMetrics = readNumLongVertMetrics(key->ClientInfo)

    for usGlyphIndex from usFirstGlyph to usLastGlyph
        bBitmapFound = false
        f26DevAdvanceHeight = (0, 0)
        f26DevTopSideBearing = (0, 0)

        error = LookForSbitVertMetrics(key, usGlyphIndex, usPPEMX,
usPPEMY, usRotation, &bBitmapFound, &f26DevAdvanceHeight,
&f26DevTopSideBearing)
        if error then return error

        if bBitmapFound
            svDevAdvanceHeight.x = (f26DevAdvanceHeight.x + DOT6ONEHALF)
>> 6
            svDevAdvanceHeight.y = (f26DevAdvanceHeight.y + DOT6ONEHALF)
>> 6
            svDevTopSideBearing.x = (f26DevTopSideBearing.x + DOT6ONEHALF)
>> 6
            svDevTopSideBearing.y = (f26DevTopSideBearing.y + DOT6ONEHALF)
>> 6
        else
            usNonScaledAH, sNonScaledTSB =
readVerticalMetrics(key->ClientInfo, usGlyphIndex, usNumLongVertMetrics)
            vecAdvanceHeight, vecTopSideBearing =
scaleVerticalMetrics(key->TransformInfo, pvGlobalGS, usNonScaledAH,
sNonScaledTSB)
            svDevAdvanceHeight.x = (vecAdvanceHeight.x + ONEHALFFIX) >> 16
            svDevAdvanceHeight.y = (vecAdvanceHeight.y + ONEHALFFIX) >> 16
            svDevTopSideBearing.x = (vecTopSideBearing.x + ONEHALFFIX) >>
16
            svDevTopSideBearing.y = (vecTopSideBearing.y + ONEHALFFIX) >>
16

        if psvAdvanceHeights then *psvAdvanceHeights++ =
svDevAdvanceHeight
        if psvTopSideBearings then *psvTopSideBearings++
= svDevTopSideBearing

    return NO_ERR
```

### `LookForSbitVertMetrics`

Searches for an embedded bitmap and retrieves its vertical metrics if
found.

**Pseudocode:**

```pseudo
function LookForSbitVertMetrics(key, usGlyphIndex, usPPEMX, usPPEMY,
usRotation, pbBitmapFound, pf26DevAdvanceHeight, pf26DevTopSideBearing)
    usFoundCode = searchForBitmap(key->SbitMono, key->ClientInfo, usPPEMX,
usPPEMY, usRotation, usGlyphIndex)
    if usFoundCode != 0
        error = getVerticalMetrics(key->SbitMono, key->ClientInfo,
&pbBitmapFound, pf26DevAdvanceHeight, pf26DevTopSideBearing)
        if error then return error

    return NO_ERR
```

### `GetGlyphIDs`

Retrieves glyph IDs for an array or range of character codes.

**Pseudocode:**

```pseudo
function GetGlyphIDs(inputPtr, usCharCount, usFirstChar, pusCharCode,
pusGlyphID)
    key = setUpKey(inputPtr, INITIALIZED | NEWSFNT | NEWTRANS, error)
    if not key then return error
    error = getMultiGlyphIDs(key->ClientInfo, usCharCount, usFirstChar,
pusCharCode, pusGlyphID)
    if error then return error

    return NO_ERR
```

### `Win95GetGlyphIDs`

Retrieves glyph IDs for an array or range of character codes, specific to
Win95.

**Pseudocode:**

```pseudo
function Win95GetGlyphIDs(pbyCmapSubTable, usCharCount, usFirstChar,
pusCharCode, pusGlyphID)
    error = getWin95GlyphIDs(pbyCmapSubTable, usCharCount, usFirstChar,
pusCharCode, pusGlyphID)
    if error then return error

    return NO_ERR
```

### `GetOutlineCoordinates`

Retrieves outline coordinates for an array of points on a glyph outline.

**Pseudocode:**

```pseudo
function GetOutlineCoordinates(inputPtr, usPointCount, pusPointIndex,
psvCoordinates)
    key = setUpKey(inputPtr, INITIALIZED | NEWSFNT | NEWTRANS | GOTINDEX |
GOTGLYPH, error)
    if not key then return error
    if ulState & SIZEKNOWN then return OUT_OFF_SEQUENCE_CALL_ERR
    if bGlyphHasOutline == false then return BAD_POINT_INDEX_ERR

    if apbPrevMemoryBases[WORK_SPACE_BASE] != memoryBases[WORK_SPACE_BASE]
        updateWorkSpaceAddresses(memoryBases[WORK_SPACE_BASE],
key->WorkSpaceOffsets, key->pWorkSpaceAddr)
        updateWorkSpaceElement(key->WorkSpaceOffsets, key->pWorkSpaceAddr)
        copyPrevMemoryBases()

    contourData = getContourData(pWorkSpaceAddr)
    error = getCoords(contourData, usPointCount, pusPointIndex,
psvCoordinates)
    if error then return error

    return NO_ERR
```

### Helper Functions

- `setUpKey`
- `queryGlobalGS`
- `queryPPEM`
- `queryPPEMXY`
- `readNumLongVertMetrics`
- `searchForBitmap`
- `getVerticalMetrics`
- `getMultiGlyphIDs`
- `getWin95GlyphIDs`
- `getContourData`
- `getCoords`

## Overview

The code provides functions to manage and manipulate glyph data for a font
rendering system. It handles memory allocation, glyph initialization,
merging scan types, applying transformations, and checking conditions for
scan control. The code is part of a larger system that processes and
renders fonts, and it includes assertions to ensure data integrity.

## Functions Pseudocode

### `TransformGlyph`

Applies a transformation to a glyph.

```plaintext
Function TransformGlyph(
    Glyph *glyph, 
    Matrix *matrix
)
    If the matrix is not identity:
        Apply the matrix to the glyph's position, bounding box, and other
transformable properties
```

### `MergeScanTypes`

Merges scan type information between a parent and child glyph.

```plaintext
Function MergeScanTypes(
    GlyphData *glyphData, 
    GlyphData *parentGlyphData
)
    If parent scan type is initialized:
        Merge the scan types using bitwise operations
    Otherwise:
        Set parent scan type to child scan type
```

### `DoScanControl`

Determines if scan control should be applied based on various conditions.

```plaintext
Function DoScanControl(
    uint16 scanControl, 
    uint32 imageState
)
    For each condition specified in scanControl:
        Check if the condition is met
        If not met, return false
    If all conditions are met, return true
```

### `InitializeMemory`

Initializes memory for glyph data blocks.

```plaintext
Function InitializeMemory(
    uint32 glyphDataCount, 
    WorkSpaceAddr *workspaceAddr
)
    Set all glyph data blocks as free
    Assert that the memory initialization is correct
```

### `AllocateMemory`

Allocates memory for a glyph data block.

```plaintext
Function AllocateMemory(
    uint32 glyphDataCount, 
    WorkSpaceAddr *workspaceAddr, 
    Glyph **glyphData
)
    Find the first free glyph data block
    Set the block as used
    Assign the pointer to the allocated glyph data block
    Assert that allocation is successful
```

### `DeallocateMemory`

Frees memory for a glyph data block.

```plaintext
Function DeallocateMemory(
    WorkSpaceAddr *workspaceAddr, 
    Glyph *glyphData
)
    Reset the block to free
    Assert that the memory deallocation is correct
```

### `InitializeGlyphData`

Initializes a glyph data structure.

```plaintext
Function InitializeGlyphData(
    GlyphData *glyphData, 
    WorkSpaceAddr *workspaceAddr, 
    uint16 glyphIndex, 
    uint16 depth
)
    Set the glyph data fields to default values
    Assign the glyph element from the workspace
    Initialize transformation matrix and scan type
    Assert that the initialization is correct
```

### `InitializeData`

Initializes data for the font system.

```plaintext
Function InitializeData()
    Call the initialization function for the interpolation library
```

## Notes

- The code includes assertions to ensure that operations are performed
correctly.
- Functions like `AllocateMemory` and `DeallocateMemory` ensure that
memory is managed correctly to prevent leaks and out-of-bounds access.
- The `DoScanControl` function provides a flexible mechanism to control
scan behavior based on glyph properties and image state.

```markdown
# Font Rendering Library Bytecode Interpreter

## Function Array Initialization
The `function` array is initialized with function pointers for each
TrueType bytecode instruction opcode. The array is indexed by the opcode
values, and each entry is set to a function that handles the corresponding
instruction.

```c
function = [NULL] * 256  # Initialize an array of 256 function pointers

# Initialize the function array with specific functions
for opcode in range(0x23, 0x2F):
    function[opcode] = itrp_SWAP  # SWAP
    function[opcode] = itrp_DEPTH  # DEPTH
    function[opcode] = itrp_CINDEX  # CINDEX
    function[opcode] = itrp_MINDEX  # MINDEX
    function[opcode] = itrp_ALIGNPTS  # ALIGNPTS
    function[opcode] = itrp_RAW  # RAW
    function[opcode] = itrp_UTP  # UTP
    function[opcode] = itrp_LOOPCALL  # LOOPCALL
    function[opcode] = itrp_CALL  # CALL
    function[opcode] = itrp_FDEF  # FDEF
    function[opcode] = itrp_IllegalInstruction  # Illegal Instruction
    function[opcode] = itrp_MDAP  # MDAP
    function[opcode] = itrp_MDAP  # MDAP (repeated)
```

## Opcode Ranges
The array is populated with specific functions for a range of opcodes,
grouped by their ranges:

```c
for opcode in range(0x30, 0x40):
    function[opcode] = itrp_IUP  # IUP
    function[opcode] = itrp_IUP  # IUP (repeated)
    function[opcode] = itrp_SHP  # SHP
    function[opcode] = itrp_SHP  # SHP (repeated)
    function[opcode] = itrp_SHC  # SHC
    function[opcode] = itrp_SHC  # SHC (repeated)
    function[opcode] = itrp_SHE  # SHE
    function[opcode] = itrp_SHE  # SHE (repeated)
    function[opcode] = itrp_SHPIX  # SHPIX
    function[opcode] = itrp_IP  # IP
    function[opcode] = itrp_MSIRP  # MSIRP
    function[opcode] = itrp_MSIRP  # MSIRP (repeated)
    function[opcode] = itrp_ALIGNRP  # ALIGNRP
    function[opcode] = itrp_RTDG  # RTDG
    function[opcode] = itrp_MIAP  # MIAP
    function[opcode] = itrp_MIAP  # MIAP (repeated)

for opcode in range(0x40, 0x50):
    function[opcode] = itrp_NPUSHB  # NPUSHB
    function[opcode] = itrp_NPUSHW  # NPUSHW
    function[opcode] = itrp_WS  # WS
    function[opcode] = itrp_RS  # RS
    function[opcode] = itrp_WCVT  # WCVT
    function[opcode] = itrp_RCVT  # RCVT
    function[opcode] = itrp_RC  # RC
    function[opcode] = itrp_RC  # RC (repeated)
    function[opcode] = itrp_WC  # WC
    function[opcode] = itrp_MD  # MD
    function[opcode] = itrp_MD  # MD (repeated)
    function[opcode] = itrp_MPPEM  # MPPEM
    function[opcode] = itrp_MPS  # MPS
    function[opcode] = itrp_FLIPON  # FLIPON
    function[opcode] = itrp_FLIPOFF  # FLIPOFF
    function[opcode] = itrp_DEBUG  # DEBUG

# Remaining opcodes are set to specific functions
function[0x50] = itrp_LT  # LT
function[0x51] = itrp_LTEQ  # LTEQ
# ... and so on for the remaining opcodes
function[0x8F] = itrp_IDefPatch  # IDefPatch
# ... and so on for opcodes 0x90 to 0xAF

# Functions for opcode ranges 0xB0-0xB7 and 0xB8-0xBF
for opcode in range(0xB0, 0xC0):
    function[opcode] = itrp_PUSHB1  # PUSHB1
    function[opcode] = itrp_PUSHB  # PUSHB
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)
    function[opcode] = itrp_PUSHB  # PUSHB (repeated)

for opcode in range(0xB8, 0xC0):
    function[opcode] = itrp_PUSHW1  # PUSHW1
    function[opcode] = itrp_PUSHW  # PUSHW
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)
    function[opcode] = itrp_PUSHW  # PUSHW (repeated)

for opcode in range(0xC0, 0xE0):
    function[opcode] = itrp_MDRP  # MDRP

for opcode in range(0xE0, 0xFF):
    function[opcode] = itrp_MIRP  # MIRP
```

## Function Descriptions
Each function (e.g., `itrp_SWAP`, `itrp_DEPTH`, etc.) is assumed to handle
a specific bytecode instruction. The actual implementation of these
functions is not provided in the code snippet, but they likely perform
operations related to the bytecode instructions they handle.

## Illegal Instructions
For opcode values that do not correspond to standard instructions, the
array is populated with a placeholder function `itrp_IllegalInstruction`,
which is intended to handle illegal or undefined instructions.

## Summary
This file defines an array of function pointers for TrueType bytecode
instructions, with each function pointer corresponding to a specific
opcode. The array is populated with functions that handle each opcode
according to the TrueType bytecode specification. Additionally, there are
placeholders for illegal or undefined opcodes.
```

# Description of the File

This file contains functions for scaling bitmap data horizontally and
vertically, as well as copying individual bits from a source to a
destination. The file includes functions for compressing and expanding the
dimensions of a bitmap, which may involve copying rows or columns and
filling gaps with zeros. Additionally, there is a function for copying a
single bit from a source bitmap to a destination bitmap.

# Function Descriptions

## ScaleVertical

### Input Parameters
- `pbyBitmap`: Pointer to the original bitmap data
- `usOrgBytesPerRow`: Number of bytes per row in the original bitmap
- `usNewBytesPerRow`: Number of bytes per row in the new bitmap
- `usOrgHeight`: Original height of the bitmap
- `usNewHeight`: New height of the bitmap
- `usRowCount`: Number of rows to scale

### Description
This function scales the bitmap vertically by either compressing or
expanding the number of rows. If the new height is less than the original
height, rows are skipped. If the new height is greater than the original
height, new rows are inserted and filled with zeros. The function uses the
Bresenham algorithm to interpolate between the original and new rows.

### Pseudocode
```pseudocode
function ScaleVertical(pbyBitmap, usOrgBytesPerRow, usNewBytesPerRow,
usOrgHeight, usNewHeight, usRowCount)
    if usOrgHeight > usNewHeight
        pbyOrgRow = pbyBitmap
        pbyNewRow = pbyBitmap

        for usLine from 0 to usNewHeight - 1
            while usErrorTerm >= usNewHeight
                pbyOrgRow += usBytesPerRow
                usErrorTerm -= usNewHeight
            if pbyOrgRow != pbyNewRow
                MEMCPY(pbyNewRow, pbyOrgRow, usBytesPerRow)
            pbyNewRow += usBytesPerRow
            usErrorTerm += usOrgHeight
        for usLine from usNewHeight to usOrgHeight - 1
            MEMSET(pbyNewRow, 0, usBytesPerRow)
            pbyNewRow += usBytesPerRow
    else if usNewHeight > usOrgHeight
        pbyOrgRow = pbyBitmap + (usOrgHeight - 1) * usBytesPerRow
        pbyNewRow = pbyBitmap + (usNewHeight - 1) * usBytesPerRow

        for usLine from 0 to usOrgHeight - 1
            usErrorTerm += usNewHeight
            
            while usErrorTerm >= usOrgHeight
                if pbyOrgRow != pbyNewRow
                    MEMCPY(pbyNewRow, pbyOrgRow, usBytesPerRow)
                pbyNewRow -= usBytesPerRow
                usErrorTerm -= usOrgHeight
            pbyOrgRow -= usBytesPerRow
```

## ScaleHorizontal

### Input Parameters
- `pbyBitmap`: Pointer to the original bitmap data
- `usOrgBytesPerRow`: Number of bytes per row in the original bitmap
- `usNewBytesPerRow`: Number of bytes per row in the new bitmap
- `usOrgWidth`: Original width of the bitmap
- `usNewWidth`: New width of the bitmap
- `usRowCount`: Number of rows to scale

### Description
This function scales the bitmap horizontally by either compressing or
expanding the number of columns. If the new width is less than the
original width, bits are skipped. If the new width is greater than the
original width, new bits are inserted and filled with zeros. The function
uses the Bresenham algorithm to interpolate between the original and new
columns.

### Pseudocode
```pseudocode
function ScaleHorizontal(pbyBitmap, usOrgBytesPerRow, usNewBytesPerRow,
usOrgWidth, usNewWidth, usRowCount)
    if usOrgWidth > usNewWidth
        pbyOrgRow = pbyBitmap
        pbyNewRow = pbyBitmap
        usNewBytes = (usNewWidth + 7) >> 3

        while usRowCount > 0
            pbyOrg = pbyOrgRow
            pbyNew = pbyNewRow
            usErrorTerm = usOrgWidth >> 1
            
            sOrgBits = 0
            sNewBits = 0
            usByte = 0
            byNewData = 0
            while usByte < usNewBytes
                while usErrorTerm >= usNewWidth
                    sOrgBits--
                    usErrorTerm -= usNewWidth
                while sOrgBits <= 0
                    byOrgData = *pbyOrg++
                    sOrgBits += 8
                byNewData <<= 1
                byNewData |= (byOrgData >> (sOrgBits - 1)) & 1
                
                sNewBits++
                if sNewBits == 8
                    *pbyNew++ = byNewData
                    sNewBits = 0
                    usByte++
                usErrorTerm += usOrgWidth
            while usByte < usNewBytesPerRow
                *pbyNew++ = 0
                usByte++
            pbyOrgRow += usOrgBytesPerRow
            pbyNewRow += usNewBytesPerRow
            usRowCount--
    else if usNewWidth > usOrgWidth
        pbyOrgRow = pbyBitmap + (usRowCount - 1) * usOrgBytesPerRow
        pbyNewRow = pbyBitmap + (usRowCount - 1) * usNewBytesPerRow

        usOrgBytes = (usOrgWidth + 7) >> 3
        sOrgBitsInit = (usOrgWidth + 7) & 0x07 - 7
        
        usNewBytes = (usNewWidth + 7) >> 3
        sNewBitsInit = 7 - (usNewWidth + 7) & 0x07

        while usRowCount > 0
            pbyOrg = pbyOrgRow + usOrgBytes - 1
            pbyNew = pbyNewRow + usNewBytes - 1
            usErrorTerm = usOrgWidth >> 1
            
            sOrgBits = sOrgBitsInit
            sNewBits = sNewBitsInit
            usByte = 0
            byNewData = 0
            while usByte < usNewBytes
                if sOrgBits <= 0
                    byOrgData = *pbyOrg--
                    sOrgBits += 8
                usErrorTerm += usNewWidth
                
                while usErrorTerm >= usOrgWidth
                    byNewData >>= 1
                    byNewData |= (byOrgData << (sOrgBits - 1)) & 0x80
                    
                    sNewBits++
                    if sNewBits == 8
                        *pbyNew-- = byNewData
                        sNewBits = 0
                        usByte++
                    usErrorTerm -= usOrgWidth
                sOrgBits--
            pbyOrgRow -= usOrgBytesPerRow
            pbyNewRow -= usNewBytesPerRow
            usRowCount--
```

## CopyBit

### Input Parameters
- `pcb`: Pointer to a `CopyBlock` structure containing source and
destination bitmap information

### Description
This function copies a single bit from a source bitmap to a destination
bitmap. The function calculates the source and destination offsets and
shifts to determine the correct bit to copy. If the bit in the source is
set, it is copied to the destination.

### Pseudocode
```pseudocode
function CopyBit(pcb)
    usSrcOffset = (pcb->usSrcY * pcb->usSrcBytesPerRow) + (pcb->usSrcX >>
3)
    usSrcShift = pcb->usSrcX & 0x0007
    
    if pcb->pbySrc[usSrcOffset] & usByteMask[usSrcShift]
        usDstOffset = (pcb->usDstY * pcb->usDstBytesPerRow) + (pcb->usDstX
>> 3)
        usDstShift = pcb->usDstX & 0x0007
        pcb->pbyDst[usDstOffset] |= usByteMask[usDstShift]
```

# Conclusion

The file contains functions for scaling bitmap data horizontally and
vertically, as well as copying individual bits from a source to a
destination. The functions use the Bresenham algorithm to interpolate
between the original and new dimensions and handle both compression and
expansion scenarios.

# Font Scaling Library Functions

This file contains several functions for scaling and transforming glyph
data. The library functions are used to handle various scaling operations
and transformations, such as scaling advance widths, vertical metrics, and
post-transforming glyphs.

## Functions

### `RestoreContourData`
Restores contour data from a byte outline. The data includes the number of
points, start points, end points, coordinates, and on-curve flags.

**Parameters:**
- `pElement`: Pointer to the element where the contour data will be
restored.
- `ppbyOutline`: Pointer to the byte outline from which the data will be
read.

**Pseudocode:**
```pseudocode
function RestoreContourData(pElement, ppbyOutline):
    // Read the number of contour points
    pElement.nc = readInt16(ppbyOutline)
    
    // Read start points
    pElement.sp = readInt16Array(ppbyOutline, pElement.nc)
    
    // Read end points
    pElement.ep = readInt16Array(ppbyOutline, pElement.nc)
    
    // Calculate the number of points
    usNumberOfPoints = NUMBEROFCHARPOINTS(pElement)
    
    // Read x coordinates
    pElement.x = readF26Dot6Array(ppbyOutline, usNumberOfPoints)
    
    // Read y coordinates
    pElement.y = readF26Dot6Array(ppbyOutline, usNumberOfPoints)
    
    // Read on-curve flags
    pElement.onCurve = readUint8Array(ppbyOutline, usNumberOfPoints)
```

### `ScaleAdvanceWidth`
Scales the advance width of a glyph.

**Parameters:**
- `pvGlobalGS`: Pointer to the global graphic state.
- `AdvanceWidth`: Pointer to the advance width vector to be scaled.
- `usNonScaledAW`: The non-scaled advance width.
- `bPositiveSquare`: A boolean indicating if the square is positive.
- `usEmResolution`: The EM resolution.
- `trans`: The transformation matrix.

**Pseudocode:**
```pseudocode
function ScaleAdvanceWidth(pvGlobalGS, AdvanceWidth, usNonScaledAW,
bPositiveSquare, usEmResolution, trans):
    globalGS = cast(pvGlobalGS, fnt_GlobalGraphicStateType)
    
    if bPositiveSquare:
        AdvanceWidth.x = ShortMulDiv(globalGS.fxMetricScalarX,
usNonScaledAW, usEmResolution)
    else:
        AdvanceWidth.x = FixRatio(usNonScaledAW, usEmResolution)
        FixXYMul(&AdvanceWidth.x, &AdvanceWidth.y, trans)
```

### `ScaleVerticalMetrics`
Scales the vertical metrics of a glyph.

**Parameters:**
- `pvGlobalGS`: Pointer to the global graphic state.
- `usNonScaledAH`: The non-scaled advance height.
- `sNonScaledTSB`: The non-scaled top side bearing.
- `bPositiveSquare`: A boolean indicating if the square is positive.
- `usEmResolution`: The EM resolution.
- `trans`: The transformation matrix.
- `pvecAdvanceHeight`: Pointer to the advance height vector to be scaled.
- `pvecTopSideBearing`: Pointer to the top side bearing vector to be
scaled.

**Pseudocode:**
```pseudocode
function ScaleVerticalMetrics(pvGlobalGS, usNonScaledAH, sNonScaledTSB,
bPositiveSquare, usEmResolution, trans, pvecAdvanceHeight,
pvecTopSideBearing):
    if bPositiveSquare:
        globalGS = cast(pvGlobalGS, fnt_GlobalGraphicStateType)
        pvecAdvanceHeight.y = ShortMulDiv(globalGS.fxMetricScalarY,
usNonScaledAH, usEmResolution)
        pvecTopSideBearing.y = ShortMulDiv(globalGS.fxMetricScalarY,
sNonScaledTSB, usEmResolution)
    else:
        pvecAdvanceHeight.y = FixRatio(usNonScaledAH, usEmResolution)
        FixXYMul(&pvecAdvanceHeight.x, &pvecAdvanceHeight.y, trans)
        pvecTopSideBearing.y = FixRatio(sNonScaledTSB, usEmResolution)
        FixXYMul(&pvecTopSideBearing.x, &pvecTopSideBearing.y, trans)
```

### `CalcLSBsAndAdvanceWidths`
Calculates the left side bearing and advance width of a glyph.

**Parameters:**
- `pElement`: Pointer to the element containing the glyph data.
- `f26XMin`: The x minimum value.
- `f26YMax`: The y maximum value.
- `devAdvanceWidth`: Pointer to the device advance width vector.
- `devLeftSideBearing`: Pointer to the device left side bearing vector.
- `LeftSideBearing`: Pointer to the left side bearing vector.
- `devLeftSideBearingLine`: Pointer to the device left side bearing line
vector.
- `LeftSideBearingLine`: Pointer to the left side bearing line vector.

**Pseudocode:**
```pseudocode
function CalcLSBsAndAdvanceWidths(pElement, f26XMin, f26YMax,
devAdvanceWidth, devLeftSideBearing, LeftSideBearing,
devLeftSideBearingLine, LeftSideBearingLine):
    CalcDevAdvanceWidth(pElement, devAdvanceWidth)
    devLeftSideBearing.x = f26XMin - pElement.x[LSBPOINTNUM(pElement)]
    devLeftSideBearing.y = f26YMax - pElement.y[LSBPOINTNUM(pElement)]
    LeftSideBearing.x = pElement.x[LEFTEDGEPOINTNUM(pElement)]
    LeftSideBearing.x -= pElement.x[ORIGINPOINTNUM(pElement)]
    LeftSideBearing.y = f26YMax - pElement.y[LEFTEDGEPOINTNUM(pElement)]
    LeftSideBearing.y -= pElement.y[ORIGINPOINTNUM(pElement)]
    devLeftSideBearingLine = devLeftSideBearing
    LeftSideBearingLine = LeftSideBearing
```

### `CalcDevAdvanceWidth`
Calculates the device advance width of a glyph.

**Parameters:**
- `pElement`: Pointer to the element containing the glyph data.
- `devAdvanceWidth`: Pointer to the device advance width vector.

**Pseudocode:**
```pseudocode
function CalcDevAdvanceWidth(pElement, devAdvanceWidth):
    devAdvanceWidth.x = pElement.x[RSBPOINTNUM(pElement)]
    devAdvanceWidth.x -= pElement.x[LSBPOINTNUM(pElement)]
    devAdvanceWidth.y = pElement.y[RSBPOINTNUM(pElement)]
    devAdvanceWidth.y -= pElement.y[LSBPOINTNUM(pElement)]
```

### `QueryPPEM`
Queries the pixels per EM for a given glyph.

**Parameters:**
- `pvGlobalGS`: Pointer to the global graphic state.
- `pusPPEM`: Pointer to the pixels per EM value.

**Pseudocode:**
```pseudocode
function QueryPPEM(pvGlobalGS, pusPPEM):
    globalGS = cast(pvGlobalGS, fnt_GlobalGraphicStateType)
    pusPPEM = globalGS.pixelsPerEm
```

### `QueryPPEMXY`
Queries the pixels per EM in X and Y directions for a given glyph.

**Parameters:**
- `pvGlobalGS`: Pointer to the global graphic state.
- `pusPPEMX`: Pointer to the pixels per EM value in the X direction.
- `pusPPEMY`: Pointer to the pixels per EM value in the Y direction.

**Pseudocode:**
```pseudocode
function QueryPPEMXY(pvGlobalGS, pusPPEMX, pusPPEMY):
    globalGS = cast(pvGlobalGS, fnt_GlobalGraphicStateType)
    pusPPEMX = ROUNDFIXTOINT(globalGS.interpScalarX)
    pusPPEMY = ROUNDFIXTOINT(globalGS.interpScalarY)
```

### `45DegreePhaseShift`
Applies a 45-degree phase shift to the glyph data.

**Parameters:**
- `pElement`: Pointer to the element containing the glyph data.

**Pseudocode:**
```pseudocode
function 45DegreePhaseShift(pElement):
    lCount = NUMBERTOFTOTALPOINTS(pElement)
    IntelMul(lCount, pElement.x, pElement.y, trans, 1, 1)
```

### `PostTransformGlyph`
Applies a post-transformation to the glyph data.

**Parameters:**
- `pvGlobalGS`: Pointer to the global graphic state.
- `pElement`: Pointer to the element containing the glyph data.
- `trans`: The transformation matrix.

**Pseudocode:**
```pseudocode
function PostTransformGlyph(pvGlobalGS, pElement, trans):
    globalGS = cast(pvGlobalGS, fnt_GlobalGraphicStateType)
    IntelMul(NUMBERTOFTOTALPOINTS(pElement), pElement.x, pElement.y,
trans, trans, globalGS.fxMetricScalarX, globalGS.fxMetricScalarY)
```

### `LocalPostTransformGlyph`
Applies a local post-transformation to the glyph data.

**Parameters:**
- `pElement`: Pointer to the element containing the glyph data.
- `trans`: The transformation matrix.

**Pseudocode:**
```pseudocode
function LocalPostTransformGlyph(pElement, trans):
    lCount = NUMBERTOFTOTALPOINTS(pElement)
    IntelMul(lCount, pElement.x, pElement.y, trans, 1, 1)
```

These functions provide the necessary functionality to scale and transform
glyph data, ensuring accurate rendering and layout in various applications.

# File Description

The file contains functions for processing bitmaps during font scaling
operations. It includes functions for dropout control, contour crossing
calculations, and pixel access within the bitmap. The primary purpose is
to ensure that bitmaps are processed efficiently and accurately during
font scaling, with support for dropout control and contour crossing
calculations.

# Function Descriptions

### `ProcessContour`

**Purpose:** Process a contour for dropout control.

**Parameters:**
- `state`: Pointer to state variables.
- `currentX`: X-coordinate of the current point.
- `currentY`: Y-coordinate of the current point.
- `onTag`: Tag for the "on" callback.
- `offTag`: Tag for the "off" callback.
- `bitmap`: Pointer to the bit map.
- `scanKind`: Scan kind (e.g., stubs, smart dropout).

**Functionality:**
1. Calculate the Y position for the contour based on the callback
functions.
2. Check if the contour is within the bit band and stub control.
3. Verify if the contour is near the edges by counting vertical and
horizontal crossings.
4. Check if there are pixels above or below the current point to determine
if dropout is needed.
5. Adjust the Y position based on the scan kind (smart or simple).
6. Ensure the Y position is within the bounding box.
7. Set the dropout pixel in the bit map.

**Returns:**
- `error`: Error code (0 if successful).

### `CountHorizCrossings`

**Purpose:** Count contour crossings of a horizontal scan line segment.

**Parameters:**
- `state`: Pointer to state variables.
- `x`: X-coordinate.
- `y`: Y-coordinate.

**Functionality:**
1. Check if the Y-coordinate is within the scan region.
2. Initialize the number of crossings to 0.
3. Iterate through the on and off contour lists for the current
Y-coordinate.
4. Count the number of times the contour crosses the X-coordinate.

**Returns:**
- `crossings`: Number of crossings.

### `CountVertCrossings`

**Purpose:** Count contour crossings of a vertical scan line segment.

**Parameters:**
- `state`: Pointer to state variables.
- `x`: X-coordinate.
- `y`: Y-coordinate.

**Functionality:**
1. Check if the X-coordinate is within the bitmap bounds.
2. Initialize the number of crossings to 0.
3. Iterate through the on and off contour lists for the current
X-coordinate.
4. Count the number of times the contour crosses the Y-coordinate.

**Returns:**
- `crossings`: Number of crossings.

### `GetPixel`

**Purpose:** Get a pixel using absolute coordinates.

**Parameters:**
- `state`: Pointer to state variables.
- `bitmap`: Pointer to the bit map.
- `x`: X-coordinate.
- `y`: Y-coordinate.

**Functionality:**
1. Ensure the coordinates are within the bitmap bounds.
2. Retrieve the pixel value from the bit map.
3. Return the pixel value.

**Returns:**
- `pixel`: Pixel value.

### `SetPixel`

**Purpose:** Set a pixel using absolute coordinates.

**Parameters:**
- `state`: Pointer to state variables.
- `bitmap`: Pointer to the bit map.
- `x`: X-coordinate.
- `y`: Y-coordinate.

**Functionality:**
1. Ensure the coordinates are within the bitmap bounds.
2. Set the pixel value in the bit map.

**Returns:**
- `error`: Error code (0 if successful).

### `ClearBitmap`

**Purpose:** Clear a bit map.

**Parameters:**
- `longsPerBitmap`: Number of longs per bitmap.
- `bitmap`: Pointer to the bit map.

**Functionality:**
1. Call `ClearBitMap` to clear the bit map.

**Returns:**
- `error`: Error code (0 if successful).

### `CalcGrayRow`

**Purpose:** Calculate a gray row.

**Parameters:**
- `params`: Pointer to the parameter block.

**Functionality:**
1. Call `CalcGrayRow` to calculate the gray row.

**Returns:**
- `error`: Error code (0 if successful).

# Summary

The file provides functions for processing bitmaps during font scaling,
including dropout control, contour crossing calculations, and pixel
access. These functions ensure efficient and accurate bitmap processing
during font scaling operations.

### Constants
- `MASKSIZE`: 32 bits per bitmap mask
- `MASKSHIFT`: Log2 of `MASKSIZE` (5)
- `MASKBITS`: Bitmask to isolate pixel location within a long word
(0x0000001F)
- `ALL_ONES`: 32-bit value with all bits set to 1
- `HIGH_ONE`: 32-bit value with the highest bit set to 1

### Bitmask Definitions
- Macros `StartMask(x)`, `StopMask(x)`, and `BitMask(x)` to create bitmask
based on position `x`.
- If `FSCFG_USE_MASK_SHIFT` is defined, the macros use bitwise operations
for efficiency; otherwise, they use precomputed arrays.

### Functions

#### `InitializeBitMasks`
- **Description**: Initializes the bitmask arrays if
`FSCFG_USE_MASK_SHIFT` is not defined.
- **Pseudocode**:
  ```plaintext
  if (!FSCFG_USE_MASK_SHIFT)
  {
      for (x from 0 to MASKSIZE - 1)
      {
          aulStartBits[x] = SWAPL(ALL_ONES >> x)
          aulStopBits[MASKSIZE - 1 - x] = SWAPL(ALL_ONES << (MASKSIZE - 1
- x))
          aulBitMask[x] = SWAPL(HIGH_ONE >> x)
      }
  }
  ```

#### `ClearBitMap`
- **Description**: Clears a bitmap by setting all bits to 0.
- **Pseudocode**:
  ```plaintext
  function ClearBitMap(ulBMPLongs, pulMap)
  {
      stBytes = ulBMPLongs * 4
      MEMSET(pulMap, 0, stBytes)
  }
  ```

#### `BlitHorizontal`
- **Description**: Marks a horizontal segment in a bitmap.
- **Pseudocode**:
  ```plaintext
  function BlitHorizontal(lXStart, lXStop, pulMap)
  {
      lSkip = lXStart >> MASKSHIFT
      pulMap += lSkip
      lXStart -= lSkip << MASKSHIFT
      lXStop -= lSkip << MASKSHIFT
      while (lXStop >= MASKSIZE)
      {
          pulMap |= StartMask(lXStart)
          pulMap++
          lXStart = 0
          lXStop -= MASKSIZE
      }
      pulMap |= StartMask(lXStart) & StopMask(lXStop)
  }
  ```

#### `BlitCopy`
- **Description**: Copies a row from a source bitmap to a destination
bitmap.
- **Pseudocode**:
  ```plaintext
  function BlitCopy(pulSource, pulDestination, lCount)
  {
      while (lCount > 0)
      {
          *pulDestination = *pulSource
          pulDestination++
          pulSource++
          lCount--
      }
  }
  ```

#### `GetBit`
- **Description**: Gets the state of a bit at a specified coordinate in a
bitmap.
- **Pseudocode**:
  ```plaintext
  function GetBit(lXCoord, pulMap)
  {
      return pulMap[lXCoord >> MASKSHIFT] & BitMask(lXCoord & MASKBITS)
  }
  ```

#### `SetBit`
- **Description**: Sets a bit at a specified coordinate in a bitmap.
- **Pseudocode**:
  ```plaintext
  function SetBit(lXCoord, pulMap)
  {
      pulMap[lXCoord >> MASKSHIFT] |= BitMask(lXCoord & MASKBITS)
  }
  ```

#### `CalcGrayRow`
- **Description**: Calculates the gray scale values for a row of pixels.
- **Pseudocode**:
  ```plaintext
  function CalcGrayRow(pGSP)
  {
      pchGray = pGSP.pchGray
      pchOver = pGSP.pchOver
      sGrayColumns = pGSP.sGrayCol
      usShiftMask = 0x00FF >> (8 - pGSP.usOverScale)
      usGoodBits = 8 - pGSP.usFirstShift
      usOverBits = (*pchOver >> pGSP.usFirstShift)

      while (sGrayColumns > 0)
      {
          usGoodBits -= pGSP.usOverScale
          if (usGoodBits > 0)
          {
              usOverBits >>= pGSP.usOverScale
          }
          else
          {
              pchOver--
              usOverBits = (uint16)*pchOver
              usGoodBits = 8
          }

          *pchGray += chCount[usOverBits & usShiftMask]
          pchGray--
          sGrayColumns--
      }
  }
  ```

### Notes
- The code includes several conditional compilation directives (`if
(!FSCFG_USE_MASK_SHIFT)`) to allow for different implementations.
- The `Assert` statements are used for debugging and ensuring the pointers
and values are within expected ranges.
- The `SWAPL` function is assumed to swap the endianness of a 32-bit
integer, which might be necessary for certain hardware or data formats.

## Overview
The provided code is a part of a scan conversion endpoint module, designed
to handle endpoint intersections in a vector graphics context. The module
includes functions for checking scan line topologies and adding endpoints
based on the topology. The functions are reentrant and use a state
structure to maintain context across multiple calls.

## File Components
1. **Imports**: The code includes headers for shared data types, error
codes, and module-specific structures and constants.
2. **Local Prototypes**: Private functions are declared for various
operations like checking topology, adding endpoints, and handling subpixel
calculations.
3. **Export Functions**: Public functions are provided for setting up
callbacks, beginning and ending contours, and checking endpoints.
4. **Private Functions**: These include implementations for checking
horizontal and vertical topologies, adding endpoints based on these
topologies, and handling subpixel calculations.

## Function Descriptions

### SetupEndpoints
**Purpose**: Passes callback routine pointers to the scanlist for smart
dropout control.
```markdown
SetupEndpoints(PState state)
{
    SetupCallbacks(ScanEndPointCode, CalcHorizEpSubpix, CalcVertEpSubpix,
CalcVertEpSubpix);
}
```

### BeginContour
**Purpose**: Initializes the endpoint with the starting point of a
contour.
```markdown
BeginContour(PState state, F26Dot6 fxX, F26Dot6 fxY)
{
    state.fxX1 = fxX;
    state.fxY1 = fxY;
    state.fxX0 = HUGEFIX;
}
```

### CheckEndpoint
**Purpose**: Checks the endpoint for scan line topology and updates state
accordingly.
```markdown
CheckEndpoint(PState state, F26Dot6 fxX2, F26Dot6 fxY2, uint16 usScanKind)
{
    if (ONSCANLINE(state.fxY1))
    {
        if ((state.fxX1 == fxX2) && (state.fxY1 == fxY2))
        {
            return NO_ERR;
        }
        
        if (state.fxX0 == HUGEFIX)
        {
            state.fxX2Save = fxX2;
            state.fxY2Save = fxY2;
        }
        else
        {
            CheckHorizTopology(state, fxX2, fxY2, usScanKind);
        }
    }
    
    if (!(usScanKind & SK_NODROPOUT))
    {
        if (ONSCANLINE(state.fxX1))
        {
            if ((state.fxX1 == fxX2) && (state.fxY1 == fxY2))
            {
                return NO_ERR;
            }
            
            if (state.fxX0 == HUGEFIX)
            {
                state.fxX2Save = fxX2;
                state.fxY2Save = fxY2;
            }
            else
            {
                CheckVertTopology(state, fxX2, fxY2, usScanKind);
            }
        }
    }
    
    state.fxX0 = state.fxX1;
    state.fxY0 = state.fxY1;
    state.fxX1 = fxX2;
    state.fxY1 = fxY2;
    return NO_ERR;
}
```

### EndContour
**Purpose**: Ends the current contour and resets the state.
```markdown
EndContour(PState state)
{
    state.fxX0 = HUGEFIX;
    state.fxY0 = HUGEFIX;
}
```

### CheckHorizTopology
**Purpose**: Checks the horizontal topology of the endpoint.
```markdown
CheckHorizTopology(PState state, F26Dot6 fxX2, F26Dot6 fxY2, uint16
usScanKind)
{
    if (fxX2 < state.fxX1)
    {
        if (state.fxX1 < state.fxX0)
        {
            AddVertOn(state, usScanKind);
        }
        else if (state.fxX1 > state.fxX0)
        {
            AddVertOn(state, usScanKind);
            AddVertOff(state, usScanKind);
        }
        else
        {
            if (state.fxY1 < state.fxY0)
            {
                AddVertOn(state, usScanKind);
            }
        }
    }
    else if (fxX2 > state.fxX1)
    {
        if (state.fxX1 < state.fxX0)
        {
            AddVertOn(state, usScanKind);
            AddVertOff(state, usScanKind);
        }
        else if (state.fxX1 > state.fxX0)
        {
            AddVertOff(state, usScanKind);
        }
        else
        {
            if (state.fxY1 > state.fxY0)
            {
                AddVertOff(state, usScanKind);
            }
        }
    }
    else
    {
        if (state.fxX1 < state.fxX0)
        {
            if (fxY2 > state.fxY1)
            {
                AddVertOn(state, usScanKind);
            }
        }
        else if (state.fxX1 > state.fxX0)
        {
            if (fxY2 < state.fxY1)
            {
                AddVertOff(state, usScanKind);
            }
        }
        else
        {
            if ((state.fxY1 > state.fxY0) && (fxY2 < state.fxY1))
            {
                AddVertOff(state, usScanKind);
            }
            if ((state.fxY1 < state.fxY0) && (fxY2 > state.fxY1))
            {
                AddVertOn(state, usScanKind);
            }
        }
    }
}
```

### CheckVertTopology
**Purpose**: Checks the vertical topology of the endpoint.
```markdown
CheckVertTopology(PState state, F26Dot6 fxX2, F26Dot6 fxY2, uint16
usScanKind)
{
    // Similar logic to CheckHorizTopology but with vertical checks
}
```

### AddHorizOn
**Purpose**: Adds a horizontal endpoint based on the current state.
```markdown
AddHorizOn(PState state, uint16 usScanKind)
{
    int32 lXScan, lYScan;
    void (*pfnAddHorizScan)(PState, int32, int32);
    void (*pfnAddVertScan)(PState, int32, int32);
    
    BeginElement(state, 4, ScanEndPointCode, 0, NULL, NULL,
&pfnAddHorizScan, &pfnAddVertScan);
    
    lXScan = (int32)((state.fxX1 + SUBHALF) >> SUBSHFT);
    lYScan = (int32)(state.fxY1 >> SUBSHFT);
    
    pfnAddHorizScan(state, lXScan, lYScan);
}
```

### AddHorizOff
**Purpose**: Adds a horizontal endpoint based on the current state.
```markdown
AddHorizOff(PState state, uint16 usScanKind)
{
    int32 lXScan, lYScan;
    void (*pfnAddHorizScan)(PState, int32, int32);
    void (*pfnAddVertScan)(PState, int32, int32);
    
    BeginElement(state, 4, ScanEndPointCode, 0, NULL, NULL,
&pfnAddHorizScan, &pfnAddVertScan);
    
    lXScan = (int32)((state.fxX1 + SUBHALF) >> SUBSHFT);
    lYScan = (int32)(state.fxY1 >> SUBSHFT);
    
    pfnAddHorizScan(state, lXScan, lYScan);
}
```

### AddVertOn
**Purpose**: Adds a vertical endpoint based on the current state.
```markdown
AddVertOn(PState state, uint16 usScanKind)
{
    int32 lXScan, lYScan;
    void (*pfnAddHorizScan)(PState, int32, int32);
    void (*pfnAddVertScan)(PState, int32, int32);
    
    BeginElement(state, 2, ScanEndPointCode, 0, NULL, NULL,
&pfnAddHorizScan, &pfnAddVertScan);
    
    lYScan = (int32)((state.fxY1 + SUBHALF - 1) >> SUBSHFT);
    lXScan = (int32)(state.fxX1 >> SUBSHFT);
    
    pfnAddVertScan(state, lXScan, lYScan);
}
```

### AddVertOff
**Purpose**: Adds a vertical endpoint based on the current state.
```markdown
AddVertOff(PState state, uint16 usScanKind)
{
    int32 lXScan, lYScan;
    void (*pfnAddHorizScan)(PState, int32, int32);
    void (*pfnAddVertScan)(PState, int32, int32);
    
    BeginElement(state, 1, ScanEndPointCode, 0, NULL, NULL,
&pfnAddHorizScan, &pfnAddVertScan);
    
    lYScan = (int32)((state.fxY1 + SUBHALF) >> SUBSHFT);
    lXScan = (int32)(state.fxX1 >> SUBSHFT);
    
    pfnAddVertScan(state, lXScan, lYScan);
}
```

### CalcHorizEpSubpix
**Purpose**: Calculates the subpixel intersection for horizontal
endpoints.
```markdown
CalcHorizEpSubpix(int32 lYScan, F26Dot6 *pfxX, F26Dot6 *pfxY)
{
    return *pfxX;
}
```

### CalcVertEpSubpix
**Purpose**: Calculates the subpixel intersection for vertical endpoints.
```markdown
CalcVertEpSubpix(int32 lXScan, F26Dot6 *pfxX, F26Dot6 *pfxY)
{
    return *pfxY;
}
```

These simplified pseudocode snippets outline the main functions and their
purposes in the context of handling endpoints in a graphics rendering
system. Each function is designed to handle specific aspects of endpoint
processing, such as topology checks, state updates, and subpixel
calculations. The state management and function calls ensure that the
system maintains correct and accurate endpoint data throughout the
rendering process.

# Font Scanning and Rendering Library Functions

## `EvaluateSpline`

**Description**: This function recursively subdivides splines that are
non-monotonic or too big into splines that can be handled by `CalcSpline`.

**Parameters**:
- `fxStartX`, `fxStartY`: Start point coordinates.
- `fxControlX`, `fxControlY`: Control point coordinates.
- `fxEndX`, `fxEndY`: Ending point coordinates.
- `usScanType`: Scan control type.

**Pseudocode**:
```plaintext
function EvaluateSpline(fxStartX, fxStartY, fxControlX, fxControlY,
fxEndX, fxEndY, usScanType):
    fxDX21 = fxControlX - fxStartX
    fxDX32 = fxEndX - fxControlX
    fxDY21 = fxControlY - fxStartY
    fxDY32 = fxEndY - fxControlY
    
    if (fxDY21 and fxDY32 have opposite signs) or (fxDX21 and fxDX32 have
opposite signs):
        fxX4 = fxStartX + LongMulDiv(fxDX21, fxDY21, fxDY21 - fxDY32)
        fxX6 = fxControlX + LongMulDiv(fxDX32, fxDY21, fxDY21 - fxDY32)
        fxX5 = fxX4 + LongMulDiv(fxX6 - fxX4, fxDY21, fxDY21 - fxDY32)
        fxY456 = fxStartY + LongMulDiv(fxDY21, fxDY21, fxDY21 - fxDY32)
        
        EvaluateSpline(fxStartX, fxStartY, fxX4, fxY456, fxX5, fxY456,
usScanType)
        EvaluateSpline(fxX5, fxY456, fxX6, fxY456, fxEndX, fxEndY,
usScanType)
    else if (fxDX21 and fxDX32 have opposite signs) or (fxDY21 and fxDY32
have opposite signs):
        fxY4 = fxStartY + LongMulDiv(fxDY21, fxDX21, fxDX21 - fxDX32)
        fxY6 = fxControlY + LongMulDiv(fxDY32, fxDX21, fxDX21 - fxDX32)
        fxY5 = fxY4 + LongMulDiv(fxY6 - fxY4, fxDX21, fxDX21 - fxDX32)
        fxX456 = fxStartX + LongMulDiv(fxDX21, fxDX21, fxDX21 - fxDX32)
        
        EvaluateSpline(fxStartX, fxStartY, fxX456, fxY4, fxX456, fxY5,
usScanType)
        EvaluateSpline(fxX456, fxY5, fxX456, fxY6, fxEndX, fxEndY,
usScanType)
    else:
        fxDX31 = fxEndX - fxStartX
        fxDY31 = fxEndY - fxStartY
        fxAbsDX = abs(fxDX31)
        fxAbsDY = abs(fxDY31)
        
        if (fxAbsDX > MAXSPLINELENGTH) or (fxAbsDY > MAXSPLINELENGTH):
            fxX4 = (fxStartX + fxControlX) >> 1
            fxY4 = (fxStartY + fxControlY) >> 1
            fxX6 = (fxControlX + fxEndX) >> 1
            fxY6 = (fxControlY + fxEndY) >> 1
            fxX5 = (fxX4 + fxX6) >> 1
            fxY5 = (fxY4 + fxY6) >> 1
            
            EvaluateSpline(fxStartX, fxStartY, fxX4, fxY4, fxX5, fxY5,
usScanType)
            EvaluateSpline(fxX5, fxY5, fxX6, fxY6, fxEndX, fxEndY,
usScanType)
        else:
            if (fxDX21 * fxDY32 != fxDY21 * fxDX32):
                return CalcLine(fxStartX, fxStartY, fxEndX, fxEndY,
usScanType)
            else:
                return CalcSpline(fxStartX, fxStartY, fxControlX,
fxControlY, fxEndX, fxEndY, usScanType)
```

## `GetCoords`

**Description**: This function returns an array of coordinates for outline
points.

**Parameters**:
- `pclContour`: Glyph outline.
- `usPointCount`: Point count.
- `pusPointIndex`: Point indices.
- `ppcCoordinate`: Point coordinates.

**Pseudocode**:
```plaintext
function GetCoords(pclContour, usPointCount, pusPointIndex,
ppcCoordinate):
    usMaxIndex = pclContour.usContourCount * 2 - 1
    
    while (usPointCount > 0):
        if (*pusPointIndex > usMaxIndex):
            return BAD_POINT_INDEX_ERR
        
        lX = (pclContour.afxXCoord[*pusPointIndex] + SUBHALF) >> SUBSHFT
        lY = (pclContour.afxYCoord[*pusPointIndex] + SUBHALF) >> SUBSHFT
        
        if ( ((int32)(int16)lX != lX) or ((int32)(int16)lY != lY) ):
            return POINT_MIGRATION_ERR
        
        ppcCoordinate.x = (int16)lX
        ppcCoordinate.y = (int16)lY
        
        pusPointIndex++
        ppcCoordinate++
        usPointCount--  # loop through all points
    
    return NO_ERR
```

## Description

This module is part of a font scanning system. It calculates
scan lines for lines drawn on a screen, supporting dropout control and
reflection correction. It includes functions for adding horizontal and
vertical scan lines.

### Local Prototypes
- `CalcHorizLineSubpix`: Calculates subpixel positions for horizontal
lines.
- `CalcVertLineSubpix`: Calculates subpixel positions for vertical lines.

### Export Functions
- `SetupLine`: Passes callback routine pointers to the scan list for smart
dropout control.
- `CalcLine`: Calculates the scan lines for a given line segment.

### Private Callback Functions
- `CalcHorizLineSubpix`: Calculates subpixel positions for horizontal
lines.
- `CalcVertLineSubpix`: Calculates subpixel positions for vertical lines.

## Pseudocode for Each Function

### Function: `SetupLine`
**Parameters:**
- `state`: Pointer to state variables.

**Pseudocode:**
```pseudocode
function SetupLine(state):
    Call SetCallBacks with parameters:
        LINECODE
        CalcHorizLineSubpix
        CalcVertLineSubpix
```

### Function: `CalcLine`
**Parameters:**
- `state`: Pointer to state variables.
- `x1`, `y1`: Coordinates of the first point of the line.
- `x2`, `y2`: Coordinates of the second point of the line.
- `dropKind`: Dropout control type.

**Pseudocode:**
```pseudocode
function CalcLine(state, x1, y1, x2, y2, dropKind):
    Initialize variables:
        xScan, xSteps, xIncr, xOffset
        yScan, ySteps, yIncr, yOffset
        xInit, yInit
        xScan, yScan
        xX2, yY2
        xTemp, yTemp
        pfnAddHorizScan, pfnAddVertScan
        quadrant, q, dQy, dQx
        i

    Determine quadrant and initialize variables based on y-coordinates:
        if y2 >= y1:
            quadrant = 1
            yScan = SCANABOVE(y1)
            yInit = yScan - y1
            ySteps = y2 - y1
            yIncr = (y2 > y1) ? 1 : -1
            xX2 = x2 - x1
            yY2 = y2 - y1
        else:
            (Similar code for quadrant = 2, 3, 4)

    Determine quadrant and initialize variables based on x-coordinates:
        if x2 >= x1:
            quadrant = 1
            xScan = SCANLEFT(x1)
            xInit = xScan - x1
            xSteps = x2 - x1
            xIncr = (x2 > x1) ? 1 : -1
            xX2 = x2 - x1
            yY2 = y2 - y1
        else:
            (Similar code for quadrant = 2, 3, 4)

    Initialize element with parameters:
        dropKind, quadrant, LINECODE
        1, &x2, &y2
        &pfnAddHorizScan, &pfnAddVertScan

    If no dropout control:
        if x1 == x2:
            Blast a column of scan lines
        else:
            Initialize cross product variables
            Loop through scan lines:
                If q > 0:
                    Advance x scan
                    Update q
                Else:
                    Add horizontal scan line
                    Advance y scan
                    Update q

    Else: (If dropout control)
        if y1 == y2:
            Blast a row of scan lines
        else if x1 == x2:
            Blast a column of scan lines
        else:
            Initialize cross product variables
            Loop through scan lines:
                If q > 0:
                    Add vertical scan line
                    Advance x scan
                    Update q
                Else:
                    Add horizontal scan line
                    Advance y scan
                    Update q
```

### Function: `CalcHorizLineSubpix`
**Parameters:**
- `yScan`: Scan line number.
- `x`, `y`: Pointers to x and y coordinates.

**Pseudocode:**
```pseudocode
function CalcHorizLineSubpix(yScan, x, y):
    xDrop = (F26Dot6)yScan << SUBSHFT + SUBHALF
    Assert((xDrop > *x and xDrop < *(x+1)) or (xDrop < *x and xDrop >
*(x+1)))
    xDrop = *x + LongMulDiv(*(x+1) - *x, xDrop - *y, *(y+1) - *y)
    return xDrop
```

### Function: `CalcVertLineSubpix`
**Parameters:**
- `xScan`: Scan line number.
- `x`, `y`: Pointers to x and y coordinates.

**Pseudocode:**
```pseudocode
function CalcVertLineSubpix(xScan, x, y):
    xDrop = (F26Dot6)xScan << SUBSHFT + SUBHALF
    Assert((xDrop > *x and xDrop < *(x+1)) or (xDrop < *x and xDrop >
*(x+1)))
    yDrop = *y + LongMulDiv(*(y+1) - *y, xDrop - *x, *(x+1) - *x)
    return yDrop
```

This pseudocode outlines the key functionalities of this module,
including how it calculates scan lines and handles different types of
lines with dropout control and reflection correction.

# Memory Management Module for Scan Converters

This file is part of a memory management module designed for a scan
converter, specifically for managing workspace memory for horizontal and
vertical operations. The module provides functions to set up memory pools
and to allocate memory from these pools. The division into horizontal
(`HorizontalMem`) and vertical (`VerticalMem`) pools ensures compatibility
with the Apple rasterizer and allows clients to disable dropout control by
setting the size of `VerticalMem` to zero.

## Imports

- `fscdefs.h`: Shared data types.
- `scglobal.h`: Structures and constants used throughout the module.
- `scmemory.h`: Function prototypes for the memory management functions.

## Workspace Memory Structure

The workspace memory is divided into two pools:
- `HorizontalMem` (Horizontal Memory): Used for horizontal scan array
lists. Always allocated.
- `VerticalMem` (Vertical Memory): Used for vertical scan array lists and
contour elements for subpixel intersections when dropout control is
enabled.

## Export Functions

### SetupMemory

```plaintext
// Set up memory pools for horizontal and vertical operations
void SetupMemory(
    PSTATE state,                      // Pointer to state variables
    char* pchHBuffer,                 // Pointer to horizontal workspace
    int32 lHMemSize,                  // Size of horizontal workspace
    char* pchVBuffer,                 // Pointer to vertical workspace
    int32 lVMemSize )                  // Size of vertical workspace
{
    state.pchHNextAvailable = pchHBuffer;       // Initialize next
available horizontal position
    state.pchHWorkSpaceEnd = pchHBuffer + lHMemSize;  // Set end of
horizontal workspace
    
    state.pchVNextAvailable = pchVBuffer;       // Initialize next
available vertical position
    state.pchVWorkSpaceEnd = pchVBuffer + lVMemSize;   // Set end of
vertical workspace
}
```

### AllocateHorizontalMemory

```plaintext
// Allocate memory from the horizontal memory pool
void *AllocateHorizontalMemory(
    PSTATE state,                      // Pointer to state variables
    int32 lSize )                      // Requested size in bytes
{
    void *pvTemp;                      // Temporary pointer to allocated
memory

    pvTemp = (void*)state.pchHNextAvailable;  // Get the current available
position
    state.pchHNextAvailable += lSize;           // Move the next available
position forward by the requested size
    
    Assert(state.pchHNextAvailable <= state.pchHWorkSpaceEnd);  // Ensure
we don't exceed the allocated size
    return pvTemp;                          // Return the allocated memory
}
```

### AllocateVerticalMemory

```plaintext
// Allocate memory from the vertical memory pool
void *AllocateVerticalMemory(
    PSTATE state,                      // Pointer to state variables
    int32 lSize )                      // Requested size in bytes
{
    void *pvTemp;                      // Temporary pointer to allocated
memory

    pvTemp = (void*)state.pchVNextAvailable;  // Get the current available
position
    state.pchVNextAvailable += lSize;           // Move the next available
position forward by the requested size
    
    Assert(state.pchVNextAvailable <= state.pchVWorkSpaceEnd);  // Ensure
we don't exceed the allocated size
    return pvTemp;                          // Return the allocated memory
}
```

This pseudocode provides a clear overview of how the memory management
module works, including setting up memory pools and allocating memory from
these pools for horizontal and vertical operations.

# File Description

This file contains a function that generates scanlines for a spline
approximation using the incremental midpoint method. The function is
designed to handle both vertical and horizontal splines and provides
callback functions to add scanlines to an image.

## Functions

### `CalcHorizontalSubpixel`

- **Parameters:**
  - `yScan`: The current scan line.
  - `controlX`: Pointer to an array of X control points.
  - `controlY`: Pointer to an array of Y control points.

- **Returns:**
  - The X coordinate of the midpoint on the horizontal spline at the given
Y scan line.

- **Description:**
  This function calculates the X coordinate of the midpoint on a
horizontal spline that passes through three control points. It uses binary
subdivision to find the midpoint by comparing the Y coordinate of the
midpoint with the given Y scan line.

### `CalcVerticalSubpixel`

- **Parameters:**
  - `xScan`: The current scan line.
  - `controlX`: Pointer to an array of X control points.
  - `controlY`: Pointer to an array of Y control points.

- **Returns:**
  - The Y coordinate of the midpoint on the vertical spline at the given X
scan line.

- **Description:**
  This function calculates the Y coordinate of the midpoint on a vertical
spline that passes through three control points. It uses binary
subdivision to find the midpoint by comparing the X coordinate of the
midpoint with the given X scan line.

### `GenerateSplineScanlines`

- **Parameters:**
  - `startX`: The starting X coordinate.
  - `startY`: The starting Y coordinate.
  - `stopX`: The stopping X coordinate.
  - `stopY`: The stopping Y coordinate.
  - `xIncrement`: The X increment.
  - `yIncrement`: The Y increment.
  - `xOffset`: The X offset.
  - `yOffset`: The Y offset.
  - `initialDerivativeX`: The initial derivative in X.
  - `secondDerivativeX`: The second derivative in X.
  - `initialDerivativeY`: The initial derivative in Y.
  - `secondDerivativeY`: The second derivative in Y.
  - `crossProduct`: The initial cross product.
  - `scaleFactor`: The scale factor for the derivatives.
  - `radiusX`: The radius for the X direction.
  - `radiusY`: The radius for the Y direction.
  - `addVerticalScanCallback`: Callback function to add vertical scan
lines.
  - `addHorizontalScanCallback`: Callback function to add horizontal scan
lines.

- **Returns:**
  - `NO_ERR`: Indicates successful execution.

- **Description:**
  This function generates scanlines for a spline approximation. It handles
both vertical and horizontal splines based on the direction of the control
points. The function uses the incremental midpoint method to approximate
the spline and calls the appropriate callback function to add scan lines
to the image.

## Description of the File

This file contains functions related to handling
Subsequent Bit Image (sbit) data in font files. Sbit data is used for
storing bitmap glyphs directly within the font file, which can improve
rendering performance compared to traditional hinting and outline
rendering.

### Functions and Pseudocode

#### `GetSbitMetrics`

This function retrieves the metrics for a specific glyph from the sbit
data in a font.

**Pseudocode:**
```plaintext
function GetSbitMetrics(pClientInfo, usMetricsType, ulMetricsOffset,
ulTableLength, TableIndex, pbMetricsFound)
    // Initialize variables
    pbyTable := NULL
    psTopSBy := 0
    pusAdvHeight := 0
    ReturnCode := NO_ERR

    // Get the data pointer for the metrics table
    ReturnCode := GetDataPtr(pClientInfo, ulMetricsOffset, ulTableLength,
TableIndex, TRUE, pbyTable)
    if ReturnCode is not NO_ERR then
        return ReturnCode

    if usMetricsType is SBIT_BIG_METRICS then
        // For large metrics
        psTopSBy = (int16)(*((int8*)&pbyTable[SFNT_SBIT_VERTBEARINGY]))
        pusAdvHeight = (uint16)pbyTable[SFNT_SBIT_VERTADVANCE]
    else
        // For small metrics
        psTopSBy = (int16)(*((int8*)&pbyTable[SFNT_SBIT_BEARINGY]))
        pusAdvHeight = (uint16)pbyTable[SFNT_SBIT_ADVANCE]

    *pbMetricsFound = TRUE
    RELEASESFNTFRAG(pClientInfo, pbyTable)
    return NO_ERR
end function
```

#### `GetSbitBitmap`

This function retrieves the bitmap data for a specific glyph from the sbit
data in a font.

**Pseudocode:**
```plaintext
function GetSbitBitmap(pClientInfo, usBitmapFormat, ulBitmapOffset,
ulBitmapLength, usHeight, usWidth, usShaveLeft, usShaveRight, usXOffset,
usYOffset, usDstRowBytes, pbyBitMap, pusCompCount)
    // Initialize variables
    pbyTable := NULL
    pbyBdat := NULL
    pbyBitRow := NULL
    usSrcRowBytes := 0
    ReturnCode := NO_ERR
    usBitData := 0
    usOutBits := 0
    usCount := 0
    usXOffBytes := 0
    usXOffBits := 0
    usStartBit := 0
    usStopBit := 0
    sFreshBits := 0
    byMask := 0

    // Get the data pointer for the bitmap data
    ReturnCode := GetDataPtr(pClientInfo, ulBitmapOffset, ulBitmapLength,
sfnt_BitmapData, TRUE, pbyTable)
    if ReturnCode is not NO_ERR then
        return ReturnCode

    pbyBdat = pbyTable
    *pusCompCount = 0

    pbyBitRow = pbyBitMap + (usDstRowBytes * usYOffset)
    usXOffBytes = usXOffset >> 3
    usXOffBits = usXOffset & 0x07

    switch(usBitmapFormat)
    case 1:  // Byte aligned
    case 6:
        usSrcRowBytes = (usWidth + 7) / 8
        if usXOffBits is 0 then
            // Byte aligned
            while usHeight is greater than 0
                pbyBitMap = pbyBitRow + usXOffBytes
                for usCount from 0 to usSrcRowBytes
                    *pbyBitMap++ |= *pbyBdat++
                pbyBitRow += usDstRowBytes
                usHeight--
        else
            // Offset in x
            while usHeight is greater than 0
                pbyBitMap = pbyBitRow + usXOffBytes
                usBitData = 0
                for usCount from 0 to usSrcRowBytes
                    usBitData |= (uint16)*pbyBdat++
                    *pbyBitMap++ |= (usBitData >> usXOffBits) & 0x00FF
                    usBitData <<= 8
                *pbyBitMap |= (usBitData >> usXOffBits) & 0x00FF
                pbyBitRow += usDstRowBytes
                usHeight--
        break
    case 2:  // Bit aligned data
    case 5:
    case 7:
        usBitData = 0
        sFreshBits = 0
        while usHeight is greater than 0
            pbyBitMap = pbyBitRow + usXOffBytes
            usOutBits = usWidth
            usStartBit = usXOffBits
            usStopBit = 8
            sFreshBits -= (int16)usShaveLeft
            while usOutBits is greater than 0
                while sFreshBits is less than 8
                    usBitData <<= 8
                    if ulBitmapLength is greater than 0
                        usBitData |= (uint16)*pbyBdat++
                        ulBitmapLength--
                    sFreshBits += 8
                if usStopBit is greater than usOutBits + usStartBit
                    usStopBit = usStartBit + usOutBits
                byMask = achStartMask[usStartBit] & achStopMask[usStopBit]
                *pbyBitMap++ |= (uint8)((usBitData >> (sFreshBits +
(int16)[7D[K
(int16)usStartBit - 8)) & byMask)
                sFreshBits -= (int16)(usStopBit - usStartBit)
                usOutBits -= usStopBit - usStartBit
                usStartBit = 0
            sFreshBits -= (int16)usShaveRight
            pbyBitRow += usDstRowBytes
            usHeight--
        break
    case 8:  // Composites
    case 9:
        *pusCompCount =
(uint16)SWAPW(*((uint16*)&pbyBdat[SFNT_BDAT_COMPCOU[51D[K
(uint16)SWAPW(*((uint16*)&pbyBdat[SFNT_BDAT_COMPCOUNT]))
        break
    default:
        break

    RELEASESFNTFRAG(pClientInfo, pbyTable)
    return NO_ERR
end function
```

#### `GetSbitComponentInfo`

This function retrieves information about a composite glyph component from
the sbit data in a font.

**Pseudocode:**
```plaintext
function GetSbitComponentInfo(pClientInfo, usComponent, ulBitmapOffset,
ulBitmapLength, pusCompGlyphCode, pusCompXOffset, pusCompYOffset)
    // Initialize variables
    pbyBdat := NULL
    ReturnCode := NO_ERR

    // Get the data pointer for the bitmap data
    ReturnCode := GetDataPtr(pClientInfo, ulBitmapOffset, ulBitmapLength,
sfnt_BitmapData, TRUE, pbyBdat)
    if ReturnCode is not NO_ERR then
        return ReturnCode

    pbyBdat += SFNT_BDAT_FIRSTCOMP + (SIZEOF_SBIT_BDATCOMPONENT *
usComponent)
    *pusCompGlyphCode =
(uint16)SWAPW(*((uint16*)&pbyBdat[SFNT_BDAT_COMPGLY[51D[K
(uint16)SWAPW(*((uint16*)&pbyBdat[SFNT_BDAT_COMPGLYPH]))
    *pusCompXOffset = (uint16)pbyBdat[SFNT_BDAT_COMPXOFF]
    *pusCompYOffset = (uint16)pbyBdat[SFNT_BDAT_COMPYOFF]

    RELEASESFNTFRAG(pClientInfo, pbyBdat)
    return NO_ERR
end function
```

### Summary

The file contains three functions for handling sbit data in
font files:
1. `GetSbitMetrics` retrieves the metrics for a specific glyph.
2. `GetSbitBitmap` retrieves the bitmap data for a specific glyph.
3. `GetSbitComponentInfo` retrieves information about a composite glyph
component.

# File: Debugging.c

This file contains several debug routines for a graphics library.

## Function: PrintDebug

- **Purpose**: Prints a debug message.
- **Parameters**:
  - `Message`: A string containing the format of the message.
  - `...`: Additional arguments to be formatted into the message.
- **Process**:
  - Initializes a `va_list` to handle variable arguments.
  - Calls `EngDebugPrint` with the format string and variable arguments.
  - Ends the `va_list`.

## Function: PrintCurve

- **Purpose**: Prints details about a curve.
- **Parameters**:
  - `Curve`: A pointer to a `TTPOLYCURVE` structure containing the curve
data.
- **Process**:
  - Determines the type of the curve.
  - Prints the curve type and the number of points.
  - Iterates through each point and prints its coordinates.

## Function: PrintGridFit

- **Purpose**: Prints details about the output from grid fitting.
- **Parameters**:
  - `Output`: A pointer to a `GlyphInfoType` structure containing the
grid fitting data.
- **Process**:
  - Prints the number of contours and total points.
  - Iterates through each contour, printing the start and end points, and
the coordinates and on-curve status of each point.

## Function: PrintGlyphSet

- **Purpose**: Prints details about a glyph set.
- **Parameters**:
  - `GlyphSet`: A pointer to a `GLYPHSET` structure containing the
glyph set data.
- **Process**:
  - Prints the number of runs and the total number of glyphs supported.
  - Iterates through each run, printing the low and high Unicode values of
the glyphs in that run.

```markdown
# File: pathGeneration.c

## Function: `GeneratePath`

**Purpose:**
- Generates a path from outline data.

**Inputs:**
- `PATHOBJ * ppo`: Pointer to the path object to be generated.
- `TTPOLYGONHEADER * ppolyStart`: Pointer to the buffer with outline data.
- `ULONG cjTotal`: Size of the buffer.

**Outputs:**
- Returns `BOOL` indicating success.

**Pseudocode:**
```pseudocode
function GeneratePath(ppo, ppolyStart, cjTotal):
    ppoly = ppolyStart
    ppolyEnd = (PBYTE)ppolyStart + cjTotal

    while ppoly < ppolyEnd:
        // Ensure the polygon type is correct
        assert(ppoly->dwType == TT_POLYGON_TYPE)

        // Move to the starting point of the current contour
        if not PATHOBJ_bMoveTo(ppo, ppoly->pfxStart):
            return FALSE

        pptfixStart = ppoly->pfxStart
        pcrvEnd = (PBYTE)ppoly + ppoly->cb

        while pcrv < pcrvEnd:
            if pcrv->wType == TT_PRIM_LINE:
                // Handle line segment
                if not PATHOBJ_bPolyLineTo(ppo, pcrv->apfx, pcrv->cpfx):
                    return FALSE
            else if pcrv->wType == TT_PRIM_QSPLINE:
                // Handle quadratic spline
                cBez = pcrv->cpfx - 1
                if cBez > C_BEZIER:
                    pptfixBez = (POINTFIX *)PV_ALLOC((3 * cBez) *
sizeof(POINTFIX))
                    if pptfixBez == NULL:
                        return FALSE
                else:
                    pptfixBez = aptfixBez

                QsplineToPolyBezier(cBez, pptfixStart, pcrv->apfx,
pptfixBez)

                if cBez > C_BEZIER:
                    V_FREE(pptfixBez)

                if not PATHOBJ_bPolyBezierTo(ppo, pptfixBez, 3 * cBez):
                    return FALSE

            pptfixStart = &pcrv->apfx[pcrv->cpfx - 1]
            pcrv = (PBYTE)pcrv + CJ_CRV(pcrv)

        assert(pcrv == pcrvEnd)

        // Close the path
        if not (PATHOBJ_bPolyLineTo(ppo, ppoly->pfxStart, 1) and
                PATHOBJ_bCloseFigure(ppo)):
            return FALSE

        ppoly = (PBYTE)ppoly + ppoly->cb

    assert(ppoly == ppolyEnd)
    return TRUE
```

## Function: `QsplineToPolyBezier`

**Purpose:**
- Converts a quadratic spline to a series of polynomial beziers.

**Inputs:**
- `ULONG cBez`: Count of curves to convert to beziers.
- `POINTFIX * pptfixStart`: Starting point on the first curve.
- `POINTFIX * pptfixSpline`: Array of (cBez+1) points defining the spline.
- `POINTFIX * pptfixBez`: Buffer to store control points for beziers.

**Outputs:**
- None.

**Pseudocode:**
```pseudocode
function QsplineToPolyBezier(cBez, pptfixStart, pptfixSpline, pptfixBez):
    cMidBez = cBez - 1
    ptfixA = pptfixStart

    for iBez from 0 to cMidBez:
        // Compute M and N points for the current bezier
        pptfixBez->x = DIV_BY_3((pptfixSpline->x * 2) + ptfixA.x)
        pptfixBez->y = DIV_BY_3((pptfixSpline->y * 2) + ptfixA.y)
        pptfixBez++

        // Update A point for the next bezier
        ptfixA.x = DIV_BY_2(pptfixSpline[0].x + pptfixSpline[1].x)
        ptfixA.y = DIV_BY_2(pptfixSpline[0].y + pptfixSpline[1].y)

        // Compute N point for the current bezier
        pptfixBez->x = DIV_BY_3((pptfixSpline->x * 2) + ptfixA.x)
        pptfixBez->y = DIV_BY_3((pptfixSpline->y * 2) + ptfixA.y)
        pptfixBez++

        // Store the C point for this curve
        *pptfixBez++ = ptfixA
        pptfixSpline++

    // Handle the last bezier
    pptfixBez->x = DIV_BY_3((pptfixSpline->x * 2) + ptfixA.x)
    pptfixBez->y = DIV_BY_3((pptfixSpline->y * 2) + ptfixA.y)
    pptfixBez++

    ptfixA = pptfixSpline[1]

    pptfixBez->x = DIV_BY_3((pptfixSpline->x * 2) + ptfixA.x)
    pptfixBez->y = DIV_BY_3((pptfixSpline->y * 2) + ptfixA.y)
    pptfixBez++

    *pptfixBez = ptfixA
```

# TTFD Font Rendering Library - Bitmap Functions

## Overview

The TTFD (TrueType Font Display) library provides functions for rendering
TTF fonts, focusing on handling bitmap generation for glyph data.
Functions like `CopyBits`, `CreateFixedPitchBitmap`, and
`GetVerticalBitmap` are essential for rendering glyphs into bitmaps,
especially for vertical text.

## Functions

### CopyBits

```pseudo
// Function to copy gray bits from source to destination bitmap
VOID CopyBits(FONTCONTEXT *fc, GLYPHBITS *gb, BYTE *src, GMC *mc)
{
    // Call the internal helper function to perform the copy
    GCGB(fc, gb, src, mc, 0);
}
```

**Purpose**: This function copies grayscale bitmap data from a source
buffer to a destination `GLYPHBITS` structure. It uses the `GCGB` helper
function to perform the actual copying.

### CreateFixedPitchBitmap

```pseudo
// Function to create a fixed-pitch grayscale bitmap for a glyph
VOID CreateFixedPitchBitmap(FONTCONTEXT *fc, GLYPHBITS *gb, BYTE *src,
GLYPHDATA *gd, GMC *mc)
{
    // Call the internal helper function to perform the bitmap creation
    GCGB(fc, gb, src, mc, gd->rclInk.top + fc->lAscDev);
}
```

**Purpose**: This function creates a fixed-pitch grayscale bitmap
specifically for a glyph. It uses the `GCGB` helper function to generate
the bitmap, taking into account the ink bounding box and the font's ascent
deviation.

### GetVerticalBitmap

```pseudo
// Function to get a glyph bitmap for vertical text
LONG GetVerticalBitmap(FONTCONTEXT *fc, HGLYPH glyph, GLYPHDATA *gd, PVOID
v, BOOL bMinBmp, FS_ENTRY *piRet)
{
    LONG glyphDataSize;
    WCHAR ch;

    // Convert glyph index to Unicode character
    IndexToWchar(fc->pff, &ch, (uint16)glyph);

    // Check if the character is full-width
    if (!IsFullWidthCharacter(fc->pff->uiFontCodePage, ch))
    {
        // Call the ordinary glyph bitmap function for non-full-width
characters
        return GetGlyphBitmap(fc, glyph, gd, v, bMinBmp, piRet);
    }

    // Save the current glyph index
    fc->hgSave = glyph;

    // Check if the font file has an alternate glyph index for vertical
mode
    if (fc->pff->hgSearchVerticalGlyph)
        glyph = (*fc->pff->hgSearchVerticalGlyph)(fc, glyph);

    // Set vertical mode
    fc->ulControl |= VERTICAL_MODE;

    // Call the ordinary glyph bitmap function with the new glyph index
    glyphDataSize = GetGlyphBitmap(fc, glyph, gd, v, bMinBmp, piRet);

    // Restore the transformation and control flags
    ChangeXform(fc, FALSE);
    fc->ulControl &= ~VERTICAL_MODE;

    return glyphDataSize;
}
```

**Purpose**: This function handles the rendering of glyph bitmaps for
vertical text. It checks if the character is full-width and, if so,
switches to vertical mode, modifies the glyph index if necessary, and
calls the ordinary glyph bitmap function. After rendering, it restores the
transformation and control flags.

## Summary

- **CopyBits**: Copies grayscale bitmap data from source to destination.
- **CreateFixedPitchBitmap**: Creates a fixed-pitch grayscale bitmap for a
glyph.
- **GetVerticalBitmap**: Handles the rendering of glyph bitmaps for
vertical text, including mode switching and glyph index modification if
necessary.

# Font Context Management

## Function: `SetAntiAliasingState`

This function manages the anti-aliasing state of a font context based on
the font properties and the size of the glyphs. It ensures that the font
context is correctly set to use 16-bit gray levels if possible, otherwise,
it sets up the context for monochrome output.

### Parameters
- `fontContext`: A pointer to a `FontContext` structure containing
information about the font.

### Procedure
1. **Initialization and Assertions**:
    - Ensure that the `fontType` of the font context and its parent font
object are the same.
    - Ensure that the `fontType` has not already chosen a depth (i.e.,
`CHOSE_DEPTH` is not set).

2. **Set Depth Choice**:
    - Mark the font context as having chosen a depth by setting
`CHOSE_DEPTH`.

3. **Check Gray16 Flag**:
    - If the `GRAY16` flag is set in the font context, proceed to check
and potentially clear it.

4. **Handle Non-Gray16 Case**:
    - If the `GRAY16` flag is not set, and the `NO_CHOICE` flag is not
set, proceed to set up the `GRAY16` flag based on the `gasp` table.

5. **Set Default GASP Table**:
    - If no `gasp` table is present, set up a default `gasp` table based
on the font's selection flags (bold, italic).

6. **Search GASP Table**:
    - Search the `gasp` table for the appropriate range that corresponds
to the requested pixels per em (`emHeightDev`).
    - If the size is within a range that supports anti-aliasing, set the
`GRAY16` flag.

7. **Adjust Font Context**:
    - If the `GRAY16` flag is set, ensure it is also set in the parent
font object.
    - If the `GRAY16` flag is not set, clear the `NOGRAY16` flag in the
parent font object.

8. **Debugging**:
    - Print debugging information if the `DEBUG_GRAY` flag is set in
`gflTtfdDebug`.

### Pseudocode
```plaintext
function SetAntiAliasingState(fontContext: FontContext):
    if fontContext.fontType != fontContext.parentFont.fontType:
        error("Font types should be identical here")
    if fontContext.fontType & CHOSE_DEPTH:
        error("We should not have chosen a level at this time")

    fontContext.fontType |= CHOSE_DEPTH
    if fontContext.fontType & GRAY16:
        fontContext.fontType &= ~(GRAY16)
        if fontContext.fontType & NO_CHOICE:
            fontContext.fontType |= GRAY16
        else:
            dp = getGASPOffset(fontContext.options[IT_OPT_GASP].dp)
            if dp == 0:
                us = fontContext.fontFile.selectionFlags
                if us & FM_SEL_ITALIC:
                    pgasp = defaultGASPItalic
                else if us & FM_SEL_BOLD:
                    pgasp = defaultGASPBold
                else:
                    pgasp = defaultGASPRegular
            else:
                pgasp = getGASPTable(dp, fontContext.fontFile.view)

            if fontContext.emHeightDev > USHRT_MAX:
                warning("emHeightDev > USHRT_MAX")

            pgr = pgasp.gaspRange
            cRanges = pgasp.numRanges
            if cRanges > 8:
                warning("Unusual GASPTABLE : cRanges > 8")
                cRanges = 8
            pgrOut = pgr + cRanges
            iLow = -1
            iHt = fontContext.emHeightDev
            for i = 0 to cRanges:
                iHigh = pgr[i].rangeMaxPPEM
                if iLow < iHt and iHt <= iHigh:
                    if GASP_DOGRAY & pgr[i].rangeGaspBehavior:
                        fontContext.fontType |= GRAY16
                    break
                iLow = iHigh

    if not fontContext.fontType & GRAY16:
        fontContext.fontType |= NOGRAY16
        fontContext.parentFont.fontType = fontContext.fontType

    if gflTtfdDebug & DEBUG_GRAY:
        printGASPTABLE(pgasp)
```

### Debugging Function: `printGASPTABLE`

This function prints the contents of a `GASPTABLE` to the debug screen for
inspection.

### Parameters
- `gaspTable`: A pointer to a big-endian `GASPTABLE`.

### Procedure
1. **Print Header Information**:
    - Print the version and number of ranges in the `GASPTABLE`.

2. **Print Range Information**:
    - Iterate through each range in the `GASPTABLE` and print the maximum
PPEM value and the corresponding gasp behavior.

### Pseudocode
```plaintext
function printGASPTABLE(gaspTable: GASPTABLE):
    print("GASPTABLE HEADER")
    print("gaspTable = ", gaspTable)
    print("version   = ", gaspTable.version)
    print("numRanges = ", gaspTable.numRanges)

    pgr = gaspTable.gaspRange
    pgrOut = pgr + gaspTable.numRanges
    for i = 0 to gaspTable.numRanges:
        print("    ", pgr[i].rangeMaxPPEM, "    ",
pgr[i].rangeGaspBehavior)
```

### Summary
- `SetAntiAliasingState` manages the anti-aliasing state of a font context
based on the font properties and the glyph size.
- `printGASPTABLE` is a debugging function that prints the contents of a
`GASPTABLE` to the debug screen.

## File: FillCharSets.c

### Function: FillCharSets

#### Purpose:
This function fills the `charSets` array with character sets based on the
font information provided in `fontInfo`.

#### Parameters:
- `fontInfo`: A pointer to the font information structure.
- `charSets`: An array to store the character sets.
- `currentIndex`: A pointer to the current index in the `charSets` array.
- `fontFile`: A pointer to the font file structure.

#### Pseudocode:

```markdown
FillCharSets(fontInfo, charSets, currentIndex, fontFile)
    isDBCSFont = IsDoubleByteCharacterSetFont(fontInfo)  // Check if the
font is a DBCS font
    os2Table = GetOS2Table(fontInfo)  // Get the OS/2 table from the font
file
    cmapTable = GetCmapTable(fontInfo)  // Get the Cmap table from the
font file

    if isDBCSFont and IsMSMinchoOrMSGothic(fontInfo->faceName)
        charSets[currentIndex++] = fontInfo->winCharSet  // Add the
Windows character set for MS Mincho or MS Gothic
    else if os2Table and IsValidOS2Signature(os2Table)
        fsig = BE_UINT32(os2Table+OS2_CODE_PAGE_RANGE_1_OFFSET)  // Get
the code page range from the OS/2 table
        for i from 0 to nCharsets
            if fsig & fs[i]
                charSets[currentIndex++] = (BYTE)charsets[i]  // Add the
character set based on the code page range
        if fsig & 0X80000000  // Check for FS_SYMBOL
            charSets[currentIndex++] = SYMBOL_CHARSET
        fsig = BE_UINT32(os2Table+OS2_CODE_PAGE_RANGE_2_OFFSET)  // Get
the code page range from the OS/2 table
        if fsig
            oemCodePage, ansiCodePage = GetCurrentCodePage()  // Get the
current OEM and ANSI code pages
            fsigOEM = 0x80000000L
            for i from 0 to NOEMCHARSETS
                if oemCodePage == oemPages[i]
                    if fsigOEM & fsig
                        charSets[currentIndex++] = OEM_CHARSET
                    break
                fsigOEM >>= 1
    else if fontInfo->panose.familyType != PAN_FAMILY_PICTORIAL and
giFirstChar < 256
        if cmapTable
            if fontInfo->fsSelection & 0xff00
                cs = (BYTE)((fontInfo->fsSelection >> 8) & 0xff)
                switch cs
                    case 0xB2:
                    case 0xB3:
                    case 0xB4:
                        charSets[currentIndex++] = cs
                        break
                charSets[currentIndex++] = cs
            else
                if fontFile->pComputeIndexProc(cmapTable, 0xd0, NULL)
                    charSets[currentIndex++] = ANSI_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x2206, NULL)
                    charSets[currentIndex++] = MAC_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x03cb, NULL)
                    charSets[currentIndex++] = GREEK_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x0130, NULL)
                    charSets[currentIndex++] = TURKISH_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x05d0, NULL)
                    charSets[currentIndex++] = TURKISH_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x0451, NULL)
                    charSets[currentIndex++] = RUSSIAN_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x0148, NULL)
                    charSets[currentIndex++] = EE_CHARSET
                if fontFile->pComputeIndexProc(cmapTable, 0x2592, NULL)
                    charSets[currentIndex++] = OEM_CHARSET
        else
            charSets[currentIndex++] = SYMBOL_CHARSET
    if isDBCSFont and currentIndex < 16
        charSets[currentIndex++] = FEOEM_CHARSET
    while currentIndex < 16
        charSets[currentIndex++] = DEFAULT_CHARSET

    if charSets[0] == DEFAULT_CHARSET
        printf("FillCharSets: no charsets detected in %s, forcing
ANSI!\n", fontFile->fileName)
        charSets[0] = ANSI_CHARSET
```

#### Notes:
- The function checks if the font is a DBCS font and handles specific
cases for MS Mincho and MS Gothic.
- It retrieves the OS/2 and Cmap tables from the font file and processes
them to determine the appropriate character sets.
- The function also handles backward compatibility with Win 3.1 fonts and
sets the `charSets` array accordingly.
- The function terminates the `charSets` array with default character sets
if necessary.

# Font Management Functions

The Font Management Driver (FMD) provides functions to handle and query
font files. These functions ensure safe operations in a multi-threaded
environment by managing resources and handling exceptions gracefully.

## Overview

- **Semaphore Protection**: Each function acquires and releases a
semaphore for thread safety.
- **Exception Handling**: Functions include exception handling to catch
and manage errors during font operations.
- **Resource Management**: Functions like `FreeFontResource` are used to
free resources when necessary.

## Functions

### `LoadFont`

- **Purpose**: Loads a font file.
- **Parameters**:
  - `ULONG cFiles`: Number of files to load (expected to be 1).
  - `ULONG *piFile`: Pointer to the file index.
  - `PVOID *ppvView`: Pointer to the view pointer.
  - `ULONG *pcjView`: Pointer to the view size.
  - `ULONG ulLangId`: Language identifier.
- **Return**: Handle to the font file (`HFF`) or `NULL` on failure.
- **Process**:
  - Acquire semaphore.
  - Load the font file.
  - Handle exceptions and free the font file if necessary.
  - Release semaphore.

### `UnloadFont`

- **Purpose**: Unloads a font file.
- **Parameters**:
  - `HFF hff`: Handle to the font file.
- **Return**: `TRUE` on success, `FALSE` on failure.
- **Process**:
  - Acquire semaphore.
  - Unload the font file.
  - Handle exceptions.
  - Release semaphore.

### `QueryFontData`

- **Purpose**: Queries font data.
- **Parameters**:
  - `DHPDEV dhpdev`: Display handle.
  - `FONTOBJ *pfo`: Font object.
  - `ULONG iMode`: Query mode.
  - `HGLYPH hg`: Glyph handle.
  - `GLYPHDATA *pgd`: Glyph data.
  - `PVOID pv`: Pointer to buffer.
  - `ULONG cjSize`: Buffer size.
- **Return**: Result of the query.
- **Process**:
  - Acquire semaphore.
  - Query the font data.
  - Handle exceptions and mark font as gone if necessary.
  - Release semaphore.

### `FreeResource`

- **Purpose**: Frees a resource.
- **Parameters**:
  - `PVOID pv`: Pointer to the resource.
  - `ULONG id`: Resource identifier.
- **Return**: None.
- **Process**:
  - Acquire semaphore.
  - Free the resource.
  - Release semaphore.

### `DestroyFont`

- **Purpose**: Destroys a font object.
- **Parameters**:
  - `FONTOBJ *pfo`: Font object.
- **Return**: None.
- **Process**:
  - Acquire semaphore.
  - Destroy the font object.
  - Release semaphore.

### `QueryTrueTypeOutline`

- **Purpose**: Queries TrueType outline data.
- **Parameters**:
  - `DHPDEV dhpdev`: Display handle.
  - `FONTOBJ *pfo`: Font object.
  - `HGLYPH hglyph`: Glyph handle.
  - `BOOL bMetricsOnly`: Flag indicating to retrieve only metrics.
  - `GLYPHDATA *pgldt`: Glyph data.
  - `ULONG cjBuf`: Buffer size.
  - `TTPOLYGONHEADER *ppoly`: Pointer to polygon header.
- **Return**: Result of the query.
- **Process**:
  - Acquire semaphore.
  - Query the TrueType outline data.
  - Handle exceptions and mark font as gone if necessary.
  - Release semaphore.

### `QueryAdvanceWidths`

- **Purpose**: Queries advance widths for glyphs.
- **Parameters**:
  - `DHPDEV dhpdev`: Display handle.
  - `FONTOBJ *pfo`: Font object.
  - `ULONG iMode`: Query mode.
  - `HGLYPH *phg`: Array of glyph handles.
  - `LONG *plWidths`: Array to store widths.
  - `ULONG cGlyphs`: Number of glyphs.
- **Return**: `TRUE` on success, `FALSE` on failure.
- **Process**:
  - Acquire semaphore.
  - Query the advance widths.
  - Handle exceptions and mark font as gone if necessary.
  - Release semaphore.

### `QueryTrueTypeTable`

- **Purpose**: Queries a TrueType table.
- **Parameters**:
  - `HFF hff`: Handle to the font file.
  - `ULONG ulFont`: Font identifier (always 1 for version 1.0).
  - `ULONG ulTag`: Tag identifying the table.
  - `PTRDIFF dpStart`: Offset into the table.
  - `ULONG cjBuf`: Buffer size.
  - `PBYTE pjBuf`: Buffer to store the table data.
- **Return**: Result of the query.
- **Process**:
  - Acquire semaphore.
  - Query the TrueType table.
  - Handle exceptions and mark font as gone if necessary.
  - Release semaphore.

## Summary

These functions are essential for managing fonts in a multi-threaded
environment. They ensure resources are properly managed and errors are
handled gracefully, preventing crashes and ensuring system stability.

# FONFile.c

## Overview

This file contains routines for accessing font resources within `.fon`
files, specifically tailored for 16-bit DLLs in Windows 3.0.

## Functions

### Function: LoadFont
**Purpose:** Load a font resource from a `.fon` file.

**Parameters:**
- `filePath` (string): Path to the `.fon` file.
- `moduleHandle` (handle): Handle to the module.

**Return Value:**
- `fontHandle` (handle): Handle to the loaded font resource, or `NULL` on
failure.

**Pseudocode:**
```pseudocode
function LoadFont(filePath, moduleHandle):
    // Open the .fon file
    fileHandle = OpenFile(filePath, GENERIC_READ, 0)
    if fileHandle == NULL:
        return NULL

    // Read the font header
    fontHeader = ReadFontHeader(fileHandle)
    if fontHeader == NULL:
        CloseHandle(fileHandle)
        return NULL

    // Allocate memory for the font resource
    fontResource = AllocateMemory(fontHeader.resourceSize)
    if fontResource == NULL:
        CloseHandle(fileHandle)
        return NULL

    // Read the font resource data
    bytesRead = ReadFile(fileHandle, fontResource,
fontHeader.resourceSize)
    if bytesRead != fontHeader.resourceSize:
        FreeMemory(fontResource)
        CloseHandle(fileHandle)
        return NULL

    // Close the file
    CloseHandle(fileHandle)

    // Load the font resource into memory
    fontHandle = LoadFontIntoMemory(fontResource, fontHeader)
    if fontHandle == NULL:
        FreeMemory(fontResource)
        return NULL

    return fontHandle
```

### Function: FreeFont
**Purpose:** Free a font resource.

**Parameters:**
- `fontHandle` (handle): Handle to the font resource.

**Return Value:**
- None

**Pseudocode:**
```pseudocode
function FreeFont(fontHandle):
    // Free the memory allocated for the font resource
    FreeMemory(fontHandle)
```

### Function: GetFontInfo
**Purpose:** Get information about a font resource.

**Parameters:**
- `fontHandle` (handle): Handle to the font resource.
- `infoType` (DWORD): Type of information to retrieve.

**Return Value:**
- `info` (pointer): Pointer to the retrieved information, or `NULL` on
failure.

**Pseudocode:**
```pseudocode
function GetFontInfo(fontHandle, infoType):
    // Check if the font resource handle is valid
    if fontHandle == NULL:
        return NULL

    // Retrieve the specified information from the font resource
    info = RetrieveFontInfo(fontHandle, infoType)
    if info == NULL:
        return NULL

    return info
```

### Function: EnumFonts
**Purpose:** Enumerate all font resources in a module.

**Parameters:**
- `moduleHandle` (handle): Handle to the module.
- `enumFunction` (pointer): Pointer to the callback function.
- `userData` (LPARAM): Additional data to pass to the callback function.

**Return Value:**
- `BOOL` (boolean): `TRUE` if successful, `FALSE` otherwise.

**Pseudocode:**
```pseudocode
function EnumFonts(moduleHandle, enumFunction, userData):
    // Enumerate all font resources in the module
    for each fontResource in EnumerateFontsInModule(moduleHandle):
        // Call the callback function for each font resource
        if not enumFunction(fontResource, userData):
            return FALSE

    return TRUE
```

## Conclusion
This file provides essential routines for managing font resources within
`.fon` files, including loading, freeing, and enumerating font resources.
The functions utilize low-level file operations and memory management to
interact with font data, ensuring efficient and reliable access to font
resources in Windows 3.0 environments.

The file starts with a comment that says "This is a header file for
converting Unicode characters to Macintosh character codes." It then
defines several macros that represent different Unicode characters and
their corresponding Macintosh character codes.

The macros are defined using the `#define` directive, which assigns a
value to a macro name. For example, the macro `DELETE` is defined as
`007F` and represents the Unicode character for the delete key.

The macros are grouped into categories based on their function or type.
For example, there are macros for punctuation characters, for mathematical
symbols, and for control characters.

The file also contains a comment at the end that says `#endif //
UNICODE_TO_MAC_PROPER`. This comment is used to end a conditional
compilation block that includes the entire contents of the file.

Overall, this file appears to be a useful resource for developers who need
to convert between Unicode and Macintosh character sets. By providing a
mapping between the two sets, the file allows developers to easily convert
text between the two character sets without having to write complex
conversion algorithms.

# Font Scaling Algorithm Description

This code snippet is a part of a larger function responsible for scaling a
font based on desired pixel height (`hWish`) and maintaining its aspect
ratio. The function takes into account various font metrics and
transformations to compute the final scaling factors.

## Function: `ScaleFont`

### Inputs:
- `pfc`: Pointer to a `FontCache` structure, which contains various
font-related information.
- `phead`: Pointer to a `FontHeader` structure, which includes font header
information.
- `pjOS2`: Pointer to an OS/2 table in the font file.
- `pjVdmx`: Pointer to a vdmx table in the font file.
- `fxMyy`: Scaling factor for the vertical direction.
- `yEmN`: Notional space value representing the font's height.

### Outputs:
- Updates the `mx.transform` in the `FontCache` structure to reflect the
computed scaling factors.

### Pseudocode:

```markdown
function ScaleFont(pfc, phead, pjOS2, pjVdmx, fxMyy, yEmN, hWish):
    if pjOS2:
        // For compatibility with Windows 3.1, get the height from the
OS/2 table
        yHeightN = BE_INT16(pjOS2 + OFF_OS2_usWinDescent) + BE_INT16(pjOS2
+ OFF_OS2_usWinAscent)
    else:
        // Get the height from the font header
        yHeightN = BE_INT16(&phead->yMax) - BE_INT16(&phead->yMin)

    if hWish < 0:
        pfc->lEmHtDev = -hWish
    else:
        ppemTrial = FixMul(fxMyy, yEmN)  // Compute trial pixel size
        bWasAbove, bWasBelow, bFound, bFoundPrev = False, False, False,
False
        vtb, vtbPrev = initialize Vtb structure

        // Search for the best vdmx entry
        while True:
            if bFound = bSearchVdmxTable(pjVdmx, pfc->sizLogResPpi.cx,
pfc->sizLogResPpi.cy, -ppemTrial, &vtb):
                hTrial = vtb.yMax - vtb.yMin
                if hTrial == hWish:
                    pfc->yMax = -vtb.yMin
                    pfc->yMin = -vtb.yMax
                    pfc->lEmHtDev = vtb.yPelHeight
                    pfc->flXform |= XFORM_VDMXEXTENTS
                    break
            else:
                hTrial = LongMulDiv(ppemTrial, yHeightN, yEmN)
                if hTrial == hWish:
                    break

            if hTrial < hWish:
                if bWasAbove:
                    if bFound:
                        pfc->yMax = -vtb.yMin
                        pfc->yMin = -vtb.yMax
                        pfc->flXform |= XFORM_VDMXEXTENTS
                    break
                ppemTrial = ppemTrial + 1
                bWasBelow = True
            else:
                ppemTrial = ppemTrial - 1
                if bWasBelow:
                    if bFoundPrev:
                        ASSERTDD(ppemTrial == vtbPrev.yPelHeight, "vdmx
logic screwed up")
                        pfc->yMax = -vtbPrev.yMin
                        pfc->yMin = -vtbPrev.yMax
                        pfc->flXform |= XFORM_VDMXEXTENTS
                    break

        pfc->lEmHtDev = ppemTrial

    pfc->mx.transform[1][1] = FixDiv(pfc->lEmHtDev, yEmN)

    if (pfc->mx.transform[0][0] == fxMyy) or
(FixMul(pfc->mx.transform[0][0] - pfc->mx.transform[1][1],
pfc->pff->ifi.fwAveCharWidth) == 0):
        pfc->mx.transform[0][0] = pfc->mx.transform[1][1]
    else:
        pfc->mx.transform[0][0] = LongMulDiv(pfc->mx.transform[0][0],
pfc->mx.transform[1][1], fxMyy)

    return
```

### Explanation:
- **Initialization**: The function initializes the necessary variables and
structures.
- **Height Calculation**: Depending on whether `pjOS2` is provided, it
calculates the height of the font either from the OS/2 table or the font
header.
- **Scaling Logic**: It calculates a trial pixel size (`ppemTrial`) and
searches through the vdmx table to find the best matching entry. If a
matching entry is found, it updates the font cache with the new
transformation values.
- **Final Adjustment**: It adjusts the scaling factors to ensure that the
font appears correctly scaled and maintains its aspect ratio.
- **Return**: The function returns, updating the font cache with the
computed transformation values.

This pseudocode captures the essence of the font scaling algorithm,
focusing on the core steps and decisions made within the function.

Sure, here is a simplified version of the markdown description with
expanded names and full parameter names:

### ShiftBitmapInfo

This function shifts the bitmap information for a glyph by swapping the x
and y coordinates of the advance width and applying a reflection across
the y-axis.

```markdown
function ShiftBitmapInfo(pgoutSrc, pgoutDst):
    # Copy advance width from src to dst with swapped coordinates
    pgoutDst->metricInfo.deviceAdvanceWidth.x =
pgoutSrc->metricInfo.deviceAdvanceWidth.y
    pgoutDst->metricInfo.deviceAdvanceWidth.y =
-pgoutSrc->metricInfo.deviceAdvanceWidth.x

    # Debugging prints (if enabled)
    if DebugVertical & DEBUG_VERTICAL_BITMAPINFO:
        print("=====TTFD: ShiftBitmapInfo() before\n")
        print("bitMapInfo.bounds: right=%d, left=%d, top=%d, bottom=%d\n",
pgoutSrc->bitMapInfo.bounds.right, pgoutSrc->bitMapInfo.bounds.left,
pgoutSrc->bitMapInfo.bounds.top, pgoutSrc->bitMapInfo.bounds.bottom)
        print("metricInfo.deviceLeftSideBearing x = %d, y=%d \n",
pgoutSrc->metricInfo.deviceLeftSideBearing.x,
pgoutSrc->metricInfo.deviceLeftSideBearing.y)
        print("metricInfo.deviceAdvanceWidth x = %d, y=%d \n",
pgoutSrc->metricInfo.deviceAdvanceWidth.x,
pgoutSrc->metricInfo.deviceAdvanceWidth.y)

        print("=====TTFD: ShiftBitmapInfo() after\n")
        print("bitMapInfo.bounds: right=%d, left=%d, top=%d, bottom=%d\n",
pgoutDst->bitMapInfo.bounds.right, pgoutDst->bitMapInfo.bounds.left,
pgoutDst->bitMapInfo.bounds.top, pgoutDst->bitMapInfo.bounds.bottom)
        print("metricInfo.deviceLeftSideBearing x = %d, y=%d \n",
pgoutDst->metricInfo.deviceLeftSideBearing.x,
pgoutDst->metricInfo.deviceLeftSideBearing.y)
        print("metricInfo.deviceAdvanceWidth x = %d, y=%d \n",
pgoutDst->metricInfo.deviceAdvanceWidth.x,
pgoutDst->metricInfo.deviceAdvanceWidth.y)
```

### ShiftOutlineInfo

This function shifts the outline information for a glyph by adding
specified offsets to each point. The offsets are applied based on the
coordinate format (16.16 or 28.4).

```markdown
function ShiftOutlineInfo(pFontContext, b16Dot16, pBuffer, cjTotal):
    # Define the function to add fixed-point numbers
    function Add16FixTo16Fix(A, B):
        A.fract += B.fract
        A.value += B.value

    function Add16FixTo28Fix(A, B):
        A.fract += (B.fract >> 12)
        A.value += (B.value + (B.fract & 0xFFF) >> 12)

    # Determine the shift values based on pFontContext
    fxShiftX = F16_16TOLROUND(pFontContext->fxDeviceShiftX)
    fxShiftY = F16_16TOLROUND(pFontContext->fxDeviceShiftY)

    # Select the addition function based on the coordinate format
    if b16Dot16:
        addFunc = Add16FixTo16Fix
        bForceMinus = FALSE
    else:
        addFunc = Add16FixTo28Fix
        bForceMinus = TRUE

    # Loop through each polygon in the outline
    for each TTPOLYGONHEADER in pBuffer:
        # Shift the starting point
        addFunc(&ppoly->pfxStart.x, &fxShiftX, FALSE)
        addFunc(&ppoly->pfxStart.y, &fxShiftY, bForceMinus)

        # Loop through each curve in the polygon
        for each TTPOLYCURVE in the polygon:
            for each POINTFX in the curve:
                addFunc(&pptfix->x, &fxShiftX, FALSE)
                addFunc(&pptfix->y, &fxShiftY, bForceMinus)
```

### Debugging

The code includes debugging prints that can be enabled by setting certain
flags. These prints provide information about the state of the glyph
outline before and after transformation.

```markdown
if DebugVertical & DEBUG_VERTICAL_BITMAPINFO:
    print("=====TTFD: ShiftBitmapInfo() before\n")
    print("bitMapInfo.bounds: right=%d, left=%d, top=%d, bottom=%d\n",
pgoutSrc->bitMapInfo.bounds.right, pgoutSrc->bitMapInfo.bounds.left,
pgoutSrc->bitMapInfo.bounds.top, pgoutSrc->bitMapInfo.bounds.bottom)
    print("metricInfo.deviceLeftSideBearing x = %d, y=%d \n",
pgoutSrc->metricInfo.deviceLeftSideBearing.x,
pgoutSrc->metricInfo.deviceLeftSideBearing.y)
    print("metricInfo.deviceAdvanceWidth x = %d, y=%d \n",
pgoutSrc->metricInfo.deviceAdvanceWidth.x,
pgoutSrc->metricInfo.deviceAdvanceWidth.y)

    print("=====TTFD: ShiftBitmapInfo() after\n")
    print("bitMapInfo.bounds: right=%d, left=%d, top=%d, bottom=%d\n",
pgoutDst->bitMapInfo.bounds.right, pgoutDst->bitMapInfo.bounds.left,
pgoutDst->bitMapInfo.bounds.top, pgoutDst->bitMapInfo.bounds.bottom)
    print("metricInfo.deviceLeftSideBearing x = %d, y=%d \n",
pgoutDst->metricInfo.deviceLeftSideBearing.x,
pgoutDst->metricInfo.deviceLeftSideBearing.y)
    print("metricInfo.deviceAdvanceWidth x = %d, y=%d \n",
pgoutDst->metricInfo.deviceAdvanceWidth.x,
pgoutDst->metricInfo.deviceAdvanceWidth.y)
```

This simplified markdown description provides a clear overview of the
functions and their operations with full parameter names and expanded
function names.

