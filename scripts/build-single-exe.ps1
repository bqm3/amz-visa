$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previousLocation = Get-Location
Push-Location $root

try {
$outputRoot = Join-Path $root 'output'
$portableDir = Join-Path $outputRoot 'portable\AmzUS'
$bootstrapDir = Join-Path $outputRoot 'bootstrapper'
$finalExe = Join-Path $outputRoot 'AmzUS.exe'
$bootstrapProject = Join-Path $root 'tools\bootstrapper\AmzBootstrapper.csproj'

foreach ($path in @($portableDir, $bootstrapDir, $finalExe)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

Write-Host 'Packaging NodeGUI app into a portable folder...'
npm run package:portable

if (-not (Test-Path -LiteralPath $portableDir)) {
  throw "Portable app output not found: $portableDir"
}

Copy-Item -LiteralPath (Join-Path $root 'main.js') -Destination $portableDir -Force
Copy-Item -LiteralPath (Join-Path $root 'node_modules\\@nodegui\\qode\\binaries\\qode.exe') -Destination $portableDir -Force

$sourceNodeModules = Join-Path $root 'node_modules'
$targetNodeModules = Join-Path $portableDir 'node_modules'
if (Test-Path -LiteralPath $targetNodeModules) {
  Remove-Item -LiteralPath $targetNodeModules -Recurse -Force -ErrorAction SilentlyContinue
}
Copy-Item -LiteralPath $sourceNodeModules -Destination $portableDir -Recurse -Force

Write-Host 'Publishing the Windows bootstrapper...'
dotnet publish $bootstrapProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $bootstrapDir

$bootstrapExe = Join-Path $bootstrapDir 'AmzUSBootstrapper.exe'
if (-not (Test-Path -LiteralPath $bootstrapExe)) {
  throw "Bootstrapper binary not found: $bootstrapExe"
}

Write-Host 'Compressing the portable payload...'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadZip = Join-Path $env:TEMP ("amzus-payload-{0}.zip" -f ([Guid]::NewGuid().ToString('N')))
$zipStream = [System.IO.File]::Open($payloadZip, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    $files = Get-ChildItem -LiteralPath $portableDir -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.FullName -notmatch '\\license-server(\\|$)' -and
        $_.FullName -notmatch '\\src\\data\\chrome-profiles(\\|$)'
      }

    foreach ($file in $files) {
      $relative = $file.FullName.Substring($portableDir.Length).TrimStart('\')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $file.FullName,
        $relative,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  }
  finally {
    $archive.Dispose()
  }
}
finally {
  $zipStream.Dispose()
}

Write-Host 'Creating the single-file executable...'
$bootstrapBytes = [System.IO.File]::ReadAllBytes($bootstrapExe)
$payloadBytes = [System.IO.File]::ReadAllBytes($payloadZip)
$magicBytes = [System.Text.Encoding]::ASCII.GetBytes('AMZPAYLD')
$lengthBytes = [System.BitConverter]::GetBytes([Int64]$payloadBytes.Length)

if (Test-Path -LiteralPath $finalExe) {
  Remove-Item -LiteralPath $finalExe -Force -ErrorAction SilentlyContinue
}

$stream = [System.IO.File]::Open($finalExe, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  $stream.Write($bootstrapBytes, 0, $bootstrapBytes.Length)
  $stream.Write($payloadBytes, 0, $payloadBytes.Length)
  $stream.Write($magicBytes, 0, $magicBytes.Length)
  $stream.Write($lengthBytes, 0, $lengthBytes.Length)
}
finally {
  $stream.Dispose()
}

if (Test-Path -LiteralPath $payloadZip) {
  Remove-Item -LiteralPath $payloadZip -Force -ErrorAction SilentlyContinue
}

Write-Host "Single-file build created: $finalExe"
}
finally {
  Pop-Location
  Set-Location $previousLocation
}
