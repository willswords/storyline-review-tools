# Builds storyline-review-tools.zip for the Chrome Web Store and Edge Add-ons: only the files the extension runs
# (manifest.json, src/, sidepanel/, icons/) and LICENSE. Never the tests, their course links and screenshots, the
# store images, or .git. The zip isn't kept in git (see .gitignore).
# Usage, from this folder:  powershell -ExecutionPolicy Bypass -File pack.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = $PSScriptRoot
$out = Join-Path $root 'storyline-review-tools.zip'

$files = @('manifest.json', 'LICENSE')
foreach ($dir in 'src', 'sidepanel', 'icons') {
  $files += Get-ChildItem -Path (Join-Path $root $dir) -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1) }
}

# Every file the manifest names must be in the package
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$named = @($manifest.background.service_worker, $manifest.side_panel.default_path) +
  @($manifest.content_scripts | ForEach-Object { $_.js }) + @($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })
$have = $files | ForEach-Object { $_ -replace '\\', '/' }
$missing = $named | Where-Object { $have -notcontains $_ }
if ($missing) { throw "Files named in manifest.json are missing: $($missing -join ', ')" }

# Zip paths use forward slashes (the stores reject backslashes, which PowerShell 5's Compress-Archive writes)
if (Test-Path $out) { Remove-Item $out }
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  foreach ($f in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), ($f -replace '\\', '/'), 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }

Write-Host "Built storyline-review-tools.zip: version $($manifest.version), $($files.Count) files, $([math]::Round((Get-Item $out).Length / 1KB)) KB"
$files | ForEach-Object { Write-Host "  $($_ -replace '\\', '/')" }
