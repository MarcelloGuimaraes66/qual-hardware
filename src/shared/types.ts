export const WORKLOAD_CONTRACT_VERSION = "perceptrum-workload/3.1.0" as const;
export type WorkloadContractVersion =
  | typeof WORKLOAD_CONTRACT_VERSION
  | "perceptrum-workload/3.0.0"
  | "perceptrum-workload/2.0.0"
  | "perceptrum-workload/1.1.0"
  | "perceptrum-workload/1.0.0";

export const LEGACY_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/1.0.0" as const;
export const TELEMETRY_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/1.1.0" as const;
export const LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/2.0.0" as const;
export const CALIBRATION_HANDOFF_VERSION = "qual-hardware-calibration-handoff/1.0.0" as const;
export const CALIBRATION_PLAN_VERSION = "qual-hardware-calibration-plan/1.0.0" as const;
export const BENCHMARK_SUITE_VERSION = "qual-hardware-benchmark-suite/1.0.0" as const;
export const COMPONENT_CATALOG_VERSION = "qual-hardware-component-catalog/2.0.0" as const;
export const COMPONENT_TECHNICAL_SPECIFICATION_VERSION = "qual-hardware-component-technical-specification/1.0.0" as const;
export const PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION = "qual-hardware-procurement-neutral-specification/1.0.0" as const;
export const TR_TECHNICAL_ANNEX_VERSION = "qual-hardware-tr-technical-annex/1.0.0" as const;
export const BENCHMARK_OBSERVATION_VERSION = "qual-hardware-benchmark-observation/2.0.0" as const;
export const COMPONENT_BUILD_VERSION = "qual-hardware-component-build/1.0.0" as const;
export const EVIDENCE_CATALOG_VERSION = "qual-hardware-evidence-catalog/4.0.0" as const;
export const CAPACITY_PREDICTION_VERSION = "qual-hardware-capacity-prediction/3.0.0" as const;
export const CAPACITY_RECOMMENDATION_EXPORT_VERSION = "capacity-recommendation-export/5.0.0" as const;
export const SOURCE_REGISTRY_VERSION = "qual-hardware-source-registry/1.0.0" as const;
export const CATALOG_BUNDLE_VERSION = "qual-hardware-catalog-bundle/1.0.0" as const;

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
export type ProcurementEligibility = "eligible" | "planning_only" | "blocked";
export type CalibrationStage =
  | "rtsp_ingest"
  | "video_decode"
  | "bgr_processing"
  | "video_encode"
  | "disk_write"
  | "disk_read"
  | "frame_extraction"
  | "local_inference"
  | "memory_bandwidth"
  | "network_ingest"
  | "job_scheduler"
  | "intelligence_scheduler"
  | "database_persistence"
  | "dashboard_queries"
  | "thermal_sustain";
export type TelemetryEvidenceStatus = "measured" | "unavailable" | "failed" | "not_applicable";
export type CalibrationValidationStatus = "diagnostic" | "anchor_approved" | "invalid";
export type CalibrationSessionState = "pending" | "launching" | "running" | "cancelling" | "cancelled" | "completed" | "failed" | "expired";

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
  hardwareTemplateId: string | null;
  componentId?: string | null;
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
  sourceId?: string;
  scope?: "component" | "system";
  gtin?: string | null;
  sku?: string | null;
  contentHash?: string;
  evidenceLocator?: string;
  retrievedAt?: string;
  validUntil?: string;
}

export type CatalogSourceCategory = "specification" | "oem" | "price" | "benchmark" | "exchange_rate";
export type CatalogSourceParser = "api" | "json_ld" | "sitemap" | "csv" | "html_table" | "pdf";
export type CatalogSourceState = "active" | "degraded" | "unavailable" | "disabled";

export interface CatalogSource {
  id: string;
  organization: string;
  primaryUrl: string;
  discoveryUrls: string[];
  allowedHosts: string[];
  allowedRedirectHosts: string[];
  category: CatalogSourceCategory;
  markets: Market[];
  currencies: Currency[];
  parser: CatalogSourceParser;
  products: string[];
  trustTier: 1 | 2 | 3;
  maxRequestsPerRun: number;
  minimumIntervalMs: number;
  robotsRequired: boolean;
  state: CatalogSourceState;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  notes: string[];
}

export interface SourceRegistry {
  schemaVersion: typeof SOURCE_REGISTRY_VERSION;
  generatedAt: string;
  sources: CatalogSource[];
}

export interface SourceFetchRun {
  id: string;
  sourceId: string;
  startedAt: string;
  completedAt: string | null;
  status: "collected" | "skipped" | "failed";
  httpStatus: number | null;
  observationCount: number;
  rejectedCount: number;
  message: string;
  error: string | null;
}

export interface SourceObservation {
  id: string;
  sourceId: string;
  retrievedAt: string;
  url: string;
  contentType: string;
  contentHash: string;
  evidenceLocator: string;
  payload: Record<string, unknown>;
}

export interface CatalogBundleSourceHealth {
  active: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  failedPercent: number;
}

export interface CatalogBundle {
  schemaVersion: typeof CATALOG_BUNDLE_VERSION;
  channel: "stable";
  sequence: number;
  publicationId: string;
  catalogVersion: string;
  generatedAt: string;
  publishedAt: string;
  validUntil: string;
  previousBundleSha256: string | null;
  collectorCommit: string;
  qwen: {
    model: string;
    modelSha256: string;
    promptVersion: string;
    used: boolean;
    temperature?: 0;
    mode?: "/no_think";
    profileVersion?: string;
    parameterBillions?: number;
    quantization?: string;
    sizeBytes?: number;
    selection?: "pinned_ci" | "explicit" | "auto_detected";
  };
  markets: Market[];
  hardware: HardwareNodeTemplate[];
  components: HardwareComponent[];
  benchmarks: PublicBenchmarkObservation[];
  prices: PriceQuote[];
  sources: CatalogSource[];
  sourceHealth: CatalogBundleSourceHealth;
  summary: {
    added: number;
    updated: number;
    unchanged: number;
    rejected: number;
    checkedWithoutChanges: boolean;
  };
}

export interface SignedCatalogBundle {
  payload: CatalogBundle;
  keyId: string;
  signature: string;
}

export interface CatalogPublication {
  sequence: number;
  publicationId: string;
  catalogVersion: string;
  bundleSha256: string;
  previousBundleSha256: string | null;
  keyId: string;
  publishedAt: string;
  validUntil: string;
  etag: string | null;
  sourceHealth: CatalogBundleSourceHealth;
  summary: CatalogBundle["summary"];
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
  lastUpdate?: CatalogUpdateRun | null;
  channel: "official_public" | "legacy_admin" | "bundled";
  automatic: boolean;
  latestSequence: number | null;
  lastPublicationAt: string | null;
  nextCollectionExpectedAt: string | null;
  publicationDelayDays: number;
  markets: Market[];
  componentCount: number;
  benchmarkCount: number;
  sourceHealth: CatalogBundleSourceHealth;
  latestSummary: CatalogBundle["summary"] | null;
}

export interface CatalogUpdateRun {
  id: string;
  updateType: "inventory_prices" | "evidence";
  status: "checking" | "verified" | "applied" | "failed";
  startedAt: string;
  completedAt: string | null;
  source: "remote" | "imported" | "cached";
  fromVersion: string | null;
  toVersion: string | null;
  added: number;
  updated: number;
  unchanged: number;
  rejected: number;
  message: string;
  error: string | null;
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
  procurementEligibility: ProcurementEligibility;
  warnings: string[];
  calibration?: CapacityPrediction;
  /** Additive v4 audit fields. Older stored recommendations legitimately omit them. */
  bom?: ComponentBuild;
  stagePredictions?: StagePrediction[];
  coverage?: EvidenceCoverageSummary;
  procurementGate?: ProcurementGate;
  /** Additive v5 reporting and procurement fields. */
  commercialReference?: CommercialRecommendationReference;
  procurementNeutralSpecification?: ProcurementNeutralSpecification;
  marketCompetitionAssessment?: MarketCompetitionAssessment;
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
  gpuVramBytes: number | null;
  unifiedMemoryBytes?: number | null;
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
  safeCameraCapacity: number | null;
  throughput: number | null;
  throughputUnit: string;
  p95LatencyMs: number | null;
  peakUtilizationPercent: number | null;
  queueGrowthPerMinute: number;
  thermalThrottlePercent: number | null;
  evidenceStatus?: TelemetryEvidenceStatus;
  reason?: string;
  measurementSource?: string;
  utilizationEvidence?: string[];
  details?: Record<string, unknown>;
}

export interface CalibrationPhaseMetric {
  name: "warmup" | "ramp" | "sustained" | "surge";
  durationSeconds: number;
  loadPercent: number;
  cameraCount: number;
  inferenceSuccessRate: number;
  p99InferenceLatencyMs?: number;
  inferenceIntervalMs?: number;
  inferenceIntervalSeconds?: number;
  maxQueueDepth: number;
  queueGrowthPerMinute: number;
  outOfMemoryCount: number;
  plannedDecodedFrames?: number;
  decodedFrames?: number;
  frameDeliveryRate?: number;
  thermalThrottlePercent?: number | null;
}

export interface TelemetryCapability {
  id: string;
  status: TelemetryEvidenceStatus;
  provider: string;
  reason?: string;
}

export interface TelemetryMetricSummary {
  samples: number;
  average: number;
  p95: number;
  p99: number;
  peak: number;
}

export interface CalibrationResourceSummary {
  phase: string;
  cpuUtilizationPercent?: TelemetryMetricSummary | null;
  memoryUsedBytes?: TelemetryMetricSummary | null;
  loadAverage?: TelemetryMetricSummary | null;
  gpuUtilizationPercent?: TelemetryMetricSummary | null;
  gpuMemoryUsedBytes?: TelemetryMetricSummary | null;
  gpuDecoderUtilizationPercent?: TelemetryMetricSummary | null;
  gpuEncoderUtilizationPercent?: TelemetryMetricSummary | null;
  gpuTemperatureCelsius?: TelemetryMetricSummary | null;
  gpuPowerWatts?: TelemetryMetricSummary | null;
  cpuPowerWatts?: TelemetryMetricSummary | null;
  [key: string]: string | TelemetryMetricSummary | null | undefined;
}

export interface CalibrationProcessGroupSummary {
  group: "perceptrum" | "ffmpeg" | "mediamtx" | "aiq" | string;
  sampleCount: number;
  cpuUtilizationPercent?: TelemetryMetricSummary | null;
  residentMemoryBytes?: TelemetryMetricSummary | null;
  cumulativeCpuSeconds?: TelemetryMetricSummary | null;
  [key: string]: string | number | TelemetryMetricSummary | null | undefined;
}

export interface LocalCalibrationRun {
  schemaVersion:
    | typeof LOCAL_CALIBRATION_VERSION
    | typeof TELEMETRY_LOCAL_CALIBRATION_VERSION
    | typeof LEGACY_LOCAL_CALIBRATION_VERSION;
  id: string;
  planId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION | "perceptrum-workload/3.0.0" | "perceptrum-workload/2.0.0";
  mode: "quick" | "full";
  executionMode?: "readiness" | "production_pipeline";
  developmentOnly?: true;
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
  overallSafeCameraCapacity: number | null;
  bottleneck: CalibrationStage;
  pipelineEvidence?: {
    complete: boolean;
    isolatedDatabase: boolean;
    sourceRegistered: boolean;
    rtspClipProvided: boolean;
    intelligenceJobQueued: boolean;
    schedulerClaimedJob: boolean;
    aiqLocalCompleted: boolean;
    resultPersisted: boolean;
    jobSchedulerExecuted?: boolean;
    jobRuntimeExecuted?: boolean;
    jobStepRunsPersisted?: boolean;
    databaseWritesPersisted?: boolean;
    intelligenceSchedulerExecuted?: boolean;
    dashboardQueriesExecuted?: boolean;
    concurrentWithLoad?: boolean;
    phaseCoverage?: Array<{ phase: "warmup" | "ramp" | "sustained" | "surge"; completedProbeCount: number; failedProbeCount?: number }>;
    [key: string]: unknown;
  };
  qualityGate?: {
    eligibleForCapacityExtrapolation: boolean;
    evidenceLevel: "validated_local" | "representative_only";
    validationStatus?: CalibrationValidationStatus;
    failures: string[];
    warnings: string[];
  };
  advancedTelemetryRequested?: boolean;
  telemetrySampleIntervalMs?: number;
  telemetrySampleCount?: number;
  telemetryCapabilities?: TelemetryCapability[];
  resourceSummaries?: CalibrationResourceSummary[];
  processGroups?: CalibrationProcessGroupSummary[];
  artifact?: {
    fileName: string;
    payloadSha256: string;
    persistedAt: string;
    storage: "documents_append_only";
  };
  notes: string[];
}

export interface CalibrationHandoff {
  schemaVersion: typeof CALIBRATION_HANDOFF_VERSION;
  sessionId: string;
  callbackOrigin: string;
  token: string;
  expiresAt: string;
  planId: string;
}

export interface CalibrationSessionProgress {
  phase?: string;
  stage?: string;
  percent?: number;
  message?: string;
  updatedAt: string;
}

export interface CalibrationSession {
  id: string;
  planId: string;
  recommendationId: string;
  scenarioId: string;
  mode: "quick" | "full";
  advancedTelemetry: boolean;
  state: CalibrationSessionState;
  createdAt: string;
  expiresAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  progress: CalibrationSessionProgress | null;
  result: LocalCalibrationRun | null;
  error: string | null;
}

export interface CalibrationSessionRecord extends CalibrationSession {
  tokenHash: string;
  plan: CalibrationPlan;
}

export interface CalibrationPlan {
  schemaVersion: typeof CALIBRATION_PLAN_VERSION;
  id: string;
  createdAt: string;
  mode: "quick" | "full";
  executionMode: "readiness" | "production_pipeline";
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  targetHardwareTemplateId: string | null;
  scenario: CapacityScenario;
  localOnly: true;
  rtspOrigin: "rtsp://127.0.0.1";
  aiqOrigin: "http://127.0.0.1";
  inferenceProvider: "aiq_local";
  phases: Array<{ name: "warmup" | "ramp" | "sustained" | "surge"; durationSeconds: number; loadPercent: number }>;
  sourceProfiles: Array<Pick<CameraSourceProfile, "codec" | "width" | "height" | "sourceFps" | "bitrateMbps">>;
  requestedInferenceFps: number[];
  instructions: string[];
}

export type HardwareComponentKind =
  | "cpu"
  | "gpu"
  | "motherboard"
  | "memory_kit"
  | "storage_os"
  | "storage_retention"
  | "nic"
  | "psu"
  | "cooling"
  | "chassis"
  | "oem_system"
  | "rack_configuration"
  /** Legacy v1–v3 kinds remain readable. */
  | "memory"
  | "storage"
  | "network"
  | "system";

export type ComponentInventoryState = "discovered_inventory" | "qualified_recommendation_universe";
export type ComponentMarketState = "active" | "discontinued" | "reference_only";
export type ComponentGeneration = "current" | "previous" | "two_generations_back" | "historical";

export interface ComponentSpecificationEvidence {
  sourceId: string;
  url: string;
  retrievedAt: string;
  evidenceLocator: string;
  rawArtifactSha256: string;
  licensePolicy: string;
}

export type TechnicalSpecificationFieldStatus =
  | "published"
  | "not_published"
  | "not_applicable"
  | "ambiguous"
  | "conflicting"
  | "rejected";
export type TechnicalSpecificationValueType = "string" | "number" | "boolean";
export type TechnicalSpecificationRole = "compatibility" | "dimensioning" | "procurement" | "informational";

export interface TechnicalSpecificationField {
  code: string;
  labelPt: string;
  valueType: TechnicalSpecificationValueType;
  value: string | number | boolean | null;
  unit: string | null;
  originalLabel: string | null;
  originalValue: string | number | boolean | null;
  status: TechnicalSpecificationFieldStatus;
  required: boolean;
  roles: TechnicalSpecificationRole[];
  sourceEvidence: ComponentSpecificationEvidence[];
  confidence: "official" | "derived_legacy" | "unverified";
  normalizationRule: string | null;
}

export interface ComponentSpecificationCompleteness {
  requiredFieldCount: number;
  publishedRequiredFieldCount: number;
  missingRequiredFieldCodes: string[];
  conflictingFieldCodes: string[];
  percent: number;
  complete: boolean;
  procurementReady: boolean;
  reasons: string[];
}

export interface ComponentTechnicalSpecification {
  schemaVersion: typeof COMPONENT_TECHNICAL_SPECIFICATION_VERSION;
  componentId: string;
  specificationVersion: string;
  generatedAt: string;
  fields: TechnicalSpecificationField[];
  completeness: ComponentSpecificationCompleteness;
}

export interface ComponentCompatibility {
  socket?: string | null;
  chipsets?: string[];
  minimumBios?: string | null;
  memoryType?: string | null;
  memoryChannels?: number | null;
  maximumMemoryGb?: number | null;
  ecc?: boolean | null;
  pcieGeneration?: number | null;
  pcieLanesRequired?: number | null;
  slotsWide?: number | null;
  lengthMm?: number | null;
  heightMm?: number | null;
  continuousPowerWatts?: number | null;
  transientPowerWatts?: number | null;
  coolingCapacityWatts?: number | null;
  supportedCodecs?: Codec[];
  operatingSystems?: OperatingSystemFamily[];
  accelerationBackends?: string[];
  oemLocked?: boolean;
  replaceableComponentKinds?: HardwareComponentKind[];
}

export interface HardwareComponent {
  id: string;
  kind: HardwareComponentKind;
  manufacturer: string;
  sku: string;
  architecture: string;
  specifications: Record<string, string | number | boolean | null>;
  sourceUrls: string[];
  canonicalMpn?: string;
  aliases?: string[];
  generation?: ComponentGeneration;
  marketState?: ComponentMarketState;
  inventoryState?: ComponentInventoryState;
  specificationVersion?: string;
  compatibility?: ComponentCompatibility;
  evidence?: ComponentSpecificationEvidence[];
  /** Additive v8 normalized specification. Legacy components may omit it. */
  technicalSpecification?: ComponentTechnicalSpecification;
  discoveredAt?: string;
  updatedAt?: string;
}

export interface ComponentCatalog {
  schemaVersion: typeof COMPONENT_CATALOG_VERSION | "qual-hardware-component-catalog/1.0.0";
  catalogVersion: string;
  generatedAt: string;
  components: HardwareComponent[];
}

export type NeutralRequirementComparator = "minimum" | "maximum" | "range" | "equals" | "supports" | "prohibited";

export interface CommercialComponentReference {
  componentId: string;
  kind: HardwareComponentKind;
  role: ComponentBuildItem["role"];
  quantityPerNode: number;
  manufacturer: string;
  model: string;
  canonicalMpn: string;
  specificationCompletenessPercent: number;
  sourceUrls: string[];
}

export interface CommercialRecommendationReference {
  hardwareTemplateId: string;
  hardwareName: string;
  nodeCount: number;
  activeNodeCount: number;
  operatingSystem: OperatingSystemFamily;
  currency: Currency;
  projectPrice: number | null;
  priceBasis: PriceSummary["basis"];
  components: CommercialComponentReference[];
}

export interface NeutralProcurementRequirement {
  id: string;
  componentKind: HardwareComponentKind;
  componentRole: ComponentBuildItem["role"];
  characteristicCode: string;
  characteristic: string;
  comparator: NeutralRequirementComparator;
  value: string | number | boolean;
  maximumValue?: number;
  unit: string | null;
  mandatory: boolean;
  rationale: string;
  proofMethod: "official_datasheet" | "independent_benchmark" | "technical_proposal" | "sample_or_poc";
  acceptanceCriterion: string;
  sourceStage: CalibrationStage | "compatibility" | "capacity" | "lifecycle";
  quantityPerNode: number;
  projectQuantity: number;
  matchingComponentIds: string[];
}

export interface MarketCompetitionAssessment {
  status: "adequate" | "limited" | "restricted" | "no_coverage";
  matchingProductCount: number;
  distinctManufacturerCount: number;
  matchingComponentIds: string[];
  manufacturerNames: string[];
  safeForPublication: boolean;
  reasons: string[];
}

export interface ProcurementNeutralSpecification {
  schemaVersion: typeof PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION;
  id: string;
  recommendationAlternativeId: string;
  generatedAt: string;
  nodeCount: number;
  activeNodeCount: number;
  status: "apt" | "review_required" | "blocked";
  procurementEligibility: ProcurementEligibility;
  requirements: NeutralProcurementRequirement[];
  marketCompetitionAssessment: MarketCompetitionAssessment;
  forbiddenIdentifierFindings: string[];
  disclaimers: string[];
}

export interface TrTechnicalAnnex {
  schemaVersion: typeof TR_TECHNICAL_ANNEX_VERSION;
  generatedAt: string;
  scenarioId: string;
  projectName: string;
  totalCameras: number;
  specifications: ProcurementNeutralSpecification[];
  legalNotice: string;
}

export interface ComponentBuildItem {
  componentId: string;
  kind: HardwareComponentKind;
  quantity: number;
  role: "compute" | "acceleration" | "platform" | "memory" | "operating_storage" | "retention_storage" | "network" | "power" | "cooling" | "chassis" | "oem_system";
  required: boolean;
}

export interface CompatibilityDecision {
  compatible: boolean;
  code: string;
  message: string;
  componentIds: string[];
  sourceUrls: string[];
}

export interface ProcurementGate {
  eligibility: ProcurementEligibility;
  status: "apt_for_procurement" | "planning" | "blocked";
  reasons: string[];
  comparablePhysicalAnchors: number;
  requiredPhysicalAnchors: 3;
  completeStageCoverage: boolean;
}

export interface EvidenceCoverageStage {
  stage: CalibrationStage;
  required: boolean;
  componentIds: string[];
  eligibleObservationIds: string[];
  referenceObservationIds: string[];
  physicalAnchorRunIds: string[];
  covered: boolean;
  reasons: string[];
}

export interface EvidenceCoverageSummary {
  requiredStageCount: number;
  coveredStageCount: number;
  percent: number;
  complete: boolean;
  eligibleObservationCount: number;
  referenceObservationCount: number;
  physicalAnchorCount: number;
  stages: EvidenceCoverageStage[];
}

export interface ComponentBuild {
  schemaVersion: typeof COMPONENT_BUILD_VERSION;
  id: string;
  kind: "oem_exact" | "custom_bom" | "historical_template";
  name: string;
  hardwareTemplateId: string | null;
  operatingSystem: OperatingSystemFamily;
  items: ComponentBuildItem[];
  compatibility: CompatibilityDecision[];
  coverage: EvidenceCoverageSummary;
  procurementGate: ProcurementGate;
  sourceUrls: string[];
  createdAt: string;
}

export interface PublicBenchmarkObservation {
  schemaVersion?: typeof BENCHMARK_OBSERVATION_VERSION | "qual-hardware-benchmark-observation/1.0.0";
  id: string;
  hardwareTemplateId: string;
  stage: CalibrationStage;
  profileId: string;
  benchmarkName: string;
  benchmarkVersion: string;
  score: number;
  unit: string;
  higherIsBetter: boolean;
  componentId?: string;
  componentKind?: HardwareComponentKind;
  sourceTier: 1 | 2 | 3;
  sourceUrl: string;
  observedAt: string;
  operatingSystem: OperatingSystemFamily | "any";
  configuration: string;
  powerWatts?: number | null;
  driverVersion?: string | null;
  coolingProfile?: string | null;
  sampleCount?: number;
  qualityFlags?: string[];
  benchmarkSuiteId?: string;
  metricName?: string;
  aggregation?: "single" | "mean" | "median" | "p95" | "p99" | "peak" | "rate";
  systemFingerprint?: Record<string, string | number | boolean | null>;
  evidenceLocator?: string;
  rawArtifactSha256?: string;
  licensePolicy?: string;
  reproducible?: boolean;
  originalValue?: number;
  originalUnit?: string;
  componentIds?: string[];
  direction?: "higher_is_better" | "lower_is_better";
  eligibility?: "eligible" | "reference_only" | "rejected";
  rejectionReasons?: string[];
}

export interface EvidenceCatalogSnapshot {
  schemaVersion: typeof EVIDENCE_CATALOG_VERSION | "qual-hardware-evidence-catalog/3.0.0" | "qual-hardware-evidence-catalog/2.0.0";
  catalogVersion: string;
  generatedAt: string;
  components?: HardwareComponent[];
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
  empiricalOverpredictionPercent?: number;
  repeatVariabilityPercent?: number;
  medianAbsoluteErrorPercent?: number;
  sourceUrls: string[];
}

export interface CapacityPrediction {
  schemaVersion: typeof CAPACITY_PREDICTION_VERSION;
  id: string;
  hardwareTemplateId: string;
  generatedAt: string;
  status: CalibrationStatus;
  procurementEligibility: ProcurementEligibility;
  confidenceClass: CalibrationConfidenceClass;
  safeCameraMinimum: number | null;
  safeCameraMaximum: number | null;
  bottleneck: CalibrationStage | null;
  reservePercent: number;
  exactCalibrationRunId: string | null;
  stagePredictions: StagePrediction[];
  leaveOneOutUnsafeOverestimateCount: number;
  medianAbsoluteErrorPercent?: number | null;
  reasons: string[];
}

export interface CatalogCollectionResult {
  source: string;
  status: "collected" | "skipped" | "failed";
  quotes: PriceQuote[];
  reason: string;
}
