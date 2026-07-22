package main

func parseDarwinThermal(output string) telemetryResult {
	return parseDarwinThermalPayload(output)
}

func parseDarwinGPU(output string) telemetryResult {
	return parseDarwinGPUPayload(output)
}
