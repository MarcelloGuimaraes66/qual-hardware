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
$NodeDistName = "node-v$NodeVersion-win-x64"
$NodeZipName = "$NodeDistName.zip"
$NodeBaseUrl = "https://nodejs.org/dist/v$NodeVersion"

function Resolve-ToolsRoot {
  $nodeHomeOverride = $env:QUAL_HARDWARE_NODE_HOME
  if ($nodeHomeOverride) {
    $nodeExecutable = Join-Path $nodeHomeOverride "node.exe"
    if (-not (Test-Path -LiteralPath $nodeExecutable)) {
      throw "QUAL_HARDWARE_NODE_HOME does not contain node.exe: $nodeHomeOverride"
    }
    return (Split-Path -Parent (Resolve-Path -LiteralPath $nodeExecutable).Path)
  }
  if ($ToolsRoot) {
    if (-not (Test-Path -LiteralPath $ToolsRoot)) { New-Item -ItemType Directory -Path $ToolsRoot | Out-Null }
    return (Resolve-Path -LiteralPath $ToolsRoot).Path
  }
  $override = $env:QUAL_HARDWARE_TOOLS_DIR
  if ($override) {
    if (-not (Test-Path -LiteralPath $override)) { New-Item -ItemType Directory -Path $override | Out-Null }
    return (Resolve-Path -LiteralPath $override).Path
  }
  $projectTools = Join-Path $ProjectRoot ".tools"
  if (Test-Path -LiteralPath $projectTools) { return (Resolve-Path -LiteralPath $projectTools).Path }
  $sharedTools = "C:\dev\tools"
  if (Test-Path -LiteralPath $sharedTools) { return (Resolve-Path -LiteralPath $sharedTools).Path }
  New-Item -ItemType Directory -Path $projectTools | Out-Null
  return (Resolve-Path -LiteralPath $projectTools).Path
}

function Get-NodeHome([string]$Root) {
  if ($env:QUAL_HARDWARE_NODE_HOME) {
    return (Resolve-Path -LiteralPath $env:QUAL_HARDWARE_NODE_HOME).Path
  }
  return Join-Path $Root $NodeDistName
}

function Get-NodeExe([string]$Root) {
  return Join-Path (Get-NodeHome $Root) "node.exe"
}

function Get-NpmCmd([string]$Root) {
  return Join-Path (Get-NodeHome $Root) "npm.cmd"
}

function Assert-Version([string]$Actual, [string]$Expected, [string]$Name) {
  if ($Actual -ne $Expected) {
    throw "$Name version mismatch. Expected $Expected but found $Actual."
  }
}

function Install-PortableNode([string]$Root) {
  $nodeExe = Get-NodeExe $Root
  if (Test-Path -LiteralPath $nodeExe) { return }

  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $zipPath = Join-Path $Root $NodeZipName
  $shaPath = Join-Path $Root "SHASUMS256.txt"
  $zipUrl = "$NodeBaseUrl/$NodeZipName"
  $shaUrl = "$NodeBaseUrl/SHASUMS256.txt"

  Invoke-WebRequest -Uri $shaUrl -OutFile $shaPath
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

  $expected = Select-String -Path $shaPath -Pattern (" " + [regex]::Escape($NodeZipName) + "$") | ForEach-Object {
    ($_ -split "\s+")[0]
  } | Select-Object -First 1
  if (-not $expected) { throw "Unable to find official SHA-256 for $NodeZipName." }

  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) {
    throw "Downloaded Node archive checksum mismatch."
  }

  Expand-Archive -LiteralPath $zipPath -DestinationPath $Root -Force
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    throw "Portable Node extraction did not produce $nodeExe."
  }
}

function Get-Runtime([string]$Root) {
  Install-PortableNode $Root
  $nodeExe = Get-NodeExe $Root
  $npmCmd = Get-NpmCmd $Root
  $actualNode = (& $nodeExe -v).TrimStart("v")
  $actualNpm = (& $npmCmd -v)
  Assert-Version $actualNode $NodeVersion "Node.js"
  Assert-Version $actualNpm $NpmVersion "npm"
  return @{
    Root = $Root
    NodeExe = $nodeExe
    NpmCmd = $npmCmd
  }
}

function Invoke-ProjectNpm($Runtime, [string[]]$Arguments) {
  Push-Location $ProjectRoot
  try {
    & $Runtime.NpmCmd @Arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
}

function Invoke-DependencyGate($Runtime) {
  Invoke-ProjectNpm $Runtime @("ci")
  Invoke-ProjectNpm $Runtime @("ls", "--all")
  Invoke-ProjectNpm $Runtime @("audit", "--audit-level=low")
}

$resolvedToolsRoot = Resolve-ToolsRoot
$runtime = Get-Runtime $resolvedToolsRoot
$env:PATH = "$(Split-Path -Parent $runtime.NodeExe);$env:PATH"

switch ($Command) {
  "setup" {
    Invoke-DependencyGate $runtime
    Write-Host "Node.js $NodeVersion and npm $NpmVersion are ready at $($runtime.Root)"
  }
  "check" {
    Write-Host "Project root: $ProjectRoot"
    Write-Host "Tools root: $($runtime.Root)"
    Write-Host "Node: $((& $runtime.NodeExe -v))"
    Write-Host "npm: $((& $runtime.NpmCmd -v))"
  }
  "run" {
    Invoke-ProjectNpm $runtime @("run", "desktop:run")
  }
  "test" {
    Invoke-DependencyGate $runtime
    Invoke-ProjectNpm $runtime @("run", "typecheck")
    Invoke-ProjectNpm $runtime @("test")
  }
  "package" {
    Invoke-DependencyGate $runtime
    Invoke-ProjectNpm $runtime @("run", "desktop:package")
  }
  "smoke" {
    Invoke-ProjectNpm $runtime @("run", "desktop:smoke")
  }
}
