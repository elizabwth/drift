Add-Type -AssemblyName System.Drawing

function Draw-DriftIcon {
    param([System.Drawing.Graphics]$g, [double]$scale)

    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.ScaleTransform($scale, $scale)

    # --- rounded-square background, night sky gradient ---
    $rect = New-Object System.Drawing.Rectangle 0,0,256,256
    $radius = 48
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0,0,$d,$d,180,90)
    $path.AddArc(256-$d,0,$d,$d,270,90)
    $path.AddArc(256-$d,256-$d,$d,$d,0,90)
    $path.AddArc(0,256-$d,$d,$d,90,90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point 0,0),
        (New-Object System.Drawing.Point 0,256),
        [System.Drawing.Color]::FromArgb(255,10,20,38),
        [System.Drawing.Color]::FromArgb(255,26,48,82)
    )
    $g.SetClip($path)
    $g.FillPath($bgBrush, $path)

    # --- stars / snow specks in the sky ---
    $stars = @(
        @(58,46,2.2,190), @(196,38,2.8,160), @(142,72,1.6,210),
        @(214,86,2.0,140), @(36,96,1.6,150), @(168,44,1.4,170),
        @(96,60,1.3,130)
    )
    foreach ($s in $stars) {
        $sx=$s[0]; $sy=$s[1]; $sr=$s[2]; $sa=$s[3]
        $starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($sa,255,255,255))
        $g.FillEllipse($starBrush, $sx-$sr, $sy-$sr, $sr*2, $sr*2)
        $starBrush.Dispose()
    }

    # --- back dune (soft, muted) ---
    $back = New-Object System.Drawing.Drawing2D.GraphicsPath
    $backPts = @(
        (New-Object System.Drawing.PointF 0,196),
        (New-Object System.Drawing.PointF 46,168),
        (New-Object System.Drawing.PointF 108,182),
        (New-Object System.Drawing.PointF 158,152),
        (New-Object System.Drawing.PointF 208,172),
        (New-Object System.Drawing.PointF 256,182)
    )
    $back.AddCurve([System.Drawing.PointF[]]$backPts, 0.5)
    $back.AddLine(256,182,256,256)
    $back.AddLine(256,256,0,256)
    $back.CloseFigure()
    $backBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(215,196,214,235))
    $g.FillPath($backBrush, $back)

    # --- front dune (bright, windswept peak left-of-center) ---
    $front = New-Object System.Drawing.Drawing2D.GraphicsPath
    $frontPts = @(
        (New-Object System.Drawing.PointF 0,230),
        (New-Object System.Drawing.PointF 38,207),
        (New-Object System.Drawing.PointF 82,146),
        (New-Object System.Drawing.PointF 122,180),
        (New-Object System.Drawing.PointF 172,204),
        (New-Object System.Drawing.PointF 222,192),
        (New-Object System.Drawing.PointF 256,208)
    )
    $front.AddCurve([System.Drawing.PointF[]]$frontPts, 0.5)
    $front.AddLine(256,208,256,256)
    $front.AddLine(256,256,0,256)
    $front.CloseFigure()
    $frontBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,240,247,253))
    $g.FillPath($frontBrush, $front)

    # thin cool-shadow edge under the front dune's overhang for depth
    $shadowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60,120,150,190), 3)
    $g.DrawCurve($shadowPen, [System.Drawing.PointF[]]$frontPts, 0.5)

    $path.Dispose(); $back.Dispose(); $front.Dispose()
    $bgBrush.Dispose(); $backBrush.Dispose(); $frontBrush.Dispose(); $shadowPen.Dispose()
}

function New-DriftBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    Draw-DriftIcon -g $g -scale ($size / 256.0)
    $g.Dispose()
    return $bmp
}

$outDir = "E:\code\drift\electron-overlay\build"

# preview + runtime PNG
$preview = New-DriftBitmap 256
$preview.Save("$outDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()

$icon512 = New-DriftBitmap 512
$icon512.Save("$outDir\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$icon512.Dispose()

# multi-res ICO
$sizes = @(16,24,32,48,64,128,256)
$streams = @()
foreach ($s in $sizes) {
    $bmp = New-DriftBitmap $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $streams += ,$ms
    $bmp.Dispose()
}

$icoPath = "$outDir\icon.ico"
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)

$bw.Write([UInt16]0)      # reserved
$bw.Write([UInt16]1)      # type: icon
$bw.Write([UInt16]$sizes.Count)

$headerSize = 6 + (16 * $sizes.Count)
$offset = $headerSize
for ($i=0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $len = $streams[$i].Length
    $wByte = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([Byte]$wByte)      # width
    $bw.Write([Byte]$wByte)      # height
    $bw.Write([Byte]0)           # color count
    $bw.Write([Byte]0)           # reserved
    $bw.Write([UInt16]1)         # planes
    $bw.Write([UInt16]32)        # bit count
    $bw.Write([UInt32]$len)      # bytes in resource
    $bw.Write([UInt32]$offset)   # offset
    $offset += $len
}
for ($i=0; $i -lt $sizes.Count; $i++) {
    $bytes = $streams[$i].ToArray()
    $bw.Write($bytes)
    $streams[$i].Dispose()
}

$bw.Flush(); $bw.Close(); $fs.Close()

Write-Output "Wrote $icoPath and $outDir\icon.png ($($sizes.Count) sizes embedded)"
