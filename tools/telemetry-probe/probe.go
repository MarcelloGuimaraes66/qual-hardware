package main

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type telemetryResult struct {
	gpuUtilizationPercent  *float64
	gpuMemoryUsedBytes     *float64
	gpuTemperatureCelsius  *float64
	gpuPowerWatts          *float64
	cpuTemperatureCelsius  *float64
	thermalThrottlePercent *float64
	thermalThrottleCounter *uint64
	cpuThermalMeasured     bool
	gpuThermalMeasured     bool
	gpuDetected            bool
	systemCoversGPU        bool
	gpuDevices             []gpuDeviceTelemetry
	sources                []string
	warnings               []string
}

func floatPointer(value float64) *float64 { return &value }
func uintPointer(value uint64) *uint64    { return &value }

func clamp(value, minimum, maximum float64) float64 {
	return math.Min(maximum, math.Max(minimum, value))
}

func maxPointer(current **float64, candidate *float64) {
	if candidate == nil || math.IsNaN(*candidate) || math.IsInf(*candidate, 0) {
		return
	}
	if *current == nil || **current < *candidate {
		value := *candidate
		*current = &value
	}
}

func sumPointer(current **float64, candidate *float64) {
	if candidate == nil || math.IsNaN(*candidate) || math.IsInf(*candidate, 0) {
		return
	}
	if *current == nil {
		value := *candidate
		*current = &value
		return
	}
	**current += *candidate
}

func appendUnique(values []string, candidates ...string) []string {
	seen := make(map[string]bool, len(values)+len(candidates))
	for _, value := range values {
		seen[value] = true
	}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		values = append(values, candidate)
	}
	return values
}

func (result *telemetryResult) merge(other telemetryResult) {
	maxPointer(&result.gpuUtilizationPercent, other.gpuUtilizationPercent)
	sumPointer(&result.gpuMemoryUsedBytes, other.gpuMemoryUsedBytes)
	maxPointer(&result.gpuTemperatureCelsius, other.gpuTemperatureCelsius)
	sumPointer(&result.gpuPowerWatts, other.gpuPowerWatts)
	maxPointer(&result.cpuTemperatureCelsius, other.cpuTemperatureCelsius)
	maxPointer(&result.thermalThrottlePercent, other.thermalThrottlePercent)
	if other.thermalThrottleCounter != nil {
		if result.thermalThrottleCounter == nil {
			result.thermalThrottleCounter = uintPointer(*other.thermalThrottleCounter)
		} else {
			*result.thermalThrottleCounter += *other.thermalThrottleCounter
		}
	}
	result.cpuThermalMeasured = result.cpuThermalMeasured || other.cpuThermalMeasured
	result.gpuThermalMeasured = result.gpuThermalMeasured || other.gpuThermalMeasured
	result.gpuDetected = result.gpuDetected || other.gpuDetected
	result.systemCoversGPU = result.systemCoversGPU || other.systemCoversGPU
	for _, device := range other.gpuDevices {
		found := false
		for index := range result.gpuDevices {
			if result.gpuDevices[index].UUID == device.UUID && device.UUID != "" {
				result.gpuDevices[index] = device
				found = true
				break
			}
		}
		if !found {
			result.gpuDevices = append(result.gpuDevices, device)
		}
	}
	result.sources = appendUnique(result.sources, other.sources...)
	result.warnings = appendUnique(result.warnings, other.warnings...)
}

func (result telemetryResult) payload() probePayload {
	cpuStatus := evidenceUnavailable
	if result.cpuThermalMeasured {
		cpuStatus = evidenceMeasured
	}
	gpuStatus := evidenceUnavailable
	if result.gpuThermalMeasured || result.systemCoversGPU {
		gpuStatus = evidenceMeasured
	} else if result.gpuDetected {
		gpuStatus = evidencePartial
	}
	overall := evidenceUnavailable
	if result.cpuThermalMeasured && (!result.gpuDetected || result.gpuThermalMeasured || result.systemCoversGPU) {
		overall = evidenceMeasured
	} else if result.cpuThermalMeasured || result.gpuThermalMeasured {
		overall = evidencePartial
	}
	return probePayload{
		Quality: probeQuality{
			ThermalThrottling: overall,
			CPUThermal:        cpuStatus,
			GPUThermal:        gpuStatus,
			Sources:           append([]string{}, result.sources...),
		},
		GPUUtilizationPercent:  result.gpuUtilizationPercent,
		GPUMemoryUsedBytes:     result.gpuMemoryUsedBytes,
		GPUTemperatureCelsius:  result.gpuTemperatureCelsius,
		GPUPowerWatts:          result.gpuPowerWatts,
		CPUTemperatureCelsius:  result.cpuTemperatureCelsius,
		ThermalThrottlePercent: result.thermalThrottlePercent,
		ThermalThrottleCounter: result.thermalThrottleCounter,
		GPUDevices:             append([]gpuDeviceTelemetry{}, result.gpuDevices...),
		Warnings:               append([]string{}, result.warnings...),
	}
}

type cappedBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (writer *cappedBuffer) Write(value []byte) (int, error) {
	remaining := writer.limit - writer.buffer.Len()
	if remaining <= 0 {
		return 0, errors.New("telemetry_probe_output_limit")
	}
	if len(value) > remaining {
		_, _ = writer.buffer.Write(value[:remaining])
		return remaining, errors.New("telemetry_probe_output_limit")
	}
	return writer.buffer.Write(value)
}

func runFixedCommand(path string, arguments ...string) (string, error) {
	contextWithTimeout, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	command := exec.CommandContext(contextWithTimeout, path, arguments...)
	stdout := &cappedBuffer{limit: 1_000_000}
	stderr := &cappedBuffer{limit: 100_000}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return "", err
	}
	return stdout.buffer.String(), nil
}

func parseNumber(value string) (*float64, bool) {
	normalized := strings.TrimSpace(value)
	if normalized == "" || strings.EqualFold(normalized, "N/A") || strings.EqualFold(normalized, "[Not Supported]") {
		return nil, false
	}
	parsed, err := strconv.ParseFloat(normalized, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 0 {
		return nil, false
	}
	return floatPointer(parsed), true
}
