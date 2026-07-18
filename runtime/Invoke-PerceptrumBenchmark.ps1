[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ManifestPath,
    [Parameter(Mandatory = $true)] [string] $PerceptrumExePath,
    [string[]] $PerceptrumArguments = @(),
    [string] $ReplayControllerScript = "",
    [ValidateRange(1, 60)] [int] $SampleIntervalSeconds = 5,
    [ValidateRange(0.001, 1.0)] [double] $DurationScale = 1.0,
    [switch] $DoNotUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Percentile {
    param([double[]] $Values, [double] $Percentile)
    if ($Values.Count -eq 0) { return 0.0 }
    $ordered = @($Values | Sort-Object)
    $index = [Math]::Min($ordered.Count - 1, [Math]::Max(0, [Math]::Ceiling($Percentile * $ordered.Count) - 1))
    return [double]$ordered[$index]
}

function Get-QueueGrowthPerMinute {
    param([double[]] $Values, [double] $ElapsedSeconds)
    if ($Values.Count -lt 2 -or $ElapsedSeconds -le 0) { return 0.0 }
    return ([double]$Values[-1] - [double]$Values[0]) / ($ElapsedSeconds / 60.0)
}

function Get-ProcessTreeIds {
    param([int] $RootProcessId)
    $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $known = [Collections.Generic.HashSet[int]]::new()
    [void]$known.Add($RootProcessId)
    do {
        $changed = $false
        foreach ($row in $rows) {
            if ($known.Contains([int]$row.ParentProcessId) -and $known.Add([int]$row.ProcessId)) { $changed = $true }
        }
    } while ($changed)
    return @($known)
}

function Get-TreeSample {
    param([int] $RootProcessId)
    $ids = @(Get-ProcessTreeIds -RootProcessId $RootProcessId)
    $workingSet = [uint64]0; $privateBytes = [uint64]0; $handles = 0; $threads = 0; $cpuSeconds = 0.0; $processCount = 0
    foreach ($id in $ids) {
        try {
            $process = Get-Process -Id $id -ErrorAction Stop
            $workingSet += [uint64]$process.WorkingSet64
            $privateBytes += [uint64]$process.PrivateMemorySize64
            $handles += [int]$process.HandleCount
            $threads += @($process.Threads).Count
            $cpuSeconds += [double]($process.CPU ?? 0.0)
            $processCount += 1
        } catch { }
    }
    return [pscustomobject]@{ WorkingSet = $workingSet; PrivateBytes = $privateBytes; Handles = $handles; Threads = $threads; CpuSeconds = $cpuSeconds; ProcessCount = $processCount }
}

function Get-GpuSample {
    $command = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        try {
            $controllers = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch "Microsoft Basic|Remote Display" })
            $counter = Get-Counter -Counter "\GPU Engine(*)\Utilization Percentage", "\GPU Adapter Memory(*)\Dedicated Usage" -MaxSamples 1
            $engineSamples = @($counter.CounterSamples | Where-Object { $_.Path -like "*GPU Engine*" })
            $decodeSamples = @($engineSamples | Where-Object { $_.InstanceName -match "engtype_VideoDecode" })
            $computeSamples = @($engineSamples | Where-Object { $_.InstanceName -notmatch "engtype_VideoDecode" })
            $memorySamples = @($counter.CounterSamples | Where-Object { $_.Path -like "*GPU Adapter Memory*" })
            $utilization = [Math]::Min(100.0, [double](($computeSamples | Measure-Object CookedValue -Sum).Sum ?? 0))
            $decoder = [Math]::Min(100.0, [double](($decodeSamples | Measure-Object CookedValue -Sum).Sum ?? 0))
            $vram = [uint64](($memorySamples | Measure-Object CookedValue -Sum).Sum ?? 0)
            return [pscustomobject]@{
                Available = $controllers.Count -gt 0 -and $engineSamples.Count -gt 0
                Name = (@($controllers | Select-Object -ExpandProperty Name -Unique) -join " + ")
                Driver = (@($controllers | Select-Object -ExpandProperty DriverVersion -Unique) -join " + ")
                Utilization = $utilization; Decoder = $decoder; VramBytes = $vram
            }
        } catch {
            return [pscustomobject]@{ Available = $false; Name = ""; Driver = ""; Utilization = 0.0; Decoder = 0.0; VramBytes = [uint64]0 }
        }
    }
    try {
        $lines = @(& $command.Source --query-gpu=name,driver_version,utilization.gpu,utilization.decoder,memory.used --format=csv,noheader,nounits 2>$null)
        if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) { throw "nvidia-smi query failed" }
        $names = [Collections.Generic.HashSet[string]]::new(); $drivers = [Collections.Generic.HashSet[string]]::new()
        $utilization = 0.0; $decoder = 0.0; $vramMib = 0.0
        foreach ($line in $lines) {
            $parts = @($line -split ',' | ForEach-Object { $_.Trim() })
            if ($parts.Count -lt 5) { continue }
            [void]$names.Add($parts[0]); [void]$drivers.Add($parts[1])
            $utilization = [Math]::Max($utilization, [double]$parts[2]); $decoder = [Math]::Max($decoder, [double]$parts[3]); $vramMib += [double]$parts[4]
        }
        return [pscustomobject]@{ Available = $true; Name = (@($names) -join " + "); Driver = (@($drivers) -join " + "); Utilization = $utilization; Decoder = $decoder; VramBytes = [uint64]($vramMib * 1MB) }
    } catch {
        return [pscustomobject]@{ Available = $false; Name = ""; Driver = ""; Utilization = 0.0; Decoder = 0.0; VramBytes = [uint64]0 }
    }
}

$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$resolvedExecutable = (Resolve-Path -LiteralPath $PerceptrumExePath).Path
$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json -Depth 64
if ($manifest.schemaVersion -ne "capacity-benchmark-manifest/1.0.0") { throw "Unsupported benchmark manifest schema." }
if ($manifest.privacy.acceptMedia -ne $false -or $manifest.privacy.acceptRtspCredentials -ne $false -or $manifest.privacy.aggregateMetricsOnly -ne $true) { throw "Manifest privacy contract is invalid." }
if ([DateTimeOffset]::Parse($manifest.expiresAt) -le [DateTimeOffset]::UtcNow) { throw "Benchmark manifest has expired." }
if ([string]::IsNullOrWhiteSpace([string]$manifest.nonce) -or [string]::IsNullOrWhiteSpace([string]$manifest.uploadUrl)) { throw "Manifest challenge is incomplete." }

$benchmarkDirectory = Join-Path ([IO.Path]::GetTempPath()) ("qual-hardware-benchmark-" + [Guid]::NewGuid().ToString("N"))
[void](New-Item -ItemType Directory -Path $benchmarkDirectory)
$activityLog = Join-Path $benchmarkDirectory "system-activity.jsonl"
$phaseControl = Join-Path $benchmarkDirectory "phase-control.json"

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $resolvedExecutable
$startInfo.WorkingDirectory = $benchmarkDirectory
$startInfo.UseShellExecute = $false
foreach ($argument in $PerceptrumArguments) { [void]$startInfo.ArgumentList.Add($argument) }
$startInfo.Environment["PERCEPTRUM_BENCHMARK_MODE"] = "1"
$startInfo.Environment["PERCEPTRUM_BENCHMARK_MANIFEST_ID"] = [string]$manifest.id
$startInfo.Environment["PERCEPTRUM_BENCHMARK_PHASE_CONTROL"] = $phaseControl
$startInfo.Environment["SYSTEM_ACTIVITY_LOG_PATH"] = $activityLog

$allCpu = [Collections.Generic.List[double]]::new(); $allRam = [Collections.Generic.List[double]]::new()
$allGpu = [Collections.Generic.List[double]]::new(); $allVram = [Collections.Generic.List[double]]::new(); $allDecoder = [Collections.Generic.List[double]]::new()
$allDiskWrite = [Collections.Generic.List[double]]::new(); $allNetwork = [Collections.Generic.List[double]]::new()
$allCaptureLatency = [Collections.Generic.List[double]]::new(); $allDecodeLatency = [Collections.Generic.List[double]]::new(); $allInferenceLatency = [Collections.Generic.List[double]]::new()
$allQueues = [Collections.Generic.List[double]]::new(); $phaseResults = [Collections.Generic.List[object]]::new()
$peakHandles = 0; $peakThreads = 0; $peakProcesses = 1; $activityLinesRead = 0; $oomCount = 0
$firstInferenceSuccess = $null; $firstInferenceError = $null; $lastInferenceSuccess = 0.0; $lastInferenceError = 0.0
$gpuName = ""; $gpuDriver = ""; $gpuTelemetryAvailable = $false
$startedAt = [DateTimeOffset]::UtcNow
$process = $null

try {
    $process = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) { throw "Perceptrum process could not be started." }
    $previousCpuSeconds = 0.0; $previousSampleAt = [DateTimeOffset]::UtcNow

    foreach ($phase in $manifest.phases) {
        $controllerOk = $false
        if (-not [string]::IsNullOrWhiteSpace($ReplayControllerScript)) {
            $resolvedController = (Resolve-Path -LiteralPath $ReplayControllerScript).Path
            & $resolvedController -ManifestPath $resolvedManifest -Phase ([string]$phase.name) -LoadPercent ([int]$phase.loadPercent) -ControlPath $phaseControl
            $controllerOk = $LASTEXITCODE -eq 0
        }
        @{ manifestId = $manifest.id; phase = $phase.name; requestedLoadPercent = $phase.loadPercent; changedAt = [DateTimeOffset]::UtcNow.ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $phaseControl -Encoding UTF8
        $actualLoadPercent = if ($controllerOk) { [double]$phase.loadPercent } else { 1.0 }
        $phaseInference = [Collections.Generic.List[double]]::new(); $phaseQueues = [Collections.Generic.List[double]]::new()
        $phaseStopwatch = [Diagnostics.Stopwatch]::StartNew()
        $targetSeconds = [Math]::Max(1.0, [double]$phase.durationSeconds * $DurationScale)

        while ($phaseStopwatch.Elapsed.TotalSeconds -lt $targetSeconds) {
            $process.Refresh()
            if ($process.HasExited) { $oomCount += 1; break }
            $now = [DateTimeOffset]::UtcNow; $tree = Get-TreeSample -RootProcessId $process.Id
            $elapsedCpuSeconds = ($now - $previousSampleAt).TotalSeconds
            $cpuPercent = if ($elapsedCpuSeconds -gt 0 -and $previousCpuSeconds -gt 0) { [Math]::Min(100.0, (($tree.CpuSeconds - $previousCpuSeconds) / ($elapsedCpuSeconds * [Environment]::ProcessorCount)) * 100.0) } else { 0.0 }
            $previousCpuSeconds = $tree.CpuSeconds; $previousSampleAt = $now
            $allCpu.Add($cpuPercent); $allRam.Add([double]$tree.PrivateBytes)
            $peakHandles = [Math]::Max($peakHandles, $tree.Handles); $peakThreads = [Math]::Max($peakThreads, $tree.Threads); $peakProcesses = [Math]::Max($peakProcesses, $tree.ProcessCount)

            $gpu = Get-GpuSample
            if ($gpu.Available) { $gpuTelemetryAvailable = $true; $gpuName = $gpu.Name; $gpuDriver = $gpu.Driver }
            $allGpu.Add([double]$gpu.Utilization); $allDecoder.Add([double]$gpu.Decoder); $allVram.Add([double]$gpu.VramBytes)

            if (Test-Path -LiteralPath $activityLog) {
                $lines = @(Get-Content -LiteralPath $activityLog | Select-Object -Skip $activityLinesRead)
                $activityLinesRead += $lines.Count
                foreach ($line in $lines) {
                    try {
                        $entry = $line | ConvertFrom-Json -Depth 64; $snapshot = $entry.snapshot
                        $allDiskWrite.Add([double]($snapshot.host.disk_write_bytes_per_sec ?? 0)); $allNetwork.Add([double]($snapshot.host.net_rx_bytes_per_sec ?? 0))
                        $success = 0.0; $errors = 0.0
                        foreach ($camera in @($snapshot.cameras)) {
                            $capture = [double]($camera.capture_read_latency_ms ?? 0); $decode = [double]($camera.decode_latency_ms ?? 0); $inference = [double]($camera.inference_latency_ms ?? 0); $queue = [double]($camera.queue_depth ?? 0)
                            $allCaptureLatency.Add($capture); $allDecodeLatency.Add($decode); $allInferenceLatency.Add($inference); $allQueues.Add($queue); $phaseInference.Add($inference); $phaseQueues.Add($queue)
                            $success += [double]($camera.inference_success_count ?? 0); $errors += [double]($camera.inference_error_count ?? 0)
                        }
                        if ($null -eq $firstInferenceSuccess) { $firstInferenceSuccess = $success; $firstInferenceError = $errors }
                        $lastInferenceSuccess = $success; $lastInferenceError = $errors
                    } catch { }
                }
            }
            Start-Sleep -Seconds $SampleIntervalSeconds
        }
        $phaseStopwatch.Stop()
        $phaseResults.Add([ordered]@{
            name = [string]$phase.name; durationSeconds = [int][Math]::Floor($phaseStopwatch.Elapsed.TotalSeconds)
            loadPercent = $actualLoadPercent; p95InferenceLatencyMs = Get-Percentile -Values @($phaseInference) -Percentile 0.95
            maxQueueDepth = [int](if ($phaseQueues.Count) { ($phaseQueues | Measure-Object -Maximum).Maximum } else { 0 })
            queueGrowthPerMinute = Get-QueueGrowthPerMinute -Values @($phaseQueues) -ElapsedSeconds $phaseStopwatch.Elapsed.TotalSeconds
            outOfMemoryCount = $oomCount
        })
        if ($oomCount -gt 0) { break }
    }
} finally {
    if ($null -ne $process -and -not $process.HasExited) {
        [void]$process.CloseMainWindow()
        if (-not $process.WaitForExit(30000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
}

$completedAt = [DateTimeOffset]::UtcNow
foreach ($requiredPhase in $manifest.phases) {
    if (-not (@($phaseResults | Where-Object { $_.name -eq $requiredPhase.name }).Count)) {
        $phaseResults.Add([ordered]@{
            name = [string]$requiredPhase.name; durationSeconds = 1; loadPercent = 1.0
            p95InferenceLatencyMs = 0.0; maxQueueDepth = 0; queueGrowthPerMinute = 0.0; outOfMemoryCount = [Math]::Max(1, $oomCount)
        })
    }
}
$successDelta = [Math]::Max(0.0, $lastInferenceSuccess - [double]($firstInferenceSuccess ?? 0))
$errorDelta = [Math]::Max(0.0, $lastInferenceError - [double]($firstInferenceError ?? 0))
$metrics = [ordered]@{
    cpuModel = (@(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name -Unique) -join " + ")
    gpuModel = if ($gpuName) { $gpuName } else { [string]$manifest.targetHardware.gpuModel }
    gpuDriver = if ($gpuDriver) { $gpuDriver } else { "unavailable" }
    perceptrumBuildHash = [string]$manifest.perceptrumBuildHash; workloadContractVersion = [string]$manifest.workloadContractVersion
    startedAt = $startedAt.ToString("o"); completedAt = $completedAt.ToString("o")
    p95InferenceLatencyMs = Get-Percentile -Values @($allInferenceLatency) -Percentile 0.95
    p99InferenceLatencyMs = Get-Percentile -Values @($allInferenceLatency) -Percentile 0.99
    peakCpuPercent = [double](if ($allCpu.Count) { ($allCpu | Measure-Object -Maximum).Maximum } else { 0 })
    peakRamBytes = [uint64](if ($allRam.Count) { ($allRam | Measure-Object -Maximum).Maximum } else { 0 })
    peakGpuPercent = [double](if ($allGpu.Count) { ($allGpu | Measure-Object -Maximum).Maximum } else { 0 })
    peakVramBytes = [uint64](if ($allVram.Count) { ($allVram | Measure-Object -Maximum).Maximum } else { 0 })
    peakDecoderPercent = [double](if ($allDecoder.Count) { ($allDecoder | Measure-Object -Maximum).Maximum } else { 0 })
    gpuTelemetryAvailable = $gpuTelemetryAvailable; peakHandleCount = $peakHandles; peakThreadCount = $peakThreads; peakProcessCount = $peakProcesses
    peakDiskWriteBytesPerSecond = [double](if ($allDiskWrite.Count) { ($allDiskWrite | Measure-Object -Maximum).Maximum } else { 0 })
    peakNetworkReceiveBytesPerSecond = [double](if ($allNetwork.Count) { ($allNetwork | Measure-Object -Maximum).Maximum } else { 0 })
    captureReadP95Ms = Get-Percentile -Values @($allCaptureLatency) -Percentile 0.95; decodeP95Ms = Get-Percentile -Values @($allDecodeLatency) -Percentile 0.95
    maxQueueDepth = [int](if ($allQueues.Count) { ($allQueues | Measure-Object -Maximum).Maximum } else { 0 })
    queueGrowthPerMinute = Get-QueueGrowthPerMinute -Values @($allQueues) -ElapsedSeconds ($completedAt - $startedAt).TotalSeconds
    inferenceSuccessRate = if (($successDelta + $errorDelta) -gt 0) { $successDelta / ($successDelta + $errorDelta) } else { 0.0 }
    outOfMemoryCount = $oomCount; mediaFieldCount = 0; credentialFieldCount = 0; phases = @($phaseResults)
}

try {
    if ($DoNotUpload) {
        $metrics | ConvertTo-Json -Depth 16
    } else {
        $body = $metrics | ConvertTo-Json -Depth 16 -Compress
        Invoke-RestMethod -Method Post -Uri ([string]$manifest.uploadUrl) -Headers @{ "X-Benchmark-Nonce" = [string]$manifest.nonce } -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 8
    }
} finally {
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($benchmarkDirectory)
    $expectedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemporaryRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTemporaryRoot -Leaf).StartsWith("qual-hardware-benchmark-")) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
