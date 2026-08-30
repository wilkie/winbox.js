This contains rough pseudocode for the Windows scanning rasterizer as determined
by test fixtures and observation.

## Types

* `Fixed26Dot6` - A 26.6 fixed point value.
* `ScanKind` - An enumerated value selecting the type of scanning.

## ScanKind

* `NoDropout` - Turns off pixel dropping altogether
* `Smart` - Turns on 'Smart' dropout
* `StubControl` - Turns on 'stubs' control

## ScanCode

* `Line` - We are drawing a line
* `Spline` - We are drawing a spline
* `EndPoint` - We are looking at the end point

## State

There is some scanning context called `CONTEXT` with the following fields:

* `x0` - The prior point X (can be null if there's no prior point)
* `y0` - The prior point Y (can be null if there's no prior point)
* `x1` - The first point X
* `y1` - The first point Y
* `x2` - The second point X
* `y2` - The second point Y
* `horizOnBegin` - The list of coordinates that begin horizontal 'on'
* `horizOffBegin` - The list of coordinates that begin horizontal 'off'
* `vertOnBegin` - The list of coordinates that begin vertical 'on'
* `vertOffBegin` - The list of coordinates that begin vertical 'off'
* `vertBegin` - The list of coordinates that are vertical spans
* `controlPoints` - Points in the contour

## Constants

* `SUB_PIXEL = 64` - The subpixels per pixel
* `SUB_PIXEL_SHIFT = 6` - `log_2(SUB_PIXEL)`
* `SUB_PIXEL_HALF = 32` - `SUB_PIXEL >> 1` - Half of a sub pixel
* `SUCCESS = 0x0` - Just a successful error code

## Methods

Some helper methods

```
# Return the power of two strictly higher than the given number it terms of
# shifts. That means that 4 returns 3 (which reflects the next power of two
# of 8), etc
PowerOf2(int n):
  # n = abs(n)
  if n < 0:
    n = -n

  if n == 0:
    return 0

  shifts = 0

  if n >= (1 << 16):
    n >>= 16
    shifts += 16

  if n >= (1 << 8):
    n >>= 8
    shifts += 8

  if n >= (1 << 4):
    n >>= 4
    shifts += 4

  if n >= (1 << 2):
    n >>= 2
    shifts += 2

  if n >= (1 << 1):
    shifts += 1

  return shifts + 1
```

```
# Get the scan line coordinate above the given one in the sub pixel grid
ScanAbove(p):
  return ((p + SUB_PIXEL_HALF) & (-SUB_PIXEL)) + SUB_PIXEL_HALF
```

```
# Whether or not the given coordinate is on the sub pixel scanline
OnScanline(p):
  return (p & (SUB_PIXEL - 1)) == SUB_PIXEL_HALF
```

```
# Get the scan line coordinate below the given one in the sub pixel grid
ScanBelow(p):
  return ((p - SUB_PIXEL_HALF - 1) & (-SUB_PIXEL)) + SUB_PIXEL_HALF
```

```
# Just some wrapper for the fixed point multiplication and then divide
# I don't put the actual Fixed point 26.6 math here, just presume it
FixedMulDiv(a, b, c):
  # perform the fixed multiplication and then division
  return (a * b) / c
```

Initialization of state occurs at the beginning of the scan.

```
Setup(ScanKind scanKind, bool saveRow):
  # Maintaining lists for each on and off marker
  CONTEXT.horizOnBegin = [[]] * (CONTEXT.hiScanBand - CONTEXT.loScanBand)
  CONTEXT.horizOffBegin = [[]] * (CONTEXT.hiScanBand - CONTEXT.loScanBand)

  # Horizontal intersections, if dropout occurs
  if !(scanKind & ScanKind.NoDropout):
    CONTEXT.vertOnBegin = [[]] * (prectBox->right - prectBox->left)
    CONTEXT.vertOffBegin = [[]] * (prectBox->right - prectBox->left)

    if saveRow:
      # for fast banding and dropout
      CONTEXT.pulLastRow = []
      CONTEXT.lastRowIndex = Infinity # impossible value as a sentinel

    if scanKind & ScanKind.Smart:
      CONTEXT.controlPoints = []

  return SUCCESS
```

```
BeginContourEndpoint(Fixed26Dot6 x, Fixed26Dot6 y):
  CONTEXT.x1 = x
  CONTEXT.y1 = y
  CONTEXT.x0 = Infinity
```

```
CalcHorizLineSubpix(Fixed26Dot6 y, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY):
  yDrop = (y << SUB_PIXEL_SHIFT) + SUB_PIXEL_HALF
  # Perform fixed-point multiply and division
  return onX + FixedMulDiv(nextX - onX, yDrop - onY, nextY - onY)
```

```
CalcVertLineSubpix(Fixed26Dot6 x, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY):
  xDrop = (x << SUB_PIXEL_SHIFT) + SUB_PIXEL_HALF
  # Perform fixed-point multiply and division
  return onY + FixedMulDiv(nextY - onY, xDrop - onX, nextX - onX)
```

```
CalcHorizSubpix(ScanCode code, Fixed26Dot y, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY, Fixed26Dot6 nextNextX, Fixed26Dot6 nextNextY):
  if code == ScanCode.Line:
    return CalcHorizLineSubpix(y, onX, onY, nextX, nextY)
  elif code == ScanCode.Spline:
    return CalcHorizSplineSubpix(y, onX, onY, nextX, nextY, nextNextX, nextNextY)
  else # code == ScanCode.EndPoint
    return onX
```

```
CalcVertSubpix(ScanCode code, Fixed26Dot x, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY, Fixed26Dot6 nextNextX, Fixed26Dot6 nextNextY):
  if code == ScanCode.Line:
    return CalcVertLineSubpix(x, onX, onY, nextX, nextY)
  elif code == ScanCode.Spline:
    return CalcVertSplineSubpix(x, onX, onY, nextX, nextY, nextNextX, nextNextY)
  else # code == ScanCode.EndPoint
    return onY
```

```
CalcLine(
  Fixed26Dot6 x1,
  Fixed26Dot6 y1,
  Fixed26Dot6 x2,
  Fixed26Dot6 y2,
  ScanKind scanKind,
):
  if y2 >= y1:
    # going up (or horizontal line)
    quadrant = 1
    q = 0

    initialY = ScanAbove(y1)
    initialYStep = initialY - y1

    y = initialY >> SUB_PIXEL_SHIFT
    ySteps = (ScanBelow(y2) >> SUB_PIXEL_SHIFT) - y + 1
    yIncrement = 1
    yOffset = 0
    terminalY = y2 - y1
  else:
    # going down
    quadrant = 4
    q = 1

    initialY = ScanBelow(y1)
    initialYStep = y1 - initialY

    y = initialY >> SUB_PIXEL_SHIFT
    ySteps = y - (ScanAbove(y2) >> SUB_PIXEL_SHIFT) + 1
    yIncrement = -1
    yOffset = 1
    terminalY = y1 - y2

  if y2 == y1:
    # Specifically a horizontal line
    if scanKind & ScanKind.NoDropout:
      # No dropout control... bail: always draw it
      return SUCCESS

    if x2 < x1:
      # line moves left
      y = ScanAbove(y1 - 1) >> SUB_PIXEL_SHIFT
    else:
      # line moves right
      y = ScanAbove(y1) >> SUB_PIXEL_SHIFT

    # no vertical change
    ySteps = 0

  if x2 >= x1:
    # going right (or vertical line)
    initialX = ScanAbove(x1)
    initialXStep = initialX - x1

    x = initialX >> SUB_PIXEL_SHIFT
    xSteps = (ScanBelow(x2) >> SUB_PIXEL_SHIFT) - x + 1
    xIncrement = 1
    xOffset = 0
    terminalX = x2 - x1
  else:
    # going left

    # flip quadrant
    q = 1 - q
    quadrant = quadrant + yIncrement

    initialX = ScanBelow(x1)
    initialXStep = x1 - initialX

    x = initialX >> SUB_PIXEL_SHIFT
    xSteps = x - (ScanAbove(x2) >> SUB_PIXEL_SHIFT) + 1
    xIncrement = -1
    xOffset = 1
    terminalX = x1 - x2

  if x2 == x1:
    # vertical line specifically
    if y2 > y1:
      # vertical line where we are moving up
      x = ScanAbove(x1 - 1) >> SUB_PIXEL_SHIFT
    else:
      # moving down
      x = ScanAbove(x1) >> SUB_PIXEL_SHIFT

    # no horizontal change
    xSteps = 0

  # Just our one original terminal point (x2, y2)
  points = [[[x2, 0], [y2, 0]]]
  BeginElement(scanKind, quadrant, ScanCode.Line, points)

  # Handle dropout
  if scanKind & ScanKind.NoDropout:
    # No dropout control
    if x1 == x2:
      # vertical line
      for i in range(0, ySteps):
        AddHoriz(scanKind, x, y)
        y += yIncrement
      return SUCCESS

    # now for the line itself
    q += (terminalX * initialYStep) - (terminalY * initialXStep)
    dQy = terminalX << SUB_PIXEL_SHIFT
    dQx = (-terminalY) << SUB_PIXEL_SHIFT

    x += xOffset

    for i in range(0, xSteps + ySteps):
      if q > 0:
        x += xIncrement
        q += dQx
      else:
        AddHoriz(scanKind, x, y)
        y += yIncrement
        q += dQy
  else:
    # Some kind of dropout control
    if y1 == y2:
      # horizontal line
      for i in range(0, xSteps):
        AddVert(scanKind, x, y)
        x += xIncrement
      return SUCCESS

    if x1 == x2:
      # vertical line
      for i in range(0, ySteps):
        AddHoriz(scanKind, x, y)
        y += yIncrement
      return SUCCESS

    # now for the line itself
    q += (terminalX * initialYStep) - (terminalY * initialXStep)
    dQy = terminalX << SUB_PIXEL_SHIFT
    dQx = (-terminalY) << SUB_PIXEL_SHIFT

    for i in range(0, xSteps + ySteps):
      if q > 0:
        AddVert(scanKind, x, y + yOffset)
        x += xIncrement
        q += dQx
      else:
        AddHoriz(scanKind, x + xOffset, y)
        y += yIncrement
        q += dQy

  return SUCCESS
```

```
AddHoriz(ScanKind scanKind, Fixed26Dot6 x, Fixed26Dot6 y):
  if (scanKind & ScanKind.NoDropout) || !(scanKind & ScanKind.Smart):
    if (CONTEXT.hiScanBand == CONTEXT.boxTop) && (CONTEXT.loScanBand == CONTEXT.boxBottom):
      AddHorizSimpleScan(x, y)
    else:
      AddHorizSimpleBand(x, y)
  else:
    if (CONTEXT.hiScanBand == CONTEXT.boxTop) && (CONTEXT.loScanBand == CONTEXT.boxBottom):
      AddHorizSmartScan(x, y)
    else:
      AddHorizSmartBand(x, y)
```

```
AddVert(ScanKind scanKind, Fixed26Dot6 x, Fixed26Dot6 y):
  if (scanKind & ScanKind.NoDropout) || !(scanKind & ScanKind.Smart):
    AddVertSimpleScan(x, y)
  else:
    AddVertSmartScan(x, y)
```

```
CalcSpline(
  Fixed26Dot6 x1,
  Fixed26Dot6 y1,
  Fixed26Dot6 x2,
  Fixed26Dot6 y2,
  Fixed26Dot6 x3,
  Fixed26Dot6 y3,
  ScanKind scanKind,
):
  zShiftTable = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 2, 2, 2, 3, 3,
  ]

  # Relect spline point 1 into quadrant 1
  if y3 > y1:
    # moving up
    q = 0
    quadrant = 1

    initialY = ScanAbove(y1)
    initialYStep = initialY - y1

    y = initialY >> SUB_PIXEL_SHIFT
    yStop = (ScanBelow(y3) >> SUB_PIXEL_SHIFT) + 1
    yIncrement = 1
    yOffset = 0
    controlY = y2 - y1
    terminalY = y3 - y1
  else:
    # moving down
    q = 1
    quadrant = 4

    initialY = ScanBelow(y1)
    initialYStep = y1 - initialY

    y = initialY >> SUB_PIXEL_SHIFT
    yStop = (ScanAbove(y3) >> SUB_PIXEL_SHIFT) - 1
    yIncrement = -1
    yOffset = 1
    controlY = y1 - y2
    terminalY = y1 - y3

  if x3 > x1:
    # moving right
    initialX = ScanAbove(x1)
    initialXStep = initialX - x1

    x = initialX >> SUB_PIXEL_SHIFT
    xStop = (ScanBelow(x3) >> SUB_PIXEL_SHIFT) + 1
    xIncrement = 1
    xOffset = 0
    controlX = x2 - x1
    terminalX = x3 - x1
  else:
    # moving left
    q = 1 - q
    quadrant = quadrant + yIncrement

    initialX = ScanBelow(x1)
    initialXStep = x1 - initialX

    x = initialX >> SUB_PIXEL_SHIFT
    xStop = (ScanAbove(x3) >> SUB_PIXEL_SHIFT) - 1
    xIncrement = -1
    xOffset = 1
    controlX = x1 - x2
    terminalX = x1 - x3

  # control points (x2, y2) and (x3, y3) embedded with possible tags
  points = [[[x2, 0], [y2, 0]], [[x3, 0], [y3, 0]]]

  # set context state according to control points and quadrant for splines
  BeginElement(scanKind, quadrant, ScanCode.Spline, points)

  if scanKind & ScanKind.NoDropout:
    # no dropout
    if y == yStop:
      # no crossings
      return SUCCESS

    if x == xStop:
      # almost vertical
      x += xOffset
      while y != yStop:
        AddHoriz(scanKind, x, y)
        y += yIncrement

      return SUCCESS
  else:
    # smart dropout of some kind
    if x == xStop:
      # almost vertical
      x += xOffset

      while y != yStop:
        AddHoriz(scanKind, x, y)
        y += yIncrement

      return SUCCESS

    if y == yStop:
      # almost horizontal
      y += yOffset

      while x != xStop:
        AddVertScan(scanKind, x, y)
        x += xIncrement

      return SUCCESS

  # precision for curve parameter
  alpha = ((controlX * terminalY) - (controlY * terminalX)) * 2

  aBits = PowerOf2(alpha)
  xyBits = terminalX > terminalY ? PowerOf2(terminalX) : PowerOf2(terminalY)

  # Determine difference in precision
  zShift = zShiftTable[aBits + xyBits]
  zBits = SUB_PIXEL_SHIFT - zShift

  if zShift > 0:
    # We need to adjust for the precision difference
    zRound = 1 << (zShift - 1)

    # Shift pixel coordinates to the 32 or 16 subpixel grid
    controlX = (controlX + zRound) >> zShift
    controlY = (controlX + zRound) >> zShift
    terminalX = (terminalX + zRound) >> zShift
    terminalY = (terminalY + zRound) >> zShift

    initialXStep = (initialXStep + zRound) >> zShift
    initialYStep = (initialYStep + zRound) >> zShift

    # recompute curvature
    alpha = ((controlX * terminalY) - (controlY * terminalX)) * 2

  # Calculate curve parametrics
  aX = terminalX - (controlX << 1)
  aY = terminalY - (controlY << 1)

  # terms for Q = Rx^2 + Sxy + Ty^2 + Ux + Vy (conic quadratic form)
  r = aY * aY
  s2 = -aX * aY
  t = aX * aX
  u2 = controlY * alpha
  v2 = -controlX * alpha

  # Calculate starting forward difference terms
  # q = Q(x,y) = Rx^2 + Sxy + Ty^2 + Ux + Vy
  # dQx = Q(x + z, y) - Q(x, y) = R(2xz + z^2) + Syz + Uz
  # dQy = Q(x, y + z) - Q(x, y) = T(2yz + z^2) + Sxz + Vz
  zSubpix = 1 << zBits
  if xyBits <= 7:
    # Q can fit in our precision without approximating
    q += (((r * initialXStep) + ((s2 << 1) * initialYStep) + (u2 << 1)) * initialXStep) + (((T * initialYStep) + (v2 << 1)) * initialYStep)
    dQx = ((r * ((initialXStep << 1) + zSubpix)) + (((s2 << 1) * initialYStep) + (u2 << 1))) << zBits
    dQy = ((t * ((initialYStep << 1) + zSubpix)) + (((s2 << 1) * initialXStep) + (v2 << 1))) << zBits

    # Get r,s,z in 'z' precision
    rZ = r << (zBits << 1)
    sZ = (s2 << 1) << (zBits << 1)
    tZ = t << (zBits << 1)
  else:
    # We need to approximate Q since it won't fit: so take out a '2z'
    q += (((((r >> 1) * initialStepX) + (s2 * initialStepY) + u2) >> zBits) * initialStepX) + (((((t >> 1) * initialStepY) + v2) >> zBits) * initialStepY)
    dQx = (r * (initialStepX + (zSubpix >> 1))) + (s2 * initialStepY) + u2
    dQy = (t * (initialStepY + (zSubpix >> 1))) + (s2 * initialStepX) + v2

    rZ = r << (zBits - 1)
    sZ = s2 << zBits
    tZ = t << (zBits - 1)

  # Second derivative terms
  ddQx = rZ << 1
  ddQy = tZ << 1

  if scanKind & ScanKind.NoDropout:
    # no dropout control
    x += xOffset
    xStop += xOffset

    if alpha > 0:
      # curves up
      while (x != xStop) && (y != yStop):
        # dy check
        if (q < 0) || (dQy > tZ):
          # Advance the x scan position (moving either left or right)
          x += xIncrement
          # apply change to cross product
          q += dQx
          # adjust derivative term
          dQx += ddQx
          # adjust the derivative cross term
          dQy += sZ
        else:
          AddHorizScan(x, y)
          # Advance the y scan position (moving either up or down)
          y += yIncrement
          # apply change to cross product
          q += dQy
          # adjust derivative term
          dQy += ddQy
          # adjust the derivative cross term
          dQx += sZ
    else:
      # curves down
      while (x != xStop) && (y != yStop):
        if (q < 0) || (dQx > rZ):
          AddHorizScan(x, y)
          # Advance the y scan position (moving either up or down)
          y += yIncrement
          # apply change to cross product
          q += dQy
          # adjust derivative term
          dQy += ddQy
          # adjust the derivative cross term
          dQx += sZ
        else:
          # Advance the x scan position (moving either left or right)
          x += xIncrement
          # apply change to cross product
          q += dQx
          # adjust derivative term
          dQx += ddQx
          # adjust the derivative cross term
          dQy += sZ

    # do parts that are beyond the bounding box
    while y != yStop:
      AddHoriz(scanKind, x, y)
      y += yIncrement

  else:
    # Dropout control is enabled
    if alpha > 0:
      # curves up

      while (x != xStop) && (y != yStop):
        if (q < 0) || (dQx > rZ):
          AddVert(scanKind, x, y + yOffset)
          x += xIncrement
          q += dQx
          dQx += ddQx
          dQy += sZ
        else:
          AddHoriz(scanKind, x + xOffset, y)
          y += yIncrement
          q += dQy
          dQy += ddQy
          dQx += sZ

    else:
      # curves down

      while (x != xStop) && (y != yStop):
        if (q < 0) || (dQx > rZ):
          AddHoriz(scanKind, x + xOffset, y)
          y += yIncrement
          q += dQy
          dQy += ddQy
          dQx += sZ
        else:
          AddVert(scanKind, x, y + yOffset)
          x += xIncrement
          q += dQx
          dQx += ddQx
          dQy += sZ

    # Perform scans beyond bounding box
    while x != xStop:
      AddVert(scanKind, x, y + yOffset)
      x += xIncrement
    while y != yStop:
      AddHoriz(scanKind, x + xOffset, y)
      y += yIncrement

  return SUCCESS
```

```
# Ends a contour, effectively, by checking against the topology
CalcEndPoint(ScanKind scanKind):
  if OnScanline(CONTEXT.y1):
    CheckHorizTopology(CONTEXT.x2Save, CONTEXT.y2Save, scanKind)

  if !(scanKind & ScanKind.NoDropout):
    if OnScanline(CONTEXT.x1):
      CheckVertTopology(CONTEXT.x2Save, CONTEXT.y2Save, scanKind)
```

```
CalcHorizSplineSubpix(Fixed26Dot y, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY, Fixed26Dot6 nextNextX, Fixed26Dot6 nextNextY):
  yDrop = (y << SUB_PIXEL_SHIFT) + SUB_PIXEL_HALF

  x2 = nextX
  y2 = nextY

  if onY < nextNextY:
    # Spline goes up
    x1 = onX
    y1 = onY
    x3 = nextNextX
    y3 = nextNextY
  else:
    # Spline goes down
    # So we flip it
    x1 = nextNextX
    y1 = nextNextY
    x3 = onX
    y3 = onY

  # Midpoint subdivision algorithm
  yMid = yDrop + 1
  while yMid != yDrop:
    xMid = (x1 + x2 + x2 + x3 + 1) >> 2
    yMid = (y1 + y2 + y2 + y3 + 1) >> 2

    if yMid > yDrop:
      # subdivide down
      x2 = (x1 + x2) * 2
      y2 = (y1 + y2) * 2
      x3 = xMid
      y3 = yMid
    elif yMid < yDrop:
      # subdivide up
      x2 = (x2 + x3) * 2
      y2 = (y2 + y3) * 2
      x1 = xMid
      y1 = yMid

    return xMid
```

```
CalcVertSplineSubpix(Fixed26Dot x, Fixed26Dot6 onX, Fixed26Dot6 onY, Fixed26Dot6 nextX, Fixed26Dot6 nextY, Fixed26Dot6 nextNextX, Fixed26Dot6 nextNextY):
  xDrop = (x << SUB_PIXEL_SHIFT) + SUB_PIXEL_HALF

  x2 = nextX
  y2 = nextY

  if onx < nextNextX:
    # Spline goes right
    x1 = onX
    y1 = onY
    x3 = nextNextX
    y3 = nextNextY
  else:
    # Spline goes left
    # So we flip it
    x1 = nextNextX
    y1 = nextNextY
    x3 = onX
    y3 = onY

  # Midpoint subdivision algorithm (left/right)
  xMid = xDrop + 1
  while xMid != xDrop:
    xMid = (x1 + x2 + x2 + x3 + 1) >> 2
    yMid = (y1 + y2 + y2 + y3 + 1) >> 2

    if xMid > xDrop:
      # subdivide left
      x2 = (x1 + x2) * 2
      y2 = (y1 + y2) * 2
      x3 = xMid
      y3 = yMid
    elif yMid < yDrop:
      # subdivide right
      x2 = (x2 + x3) * 2
      y2 = (y2 + y3) * 2
      x1 = xMid
      y1 = yMid

    return yMid
```

```
# Endpoint for the horizontal cases along the grid
CheckHorizTopology(Fixed26Dot6 x, Fixed26Dot6 y, ScanKind scanKind):
  if y > CONTEXT.y1:
    if CONTEXT.y1 > CONTEXT.y0:
      AddHorizOn(scanKind)
    elif CONTEXT.y1 < CONTEXT.y0:
      AddHorizOn(scanKind)
      AddHorizOff(scanKind)
    else:
      if CONTEXT.x1 < CONTEXT.x0:
        AddHorizOn(scanKind)
  elif y < CONTEXT.y1:
    if CONTEXT.y1 > CONTEXT.y0:
      AddHorizOn(scanKind)
      AddHorizOff(scanKind)
    elif (CONTEXT.y1 < CONTEXT.y0):
      AddHorizOff(scanKind)
    else:
      if CONTEXT.x1 > CONTEXT.x0:
        AddHorizOff(scanKind)
  else:
    if CONTEXT.y1 > CONTEXT.y0:
      if x > CONTEXT.x1:
        AddHorizOn(scanKind)
    elif CONTEXT.y1 < CONTEXT.y0:
      if x < CONTEXT.x1:
        AddHorizOff(scanKind)
    else:
      if (CONTEXT.x1 > CONTEXT.x0) && (x < CONTEXT.x1):
        AddHorizOff(scanKind)
      elif (CONTEXT.x1 < CONTEXT.x0) && (x > CONTEXT.x1):
        AddHorizOn(scanKind)
```

```
# Endpoint for vertical scanline cases
CheckVertTopology(Fixed26Dot6 x, Fixed26Dot6 y, ScanKind scanKind):
  if x < CONTEXT.x1:
    if CONTEXT.x1 < CONTEXT.x0:
      AddVertOn(scanKind)
    elif CONTEXT.x1 > CONTEXT.x0:
      AddVertOn(scanKind)
      AddVertOff(scanKind)
    else:
      if CONTEXT.y1 < CONTEXT.y0:
        AddVertOn(scanKind)
  elif x > CONTEXT.x1:
    if CONTEXT.x1 < CONTEXT.x0:
      AddVertOn(scanKind)
      AddVertOff(scanKind)
    elif CONTEXT.x1 > CONTEXT.x0:
      AddVertOff(scanKind)
    else:
      if CONTEXT.y1 > CONTEXT.y0:
        AddVertOff(scanKind)
  else:
    if CONTEXT.x1 < CONTEXT.x0:
      if y > CONTEXT.y1:
        AddVertOn(scanKind)
    elif CONTEXT.x1 > CONTEXT.x0:
      if y < CONTEXT.y1:
        AddVertOff(scanKind)
    else:
      if (CONTEXT.y1 > CONTEXT.y0) && (y < CONTEXT.y1):
        AddVertOff(scanKind)
      elif (CONTEXT.y1 < CONTEXT.y0) && (y > CONTEXT.y1):
        AddVertOn(scanKind)
```

```
AddVertOn(ScanKind scanKind):
  BeginElement(scanKind, 2, ScanCode.EndPoint)
  x = CONTEXT.x1 >> SUB_PIXEL_SHIFT
  y = (CONTEXT.y1 + SUB_PIXEL_HALF - 1) >> SUB_PIXEL_SHIFT

  if ((scanKind & ScanKind.NoDropout) != 0) || !((scanKind & ScanKind.Smart) != 0):
    AddVertSimpleScan(x, y)
  else:
    AddVertSmartScan(x, y)
```

```
AddVertOff(ScanKind scanKind):
  BeginElement(scanKind, 1, ScanCode.EndPoint)
  x = CONTEXT.x1 >> SUB_PIXEL_SHIFT
  y = (CONTEXT.y1 + SUB_PIXEL_HALF) >> SUB_PIXEL_SHIFT

  if ((scanKind & ScanKind.NoDropout) != 0) || !((scanKind & ScanKind.Smart) != 0):
    AddVertSimpleScan(x, y)
  else:
    AddVertSmartScan(x, y)
```

```
AddHorizOn(ScanKind scanKind):
  BeginElement(scanKind, 1, ScanCode.EndPoint)
  x = (CONTEXT.x1 + SUB_PIXEL_HALF - 1) >> SUB_PIXEL_SHIFT
  y = CONTEXT.y1 >> SUB_PIXEL_SHIFT

  if ((scanKind & ScanKind.NoDropout) != 0) || !((scanKind & ScanKind.Smart) != 0):
    if (CONTEXT.hiScanBand == CONTEXT.boxTop) && (CONTEXT.loScanBand == CONTEXT.boxBottom):
      AddHorizSimpleScan(x, y)
    else:
      AddHorizSimpleBand(x, y)
  else:
    if (CONTEXT.hiScanBand == CONTEXT.boxTop) && (CONTEXT.loScanBand == CONTEXT.boxBottom):
      AddHorizSmartScan(x, y)
    else:
      AddHorizSmartBand(x, y)
```

```
AddHorizOff(ScanKind scanKind):
  BeginElement(scanKind, 4, ScanCode.EndPoint)
  x = (CONTEXT.x1 + SUB_PIXEL_HALF) >> SUB_PIXEL_SHIFT
  y = CONTEXT.y1 >> SUB_PIXEL_SHIFT

  if ((scanKind & ScanKind.NoDropout) != 0) || !((scanKind & ScanKind.Smart) != 0):
    AddHorizSimpleScan(x, y)
  else:
    AddHorizSmartScan(x, y)
```

```
BeginScan
```

```
BeginElement(ScanKind scanKind, int quadrant, int elementCode, ((Fixed26Dot6[])[2])[] points = []):
  # Select which horizontal intersections (on or off) we are looking at
  if (quadrant == 1) || (quadrant == 2):
    CONTEXT.horizBegin = CONTEXT.horizOnBegin
  else:
    CONTEXT.horizBegin = CONTEXT.horizOffBegin
  
  if !(scanKind & ScanKind.NoDropout):
    # Some kind of dropout is turned on
    if (quadrant == 2) || (quadrant == 3):
      CONTEXT.vertBegin = CONTEXT.vertOnBegin
    else:
      CONTEXT.vertBegin = CONTEXT.vertOffBegin
    
    if scanKind & ScanKind.Smart:
      # The Smart dropout is enabled
      CONTEXT.scanTag = ((CONTEXT.controlPoints.length - 1) << 2) | elementCode

      # Keep control points into our context
      CONTEXT.controlPoints += points
```

```
# Add the given coordinate to the horizontal scan list
AddHorizSimpleScan(Fixed26Dot6 x, Fixed26Dot6 y):
  # Normalize Y to 0 at bottom
  y -= CONTEXT.boxBottom

  # Add the point to the sorted list ascending
  CONTEXT.horizBegin[y] = sort(CONTEXT.horizBegin[y] + [[x]])
```

```
# Add the given coordinate to the horizontal scan list (with tag)
AddHorizSmartScan(Fixed26Dot6 x, Fixed26Dot6 y):
  # Normalize Y to 0 at bottom
  y -= CONTEXT.boxBottom

  # Add the point to the sorted list ascending
  CONTEXT.horizBegin[y] = sort(CONTEXT.horizBegin[y] + [[x, CONTEXT.scanTag]])
```

```
# Add the given coordinate to the vertical scan list
AddVertSimpleScan(Fixed26Dot6 x, Fixed26Dot6 y):
  # Normalize to 0 as left-most
  x -= CONTEXT.boxLeft

  # Add the point to the sorted list ascending
  CONTEXT.vertBegin[x] = sort(CONTEXT.vertBegin[x] + [[y]])
```

```
# Add the given coordinate to the vertical scan list (with tag)
AddVertSmartScan(Fixed26Dot6 x, Fixed26Dot6 y):
  # Normalize to 0 as left-most
  x -= CONTEXT.boxLeft

  # Add to the sorted list ascending
  CONTEXT.vertBegin[x] = sort(CONTEXT.vertBegin[x] + [[y, CONTEXT.scanTag]]
```

```
AddHorizSimpleBand(Fixed26Dot6 x, Fixed26Dot6 y):
  if y < CONTEXT.loScanBand || y >= CONTEXT.hiScanBand:
    return

  # Normalize Y to 0 at bottom
  y -= CONTEXT.loScanBand

  CONTEXT.horizBegin[y] = sort(CONTEXT.horizBegin[y] + [[x]])
```

```
AddHorizSmartBand(Fixed26Dot6 x, Fixed26Dot6 y):
  if y < CONTEXT.loScanBand || y >= CONTEXT.hiScanBand:
    return

  # Normalize Y to 0 at bottom
  y -= CONTEXT.loScanBand

  CONTEXT.horizBegin[y] = sort(CONTEXT.horizBegin[y] + [[x, CONTEXT.scanTag]])
```

```
PerformHorizDropout(Fixed26Dot6[] ons, Fixed26Dot6[] offs, int yDrop, ScanKind scanKind):
  xDrop = ons[0]
  
  if scanKind & ScanKind.StubControl:
    cross = CountHorizCrossings(xDrop, yDrop + 1)
    cross += CountVertCrossings(xDrop - 1, yDrop + 1)
    cross += CountVertCrossings(xDrop, yDrop + 1)
    if cross < 2:
      # Does not continue above
      return SUCCESS
    
    cross = CountHorizCrossings(xDrop, yDrop - 1)
    cross += CountVertCrossings(xDrop - 1, yDrop)
    cross += CountVertCrossings(xDrop, yDrop)
    if cross < 2:
      # Does not continue below
      return SUCCESS

  if xDrop > CONTEXT.boxLeft:
    # Pixel exists to the left
    if GetBit(xDrop - 1, yDrop) != 0:
      # No dropout
      return SUCCESS

  if xDrop < CONTEXT.boxRight:
    # Pixel exists to the right
    if GetBit(xDrop, yDrop) != 0:
      # No dropout
      return SUCCESS

  # Determine placement of pixel where no pixels are left or right
  if scanKind & ScanKind.Smart:
    onTag = ons[1]
    onPt = onTag >> 2
    onCode = onTag & 3

    x1 = CalcHorizSubpix(onCode, yDrop, controlPoints[onPt][0], controlPoints[onPt][1], controlPoints[onPt + 1][0], controlPoints[onPt + 1][1], controlPoints[onPt + 2][0], controlPoints[onPt + 2][1])
    
    offTag = offs[1]
    offPt = offTag >> 2
    offCode = offTag & 3

    x2 = CalcHorizSubpix(offCode, yDrop, controlPoints[offPt][0], controlPoints[offPt][1], controlPoints[offPt + 1][0], controlPoints[offPt + 1][1], controlPoints[offPt + 2][0], controlPoints[offPt + 2][1])
    
    # Average the two points for the subpixel
    xDrop = (x1 + x2 - 1) >> (SUB_PIXEL_SHIFT + 1)
  else:
    # Simple dropout just drops the pixel to the left
    xDrop--
  
  # Cap to bounding box
  if xDrop < CONTEXT.boxLeft:
    xDrop = CONTEXT.boxLeft
  if xDrop >= CONTEXT.boxRight:
    xDrop = CONTEXT.boxRight - 1

  # Turn on the dropout pixel
  return SetBit(xDrop, yDrop)
```

```
PerformVertDropout(Fixed26Dot6[] ons, Fixed26Dot6[] offs, int xDrop, ScanKind scanKind):
  yDrop = ons[0]

  if (yDrop < CONTEXT.loBitBand) || (yDrop > CONTEXT.hiBitBand):
    # outside of the boundary, bail
    return SUCCESS

  if scanKind & ScanKind.StubControl:
    # Stub control is on, so we check for stubs
    cross = CountVertCrossings(xDrop - 1, ydrop)
    cross += CountHorizCrossings(xDrop, yDrop)
    cross += CountHorizCrossings(xDrop, yDrop - 1)
    if cross < 2:
      # Does not continue to the left
      return SUCCESS
    
    cross = CountVertCrossings(xDrop + 1, yDrop)
    cross += CountHorizCrossings(xDrop + 1, yDrop)
    cross += CountHorizCrossings(xDrop + 1, yDrop - 1)
    if cross < 2:
      # Does not continue to the right
      return SUCCESS

  # Check pixels above and below
  if yDrop > CONTEXT.boxBottom:
    # Pixel below
    if GetBit(xDrop, yDrop - 1) != 0:
      # We do not dropout
      return SUCCESS

  if yDrop < CONTEXT.boxTop:
    # Pixel above
    if GetBit(xDrop, yDrop) != 0:
      # We do not dropout
      return SUCCESS

  # Determine placement of pixel where no pixels are above and below
  if scanKind & ScanKind.Smart:
    onTag = ons[1]
    onPt = onTag >> 2
    onCode = onTag & 3

    y1 = CalcVertSubpix(onCode, xDrop, controlPoints[onPt][0], controlPoints[onPt][1], controlPoints[onPt + 1][0], controlPoints[onPt + 1][1], controlPoints[onPt + 2][0], controlPoints[onPt + 2][1])
    
    offTag = offs[1]
    offPt = offTag >> 2
    offCode = offTag & 3

    y2 = CalcVertSubpix(offCode, xDrop, controlPoints[offPt][0], controlPoints[offPt][1], controlPoints[offPt + 1][0], controlPoints[offPt + 1][1], controlPoints[offPt + 2][0], controlPoints[offPt + 2][1])
    
    # Average the two points for the subpixel
    yDrop = (y1 + y2 - 1) >> (SUB_PIXEL_SHIFT + 1)
  else:
    # Simple dropout is just dropping the pixel below
    yDrop--
  
  # Cap to bounding box
  if yDrop < CONTEXT.boxBottom:
    yDrop = CONTEXT.boxBottom
  if yDrop >= CONTEXT.boxTop:
    yDrop = CONTEXT.boxTop - 1
    
  if (yDrop >= CONTEXT.loBitBand) && (yDrop < CONTEXT.hiBitBand):
    # Turn on the dropout pixel
    return SetBit(xDrop, yDrop)

  return SUCCESS
```

```
CountVertCrosses(Fixed26Dot6 x, Fixed26Dot6 y):
  if (x < CONTEXT.boxLeft) || (x >= CONTEXT.boxRight):
    # This is outside of our scan region
    return 0
  
  numCrossings = 0
  index = x - CONTEXT.boxLeft
  
  for pointX in CONTEXT.vertOnBegin[index]:
    if pointX == x:
      numCrossings++

  for pointX in CONTEXT.vertOffBegin[index]:
    if pointX == x:
      numCrossings++

  return numCrossings
```

```
CountHorizCrosses(Fixed26Dot6 x, Fixed26Dot6 y):
  if (y < CONTEXT.loScanBand) || (y >= CONTEXT.hiScanBand):
    # This is outside of our scan region
    return 0
  
  numCrossings = 0
  index = y - CONTEXT.loScanBand
  
  for pointX in CONTEXT.horizOnBegin[index]:
    if pointX == x:
      numCrossings++

  for pointX in CONTEXT.horizOffBegin[index]:
    if pointX == x:
      numCrossings++

  return numCrossings
```

```
# Get the written pixel value (on/off) of the pixel at the given coordinate
GetBit(Fixed26Dot6 x, Fixed26Dot6 y):
  x = x - CONTEXT.boxLeft

  if (y < CONTEXT.hiBitBand) && (y >= CONTEXT.loBitBand):
    # Within the bitmap
    return BITMAP[CONTEXT.hiBitBand - 1 - y][x]

  if y == CONTEXT.lastRowIndex:
    # Cached from the last row we blitted, so that's fine
    return BITMAP[CONTEXT.hiBitBand - 1 - y][x]

  # Otherwise, it falls outside the bitmap (or at least so far), so it's a
  # clear pixel
  return 0
```

```
# Fills the pixel at the given coordinate
SetBit(Fixed26Dot6 x, Fixed26Dot6 y):
  x = x - CONTEXT.boxLeft
  BITMAP[CONTEXT.hiBitBand - 1 - y][x] = 1
```

```
# Fills the contours
Blit(hiBand, loBand, width, originalLoBand, ScanKind scanKind):
  CONTEXT.hiBitBand = hiBand;                 /* copy bit band limits */
  CONTEXT.loBitBand = loBand
  height = CONTEXT.hiBitBand - CONTEXT.loBitBand
  
  ClearBitmap()
  y = 0

  xOffset = CONTEXT.boxLeft
  
  firstScan = CONTEXT.hiBitBand - CONTEXT.loScanBand - 1

  # Go from top to bottom
  for i in range(0, height):
    onList = CONTEXT.horizOnBegin[firstScan - i]
    offList = CONTEXT.horizOffBegin[firstScan - i]

    for itemIndex in range(0, len(onList)):
      if (scanKind & ScanKind.NoDropout) || !(scanKind & ScanKind.Smart):
        # not smart
        xStart = onList[itemIndex] - xOffset
        xStop = offList[itemIndex] - xOffset
      else:
        # smart
        xStart = onList[itemIndex][0] - xOffset
        xStop = offList[itemIndex][0] - xOffset

      if xStart < xStop:
        # A run in the positive direction
        for x in range(xStart, xStop):
          errCode |= SetBit(x, y)
      elif xStart > xStop:
        # A run in the negative direction
        for x in range(xStop, xStart):
          errCode |= SetBit(x, y)

      if errCode != SUCCESS:
        return errCode

    # Go to the next blittable row
    y++
  
  if !(scanKind & ScanKind.NoDropout):
    # Handle dropout
    errCode = FindDropouts(scanKind)
    if errCode != SUCCESS:
      return errCode
    
    if originalLoBand != CONTEXT.loScanBand:
      # Fast banding with dropout

      # Pull back to the overscan row
      y--
      # Pull back again to the low row
      y--

      # Blit Copy
      for x in range(0, width):
        if GetBit(x, CONTEXT.lastRowIndex):
          SetBit(x, y)

      if errCode != SUCCESS:
        return errCode

      # Save the index of the last row we've blitted
      CONTEXT.lastRowIndex = CONTEXT.loBitBand + 1

  return SUCCESS
```

```
FindDropouts(ScanKind scanKind):
  # Check for dropouts in horizontal lines
  height = CONTEXT.hiBitBand - CONTEXT.loBitBand
  initialY = CONTEXT.hiBitBand - CONTEXT.loScanBand - 1

  # Go backward through lines
  for index in range(0, height):
    onList = CONTEXT.horizOnBegin[initialY - index]
    offList = CONTEXT.horizOffBegin[initialY - index]

    for itemIndex in range(0, len(onList)):
      if onList[itemIndex] == offList[itemIndex]:
        # Zero length run
        errCode = PerformHorizDropout(onList[itemIndex], offList[itemIndex],
                     CONTEXT.hiBitBand - index - 1,
                     scanKind)
        if errCode != SUCCESS:
          return errCode
    
  # Check vertical lines
  width = CONTEXT.boxRight - CONTEXT.boxLeft
  
  for index in range(0, width):
    onList = CONTEXT.vertOnBegin[index]
    offList = CONTEXT.vertOnBegin[index]
    
    # Go from top to bottom
    for itemIndex in reversed(range(0, len(onList))):
      if onList[itemIndex] == offList[itemIndex]:
        # Zero length run
        errCode = PerformVertDropout(onList[itemIndex], offList[itemIndex],
                     CONTEXT.boxLeft + index, 
                     pchBitMap, scanKind);
        if errCode != SUCCESS:
          return errCode

  return SUCCESS
```
