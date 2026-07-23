//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func collectPlatformTelemetry() telemetryResult {
	result := collectLinuxThermalZones("/sys/class/thermal")
	result.merge(collectLinuxThrottleCounters("/sys/devices/system/cpu"))
	result.merge(collectLinuxCoolingDevices("/sys/class/thermal"))
	if cards, _ := filepath.Glob("/sys/class/drm/card*/device"); len(cards) > 0 {
		result.gpuDetected = true
	}
	return result
}

func readLinuxNumber(path string) (float64, bool) {
	value, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(string(value)), 64)
	return parsed, err == nil
}

func collectLinuxThermalZones(root string) telemetryResult {
	result := telemetryResult{}
	zones, _ := filepath.Glob(filepath.Join(root, "thermal_zone*"))
	for _, zone := range zones {
		temperature, ok := readLinuxNumber(filepath.Join(zone, "temp"))
		if !ok || temperature <= 0 {
			continue
		}
		temperature /= 1000
		if temperature > 0 && temperature < 250 {
			maxPointer(&result.cpuTemperatureCelsius, &temperature)
			result.sources = appendUnique(result.sources, "linux-thermal-zone-temperature")
		}
	}
	return result
}

func collectLinuxThrottleCounters(root string) telemetryResult {
	result := telemetryResult{}
	paths, _ := filepath.Glob(filepath.Join(root, "cpu*", "thermal_throttle", "*_throttle_count"))
	var total uint64
	var measured bool
	for _, path := range paths {
		value, ok := readLinuxNumber(path)
		if !ok || value < 0 {
			continue
		}
		total += uint64(value)
		measured = true
	}
	if measured {
		result.thermalThrottleCounter = uintPointer(total)
		result.thermalThrottlePercent = floatPointer(0)
		result.cpuThermalMeasured = true
		result.sources = appendUnique(result.sources, "linux-cpu-thermal-throttle-counters")
	}
	return result
}

func collectLinuxCoolingDevices(root string) telemetryResult {
	result := telemetryResult{}
	devices, _ := filepath.Glob(filepath.Join(root, "cooling_device*"))
	for _, device := range devices {
		rawType, err := os.ReadFile(filepath.Join(device, "type"))
		if err != nil {
			continue
		}
		deviceType := strings.ToLower(strings.TrimSpace(string(rawType)))
		if !strings.Contains(deviceType, "processor") && !strings.Contains(deviceType, "cpu") && !strings.Contains(deviceType, "powerclamp") {
			continue
		}
		current, currentOK := readLinuxNumber(filepath.Join(device, "cur_state"))
		maximum, maximumOK := readLinuxNumber(filepath.Join(device, "max_state"))
		if !currentOK || !maximumOK || maximum <= 0 {
			continue
		}
		percent := clamp(current/maximum*100, 0, 100)
		maxPointer(&result.thermalThrottlePercent, &percent)
		result.cpuThermalMeasured = true
		result.sources = appendUnique(result.sources, "linux-cpu-thermal-cooling-state")
	}
	return result
}
