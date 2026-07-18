# Isolated Perceptrum benchmark runner

`Invoke-PerceptrumBenchmark.ps1` launches the real Perceptrum executable with `PERCEPTRUM_BENCHMARK_MODE=1`, samples the complete process tree, reads Open Monitor's private JSONL telemetry, collects NVIDIA GPU/VRAM/NVDEC data, and uploads aggregate metrics with the manifest's one-use challenge.

The native runtime suppresses thumbnails, commercial events, camera-connection events, Job alert persistence/delivery, Telegram delivery, retained PNG frames, and retention hydration while this flag is active. Temporary working media remains private in a unique OS temporary directory and is deleted after the run.

For a certifying run, `ReplayControllerScript` is required. It receives `ManifestPath`, `Phase`, `LoadPercent`, and `ControlPath`; it must adjust the local RTSP replay matrix and exit successfully. Without it, the runner reports a 1% effective load, deliberately causing validation to fail instead of granting a false certificate.

```powershell
.\runtime\Invoke-PerceptrumBenchmark.ps1 `
  -ManifestPath .\benchmark-manifest.json `
  -PerceptrumExePath C:\Perceptrum\Perceptrum.exe `
  -ReplayControllerScript C:\BenchmarkLab\Set-ReplayLoad.ps1
```

The default durations are 15 minutes warmup, 60 minutes sustained load, and 15 minutes at 120%. `DurationScale` exists only for runner development; shortened results cannot pass server validation.
