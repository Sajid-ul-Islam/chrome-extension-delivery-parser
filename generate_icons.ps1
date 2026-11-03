Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "icons/deen_logo.jpg"
$src = [System.Drawing.Bitmap]::FromFile($srcPath)

Write-Host "Source image loaded: $($src.Width)x$($src.Height)"

# 1. Generate authentic deen_logo.png (200x200 TRUE PNG)
$logoPngPath = Join-Path $PSScriptRoot "icons/deen_logo.png"
if (Test-Path $logoPngPath) { Remove-Item -Force $logoPngPath }
$bmp200 = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g200 = [System.Drawing.Graphics]::FromImage($bmp200)
$g200.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g200.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g200.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g200.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g200.DrawImage($src, 0, 0, $src.Width, $src.Height)
$g200.Dispose()
$bmp200.Save($logoPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp200.Dispose()
Write-Host "Generated $logoPngPath (true PNG)"

# 2. Generate standard icon sizes: 16, 32, 48, 128
$sizes = @(16, 32, 48, 128)
foreach ($size in $sizes) {
    $outPath = Join-Path $PSScriptRoot "icons/icon$size.png"
    if (Test-Path $outPath) { Remove-Item -Force $outPath }
    $dest = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    # Fill background with DEEN orange to avoid edge artifacts
    $orangeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 105, 0))
    $g.FillRectangle($orangeBrush, 0, 0, $size, $size)
    $orangeBrush.Dispose()

    # Draw scaled logo
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()

    $dest.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $dest.Dispose()
    Write-Host "Generated $outPath ($size x $size)"
}

$src.Dispose()
