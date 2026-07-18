const FORBIDDEN_KEY = /(rtsp|password|credential|secret|frame|image|video|base64|media|blob|binary)/i;
const FORBIDDEN_STRING = /(rtsp:\/\/|data:image\/|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const EXEMPT_KEYS = new Set(["mediaFieldCount", "credentialFieldCount"]);

export interface PrivacyFinding {
  path: string;
  reason: string;
}

export function findForbiddenBenchmarkData(value: unknown, path = "$", findings: PrivacyFinding[] = []): PrivacyFinding[] {
  if (typeof value === "string") {
    if (FORBIDDEN_STRING.test(value)) findings.push({ path, reason: "forbidden_media_or_credential_value" });
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenBenchmarkData(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (!EXEMPT_KEYS.has(key) && FORBIDDEN_KEY.test(key)) findings.push({ path: `${path}.${key}`, reason: "forbidden_field_name" });
      findForbiddenBenchmarkData(child, `${path}.${key}`, findings);
    }
  }
  return findings;
}

const CALIBRATION_FORBIDDEN_KEY = /(password|credential|secret|api.?key|image.?data|video.?data|media.?data|base64|blob|binary)/i;
const CALIBRATION_FORBIDDEN_STRING = /(data:image\/|-----BEGIN [A-Z ]+PRIVATE KEY-----|api\.openai\.com)/i;

export function findForbiddenCalibrationData(value: unknown, path = "$", findings: PrivacyFinding[] = []): PrivacyFinding[] {
  if (typeof value === "string") {
    if (CALIBRATION_FORBIDDEN_STRING.test(value)) findings.push({ path, reason: "forbidden_calibration_value" });
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenCalibrationData(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (CALIBRATION_FORBIDDEN_KEY.test(key) && !EXEMPT_KEYS.has(key)) {
        findings.push({ path: `${path}.${key}`, reason: "forbidden_calibration_field" });
      }
      findForbiddenCalibrationData(child, `${path}.${key}`, findings);
    }
  }
  return findings;
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unexpected error";
}
