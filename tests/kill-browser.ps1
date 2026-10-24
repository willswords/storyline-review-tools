# Stop every Edge or Chrome process started with the given test profile folder (its name is passed as -Tag).
param([string]$Tag)
if (-not $Tag) { exit 0 }
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$Tag*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
