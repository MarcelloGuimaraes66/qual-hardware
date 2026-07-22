package main

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

var darwinPerformanceMetric = regexp.MustCompile(`"(Device Utilization %|In use system memory)"=([0-9]+)`)

type windowsThermalZone struct {
	HighPrecisionTemperature *float64 `json:"HighPrecisionTemperature"`
	PercentPassiveLimit      *float64 `json:"PercentPassiveLimit"`
	ThrottleReasons          *uint64  `json:"ThrottleReasons"`
}

type windowsVideoController struct {
	Name                 string `json:"Name"`
	AdapterCompatibility string `json:"AdapterCompatibility"`
	PNPDeviceID          string `json:"PNPDeviceID"`
}

type windowsTelemetryPayload struct {
	ThermalZones     []windowsThermalZone     `json:"thermalZones"`
	VideoControllers []windowsVideoController `json:"videoControllers"`
}

func parseDarwinThermalPayload(output string) telemetryResult {
	result := telemetryResult{}
	lower := strings.ToLower(output)
	if strings.Contains(lower, "no thermal warning level has been recorded") || strings.Contains(lower, "cpu_speed_limit") || strings.Contains(lower, "scheduler_limit") {
		result.cpuThermalMeasured = true
		result.systemCoversGPU = true
		result.sources = appendUnique(result.sources, "darwin-pmset-thermal-policy")
		throttle := 0.0
		for _, line := range strings.Split(output, "\n") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.ToLower(strings.TrimSpace(parts[0]))
			if key != "cpu_speed_limit" && key != "scheduler_limit" {
				continue
			}
			value, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if err == nil {
				throttle = max(throttle, 100-clamp(value, 0, 100))
			}
		}
		result.thermalThrottlePercent = floatPointer(throttle)
	}
	return result
}

func parseDarwinGPUPayload(output string) telemetryResult {
	result := telemetryResult{}
	for _, match := range darwinPerformanceMetric.FindAllStringSubmatch(output, -1) {
		value, err := strconv.ParseFloat(match[2], 64)
		if err != nil {
			continue
		}
		result.gpuDetected = true
		switch match[1] {
		case "Device Utilization %":
			value = clamp(value, 0, 100)
			maxPointer(&result.gpuUtilizationPercent, &value)
		case "In use system memory":
			maxPointer(&result.gpuMemoryUsedBytes, &value)
		}
	}
	if result.gpuDetected {
		result.sources = appendUnique(result.sources, "darwin-ioreg-agx-performance-statistics")
	}
	return result
}

func parseWindowsThermalPayload(output string) telemetryResult {
	result := telemetryResult{}
	var payload windowsTelemetryPayload
	if err := json.Unmarshal([]byte(output), &payload); err != nil {
		result.warnings = appendUnique(result.warnings, "windows_thermal_policy_malformed")
		return result
	}
	for _, controller := range payload.VideoControllers {
		name := strings.ToLower(strings.TrimSpace(controller.Name))
		if name == "" || strings.Contains(name, "microsoft basic display") || strings.Contains(name, "remote display") {
			continue
		}
		result.gpuDetected = true
		result.sources = appendUnique(result.sources, "windows-video-controller-inventory")
	}
	for _, zone := range payload.ThermalZones {
		if zone.HighPrecisionTemperature != nil {
			celsius := *zone.HighPrecisionTemperature/10 - 273.15
			if celsius > 0 && celsius < 250 {
				maxPointer(&result.cpuTemperatureCelsius, &celsius)
			}
		}
		if zone.PercentPassiveLimit == nil {
			continue
		}
		throttle := 100 - clamp(*zone.PercentPassiveLimit, 0, 100)
		if zone.ThrottleReasons != nil && *zone.ThrottleReasons&1 != 0 && throttle == 0 {
			throttle = 100
		}
		maxPointer(&result.thermalThrottlePercent, &throttle)
		result.cpuThermalMeasured = true
	}
	if result.cpuThermalMeasured {
		result.sources = appendUnique(result.sources, "windows-thermal-zone-policy")
	}
	return result
}
