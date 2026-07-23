//go:build darwin

package main

func collectPlatformTelemetry() telemetryResult {
	result := telemetryResult{}
	if output, err := runFixedCommand("/usr/bin/pmset", "-g", "therm"); err == nil {
		result.merge(parseDarwinThermal(output))
	} else {
		result.warnings = appendUnique(result.warnings, "darwin_pmset_thermal_unavailable")
	}
	if output, err := runFixedCommand("/usr/sbin/ioreg", "-r", "-n", "AGXAccelerator", "-l"); err == nil {
		result.merge(parseDarwinGPU(output))
	} else {
		result.warnings = appendUnique(result.warnings, "darwin_ioreg_gpu_unavailable")
	}
	return result
}
