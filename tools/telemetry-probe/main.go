package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"time"
)

const (
	probeSchemaVersion = "qual-hardware-telemetry-probe/1.0.0"
	probeVersion       = "0.1.0"
)

type evidenceStatus string

const (
	evidenceMeasured    evidenceStatus = "measured"
	evidencePartial     evidenceStatus = "partial"
	evidenceUnavailable evidenceStatus = "unavailable"
)

type probeQuality struct {
	ThermalThrottling evidenceStatus `json:"thermalThrottling"`
	CPUThermal        evidenceStatus `json:"cpuThermal"`
	GPUThermal        evidenceStatus `json:"gpuThermal"`
	Sources           []string       `json:"sources"`
}

type probePayload struct {
	SchemaVersion          string       `json:"schemaVersion"`
	ProbeVersion           string       `json:"probeVersion"`
	Platform               string       `json:"platform"`
	Architecture           string       `json:"architecture"`
	CapturedAt             string       `json:"capturedAt"`
	Quality                probeQuality `json:"quality"`
	GPUUtilizationPercent  *float64     `json:"gpuUtilizationPercent,omitempty"`
	GPUMemoryUsedBytes     *float64     `json:"gpuMemoryUsedBytes,omitempty"`
	GPUTemperatureCelsius  *float64     `json:"gpuTemperatureCelsius,omitempty"`
	GPUPowerWatts          *float64     `json:"gpuPowerWatts,omitempty"`
	CPUTemperatureCelsius  *float64     `json:"cpuTemperatureCelsius,omitempty"`
	ThermalThrottlePercent *float64     `json:"thermalThrottlePercent,omitempty"`
	ThermalThrottleCounter *uint64      `json:"thermalThrottleCounter,omitempty"`
	Warnings               []string     `json:"warnings"`
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Printf("%s\n", probeVersion)
		return
	}
	if len(os.Args) != 3 || os.Args[1] != "--format" || os.Args[2] != "json" {
		fmt.Fprintln(os.Stderr, "usage: telemetry-probe --format json")
		os.Exit(2)
	}

	result := collectPlatformTelemetry()
	result.merge(collectNvidiaTelemetry())
	sort.Strings(result.sources)
	sort.Strings(result.warnings)
	payload := result.payload()
	payload.SchemaVersion = probeSchemaVersion
	payload.ProbeVersion = probeVersion
	payload.Platform = runtime.GOOS
	payload.Architecture = runtime.GOARCH
	payload.CapturedAt = time.Now().UTC().Format(time.RFC3339Nano)

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		fmt.Fprintln(os.Stderr, "telemetry_probe_encode_failed")
		os.Exit(1)
	}
}
