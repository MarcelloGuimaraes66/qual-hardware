export const WORKLOAD_CONTRACT_VERSION = "perceptrum-workload/2.0.0" as const;
export type WorkloadContractVersion =
  | typeof WORKLOAD_CONTRACT_VERSION
  | "perceptrum-workload/1.1.0"
  | "perceptrum-workload/1.0.0";

export const LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/1.0.0" as const;
export const CALIBRATION_PLAN_VERSION = "qual-hardware-calibration-plan/1.0.0" as const;
export const EVIDENCE_CATALOG_VERSION = "qual-hardware-evidence-catalog/2.0.0" as const;
export const CAPACITY_PREDICTION_VERSION = "qual-hardware-capacity-prediction/1.0.0" as const;

export type Market = "BR" | "US" | "DE";
export type Currency = "BRL" | "USD" | "EUR";
export type InfrastructureKind = "laptop" | "mini_pc" | "workstation" | "rack" | "either";
export type OperatingSystemFamily = "windows" | "ubuntu" | "macos";
export type CpuVendor = "intel" | "amd" | "apple";
export type GpuVendor = "nvidia" | "amd" | "intel" | "apple";
export type MemoryArchitecture = "dedicated" | "shared" | "unified";
export type Codec = "h264" | "h265";
export type DecodeMode = "cpu" | "gpu";
export type InputType = "video" | "image";
export type PackagingMode = "frame_sequence" | "mosaic_2x2" | "mosaic_3x3";
export type InferenceModel =
  | "gpt-5.4"
  | "gpt-5"
  | "gpt-5.4-mini"
  | "gpt-5-mini"
  | "aiq-3.7"
  | "aiq-3.7-max"
  | "opencv-portal-counter";
export type RecommendationPolicy = "minimum" | "recommended" | "n_plus_one";
export type RecommendationVariant = "balanced" | "lower_capex" | "expansion" | "cost_ordered";
export type RecommendationConfidence =
  | "estimated"
  | "validated"
  | "validated_local"
  | "extrapolated_high"
  | "extrapolated_medium"
  | "reference_only"
  | "incompatible";
export type CalibrationConfidenceClass = "A" | "B" | "C" | "none";
export type CalibrationStatus =
  | "validated_local"
  | "extrapolated_high"
  | "extrapolated_medium"
  | "reference_only"
  | "incompatible";
export type CalibrationStage =
  | "rtsp_ingest"
  | "video_decode"
  | "bgr_processing"
  | "video_encode"
  | "disk_write"
  | "disk_read"
  | "local_inference"
  | "memory_bandwidth"
  | "network_ingest"
  | "thermal_sustain";

export interface AgentFeatures {
  onlyCaptureOnMotion: boolean;
  temporal: boolean;
  regions: number;
  croppedFrame: boolean;
  faceReferences: number;
  negativeReferences: number;
}

export interface AgentLoad {
  id: string;
  name: string;
  model: InferenceModel;
  inputType: InputType;
  packaging: PackagingMode;
  modelFps: number;
  runEverySeconds: 10 | 60 | 300 | 600;
  features: AgentFeatures;
}

export interface CameraSourceProfile {
  codec: Codec;
  width: number;
  height: number;
  sourceFps: number;
  bitrateMbps: number;
}

export interface CameraStoragePolicy {
  /** Legacy scenarios remain readable; workload v2 uses this policy for rolling clip capacity. */
  storeVideo: boolean;
  /** Retention increases capacity demand only when storeVideo is enabled. */
  retentionDays: number;
  /** Redundancy multiplier used for retained source media. */
  raidFactor: number;
}

export interface CameraGroup {
  id: string;
  name: string;
  count: number;
  source: CameraSourceProfile;
  decodeMode: DecodeMode;
  motionPercent: number;
  storage: CameraStoragePolicy;
  agents: AgentLoad[];
}

export interface ConcurrentWorkloads {
  activeJobs: number;
  groupedJobCameras: number;
  concurrentChatSessions: number;
  activeSearches: number;
  intelligenceStreams: number;
}

export interface DesignConstraints {
  infrastructureKind: InfrastructureKind;
  preferredCpuVendors: CpuVendor[];
  preferredGpuVendors: GpuVendor[];
  /** Omitted on scenarios saved before desktop catalog 2026-07-17.3. */
  operatingSystem: "auto" | OperatingSystemFamily | undefined;
  /** Restricts sizing to one existing or preselected catalog machine. */
  requiredHardwareTemplateId: string | null | undefined;
  maxNodes: number | null;
  budget: number | null;
  requireEcc: boolean;
}

export interface CapacityScenario {
  schemaVersion: "capacity-scenario/1.0.0";
  workloadContractVersion: WorkloadContractVersion;
  projectName: string;
  customerName: string;
  market: Market;
  currency: Currency;
  perceptrumBuildHash: string;
  totalCameras: number;
  cameraGroups: CameraGroup[];
  concurrentWorkloads: ConcurrentWorkloads;
  constraints: DesignConstraints;
}

export interface ScenarioRecord {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  scenario: CapacityScenario;
}

export interface EffectiveAgentLoad extends AgentLoad {
  normalizedFields: string[];
}

export interface ResourceDemand {
  cpuCores: number;
  ramGb: number;
  gpuVramGb: number;
  localAiqSlots: number;
  gpuDecode1080p30Streams: number;
  diskCapacityTb: number;
  diskWriteMbps: number;
  lanGbps: number;
  internetUploadMbps: number;
  processThreads: number;
  ffmpegProcessesPerSecond: number;
  inferenceRequestsPerSecond: number;
}

export interface HardwareSource {
  title: string;
  url: string;
  observedAt: string;
}

export interface HardwareNodeTemplate {
  id: string;
  name: string;
  kind: Exclude<InfrastructureKind, "either">;
  generation: "current" | "previous" | "two_generations_back";
  cpuVendor: CpuVendor;
  cpuModel: string;
  cpuArchitecture?: string;
  physicalCores: number;
  /** Conservative sustained factor until a matching Perceptrum benchmark replaces it. */
  sustainedComputeFactor?: number;
  /** Explicit pipeline limits for thermally/power-constrained computers. */
  ffmpegProcessesPerSecondCapacity?: number;
  inferenceRequestsPerSecondCapacity?: number;
  motherboard: string;
  ramGb: number;
  ecc: boolean;
  gpuVendor: GpuVendor;
  gpuModel: string;
  gpuArchitecture?: string;
  gpuCount: number;
  memoryArchitecture: MemoryArchitecture;
  gpuVramGbTotal: number;
  localAiqSlots: number;
  supportsPerceptrumGpuDecode: boolean;
  gpuDecode1080p30Streams: number;
  storageModel: string;
  usableStorageTb: number;
  diskWriteMbps: number;
  nicGbps: number;
  powerSupply: string;
  cooling: string;
  thermalClass?: "mobile" | "compact" | "tower" | "rack";
  chassis: string;
  operatingSystemFamily: OperatingSystemFamily;
  windowsEdition: string;
  expansionScore: number;
  sources: HardwareSource[];
}

export interface PriceQuote {
  id: string;
  hardwareTemplateId: string;
  mpn: string;
  seller: string;
  market: Market;
  currency: Currency;
  condition: "new";
  inStock: boolean;
  taxIncluded: boolean | null;
  amount: number;
  originalAmount: number;
  originalCurrency: Currency;
  exchangeRate: number;
  exchangeRateSource: string | null;
  url: string;
  observedAt: string;
  sourceKind: "official_api" | "allowed_page" | "curated";
}

export interface CatalogStatus {
  catalogVersion: string;
  generatedAt: string;
  checkedAt: string;
  source: "bundled" | "cached" | "remote" | "imported";
  hardwareCount: number;
  quoteCount: number;
  stalePriceCount: number;
  remoteUpdateConfigured: boolean;
  verificationKeyConfigured: boolean;
  configurationWritable: boolean;
  remoteUrl: string | null;
  lastError: string | null;
}

export interface PriceSummary {
  currency: Currency;
  confidence: "none" | "low" | "medium";
  basis: "market_quotes" | "reference_estimate" | "quotation_required";
  observedAt: string | null;
  knownSubtotal: number | null;
  minimum: number | null;
  median: number | null;
  maximum: number | null;
  quotationRequired: boolean;
  quoteCount: number;
  staleQuoteCount: number;
  sourceUrls: string[];
  componentEstimates: ComponentCostEstimate[];
  exclusions: string[];
}

export interface ComponentCostEstimate {
  componentId: "cpu" | "motherboard" | "ram" | "gpu" | "storage" | "network" | "power_cooling_chassis" | "integration";
  component: string;
  description: string;
  quantityPerNode: number;
  unitAmount: number;
  perNodeAmount: number;
  projectAmount: number;
  sourceUrls: string[];
}

export interface NodeAllocation {
  nodeIndex: number;
  role: "active" | "reserve";
  cameraGroups: Array<{ groupId: string; groupName: string; cameras: number }>;
  demand: ResourceDemand;
  utilization: Record<keyof ResourceDemand, number>;
}

export interface RecommendationAlternative {
  id: string;
  variant: RecommendationVariant;
  hardware: HardwareNodeTemplate;
  nodeCount: number;
  activeNodeCount: number;
  allocations: NodeAllocation[];
  aggregateDemand: ResourceDemand;
  headroomPercent: number;
  bottleneck: keyof ResourceDemand;
  maximumAdditionalCameras: number;
  price: PriceSummary;
  warnings: string[];
  calibration?: CapacityPrediction;
}

export interface CapacityRecommendation {
  id: string;
  scenarioId: string;
  scenarioRevision: number;
  generatedAt: string;
  policy: RecommendationPolicy;
  confidence: RecommendationConfidence;
  contractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  perceptrumBuildHash: string;
  primary: RecommendationAlternative;
  alternatives: RecommendationAlternative[];
  assumptions: string[];
  evidence: string[];
}

export interface BenchmarkManifest {
  schemaVersion: "capacity-benchmark-manifest/1.0.0";
  id: string;
  nonce: string;
  scenarioId: string;
  scenarioRevision: number;
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  perceptrumBuildHash: string;
  createdAt: string;
  expiresAt: string;
  uploadUrl: string;
  targetHardware: {
    cpuModel: string;
    gpuModel: string;
    gpuDriver: string;
  };
  slaInferenceLatencyMs: number;
  privacy: {
    acceptMedia: false;
    acceptRtspCredentials: false;
    aggregateMetricsOnly: true;
  };
  phases: Array<{ name: "warmup" | "sustained" | "surge"; durationSeconds: number; loadPercent: number }>;
  scenario: CapacityScenario;
}

export interface BenchmarkMetrics {
  cpuModel: string;
  gpuModel: string;
  gpuDriver: string;
  perceptrumBuildHash: string;
  workloadContractVersion: string;
  startedAt: string;
  completedAt: string;
  p95InferenceLatencyMs: number;
  p99InferenceLatencyMs: number;
  peakCpuPercent: number;
  peakRamBytes: number;
  peakGpuPercent: number;
  peakVramBytes: number;
  peakDecoderPercent: number;
  gpuTelemetryAvailable: boolean;
  peakHandleCount: number;
  peakThreadCount: number;
  peakProcessCount: number;
  peakDiskWriteBytesPerSecond: number;
  peakNetworkReceiveBytesPerSecond: number;
  captureReadP95Ms: number;
  decodeP95Ms: number;
  maxQueueDepth: number;
  queueGrowthPerMinute: number;
  inferenceSuccessRate: number;
  outOfMemoryCount: number;
  mediaFieldCount: 0;
  credentialFieldCount: 0;
  phases: Array<{
    name: "warmup" | "sustained" | "surge";
    durationSeconds: number;
    loadPercent: number;
    p95InferenceLatencyMs: number;
    maxQueueDepth: number;
    queueGrowthPerMinute: number;
    outOfMemoryCount: number;
  }>;
}

export interface BenchmarkResultRecord {
  manifestId: string;
  receivedAt: string;
  passed: boolean;
  failures: string[];
  metrics: BenchmarkMetrics;
}

export interface HardwareFingerprint {
  hardwareTemplateId: string | null;
  hostnameHash: string;
  cpuModel: string;
  cpuArchitecture: string;
  physicalCores: number;
  logicalCores: number;
  cpuPowerLimitWatts: number | null;
  gpuModel: string;
  gpuArchitecture: string;
  gpuCount: number;
  gpuVramBytes: number;
  gpuDriver: string;
  ramBytes: number;
  memoryChannels: number | null;
  memorySpeedMtps: number | null;
  storageModel: string;
  filesystem: string;
  nicModel: string;
  operatingSystem: OperatingSystemFamily;
  operatingSystemVersion: string;
  powerProfile: string;
  formFactor: Exclude<InfrastructureKind, "either">;
  coolingProfile: string;
  perceptrumBuildHash: string;
  aiqModel: string;
  aiqModelHash: string;
  inferenceBackend: string;
}

export interface CalibrationStageMetric {
  stage: CalibrationStage;
  safeCameraCapacity: number;
  throughput: number;
  throughputUnit: string;
  p95LatencyMs: number;
  peakUtilizationPercent: number;
  queueGrowthPerMinute: number;
  thermalThrottlePercent: number;
}

export interface CalibrationPhaseMetric {
  name: "warmup" | "sustained" | "surge";
  durationSeconds: number;
  loadPercent: number;
  cameraCount: number;
  inferenceSuccessRate: number;
  maxQueueDepth: number;
  queueGrowthPerMinute: number;
  outOfMemoryCount: number;
}

export interface LocalCalibrationRun {
  schemaVersion: typeof LOCAL_CALIBRATION_VERSION;
  id: string;
  planId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  mode: "quick" | "full";
  fingerprint: HardwareFingerprint;
  requestedSourceFps: number;
  measuredSourceFps: number;
  requestedInferenceFps: number;
  effectiveInferenceFps: number;
  framesPlanned: number;
  framesExtracted: number;
  framesPacked: number;
  framesInferred: number;
  rtspOrigin: string;
  aiqOrigin: string;
  networkPolicy: "loopback_only";
  externalRequestCount: 0;
  openAiRequestCount: 0;
  mediaFieldCount: 0;
  credentialFieldCount: 0;
  stages: CalibrationStageMetric[];
  phases: CalibrationPhaseMetric[];
  overallSafeCameraCapacity: number;
  bottleneck: CalibrationStage;
  notes: string[];
}

export interface CalibrationPlan {
  schemaVersion: typeof CALIBRATION_PLAN_VERSION;
  id: string;
  createdAt: string;
  mode: "quick" | "full";
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  targetHardwareTemplateId: string | null;
  scenario: CapacityScenario;
  localOnly: true;
  rtspOrigin: "rtsp://127.0.0.1";
  aiqOrigin: "http://127.0.0.1";
  inferenceProvider: "aiq_local";
  phases: Array<{ name: "warmup" | "sustained" | "surge"; durationSeconds: number; loadPercent: number }>;
  sourceProfiles: Array<Pick<CameraSourceProfile, "codec" | "width" | "height" | "sourceFps" | "bitrateMbps">>;
  requestedInferenceFps: number[];
  instructions: string[];
}

export interface PublicBenchmarkObservation {
  id: string;
  hardwareTemplateId: string;
  stage: CalibrationStage;
  profileId: string;
  benchmarkName: string;
  benchmarkVersion: string;
  score: number;
  unit: string;
  higherIsBetter: true;
  sourceTier: 1 | 2 | 3;
  sourceUrl: string;
  observedAt: string;
  operatingSystem: OperatingSystemFamily | "any";
  configuration: string;
}

export interface EvidenceCatalogSnapshot {
  schemaVersion: typeof EVIDENCE_CATALOG_VERSION;
  catalogVersion: string;
  generatedAt: string;
  observations: PublicBenchmarkObservation[];
}

export interface StagePrediction {
  stage: CalibrationStage;
  profileId: string;
  anchorRunIds: string[];
  anchorHardwareIds: string[];
  ratios: number[];
  rawCameraCapacity: number;
  safeCameraCapacity: number;
  reservePercent: number;
  sourceUrls: string[];
}

export interface CapacityPrediction {
  schemaVersion: typeof CAPACITY_PREDICTION_VERSION;
  id: string;
  hardwareTemplateId: string;
  generatedAt: string;
  status: CalibrationStatus;
  confidenceClass: CalibrationConfidenceClass;
  safeCameraMinimum: number | null;
  safeCameraMaximum: number | null;
  bottleneck: CalibrationStage | null;
  reservePercent: number;
  exactCalibrationRunId: string | null;
  stagePredictions: StagePrediction[];
  leaveOneOutUnsafeOverestimateCount: number;
  reasons: string[];
}

export interface CatalogCollectionResult {
  source: string;
  status: "collected" | "skipped" | "failed";
  quotes: PriceQuote[];
  reason: string;
}
