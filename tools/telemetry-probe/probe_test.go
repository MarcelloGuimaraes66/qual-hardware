package main

import (
	"math"
	"testing"
)

func TestNvidiaAggregationAndThermalEvidence(t *testing.T) {
	result := parseNvidiaCSV("25, 1024, 61, 75.5, Not Active, Not Active\n70, 2048, 73, 125.0, Active, Not Active\n")
	payload := result.payload()
	if payload.GPUUtilizationPercent == nil || *payload.GPUUtilizationPercent != 70 {
		t.Fatalf("unexpected GPU utilization: %#v", payload.GPUUtilizationPercent)
	}
	if payload.GPUMemoryUsedBytes == nil || *payload.GPUMemoryUsedBytes != 3072*1024*1024 {
		t.Fatalf("unexpected GPU memory: %#v", payload.GPUMemoryUsedBytes)
	}
	if payload.GPUPowerWatts == nil || math.Abs(*payload.GPUPowerWatts-200.5) > 0.001 {
		t.Fatalf("unexpected GPU power: %#v", payload.GPUPowerWatts)
	}
	if payload.ThermalThrottlePercent == nil || *payload.ThermalThrottlePercent != 100 {
		t.Fatalf("unexpected thermal state: %#v", payload.ThermalThrottlePercent)
	}
	if payload.Quality.GPUThermal != evidenceMeasured || payload.Quality.ThermalThrottling != evidencePartial {
		t.Fatalf("GPU-only evidence must remain partial for the complete machine: %#v", payload.Quality)
	}
}

func TestCompleteEvidenceRequiresCPUAndDetectedGPU(t *testing.T) {
	zero := 0.0
	result := telemetryResult{cpuThermalMeasured: true, gpuDetected: true, thermalThrottlePercent: &zero}
	if result.payload().Quality.ThermalThrottling != evidencePartial {
		t.Fatal("missing GPU thermal evidence must remain partial")
	}
	result.gpuThermalMeasured = true
	if result.payload().Quality.ThermalThrottling != evidenceMeasured {
		t.Fatal("CPU and GPU thermal evidence must be complete")
	}
}

func TestDarwinThermalParser(t *testing.T) {
	result := parseDarwinThermalPayload("CPU_Speed_Limit = 82\nScheduler_Limit = 90\n")
	if result.thermalThrottlePercent == nil || *result.thermalThrottlePercent != 18 {
		t.Fatalf("unexpected Darwin throttle: %#v", result.thermalThrottlePercent)
	}
	if result.payload().Quality.ThermalThrottling != evidenceMeasured {
		t.Fatal("pmset system policy evidence must cover the integrated platform")
	}
}

func TestWindowsThermalParser(t *testing.T) {
	result := parseWindowsThermalPayload(`{"thermalZones":[{"HighPrecisionTemperature":3182,"PercentPassiveLimit":75,"ThrottleReasons":1}],"videoControllers":[]}`)
	if result.thermalThrottlePercent == nil || *result.thermalThrottlePercent != 25 {
		t.Fatalf("unexpected Windows throttle: %#v", result.thermalThrottlePercent)
	}
	if result.cpuTemperatureCelsius == nil || math.Abs(*result.cpuTemperatureCelsius-45.05) > 0.01 {
		t.Fatalf("unexpected Windows temperature: %#v", result.cpuTemperatureCelsius)
	}
}

func TestWindowsDiscreteGPURequiresItsOwnThermalEvidence(t *testing.T) {
	result := parseWindowsThermalPayload(`{"thermalZones":[{"PercentPassiveLimit":100,"ThrottleReasons":0}],"videoControllers":[{"Name":"AMD Radeon Pro"}]}`)
	if result.payload().Quality.ThermalThrottling != evidencePartial {
		t.Fatal("a detected GPU without vendor thermal evidence must remain partial")
	}
}
