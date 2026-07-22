//go:build windows

package main

import (
	"os/exec"
)

const windowsThermalCommand = `$ErrorActionPreference='Stop'; $zones=@(Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation | Select-Object HighPrecisionTemperature,PercentPassiveLimit,ThrottleReasons); $gpus=@(Get-CimInstance -Namespace root/cimv2 -ClassName Win32_VideoController | Select-Object Name,AdapterCompatibility,PNPDeviceID); [pscustomobject]@{thermalZones=$zones;videoControllers=$gpus} | ConvertTo-Json -Compress -Depth 4`

func collectPlatformTelemetry() telemetryResult {
	path, err := exec.LookPath("powershell.exe")
	if err != nil {
		return telemetryResult{warnings: []string{"windows_powershell_unavailable"}}
	}
	output, err := runFixedCommand(path, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsThermalCommand)
	if err != nil {
		return telemetryResult{warnings: []string{"windows_thermal_policy_unavailable"}}
	}
	return parseWindowsThermal(output)
}
