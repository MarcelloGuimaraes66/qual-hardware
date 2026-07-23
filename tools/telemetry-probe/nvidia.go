package main

import (
	"os/exec"
	"strings"
)

func collectNvidiaTelemetry() telemetryResult {
	path, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return telemetryResult{}
	}
	output, err := runFixedCommand(path,
		"--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_thermal_slowdown",
		"--format=csv,noheader,nounits")
	if err != nil {
		return telemetryResult{gpuDetected: true, warnings: []string{"nvidia_smi_query_failed"}}
	}
	return parseNvidiaCSV(output)
}

func parseNvidiaCSV(output string) telemetryResult {
	result := telemetryResult{}
	rows := strings.Split(strings.TrimSpace(output), "\n")
	for _, row := range rows {
		if strings.TrimSpace(row) == "" {
			continue
		}
		columns := strings.Split(row, ",")
		if len(columns) < 6 {
			result.warnings = appendUnique(result.warnings, "nvidia_smi_malformed_row")
			continue
		}
		result.gpuDetected = true
		if value, ok := parseNumber(columns[0]); ok {
			*value = clamp(*value, 0, 100)
			maxPointer(&result.gpuUtilizationPercent, value)
		}
		if value, ok := parseNumber(columns[1]); ok {
			*value *= 1024 * 1024
			sumPointer(&result.gpuMemoryUsedBytes, value)
		}
		if value, ok := parseNumber(columns[2]); ok {
			maxPointer(&result.gpuTemperatureCelsius, value)
		}
		if value, ok := parseNumber(columns[3]); ok {
			sumPointer(&result.gpuPowerWatts, value)
		}
		thermalActive := false
		for _, raw := range columns[4:6] {
			if strings.EqualFold(strings.TrimSpace(raw), "Active") || strings.EqualFold(strings.TrimSpace(raw), "Yes") {
				thermalActive = true
			}
		}
		throttle := 0.0
		if thermalActive {
			throttle = 100
		}
		maxPointer(&result.thermalThrottlePercent, &throttle)
		result.gpuThermalMeasured = true
	}
	if result.gpuDetected {
		result.sources = appendUnique(result.sources, "nvidia-smi-clocks-event-reasons")
	}
	return result
}
