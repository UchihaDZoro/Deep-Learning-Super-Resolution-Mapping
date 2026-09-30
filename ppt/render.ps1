# Render every slide of a deck to PNG (and optionally export PDF) using PowerPoint.
param([string]$Deck, [string]$OutDir, [string]$Pdf = "")
New-Item -ItemType Directory -Force $OutDir | Out-Null
Get-ChildItem $OutDir -Filter "s*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
$app = New-Object -ComObject PowerPoint.Application
$p = $app.Presentations.Open($Deck, $true, $false, $false)
$i = 1
foreach ($s in $p.Slides) { $s.Export("$OutDir\s$i.png", "PNG", 1600, 900); $i++ }
if ($Pdf) { $p.SaveAs($Pdf, 32) }   # 32 = ppSaveAsPDF
$p.Close(); $app.Quit()
"rendered $($i - 1) slides"
