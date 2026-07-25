import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { createDefaultAgent, createDefaultScenario } from "../shared/schemas.js";
import { defaultCurrencyForSelection, marketSelectionForScenario, marketsForSelection, primaryMarketForSelection, type MarketSelection } from "../shared/markets.js";
import type {
  AgentLoad, CameraGroup, CapacityRecommendation, CapacityScenario, CatalogPublication, CatalogSource, CatalogStatus, Currency, InfrastructureKind,
  CalibrationCollectionStatus, CalibrationDeviceIdentity, CalibrationDiagnosticReportModel, CalibrationHardwarePreflight, CalibrationMode, CalibrationPlan, CalibrationResumeStatus, CalibrationRuntimeStatus, CalibrationSession, CapacityPrediction, ExecutionEnvironment, HardwareNodeTemplate, LocalCalibrationRun, OperatingSystemFamily,
  HardwareComponent, RecommendationAlternative, RecommendationPolicy, ScenarioRecord,
  QwenModelProbeResult,
} from "../shared/types.js";
import { CalibrationResultPanel } from "./CalibrationResultPanel.js";
import { REPORT_DOWNLOAD_FILENAMES, REPORT_EXPORT_COPY, isNeutralAnnexFormat, type ExportFormat } from "./reportExports.js";
import { withCameraGroupCount, withCameraTotal as rebalanceCameraTotal } from "./cameraAllocation.js";
import { visibleText } from "./visibleText.js";

type Language = "pt" | "en";
type QwenSelectionRequest = {
  mode: "automatic" | "manual";
  coreModelId?: string | null;
  coreMaxModelId?: string | null;
};
const steps = ["project", "cameras", "agents", "additional", "storage", "result"] as const;
type Step = typeof steps[number];
const presets = [4, 8, 16, 32, 65, 128, 256];
const QWEN_SELECTION_STORAGE_KEY = "qual-hardware-qwen-selection-v1";

const text = {
  pt: {
    project: "Projeto e mercado", cameras: "Câmeras", agents: "Perfis de operação", additional: "Cargas adicionais",
    storage: "Rede e arquivos temporários", result: "Resultado", next: "Continuar", back: "Voltar", calculate: "Dimensionar infraestrutura",
    title: "Qual Hardware", subtitle: "Dimensionamento e qualificação de computadores e servidores para vídeo e IA",
    estimated: "Estimada", validated: "Validada", quote: "Cotação necessária", save: "Salvar projeto",
  },
  en: {
    project: "Project & market", cameras: "Cameras", agents: "Operating profiles", additional: "Additional loads",
    storage: "Network & temporary files", result: "Results", next: "Continue", back: "Back", calculate: "Size infrastructure",
    title: "Qual Hardware", subtitle: "Sizing and qualification of computers and servers for video and AI",
    estimated: "Estimated", validated: "Validated", quote: "Quote required", save: "Save project",
  },
} as const;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(visibleText(body.message ?? body.error ?? `HTTP ${response.status}`));
  return body;
}

async function executionEnvironmentWithRetry(): Promise<ExecutionEnvironment> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await api<ExecutionEnvironment>("/api/calibrations/environment");
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 3) throw error;
      await new Promise((resolveWait) => window.setTimeout(resolveWait, attempt * 300));
    }
  }
}

function savedQwenSelection(): QwenSelectionRequest | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(QWEN_SELECTION_STORAGE_KEY) ?? "null") as QwenSelectionRequest | null;
    if (parsed?.mode !== "manual" || typeof parsed.coreModelId !== "string" ||
        typeof parsed.coreMaxModelId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

async function downloadBinaryResponse(response: Response, fallbackName: string): Promise<void> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function withCameraTotal(scenario: CapacityScenario, value: number): CapacityScenario {
  return rebalanceCameraTotal(scenario, value, newGroup);
}

function createInitialScenario(): CapacityScenario {
  const scenario = createDefaultScenario(1);
  return { ...scenario, projectName: "Novo dimensionamento" };
}

function splitCameraGroup(scenario: CapacityScenario): CapacityScenario {
  const donorIndex = scenario.cameraGroups.findIndex((group) => group.count > 1);
  if (donorIndex < 0) return scenario;
  const donor = scenario.cameraGroups[donorIndex]!;
  const cameraGroups = scenario.cameraGroups.map((group, index) => index === donorIndex ? { ...group, count: group.count - 1 } : group);
  cameraGroups.push({
    ...donor,
    id: crypto.randomUUID(),
    name: `Perfil de câmeras ${cameraGroups.length + 1}`,
    count: 1,
    source: { ...donor.source },
    storage: { ...donor.storage },
    agents: [createDefaultAgent()],
  });
  return { ...scenario, cameraGroups };
}

function removeCameraGroup(scenario: CapacityScenario, id: string): CapacityScenario {
  const removed = scenario.cameraGroups.find((group) => group.id === id);
  const cameraGroups = scenario.cameraGroups.filter((group) => group.id !== id);
  if (!removed || cameraGroups.length === 0) return scenario;
  cameraGroups[0] = { ...cameraGroups[0]!, count: cameraGroups[0]!.count + removed.count };
  return { ...scenario, cameraGroups };
}

async function checkedReportBlob(response: Response, format: ExportFormat): Promise<Blob> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(error?.message ?? error?.error ?? `HTTP ${response.status}`);
  }
  const expectedContentType: Record<ExportFormat, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    json: "application/json",
    "technical-pdf": "application/pdf",
    "technical-docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "tr-pdf": "application/pdf",
    "tr-docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "tr-json": "application/json",
  };
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expectedContentType[format])) throw new Error(`invalid_${format}_content_type`);
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if ((format === "pdf" || format === "technical-pdf" || format === "tr-pdf") && String.fromCharCode(...signature) !== "%PDF-") throw new Error("invalid_pdf_file");
  if ((format === "xlsx" || format === "technical-docx" || format === "tr-docx") && !(signature[0] === 0x50 && signature[1] === 0x4b)) throw new Error(`invalid_${format}_file`);
  if (format === "json" || format === "tr-json") JSON.parse(await blob.text());
  return blob;
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactElement {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }): ReactElement {
  return <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span />{label}</label>;
}

function money(value: number | null, currency: Currency): string {
  return value === null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function percent(value: number): string { return `${Math.round(value * 100)}%`; }

function readingTypeLabel(agent: AgentLoad, lang: Language): string {
  if (agent.inputType === "image") return lang === "pt" ? "FRAME — 1 imagem por execução" : "FRAME — 1 image per run";
  const packaging = agent.packaging === "mosaic_2x2"
    ? (lang === "pt" ? "resolução padrão / mosaico 2×2" : "standard resolution / 2×2 mosaic")
    : (lang === "pt" ? "alta resolução / sequência de frames" : "high resolution / frame sequence");
  return `${lang === "pt" ? "VÍDEO FULL" : "FULL VIDEO"} — ${packaging}`;
}

function hardwareOperatingSystem(hardware: HardwareNodeTemplate): OperatingSystemFamily {
  if (hardware.operatingSystemFamily) return hardware.operatingSystemFamily;
  if (hardware.cpuVendor === "apple") return "macos";
  return hardware.windowsEdition.toLowerCase().includes("ubuntu") ? "ubuntu" : "windows";
}

function gpuMemoryLabel(hardware: HardwareNodeTemplate, lang: Language): string {
  if (hardware.memoryArchitecture === "unified") {
    return lang === "pt" ? `${hardware.ramGb} GB unificada e compartilhada; sem VRAM dedicada` : `${hardware.ramGb} GB unified and shared; no dedicated VRAM`;
  }
  if (hardware.memoryArchitecture === "shared") {
    return lang === "pt" ? "memória de sistema compartilhada; sem VRAM dedicada" : "shared system memory; no dedicated VRAM";
  }
  return `${hardware.gpuVramGbTotal} GB VRAM/${lang === "pt" ? "nó" : "node"}`;
}

function ProjectStep({ scenario, update, lang, cameraCountConfirmed, onCameraCount, hardwareCatalog }: { scenario: CapacityScenario; update: (next: CapacityScenario) => void; lang: Language; cameraCountConfirmed: boolean; onCameraCount: (value: number) => void; hardwareCatalog: HardwareNodeTemplate[] }): ReactElement {
  return <section className="panel step-panel">
    <div className="section-heading"><p>01</p><div><h2>{text[lang].project}</h2><span>{lang === "pt" ? "Defina o contexto comercial e físico." : "Set the commercial and physical context."}</span></div></div>
    <div className="form-grid">
      <Field label={lang === "pt" ? "Nome do projeto" : "Project name"}><input value={scenario.projectName} onChange={(e) => update({ ...scenario, projectName: e.target.value })} /></Field>
      <Field label={lang === "pt" ? "Cliente" : "Customer"}><input value={scenario.customerName} onChange={(e) => update({ ...scenario, customerName: e.target.value })} /></Field>
      <Field label={lang === "pt" ? "Quantidade total de câmeras *" : "Total number of cameras *"} hint={lang === "pt" ? "Informe de 1 a 1.000.000 câmeras. Esse valor dimensiona o projeto, mas não limita o ensaio da máquina." : "Enter 1 to 1,000,000 cameras. This sizes the project but does not cap the machine test."}><input autoFocus aria-label={lang === "pt" ? "Quantidade total de câmeras" : "Total number of cameras"} type="number" min="1" max="1000000" placeholder={lang === "pt" ? "Informe o total" : "Enter the total"} value={cameraCountConfirmed ? scenario.totalCameras : ""} onChange={(e) => { if (e.target.value) onCameraCount(Number(e.target.value)); }} /></Field>
      <Field label={lang === "pt" ? "Mercados de pesquisa" : "Search markets"} hint={lang === "pt" ? "Define em quais regiões o sistema procurará máquinas, componentes e cotações compatíveis." : "Select the regions used to search compatible machines, components and quotations."}><select value={marketSelectionForScenario(scenario)} onChange={(e) => {
        const selection = e.target.value as MarketSelection;
        update({
          ...scenario,
          market: primaryMarketForSelection(selection),
          markets: marketsForSelection(selection),
          currency: defaultCurrencyForSelection(selection),
        });
      }}><option value="BR">{lang === "pt" ? "Brasil" : "Brazil"}</option><option value="US">{lang === "pt" ? "Estados Unidos" : "United States"}</option><option value="DE">{lang === "pt" ? "União Europeia" : "European Union"}</option><option value="BR_US">{lang === "pt" ? "Brasil e Estados Unidos" : "Brazil and United States"}</option><option value="BR_DE">{lang === "pt" ? "Brasil e União Europeia" : "Brazil and European Union"}</option><option value="ALL">{lang === "pt" ? "Todo o mundo — Brasil, EUA e UE" : "Worldwide — Brazil, US and EU"}</option></select></Field>
      <Field label={lang === "pt" ? "Moeda" : "Currency"}><select value={scenario.currency} onChange={(e) => update({ ...scenario, currency: e.target.value as Currency })}><option>BRL</option><option>USD</option><option>EUR</option></select></Field>
      <Field label={lang === "pt" ? "Formato" : "Form factor"}><select value={scenario.constraints.infrastructureKind} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, infrastructureKind: e.target.value as InfrastructureKind, requiredHardwareTemplateId: null } })}><option value="either">{lang === "pt" ? "Melhor opção (inclui opções econômicas)" : "Best fit (includes lower-cost computers)"}</option><option value="laptop">Notebook / laptop</option><option value="mini_pc">Mini PC / Mac mini</option><option value="workstation">Workstation</option><option value="rack">Rack server</option></select></Field>
      <Field label={lang === "pt" ? "Sistema operacional alvo" : "Target operating system"} hint={lang === "pt" ? "Apple/macOS é opcional e precisa de evidência física comparável para aumentar a validade da recomendação." : "Apple/macOS is optional and needs comparable physical evidence to increase recommendation validity."}><select value={scenario.constraints.operatingSystem ?? "auto"} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, operatingSystem: e.target.value as "auto" | OperatingSystemFamily, requiredHardwareTemplateId: null } })}><option value="auto">{lang === "pt" ? "Automático — Windows/Ubuntu" : "Automatic — Windows/Ubuntu"}</option><option value="windows">Windows</option><option value="ubuntu">Ubuntu Linux</option><option value="macos">macOS / Apple Silicon</option></select></Field>
      <Field label={lang === "pt" ? "Avaliar equipamento existente (opcional)" : "Evaluate existing hardware (optional)"} hint={lang === "pt" ? "Força o cálculo a usar exatamente esta máquina. Em GPU integrada, o decode muda para CPU." : "Forces sizing to use this exact machine. Integrated-GPU selections switch decode to CPU."}><select value={scenario.constraints.requiredHardwareTemplateId ?? ""} onChange={(event) => {
        const selected = hardwareCatalog.find((hardware) => hardware.id === event.target.value);
        if (!selected) {
          update({ ...scenario, constraints: { ...scenario.constraints, requiredHardwareTemplateId: null } });
          return;
        }
        update({
          ...scenario,
          cameraGroups: selected.supportsPerceptrumGpuDecode ? scenario.cameraGroups : scenario.cameraGroups.map((group) => ({ ...group, decodeMode: "cpu" })),
          constraints: {
            ...scenario.constraints,
            requiredHardwareTemplateId: selected.id,
            infrastructureKind: selected.kind,
            operatingSystem: hardwareOperatingSystem(selected),
          },
        });
      }}><option value="">{lang === "pt" ? "Usar todo o catálogo" : "Use full catalog"}</option>{hardwareCatalog.map((hardware) => <option key={hardware.id} value={hardware.id}>{hardware.name} · {hardware.cpuModel} · {hardware.ramGb} GB</option>)}</select></Field>
      <Field label={lang === "pt" ? "Orçamento opcional" : "Optional budget"}><input type="number" min="0" placeholder={scenario.currency} value={scenario.constraints.budget ?? ""} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, budget: e.target.value ? Number(e.target.value) : null } })} /></Field>
      <div className="field toggles"><span>{lang === "pt" ? "Requisitos" : "Requirements"}</span><Toggle checked={scenario.constraints.requireEcc} onChange={(requireEcc) => update({ ...scenario, constraints: { ...scenario.constraints, requireEcc } })} label="ECC" /></div>
    </div>{scenario.constraints.operatingSystem === "macos" && <div className="info-box">{lang === "pt" ? "Apple Silicon usa memória unificada e aceleração local. A recepção RTSP e o processamento são dimensionados conservadoramente até existir calibração física comparável." : "Apple Silicon uses unified memory and local acceleration. RTSP ingest and processing are sized conservatively until comparable physical calibration exists."}</div>}
  </section>;
}

function newGroup(count = 1): CameraGroup {
  return { id: crypto.randomUUID(), name: "Camera group", count, source: { codec: "h264", width: 1920, height: 1080, sourceFps: 15, bitrateMbps: 4 }, decodeMode: "gpu", motionPercent: 100, storage: { storeVideo: false, retentionDays: 1, raidFactor: 1 }, agents: [createDefaultAgent()] };
}

function parseCameraCsv(content: string): CameraGroup[] {
  const lines = content.trim().split(/\r?\n/); const headers = lines.shift()?.split(",").map((item) => item.trim().toLowerCase()) ?? [];
  const cell = (values: string[], key: string, fallback: string): string => values[headers.indexOf(key)]?.trim() || fallback;
  return lines.filter(Boolean).map((line, index) => { const values = line.split(","); const group = newGroup(Number(cell(values, "count", "1"))); return {
    ...group, name: cell(values, "name", `Group ${index + 1}`), decodeMode: cell(values, "decode", "gpu") === "cpu" ? "cpu" : "gpu",
    source: { codec: cell(values, "codec", "h264") === "h265" ? "h265" : "h264", width: Number(cell(values, "width", "1920")), height: Number(cell(values, "height", "1080")), sourceFps: Number(cell(values, "fps", "15")), bitrateMbps: Number(cell(values, "bitrate", "4")) },
  }; });
}

function CameraStep({ scenario, update, lang }: { scenario: CapacityScenario; update: (next: CapacityScenario) => void; lang: Language }): ReactElement {
  const groupTotal = scenario.cameraGroups.reduce((sum, group) => sum + group.count, 0);
  const setGroups = (cameraGroups: CameraGroup[]): void => update({ ...scenario, cameraGroups });
  const changeGroup = (id: string, patch: Partial<CameraGroup>): void => setGroups(scenario.cameraGroups.map((group) => group.id === id ? { ...group, ...patch } : group));
  const importFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; if (!file) return; const content = await file.text();
    const parsed = file.name.endsWith(".json") ? JSON.parse(content) as CapacityScenario | CameraGroup[] : parseCameraCsv(content);
    const groups = Array.isArray(parsed) ? parsed : parsed.cameraGroups;
    update({ ...scenario, cameraGroups: groups, totalCameras: groups.reduce((sum, group) => sum + group.count, 0) });
  };
  return <section className="panel step-panel">
    <div className="section-heading"><p>02</p><div><h2>{text[lang].cameras}</h2><span>{lang === "pt" ? `Distribua as ${scenario.totalCameras} câmeras em grupos. Cada grupo poderá ter um tipo de leitura diferente na próxima etapa.` : `Allocate the ${scenario.totalCameras} cameras into groups. Each group can use a different reading type in the next step.`}</span></div></div>
    <div className="camera-total-box"><Field label={lang === "pt" ? "Total de câmeras monitoradas" : "Total monitored cameras"} hint={lang === "pt" ? "Este é o tamanho do projeto. A calibração continua acima dele até encontrar o limite físico do servidor." : "This is the project size. Calibration continues above it until the server's physical limit is found."}><input aria-label={lang === "pt" ? "Total de câmeras monitoradas" : "Total monitored cameras"} type="number" min="1" max="1000000" value={scenario.totalCameras} onChange={(e) => update(withCameraTotal(scenario, Number(e.target.value)))} /></Field>
      <div className="preset-row"><span>{lang === "pt" ? "Atalhos" : "Shortcuts"}</span>{presets.map((preset) => <button key={preset} type="button" className={scenario.totalCameras === preset ? "active" : ""} onClick={() => update(withCameraTotal(scenario, preset))}>{preset}</button>)}<label className="import-button">↑ {lang === "pt" ? "Importar CSV/JSON" : "Import CSV/JSON"}<input hidden type="file" accept=".csv,.json" onChange={importFile} /></label></div>
    </div>
    <div className={`total-check ${groupTotal === scenario.totalCameras ? "ok" : "error"}`}>{groupTotal} / {scenario.totalCameras} {lang === "pt" ? "câmeras distribuídas" : "cameras allocated"}</div>
    <div className="group-list">{scenario.cameraGroups.map((group, index) => <article className="group-card" key={group.id}>
      <div className="group-title"><b>{lang === "pt" ? "Grupo" : "Group"} {index + 1}</b>{scenario.cameraGroups.length > 1 && <button className="icon-button" onClick={() => update(removeCameraGroup(scenario, group.id))}>×</button>}</div>
      <div className="compact-grid">
        <Field label={lang === "pt" ? "Nome" : "Name"}><input value={group.name} onChange={(e) => changeGroup(group.id, { name: e.target.value })} /></Field>
        <Field label={lang === "pt" ? "Quantidade" : "Count"}><input type="number" min="1" value={group.count} onChange={(e) => update(withCameraGroupCount(scenario, group.id, Number(e.target.value)))} /></Field>
        <Field label="Codec"><select value={group.source.codec} onChange={(e) => changeGroup(group.id, { source: { ...group.source, codec: e.target.value as "h264" | "h265" } })}><option value="h264">H.264</option><option value="h265">H.265</option></select></Field>
        <Field label={lang === "pt" ? "Resolução" : "Resolution"}><select value={`${group.source.width}x${group.source.height}`} onChange={(e) => { const [width, height] = e.target.value.split("x").map(Number); changeGroup(group.id, { source: { ...group.source, width: width!, height: height! } }); }}><option value="1280x720">720p</option><option value="1920x1080">1080p</option><option value="3840x2160">4K</option></select></Field>
        <Field label={lang === "pt" ? "FPS de leitura RTSP" : "RTSP read FPS"} hint={lang === "pt" ? "Quadros recebidos e decodificados por câmera. Não é o FPS enviado ao AiQ." : "Frames received and decoded per camera. This is not the AiQ inference FPS."}><input type="number" min="1" max="120" value={group.source.sourceFps} onChange={(e) => changeGroup(group.id, { source: { ...group.source, sourceFps: Number(e.target.value) } })} /></Field>
        <Field label="Bitrate Mbps"><input type="number" min="0.1" step="0.1" value={group.source.bitrateMbps} onChange={(e) => changeGroup(group.id, { source: { ...group.source, bitrateMbps: Number(e.target.value) } })} /></Field>
        <Field label="Decode"><select value={group.decodeMode} onChange={(e) => changeGroup(group.id, { decodeMode: e.target.value as "cpu" | "gpu" })}><option value="gpu">GPU (NVIDIA)</option><option value="cpu">CPU</option></select></Field>
        <Field label={lang === "pt" ? "Movimento" : "Motion"}><input type="range" min="0" max="100" value={group.motionPercent} onChange={(e) => changeGroup(group.id, { motionPercent: Number(e.target.value) })} /><small>{group.motionPercent}%</small></Field>
      </div></article>)}</div>
    <button className="secondary" disabled={!scenario.cameraGroups.some((group) => group.count > 1)} onClick={() => update(splitCameraGroup(scenario))}>+ {lang === "pt" ? "Dividir câmeras em outro grupo/perfil" : "Split cameras into another group/profile"}</button>
  </section>;
}

function AgentsStep({ scenario, update, lang }: { scenario: CapacityScenario; update: (next: CapacityScenario) => void; lang: Language }): ReactElement {
  const changeGroupAgents = (groupId: string, agents: AgentLoad[]): void => update({ ...scenario, cameraGroups: scenario.cameraGroups.map((group) => group.id === groupId ? { ...group, agents } : group) });
  const changeGroupCount = (groupId: string, count: number): void => update(withCameraGroupCount(scenario, groupId, count));
  const assignedCameras = scenario.cameraGroups.reduce((sum, group) => sum + group.count, 0);
  return <section className="panel step-panel"><div className="section-heading"><p>03</p><div><h2>{lang === "pt" ? "Tipo de leitura e perfis de Agents" : "Reading type and Agent profiles"}</h2><span>{lang === "pt" ? "Informe como cada grupo será lido. Uma câmera pode executar múltiplas análises." : "Describe how each group will be read. A camera can run multiple analyses."}</span></div></div>
    <div className="agent-load-guide"><b>{lang === "pt" ? "Esta etapa define o peso real" : "This step defines the real load"}</b><span>{lang === "pt" ? "VÍDEO FULL e FRAME mantêm a sessão RTSP e a decodificação de base. VÍDEO FULL cria o clipe e envia de 1 a 10 FPS ao modelo; FRAME usa uma imagem por execução e não cria clipe quando não há gravação ou outro Agent de vídeo." : "FULL VIDEO and FRAME keep the RTSP session and base decoding active. FULL VIDEO creates the clip and sends 1–10 FPS to the model; FRAME uses one image per run and creates no clip unless recording or another video Agent requires it."}</span></div>
    <div className={`total-check ${assignedCameras === scenario.totalCameras ? "ok" : "error"}`}>{assignedCameras} / {scenario.totalCameras} {lang === "pt" ? "câmeras distribuídas entre os perfis" : "cameras allocated among profiles"}</div>
    {scenario.cameraGroups.map((group) => <div className="agent-group" key={group.id}><div className="profile-camera-count"><h3>{group.name}</h3><Field label={lang === "pt" ? "Quantas câmeras usarão este perfil?" : "How many cameras will use this profile?"}><input type="number" min="1" max="1000000" value={group.count} onChange={(e) => changeGroupCount(group.id, Number(e.target.value))} /></Field></div>{group.agents.map((agent, index) => {
      const change = (patch: Partial<AgentLoad>): void => changeGroupAgents(group.id, group.agents.map((item) => item.id === agent.id ? { ...item, ...patch } : item));
      const aiq = agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max";
      const portalCounter = agent.model === "opencv-portal-counter";
      const adjustableFps = !portalCounter;
      return <article className="agent-card" key={agent.id}><div className="group-title"><div><b>Agent {index + 1}</b><span className="reading-badge">{readingTypeLabel(agent, lang)}</span></div>{group.agents.length > 1 && <button className="icon-button" onClick={() => changeGroupAgents(group.id, group.agents.filter((item) => item.id !== agent.id))}>×</button>}</div>
        <div className="compact-grid"><Field label={lang === "pt" ? "Nome" : "Name"}><input value={agent.name} onChange={(e) => change({ name: e.target.value })} /></Field>
          <Field label={lang === "pt" ? "Modelo de inferência (Agents)" : "Inference model (Agents)"}><select value={agent.model} onChange={(e) => change({ model: e.target.value as AgentLoad["model"] })}><option value="gpt-5.4">GPT-5.4 / Ultra Plus</option><option value="gpt-5">GPT-5 / Ultra</option><option value="gpt-5.4-mini">GPT-5.4 mini / Light</option><option value="gpt-5-mini">GPT-5 mini / Legacy</option><option value="aiq-3.7">AiQ-3.7 / Core local</option><option value="aiq-3.7-max">AiQ-3.7-Max / Core Max local</option><option value="opencv-portal-counter">Portal Counter OpenCV</option></select></Field>
          <Field label={lang === "pt" ? "Tipo de leitura da câmera (Agents)" : "Camera reading type (Agents)"} hint={lang === "pt" ? "VÍDEO FULL usa uma sequência; FRAME usa uma imagem." : "FULL VIDEO uses a sequence; FRAME uses one image."}><select value={agent.inputType} onChange={(e) => change({ inputType: e.target.value as "video" | "image" })} disabled={portalCounter}><option value="video">{lang === "pt" ? "VÍDEO FULL — sequência de frames" : "FULL VIDEO — frame sequence"}</option><option value="image">{lang === "pt" ? "FRAME — uma imagem por execução" : "FRAME — one image per run"}</option></select></Field>
          {agent.inputType === "video" && <Field label={lang === "pt" ? "Qualidade do vídeo (Agents)" : "Video quality (Agents)"}><select value={agent.packaging} onChange={(e) => change({ packaging: e.target.value as AgentLoad["packaging"] })} disabled={portalCounter}><option value="frame_sequence">{lang === "pt" ? "Alta resolução — sequência de frames" : "High resolution — frame sequence"}</option><option value="mosaic_2x2">{lang === "pt" ? "Resolução padrão — mosaico 2×2" : "Standard resolution — 2×2 mosaic"}</option></select></Field>}
          {agent.inputType === "video" && adjustableFps && <Field label={lang === "pt" ? "FPS efetivos enviados ao AiQ" : "Effective FPS sent to AiQ"} hint={lang === "pt" ? "Quadros extraídos para a inferência local. O perfil de VÍDEO FULL permite de 1 a 10 FPS." : "Frames extracted for local inference. The FULL VIDEO profile supports 1–10 FPS."}><select value={Math.min(10, agent.modelFps)} onChange={(e) => change({ modelFps: Number(e.target.value) })}>{[1,2,3,4,5,6,7,8,9,10].map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}</select></Field>}
          <Field label={lang === "pt" ? "Escopo da execução" : "Execution scope"} hint={lang === "pt" ? "Individual executa um Agent por câmera. Grupo cria uma inferência para o conjunto de câmeras." : "Individual runs one Agent per camera. Group creates one inference for the camera set."}><select value={agent.executionScope ?? (agent.runEverySeconds >= 300 ? "inference_group" : "camera_agent")} onChange={(e) => change({ executionScope: e.target.value as AgentLoad["executionScope"], ...(e.target.value === "camera_agent" && agent.runEverySeconds > 60 ? { runEverySeconds: 60 as const } : {}) })} disabled={portalCounter}><option value="camera_agent">{lang === "pt" ? "Individual — por câmera" : "Individual — per camera"}</option><option value="inference_group">{lang === "pt" ? "Grupo — conjunto de câmeras" : "Group — camera set"}</option></select></Field>
          <Field label={lang === "pt" ? "Janela / executar a cada (Agents)" : "Window / run every (Agents)"}><select value={agent.runEverySeconds} onChange={(e) => change({ runEverySeconds: Number(e.target.value) as AgentLoad["runEverySeconds"] })} disabled={portalCounter}><option value="10">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 10 s / inferir a cada 10 s" : "10 s window / infer every 10 s") : (lang === "pt" ? "1 frame a cada 10 s" : "1 frame every 10 s")}</option><option value="60">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 60 s / inferir a cada 60 s" : "60 s window / infer every 60 s") : (lang === "pt" ? "1 frame a cada 60 s" : "1 frame every 60 s")}</option>{(agent.executionScope === "inference_group" || agent.runEverySeconds >= 300) && <><option value="300">{lang === "pt" ? "Grupo a cada 5 minutos" : "Group every 5 minutes"}</option><option value="600">{lang === "pt" ? "Grupo a cada 10 minutos" : "Group every 10 minutes"}</option></>}</select></Field>
        </div>
        {aiq && <div className="normalization">{lang === "pt" ? "A análise local seguirá a cadência e o escopo definidos acima. VÍDEO FULL usa uma sequência contínua; FRAME usa uma imagem por execução." : "Local analysis follows the cadence and scope above. FULL VIDEO uses a continuous sequence; FRAME uses one image per run."}</div>}
        {portalCounter && <div className="normalization">{lang === "pt" ? "Portal Counter usa vídeo, sequência de frames, 1 FPS e execução de 60 segundos; esses valores são aplicados automaticamente." : "Portal Counter uses video, frame sequence, 1 FPS, and a 60-second run; these values are applied automatically."}</div>}
        <div className="advanced-load-title">{lang === "pt" ? "Opções avançadas que também alteram a carga" : "Advanced options that also change the load"}</div>
        <div className="feature-row"><Toggle checked={agent.features.onlyCaptureOnMotion} onChange={(value) => change({ features: { ...agent.features, onlyCaptureOnMotion: value } })} label={lang === "pt" ? "Só capturar com movimento" : "Capture on motion only"} /><Toggle checked={agent.features.temporal} onChange={(value) => change({ features: { ...agent.features, temporal: value } })} label={lang === "pt" ? "Contexto temporal" : "Temporal context"} /><Toggle checked={agent.features.croppedFrame} onChange={(value) => change({ features: { ...agent.features, croppedFrame: value } })} label={lang === "pt" ? "Recorte do frame" : "Frame crop"} /></div>
        <div className="feature-counts"><Field label={lang === "pt" ? "Regiões/polígonos" : "Regions/polygons"}><input type="number" min="0" max="32" value={agent.features.regions} onChange={(e) => change({ features: { ...agent.features, regions: Number(e.target.value) } })} /></Field><Field label={lang === "pt" ? "Faces de referência" : "Reference faces"}><input type="number" min="0" max="4" value={agent.features.faceReferences} onChange={(e) => change({ features: { ...agent.features, faceReferences: Number(e.target.value) } })} /></Field><Field label={lang === "pt" ? "Imagens negativas" : "Negative images"}><input type="number" min="0" max="3" value={agent.features.negativeReferences} onChange={(e) => change({ features: { ...agent.features, negativeReferences: Number(e.target.value) } })} /></Field></div>
      </article>;
    })}<button className="secondary small" onClick={() => changeGroupAgents(group.id, [...group.agents, createDefaultAgent()])}>+ {lang === "pt" ? "Outro Agent nas mesmas câmeras" : "Another Agent on the same cameras"}</button></div>)}
    <button className="secondary" disabled={!scenario.cameraGroups.some((group) => group.count > 1)} onClick={() => update(splitCameraGroup(scenario))}>+ {lang === "pt" ? "Outro perfil para parte das câmeras" : "Another profile for some cameras"}</button>
  </section>;
}

function AdditionalStep({ scenario, update, lang }: { scenario: CapacityScenario; update: (next: CapacityScenario) => void; lang: Language }): ReactElement {
  const workload = scenario.concurrentWorkloads; const numberField = (key: keyof typeof workload, label: string) => <Field label={label}><input type="number" min="0" value={workload[key]} onChange={(e) => update({ ...scenario, concurrentWorkloads: { ...workload, [key]: Number(e.target.value) } })} /></Field>;
  return <section className="panel step-panel"><div className="section-heading"><p>04</p><div><h2>{text[lang].additional}</h2><span>{lang === "pt" ? "Concorrência além dos Agents contínuos." : "Concurrency beyond continuous Agents."}</span></div></div><div className="form-grid">
    {numberField("activeJobs", lang === "pt" ? "Jobs simultâneos" : "Concurrent Jobs")}{numberField("groupedJobCameras", lang === "pt" ? "Câmeras em Jobs multicâmera" : "Cameras in grouped Jobs")}{numberField("concurrentChatSessions", lang === "pt" ? "Chats simultâneos" : "Concurrent chats")}{numberField("activeSearches", lang === "pt" ? "Buscas simultâneas" : "Concurrent searches")}{numberField("intelligenceStreams", "Intelligence streams")}
  </div><div className="info-box">{lang === "pt" ? "O cálculo adiciona preparação de mídia, processos filhos, memória temporária e concorrência de inferência — não apenas o tempo da LLM." : "Sizing adds media preparation, child processes, temporary memory, and inference concurrency — not only LLM time."}</div></section>;
}

function NetworkStep({ scenario, lang }: { scenario: CapacityScenario; lang: Language }): ReactElement {
  const rtspMbps = scenario.cameraGroups.reduce((sum, group) => sum + group.count * group.source.bitrateMbps * 1.2, 0);
  return <section className="panel step-panel"><div className="section-heading"><p>05</p><div><h2>{text[lang].storage}</h2><span>{lang === "pt" ? "Rede RTSP, escrita dos clipes, leitura para inferência e retenção temporária." : "RTSP network, clip writes, inference reads and temporary retention."}</span></div></div>
    <div className="temporary-grid"><article className="temporary-card"><span>{lang === "pt" ? "Entrada RTSP estimada" : "Estimated RTSP ingress"}</span><strong>{Math.ceil(rtspMbps)} Mbps</strong><small>{lang === "pt" ? "Inclui 20% de margem de protocolo." : "Includes 20% protocol allowance."}</small></article><article className="temporary-card"><span>{lang === "pt" ? "Arquivos de inferência" : "Inference files"}</span><strong>{lang === "pt" ? "Temporários" : "Temporary"}</strong><small>{lang === "pt" ? "Normalmente removidos em até um dia." : "Normally removed within one day."}</small></article><article className="temporary-card"><span>{lang === "pt" ? "Arquivos de alerta" : "Alert files"}</span><strong>{lang === "pt" ? "Eventuais" : "Event-driven"}</strong><small>{lang === "pt" ? "Gerados somente quando há alerta." : "Created only when an alert occurs."}</small></article></div>
    <div className="info-box">{lang === "pt" ? "O dimensionamento considera throughput de escrita/leitura e pelo menos um dia de clipes temporários. Retenção e RAID configurados aumentam a capacidade exigida." : "Sizing includes write/read throughput and at least one day of rolling clips. Configured retention and RAID increase required capacity."}</div></section>;
}

const policyLabels: Record<RecommendationPolicy, { pt: string; en: string }> = { minimum: { pt: "Opção econômica", en: "Economical option" }, recommended: { pt: "Recomendado", en: "Recommended" }, n_plus_one: { pt: "N+1 resiliente", en: "Resilient N+1" } };

function confidenceText(prediction: CapacityPrediction | undefined, lang: Language): string {
  if (!prediction) return lang === "pt" ? "Somente referência" : "Reference only";
  const labels = {
    validated_local: { pt: "Testado exatamente", en: "Exactly tested" },
    extrapolated_high: { pt: "Recomendável por extrapolação", en: "Recommended by extrapolation" },
    extrapolated_medium: { pt: "Extrapolação moderada", en: "Moderate extrapolation" },
    reference_only: { pt: "Somente referência", en: "Reference only" },
    incompatible: { pt: "Incompatível", en: "Incompatible" },
  } as const;
  return labels[prediction.status][lang];
}

function DesignDetail({ design, lang, scenarioCameras }: { design: RecommendationAlternative; lang: Language; scenarioCameras: number }): ReactElement {
  const estimatedCapacity = scenarioCameras + design.maximumAdditionalCameras;
  const eligible = design.procurementEligibility === "eligible";
  const eligibilityLabel = design.procurementEligibility === "eligible"
    ? (lang === "pt" ? "APTO PARA AQUISIÇÃO" : "ELIGIBLE FOR PURCHASE")
    : design.procurementEligibility === "planning_only"
      ? (lang === "pt" ? "SOMENTE PLANEJAMENTO" : "PLANNING ONLY")
      : (lang === "pt" ? "ESTIMATIVA TÉCNICA — COMPRA REQUER EVIDÊNCIA" : "TECHNICAL ESTIMATE — PURCHASE REQUIRES EVIDENCE");
  return <div className="design-detail"><div className={`procurement-banner ${design.procurementEligibility}`}><b>{eligibilityLabel}</b><span>{eligible ? (lang === "pt" ? "Todos os estágios críticos possuem evidência comparável e margem conservadora." : "Every critical stage has comparable evidence and conservative reserve.") : (lang === "pt" ? "O cálculo usa especificações, benchmarks disponíveis e margens conservadoras. Ele serve para planejamento mesmo sem calibração, mas a compra deve considerar a incerteza declarada." : "The calculation uses specifications, available benchmarks, and conservative margins. It supports planning without calibration, but procurement must account for the stated uncertainty.")}</span></div><div className="spec-hero"><div><span>{lang === "pt" ? "Servidores" : "Nodes"}</span><strong>{design.nodeCount}</strong><small>{design.activeNodeCount} {lang === "pt" ? "ativos" : "active"}</small></div><div><span>{lang === "pt" ? "Folga" : "Headroom"}</span><strong>{design.headroomPercent}%</strong><small>{eligible ? (lang === "pt" ? "homologada" : "qualified") : (lang === "pt" ? "aplicada à estimativa" : "applied to estimate")}</small></div><div><span>{eligible ? (lang === "pt" ? "Capacidade segura" : "Safe capacity") : (lang === "pt" ? "Capacidade estimada" : "Estimated capacity")}</span><strong>{estimatedCapacity}</strong><small>{eligible ? (lang === "pt" ? `câmeras neste perfil (+${design.maximumAdditionalCameras})` : `cameras in this profile (+${design.maximumAdditionalCameras})`) : (lang === "pt" ? `câmeras para planejamento (+${design.maximumAdditionalCameras} além da carga informada)` : `planning cameras (+${design.maximumAdditionalCameras} beyond the requested load)`)}</small></div></div>
    <div className="hardware-title"><div><span>{visibleText(design.hardware.kind)} · {hardwareOperatingSystem(design.hardware)} · {visibleText(design.hardware.generation)}</span><h3>{visibleText(design.hardware.name)}</h3></div><div className="price-summary"><b>{design.price.median === null ? text[lang].quote : money(design.price.median, design.price.currency)}</b><small>{design.price.basis === "reference_estimate" ? (lang === "pt" ? "estimativa do projeto · cotação de compra necessária" : "project estimate · purchase quote required") : design.price.basis === "market_quotes" ? (lang === "pt" ? "preço de mercado do projeto" : "market project price") : text[lang].quote}</small></div></div>
    <div className="spec-grid"><div><span>CPU</span><b>{design.hardware.cpuModel}</b><small>{design.hardware.physicalCores} {lang === "pt" ? "núcleos" : "cores"} · {Math.round((design.hardware.sustainedComputeFactor ?? 1) * 100)}% {lang === "pt" ? "fator sustentado" : "sustained factor"}</small></div><div><span>RAM</span><b>{design.hardware.ramGb} GB {design.hardware.ecc ? "ECC" : ""}</b><small>{design.hardware.memoryArchitecture === "unified" ? (lang === "pt" ? "unificada CPU/GPU" : "unified CPU/GPU") : (lang === "pt" ? "por servidor" : "per server")}</small></div><div><span>GPU</span><b>{design.hardware.gpuCount}× {design.hardware.gpuModel}</b><small>{gpuMemoryLabel(design.hardware, lang)}</small></div><div><span>{lang === "pt" ? "NVMe operacional" : "Operational NVMe"}</span><b>{design.hardware.storageModel}</b><small>{lang === "pt" ? "clipes + leitura + retenção dimensionam servidores" : "clips + reads + retention constrain servers"}</small></div><div><span>{lang === "pt" ? "Rede" : "Network"}</span><b>{design.hardware.nicGbps} GbE</b><small>{design.hardware.chassis}</small></div><div><span>{lang === "pt" ? "Gargalo" : "Bottleneck"}</span><b>{visibleText(design.bottleneck)}</b><small>{visibleText(design.hardware.windowsEdition)}</small></div></div>
    {design.fleetPlan && <><h4>{lang === "pt" ? "Plano completo da frota" : "Complete fleet plan"}</h4><div className="spec-grid fleet-plan-grid">
      <div><span>{lang === "pt" ? "Servidores" : "Servers"}</span><b>{design.fleetPlan.activeServers} + {design.fleetPlan.reserveServers}</b><small>{design.fleetPlan.activeServers} {lang === "pt" ? "ativos" : "active"} · {design.fleetPlan.reserveServers} {lang === "pt" ? "reserva" : "reserve"} · {visibleText(design.fleetPlan.redundancyPolicy)}</small></div>
      <div><span>{eligible ? (lang === "pt" ? "Capacidade segura por servidor" : "Safe capacity per server") : (lang === "pt" ? "Capacidade estimada por servidor" : "Estimated capacity per server")}</span><b>{design.fleetPlan.safeCamerasPerServer} {lang === "pt" ? "câmeras" : "cameras"}</b><small>{lang === "pt" ? "já inclui a margem operacional indicada" : "already includes the stated operational headroom"}</small></div>
      <div><span>{lang === "pt" ? "CPU por servidor" : "CPU per server"}</span><b>{design.fleetPlan.perServer.cpuSockets} CPU / {design.fleetPlan.perServer.physicalCores}C</b><small>{design.fleetPlan.perServer.logicalCores} threads · {design.fleetPlan.totals.cpuSockets} CPU {lang === "pt" ? "na frota" : "fleet total"}</small></div>
      <div><span>{lang === "pt" ? "GPU por servidor" : "GPU per server"}</span><b>{design.fleetPlan.perServer.gpuCount} GPU</b><small>{design.fleetPlan.totals.gpuCount} GPU {lang === "pt" ? "na frota completa" : "in the complete fleet"}</small></div>
      <div><span>{lang === "pt" ? "RAM total" : "Total RAM"}</span><b>{Math.ceil(design.fleetPlan.totals.ramBytes / 1024 ** 3)} GB</b><small>{Math.ceil(design.fleetPlan.perServer.ramBytes / 1024 ** 3)} GB {lang === "pt" ? "por servidor" : "per server"}</small></div>
      <div><span>{lang === "pt" ? "Rede total" : "Total network"}</span><b>{design.fleetPlan.totals.networkGbps.toFixed(1)} Gbps</b><small>{design.fleetPlan.perServer.networkGbps} Gbps {lang === "pt" ? "por servidor" : "per server"} · {visibleText(design.fleetPlan.status)}</small></div>
    </div><div className={`info-box ${design.fleetPlan.status === "single_node_validated" ? "success" : "warning"}`}><b>{lang === "pt" ? "Validação do plano" : "Plan validation"}: {visibleText(design.fleetPlan.status)}</b><span>{design.fleetPlan.status === "planning_only" ? (lang === "pt" ? "Antes da compra, o conjunto precisa comprovar balanceamento, falha de servidor, rede, armazenamento e recuperação." : "Before purchase, the cluster must prove balancing, node failure, network, storage, and recovery.") : (lang === "pt" ? "Dimensionamento por servidor sustentado por evidência local compatível." : "Per-server sizing is supported by compatible local evidence.")}</span></div></>}
    <div className={`calibration-evidence ${design.calibration?.status ?? "reference_only"}`}><div><span>{lang === "pt" ? "Evidência" : "Evidence"}</span><b>{confidenceText(design.calibration, lang)}</b></div><div><span>{lang === "pt" ? "Confiança" : "Confidence"}</span><b>{visibleText(design.calibration?.confidenceClass ?? "—")}</b></div><div><span>{lang === "pt" ? "Faixa segura" : "Safe range"}</span><b>{eligible ? `${design.calibration?.safeCameraMinimum ?? "—"}–${design.calibration?.safeCameraMaximum ?? "—"}` : "—"} {lang === "pt" ? "câmeras" : "cameras"}</b></div><div><span>{lang === "pt" ? "Margem" : "Reserve"}</span><b>{design.calibration?.reservePercent ?? 40}%</b></div><small>{visibleText(design.calibration?.reasons.join(" ") ?? (lang === "pt" ? "Importe calibrações físicas e a base pública assinada para habilitar extrapolação." : "Import physical calibrations and the signed public evidence catalog to enable extrapolation."))}</small></div>
    {design.bom && <><h4>{lang === "pt" ? "Lista de componentes e cobertura" : "Auditable BOM and coverage"}</h4><div className="evidence-summary"><div><span>{lang === "pt" ? "Componentes" : "Components"}</span><b>{design.bom.items.length}</b><small>{visibleText(design.bom.kind)}</small></div><div><span>{lang === "pt" ? "Estágios cobertos" : "Covered stages"}</span><b>{design.bom.coverage.coveredStageCount}/{design.bom.coverage.requiredStageCount}</b><small>{design.bom.coverage.percent}%</small></div><div><span>{lang === "pt" ? "Âncoras físicas" : "Physical anchors"}</span><b>{design.bom.coverage.physicalAnchorCount}/3</b><small>{visibleText(design.bom.procurementGate.status)}</small></div></div><details className="bom-audit"><summary>{lang === "pt" ? "Ver componentes, benchmarks e bloqueios" : "View components, benchmarks and gates"}</summary><div className="bom-component-list">{design.bom.items.map((item) => <div key={`${item.role}:${item.componentId}`}><b>{visibleText(item.role)}</b><span>{item.quantity}× {item.componentId}</span><small>{visibleText(item.kind)}</small></div>)}</div><div className="stage-coverage-list">{design.bom.coverage.stages.map((stage) => <div className={stage.covered ? "covered" : "blocked"} key={stage.stage}><b>{visibleText(stage.stage)}</b><span>{stage.covered ? (lang === "pt" ? "coberto" : "covered") : (lang === "pt" ? "bloqueado" : "blocked")}</span><small>{stage.eligibleObservationIds.length} benchmarks · {stage.physicalAnchorRunIds.length} {lang === "pt" ? "âncoras" : "anchors"}{stage.reasons.length ? ` · ${visibleText(stage.reasons.join(" "))}` : ""}</small></div>)}</div></details></>}
    {design.procurementNeutralSpecification && <><h4>{lang === "pt" ? "Especificação técnica não comercial" : "Brand-neutral technical specification"}</h4><div className={`neutral-specification ${design.procurementNeutralSpecification.status}`}><div className="neutral-status"><b>{design.procurementNeutralSpecification.status === "apt" ? (lang === "pt" ? "APTA PARA REVISÃO DO TR" : "READY FOR TR REVIEW") : design.procurementNeutralSpecification.status === "review_required" ? (lang === "pt" ? "REVISÃO OBRIGATÓRIA" : "REVIEW REQUIRED") : (lang === "pt" ? "NÃO UTILIZAR PARA AQUISIÇÃO" : "DO NOT USE FOR PROCUREMENT")}</b><span>{lang === "pt" ? `Concorrência: ${visibleText(design.procurementNeutralSpecification.marketCompetitionAssessment.status)} · ${design.procurementNeutralSpecification.marketCompetitionAssessment.matchingProductCount} produtos · ${design.procurementNeutralSpecification.marketCompetitionAssessment.distinctManufacturerCount} fabricantes` : `Competition: ${visibleText(design.procurementNeutralSpecification.marketCompetitionAssessment.status)} · ${design.procurementNeutralSpecification.marketCompetitionAssessment.matchingProductCount} products · ${design.procurementNeutralSpecification.marketCompetitionAssessment.distinctManufacturerCount} manufacturers`}</span></div><details><summary>{lang === "pt" ? `Ver ${design.procurementNeutralSpecification.requirements.length} requisitos funcionais` : `View ${design.procurementNeutralSpecification.requirements.length} functional requirements`}</summary><div className="neutral-requirements">{design.procurementNeutralSpecification.requirements.map((item) => <article key={item.id}><div><b>{item.componentRole}</b><span>{item.characteristic}</span></div><strong>{item.comparator} {String(item.value)} {item.unit ?? ""}</strong><small>{item.rationale}</small><small>{lang === "pt" ? "Aceite" : "Acceptance"}: {item.acceptanceCriterion}</small></article>)}</div></details>{design.procurementNeutralSpecification.disclaimers.map((item) => <small key={item}>{item}</small>)}</div></>}
    {(design.price.componentEstimates?.length ?? 0) > 0 && <><h4>{lang === "pt" ? "Custo estimado por componente" : "Estimated component cost"}</h4><div className="cost-list">{design.price.componentEstimates.map((component) => <div key={component.componentId}><span>{component.component}</span><small>{lang === "pt" ? "por servidor" : "per server"}: {money(component.perNodeAmount, design.price.currency)}</small><b>{money(component.projectAmount, design.price.currency)}</b></div>)}<div className="cost-total"><span>{lang === "pt" ? `TOTAL · ${design.nodeCount} ${design.nodeCount === 1 ? "servidor" : "servidores"}` : `TOTAL · ${design.nodeCount} node(s)`}</span><small>{lang === "pt" ? "estimativa do projeto" : "project estimate"}</small><b>{money(design.price.median, design.price.currency)}</b></div></div></>}
    <h4>{lang === "pt" ? "Distribuição e utilização" : "Distribution & utilization"}</h4><div className="node-list">{design.allocations.map((node) => <div className="node-row" key={node.nodeIndex}><div><b>{lang === "pt" ? "Servidor" : "Node"} {node.nodeIndex}{(node.representedNodeCount ?? 1) > 1 ? ` × ${node.representedNodeCount}` : ""}</b><span>{visibleText(node.role)}</span></div><div className="node-cameras">{node.cameraGroups.map((group) => `${group.groupName}: ${group.cameras}`).join(" · ") || (lang === "pt" ? "Reserva" : "Standby")}</div><div className="meters"><span>CPU {percent(node.utilization.cpuCores)}</span><span>RAM {percent(node.utilization.ramGb)}</span><span>VRAM {percent(node.utilization.gpuVramGb)}</span><span>NVDEC {percent(node.utilization.gpuDecode1080p30Streams)}</span><span>LAN {percent(node.utilization.lanGbps)}</span></div></div>)}</div>
    <div className="sources">{design.hardware.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">↗ {visibleText(source.title)}</a>)}</div>{design.warnings.length > 0 && <details className="warning-list"><summary>{lang === "pt" ? `Ver ${design.warnings.length} avisos técnicos e pendências` : `View ${design.warnings.length} technical warnings and pending items`}</summary>{design.warnings.map((warning) => <span key={warning}>{visibleText(warning)}</span>)}</details>}
  </div>;
}

function ResultsStep({ scenario, recommendations, lang, onCalibration, onDownload }: { scenario: CapacityScenario; recommendations: CapacityRecommendation[]; lang: Language; onCalibration: (recommendation: CapacityRecommendation) => void; onDownload: (recommendation: CapacityRecommendation, format: ExportFormat) => Promise<void> }): ReactElement {
  const [selectedPolicy, setSelectedPolicy] = useState<RecommendationPolicy>("recommended"); const [variant, setVariant] = useState(0);
  const rec = recommendations.find((item) => item.policy === selectedPolicy) ?? recommendations[0];
  if (!rec) return <section className="panel empty-result"><h2>{lang === "pt" ? "Pronto para calcular" : "Ready to calculate"}</h2><p>{lang === "pt" ? "Revise o cenário e selecione Dimensionar infraestrutura." : "Review the scenario and select Size infrastructure."}</p></section>;
  const designs = [rec.primary, ...rec.alternatives]; const design = designs[Math.min(variant, designs.length - 1)]!;
  return <section className="panel result-panel"><div className="result-heading"><div><span className={`confidence ${rec.confidence}`}>{confidenceText(rec.primary.calibration, lang)}</span><h2>{lang === "pt" ? "Projeto de infraestrutura" : "Infrastructure design"}</h2><p>{lang === "pt" ? "As opções não testadas são extrapoladas por estágio e nunca aparecem como fisicamente validadas." : "Untested options are extrapolated per stage and never shown as physically validated."}</p></div><button className="secondary" onClick={() => onCalibration(rec)}>Calibração de capacidade</button></div>
    <div className="policy-tabs">{recommendations.map((item) => <button key={item.policy} className={selectedPolicy === item.policy ? "active" : ""} onClick={() => { setSelectedPolicy(item.policy); setVariant(0); }}><span>{policyLabels[item.policy][lang]}</span><b>{lang === "pt" ? `${item.primary.nodeCount} ${item.primary.nodeCount === 1 ? "servidor" : "servidores"}` : `${item.primary.nodeCount} nodes`}</b></button>)}</div>
    <div className="variant-tabs">{designs.map((item, index) => <button key={item.id} className={variant === index ? "active" : ""} onClick={() => setVariant(index)}>{index + 1}. {visibleText(item.hardware.name)} · {item.procurementEligibility === "eligible" ? (lang === "pt" ? "apta" : "eligible") : (lang === "pt" ? "referência" : "reference")}</button>)}</div>
    <div className="workload-summary"><h4>{lang === "pt" ? "Carga usada neste cálculo" : "Workload used for this calculation"}</h4>{scenario.cameraGroups.map((group) => <div className="workload-group" key={group.id}><b>{group.count}× {group.name}</b><span>{group.source.codec.toUpperCase()} · {group.source.width}×{group.source.height} · {group.source.sourceFps} FPS RTSP · {group.source.bitrateMbps} Mbps · decode {group.decodeMode.toUpperCase()}</span>{group.agents.map((agent) => <small key={agent.id}>{readingTypeLabel(agent, lang)} · {agent.model} · {agent.inputType === "video" ? `${agent.modelFps} FPS · ` : ""}{agent.runEverySeconds <= 10 ? 10 : 60} s</small>)}</div>)}</div>
    <DesignDetail design={design} lang={lang} scenarioCameras={scenario.totalCameras} />
    <div className="export-row">
      <section className="main-report-export" aria-label={REPORT_EXPORT_COPY[lang].mainTitle}>
        <div><strong>{REPORT_EXPORT_COPY[lang].mainTitle}</strong><span>{REPORT_EXPORT_COPY[lang].mainDescription}</span></div>
        <div className="export-actions"><button type="button" className="primary report-pdf-button" onClick={() => onDownload(rec, "pdf")}>{REPORT_EXPORT_COPY[lang].mainPdfButton}</button><span>{REPORT_EXPORT_COPY[lang].auditDescription}</span><button type="button" className="secondary small" onClick={() => onDownload(rec, "txt")}>TXT</button><button type="button" className="secondary small" onClick={() => onDownload(rec, "xlsx")}>XLSX</button><button type="button" className="secondary small" onClick={() => onDownload(rec, "json")}>JSON</button></div>
      </section>
      <section className="main-report-export technical-caderno-export" aria-label={REPORT_EXPORT_COPY[lang].technicalTitle}>
        <div><strong>{REPORT_EXPORT_COPY[lang].technicalTitle}</strong><span>{REPORT_EXPORT_COPY[lang].technicalDescription}</span></div>
        <div className="export-actions"><button type="button" className="secondary report-pdf-button" onClick={() => onDownload(rec, "technical-pdf")}>{REPORT_EXPORT_COPY[lang].technicalPdfButton}</button><button type="button" className="secondary report-pdf-button" onClick={() => onDownload(rec, "technical-docx")}>{REPORT_EXPORT_COPY[lang].technicalDocxButton}</button></div>
      </section>
      <details className="neutral-annex-export">
        <summary>{REPORT_EXPORT_COPY[lang].neutralSummary}</summary>
        <p>{REPORT_EXPORT_COPY[lang].neutralWarning}</p>
        <div className="export-actions">{(["tr-docx", "tr-pdf", "tr-json"] as const).map((format) => <button key={format} type="button" className="secondary small" onClick={() => onDownload(rec, format)}>{lang === "pt" ? "ANEXO " : "ANNEX "}{format.replace("tr-", "").toUpperCase()}</button>)}</div>
      </details>
    </div>
  </section>;
}

function CatalogManager({
  status,
  lang,
  onClose,
  onStatus,
  onCatalogApplied,
}: {
  status: CatalogStatus | null;
  lang: Language;
  onClose: () => void;
  onStatus: (status: CatalogStatus) => void;
  onCatalogApplied: (status: CatalogStatus, message: string) => void;
}): ReactElement {
  const [working, setWorking] = useState(false);
  const [detail, setDetail] = useState("");
  const [hardware, setHardware] = useState<HardwareNodeTemplate[]>([]);
  const [components, setComponents] = useState<HardwareComponent[]>([]);
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [publications, setPublications] = useState<CatalogPublication[]>([]);
  useEffect(() => {
    void api<HardwareNodeTemplate[]>("/api/catalog/hardware").then(setHardware).catch(() => setHardware([]));
    void api<HardwareComponent[]>("/api/catalog/components").then(setComponents).catch(() => setComponents([]));
    void api<CatalogSource[]>("/api/catalog/sources").then(setSources).catch(() => setSources([]));
    void api<CatalogPublication[]>("/api/catalog/publications").then(setPublications).catch(() => setPublications([]));
  }, [status?.catalogVersion]);

  const refresh = async (): Promise<void> => {
    setWorking(true); setDetail(lang === "pt" ? "Consultando o canal público oficial. O aplicativo validará checksum, assinatura, sequência e cadeia antes de ativar qualquer dado." : "Checking the official public channel. Checksum, signature, sequence and chain are verified before activation.");
    try {
      const next = await api<CatalogStatus>("/api/catalog/refresh", { method: "POST" });
      onCatalogApplied(next, next.lastUpdate?.message ?? (lang === "pt" ? `Hardware atualizado para ${next.catalogVersion}.` : `Hardware updated to ${next.catalogVersion}.`));
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "catalog_update_failed");
    } finally { setWorking(false); }
  };

  const importSnapshot = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!status?.verificationKeyConfigured) {
      setDetail(lang === "pt" ? "Salve primeiro a chave pública usada para verificar o catálogo." : "Save the catalog verification public key first.");
      return;
    }
    setWorking(true); setDetail(lang === "pt" ? "Etapa 1/4: lendo o arquivo. Nada será ativado até validar assinatura Ed25519, versão, equipamentos e preços." : "Step 1/4: reading and verifying the signed file before activation.");
    try {
      const response = await fetch("/api/catalog/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const body = await response.json() as CatalogStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      onCatalogApplied(body, body.lastUpdate?.message ?? (lang === "pt" ? `Catálogo assinado ${body.catalogVersion} importado.` : `Signed catalog ${body.catalogVersion} imported.`));
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "catalog_import_failed");
    } finally { setWorking(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
      <div className="modal-heading"><div><span>CATALOG / HARDWARE</span><h2 id="catalog-title">{lang === "pt" ? "Atualizar hardware" : "Update hardware"}</h2></div><button type="button" className="icon-button" aria-label={lang === "pt" ? "Fechar" : "Close"} onClick={onClose}>×</button></div>
      <div className="catalog-summary"><div><span>{lang === "pt" ? "Versão ativa" : "Active version"}</span><b>{status?.catalogVersion ?? "—"}</b><small>{status?.channel ?? "—"}</small></div><div><span>{lang === "pt" ? "Inventário" : "Inventory"}</span><b>{status?.hardwareCount ?? "—"} {lang === "pt" ? "máquinas" : "machines"}</b><small>{status?.componentCount ?? 0} {lang === "pt" ? "componentes" : "components"} · {status?.benchmarkCount ?? 0} benchmarks</small></div><div><span>{lang === "pt" ? "Preços" : "Prices"}</span><b>{status?.quoteCount ?? 0}</b><small>BRL · USD · EUR</small></div><div><span>{lang === "pt" ? "Segurança" : "Security"}</span><b>{status?.verificationKeyConfigured ? "ED25519 OK" : "—"}</b><small>SHA-256 · chain · anti-rollback</small></div></div>
      <div className="catalog-channel-info"><div><span>{lang === "pt" ? "Última publicação" : "Last publication"}</span><b>{status?.lastPublicationAt ? new Date(status.lastPublicationAt).toLocaleString() : (lang === "pt" ? "Catálogo embarcado" : "Bundled catalog")}</b></div><div><span>{lang === "pt" ? "Próxima coleta prevista" : "Next collection expected"}</span><b>{status?.nextCollectionExpectedAt ? new Date(status.nextCollectionExpectedAt).toLocaleString() : (lang === "pt" ? "Primeira publicação pendente" : "First publication pending")}</b></div><div><span>{lang === "pt" ? "Saúde das fontes" : "Source health"}</span><b>{status?.sourceHealth.healthy ?? 0} OK · {status?.sourceHealth.degraded ?? 0} {lang === "pt" ? "degradadas" : "degraded"} · {status?.sourceHealth.unavailable ?? 0} {lang === "pt" ? "indisponíveis" : "unavailable"}</b></div><div><span>{lang === "pt" ? "Histórico" : "History"}</span><b>{publications.length} {lang === "pt" ? "publicação(ões) local(is)" : "local publication(s)"} · {sources.length} {lang === "pt" ? "fontes" : "sources"}</b></div></div>
      <div className="catalog-hardware-heading"><div><span>{lang === "pt" ? "Lista ativa" : "Active list"}</span><h3>{lang === "pt" ? "Computadores e servidores considerados" : "Computers and servers considered"}</h3></div><small>{lang === "pt" ? "Apple requer seleção explícita de macOS. GPU integrada usa CPU decode no contrato atual." : "Apple requires explicit macOS selection. Integrated GPUs use CPU decode in the current contract."}</small></div>
      <div className="catalog-hardware-list">{hardware.map((item) => <article key={item.id}><div><b>{item.name}</b><span>{item.kind} · {hardwareOperatingSystem(item)}</span></div><small>{item.cpuModel} · {item.ramGb} GB {item.memoryArchitecture === "unified" ? "unified" : "RAM"} · {item.gpuModel}</small></article>)}</div>
      <details className="catalog-recovery"><summary>{lang === "pt" ? `Inventário por componente (${components.length})` : `Component inventory (${components.length})`}</summary><p>{lang === "pt" ? "Itens descobertos não viram recomendação até terem especificação, compatibilidade, benchmark do estágio e calibrações físicas suficientes." : "Discovered items are not recommended until specifications, compatibility, stage evidence and enough physical calibrations exist."}</p><div className="component-kind-summary">{[...new Set(components.map((item) => item.kind))].sort().map((kind) => <span key={kind}><b>{components.filter((item) => item.kind === kind).length}</b> {kind}</span>)}</div><div className="catalog-hardware-list component-list">{components.slice(0, 250).map((item) => <article key={item.id}><div><b>{item.manufacturer} {item.sku}</b><span>{item.kind} · {item.inventoryState ?? "discovered_inventory"}</span></div><small>{item.architecture} · {item.marketState ?? "reference_only"} · {item.technicalSpecification?.completeness.percent ?? 0}% {lang === "pt" ? "de especificação oficial" : "official specification coverage"}</small>{item.technicalSpecification && <details className="component-spec-details"><summary>{lang === "pt" ? "Ver especificações, fontes e lacunas" : "View specifications, sources and gaps"}</summary>{item.technicalSpecification.fields.filter((field) => field.status === "published").map((field) => <span key={field.code}><b>{field.labelPt}</b>: {String(field.value)} {field.unit ?? ""}{field.sourceEvidence[0] && <> · <a href={field.sourceEvidence[0].url} target="_blank" rel="noreferrer">{lang === "pt" ? "fonte oficial" : "official source"}</a> · {new Date(field.sourceEvidence[0].retrievedAt).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US")}</>}</span>)}{item.technicalSpecification.completeness.conflictingFieldCodes.length > 0 && <small>{lang === "pt" ? "Conflitos que exigem revisão" : "Conflicts requiring review"}: {item.technicalSpecification.completeness.conflictingFieldCodes.join(", ")}</small>}{item.technicalSpecification.completeness.missingRequiredFieldCodes.length > 0 && <small>{lang === "pt" ? "Campos oficiais ausentes" : "Missing official fields"}: {item.technicalSpecification.completeness.missingRequiredFieldCodes.join(", ")}</small>}</details>}</article>)}</div></details>
      <div className="catalog-actions"><button type="button" className="primary" disabled={working} onClick={refresh}>{working ? (lang === "pt" ? "Verificando com segurança…" : "Checking safely…") : (lang === "pt" ? "Verificar agora" : "Check now")}</button></div>
      <details className="catalog-recovery"><summary>{lang === "pt" ? "Recuperação avançada" : "Advanced recovery"}</summary><p>{lang === "pt" ? "Use somente se o canal público estiver indisponível e você recebeu um arquivo oficial assinado." : "Use only if the public channel is unavailable and you received an official signed file."}</p><label className={`secondary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar catálogo assinado" : "Import signed catalog"}<input type="file" hidden accept="application/json,.json" disabled={working} onChange={importSnapshot} /></label></details>
      {detail && <div className="catalog-message">{detail}</div>}
      {status?.lastUpdate && <div className="catalog-message">{status.lastUpdate.message}<br /><small>{status.lastUpdate.status} · {status.lastUpdate.added} novo(s) · {status.lastUpdate.updated} atualizado(s) · {status.lastUpdate.unchanged} inalterado(s)</small></div>}
      <p className="catalog-privacy">{lang === "pt" ? "A atualização é automática ao abrir e a cada 24 horas. O GitHub verifica as fontes a cada 15 dias. Somente dados públicos de hardware entram; projetos, câmeras e credenciais nunca são enviados. Se qualquer validação falhar, o catálogo anterior continua ativo." : "Updates run automatically at startup and every 24 hours. GitHub checks sources every 15 days. Only public hardware data is downloaded; projects, cameras and credentials are never uploaded. The previous catalog remains active after any validation failure."}</p>
    </section>
  </div>;
}

interface CalibrationStatusSummary {
  calibrationRuns: number;
  publicObservations: number;
  predictions: number;
  localOnly: true;
  inferenceProvider: "aiq_local";
}

interface CalibrationImportBatchSummary {
  totalItems: number;
  importedItems: number;
  diagnosticItems: number;
  duplicateItems: number;
  conflictItems: number;
  invalidItems: number;
  pendingTrustItems: number;
}

interface CalibrationImportResponse {
  error?: string;
  devices?: CalibrationDeviceIdentity[];
  importedRuns?: string[];
  preview?: boolean;
  batch?: CalibrationImportBatchSummary;
}

interface PendingCalibrationImport {
  fileName: string;
  bytes: ArrayBuffer;
  devices: CalibrationDeviceIdentity[];
  batch: CalibrationImportBatchSummary | null;
}

function calibrationPlanEstimate(plan: CalibrationPlan): { durationSeconds: number; worstCaseDurationSeconds: number; temporaryBytes: number } {
  const perCameraMbps = plan.scenario.cameraGroups.reduce((sum, group) => sum + group.count * group.source.bitrateMbps, 0) /
    Math.max(1, plan.scenario.totalCameras);
  const targetTier = plan.discovery.seedCameraCount ?? plan.scenario.totalCameras;
  const generatorLimit = plan.discovery.generatorCameraLimit ?? targetTier;
  const discoveryProbeEstimate = Math.max(4, Math.ceil(Math.log2(Math.max(2, generatorLimit))) + 2 +
    (plan.discovery.confirmationRuns ?? 1) * 2);
  const discoverySeconds = discoveryProbeEstimate *
    (plan.discovery.stabilizationSeconds + plan.discovery.sampleSeconds);
  const qualificationSeconds = plan.qualification.repetitions *
    plan.phases.reduce((sum, phase) => sum + phase.durationSeconds, 0) +
    (plan.qualification.repetitions - 1) * plan.qualification.cooldownSeconds +
    Math.min(30, plan.discovery.sampleSeconds);
  const worstCaseQualificationSeconds = qualificationSeconds;
  const peakTier = targetTier;
  const boundedRingSecondsAcrossCpuAndGpu = 4;
  const encodedAndIntermediateFactor = 2.5;
  const estimatedDurationSeconds = plan.mode === "quick"
    ? 600
    : discoverySeconds + qualificationSeconds;
  return {
    durationSeconds: estimatedDurationSeconds,
    worstCaseDurationSeconds: plan.mode === "quick" ? 600 : discoverySeconds + worstCaseQualificationSeconds,
    temporaryBytes: Math.ceil(peakTier * boundedRingSecondsAcrossCpuAndGpu * perCameraMbps * 1_000_000 / 8 *
      encodedAndIntermediateFactor + 512 * 1024 ** 2),
  };
}

function durationLabel(seconds: number, lang: Language): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  if (hours === 0) return `${minutes} ${lang === "pt" ? "min" : "min"}`;
  return `${hours}h${minutes ? ` ${minutes}min` : ""}`;
}

function clockLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
}

function byteLabel(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1_000 && unit < units.length - 1) { value /= 1_000; unit += 1; }
  return `${value >= 100 ? Math.ceil(value) : value.toFixed(1)} ${units[unit]}`;
}

function CalibrationCenter({
  recommendation,
  catalogStatus,
  hardwareCatalog,
  initialHardwareTemplateId,
  lang,
  onClose,
  onChanged,
}: {
  recommendation: CapacityRecommendation | null;
  catalogStatus: CatalogStatus | null;
  hardwareCatalog: HardwareNodeTemplate[];
  initialHardwareTemplateId: string | null;
  lang: Language;
  onClose: () => void;
  onChanged: (message: string) => void;
}): ReactElement {
  const [status, setStatus] = useState<CalibrationStatusSummary | null>(null);
  const [working, setWorking] = useState(false);
  const [detail, setDetail] = useState("");
  const advancedTelemetry = true;
  const [targetHardwareTemplateId, setTargetHardwareTemplateId] = useState(initialHardwareTemplateId ?? "");
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [result, setResult] = useState<LocalCalibrationRun | null>(null);
  const [diagnostic, setDiagnostic] = useState<CalibrationDiagnosticReportModel | null>(null);
  const [terminalDiagnostic, setTerminalDiagnostic] = useState<CalibrationDiagnosticReportModel | null>(null);
  const [resumeStatus, setResumeStatus] = useState<CalibrationResumeStatus | null>(null);
  const [history, setHistory] = useState<LocalCalibrationRun[]>([]);
  const [sessionHistory, setSessionHistory] = useState<CalibrationSession[]>([]);
  const [directory, setDirectory] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<CalibrationRuntimeStatus | null>(null);
  const [detectedHardware, setDetectedHardware] = useState<CalibrationHardwarePreflight | null>(null);
  const [planPreviews, setPlanPreviews] = useState<Record<CalibrationMode, CalibrationPlan> | null>(null);
  const [planPreviewError, setPlanPreviewError] = useState("");
  const [clockMs, setClockMs] = useState(Date.now());
  const [devices, setDevices] = useState<CalibrationDeviceIdentity[]>([]);
  const [collectionStatus, setCollectionStatus] = useState<CalibrationCollectionStatus | null>(null);
  const [pendingCalibrationImport, setPendingCalibrationImport] = useState<PendingCalibrationImport | null>(null);
  const [calibrationImportFeedback, setCalibrationImportFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const refreshStatus = (): void => {
    void api<CalibrationStatusSummary>("/api/calibrations/status").then(setStatus).catch(() => setStatus(null));
    void api<LocalCalibrationRun[]>("/api/calibrations").then((runs) => { setHistory(runs); if (!result && runs[0]) setResult(runs[0]); }).catch(() => setHistory([]));
    void api<CalibrationSession[]>("/api/calibration-sessions").then(setSessionHistory).catch(() => setSessionHistory([]));
    void api<{ directory: string }>("/api/calibration-sessions/directory").then((value) => setDirectory(value.directory)).catch(() => setDirectory(""));
    void api<CalibrationRuntimeStatus>("/api/calibrations/runtime-status").then(setRuntimeStatus).catch(() => setRuntimeStatus(null));
    void api<CalibrationHardwarePreflight>("/api/calibrations/hardware-status").then(setDetectedHardware).catch(() => setDetectedHardware(null));
    void api<CalibrationDeviceIdentity[]>("/api/calibration-devices").then(setDevices).catch(() => setDevices([]));
    void api<CalibrationCollectionStatus>("/api/calibration-collection/status").then(setCollectionStatus).catch(() => setCollectionStatus(null));
  };
  useEffect(refreshStatus, []);
  useEffect(() => {
    let active = true;
    if (!result) { setDiagnostic(null); return () => { active = false; }; }
    void api<CalibrationDiagnosticReportModel>(`/api/calibrations/${result.id}/reports/model`)
      .then((value) => { if (active) setDiagnostic(value); })
      .catch(() => { if (active) setDiagnostic(null); });
    return () => { active = false; };
  }, [result?.id]);
  useEffect(() => {
    let active = true;
    const terminal = session && ["cancelled", "failed", "interrupted"].includes(session.state);
    if (!terminal || !session?.diagnostic) {
      setTerminalDiagnostic(null);
      setResumeStatus(null);
      return () => { active = false; };
    }
    void Promise.all([
      api<CalibrationDiagnosticReportModel>(`/api/calibration-sessions/${session.id}/reports/model`),
      api<CalibrationResumeStatus>(`/api/calibration-sessions/${session.id}/resume-status`),
    ]).then(([report, status]) => {
      if (!active) return;
      setTerminalDiagnostic(report);
      setResumeStatus(status);
    }).catch((error: unknown) => {
      if (active) setDetail(error instanceof Error ? error.message : "calibration_diagnostic_report_failed");
    });
    return () => { active = false; };
  }, [session?.id, session?.state, session?.diagnostic?.payloadSha256]);
  useEffect(() => {
    let active = true;
    setPlanPreviewError("");
    if (!recommendation) { setPlanPreviews(null); return () => { active = false; }; }
    const preview = async (mode: CalibrationMode): Promise<CalibrationPlan> => api<CalibrationPlan>("/api/calibrations/plans", {
      method: "POST",
      body: JSON.stringify({ recommendationId: recommendation.id, mode, targetHardwareTemplateId: targetHardwareTemplateId || null }),
    });
    void Promise.all([preview("quick"), preview("validation"), preview("qualification")]).then(([quick, validation, qualification]) => {
      if (active) setPlanPreviews({ quick, validation, qualification });
    }).catch((error: unknown) => {
      if (!active) return;
      setPlanPreviews(null);
      setPlanPreviewError(error instanceof Error ? error.message : "calibration_plan_preview_failed");
    });
    return () => { active = false; };
  }, [recommendation?.id, targetHardwareTemplateId]);
  useEffect(() => {
    if (!session || ["completed", "cancelled", "failed", "interrupted", "expired"].includes(session.state)) return;
    const timer = window.setInterval(() => {
      void api<CalibrationSession>(`/api/calibration-sessions/${session.id}`).then((next) => {
        setSession(next);
        if (next.result) { setResult(next.result); refreshStatus(); }
        if (next.state === "cancelled") setDetail(lang === "pt" ? "Teste interrompido. Os agregados diagnósticos foram preservados e os temporários foram removidos." : "Test stopped. Diagnostic aggregates were preserved and temporary files were removed.");
        if (next.state === "failed" || next.state === "interrupted" || next.state === "expired") setDetail(next.error ?? next.state);
      }).catch((error: unknown) => setDetail(error instanceof Error ? error.message : "calibration_status_failed"));
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.state]);
  useEffect(() => {
    if (!session || ["completed", "cancelled", "failed", "interrupted", "expired"].includes(session.state)) return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.state]);

  const startCalibration = async (mode: CalibrationMode): Promise<void> => {
    if (!recommendation) {
      setDetail(lang === "pt" ? "Dimensione primeiro um projeto para definir a quantidade e o tipo de câmeras que serão testados." : "Size a project first to define the camera count and workload to be tested.");
      return;
    }
    if (mode === "qualification" && runtimeStatus?.manifestApproved === true && !targetHardwareTemplateId) {
      setDetail(lang === "pt"
        ? "Selecione o perfil exato deste computador antes das três repetições. Uma divergência física será recusada no preflight."
        : "Select this computer's exact profile before the three repetitions. A physical mismatch will be rejected during preflight.");
      return;
    }
    setWorking(true); setDetail(lang === "pt" ? "Preparando o teste desta máquina…" : "Preparing this machine test…");
    try {
      const started = await api<{ session: CalibrationSession; delivery: string }>("/api/calibration-sessions", {
        method: "POST",
        body: JSON.stringify({ recommendationId: recommendation.id, mode, targetHardwareTemplateId: targetHardwareTemplateId || null }),
      });
      setSession(started.session);
      setResult(null);
      setTerminalDiagnostic(null);
      setResumeStatus(null);
      setDetail(lang === "pt"
        ? `${mode === "quick" ? "Diagnóstico de 10 minutos" : mode === "validation" ? "Validação de engenharia com 60 minutos de carga, além da descoberta dinâmica" : "Teste adaptativo com três repetições"} iniciado. O resultado será salvo antes da limpeza automática dos arquivos temporários.`
        : `${mode === "quick" ? "10-minute diagnostic" : mode === "validation" ? "60-minute engineering test" : "Adaptive three-repetition test"} started. Results are saved before temporary files are removed.`);
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_launch_failed"); }
    finally { setWorking(false); }
  };

  const createPlan = async (mode: CalibrationMode): Promise<void> => {
    if (!recommendation) { setDetail(lang === "pt" ? "Dimensione primeiro um projeto." : "Size a project first."); return; }
    setWorking(true); setDetail("");
    try {
      const plan = await api<CalibrationPlan>("/api/calibrations/plans", {
        method: "POST",
        body: JSON.stringify({ recommendationId: recommendation.id, mode, targetHardwareTemplateId: targetHardwareTemplateId || null }),
      });
      downloadJson(`qual-hardware-${mode}-${plan.id}.qhplan.json`, plan);
      setDetail(lang === "pt"
        ? `Plano interno ${mode === "quick" ? "rápido" : mode === "validation" ? "de validação" : "de qualificação"} exportado para auditoria e recuperação.`
        : `${mode} internal plan exported for audit and recovery.`);
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_plan_failed"); }
    finally { setWorking(false); }
  };

  const cancelCalibration = async (): Promise<void> => {
    if (!session || !window.confirm(lang === "pt" ? "Interromper agora? Os agregados serão preservados para diagnóstico e os temporários serão apagados." : "Stop now? Aggregates will be kept for diagnostics and temporary files will be deleted.")) return;
    setWorking(true);
    try {
      const next = await api<CalibrationSession>(`/api/calibration-sessions/${session.id}/cancel`, { method: "POST" });
      setSession(next);
      setDetail(lang === "pt" ? "Interrompendo com segurança e salvando o diagnóstico parcial…" : "Stopping safely and saving partial diagnostics…");
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "calibration_cancel_failed");
    } finally {
      setWorking(false);
    }
  };

  const retryCleanup = async (): Promise<void> => {
    if (!session) return;
    setWorking(true);
    try {
      const next = await api<CalibrationSession>(`/api/calibration-sessions/${session.id}/retry-cleanup`, { method: "POST" });
      setSession(next);
      setDetail(lang === "pt" ? "Limpeza temporária concluída." : "Temporary cleanup completed.");
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "calibration_cleanup_failed");
    } finally { setWorking(false); }
  };

  const resumeCalibration = async (): Promise<void> => {
    if (!session) return;
    setWorking(true);
    try {
      const status = await api<CalibrationResumeStatus>(`/api/calibration-sessions/${session.id}/resume-status`);
      if (!status.resumable) throw new Error(status.incompatibilities.join(" · "));
      const resumed = await api<{ session: CalibrationSession }>(`/api/calibration-sessions/${session.id}/resume`, { method: "POST" });
      setSession(resumed.session);
      setResult(null);
      setTerminalDiagnostic(null);
      setResumeStatus(null);
      setDetail(lang === "pt"
        ? "Teste retomado do checkpoint compatível. A descoberta concluída foi reaproveitada; as três repetições comerciais recomeçarão na repetição 1."
        : "Test resumed from a compatible checkpoint. Completed discovery was reused; all three commercial repetitions restart at repetition 1.");
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "calibration_resume_failed");
    } finally { setWorking(false); }
  };

  const importCalibration = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setWorking(true); setDetail(""); setCalibrationImportFeedback(null); setPendingCalibrationImport(null);
    try {
      const bytes = await file.arrayBuffer();
      const upload = async (preview = false): Promise<Response> => fetch(`/api/calibration-imports${preview ? "?preview=1" : ""}`, {
        method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes,
      });
      const response = await upload(true);
      const body = await response.json() as CalibrationImportResponse;
      if (response.status === 409 && body.error === "calibration_device_confirmation_required" && body.devices?.length) {
        setPendingCalibrationImport({ fileName: file.name, bytes, devices: body.devices, batch: body.batch ?? null });
        setDetail(lang === "pt"
          ? "Confira a máquina e clique em “Confiar e importar” para concluir."
          : "Review the machine and click “Trust and import” to finish.");
        return;
      } else if (response.ok && body.preview && body.batch) {
        setPendingCalibrationImport({ fileName: file.name, bytes, devices: body.devices ?? [], batch: body.batch });
        setDetail(lang === "pt"
          ? "Prévia pronta. Clique em “Confiar e importar” para consolidar os resultados."
          : "Preview ready. Click “Trust and import” to consolidate the results.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      throw new Error(lang === "pt" ? "O servidor não produziu a prévia obrigatória da importação." : "The server did not produce the required import preview.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "calibration_import_failed";
      setDetail(message);
      setCalibrationImportFeedback({ kind: "error", message });
    }
    finally { setWorking(false); }
  };

  const confirmCalibrationImport = async (): Promise<void> => {
    if (!pendingCalibrationImport) return;
    setWorking(true); setCalibrationImportFeedback(null); setDetail("");
    try {
      for (const identity of pendingCalibrationImport.devices) {
        await api(`/api/calibration-devices/${identity.id}/trust`, { method: "POST" });
      }
      const response = await fetch("/api/calibration-imports", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: pendingCalibrationImport.bytes,
      });
      const body = await response.json() as CalibrationImportResponse;
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const batch = body.batch;
      const message = lang === "pt"
        ? `Importação concluída com sucesso: ${body.importedRuns?.length ?? 0} resultado(s) consolidado(s), ${batch?.diagnosticItems ?? 0} diagnóstico(s), ${batch?.duplicateItems ?? 0} duplicata(s), ${batch?.conflictItems ?? 0} conflito(s) e ${batch?.invalidItems ?? 0} inválido(s).`
        : `Import completed successfully: ${body.importedRuns?.length ?? 0} consolidated, ${batch?.diagnosticItems ?? 0} diagnostic, ${batch?.duplicateItems ?? 0} duplicate, ${batch?.conflictItems ?? 0} conflict, and ${batch?.invalidItems ?? 0} invalid.`;
      setPendingCalibrationImport(null);
      setCalibrationImportFeedback({ kind: "success", message });
      setDetail(message);
      refreshStatus();
      onChanged(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "calibration_import_failed";
      setDetail(message);
      setCalibrationImportFeedback({ kind: "error", message });
    } finally {
      setWorking(false);
    }
  };

  const exportCalibration = async (
    run: LocalCalibrationRun,
    format: "pdf" | "txt" | "xlsx" | "json" | "qhcal" = "qhcal",
  ): Promise<void> => {
    setWorking(true);
    try {
      const path = format === "qhcal"
        ? `/api/calibrations/${run.id}/export`
        : `/api/calibrations/${run.id}/reports/${format}`;
      const fallback = format === "qhcal" ? `${run.id}.qhcal` : `${run.id}-diagnostico.${format}`;
      await downloadBinaryResponse(await fetch(path), fallback);
      setDetail(format === "qhcal"
        ? (lang === "pt" ? "Pacote .qhcal assinado exportado." : "Signed .qhcal package exported.")
        : `Relatório ${format.toUpperCase()} exportado com sucesso.`);
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_export_failed"); }
    finally { setWorking(false); }
  };

  const exportTerminalDiagnostic = async (
    format: "pdf" | "txt" | "xlsx" | "json",
  ): Promise<void> => {
    if (!session) return;
    setWorking(true);
    try {
      await downloadBinaryResponse(
        await fetch(`/api/calibration-sessions/${session.id}/reports/${format}`),
        `${terminalDiagnostic?.runId ?? session.id}-inconclusivo.${format}`,
      );
      setDetail(`Relatório ${format.toUpperCase()} do resultado inconclusivo exportado com sucesso.`);
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "calibration_diagnostic_export_failed");
    } finally {
      setWorking(false);
    }
  };

  const exportCollection = async (): Promise<void> => {
    setWorking(true);
    try {
      await downloadBinaryResponse(await fetch("/api/calibration-collections/export", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      }), "qual-hardware-calibrations.qhcalset");
      refreshStatus();
      setDetail(lang === "pt" ? "Coleção consolidada .qhcalset exportada." : "Consolidated .qhcalset collection exported.");
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_collection_export_failed"); }
    finally { setWorking(false); }
  };

  const importEvidence = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (!catalogStatus?.verificationKeyConfigured) {
      setDetail(lang === "pt" ? "Configure primeiro a chave pública Ed25519 em Atualizar hardware." : "Configure the Ed25519 public key under Update hardware first.");
      return;
    }
    setWorking(true); setDetail(lang === "pt" ? "Validando assinatura, componentes, versões, unidades e proveniência antes de ativar a nova base." : "Validating signature, components, versions, units and provenance before activation.");
    try {
      const response = await fetch("/api/evidence/import", { method: "POST", headers: { "content-type": "application/json" }, body: await file.text() });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      refreshStatus();
      onChanged(lang === "pt" ? "Base pública assinada importada. Recalcule as máquinas sugeridas." : "Signed public evidence imported. Recalculate suggested machines.");
    } catch (error) { setDetail(error instanceof Error ? error.message : "evidence_import_failed"); }
    finally { setWorking(false); }
  };

  const recalculate = async (): Promise<void> => {
    setWorking(true); setDetail("");
    try {
      const predictions = await api<CapacityPrediction[]>("/api/predictions/recalculate", { method: "POST" });
      refreshStatus();
      const message = lang === "pt" ? `${predictions.length} máquinas recalculadas com as calibrações válidas.` : `${predictions.length} machines recalculated with valid calibrations.`;
      setDetail(message); onChanged(message);
    } catch (error) { setDetail(error instanceof Error ? error.message : "prediction_recalculation_failed"); }
    finally { setWorking(false); }
  };

  const openDirectory = async (): Promise<void> => {
    try {
      const opened = await api<{ directory: string }>("/api/calibration-sessions/open-directory", { method: "POST" });
      setDirectory(opened.directory);
    } catch (error) { setDetail(error instanceof Error ? error.message : "open_calibration_directory_failed"); }
  };

  const quickEstimate = planPreviews ? calibrationPlanEstimate(planPreviews.quick) : null;
  const validationEstimate = planPreviews ? calibrationPlanEstimate(planPreviews.validation) : null;
  const qualificationEstimate = planPreviews ? calibrationPlanEstimate(planPreviews.qualification) : null;
  const quickTestBlockReason = !recommendation
    ? (lang === "pt"
      ? "Primeiro dimensione a infraestrutura para vincular o teste à quantidade e à composição VÍDEO FULL/FRAME informadas."
      : "First size the infrastructure to bind the test to the requested camera count and FULL VIDEO/FRAME composition.")
    : runtimeStatus === null
      ? (lang === "pt" ? "Verificando os recursos locais para o diagnóstico…" : "Checking local diagnostic resources…")
      : runtimeStatus.readyForQuickTest === false
        ? (lang === "pt"
          ? "O diagnóstico rápido não está disponível neste sistema. Volte à Verificação do ambiente para consultar o motivo."
          : "Quick diagnostics are unavailable on this system. Return to Environment verification for the reason.")
        : planPreviewError
          ? (lang === "pt"
            ? `Não foi possível preparar o plano de teste: ${planPreviewError}`
            : `The test plan could not be prepared: ${planPreviewError}`)
          : !planPreviews
            ? (lang === "pt" ? "Preparando o plano local de teste…" : "Preparing the local test plan…")
            : "";
  const sessionIsActive = Boolean(session && !["completed", "cancelled", "failed", "interrupted", "expired"].includes(session.state));
  const progressAgeSeconds = session?.progress?.updatedAt && sessionIsActive
    ? Math.max(0, (clockMs - Date.parse(session.progress.updatedAt)) / 1_000) : 0;
  const displayedElapsedSeconds = (session?.progress?.elapsedSeconds ?? 0) + progressAgeSeconds;
  const displayedRemainingSeconds = session?.progress?.estimatedRemainingSeconds === null || session?.progress?.estimatedRemainingSeconds === undefined
    ? null : Math.max(0, session.progress.estimatedRemainingSeconds - progressAgeSeconds);
  const displayedProgressPercent = Math.round(session?.progress?.overallPercent ?? session?.progress?.percent ?? 0);
  const sessionStateLabel = session?.state === "completed"
    ? (lang === "pt" ? "Concluído" : "Completed")
    : session?.state === "failed" || session?.state === "interrupted"
      ? (lang === "pt" ? "Inconclusivo" : "Inconclusive")
      : session?.state === "cancelled"
        ? (lang === "pt" ? "Cancelado" : "Cancelled")
        : session?.state ?? "";

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="catalog-modal calibration-modal" role="dialog" aria-modal="true" aria-labelledby="calibration-title">
      <div className="modal-heading"><div><span>QUAL HARDWARE / TESTE DA MÁQUINA</span><h2 id="calibration-title">{lang === "pt" ? "Calibração de capacidade" : "Capacity calibration"}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div>
      <div className="offline-banner"><b>{lang === "pt" ? "Antes de iniciar" : "Before starting"}</b><span>{lang === "pt" ? "Conecte a máquina à energia, feche tarefas pesadas e mantenha a ventilação desobstruída durante todo o teste." : "Connect the machine to power, close heavy tasks, and keep ventilation unobstructed throughout the test."}</span></div>
      <div className="calibration-import-entry">
        <div><b>{lang === "pt" ? "Trazer calibração de outro computador" : "Bring calibration from another computer"}</b><span>{lang === "pt" ? "Importe um resultado .qhcal ou uma coleção .qhcalset gerada no Windows, Ubuntu ou macOS." : "Import a .qhcal result or .qhcalset collection generated on Windows, Ubuntu, or macOS."}</span></div>
        <label className={`primary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar calibração de outro computador" : "Import calibration from another computer"}<input aria-label={lang === "pt" ? "Importar calibração de outro computador" : "Import calibration from another computer"} hidden type="file" accept=".qhcal,.qhcalset,application/gzip" disabled={working} onChange={importCalibration} /></label>
      </div>
      {pendingCalibrationImport && <section className="calibration-import-review" aria-labelledby="calibration-import-review-title">
        <div><span>{lang === "pt" ? "PRÉVIA DA IMPORTAÇÃO" : "IMPORT PREVIEW"}</span><h3 id="calibration-import-review-title">{pendingCalibrationImport.fileName}</h3><p>{lang === "pt" ? "Confira os códigos das máquinas. Nenhum resultado será consolidado até você clicar no botão abaixo." : "Review the machine codes. No result is consolidated until you click the button below."}</p></div>
        {pendingCalibrationImport.batch && <div className="calibration-import-counts">
          <div><span>{lang === "pt" ? "Resultados" : "Results"}</span><b>{pendingCalibrationImport.batch.totalItems}</b></div>
          <div><span>{lang === "pt" ? "Válidos" : "Valid"}</span><b>{pendingCalibrationImport.batch.importedItems}</b></div>
          <div><span>{lang === "pt" ? "Diagnósticos" : "Diagnostics"}</span><b>{pendingCalibrationImport.batch.diagnosticItems}</b></div>
          <div><span>{lang === "pt" ? "Pendentes de confiança" : "Pending trust"}</span><b>{pendingCalibrationImport.batch.pendingTrustItems}</b></div>
          <div><span>{lang === "pt" ? "Duplicatas" : "Duplicates"}</span><b>{pendingCalibrationImport.batch.duplicateItems}</b></div>
          <div><span>{lang === "pt" ? "Conflitos/inválidos" : "Conflicts/invalid"}</span><b>{pendingCalibrationImport.batch.conflictItems + pendingCalibrationImport.batch.invalidItems}</b></div>
        </div>}
        {pendingCalibrationImport.devices.length > 0 && <div className="calibration-import-devices"><b>{lang === "pt" ? "Máquinas que receberão confiança" : "Machines that will be trusted"}</b>{pendingCalibrationImport.devices.map((identity) => <span key={identity.id}>{identity.shortCode} · {identity.id.slice(0, 12)}…</span>)}</div>}
        <div className="catalog-actions"><button type="button" className="primary" disabled={working} onClick={() => void confirmCalibrationImport()}>{working ? (lang === "pt" ? "Importando…" : "Importing…") : (lang === "pt" ? "Confiar e importar" : "Trust and import")}</button><button type="button" className="secondary" disabled={working} onClick={() => { setPendingCalibrationImport(null); setDetail(""); }}>{lang === "pt" ? "Cancelar" : "Cancel"}</button></div>
      </section>}
      {calibrationImportFeedback && <div className={`calibration-import-feedback ${calibrationImportFeedback.kind}`} role="alert" aria-live="assertive"><b>{calibrationImportFeedback.kind === "success" ? (lang === "pt" ? "Importação concluída" : "Import completed") : (lang === "pt" ? "A importação não foi concluída" : "Import was not completed")}</b><span>{calibrationImportFeedback.message}</span></div>}
      {runtimeStatus && <div className={`runtime-readiness ${runtimeStatus.readyForFullQualification ? "ready" : "diagnostic"}`}><b>{runtimeStatus.readyForFullQualification
        ? runtimeStatus.manifestApproved
          ? (lang === "pt" ? "Pronto para qualificação" : "Ready for qualification")
          : (lang === "pt" ? "Pronto para validação física" : "Ready for physical validation")
        : (lang === "pt" ? "Pronto para diagnóstico" : "Ready for diagnostics")}</b><span>{runtimeStatus.readyForFullQualification
          ? runtimeStatus.manifestApproved
            ? (lang === "pt" ? "CPU, GPU, vídeo e estabilidade serão medidos automaticamente." : "CPU, GPU, video, and stability are measured automatically.")
            : (lang === "pt" ? "O teste medirá CPU, GPU e vídeo; o relatório informará as limitações encontradas." : "The test measures CPU, GPU, and video; the report lists any limitations.")
          : (lang === "pt" ? "A aplicação usará os recursos encontrados e identificará claramente quando o resultado for uma estimativa." : "The application uses detected resources and clearly identifies estimated results.")}</span></div>}
      <div className="catalog-summary"><div><span>{lang === "pt" ? "Máquinas testadas" : "Tested machines"}</span><b>{status?.calibrationRuns ?? 0}</b><small>{lang === "pt" ? "resultados disponíveis" : "available results"}</small></div><div><span>{lang === "pt" ? "Medições reunidas" : "Combined measurements"}</span><b>{status?.publicObservations ?? 0}</b><small>{lang === "pt" ? "base de comparação" : "comparison base"}</small></div><div><span>{lang === "pt" ? "Previsões" : "Predictions"}</span><b>{status?.predictions ?? 0}</b><small>{lang === "pt" ? "por gargalo" : "per bottleneck"}</small></div></div>
      <div className="calibration-flow"><article><b>1. {lang === "pt" ? "Calibrar este computador" : "Calibrate this computer"}</b><span>{lang === "pt" ? "O hardware é detectado automaticamente. A seleção abaixo só é necessária quando você deseja vincular o resultado a um modelo de máquina específico." : "Hardware is detected automatically. The selection below is only needed when you want to link the result to a specific machine model."}</span>{detectedHardware && <div className="calibration-detected"><b>{detectedHardware.cpuModel}</b><span>{detectedHardware.physicalCores}C/{detectedHardware.logicalCores}T · {byteLabel(detectedHardware.ramBytes)} RAM · {detectedHardware.operatingSystem} {detectedHardware.operatingSystemVersion}</span><small>{detectedHardware.gpuModel} · {detectedHardware.networkLinks.map((link) => `${link.name}${link.speedMbps ? ` ${link.speedMbps} Mbps ${link.duplex}` : " velocidade não verificada"}`).join(" · ") || (lang === "pt" ? "rede física não detectada" : "physical network not detected")}</small></div>}<Field label={lang === "pt" ? "Computador físico em teste" : "Physical computer under test"}><select value={targetHardwareTemplateId} onChange={(event) => setTargetHardwareTemplateId(event.target.value)}><option value="">{lang === "pt" ? "Detectar hardware automaticamente" : "Detect hardware automatically"}</option>{[...hardwareCatalog].sort((left, right) => left.name.localeCompare(right.name)).map((hardware) => <option key={hardware.id} value={hardware.id}>{hardware.name} · {hardware.cpuModel} · {hardware.gpuModel}</option>)}</select></Field>{planPreviews && quickEstimate && validationEstimate && qualificationEstimate && <div className="calibration-preflight"><div><span>{lang === "pt" ? "Carga configurada" : "Configured workload"}</span><b>{planPreviews.quick.scenario.totalCameras} {lang === "pt" ? "câmeras" : "cameras"}</b><small>{lang === "pt" ? "VÍDEO FULL e FRAME conforme o projeto" : "FULL VIDEO and FRAME as configured"}</small></div><div><span>{lang === "pt" ? "Diagnóstico" : "Diagnostic"}</span><b>{durationLabel(quickEstimate.durationSeconds, lang)}</b><small>{lang === "pt" ? "resultado preliminar" : "preliminary result"}</small></div><div><span>{lang === "pt" ? "Validação" : "Validation"}</span><b>{durationLabel(validationEstimate.durationSeconds, lang)}</b><small>{lang === "pt" ? "uma repetição sustentada" : "one sustained repetition"}</small></div><div><span>{lang === "pt" ? "Qualificação - mínimo/pior caso" : "Qualification - minimum/worst case"}</span><b>{durationLabel(qualificationEstimate.durationSeconds, lang)} - {durationLabel(qualificationEstimate.worstCaseDurationSeconds, lang)}</b><small>{lang === "pt" ? `até ${byteLabel(qualificationEstimate.temporaryBytes)} de arquivos temporários` : `up to ${byteLabel(qualificationEstimate.temporaryBytes)} of temporary files`}</small></div><div><span>{lang === "pt" ? "Telemetria" : "Telemetry"}</span><b>{lang === "pt" ? "automática" : "automatic"}</b><small>{lang === "pt" ? "sensores disponíveis serão usados" : "available sensors will be used"}</small></div></div>}<div className="info-box">{lang === "pt" ? "Conecte a máquina à energia, feche tarefas pesadas e garanta ventilação contínua. Os sensores disponíveis serão usados automaticamente." : "Connect the machine to power, close heavy tasks, and ensure continuous ventilation. Available sensors are used automatically."}</div><div className="catalog-actions"><button className="primary" disabled={working || Boolean(quickTestBlockReason)} onClick={() => void startCalibration("quick")}>{lang === "pt" ? "Diagnóstico - 10 minutos" : "Diagnostic - 10 minutes"}</button><button className="primary" disabled={working || Boolean(quickTestBlockReason)} onClick={() => void startCalibration("validation")}>{lang === "pt" ? "Validação - 60 minutos" : "Validation - 60 minutes"}</button><button className="primary" disabled={working || !recommendation || !planPreviews || !runtimeStatus?.readyForFullQualification} onClick={() => void startCalibration("qualification")}>{runtimeStatus?.manifestApproved
        ? (lang === "pt" ? "Qualificação comercial — 3 repetições" : "Commercial qualification — 3 repetitions")
        : (lang === "pt" ? "Qualificação física — diagnóstico" : "Physical qualification — diagnostic")}</button></div>{quickTestBlockReason && <small className="calibration-block-reason" role="status">{quickTestBlockReason}</small>}</article>
        {session && <article className="calibration-live"><b>2. {lang === "pt" ? "Progresso em tempo real" : "Live progress"}</b><div className={`calibration-progress ${sessionIsActive ? "" : session.state}`}><div><i style={{ width: `${displayedProgressPercent}%` }} /></div><b>{sessionIsActive ? `${displayedProgressPercent}%` : sessionStateLabel}</b></div><span>{session.progress?.message ?? detail}</span><div className="calibration-time-grid"><div><span>{lang === "pt" ? "Tempo decorrido" : "Elapsed"}</span><b>{clockLabel(displayedElapsedSeconds)}</b></div><div><span>{lang === "pt" ? "Tempo estimado restante" : "Estimated remaining"}</span><b>{displayedRemainingSeconds === null ? "—" : clockLabel(displayedRemainingSeconds)}</b></div><div><span>{lang === "pt" ? "Término estimado" : "Estimated finish"}</span><b>{displayedRemainingSeconds === null ? "—" : new Date(clockMs + displayedRemainingSeconds * 1_000).toLocaleTimeString()}</b></div><div><span>{lang === "pt" ? "Confiança da estimativa" : "Estimate confidence"}</span><b>{session.progress?.estimateConfidence ?? "—"}{session.progress?.estimateAdjusted ? (lang === "pt" ? " · ajustada" : " · adjusted") : ""}</b></div></div><small>{sessionStateLabel}{session.progress?.tier ? ` · ${session.progress.tier} câmeras` : ""}{session.progress?.repetition ? ` · repetição ${session.progress.repetition}/${session.mode === "qualification" ? 3 : 1}` : ""} · {lang === "pt" ? "telemetria automática" : "automatic telemetry"}</small>{session.progress && <small>{lang === "pt" ? "Disco" : "Disk"}: {byteLabel(session.progress.bytesTemporary ?? 0)} {lang === "pt" ? "em uso" : "in use"} · {byteLabel(session.progress.bytesRemoved ?? 0)} {lang === "pt" ? "removidos" : "removed"} · {byteLabel(session.progress.diskReserveBytes ?? 0)} {lang === "pt" ? "reservados" : "reserved"}</small>}{session.cleanup && <small>{lang === "pt" ? "Limpeza" : "Cleanup"}: {session.cleanup.state} · {session.cleanup.bytesRemoved}/{session.cleanup.bytesTemporary} bytes</small>}{session.diagnostic && <small>{lang === "pt" ? "Diagnóstico preservado" : "Diagnostic preserved"}: {session.diagnostic.completedMeasurementCount} {lang === "pt" ? "fase(s) concluída(s)" : "completed phase(s)"}</small>}{["preflight", "discovering", "validating", "qualifying"].includes(session.state) && <div className="catalog-actions"><button type="button" className="secondary" disabled={working || session.progress?.stage === "cancelling"} onClick={() => void cancelCalibration()}>{session.progress?.stage === "cancelling" ? (lang === "pt" ? "Salvando diagnóstico e limpando…" : "Saving diagnostic and cleaning…") : (lang === "pt" ? "Interromper e limpar temporários" : "Stop and clean temporary files")}</button></div>}{["cancelled", "failed", "interrupted"].includes(session.state) && resumeStatus?.resumable && <button type="button" className="primary" disabled={working} onClick={() => void resumeCalibration()}>{lang === "pt" ? "Retomar do ponto salvo" : "Resume from saved point"}</button>}{["cancelled", "failed", "interrupted"].includes(session.state) && resumeStatus && !resumeStatus.resumable && <small className="calibration-block-reason">{lang === "pt" ? "Esta execução não pode ser retomada. Corrija a causa indicada e inicie um novo diagnóstico." : "This run cannot be resumed. Resolve the reported cause and start a new diagnostic."}</small>}{session.cleanup?.state === "failed" && <button type="button" className="secondary" disabled={working} onClick={() => void retryCleanup()}>{lang === "pt" ? "Tentar limpeza novamente" : "Retry cleanup"}</button>}</article>}
        <article><b>{session ? "3" : "2"}. {lang === "pt" ? "Reunir resultados de várias máquinas" : "Combine results from multiple machines"}</b><span>{lang === "pt" ? "Importe resultados gerados no Windows, Ubuntu ou macOS. A identidade da máquina é confirmada antes de incluir as medições na base de comparação." : "Import results generated on Windows, Ubuntu, or macOS. Machine identity is confirmed before measurements are added to the comparison base."}</span><div className="catalog-summary"><div><span>{lang === "pt" ? "Resultados" : "Results"}</span><b>{collectionStatus?.runs ?? 0}</b></div><div><span>{lang === "pt" ? "Máquinas testadas" : "Tested machines"}</span><b>{collectionStatus?.measuredSystems ?? 0}</b><small>{collectionStatus?.distinctConfigurations ?? 0} {lang === "pt" ? "configurações distintas" : "distinct configurations"}</small></div><div><span>{lang === "pt" ? "Identidades confiáveis" : "Trusted identities"}</span><b>{collectionStatus?.trustedDevices ?? 0}</b><small>{collectionStatus?.pendingDevices ?? 0} {lang === "pt" ? "pendentes" : "pending"}</small></div></div><div className="catalog-actions"><label className={`secondary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar resultado ou coleção" : "Import result or collection"}<input hidden type="file" accept=".qhcal,.qhcalset,application/gzip" disabled={working} onChange={importCalibration} /></label><button className="secondary" disabled={working || (collectionStatus?.runs ?? 0) === 0} onClick={() => void exportCollection()}>{lang === "pt" ? "Exportar coleção consolidada" : "Export consolidated collection"}</button><button className="secondary" disabled={working || !recommendation} onClick={() => void createPlan("quick")}>{lang === "pt" ? "Exportar plano para auditoria" : "Export plan for audit"}</button><label className={`secondary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar base de medições" : "Import measurement base"}<input hidden type="file" accept=".json" disabled={working} onChange={importEvidence} /></label></div>{devices.filter((identity) => identity.trust !== "trusted").map((identity) => <small key={identity.id}>{identity.shortCode} · {identity.trust}</small>)}</article></div>
      {detail && <div className="catalog-message">{detail}</div>}
      {terminalDiagnostic && !result && <section className="calibration-result terminal-diagnostic" aria-labelledby="terminal-diagnostic-title">
        <div className="calibration-result-heading"><div><span>RESULTADO DO TESTE</span><h3 id="terminal-diagnostic-title">Diagnóstico inconclusivo</h3></div><b className="calibration-verdict invalid">INCONCLUSIVO</b></div>
        <p className="calibration-natural-verdict">A execução terminou antes de produzir evidência suficiente. Este evento não define a capacidade máxima da máquina.</p>
        <div className="operator-answer-grid">
          <div><span>Carga solicitada</span><b>{terminalDiagnostic.requested.cameras}</b><small>câmeras</small></div>
          <div><span>Capacidade segura</span><b>—</b><small>não determinada</small></div>
          <div><span>Maior carga aprovada</span><b>—</b><small>não determinada</small></div>
          <div><span>Primeira carga reprovada</span><b>—</b><small>não determinada</small></div>
        </div>
        {terminalDiagnostic.findings.map((finding) => <article className={`terminal-finding ${finding.severity}`} key={finding.code}><b>{finding.titlePt}</b><p>{finding.consequencePt}</p><span>{finding.actionPt}</span></article>)}
        <div className="diagnostic-export-actions">
          <button className="primary" type="button" disabled={working} onClick={() => void exportTerminalDiagnostic("pdf")}>Baixar relatório PDF</button>
          <button className="secondary" type="button" disabled={working} onClick={() => void exportTerminalDiagnostic("txt")}>Baixar TXT</button>
          <button className="secondary" type="button" disabled={working} onClick={() => void exportTerminalDiagnostic("xlsx")}>Baixar XLSX</button>
          <button className="secondary" type="button" disabled={working} onClick={() => void exportTerminalDiagnostic("json")}>Baixar JSON</button>
          <button className="secondary" type="button" disabled={working} onClick={() => void openDirectory()}>Abrir pasta dos resultados</button>
        </div>
      </section>}
      {result && <CalibrationResultPanel result={result} diagnostic={diagnostic} directory={directory} lang={lang} onOpenDirectory={() => void openDirectory()} onExport={(format) => void exportCalibration(result, format)} onRecalculate={() => void recalculate()} />}
      {sessionHistory.some((item) => item.diagnostic && ["failed", "interrupted", "cancelled"].includes(item.state)) && <section className="calibration-history"><div><span>DIAGNÓSTICOS</span><h3>{lang === "pt" ? "Execuções inconclusivas ou canceladas" : "Inconclusive or cancelled runs"}</h3></div>{sessionHistory.filter((item) => item.diagnostic && ["failed", "interrupted", "cancelled"].includes(item.state)).map((item) => <button type="button" key={item.id} className={session?.id === item.id ? "active" : ""} onClick={() => { setResult(null); setSession(item); }}><b>{new Date(item.completedAt ?? item.createdAt).toLocaleString()}</b><span>{item.state === "cancelled" ? (lang === "pt" ? "Cancelada pelo operador" : "Cancelled by operator") : (lang === "pt" ? "Resultado inconclusivo" : "Inconclusive result")}</span><small>{item.progress?.tier ?? item.planId.slice(0, 8)} {item.progress?.tier ? (lang === "pt" ? "câmeras na última tentativa" : "cameras in the last attempt") : ""}</small></button>)}</section>}
      {history.length > 0 && <section className="calibration-history"><div><span>{lang === "pt" ? "HISTÓRICO" : "HISTORY"}</span><h3>{lang === "pt" ? "Calibrações anteriores" : "Previous calibrations"}</h3></div>{history.map((run) => <button type="button" key={run.id} className={result?.id === run.id ? "active" : ""} onClick={() => { setSession(null); setResult(run); }}><b>{new Date(run.completedAt).toLocaleString()}</b><span>{run.fingerprint.cpuModel} · {run.fingerprint.gpuModel}</span><small>{run.overallSafeCameraCapacity === null ? (lang === "pt" ? "capacidade não validada" : "capacity not validated") : `${Math.floor(run.overallSafeCameraCapacity)} ${lang === "pt" ? "câmeras" : "cameras"}`} · {lang === "pt" ? (run.qualityGate?.eligibleForCapacityExtrapolation ? "evidência aprovada" : "resultado diagnóstico") : (run.qualityGate?.eligibleForCapacityExtrapolation ? "approved evidence" : "diagnostic result")}</small></button>)}</section>}
      <p className="catalog-privacy">{lang === "pt" ? "Use a capacidade segura indicada no relatório. O maior valor aprovado é apenas evidência técnica e não inclui a margem operacional." : "Use the safe capacity shown in the report. The highest passing value is technical evidence and does not include operational headroom."}</p>
    </section>
  </div>;
}

function CalibrationEntryCard({ lang, enabled, onOpen }: { lang: Language; enabled: boolean; onOpen: () => void }): ReactElement {
  return <section className="calibration-entry-card"><div><span>QUAL HARDWARE / AÇÃO OPCIONAL</span><h2>{lang === "pt" ? "Calibração de capacidade" : "Capacity calibration"}</h2><p>{lang === "pt" ? "O dimensionamento funciona sem calibração. Use esta área depois para medir este computador, consultar históricos ou importar resultados de outras máquinas." : "Sizing works without calibration. Use this area later to measure this computer, review history, or import results from other machines."}</p></div><div><button type="button" className="secondary" onClick={onOpen}>{enabled ? (lang === "pt" ? "Calibrar este computador" : "Calibrate this computer") : (lang === "pt" ? "Histórico e importação" : "History and import")}</button><small>{enabled ? (lang === "pt" ? "Teste opcional rápido ou completo" : "Optional quick or complete test") : (lang === "pt" ? "Não é necessário calibrar para dimensionar" : "Calibration is not required for sizing")}</small></div></section>;
}

function EnvironmentVerification({
  environment,
  lang,
  busy,
  error,
  onRefresh,
  onLocate,
  onQwenSelection,
  qwenProbe,
  onTestQwen,
  onCancelQwenProbe,
  onContinue,
}: {
  environment: ExecutionEnvironment | null;
  lang: Language;
  busy: boolean;
  error: string;
  onRefresh: () => void;
  onLocate: (componentId: string) => void;
  onQwenSelection: (selection: QwenSelectionRequest) => void;
  qwenProbe: QwenModelProbeResult | null;
  onTestQwen: (candidateId: string) => void;
  onCancelQwenProbe: (probeId: string) => void;
  onContinue: () => void;
}): ReactElement {
  if (!environment) {
    return <div className="environment-screen"><section className="environment-panel environment-loading" role="status">
      <div className="environment-spinner" />
      <span>QUAL HARDWARE / INÍCIO</span>
      <h1>{lang === "pt" ? "Verificação do ambiente" : "Environment verification"}</h1>
      <p>{error || (lang === "pt"
        ? "Identificando o sistema, as GPUs, os programas e os modelos disponíveis. Esta etapa normalmente leva menos de 15 segundos."
        : "Detecting the system, GPUs, programs, and available models. This normally takes less than 15 seconds.")}</p>
      {error && <button type="button" className="primary" disabled={busy} onClick={onRefresh}>{lang === "pt" ? "Tentar novamente" : "Try again"}</button>}
    </section></div>;
  }
  const groups: Array<{ title: string; ids: ExecutionEnvironment["components"][number]["id"][] }> = [
    {
      title: lang === "pt" ? "Requisitos internos da aplicação" : "Built-in application requirements",
      ids: ["application", "native-benchmark"],
    },
    {
      title: lang === "pt" ? "Componentes locais para vídeo e IA" : "Local video and AI components",
      ids: [
        "ffmpeg", "ffprobe", "rtsp-simulator", "llama-server",
        "qwen-vl-2b", "qwen-vl-2b-mmproj", "qwen-vl-4b", "qwen-vl-4b-mmproj",
      ],
    },
    {
      title: lang === "pt" ? "Drivers e telemetria opcional" : "Drivers and optional telemetry",
      ids: ["gpu-driver", "telemetry"],
    },
  ];
  const stateCopy = environment.readiness === "ready_full"
    ? (lang === "pt" ? "Pronto para teste completo" : "Ready for complete testing")
    : environment.readiness === "ready_diagnostic"
      ? (lang === "pt" ? "Pronto para diagnóstico e dimensionamento" : "Ready for diagnostics and sizing")
      : (lang === "pt" ? "Plataforma não suportada" : "Unsupported platform");
  const statusCopy: Record<ExecutionEnvironment["components"][number]["status"], string> = lang === "pt" ? {
    installed: "Instalado", missing: "Ausente", incompatible: "Incompatível",
    not_applicable: "Não aplicável", restart_required: "Aguardando reinicialização",
  } : {
    installed: "Installed", missing: "Missing", incompatible: "Incompatible",
    not_applicable: "Not applicable", restart_required: "Restart required",
  };
  const originCopy: Record<ExecutionEnvironment["components"][number]["origin"], string> = lang === "pt" ? {
    perceptrum: "instalação local conhecida",
    system_path: "programa do sistema",
    known_installation: "instalação localizada",
    os_native: "integrado ao sistema",
    built_in_proxy: "incluído no aplicativo",
    missing: "não localizado",
  } : {
    perceptrum: "known local installation",
    system_path: "system program",
    known_installation: "detected installation",
    os_native: "operating system",
    built_in_proxy: "included with the application",
    missing: "not found",
  };
  const selfTestCopy: Record<ExecutionEnvironment["components"][number]["selfTest"], string> = lang === "pt" ? {
    passed: "Aprovado",
    failed: "Falhou",
    not_run: "Não executado",
    not_applicable: "Não aplicável",
  } : {
    passed: "Passed",
    failed: "Failed",
    not_run: "Not run",
    not_applicable: "Not applicable",
  };
  const openOfficial = async (linkId: string): Promise<void> => {
    await api(`/api/calibrations/environment/open-link/${encodeURIComponent(linkId)}`, { method: "POST" });
  };
  const copyInstructions = async (name: string, instruction: string): Promise<void> => {
    await navigator.clipboard.writeText(`${name}\n${instruction}`);
  };
  const qwenSelection = environment.qwenModelSelection;
  const candidateById = new Map(qwenSelection?.candidates.map((candidate) => [candidate.id, candidate]) ?? []);
  const fitCopy = lang === "pt" ? {
    gpu_memory: "cabe na VRAM",
    shared_memory: "cabe na memória unificada",
    system_memory: "cabe na RAM",
    insufficient_memory: "memória insuficiente",
    compute_limited: "CPU abaixo do limite seguro",
    missing_projector: "mmproj correspondente ausente",
  } : {
    gpu_memory: "fits GPU memory",
    shared_memory: "fits unified memory",
    system_memory: "fits system memory",
    insufficient_memory: "insufficient memory",
    compute_limited: "CPU below safe limit",
    missing_projector: "matching mmproj missing",
  };
  const qwenWarningCopy: Record<string, string> = lang === "pt" ? {
    qwen3_vl_models_not_found: "Nenhum par Qwen3-VL foi encontrado.",
    qwen3_vl_models_incompatible_with_detected_hardware: "Os pares encontrados não cabem com segurança nesta máquina.",
    qwen3_vl_functional_probe_required: "Os pares encontrados só serão liberados depois do ensaio visual real.",
    manual_qwen_selection_restored_to_automatic: "A escolha salva não está mais disponível; o modo automático foi restaurado.",
    same_qwen_model_selected_for_core_and_core_max: "O mesmo modelo atenderá Core e Core Max até outro par compatível ser instalado.",
  } : {
    qwen3_vl_models_not_found: "No Qwen3-VL pair was found.",
    qwen3_vl_models_incompatible_with_detected_hardware: "The discovered pairs do not safely fit this computer.",
    qwen3_vl_functional_probe_required: "Discovered pairs are unlocked only after the real visual probe.",
    manual_qwen_selection_restored_to_automatic: "The saved choice is no longer available; automatic mode was restored.",
    same_qwen_model_selected_for_core_and_core_max: "The same model will serve Core and Core Max until another compatible pair is installed.",
  };
  const certificationCopy = lang === "pt" ? {
    not_tested: "Não testado",
    testing: "Testando",
    validated_locally: "Validado localmente · somente planejamento",
    approved_revision: "Revisão aprovada",
    incompatible: "Incompatível",
    outdated: "Ensaio desatualizado",
  } : {
    not_tested: "Not tested",
    testing: "Testing",
    validated_locally: "Locally validated · planning only",
    approved_revision: "Approved revision",
    incompatible: "Incompatible",
    outdated: "Outdated probe",
  };
  const candidateLabel = (candidate: NonNullable<typeof qwenSelection>["candidates"][number]): string => {
    const duplicateName = (qwenSelection?.candidates.filter((item) =>
      item.modelFileName === candidate.modelFileName).length ?? 0) > 1;
    const pathParts = candidate.modelPath.split(/[\\/]/).filter(Boolean);
    const knownLocation = pathParts.find((part) => /^(perceptrum|drakon)$/i.test(part));
    const location = knownLocation ?? pathParts.at(-2) ?? "";
    return `${candidate.modelFileName} + ${candidate.projectorFileName ?? "mmproj ausente"} · ${candidate.parameterBillions}B ${candidate.quantization} · ` +
      `${byteLabel(candidate.estimatedMemoryBytes)} · ${fitCopy[candidate.fit]}` +
      ` · ${certificationCopy[candidate.certificationState]}` +
      (duplicateName && location ? ` · ${location}` : "");
  };
  const slotSelection = (
    slot: "core" | "core-max",
    selectedId: string | null,
    recommendedId: string | null,
  ): ReactElement => {
    const recommended = recommendedId ? candidateById.get(recommendedId) ?? null : null;
    const value = qwenSelection?.mode === "manual" ? selectedId ?? "" : "__automatic__";
    return <label className="qwen-model-field">
      <span>{slot === "core" ? "AiQ Core" : "AiQ Core Max"}</span>
      <select value={value} disabled={busy || !qwenSelection?.candidates.some((candidate) => candidate.compatible)}
        onChange={(event) => {
          if (event.target.value === "__automatic__") {
            onQwenSelection({ mode: "automatic" });
            return;
          }
          const coreModelId = slot === "core" ? event.target.value : qwenSelection?.selectedCoreModelId ?? null;
          const coreMaxModelId = slot === "core-max" ? event.target.value : qwenSelection?.selectedCoreMaxModelId ?? null;
          onQwenSelection({ mode: "manual", coreModelId, coreMaxModelId });
        }}>
        <option value="__automatic__">{lang === "pt" ? "Automático" : "Automatic"}{recommended
          ? ` — ${recommended.modelFileName}` : ""}</option>
        {qwenSelection?.candidates.map((candidate) =>
          <option key={`${slot}:${candidate.id}`} value={candidate.id} disabled={!candidate.compatible}>
            {candidateLabel(candidate)}
          </option>)}
      </select>
    </label>;
  };
  return <div className="environment-screen"><section className="environment-panel" aria-labelledby="environment-title">
    <header className="environment-heading">
      <div><span>QUAL HARDWARE / INÍCIO</span><h1 id="environment-title">{lang === "pt" ? "Verificação do ambiente" : "Environment verification"}</h1>
        <p>{lang === "pt"
          ? "O aplicativo não instala nem baixa programas. Ele usa componentes compatíveis encontrados neste computador e recorre ao benchmark interno quando necessário."
          : "The application never downloads or installs software. It uses compatible local components and falls back to its built-in benchmark when required."}</p></div>
      <div className={`environment-readiness ${environment.readiness}`}><b>{stateCopy}</b><small>{environment.platform} · {environment.architecture}</small></div>
    </header>
    {error && <div className="environment-error" role="alert">{error}</div>}
    {qwenSelection && <section className="qwen-model-selection" aria-labelledby="qwen-model-selection-title">
      <div className="qwen-model-selection-heading">
        <div><h2 id="qwen-model-selection-title">{lang === "pt" ? "Modelos Qwen3-VL para esta máquina" : "Qwen3-VL models for this computer"}</h2>
          <p>{lang === "pt"
            ? "O mesmo GGUF funciona em Windows, macOS e Ubuntu. O Qual Hardware considera RAM, VRAM e CPU, escolhe automaticamente e permite uma substituição manual segura."
            : "The same GGUF works on Windows, macOS, and Ubuntu. Qual Hardware considers RAM, GPU memory, and CPU, selects automatically, and allows a safe manual override."}</p></div>
        <div className="qwen-memory-budget"><span>{lang === "pt" ? "Orçamento seguro" : "Safe budget"}</span>
          <b>{byteLabel(qwenSelection.effectiveMemoryBudgetBytes)}</b>
          <small>{qwenSelection.acceleratorMemoryBudgetBytes === null
            ? (lang === "pt" ? "RAM/memória unificada" : "RAM/unified memory")
            : (lang === "pt" ? "menor limite entre RAM e VRAM" : "lower RAM/GPU-memory limit")}</small></div>
      </div>
      <div className="qwen-model-fields">
        {slotSelection("core", qwenSelection.selectedCoreModelId, qwenSelection.recommendedCoreModelId)}
        {slotSelection("core-max", qwenSelection.selectedCoreMaxModelId, qwenSelection.recommendedCoreMaxModelId)}
      </div>
      <div className="qwen-model-summary"><span>{qwenSelection.candidates.length} {lang === "pt" ? "modelo(s) localizado(s)" : "model(s) found"}</span>
        <span>{qwenSelection.candidates.filter((candidate) => candidate.compatible).length} {lang === "pt" ? "validado(s)" : "validated"}</span>
        <span>{qwenSelection.mode === "automatic" ? (lang === "pt" ? "seleção automática" : "automatic selection") : (lang === "pt" ? "seleção manual" : "manual selection")}</span></div>
      <div className="qwen-candidate-tests">
        {qwenSelection.candidates.map((candidate) => {
          const activeForCandidate = qwenProbe?.candidateId === candidate.id &&
            ["queued", "running"].includes(qwenProbe.status);
          return <article key={`probe:${candidate.id}`} className={candidate.certificationState}>
            <div><b>{candidate.modelFileName}</b><span>{candidate.projectorFileName ?? "mmproj ausente"}</span>
              <small>{certificationCopy[candidate.certificationState]} · {fitCopy[candidate.fit]}</small></div>
            {activeForCandidate
              ? <button type="button" className="secondary" onClick={() => onCancelQwenProbe(qwenProbe.id)}>
                  {lang === "pt" ? "Cancelar ensaio" : "Cancel probe"}
                </button>
              : <button type="button" className="secondary"
                  disabled={busy || !candidate.estimatedCompatible || !candidate.projectorPath || candidate.compatible}
                  onClick={() => onTestQwen(candidate.id)}>
                  {candidate.compatible
                    ? (lang === "pt" ? "Aprovado" : "Passed")
                    : (lang === "pt" ? "Testar modelo" : "Test model")}
                </button>}
          </article>;
        })}
      </div>
      {qwenProbe && <div className={`qwen-probe-progress ${qwenProbe.status}`} role="status">
        <b>{qwenProbe.status === "passed" ? (lang === "pt" ? "Ensaio aprovado" : "Probe passed")
          : qwenProbe.status === "failed" ? (lang === "pt" ? "Ensaio reprovado" : "Probe failed")
            : qwenProbe.status === "cancelled" ? (lang === "pt" ? "Ensaio cancelado" : "Probe cancelled")
              : (lang === "pt" ? "Ensaio em andamento" : "Probe running")}</b>
        <span>{visibleText(qwenProbe.message)}</span>
      </div>}
      {qwenSelection.warnings.length > 0 && <div className="qwen-model-warnings">{qwenSelection.warnings.map((warning) =>
        <span key={warning}>{qwenWarningCopy[warning] ?? warning}</span>)}</div>}
    </section>}
    {environment.rtspSimulatorProbe && <section className="qwen-model-selection" aria-labelledby="rtsp-simulator-title">
      <div className="qwen-model-selection-heading">
        <div><h2 id="rtsp-simulator-title">{lang === "pt" ? "Recepção RTSP real" : "Real RTSP reception"}</h2>
          <p>{lang === "pt"
            ? "O teste usa sessões TCP autenticadas do simulador Hikvision local. O tráfego em 127.0.0.1 mede recepção, decodificação, RAM e I/O, mas não mede a placa ou o cabo de rede."
            : "The test uses authenticated TCP sessions from the local Hikvision simulator. Loopback traffic measures reception, decoding, memory, and I/O, but not the physical network adapter or cable."}</p></div>
        <div className="qwen-memory-budget"><span>{lang === "pt" ? "Preflight funcional" : "Functional preflight"}</span>
          <b>{environment.rtspSimulatorProbe.status === "passed"
            ? (lang === "pt" ? "Aprovado" : "Passed")
            : environment.rtspSimulatorProbe.status === "not_running"
              ? (lang === "pt" ? "Simulador parado" : "Simulator stopped")
              : (lang === "pt" ? "Não aprovado" : "Not approved")}</b>
          <small>{environment.rtspSimulatorProbe.endpoints.length} {lang === "pt" ? "porta(s) validada(s)" : "validated port(s)"}</small></div>
      </div>
      <div className="qwen-model-summary">
        {environment.rtspSimulatorProbe.endpoints.map((endpoint) =>
          <span key={endpoint.redactedOrigin}>{endpoint.redactedOrigin} · {endpoint.codec.toUpperCase()} · {endpoint.width}×{endpoint.height} · {endpoint.fps.toFixed(1)} fps · {endpoint.payloadMbps.toFixed(2)} Mbps</span>)}
        {environment.rtspSimulatorProbe.endpoints.length === 0 &&
          <span>{lang === "pt"
            ? "Inicie o Simulador de RTSP e depois clique em Verificar novamente."
            : "Start the RTSP Simulator, then click Check again."}</span>}
      </div>
    </section>}
    {groups.map((group) => <section className="environment-group" key={group.title}><h2>{group.title}</h2>
      <div className="environment-components">{environment.components.filter((item) => group.ids.includes(item.id)).map((item) =>
        <article className={`environment-component ${item.status}`} key={item.id}>
          <div className="environment-component-title"><div><b>{visibleText(item.name)}</b><span>{visibleText(item.purpose)}</span></div><em>{statusCopy[item.status]}</em></div>
          <dl>
            <div><dt>{lang === "pt" ? "Origem" : "Source"}</dt><dd>{originCopy[item.origin]}</dd></div>
            <div><dt>{lang === "pt" ? "Versão" : "Version"}</dt><dd>{item.version
              ? /perceptrum/i.test(item.version)
                ? (lang === "pt" ? "Detectado e aprovado pelo autoteste local" : "Detected and approved by the local self-test")
                : visibleText(item.version)
              : "—"}</dd></div>
            <div><dt>{lang === "pt" ? "Autoteste" : "Self-test"}</dt><dd>{selfTestCopy[item.selfTest]}</dd></div>
            {item.path && !/perceptrum/i.test(item.path) && <div><dt>{lang === "pt" ? "Caminho" : "Path"}</dt><dd title={item.path}>{item.path}</dd></div>}
          </dl>
          <p>{visibleText(item.impact)}</p><small>{item.status === "installed" && item.selfTest === "passed"
            ? (lang === "pt" ? "Nenhuma ação necessária." : "No action required.")
            : visibleText(item.instruction)}</small>
          <div className="environment-actions">
            {item.downloadLinkId && <button type="button" className="secondary" onClick={() => void openOfficial(item.downloadLinkId!)}>{lang === "pt" ? "Abrir site oficial" : "Open official site"}</button>}
            {["ffmpeg", "ffprobe", "rtsp-simulator", "llama-server", "qwen-vl-2b", "qwen-vl-2b-mmproj", "qwen-vl-4b", "qwen-vl-4b-mmproj"].includes(item.id) &&
              <button type="button" className="secondary" disabled={busy} onClick={() => onLocate(item.id)}>{lang === "pt" ? "Localizar no computador" : "Locate on computer"}</button>}
            <button type="button" className="secondary" onClick={() => void copyInstructions(item.name, item.instruction)}>{lang === "pt" ? "Copiar instruções" : "Copy instructions"}</button>
          </div>
        </article>)}</div>
    </section>)}
    {environment.warnings.filter((warning) => !/perceptrum/i.test(warning)).length > 0 && <div className="environment-warnings"><b>{lang === "pt" ? "Importante" : "Important"}</b>{environment.warnings.filter((warning) => !/perceptrum/i.test(warning)).map((warning) => <span key={warning}>{warning}</span>)}</div>}
    <footer className="environment-footer"><button type="button" className="secondary" disabled={busy} onClick={onRefresh}>{busy ? (lang === "pt" ? "Verificando…" : "Checking…") : (lang === "pt" ? "Verificar novamente" : "Check again")}</button>
      <button type="button" className="primary" disabled={!environment.supported || busy} onClick={onContinue}>{environment.readiness === "ready_full"
        ? (lang === "pt" ? "Abrir o Qual Hardware" : "Open Qual Hardware")
        : (lang === "pt" ? "Continuar em modo diagnóstico" : "Continue in diagnostic mode")}</button></footer>
  </section></div>;
}

export function App(): ReactElement {
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem("qual-hardware-language") as Language | null) ?? "pt");
  const [environment, setEnvironment] = useState<ExecutionEnvironment | null>(null);
  const [environmentAccepted, setEnvironmentAccepted] = useState(false);
  const [environmentBusy, setEnvironmentBusy] = useState(true);
  const [environmentError, setEnvironmentError] = useState("");
  const [qwenProbe, setQwenProbe] = useState<QwenModelProbeResult | null>(null);
  const [qwenProbeStarting, setQwenProbeStarting] = useState(false);
  const automaticQwenAttempts = useRef(new Set<string>());
  const [step, setStep] = useState<Step>("project"); const [scenario, setScenario] = useState<CapacityScenario>(createInitialScenario);
  const [cameraCountConfirmed, setCameraCountConfirmed] = useState(false);
  const [record, setRecord] = useState<ScenarioRecord | null>(null); const [recommendations, setRecommendations] = useState<CapacityRecommendation[]>([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [hardwareCatalog, setHardwareCatalog] = useState<HardwareNodeTemplate[]>([]);
  const [catalogManagerOpen, setCatalogManagerOpen] = useState(false);
  const [calibrationRecommendation, setCalibrationRecommendation] = useState<CapacityRecommendation | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const stepIndex = steps.indexOf(step); const groupTotal = useMemo(() => scenario.cameraGroups.reduce((sum, group) => sum + group.count, 0), [scenario.cameraGroups]);
  const testQwenCandidate = async (candidateId: string): Promise<void> => {
    setEnvironmentError("");
    setQwenProbeStarting(true);
    try {
      let probe = await api<QwenModelProbeResult>("/api/calibrations/environment/qwen-probes", {
        method: "POST",
        body: JSON.stringify({ candidateId }),
      });
      setQwenProbe(probe);
      while (["queued", "running"].includes(probe.status)) {
        await new Promise((resolveWait) => window.setTimeout(resolveWait, 750));
        probe = await api<QwenModelProbeResult>(
          `/api/calibrations/environment/qwen-probes/${encodeURIComponent(probe.id)}`,
        );
        setQwenProbe(probe);
      }
      await new Promise((resolveWait) => window.setTimeout(resolveWait, 300));
      setEnvironment(await api<ExecutionEnvironment>("/api/calibrations/environment/refresh", { method: "POST" }));
    } catch (error) {
      setEnvironmentError(error instanceof Error ? error.message : "qwen_model_probe_failed");
    } finally {
      setQwenProbeStarting(false);
    }
  };
  const cancelQwenProbe = async (probeId: string): Promise<void> => {
    try {
      setQwenProbe(await api<QwenModelProbeResult>(
        `/api/calibrations/environment/qwen-probes/${encodeURIComponent(probeId)}/cancel`,
        { method: "POST" },
      ));
    } catch (error) {
      setEnvironmentError(error instanceof Error ? error.message : "qwen_model_probe_cancel_failed");
    }
  };
  useEffect(() => {
    void api<CatalogStatus>("/api/catalog/status").then(setCatalogStatus).catch(() => setCatalogStatus(null));
    void api<HardwareNodeTemplate[]>("/api/catalog/hardware").then(setHardwareCatalog).catch(() => setHardwareCatalog([]));
    void executionEnvironmentWithRetry()
      .then(async (value) => {
        const saved = savedQwenSelection();
        if (!saved || !value.qwenModelSelection ||
            (value.qwenModelSelection.mode === "manual" &&
             value.qwenModelSelection.selectedCoreModelId === saved.coreModelId &&
             value.qwenModelSelection.selectedCoreMaxModelId === saved.coreMaxModelId)) return value;
        try {
          return await api<ExecutionEnvironment>("/api/calibrations/environment/qwen-selection", {
            method: "POST",
            body: JSON.stringify(saved),
          });
        } catch {
          localStorage.removeItem(QWEN_SELECTION_STORAGE_KEY);
          return value;
        }
      })
      .then((value) => { setEnvironment(value); setEnvironmentError(""); })
      .catch((error: unknown) => setEnvironmentError(error instanceof Error ? error.message : "environment_scan_failed"))
      .finally(() => setEnvironmentBusy(false));
  }, []);
  useEffect(() => {
    if (!environment?.qwenModelSelection || qwenProbeStarting ||
        qwenProbe && ["queued", "running"].includes(qwenProbe.status)) return;
    const recommendedIds = [...new Set([
      environment.qwenModelSelection.recommendedCoreModelId,
      environment.qwenModelSelection.recommendedCoreMaxModelId,
    ].filter((id): id is string => Boolean(id)))];
    const nextId = recommendedIds.find((id) => {
      const candidate = environment.qwenModelSelection!.candidates.find((item) => item.id === id);
      return candidate?.estimatedCompatible && !candidate.compatible &&
        ["not_tested", "outdated"].includes(candidate.certificationState) &&
        !automaticQwenAttempts.current.has(id);
    });
    if (!nextId) return;
    automaticQwenAttempts.current.add(nextId);
    void testQwenCandidate(nextId);
  }, [environment, qwenProbe, qwenProbeStarting]);
  const refreshEnvironment = async (): Promise<void> => {
    setEnvironmentBusy(true); setEnvironmentError("");
    try { setEnvironment(await api<ExecutionEnvironment>("/api/calibrations/environment/refresh", { method: "POST" })); }
    catch (error) { setEnvironmentError(error instanceof Error ? error.message : "environment_scan_failed"); }
    finally { setEnvironmentBusy(false); }
  };
  const locateEnvironmentComponent = async (componentId: string): Promise<void> => {
    setEnvironmentBusy(true); setEnvironmentError("");
    try {
      const next = await api<ExecutionEnvironment>(`/api/calibrations/environment/locate/${encodeURIComponent(componentId)}`, { method: "POST" });
      setEnvironment(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "component_location_failed";
      if (message !== "selection_cancelled") setEnvironmentError(message);
    } finally { setEnvironmentBusy(false); }
  };
  const updateQwenSelection = async (selection: QwenSelectionRequest): Promise<void> => {
    setEnvironmentBusy(true); setEnvironmentError("");
    try {
      const next = await api<ExecutionEnvironment>("/api/calibrations/environment/qwen-selection", {
        method: "POST",
        body: JSON.stringify(selection),
      });
      setEnvironment(next);
      if (selection.mode === "manual") localStorage.setItem(QWEN_SELECTION_STORAGE_KEY, JSON.stringify(selection));
      else localStorage.removeItem(QWEN_SELECTION_STORAGE_KEY);
    } catch (error) {
      setEnvironmentError(error instanceof Error ? error.message : "qwen_model_selection_failed");
    } finally { setEnvironmentBusy(false); }
  };
  if (!environmentAccepted) return <EnvironmentVerification environment={environment} lang={lang}
    busy={environmentBusy || qwenProbeStarting || Boolean(qwenProbe && ["queued", "running"].includes(qwenProbe.status))}
    error={environmentError} onRefresh={() => void refreshEnvironment()} onLocate={(id) => void locateEnvironmentComponent(id)}
    onQwenSelection={(selection) => void updateQwenSelection(selection)}
    qwenProbe={qwenProbe}
    onTestQwen={(candidateId) => void testQwenCandidate(candidateId)}
    onCancelQwenProbe={(probeId) => void cancelQwenProbe(probeId)}
    onContinue={() => setEnvironmentAccepted(true)} />;
  const save = async (): Promise<ScenarioRecord> => {
    if (groupTotal !== scenario.totalCameras) throw new Error(lang === "pt" ? "O total dos grupos precisa ser igual ao total de câmeras." : "Camera group total must match total cameras.");
    const next = record ? await api<ScenarioRecord>(`/api/scenarios/${record.id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: record.revision, scenario }) }) : await api<ScenarioRecord>("/api/scenarios", { method: "POST", body: JSON.stringify({ scenario }) });
    setRecord(next); return next;
  };
  const calculate = async (): Promise<void> => { setBusy(true); setMessage(""); try { const saved = await save(); const result = await api<CapacityRecommendation[]>(`/api/scenarios/${saved.id}/recommendations`, { method: "POST" }); setRecommendations(result); setStep("result"); } catch (error) { setMessage(error instanceof Error ? error.message : "Error"); } finally { setBusy(false); } };
  const downloadReport = async (recommendation: CapacityRecommendation, format: ExportFormat): Promise<void> => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/recommendations/${recommendation.id}/export/${format}`);
      const blob = await checkedReportBlob(response, format);
      saveBlob(REPORT_DOWNLOAD_FILENAMES[format], blob);
      const neutralAnnex = isNeutralAnnexFormat(format);
      setMessage(lang === "pt"
        ? neutralAnnex
          ? `Anexo técnico neutro ${format.replace("tr-", "").toUpperCase()} baixado como documento separado. Ele não é o relatório de recomendações.`
          : format === "pdf"
            ? "Relatório completo de recomendações baixado como qual-hardware-recomendacoes.pdf."
            : format === "technical-pdf" || format === "technical-docx"
              ? `Caderno técnico detalhado ${format.endsWith("pdf") ? "PDF" : "DOCX"} verificado e baixado.`
            : `${format.toUpperCase()} completo para auditoria foi verificado e baixado.`
        : neutralAnnex
          ? `Brand-neutral ${format.replace("tr-", "").toUpperCase()} annex downloaded as a separate document. It is not the recommendations report.`
          : format === "pdf"
            ? "Complete recommendations report downloaded as qual-hardware-recomendacoes.pdf."
            : format === "technical-pdf" || format === "technical-docx"
              ? `Detailed technical book ${format.endsWith("pdf") ? "PDF" : "DOCX"} verified and downloaded.`
            : `Complete ${format.toUpperCase()} audit file was verified and downloaded.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown_error";
      setMessage(lang === "pt" ? `Não foi possível gerar um ${format.toUpperCase()} válido (${detail}). Recalcule o projeto e tente novamente.` : `A valid ${format.toUpperCase()} could not be generated (${detail}). Recalculate the project and try again.`);
    } finally { setBusy(false); }
  };
  const body = step === "project" ? <ProjectStep scenario={scenario} update={setScenario} lang={lang} cameraCountConfirmed={cameraCountConfirmed} onCameraCount={(value) => { setScenario(withCameraTotal(scenario, value)); setCameraCountConfirmed(true); }} hardwareCatalog={hardwareCatalog} /> : step === "cameras" ? <CameraStep scenario={scenario} update={setScenario} lang={lang} /> : step === "agents" ? <AgentsStep scenario={scenario} update={setScenario} lang={lang} /> : step === "additional" ? <AdditionalStep scenario={scenario} update={setScenario} lang={lang} /> : step === "storage" ? <NetworkStep scenario={scenario} lang={lang} /> : <ResultsStep scenario={scenario} recommendations={recommendations} lang={lang} onCalibration={(recommendation) => { setCalibrationRecommendation(recommendation); setCalibrationOpen(true); }} onDownload={downloadReport} />;
  return <div className="app-shell"><header><a className="brand" href="https://aiquimist.ai/" target="_blank" rel="noreferrer" aria-label={lang === "pt" ? "Visitar o site da Aiquimist.ai" : "Visit the Aiquimist.ai website"} title={lang === "pt" ? "Abrir aiquimist.ai no navegador" : "Open aiquimist.ai in the browser"}><span className="brand-logo-viewport"><img src="/brand/aiquimist-logo-white.png" alt="Aiquimist.ai" /></span><span className="brand-product">QUAL HARDWARE</span></a><div className="header-meta"><span className="private-badge">● DESKTOP LOCAL</span><button onClick={() => { const next = lang === "pt" ? "en" : "pt"; setLang(next); localStorage.setItem("qual-hardware-language", next); }}>{lang === "pt" ? "EN" : "PT"}</button></div></header>
    <main><div className="intro"><div><p>HARDWARE / {String(stepIndex + 1).padStart(2, "0")}</p><h1>{text[lang].title}</h1><span>{text[lang].subtitle}</span></div><div className="camera-counter"><strong>{cameraCountConfirmed ? scenario.totalCameras : "—"}</strong><span>CAMERAS</span></div></div>
      <div className="step-progress">{lang === "pt" ? "Etapa" : "Step"} {stepIndex + 1} {lang === "pt" ? "de" : "of"} {steps.length} · {text[lang][step]}</div>
      <nav className="stepper">{steps.map((item, index) => <button key={item} className={`${item === step ? "active" : ""} ${index < stepIndex ? "done" : ""}`} onClick={() => index <= stepIndex || recommendations.length ? setStep(item) : undefined}><i>{index < stepIndex ? "✓" : index + 1}</i><span>{text[lang][item]}</span></button>)}</nav>
      {message && <div className="toast" role="alert" onClick={() => setMessage("")}>{message}<span>×</span></div>}{body}
      {step === "storage" && groupTotal !== scenario.totalCameras && <div id="camera-allocation-guidance" className="total-check error allocation-blocker" role="alert"><b>{lang === "pt" ? "A distribuição precisa ser corrigida" : "The allocation needs correction"}</b><span>{lang === "pt"
        ? `O projeto tem ${scenario.totalCameras} câmeras, mas os perfis VÍDEO FULL/FRAME somam ${groupTotal}. Volte a “Perfis de operação” e ajuste as quantidades. A calibração não é necessária para dimensionar.`
        : `The project has ${scenario.totalCameras} cameras, but FULL VIDEO/FRAME profiles total ${groupTotal}. Return to Operating profiles and adjust the counts. Calibration is not required for sizing.`}</span></div>}
      <div className="actions">{stepIndex > 0 && <button className="secondary" onClick={() => setStep(steps[stepIndex - 1]!)}>{text[lang].back}</button>}<div />{step !== "result" && step !== "storage" && <button className="primary" disabled={step === "project" && !cameraCountConfirmed} onClick={() => setStep(steps[stepIndex + 1]!)}>{text[lang].next} →</button>}{step === "storage" && <button className="primary" disabled={busy} aria-describedby={groupTotal !== scenario.totalCameras ? "camera-allocation-guidance" : undefined} onClick={calculate}>{busy ? "…" : text[lang].calculate} →</button>}{step === "result" && <button className="primary" disabled={busy} onClick={calculate}>{lang === "pt" ? "Recalcular" : "Recalculate"}</button>}</div>
      <CalibrationEntryCard lang={lang} enabled={recommendations.length > 0} onOpen={() => { setCalibrationRecommendation(recommendations[0] ?? null); setCalibrationOpen(true); }} />
    </main><footer><span>{lang === "pt" ? "Dimensionamento para VÍDEO FULL e FRAME" : "Sizing for FULL VIDEO and FRAME"}</span><div className="catalog-state"><span>{catalogStatus ? `${lang === "pt" ? "Catálogo" : "Catalog"}: ${catalogStatus.catalogVersion}${catalogStatus.stalePriceCount ? ` · ${catalogStatus.stalePriceCount} ${lang === "pt" ? "preços defasados" : "stale prices"}` : ""}` : (lang === "pt" ? "Catálogo: verificando" : "Catalog: checking")}</span><button type="button" disabled={busy} onClick={() => setCatalogManagerOpen(true)}>{lang === "pt" ? "Atualizar hardware" : "Update hardware"}</button></div><span>{lang === "pt" ? "Resultados e relatórios salvos neste computador" : "Results and reports saved on this computer"}</span></footer>{catalogManagerOpen && <CatalogManager status={catalogStatus} lang={lang} onClose={() => setCatalogManagerOpen(false)} onStatus={setCatalogStatus} onCatalogApplied={(status, detail) => { setCatalogStatus(status); void api<HardwareNodeTemplate[]>("/api/catalog/hardware").then(setHardwareCatalog); setRecommendations([]); setRecord(null); setMessage(`${detail} ${lang === "pt" ? "Recalcule os projetos existentes." : "Recalculate existing projects."}`); setCatalogManagerOpen(false); }} />}{calibrationOpen && <CalibrationCenter recommendation={calibrationRecommendation} catalogStatus={catalogStatus} hardwareCatalog={hardwareCatalog} initialHardwareTemplateId={scenario.constraints.requiredHardwareTemplateId ?? null} lang={lang} onClose={() => setCalibrationOpen(false)} onChanged={(detail) => { setMessage(detail); }} />}{busy && <div className="loading"><div /></div>}</div>;
}
