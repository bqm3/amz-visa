$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previousLocation = Get-Location
Push-Location $root

function Remove-PathWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $oldEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    for ($attempt = 1; $attempt -le 10; $attempt++) {
      if (Test-Path -LiteralPath $Path -PathType Container) {
        $null = & cmd.exe /c "rmdir /s /q `"$Path`"" 2>$null
      }
      else {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
      }
      if (-not (Test-Path -LiteralPath $Path)) {
        return
      }
      if ($attempt -eq 3 -or $attempt -eq 6) {
        Get-Process -Name 'qode', 'AmzUS', 'AmzUSBootstrapper' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds (400 * $attempt)
    }
  }
  finally {
    $ErrorActionPreference = $oldEap
  }

  if (Test-Path -LiteralPath $Path) {
    Write-Warning "Could not completely remove path: $Path"
  }
}

function Copy-DirectoryWithRetry {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [Parameter(Mandatory = $true)]
    [string]$Destination
  )

  $oldEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $null = & cmd.exe /c "robocopy `"$Source`" `"$Destination`" /E /NDL /NFL /NJH /NJS /nc /ns /np" 2>$null
    if ($LASTEXITCODE -ge 8) {
      throw "Robocopy failed to copy $Source to $Destination with exit code $LASTEXITCODE"
    }
  }
  finally {
    $ErrorActionPreference = $oldEap
  }
}

try {
$outputRoot = Join-Path $root 'output'
$portableDir = Join-Path $outputRoot 'portable\AmzUS'
$bootstrapDir = Join-Path $outputRoot 'bootstrapper'
$finalExe = Join-Path $outputRoot 'AmzUS.exe'
$bootstrapProject = Join-Path $root 'tools\bootstrapper\AmzBootstrapper.csproj'

try {
  dotnet build-server shutdown | Out-Null
}
catch {
  Write-Warning "Unable to shutdown dotnet build servers before cleanup: $($_.Exception.Message)"
}

Get-Process -Name 'qode', 'AmzUS', 'AmzUSBootstrapper' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

foreach ($path in @($portableDir, $bootstrapDir, $finalExe)) {
  Remove-PathWithRetry -Path $path
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$requiredModuleFiles = @(
  'node_modules\@nodegui\nodegui\package.json',
  'node_modules\@nodegui\qode\binaries\qode.exe',
  'node_modules\memoize-one\package.json'
)

$missingModuleFiles = $requiredModuleFiles |
  Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) }

if ($missingModuleFiles.Count -gt 0) {
  Write-Host 'Installing npm dependencies because required runtime modules are missing...'
  npm install
}

foreach ($relativePath in $requiredModuleFiles) {
  $fullPath = Join-Path $root $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Required runtime file is missing after npm install: $fullPath"
  }
}

Write-Host 'Packaging NodeGUI app into a portable folder...'
npm run package:portable

if (-not (Test-Path -LiteralPath $portableDir)) {
  throw "Portable app output not found: $portableDir"
}

Copy-Item -LiteralPath (Join-Path $root 'main.js') -Destination $portableDir -Force
Copy-Item -LiteralPath (Join-Path $root 'node_modules\\@nodegui\\qode\\binaries\\qode.exe') -Destination $portableDir -Force

$sourceNodeModules = Join-Path $root 'node_modules'
$targetNodeModules = Join-Path $portableDir 'node_modules'

Write-Host 'Replacing portable node_modules with the installed dependency tree...'
Remove-PathWithRetry -Path $targetNodeModules
Copy-DirectoryWithRetry -Source $sourceNodeModules -Destination $targetNodeModules

foreach ($generatedDir in @(
  'output',
  'tools',
  'scripts',
  'node_modules\@nodegui\nodegui\miniqt'
)) {
  Remove-PathWithRetry -Path (Join-Path $portableDir $generatedDir)
}

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
    $files = Get-ChildItem -LiteralPath $portableDir -Recurse -File -Force -ErrorAction SilentlyContinue

    foreach ($file in $files) {
      $relative = $file.FullName.Substring($portableDir.Length).TrimStart('\')
      if (
        $relative -match '(^|\\)license-server(\\|$)' -or
        $relative -match '^src\\data\\chrome-profiles(\\|$)' -or
        $relative -match '^output(\\|$)' -or
        $relative -match '^tools(\\|$)' -or
        $relative -match '^scripts(\\|$)' -or
        $relative -match '^node_modules\\@nodegui\\nodegui\\miniqt(\\|$)'
      ) {
        continue
      }

      $zipRelative = $relative.Replace('\', '/')
      if (Test-Path -LiteralPath $file.FullName) {
        try {
          [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $file.FullName,
            $zipRelative,
            [System.IO.Compression.CompressionLevel]::NoCompression
          ) | Out-Null
        }
        catch {
          Write-Warning "Skipped file during zipping: $($file.FullName)"
        }
      }
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
