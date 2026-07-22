[CmdletBinding()]
param(
  [ValidateSet("setup", "check", "run", "test", "package", "smoke")]
  [string]$Command = "check",
  [string]$ToolsRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeVersion = "24.18.0"
$NpmVersion = "11.16.0"
$GoVersion = "1.26.5"
$NodeDistName = "node-v$NodeVersion-win-x64"
$NodeZipName = "$NodeDistName.zip"
$GoZipName = "go$GoVersion.windows-amd64.zip"
$GoSha256 = "97e6b2a833b6d89f9ff17d25419ac0a7e3b482a044e9ab18cdef834bd834fd38"

function Resolve-ToolsRoot {
  if ($ToolsRoot) {
    New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
    return (Resolve-Path -LiteralPath $ToolsRoot).Path
  }
  if ($env:QUAL_HARDWARE_TOOLS_DIR) {
    New-Item -ItemType Directory -Force -Path $env:QUAL_HARDWARE_TOOLS_DIR | Out-Null
    return (Resolve-Path -LiteralPath $env:QUAL_HARDWARE_TOOLS_DIR).Path
  }
  $projectTools = Join-Path $ProjectRoot ".tools"
  if (Test-Path -LiteralPath $projectTools) { return (Resolve-Path -LiteralPath $projectTools).Path }
  if (Test-Path -LiteralPath "C:\dev\tools") { return "C:\dev\tools" }
  New-Item -ItemType Directory -Force -Path $projectTools | Out-Null
  return (Resolve-Path -LiteralPath $projectTools).Path
}

function Get-NodeHome([string]$Root) {
  if ($env:QUAL_HARDWARE_NODE_HOME) { return (Resolve-Path -LiteralPath $env:QUAL_HARDWARE_NODE_HOME).Path }
  return Join-Path $Root $NodeDistName
}

function Get-GoHome([string]$Root) {
  if ($env:QUAL_HARDWARE_GO_HOME) { return (Resolve-Path -LiteralPath $env:QUAL_HARDWARE_GO_HOME).Path }
  return Join-Path $Root "go-$GoVersion"
}

function Install-PortableNode([string]$Root) {
  $nodeHome = Get-NodeHome $Root
  $node = Join-Path $nodeHome "node.exe"
  if (Test-Path -LiteralPath $node) { return }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $zip = Join-Path $Root $NodeZipName
  $checksums = Join-Path $Root "node-$NodeVersion-SHASUMS256.txt"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $checksums
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$NodeZipName" -OutFile $zip
  $expected = Select-String -Path $checksums -Pattern (" " + [regex]::Escape($NodeZipName) + "$") |
    ForEach-Object { ($_ -split "\s+")[0] } | Select-Object -First 1
  if (-not $expected) { throw "Official Node SHA-256 was not found for $NodeZipName." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) { throw "Downloaded Node archive checksum mismatch." }
  Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
  if (-not (Test-Path -LiteralPath $node)) { throw "Portable Node extraction failed." }
}

function Install-PortableGo([string]$Root) {
  $goHome = Get-GoHome $Root
  $go = Join-Path $goHome "bin\go.exe"
  if (Test-Path -LiteralPath $go) { return }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $zip = Join-Path $Root $GoZipName
  Invoke-WebRequest -Uri "https://go.dev/dl/$GoZipName" -OutFile $zip
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($actual -ne $GoSha256) { throw "Downloaded Go archive checksum mismatch." }
  $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
  $staging = Join-Path $resolvedRoot (".go-{0}-staging-{1}" -f $GoVersion, [guid]::NewGuid().ToString("N"))
  $stagingParent = [IO.Path]::GetFullPath((Split-Path -Parent $staging)).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if ($stagingParent -ne $resolvedRoot) { throw "Unsafe Go staging path: $staging" }
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    Expand-Archive -LiteralPath $zip -DestinationPath $staging -Force
    Move-Item -LiteralPath (Join-Path $staging "go") -Destination $goHome
  } finally {
    $resolvedStaging = (Resolve-Path -LiteralPath $staging -ErrorAction SilentlyContinue).Path
    if ($resolvedStaging -and $resolvedStaging.StartsWith("$resolvedRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
  }
  if (-not (Test-Path -LiteralPath $go)) { throw "Portable Go extraction failed." }
}

function Get-Runtime([string]$Root) {
  Install-PortableNode $Root
  Install-PortableGo $Root
  $nodeHome = Get-NodeHome $Root
  $goHome = Get-GoHome $Root
  $node = Join-Path $nodeHome "node.exe"
  $npm = Join-Path $nodeHome "npm.cmd"
  $go = Join-Path $goHome "bin\go.exe"
  $actualNode = (& $node -v).TrimStart("v")
  $actualNpm = (& $npm -v)
  $actualGo = ((& $go version) -split " ")[2].TrimStart("go")
  if ($actualNode -ne $NodeVersion) { throw "Expected Node $NodeVersion, found $actualNode." }
  if ($actualNpm -ne $NpmVersion) { throw "Expected npm $NpmVersion, found $actualNpm." }
  if ($actualGo -ne $GoVersion) { throw "Expected Go $GoVersion, found $actualGo." }
  return @{ NodeHome=$nodeHome; Node=$node; Npm=$npm; GoHome=$goHome; Go=$go }
}

function Invoke-ProjectNpm($Runtime, [string[]]$Arguments) {
  Push-Location $ProjectRoot
  try {
    & $Runtime.Npm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "npm exited with $LASTEXITCODE" }
  } finally { Pop-Location }
}

function Invoke-DependencyGate($Runtime) {
  Invoke-ProjectNpm $Runtime @("ci")
  Invoke-ProjectNpm $Runtime @("ls", "--all")
  Invoke-ProjectNpm $Runtime @("audit", "--audit-level=low")
}

$runtime = Get-Runtime (Resolve-ToolsRoot)
$env:PATH = "$($runtime.NodeHome);$(Join-Path $runtime.GoHome 'bin');$env:PATH"

switch ($Command) {
  "setup" {
    Invoke-DependencyGate $runtime
    Write-Host "Node $NodeVersion, npm $NpmVersion and Go $GoVersion are ready."
  }
  "check" {
    Write-Host "Project: $ProjectRoot"
    Write-Host "Node: $((& $runtime.Node -v))"
    Write-Host "npm: $((& $runtime.Npm -v))"
    Write-Host "Go: $((& $runtime.Go version))"
  }
  "run" { Invoke-ProjectNpm $runtime @("run", "desktop:run") }
  "test" {
    Invoke-DependencyGate $runtime
    Invoke-ProjectNpm $runtime @("run", "audit:source")
    Invoke-ProjectNpm $runtime @("run", "calibration:assets:audit")
    Invoke-ProjectNpm $runtime @("run", "calibration:telemetry:test")
    Invoke-ProjectNpm $runtime @("run", "calibration:telemetry:verify")
    Invoke-ProjectNpm $runtime @("run", "typecheck")
    Invoke-ProjectNpm $runtime @("test")
  }
  "package" {
    Invoke-DependencyGate $runtime
    Invoke-ProjectNpm $runtime @("run", "desktop:package")
  }
  "smoke" { Invoke-ProjectNpm $runtime @("run", "desktop:smoke") }
}
