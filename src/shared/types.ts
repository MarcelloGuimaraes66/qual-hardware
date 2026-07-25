export const WORKLOAD_CONTRACT_VERSION = "perceptrum-workload/4.0.0" as const;
export type WorkloadContractVersion =
  | typeof WORKLOAD_CONTRACT_VERSION
  | "perceptrum-workload/3.1.0"
  | "perceptrum-workload/3.0.0"
  | "perceptrum-workload/2.0.0"
  | "perceptrum-workload/1.1.0"
  | "perceptrum-workload/1.0.0";

export const LEGACY_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/1.0.0" as const;
export const TELEMETRY_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/1.1.0" as const;
export const LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/2.0.0" as const;
export const INITIAL_AUTONOMOUS_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/3.0.0" as const;
export const LEGACY_AUTONOMOUS_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/4.0.0" as const;
export const PREVIOUS_AUTONOMOUS_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/5.0.0" as const;
export const PRE_CERTIFICATION_AUTONOMOUS_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/6.0.0" as const;
export const AUTONOMOUS_LOCAL_CALIBRATION_VERSION = "qual-hardware-local-calibration/7.0.0" as const;
export const CALIBRATION_KERNEL_VERSION = "qual-hardware-calibration-kernel/4.0.0" as const;
export const PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT = "d918faa0ecd6a9906b711039e5d89f78e0536c44" as const;
export const PERCEPTRUM_AUTHORITY_CONTRACT_VERSION = "perceptrum-authority-contract/2.0.0" as const;
export const LEGACY_CALIBRATION_PLAN_VERSION = "qual-hardware-calibration-plan/1.0.0" as const;
export const CALIBRATION_PLAN_VERSION = "qual-hardware-calibration-plan/4.0.0" as const;
export const CALIBRATION_PROGRESS_VERSION = "qual-hardware-calibration-progress/2.0.0" as const;
export const CALIBRATION_CHECKPOINT_VERSION = "qual-hardware-calibration-checkpoint/1.0.0" as const;
export const INITIAL_QHCAL_PACKAGE_VERSION = "qual-hardware-calibration-package/1.0.0" as const;
export const INITIAL_QHCALSET_PACKAGE_VERSION = "qual-hardware-calibration-collection/1.0.0" as const;
export const LEGACY_QHCAL_PACKAGE_VERSION = "qual-hardware-calibration-package/2.0.0" as const;
export const LEGACY_QHCALSET_PACKAGE_VERSION = "qual-hardware-calibration-collection/2.0.0" as const;
export const PREVIOUS_QHCAL_PACKAGE_VERSION = "qual-hardware-calibration-package/3.0.0" as const;
export const PREVIOUS_QHCALSET_PACKAGE_VERSION = "qual-hardware-calibration-collection/3.0.0" as const;
export const QHCAL_PACKAGE_VERSION = "qual-hardware-calibration-package/4.0.0" as const;
export const QHCALSET_PACKAGE_VERSION = "qual-hardware-calibration-collection/4.0.0" as const;
export const BENCHMARK_SUITE_VERSION = "qual-hardware-benchmark-suite/1.0.0" as const;
export const LEGACY_COMPONENT_CATALOG_VERSION = "qual-hardware-component-catalog/2.0.0" as const;
export const COMPONENT_CATALOG_VERSION = "qual-hardware-component-catalog/3.0.0" as const;
export const LEGACY_COMPONENT_TECHNICAL_SPECIFICATION_VERSION = "qual-hardware-component-technical-specification/1.0.0" as const;
export const COMPONENT_TECHNICAL_SPECIFICATION_VERSION = "qual-hardware-component-technical-specification/2.0.0" as const;
export const MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION = "qual-hardware-manufacturer-specification-observation/1.0.0" as const;
export const DETAILED_COMMERCIAL_REPORT_VERSION = "qual-hardware-detailed-commercial-report/1.0.0" as const;
export const PROCUREMENT_NEUTRAL_SPECIFICATION_VERSION = "qual-hardware-procurement-neutral-specification/1.0.0" as const;
export const TR_TECHNICAL_ANNEX_VERSION = "qual-hardware-tr-technical-annex/1.0.0" as const;
export const BENCHMARK_OBSERVATION_VERSION = "qual-hardware-benchmark-observation/2.0.0" as const;
export const COMPONENT_BUILD_VERSION = "qual-hardware-component-build/1.0.0" as const;
export const EVIDENCE_CATALOG_VERSION = "qual-hardware-evidence-catalog/4.0.0" as const;
export const CAPACITY_PREDICTION_VERSION = "qual-hardware-capacity-prediction/3.0.0" as const;
export const CAPACITY_RECOMMENDATION_EXPORT_VERSION = "capacity-recommendation-export/7.0.0" as const;
export const CALIBRATION_HARDWARE_VERSION = "qual-hardware-calibration-hardware/2.0.0" as const;
export const CALIBRATION_COMPUTE_EVIDENCE_VERSION = "qual-hardware-calibration-compute-evidence/2.0.0" as const;
export const CALIBRATION_RUNTIME_MANIFEST_VERSION = "qual-hardware-calibration-runtime-manifest/3.0.0" as const;
export const FLEET_PLAN_VERSION = "qual-hardware-fleet-plan/1.0.0" as const;
export const CALIBRATION_DIAGNOSTIC_REPORT_VERSION = "qual-hardware-calibration-diagnostic-report/1.0.0" as const;
export const PREVIOUS_EXECUTION_ENVIRONMENT_VERSION = "qual-hardware-execution-environment/1.0.0" as const;
export const EXECUTION_ENVIRONMENT_VERSION = "qual-hardware-execution-environment/2.0.0" as const;
export const QWEN_VISION_SELECTION_VERSION = "qual-hardware-qwen-vision-selection/2.0.0" as const;
export const QWEN_MODEL_CERTIFICATION_CONTRACT_VERSION = "qual-hardware-qwen3-vl-approved-revisions/1.0.0" as const;
export const QWEN_MODEL_PROBE_VERSION = "qual-hardware-qwen-model-probe/1.0.0" as const;
export const NATIVE_BENCHMARK_VERSION = "qual-hardware-native-benchmark/1.0.0" as const;
export const MAX_PROJECT_CAMERAS = 1_000_000 as const;
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
export type AgentExecutionBackend = "local_aiq" | "remote_vision" | "native_cv";
export type AgentExecutionScope = "camera_agent" | "inference_group";
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
export type CalibrationMode = "quick" | "validation" | "qualification";
export type CalibrationSessionState =
  | "pending"
  | "preflight"
  | "discovering"
  | "validating"
  | "qualifying"
  | "finalizing"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted"
  | "expired";
export type CalibrationCleanupState = "not_started" | "pending" | "cleaning" | "completed" | "failed";
export type CalibrationTemporaryFileState = "active" | "reclaimable" | "deleted" | "retained";
export type CalibrationDeviceTrust = "pending" | "trusted" | "revoked";
export type CalibrationComputeMode = "cpu_only" | "gpu_accelerated";
export type CalibrationGpuInferenceBackend = "cuda" | "metal" | "vulkan" | "rocm" | "sycl" | "unavailable";
export type CalibrationGpuMediaBackend =
  | "cuda_nvenc"
  | "videotoolbox"
  | "qsv"
  | "d3d11va_amf"
  | "vaapi"
  | "unavailable";
export type CalibrationProbeOutcome = "pass" | "capacity_fail" | "infrastructure_error" | "cancelled";
export type CalibrationCapacityBound = "exact" | "at_least" | "interval" | "inconclusive" | "uncertain";
export type CalibrationGpuClassification = "compute" | "media_only" | "display_only" | "unavailable";
export type CalibrationNetworkEvidence =
  | "loopback_measured_physical_link_unverified"
  | "loopback_measured_physical_link_spec_verified"
  | "unavailable";

export interface AgentFeatures {
  onlyCaptureOnMotion: boolean;
  temporal: boolean;
  regions: number;
  croppedFrame: boolean;
  faceReferences: number;
  negativeReferences: number;
}

export interface PerceptrumAuthorityContract {
  schemaVersion: typeof PERCEPTRUM_AUTHORITY_CONTRACT_VERSION;
  repository: "perceptrum_desktop_aspp";
  legacyCompatibleCommit: typeof PERCEPTRUM_CALIBRATION_AUTHORITY_COMMIT;
  capturedAt: string;
  status: "verified" | "drifted" | "unavailable";
  behaviorSnapshotSha256: string;
  files: Array<{
    role: "jobs_ui" | "job_types" | "job_runtime" | "agent_runtime" | "camera_session" | "frame_writer";
    path: string;
    sizeBytes: number;
    sha256: string;
  }>;
  rules: {
    videoModelFps: { minimum: 1; maximum: 10 };
    individualCadenceSeconds: [10, 60];
    groupCadenceSeconds: [10, 60, 300, 600];
    imageWritesSnapshotEverySeconds: 10;
    sharedDecodeWithinCamera: true;
    videoCaptureDominatesMixedCamera: true;
    inferenceCallsRemainAdditive: true;
  };
}

export interface AgentLoad {
  id: string;
  name: string;
  model: InferenceModel;
  inputType: InputType;
  packaging: PackagingMode;
  modelFps: number;
  runEverySeconds: 10 | 60 | 300 | 600;
  /** Derived automatically for legacy scenarios when omitted. */
  executionBackend?: AgentExecutionBackend | undefined;
  /** Perceptrum executes either one Agent per camera or one grouped inference. */
  executionScope?: AgentExecutionScope | undefined;
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
  /** Markets searched for compatible hardware and current quotations. Omitted by scenarios saved before multi-market search. */
  markets?: Market[] | undefined;
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
  /** Additive topology fields. Legacy catalog entries are interpreted as one socket. */
  cpuSocketCount?: number;
  coresPerSocket?: number;
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
  /** Number of identical nodes represented by this row in very large fleets. */
  representedNodeCount?: number;
  role: "active" | "reserve";
  cameraGroups: Array<{ groupId: string; groupName: string; cameras: number }>;
  demand: ResourceDemand;
  utilization: Record<keyof ResourceDemand, number>;
}

export interface FleetPlan {
  schemaVersion: typeof FLEET_PLAN_VERSION;
  status: "single_node_validated" | "planning_only" | "blocked";
  workloadSignature: string;
  projectCameraCount: number;
  safeCamerasPerServer: number;
  activeServers: number;
  reserveServers: number;
  totalServers: number;
  redundancyPolicy: "n_plus_one" | "ten_percent_minimum_two";
  perServer: {
    cpuSockets: number;
    physicalCores: number;
    logicalCores: number;
    ramBytes: number;
    gpuCount: number;
    gpuVramBytes: number | null;
    networkGbps: number;
    storageBytes: number;
  };
  totals: {
    cpuSockets: number;
    physicalCores: number;
    logicalCores: number;
    ramBytes: number;
    gpuCount: number;
    gpuVramBytes: number | null;
    networkGbps: number;
    storageBytes: number;
  };
  bottleneck: CalibrationStage | keyof ResourceDemand;
  maximumAdditionalCameras: number;
  degradedSafeCamerasPerServer: number | null;
  assumptions: string[];
  requiredClusterPilotTests: string[];
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
  /** Additive v7 multi-server plan. */
  fleetPlan?: FleetPlan;
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
  qwenCertification?: QwenStackCertification;
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
  formFactor: Exclude<InfrastructureKind, "either"> | "unknown";
  coolingProfile: string;
  perceptrumBuildHash: string;
  aiqModel: string;
  aiqModelHash: string;
  inferenceBackend: string;
  cpuPackages?: CalibrationCpuPackage[];
  processorGroups?: CalibrationProcessorGroup[];
  numaNodes?: CalibrationNumaNode[];
  gpuDevices?: CalibrationGpuDevice[];
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
  computeMode?: CalibrationComputeMode;
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
  gpuDeviceId?: string;
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

export interface CalibrationCpuPackage {
  id: string;
  model: string;
  physicalCores: number;
  logicalCores: number;
  processorGroupIds: number[];
  numaNodeIds: number[];
}

export interface CalibrationProcessorGroup {
  id: number;
  logicalProcessorCount: number;
  activeProcessorMask: string | null;
}

export interface CalibrationNumaNode {
  id: number;
  processorGroupIds: number[];
  logicalProcessorCount: number;
  memoryBytes: number | null;
  cpuPackageIds: string[];
}

export interface CalibrationGpuDevice {
  id: string;
  uuid: string | null;
  pciBusId: string | null;
  index: number;
  name: string;
  vendor: GpuVendor;
  driver: string;
  architecture: string;
  inferenceBackend: CalibrationGpuInferenceBackend;
  mediaBackend: CalibrationGpuMediaBackend;
  classification: CalibrationGpuClassification;
  vramBytes: number | null;
  numaNodeId: number | null;
  computeEligible: boolean;
  mediaEligible: boolean;
  encodeSupported: boolean;
  decodeSupported: boolean;
  reason: string;
}

export interface CalibrationComputeDeviceEvidence {
  deviceId: string;
  deviceName: string;
  classification: CalibrationGpuClassification;
  inferenceBackend: CalibrationGpuInferenceBackend;
  mediaBackend: CalibrationGpuMediaBackend;
  inferenceMeasured: boolean;
  mediaMeasured: boolean;
  telemetryMeasured: boolean;
  receivedLoad: boolean;
  requestCount: number;
  safeCameraCapacity: number | null;
  throughput: number | null;
  p95LatencyMs: number | null;
  peakVramBytes: number | null;
  peakTemperatureCelsius: number | null;
  peakPowerWatts: number | null;
  throttlingObserved: boolean;
  schedulerWeight: number;
  failures: string[];
}

export interface CalibrationComputeEvidenceV2 {
  schemaVersion: typeof CALIBRATION_COMPUTE_EVIDENCE_VERSION;
  requiredModes: ["cpu_only", "gpu_accelerated"];
  cpu: {
    mode: "cpu_only";
    backend: "cpu";
    device: string;
    measured: boolean;
    safeCameraCapacity: number | null;
    measurementCount: number;
    failures: string[];
  };
  gpu: {
    mode: "gpu_accelerated";
    inferenceBackend: CalibrationGpuInferenceBackend;
    mediaBackend: CalibrationGpuMediaBackend;
    deviceId: string | null;
    deviceName: string | null;
    inferenceMeasured: boolean;
    mediaMeasured: boolean;
    utilizationMeasured: boolean;
    safeCameraCapacity: number | null;
    measurementCount: number;
    failures: string[];
  };
  devices: CalibrationComputeDeviceEvidence[];
  allocation: {
    strategy: "weighted_data_parallel" | "single_device" | "cpu_fallback";
    allEligibleDevicesReceivedLoad: boolean;
    allLoadedDevicesHaveTelemetry: boolean;
    modelSplitUsed: boolean;
    modelSplitReason: string | null;
    numaAware: boolean;
  };
  scaling: {
    baselineDeviceCount: number;
    activeDeviceCount: number;
    measuredSpeedup: number | null;
    efficiencyPercent: number | null;
    linearlyExtrapolated: false;
  };
  degraded: {
    simulatedLostDeviceId: string | null;
    measured: boolean;
    safeCameraCapacity: number | null;
    capacityLossPercent: number | null;
  };
  combined: {
    measured: boolean;
    safeCameraCapacity: number | null;
    measurementCount: number;
    failures: string[];
  };
}

export interface CalibrationCapacityBoundary {
  seedCameraCount: number;
  highestPassingCameraCount: number | null;
  firstFailingCameraCount: number | null;
  operationalSafeCameraCount: number | null;
  bound: CalibrationCapacityBound;
  adjacentBoundaryConfirmed: boolean;
  confirmationRuns: number;
  generatorLimit: number | null;
  nonMonotonic: boolean;
  infrastructureFailure: string | null;
  maximumAttemptedCameraCount: number;
  searchTrace: Array<{
    cameraCount: number;
    /** Legacy-compatible aggregate. Null means the attempt was not capacity evidence. */
    passed: boolean | null;
    outcome: CalibrationProbeOutcome;
    attempt: number;
    phase: "seed" | "expand" | "binary" | "confirm";
    durationMs: number;
    failureCode: string | null;
    retryOfAttempt: number | null;
    composition: Array<{
      groupIndex: number;
      groupName: string;
      cameras: number;
      videoCameras: number;
      frameCameras: number;
    }>;
  }>;
}

export interface CalibrationDiagnosticReportModel {
  schemaVersion: typeof CALIBRATION_DIAGNOSTIC_REPORT_VERSION;
  generatedAt: string;
  runId: string;
  title: "Relatório de diagnóstico do Qual Hardware";
  conclusion: "approved" | "not_approved" | "inconclusive";
  validity: "diagnostic" | "engineering" | "commercial";
  requested: {
    cameras: number;
    rawTrialOutcome: CalibrationProbeOutcome | "not_tested";
    operationallyApproved: boolean | null;
    composition: CalibrationCapacityBoundary["searchTrace"][number]["composition"];
  };
  capacity: {
    safeCameras: number | null;
    safeComposition: CalibrationCapacityBoundary["searchTrace"][number]["composition"];
    highestPassingCameras: number | null;
    firstFailingCameras: number | null;
    maximumAttemptedCameras: number;
    bound: CalibrationCapacityBound;
    testedAboveRequested: boolean;
  };
  hardware: {
    cpu: string;
    sockets: number;
    physicalCores: number;
    logicalCores: number;
    ramBytes: number;
    gpus: Array<{
      id: string;
      name: string;
      classification: CalibrationGpuClassification;
      vramBytes: number | null;
      receivedLoad: boolean;
      telemetryMeasured: boolean;
    }>;
    storage: string;
    networkLinks: CalibrationHardwarePreflight["networkLinks"];
    operatingSystem: string;
  };
  bottleneck: {
    stage: CalibrationStage | null;
    labelPt: string;
    explanationPt: string;
  };
  searchTrace: CalibrationCapacityBoundary["searchTrace"];
  stages: Array<{
    stage: CalibrationStage;
    labelPt: string;
    evidence: TelemetryEvidenceStatus | "legacy";
    safeCameraCapacity: number | null;
    utilizationPercent: number | null;
    explanationPt: string;
  }>;
  fleetPlan: {
    status: "measured" | "planning_only" | "blocked";
    projectCameras: number;
    safeCamerasPerServer: number | null;
    activeServers: number | null;
    reserveServers: number | null;
    totalServers: number | null;
    cpuDescription: string;
    gpusPerServer: number;
    ramBytesPerServer: number;
    explanationPt: string;
  };
  findings: Array<{
    severity: "information" | "warning" | "error";
    code: string;
    titlePt: string;
    consequencePt: string;
    actionPt: string;
  }>;
  methodology: string[];
  technicalEvidence: {
    workloadProfileId: string | null;
    workloadSignature: string | null;
    runtimeManifestHash: string | null;
    environmentSignature: string | null;
    environmentEvidenceLevel: CalibrationEvidenceLevel;
    methodLabelPt: string;
    measurementKind: "real" | "estimated" | "inventory_only";
    componentsFound: string[];
    componentsMissing: string[];
    authoritySnapshotHash: string | null;
    externalRequestCount: 0;
  };
}

export interface LocalCalibrationRun {
  schemaVersion:
    | typeof AUTONOMOUS_LOCAL_CALIBRATION_VERSION
    | typeof PRE_CERTIFICATION_AUTONOMOUS_LOCAL_CALIBRATION_VERSION
    | typeof PREVIOUS_AUTONOMOUS_LOCAL_CALIBRATION_VERSION
    | typeof LEGACY_AUTONOMOUS_LOCAL_CALIBRATION_VERSION
    | typeof INITIAL_AUTONOMOUS_LOCAL_CALIBRATION_VERSION
    | typeof LOCAL_CALIBRATION_VERSION
    | typeof TELEMETRY_LOCAL_CALIBRATION_VERSION
    | typeof LEGACY_LOCAL_CALIBRATION_VERSION;
  id: string;
  planId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  workloadContractVersion: WorkloadContractVersion;
  mode: CalibrationMode | "full";
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
  executionHealth?: {
    status: "completed" | "completed_with_errors";
    infrastructureErrors: string[];
    conclusion?: "approved" | "not_approved" | "inconclusive";
  };
  capacityRecommendation?: {
    safeCameraCount: number | null;
    maximumTestedCameraCount: number;
    confidence: "high" | "medium" | "insufficient";
    basis: "physical_measurement" | "generic_native_estimate";
  };
  sensorCoverage?: {
    measured: string[];
    unavailable: string[];
  };
  runtimeTrust?: {
    classification: "candidate" | "production";
    manifestApproved: boolean;
    technicalCapacityAllowed: true;
    commercialQualificationAllowed: boolean;
  };
  limitingSubsystems?: CalibrationStage[];
  inferenceEvidence?: {
    requestsPlanned: number;
    requestsAttempted: number;
    requestsSuccessful: number;
    framesPacked: number;
    maximumConcurrency: number;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    errors: string[];
  };
  kernelVersion?: typeof CALIBRATION_KERNEL_VERSION |
    "qual-hardware-calibration-kernel/3.0.0" |
    "qual-hardware-calibration-kernel/2.0.0" |
    "qual-hardware-calibration-kernel/1.0.0";
  runtimeManifestHash?: string;
  environmentSignature?: string;
  environmentProvenance?: CalibrationEnvironmentProvenance;
  qwenCertification?: QwenStackCertification;
  runtimeProvenance?: {
    platform: NodeJS.Platform;
    architecture: string;
    featureMode: "disabled" | "diagnostic" | "full";
    manifestApproved?: boolean;
    contracts: Array<{
      id: "authority" | "pipeline" | "sources";
      status: "verified" | "missing" | "mismatch";
      sha256: string | null;
      expectedSha256: string;
    }>;
    assets: Array<{
      id: string;
      status: "verified" | "missing" | "mismatch" | "system_only";
      sha256: string | null;
      sizeBytes: number | null;
      expectedSizeBytes: number | null;
      version: string | null;
      licenseSpdx: string | null;
      sbomRef: string | null;
    }>;
  };
  workloadProfileId?: string;
  workloadProfileSignature?: string;
  compatiblePerceptrumCommit?: string;
  perceptrumAuthority?: PerceptrumAuthorityContract;
  cameraTiers?: number[];
  tierResults?: CalibrationTierResult[];
  repetitions?: CalibrationRepetitionResult[];
  maxTestedTier?: number;
  capacityBound?: CalibrationCapacityBound;
  capacityBoundary?: CalibrationCapacityBoundary;
  repeatVariabilityPercent?: number;
  computeEvidence?: CalibrationComputeEvidenceV2 | {
    schemaVersion: "qual-hardware-calibration-compute-evidence/1.0.0";
    requiredModes: ["cpu_only", "gpu_accelerated"];
    cpu: {
      mode: "cpu_only";
      backend: "cpu";
      device: string;
      measured: boolean;
      safeCameraCapacity: number | null;
      measurementCount: number;
      failures: string[];
    };
    gpu: {
      mode: "gpu_accelerated";
      inferenceBackend: CalibrationGpuInferenceBackend;
      mediaBackend: CalibrationGpuMediaBackend;
      deviceId: string | null;
      deviceName: string | null;
      inferenceMeasured: boolean;
      mediaMeasured: boolean;
      utilizationMeasured: boolean;
      safeCameraCapacity: number | null;
      measurementCount: number;
      failures: string[];
    };
    combined: {
      measured: boolean;
      safeCameraCapacity: number | null;
      measurementCount: number;
      failures: string[];
    };
  };
  networkEvidence?: CalibrationNetworkEvidence;
  physicalNetworkLinks?: CalibrationHardwarePreflight["networkLinks"];
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
    storage: "documents_append_only" | "application_data_append_only";
  };
  diagnosticReport?: {
    schemaVersion: typeof CALIBRATION_DIAGNOSTIC_REPORT_VERSION;
    generatedAt: string;
    directory: string;
    files: Array<{
      format: "pdf" | "txt" | "xlsx" | "json";
      fileName: string;
      sha256: string;
      sizeBytes: number;
    }>;
    generationError: string | null;
  };
  notes: string[];
}

export interface CalibrationSessionProgress {
  schemaVersion?: typeof CALIBRATION_PROGRESS_VERSION;
  phase?: string;
  stage?: string;
  percent?: number;
  overallPercent?: number;
  phasePercent?: number;
  message?: string;
  tier?: number;
  repetition?: number;
  attempt?: number;
  computeMode?: CalibrationComputeMode;
  sessionStartedAt?: string;
  phaseStartedAt?: string;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  estimatedCompletionAt?: string | null;
  minimumDurationSeconds?: number;
  maximumDurationSeconds?: number;
  estimateConfidence?: "low" | "medium" | "high";
  estimateAdjusted?: boolean;
  bytesTemporary?: number;
  bytesRemoved?: number;
  bytesProjected?: number;
  diskFreeBytes?: number;
  diskReserveBytes?: number;
  updatedAt: string;
}

export interface CalibrationCleanupStatus {
  schemaVersion: "qual-hardware-calibration-cleanup/1.0.0";
  state: CalibrationCleanupState;
  bytesTemporary: number;
  bytesRemoved: number;
  attempts: number;
  remainingBytes: number;
  updatedAt: string;
  error: string | null;
}

export interface CalibrationDiagnosticArtifact {
  schemaVersion: "qual-hardware-calibration-diagnostic-artifact/1.0.0";
  fileName: string;
  payloadSha256: string;
  persistedAt: string;
  status: "cancelled" | "failed" | "interrupted";
  completedMeasurementCount: number;
}

export interface CalibrationSession {
  id: string;
  planId: string;
  recommendationId: string;
  scenarioId: string;
  mode: CalibrationMode;
  advancedTelemetry: boolean;
  state: CalibrationSessionState;
  createdAt: string;
  expiresAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  progress: CalibrationSessionProgress | null;
  result: LocalCalibrationRun | null;
  diagnostic?: CalibrationDiagnosticArtifact;
  cleanup?: CalibrationCleanupStatus;
  error: string | null;
}

export interface CalibrationSessionRecord extends CalibrationSession {
  tokenHash: string;
  plan: CalibrationPlan;
}

export interface CalibrationCheckpointCompatibility {
  hardwareDigest: string;
  operatingSystem: OperatingSystemFamily;
  operatingSystemVersion: string;
  gpuDriver: string;
  workloadProfileSignature: string;
  targetBuildHash: string;
  kernelVersion: string;
  runtimeManifestHash: string;
  modelHash: string;
  calibrationPolicyHash: string;
  appVersion: string;
}

export interface CalibrationCheckpoint {
  schemaVersion: typeof CALIBRATION_CHECKPOINT_VERSION;
  id: string;
  sessionId: string;
  runId: string;
  sequence: number;
  createdAt: string;
  phase: "preflight" | "discovery" | "qualification" | "terminal";
  tier: number | null;
  repetition: number | null;
  attempt: number;
  compatibility: CalibrationCheckpointCompatibility;
  completedDiscoveryTiers: number[];
  highestPassedDiscoveryTier: number | null;
  payloadSha256: string;
}

export interface CalibrationResumeStatus {
  resumable: boolean;
  sourceSessionId: string;
  checkpoint: CalibrationCheckpoint | null;
  incompatibilities: string[];
  qualificationWillRestart: true;
}

export interface CalibrationSessionLineage {
  id: string;
  parentSessionId: string;
  childSessionId: string;
  checkpointId: string;
  createdAt: string;
}

export interface CalibrationDeviceIdentity {
  id: string;
  publicKeyPem: string;
  shortCode: string;
  trust: CalibrationDeviceTrust;
  firstSeenAt: string;
  updatedAt: string;
  protection: "operating_system" | "filesystem" | "imported_public_key";
}

export interface CalibrationRunProvenance {
  runId: string;
  source: "local" | "qhcal" | "qhcalset";
  deviceId: string;
  packageDigest: string;
  trustedAtImport: boolean;
  importedAt: string | null;
}

export interface CalibrationImportItem {
  id: string;
  batchId: string;
  runId: string;
  packageDigest: string;
  status: "imported" | "diagnostic" | "duplicate" | "conflict" | "invalid" | "pending_trust";
  reason: string | null;
  recordedAt: string;
}

export interface CalibrationImportBatch {
  id: string;
  format: "qhcal" | "qhcalset";
  createdAt: string;
  completedAt: string;
  totalItems: number;
  importedItems: number;
  diagnosticItems: number;
  duplicateItems: number;
  conflictItems: number;
  invalidItems: number;
  pendingTrustItems: number;
}

export interface CalibrationExportEvent {
  id: string;
  format: "qhcal" | "qhcalset";
  runIds: string[];
  packageDigest: string;
  sizeBytes: number;
  createdAt: string;
}

export interface CalibrationCollectionSnapshot {
  id: string;
  packageDigest: string;
  resultCount: number;
  runIds: string[];
  createdAt: string;
}

export interface QhcalDeviceProof {
  id: string;
  publicKeyPem: string;
  shortCode: string;
}

export interface CalibrationNormalizedSystemIdentity {
  hardwareDigest: string;
  hardwareTemplateId: string | null;
  cpuModel: string;
  cpuArchitecture: string;
  physicalCores: number;
  logicalCores: number;
  gpuModel: string;
  gpuArchitecture: string;
  gpuCount: number;
  gpuVramBytes: number | null;
  gpuDriver: string;
  ramBytes: number;
  operatingSystem: OperatingSystemFamily;
  operatingSystemVersion: string;
  formFactor: HardwareFingerprint["formFactor"];
}

export interface QhcalPackageProvenance {
  source: "local";
  producerDeviceId: string;
  exporterVersion: string;
}

export interface QhcalUnsignedPayload {
  schemaVersion: typeof QHCAL_PACKAGE_VERSION | typeof PREVIOUS_QHCAL_PACKAGE_VERSION | typeof LEGACY_QHCAL_PACKAGE_VERSION | typeof INITIAL_QHCAL_PACKAGE_VERSION;
  packageId: string;
  createdAt: string;
  device: QhcalDeviceProof;
  run: LocalCalibrationRun;
  workloadProfile: CalibrationWorkloadProfile;
  systemIdentity: CalibrationNormalizedSystemIdentity;
  provenance: QhcalPackageProvenance;
  runDigest: string;
}

export interface QhcalPackage extends QhcalUnsignedPayload {
  signatureAlgorithm: "Ed25519";
  signature: string;
}

export interface QhcalSetUnsignedPayload {
  schemaVersion: typeof QHCALSET_PACKAGE_VERSION | typeof PREVIOUS_QHCALSET_PACKAGE_VERSION | typeof LEGACY_QHCALSET_PACKAGE_VERSION | typeof INITIAL_QHCALSET_PACKAGE_VERSION;
  collectionId: string;
  createdAt: string;
  packages: QhcalPackage[];
  packageDigests: string[];
}

export interface QhcalSetPackage extends QhcalSetUnsignedPayload {
  exporter: QhcalDeviceProof;
  signatureAlgorithm: "Ed25519";
  signature: string;
}

export interface CalibrationCollectionStatus {
  runs: number;
  measuredSystems: number;
  distinctConfigurations: number;
  trustedDevices: number;
  pendingDevices: number;
  revokedDevices: number;
  platforms: Partial<Record<OperatingSystemFamily, number>>;
  profiles: number;
  purchaseEligibleRuns: number;
  diagnosticRuns: number;
}

export interface CalibrationPlan {
  schemaVersion: typeof CALIBRATION_PLAN_VERSION;
  id: string;
  createdAt: string;
  mode: CalibrationMode;
  executionMode: "readiness" | "production_pipeline";
  workloadContractVersion: typeof WORKLOAD_CONTRACT_VERSION;
  kernelVersion: typeof CALIBRATION_KERNEL_VERSION | "qual-hardware-calibration-kernel/3.0.0" | "qual-hardware-calibration-kernel/2.0.0";
  strategy: "adaptive";
  workloadProfile: CalibrationWorkloadProfile;
  cameraTiers: number[];
  discovery: {
    stabilizationSeconds: number;
    sampleSeconds: number;
    seedCameraCount?: number;
    generatorCameraLimit?: number;
    confirmationRuns?: number;
    maximumEvaluations?: number;
    operationalHeadroomPercent?: number;
  };
  qualification: { repetitions: 1 | 3; cooldownSeconds: number; maximumVariabilityPercent: number };
  targetHardwareTemplateId: string | null;
  scenario: CapacityScenario;
  localOnly: true;
  rtspOrigin: "rtsp://127.0.0.1";
  aiqOrigin: "http://127.0.0.1";
  inferenceProvider: "automatic_offline";
  phases: Array<{ name: "warmup" | "ramp" | "sustained" | "surge"; durationSeconds: number; loadPercent: number }>;
  sourceProfiles: Array<Pick<CameraSourceProfile, "codec" | "width" | "height" | "sourceFps" | "bitrateMbps">>;
  requestedInferenceFps: number[];
  instructions: string[];
}

export interface CalibrationWorkloadProfile {
  schemaVersion: "qual-hardware-calibration-workload-profile/2.0.0";
  id: string;
  signature: string;
  targetBuildHash: string;
  workloadContractVersion: WorkloadContractVersion;
  operatingSystem: "auto" | OperatingSystemFamily | undefined;
  cameraGroups: Array<{
    id: string;
    name: string;
    sharePpm: number;
    codec: Codec;
    width: number;
    height: number;
    sourceFps: number;
    bitrateMbps: number;
    decodeMode: DecodeMode;
    motionPercent: number;
    storage: CameraStoragePolicy;
    agents: Array<Omit<AgentLoad, "id" | "name"> & {
      executionBackend: AgentExecutionBackend;
      executionScope: AgentExecutionScope;
    }>;
  }>;
  concurrentWorkloads: ConcurrentWorkloads;
}

export interface CalibrationTierResult {
  tier: number;
  repetition: number | null;
  computeMode?: CalibrationComputeMode;
  phase: "discovery" | "warmup" | "ramp" | "sustained" | "surge";
  startedAt: string;
  completedAt: string;
  passed: boolean;
  outcome?: CalibrationProbeOutcome;
  composition?: CalibrationCapacityBoundary["searchTrace"][number]["composition"];
  frameDeliveryRate: number;
  inferenceSuccessRate: number;
  p99InferenceLatencyMs: number;
  inferenceIntervalMs: number;
  p95BottleneckUtilizationPercent: number;
  queueGrowthPerMinute: number;
  outOfMemoryCount: number;
  thermalThrottlePercent: number | null;
  failures: string[];
}

export interface CalibrationRepetitionResult {
  repetition: 1 | 2 | 3;
  tier: number;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  safeCameraCapacity: number;
  failures: string[];
}

export interface CalibrationRuntimeStatus {
  schemaVersion: "qual-hardware-calibration-runtime-status/1.0.0";
  kernelVersion: typeof CALIBRATION_KERNEL_VERSION | "qual-hardware-calibration-kernel/3.0.0" | "qual-hardware-calibration-kernel/2.0.0";
  authorityCommit: string;
  platform: NodeJS.Platform;
  architecture: string;
  featureMode: "disabled" | "diagnostic" | "full";
  manifestApproved: boolean;
  runtimeAssetsVerified: boolean;
  readyForQuickTest: boolean;
  readyForFullQualification: boolean;
  manifestHash: string;
  environmentSignature?: string;
  environmentEvidenceLevel?: CalibrationEvidenceLevel;
  environmentProvenance?: CalibrationEnvironmentProvenance;
  contracts: Array<{
    id: "authority" | "pipeline" | "sources";
    status: "verified" | "missing" | "mismatch";
    path: string | null;
    sha256: string | null;
    expectedSha256: string;
  }>;
  assets: Array<{
    id: string;
    status: "verified" | "missing" | "mismatch" | "system_only";
    path: string | null;
    sha256: string | null;
    sizeBytes: number | null;
    expectedSizeBytes: number | null;
    version: string | null;
    licenseSpdx: string | null;
    sbomRef: string | null;
  }>;
  computeCapabilities?: {
    cpuInferenceAvailable: boolean;
    gpuInferenceAvailable: boolean;
    gpuInferenceBackend: CalibrationGpuInferenceBackend;
    gpuInferenceDeviceId: string | null;
    gpuInferenceDeviceName: string | null;
    gpuMediaAvailable: boolean;
    gpuMediaBackend: CalibrationGpuMediaBackend;
    failures: string[];
  };
  reasons: string[];
}

export type ExecutionEnvironmentComponentOrigin =
  | "perceptrum"
  | "system_path"
  | "known_installation"
  | "os_native"
  | "built_in_proxy"
  | "missing";

export type ExecutionEnvironmentComponentStatus =
  | "installed"
  | "missing"
  | "incompatible"
  | "not_applicable"
  | "restart_required";

export type CalibrationEvidenceLevel =
  | "exact_perceptrum"
  | "compatible_local_stack"
  | "generic_native"
  | "inventory_only";

export interface ExecutionEnvironmentComponent {
  id:
    | "application"
    | "gpu-driver"
    | "ffmpeg"
    | "ffprobe"
    | "llama-server"
    | "qwen-vl-2b"
    | "qwen-vl-2b-mmproj"
    | "qwen-vl-4b"
    | "qwen-vl-4b-mmproj"
    | "perceptrum"
    | "native-benchmark"
    | "telemetry";
  name: string;
  purpose: string;
  status: ExecutionEnvironmentComponentStatus;
  origin: ExecutionEnvironmentComponentOrigin;
  path: string | null;
  version: string | null;
  sha256: string | null;
  selfTest: "passed" | "failed" | "not_run" | "not_applicable";
  capabilities: string[];
  impact: string;
  instruction: string;
  downloadLinkId: string | null;
  diagnosticOnly: boolean;
}

export type QwenVisionModelFit =
  | "gpu_memory"
  | "shared_memory"
  | "system_memory"
  | "insufficient_memory"
  | "compute_limited"
  | "missing_projector";

export type QwenModelCertificationState =
  | "not_tested"
  | "testing"
  | "validated_locally"
  | "approved_revision"
  | "incompatible"
  | "outdated";

export type QwenModelCertificationLevel = "approved_revision" | "unknown_revision" | "none";
export type QwenModelUsageGate = "purchase" | "planning_only" | "blocked";
export type QwenModelProbeStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "stale";

export interface QwenRuntimeResourceProfile {
  staticEstimateBytes: number;
  peakRamParallel1Bytes: number | null;
  peakVramParallel1Bytes: number | null;
  peakRamParallel2Bytes: number | null;
  peakVramParallel2Bytes: number | null;
  baseRequirementBytes: number;
  incrementalSlotBytes: number;
  maxValidatedParallelism: number;
  safeAvailableMemoryFraction: 0.75;
  sequentialLatencyMs: number[];
  concurrentLatencyMs: number[];
}

export interface QwenModelProbeChallenge {
  id: string;
  expectedToken: string;
  actualText: string;
  latencyMs: number;
  passed: boolean;
}

export interface QwenModelProbeResult {
  schemaVersion: typeof QWEN_MODEL_PROBE_VERSION;
  id: string;
  candidateId: string;
  inventorySignature: string;
  stackSignature: string;
  status: QwenModelProbeStatus;
  certificationLevel: QwenModelCertificationLevel;
  usageGate: QwenModelUsageGate;
  approvedRevisionId: string | null;
  contractSha256: string;
  modelSha256: string;
  projectorSha256: string;
  llamaServerSha256: string;
  llamaServerVersion: string;
  llamaServerPath: string;
  backend: CalibrationGpuInferenceBackend;
  deviceId: string | null;
  deviceName: string | null;
  hardwareSignature: string;
  driverVersion: string | null;
  platform: NodeJS.Platform;
  architecture: string;
  challenges: QwenModelProbeChallenge[];
  concurrency: {
    attempted: boolean;
    passed: boolean;
    maxValidatedParallelism: number;
  };
  resourceProfile: QwenRuntimeResourceProfile | null;
  failureCode: string | null;
  message: string;
  startedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface QwenStackCertification {
  selectionSignature: string;
  coreProbeId: string;
  coreMaxProbeId: string;
  usageGate: QwenModelUsageGate;
  coreResourceProfile: QwenRuntimeResourceProfile;
  coreMaxResourceProfile: QwenRuntimeResourceProfile;
}

export interface QwenVisionModelCandidate {
  id: string;
  family: "Qwen3-VL";
  modelPath: string;
  modelFileName: string;
  modelSizeBytes: number;
  projectorPath: string | null;
  projectorFileName: string | null;
  projectorSizeBytes: number | null;
  parameterBillions: number;
  quantization: string;
  estimatedMemoryBytes: number;
  fit: QwenVisionModelFit;
  estimatedCompatible: boolean;
  compatible: boolean;
  inventorySignature: string;
  certificationState: QwenModelCertificationState;
  certificationLevel: QwenModelCertificationLevel;
  usageGate: QwenModelUsageGate;
  probeId: string | null;
  resourceProfile: QwenRuntimeResourceProfile | null;
}

export interface QwenVisionModelSelection {
  schemaVersion: typeof QWEN_VISION_SELECTION_VERSION;
  mode: "automatic" | "manual";
  certificationContractSha256: string;
  systemMemoryBudgetBytes: number;
  acceleratorMemoryBudgetBytes: number | null;
  effectiveMemoryBudgetBytes: number;
  recommendedCoreModelId: string | null;
  recommendedCoreMaxModelId: string | null;
  selectedCoreModelId: string | null;
  selectedCoreMaxModelId: string | null;
  candidates: QwenVisionModelCandidate[];
  warnings: string[];
}

export interface ExecutionEnvironment {
  schemaVersion: typeof EXECUTION_ENVIRONMENT_VERSION | typeof PREVIOUS_EXECUTION_ENVIRONMENT_VERSION;
  detectedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  supported: boolean;
  readiness: "ready_full" | "ready_diagnostic" | "unsupported";
  evidenceLevel: CalibrationEvidenceLevel;
  environmentSignature: string;
  runtimeIdentity?: {
    llamaServerPath: string | null;
    llamaServerSha256: string | null;
    llamaServerVersion: string | null;
    backend: CalibrationGpuInferenceBackend;
    deviceId: string | null;
    deviceName: string | null;
    driverVersion: string | null;
  };
  components: ExecutionEnvironmentComponent[];
  qwenModelSelection?: QwenVisionModelSelection;
  missingRequiredComponentIds: ExecutionEnvironmentComponent["id"][];
  warnings: string[];
  externalDownloadsPerformed: false;
}

export interface CalibrationEnvironmentProvenance {
  schemaVersion: typeof EXECUTION_ENVIRONMENT_VERSION | typeof PREVIOUS_EXECUTION_ENVIRONMENT_VERSION;
  detectedAt: string;
  readiness: ExecutionEnvironment["readiness"];
  evidenceLevel: CalibrationEvidenceLevel;
  components: Array<Pick<ExecutionEnvironmentComponent,
    "id" | "name" | "status" | "origin" | "path" | "version" | "sha256" | "selfTest" | "capabilities">>;
  qwenCertification?: QwenStackCertification;
  missingRequiredComponentIds: ExecutionEnvironmentComponent["id"][];
}

export interface DependencyDownloadLink {
  id: string;
  label: string;
  url: string;
  platforms: Array<"windows" | "ubuntu" | "macos">;
}

export type CalibrationRuntimeClassification = "candidate" | "production";
export type CalibrationRuntimeInstallationState = "pending" | "selecting" | "validating" | "installing" | "completed" | "cancelled" | "failed";

export interface CalibrationRuntimePackageStatus {
  schemaVersion: "qual-hardware-calibration-runtime-package-status/1.0.0";
  target: "win32-x64" | "darwin-arm64" | "linux-x64" | null;
  active: {
    manifestHash: string;
    version: string;
    classification: CalibrationRuntimeClassification;
    keyId: string;
    installedAt: string;
  } | null;
  previous: {
    manifestHash: string;
    version: string;
    classification: CalibrationRuntimeClassification;
    keyId: string;
    installedAt: string;
  } | null;
  installationInProgress: boolean;
  qualificationAllowed: boolean;
  reasons: string[];
}

export interface CalibrationRuntimeInstallation {
  installationId: string;
  state: CalibrationRuntimeInstallationState;
  createdAt: string;
  updatedAt: string;
  manifestHash: string | null;
  error: string | null;
}

export interface CalibrationHardwarePreflight {
  schemaVersion: typeof CALIBRATION_HARDWARE_VERSION | "qual-hardware-calibration-hardware/1.0.0";
  detectedAt: string;
  cpuModel: string;
  cpuArchitecture: string;
  physicalCores: number;
  logicalCores: number;
  gpuModel: string;
  gpuDriver: string;
  gpuArchitecture: string;
  gpuCount: number;
  gpuVramBytes: number | null;
  ramBytes: number;
  operatingSystem: OperatingSystemFamily;
  operatingSystemVersion: string;
  formFactor: "laptop" | "mini_pc" | "workstation" | "rack" | null;
  cpuPackages?: CalibrationCpuPackage[];
  processorGroups?: CalibrationProcessorGroup[];
  numaNodes?: CalibrationNumaNode[];
  gpuDevices?: CalibrationGpuDevice[];
  networkLinks: Array<{
    name: string;
    speedMbps: number | null;
    duplex: "full" | "half" | "unknown";
    physicalLinkVerified: boolean;
  }>;
}

export interface HardwareCapacityAssessment {
  schemaVersion: "qual-hardware-capacity-assessment/1.0.0";
  id: string;
  hardwareTemplateId: string;
  workloadProfileId: string;
  targetBuildHash: string;
  kernelVersion: string;
  runtimeManifestHash: string;
  calibrationRunIds: string[];
  generatedAt: string;
  status: CalibrationStatus;
  procurementEligibility: ProcurementEligibility;
  safeCameraMaximum: number | null;
  capacityBound: CalibrationCapacityBound | null;
  bottleneck: CalibrationStage | null;
  reasons: string[];
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

export type ManufacturerSpecificationScope = "sku" | "family" | "architecture" | "platform";
export type ManufacturerSpecificationAuthority = "official_sku" | "official_family" | "official_matrix" | "secondary_reference";
export type SpecificationResolutionStatus = "resolved" | "not_published" | "ambiguous" | "conflicting" | "rejected";

export interface ManufacturerSpecificationObservation {
  schemaVersion: typeof MANUFACTURER_SPECIFICATION_OBSERVATION_VERSION;
  id: string;
  componentId: string;
  manufacturer: string;
  canonicalMpn: string;
  scope: ManufacturerSpecificationScope;
  subject: string;
  fieldCode: string;
  sectionCode: string;
  sectionLabelPt: string;
  displayOrder: number;
  valueType: TechnicalSpecificationValueType;
  originalLabel: string;
  originalValue: string | number | boolean | null;
  originalUnit: string | null;
  normalizedValue: string | number | boolean | null;
  normalizedUnit: string | null;
  authority: ManufacturerSpecificationAuthority;
  sourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  evidenceLocator: string;
  rawArtifactSha256: string;
  parserId: string;
  parserVersion: string;
  licensePolicy: string;
}

export interface TechnicalSpecificationResolution {
  status: SpecificationResolutionStatus;
  selectedObservationId: string | null;
  observationIds: string[];
  rationale: string;
  resolvedAt: string;
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
  sectionCode?: string;
  sectionLabelPt?: string;
  displayOrder?: number;
  resolution?: TechnicalSpecificationResolution;
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
  schemaVersion: typeof COMPONENT_TECHNICAL_SPECIFICATION_VERSION | typeof LEGACY_COMPONENT_TECHNICAL_SPECIFICATION_VERSION;
  componentId: string;
  specificationVersion: string;
  generatedAt: string;
  fields: TechnicalSpecificationField[];
  completeness: ComponentSpecificationCompleteness;
  observations?: ManufacturerSpecificationObservation[];
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
  requiredPhysicalAnchors: 1 | 3;
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
  workloadProfileId?: string;
  targetBuildHash?: string | null;
  kernelVersion?: string | null;
  runtimeManifestHash?: string | null;
  qwenCertification?: QwenStackCertification;
  generatedAt: string;
  status: CalibrationStatus;
  procurementEligibility: ProcurementEligibility;
  confidenceClass: CalibrationConfidenceClass;
  safeCameraMinimum: number | null;
  safeCameraMaximum: number | null;
  highestPassingCameraCount?: number | null;
  firstFailingCameraCount?: number | null;
  capacityBound?: CalibrationCapacityBound | null;
  degradedSafeCameraMaximum?: number | null;
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
