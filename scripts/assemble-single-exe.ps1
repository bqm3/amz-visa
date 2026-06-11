$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$portableDir = Join-Path $root 'output\portable\AmzUS'
$bootstrapExe = Join-Path $root 'output\bootstrapper\AmzUSBootstrapper.exe'
$finalExe = Join-Path $root 'output\AmzUS.exe'
$payloadZip = Join-Path $env:TEMP ("amzus-payload-{0}.zip" -f ([Guid]::NewGuid().ToString('N')))

if (-not (Test-Path -LiteralPath $portableDir)) {
  throw "Portable app output not found: $portableDir"
}
if (-not (Test-Path -LiteralPath $bootstrapExe)) {
  throw "Bootstrapper binary not found: $bootstrapExe"
}

Write-Host 'Compressing the portable payload...'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
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

Remove-Item -LiteralPath $payloadZip -Force -ErrorAction SilentlyContinue

Write-Host "Single-file build created: $finalExe"
