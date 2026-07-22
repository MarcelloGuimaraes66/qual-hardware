# Windows 11 x64 / RTX 5090 physical gate

Status: source and local macOS gates ready; Windows approved-runtime intake and physical execution pending.

This procedure operates only on Qual Hardware. It must not open, install, execute or point to any Perceptrum directory, process, API or database.

## Before the physical run

1. Copy and verify the candidate source archive:
   - file: `qual-hardware-t4-1-cpugpu-candidate.tar.gz`
   - expected size: `5,892,769` bytes
   - SHA-256: `599a29fed52f908a2918b2d91aa3e6eb47ea3ff6d63779a603bca8436751a139`
2. Extract it into a new Windows test directory. Do not overlay another checkout.
3. Confirm Windows 11 x64, the NVIDIA production driver, `nvidia-smi`, wall power, maximum-performance power policy and continuous cooling.
4. Keep at least 50 GiB plus the runtime preparation peak free. The reported 152 GB free satisfies the current 10,720,737,650-byte preparation estimate.
5. Install the repository-declared Node/npm and Go toolchains, then execute:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run calibration:telemetry:test
npm run calibration:telemetry:verify
npm run audit:source
npm run calibration:assets:audit
```

The asset audit is expected to remain fail-closed until the complete Windows intake has been reviewed and provisioned.

## Required Windows runtime intake

The Windows package must contain all nine runtime IDs declared in `resources/calibration/runtime-manifest.json`, with exact hashes, sizes, license evidence and real CycloneDX SBOMs.

Mandatory capability details:

- FFmpeg and ffprobe must be one reviewed Windows x64 build that provides CPU H.264/H.265 encode (`libx264`/`libx265`), NVIDIA CUDA decode and `h264_nvenc`/`hevc_nvenc` encode.
- MediaMTX must be the pinned Windows x64 release.
- llama-server must be the pinned CUDA 13.3 x64 executable, every DLL from its base archive and every required DLL from the pinned CUDA runtime archive.
- Qwen3-VL Core 2B and Core Max 4B GGUF and `mmproj` files must match the pinned immutable hashes.
- The packaged Windows telemetry probe must match its manifest hash and size.

Prepare an absolute-path intake JSON conforming to `qual-hardware-calibration-asset-intake/2.0.0`. Intake v1 is deliberately rejected because it cannot prove package provenance. Dry-run v2 first, then apply it:

```powershell
npm run calibration:runtime:prepare -- --target win32-x64 --print-template | Set-Content -Encoding utf8 C:\qual-hardware-runtime\intake-win32-x64.json
npm run calibration:runtime:prepare -- --intake C:\qual-hardware-runtime\intake-win32-x64.json
npm run calibration:runtime:prepare -- --intake C:\qual-hardware-runtime\intake-win32-x64.json --apply
```

Fill only the nested `intake` values in the generated file. Keep `sourceGuide` as immutable review context. Every `sourcePackages` row must point to the complete local archive/file matching its locked hash and size. Every CUDA DLL row must retain the `sourcePackageSha256` of the archive from which it was extracted. The file remains deliberately invalid until every placeholder is replaced, the SPDX decision is reviewed and every CUDA companion-library group is represented; one entry may be expanded into as many DLL rows as the extracted bundle requires.

The preparer refuses insufficient disk, symlinks, placeholders, duplicate destinations, incomplete inventories, invalid SBOMs and identical reapplication. If a partial target already exists, it is preserved in a versioned backup before the candidate is installed.

Do not mark the runtime manifest approved at this stage. The first physical run is a candidate diagnostic used to prove the package.

## Package and smoke

In the same PowerShell session:

```powershell
$env:QUAL_HARDWARE_CALIBRATION_FEATURE = "full"
npm run desktop:package:dir
$env:QUAL_HARDWARE_CALIBRATION_TIME_SCALE = "0.005"
npm run desktop:smoke
$env:QUAL_HARDWARE_CALIBRATION_TIME_SCALE = "1"
```

The smoke must finish green and report zero session-temporary bytes. Preserve its logs and package hash as evidence. Do not remove an existing package or test database.

## Physical app sequence

1. Start the newly packaged Qual Hardware from the same PowerShell session so the candidate full feature flag is inherited.
2. Confirm the detected CPU, physical/logical cores, RAM, RTX 5090, VRAM, driver, Windows version and physical network link.
3. Create/dimension the intended camera workload.
4. Open **Calibrar este computador**.
5. Confirm nine of nine assets and all contracts are verified.
6. Run the quick internal diagnostic once.
7. Exercise **Interromper e limpar temporários**, confirm zero remaining bytes, then use the compatible checkpoint resume path.
8. Start **Validação física completa — diagnóstico**.
9. Confirm every tier and every phase displays both CPU and GPU modes. The app must never skip either mode.
10. Keep the machine powered and cooled through discovery, all three repetitions and cooldowns.
11. At completion, require persisted result, compact evidence, cleanup state `completed`, 100% only after cleanup, and zero session-temporary bytes.
12. Export the signed `.qhcal` package and record the installation identity short code.
13. Disconnect or capture network traffic during the actual calibration to prove zero external calibration egress. Public catalog refresh must remain paused while calibration is active.

## Acceptance and fail-closed outcomes

The run is not purchase-grade if CPU thermal policy, GPU telemetry, physical network specification, exact hardware mapping, any model/backend, any phase, either compute mode or any repetition is unavailable or fails. Such a result is still valuable diagnostic evidence and must be exported, but it must not approve a purchase.

Only after the Windows package, sensors, CPU/GPU lanes, cleanup, zero egress and three repetitions pass may its exact runtime-manifest hash be considered for approval. Ubuntu and macOS must then pass the equivalent native gate before the candidate commit is allowed.
