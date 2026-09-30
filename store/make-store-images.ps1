# Builds the Google Play graphics from the app's icon art and raw phone screenshots.
#   powershell -ExecutionPolicy Bypass -File store\make-store-images.ps1
# Inputs:  store\raw\home.png, send.png, receive.png  (adb exec-out screencap -p > store\raw\home.png)
# Outputs: store\play\icon-512.png, feature-graphic.png, screenshots\0N-*.png
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'play'
New-Item -ItemType Directory -Force (Join-Path $out 'screenshots') | Out-Null

function C($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }
function P($x, $y) { New-Object System.Drawing.PointF $x, $y }

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (P 0 0), (P $w $h), (C '#1C2542'), (C '#0B0F1A')
  $g.FillRectangle($bg, 0, 0, $w, $h)
  return @($bmp, $g)
}

# The launcher icon's foreground (same geometry as res/drawable/ic_launcher_foreground.xml),
# drawn so that the 108-unit canvas region [18, 90] fills a $size square at ($x, $y).
function Draw-Art($g, $x, $y, $size) {
  $state = $g.Save()
  $s = $size / 72
  $g.TranslateTransform([single]$x, [single]$y); $g.ScaleTransform([single]$s, [single]$s); $g.TranslateTransform(-18, -18)
  $arc = New-Object System.Drawing.Drawing2D.LinearGradientBrush (P 34 0), (P 74 0), (C '#4F7CFF'), (C '#22C58B')
  $pen = New-Object System.Drawing.Pen $arc, 5; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawBezier($pen, 34, 70, 47.33, 43.33, 60.67, 43.33, 74, 70)
  $green = New-Object System.Drawing.Pen (C '#22C58B'), 5
  $green.StartCap = 'Round'; $green.EndCap = 'Round'; $green.LineJoin = 'Round'
  $g.DrawLines($green, [System.Drawing.PointF[]]@((P 76.1 61.3), (P 74 70), (P 65.7 66.4)))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (C '#4F7CFF')), 30, 66, 8, 8)
  $doc = New-Object System.Drawing.Drawing2D.GraphicsPath
  $doc.AddLine(48.5, 24, 57, 24); $doc.AddLine(57, 24, 63, 30); $doc.AddLine(63, 30, 63, 42.5)
  $doc.AddArc(58, 40, 5, 5, 0, 90); $doc.AddLine(60.5, 45, 48.5, 45); $doc.AddArc(46, 40, 5, 5, 90, 90)
  $doc.AddLine(46, 42.5, 46, 26.5); $doc.AddArc(46, 24, 5, 5, 180, 90); $doc.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush (C '#F4F6FB')), $doc)
  $fold = New-Object System.Drawing.Drawing2D.GraphicsPath
  $fold.AddLine(57, 24, 57, 28); $fold.AddArc(57, 26, 4, 4, 180, -90); $fold.AddLine(59, 30, 63, 30); $fold.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush (C '#B8C2D9')), $fold)
  $lines = New-Object System.Drawing.Pen (C '#8C96AD'), 1.8; $lines.StartCap = 'Round'; $lines.EndCap = 'Round'
  $g.DrawLine($lines, 50, 35, 58.5, 35); $g.DrawLine($lines, 50, 39.5, 55.5, 39.5)
  $g.Restore($state)
}

function Save-Png($bmp, $g, $path) { $g.Dispose(); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose() }

function Rounded($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

# ---- 512x512 app icon (Play applies its own rounded mask; no transparency allowed)
$c = New-Canvas 512 512; Draw-Art $c[1] 0 0 512
Save-Png $c[0] $c[1] (Join-Path $out 'icon-512.png')

# ---- 1024x500 feature graphic
$c = New-Canvas 1024 500; $g = $c[1]
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath; $glow.AddEllipse(-40, 10, 520, 520)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(70, 79, 124, 255); $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 11, 15, 26))
$g.FillPath($pgb, $glow)
Draw-Art $g 40 40 420
$title = New-Object System.Drawing.Font 'Segoe UI', 84, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sub = New-Object System.Drawing.Font 'Segoe UI', 34, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('FileHop', $title, (New-Object System.Drawing.SolidBrush (C '#F4F6FB')), 480, 130)
$g.DrawString("Send any file to a nearby phone.`nNo internet. No size limit.", $sub, (New-Object System.Drawing.SolidBrush (C '#B8C2D9')), 486, 250)
Save-Png $c[0] $g (Join-Path $out 'feature-graphic.png')

# ---- 1080x1920 phone screenshots: caption on top, the real screen rising from the bottom
$shots = @(
  @{ file = 'home.png';    caption = "Share any file`nwithout internet" },
  @{ file = 'send.png';    caption = "Pick files, tap a`nnearby phone" },
  @{ file = 'receive.png'; caption = "Receive with`none tap" }
)
$capFont = New-Object System.Drawing.Font 'Segoe UI', 76, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'
$i = 0
foreach ($s in $shots) {
  $src = Join-Path $root "raw\$($s.file)"
  if (-not (Test-Path $src)) { Write-Warning "missing $src"; continue }
  $i++
  $shot = [System.Drawing.Image]::FromFile($src)
  $c = New-Canvas 1080 1920; $g = $c[1]
  $g.DrawString($s.caption, $capFont, (New-Object System.Drawing.SolidBrush (C '#F4F6FB')), (New-Object System.Drawing.RectangleF 40, 90, 1000, 260), $fmt)
  # Drop the status bar, keep the app's own look; the bottom runs off the canvas.
  $cropTop = [int]($shot.Height * 0.045)
  $srcRect = New-Object System.Drawing.RectangleF 0, $cropTop, $shot.Width, ($shot.Height - $cropTop)
  $w = 860; $x = (1080 - $w) / 2; $y = 400; $h = $w * $srcRect.Height / $srcRect.Width
  $frame = Rounded ($x - 14) ($y - 14) ($w + 28) ($h + 28) 64
  $g.FillPath((New-Object System.Drawing.SolidBrush (C '#27314A')), $frame)
  $clip = Rounded $x $y $w $h 52
  $g.SetClip($clip)
  $g.DrawImage($shot, (New-Object System.Drawing.RectangleF $x, $y, $w, $h), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()
  $shot.Dispose()
  $name = '{0:D2}-{1}' -f $i, $s.file
  Save-Png $c[0] $g (Join-Path $out "screenshots\$name")
}
Write-Output "Wrote $out"
