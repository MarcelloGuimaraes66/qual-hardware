import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { createDefaultAgent, createDefaultScenario } from "../shared/schemas.js";
import type {
  AgentLoad, CameraGroup, CapacityRecommendation, CapacityScenario, CatalogPublication, CatalogSource, CatalogStatus, Currency, InfrastructureKind,
  CalibrationPlan, CalibrationSession, CapacityPrediction, HardwareNodeTemplate, LocalCalibrationRun, Market, OperatingSystemFamily,
  HardwareComponent, RecommendationAlternative, RecommendationPolicy, ScenarioRecord,
} from "../shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../shared/types.js";
import { CalibrationResultPanel } from "./CalibrationResultPanel.js";

type Language = "pt" | "en";
const steps = ["project", "cameras", "agents", "additional", "storage", "result"] as const;
type Step = typeof steps[number];
type ExportFormat = "pdf" | "xlsx" | "json" | "tr-pdf" | "tr-docx" | "tr-json";
const presets = [4, 8, 16, 32, 65, 128, 256];

const text = {
  pt: {
    project: "Projeto e mercado", cameras: "Câmeras", agents: "Perfis de operação", additional: "Cargas adicionais",
    storage: "Rede e arquivos temporários", result: "Resultado", next: "Continuar", back: "Voltar", calculate: "Dimensionar infraestrutura",
    title: "Qual Hardware", subtitle: "Aplicativo desktop para dimensionar computadores e servidores do Perceptrum",
    estimated: "Estimada", validated: "Validada", quote: "Cotação necessária", save: "Salvar projeto",
  },
  en: {
    project: "Project & market", cameras: "Cameras", agents: "Operating profiles", additional: "Additional loads",
    storage: "Network & temporary files", result: "Results", next: "Continue", back: "Back", calculate: "Size infrastructure",
    title: "Qual Hardware", subtitle: "Desktop application for sizing Perceptrum computers and servers",
    estimated: "Estimated", validated: "Validated", quote: "Quote required", save: "Save project",
  },
} as const;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options?.headers } });
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return body;
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function normalizedCameraCount(value: number): number {
  return Math.min(4096, Math.max(1, Math.trunc(Number.isFinite(value) ? value : 1)));
}

function withCameraTotal(scenario: CapacityScenario, value: number): CapacityScenario {
  const totalCameras = normalizedCameraCount(value);
  const [first, ...remaining] = scenario.cameraGroups;
  if (!first) return { ...scenario, totalCameras, cameraGroups: [newGroup(totalCameras)] };
  const remainingTotal = remaining.reduce((sum, group) => sum + group.count, 0);
  const cameraGroups = totalCameras > remainingTotal
    ? [{ ...first, count: totalCameras - remainingTotal }, ...remaining]
    : [{ ...first, count: totalCameras }];
  return { ...scenario, totalCameras, cameraGroups };
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
    name: `Camera profile ${cameraGroups.length + 1}`,
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
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    json: "application/json",
    "tr-pdf": "application/pdf",
    "tr-docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "tr-json": "application/json",
  };
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expectedContentType[format])) throw new Error(`invalid_${format}_content_type`);
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if ((format === "pdf" || format === "tr-pdf") && String.fromCharCode(...signature) !== "%PDF-") throw new Error("invalid_pdf_file");
  if ((format === "xlsx" || format === "tr-docx") && !(signature[0] === 0x50 && signature[1] === 0x4b)) throw new Error(`invalid_${format}_file`);
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
      <Field label={lang === "pt" ? "Quantidade total de câmeras *" : "Total number of cameras *"} hint={lang === "pt" ? "Obrigatório. O usuário define qualquer quantidade de 1 a 4096; não existe total pré-definido." : "Required. The user defines any quantity from 1 to 4096; there is no preset total."}><input autoFocus aria-label={lang === "pt" ? "Quantidade total de câmeras" : "Total number of cameras"} type="number" min="1" max="4096" placeholder={lang === "pt" ? "Informe o total" : "Enter the total"} value={cameraCountConfirmed ? scenario.totalCameras : ""} onChange={(e) => { if (e.target.value) onCameraCount(Number(e.target.value)); }} /></Field>
      <Field label={lang === "pt" ? "Mercado" : "Market"}><select value={scenario.market} onChange={(e) => {
        const market = e.target.value as Market; const currency: Currency = market === "BR" ? "BRL" : market === "US" ? "USD" : "EUR"; update({ ...scenario, market, currency });
      }}><option value="BR">Brasil</option><option value="US">United States</option><option value="DE">Deutschland / EU</option></select></Field>
      <Field label={lang === "pt" ? "Moeda" : "Currency"}><select value={scenario.currency} onChange={(e) => update({ ...scenario, currency: e.target.value as Currency })}><option>BRL</option><option>USD</option><option>EUR</option></select></Field>
      <Field label={lang === "pt" ? "Formato" : "Form factor"}><select value={scenario.constraints.infrastructureKind} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, infrastructureKind: e.target.value as InfrastructureKind, requiredHardwareTemplateId: null } })}><option value="either">{lang === "pt" ? "Melhor opção (inclui opções econômicas)" : "Best fit (includes lower-cost computers)"}</option><option value="laptop">Notebook / laptop</option><option value="mini_pc">Mini PC / Mac mini</option><option value="workstation">Workstation</option><option value="rack">Rack server</option></select></Field>
      <Field label={lang === "pt" ? "Sistema operacional alvo" : "Target operating system"} hint={lang === "pt" ? "Apple/macOS é opt-in porque exige um build correspondente do Perceptrum." : "Apple/macOS is opt-in because it requires a matching Perceptrum build."}><select value={scenario.constraints.operatingSystem ?? "auto"} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, operatingSystem: e.target.value as "auto" | OperatingSystemFamily, requiredHardwareTemplateId: null } })}><option value="auto">{lang === "pt" ? "Automático — Windows/Ubuntu" : "Automatic — Windows/Ubuntu"}</option><option value="windows">Windows</option><option value="ubuntu">Ubuntu Linux</option><option value="macos">macOS / Apple Silicon</option></select></Field>
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
      <Field label="Perceptrum build hash" hint={lang === "pt" ? "O selo de validação é vinculado a este build." : "Validation is bound to this build."}><input value={scenario.perceptrumBuildHash} onChange={(e) => update({ ...scenario, perceptrumBuildHash: e.target.value })} /></Field>
      <div className="field toggles"><span>{lang === "pt" ? "Requisitos" : "Requirements"}</span><Toggle checked={scenario.constraints.requireEcc} onChange={(requireEcc) => update({ ...scenario, constraints: { ...scenario.constraints, requireEcc } })} label="ECC" /></div>
    </div>{scenario.constraints.operatingSystem === "macos" && <div className="info-box">{lang === "pt" ? "Apple Silicon usa o Perceptrum macOS e o AiQ/Qwen local. Memória unificada e decode RTSP por CPU são dimensionados conservadoramente até existir calibração física comparável." : "Apple Silicon uses Perceptrum macOS and local AiQ/Qwen. Unified memory and CPU RTSP decode are sized conservatively until comparable physical calibration exists."}</div>}
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
    <div className="camera-total-box"><Field label={lang === "pt" ? "Total de câmeras monitoradas" : "Total monitored cameras"} hint={lang === "pt" ? "Este é o número usado no cálculo. Os botões abaixo são apenas atalhos." : "This is the number used for sizing. The buttons below are shortcuts only."}><input aria-label={lang === "pt" ? "Total de câmeras monitoradas" : "Total monitored cameras"} type="number" min="1" max="4096" value={scenario.totalCameras} onChange={(e) => update(withCameraTotal(scenario, Number(e.target.value)))} /></Field>
      <div className="preset-row"><span>{lang === "pt" ? "Atalhos" : "Shortcuts"}</span>{presets.map((preset) => <button key={preset} type="button" className={scenario.totalCameras === preset ? "active" : ""} onClick={() => update(withCameraTotal(scenario, preset))}>{preset}</button>)}<label className="import-button">↑ {lang === "pt" ? "Importar CSV/JSON" : "Import CSV/JSON"}<input hidden type="file" accept=".csv,.json" onChange={importFile} /></label></div>
    </div>
    <div className={`total-check ${groupTotal === scenario.totalCameras ? "ok" : "error"}`}>{groupTotal} / {scenario.totalCameras} {lang === "pt" ? "câmeras distribuídas" : "cameras allocated"}</div>
    <div className="group-list">{scenario.cameraGroups.map((group, index) => <article className="group-card" key={group.id}>
      <div className="group-title"><b>{lang === "pt" ? "Grupo" : "Group"} {index + 1}</b>{scenario.cameraGroups.length > 1 && <button className="icon-button" onClick={() => update(removeCameraGroup(scenario, group.id))}>×</button>}</div>
      <div className="compact-grid">
        <Field label={lang === "pt" ? "Nome" : "Name"}><input value={group.name} onChange={(e) => changeGroup(group.id, { name: e.target.value })} /></Field>
        <Field label={lang === "pt" ? "Quantidade" : "Count"}><input type="number" min="1" value={group.count} onChange={(e) => changeGroup(group.id, { count: Number(e.target.value) })} /></Field>
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
  const changeGroupCount = (groupId: string, count: number): void => update({ ...scenario, cameraGroups: scenario.cameraGroups.map((group) => group.id === groupId ? { ...group, count: normalizedCameraCount(count) } : group) });
  const assignedCameras = scenario.cameraGroups.reduce((sum, group) => sum + group.count, 0);
  return <section className="panel step-panel"><div className="section-heading"><p>03</p><div><h2>{lang === "pt" ? "Tipo de leitura e perfis de Agents" : "Reading type and Agent profiles"}</h2><span>{lang === "pt" ? "Informe como cada grupo será lido. Uma câmera pode executar múltiplas análises." : "Describe how each group will be read. A camera can run multiple analyses."}</span></div></div>
    <div className="agent-load-guide"><b>{lang === "pt" ? "Esta etapa define o peso real" : "This step defines the real load"}</b><span>{lang === "pt" ? "VÍDEO FULL considera a janela de vídeo, 1–5 FPS de inferência, preparação dos frames e inferência. FRAME considera uma imagem por execução. RTSP continua sendo decodificado continuamente nos dois casos." : "FULL VIDEO includes the video window, 1–5 inference FPS, frame preparation, and inference. FRAME uses one image per run. RTSP is still decoded continuously in both cases."}</span></div>
    <div className={`total-check ${assignedCameras === scenario.totalCameras ? "ok" : "error"}`}>{assignedCameras} / {scenario.totalCameras} {lang === "pt" ? "câmeras distribuídas entre os perfis" : "cameras allocated among profiles"}</div>
    {scenario.cameraGroups.map((group) => <div className="agent-group" key={group.id}><div className="profile-camera-count"><h3>{group.name}</h3><Field label={lang === "pt" ? "Quantas câmeras usarão este perfil?" : "How many cameras will use this profile?"}><input type="number" min="1" max="4096" value={group.count} onChange={(e) => changeGroupCount(group.id, Number(e.target.value))} /></Field></div>{group.agents.map((agent, index) => {
      const change = (patch: Partial<AgentLoad>): void => changeGroupAgents(group.id, group.agents.map((item) => item.id === agent.id ? { ...item, ...patch } : item));
      const aiq = agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max";
      const portalCounter = agent.model === "opencv-portal-counter";
      const adjustableFps = agent.model !== "gpt-5-mini" && !portalCounter && !aiq;
      return <article className="agent-card" key={agent.id}><div className="group-title"><div><b>Agent {index + 1}</b><span className="reading-badge">{readingTypeLabel(agent, lang)}</span></div>{group.agents.length > 1 && <button className="icon-button" onClick={() => changeGroupAgents(group.id, group.agents.filter((item) => item.id !== agent.id))}>×</button>}</div>
        <div className="compact-grid"><Field label={lang === "pt" ? "Nome" : "Name"}><input value={agent.name} onChange={(e) => change({ name: e.target.value })} /></Field>
          <Field label={lang === "pt" ? "Modelo de inferência (Agents)" : "Inference model (Agents)"}><select value={agent.model} onChange={(e) => change({ model: e.target.value as AgentLoad["model"] })}><option value="gpt-5.4">GPT-5.4 / Ultra Plus</option><option value="gpt-5">GPT-5 / Ultra</option><option value="gpt-5.4-mini">GPT-5.4 mini / Light</option><option value="gpt-5-mini">GPT-5 mini / Legacy</option><option value="aiq-3.7">AiQ-3.7 / Core local</option><option value="aiq-3.7-max">AiQ-3.7-Max / Core Max local</option><option value="opencv-portal-counter">Portal Counter OpenCV</option></select></Field>
          <Field label={lang === "pt" ? "Tipo de leitura da câmera (Agents)" : "Camera reading type (Agents)"} hint={lang === "pt" ? "VÍDEO FULL usa uma sequência; FRAME usa uma imagem." : "FULL VIDEO uses a sequence; FRAME uses one image."}><select value={agent.inputType} onChange={(e) => change({ inputType: e.target.value as "video" | "image" })} disabled={portalCounter}><option value="video">{lang === "pt" ? "VÍDEO FULL — sequência de frames" : "FULL VIDEO — frame sequence"}</option><option value="image">{lang === "pt" ? "FRAME — uma imagem por execução" : "FRAME — one image per run"}</option></select></Field>
          {agent.inputType === "video" && <Field label={lang === "pt" ? "Qualidade do vídeo (Agents)" : "Video quality (Agents)"}><select value={agent.packaging} onChange={(e) => change({ packaging: e.target.value as AgentLoad["packaging"] })} disabled={portalCounter}><option value="frame_sequence">{lang === "pt" ? "Alta resolução — sequência de frames" : "High resolution — frame sequence"}</option><option value="mosaic_2x2">{lang === "pt" ? "Resolução padrão — mosaico 2×2" : "Standard resolution — 2×2 mosaic"}</option></select></Field>}
          {agent.inputType === "video" && adjustableFps && <Field label={lang === "pt" ? "FPS efetivos enviados ao AiQ" : "Effective FPS sent to AiQ"} hint={lang === "pt" ? "Quadros extraídos para a inferência local. O Perceptrum executa de 1 a 5 FPS; valores antigos maiores que 5 são limitados a 5." : "Frames extracted for local inference. Perceptrum executes 1–5 FPS; legacy values above 5 are capped at 5."}><select value={Math.min(5, agent.modelFps)} onChange={(e) => change({ modelFps: Number(e.target.value) })}>{[1,2,3,4,5].map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}</select></Field>}
          <Field label={lang === "pt" ? "Janela / executar a cada (Agents)" : "Window / run every (Agents)"}><select value={agent.runEverySeconds <= 10 ? 10 : 60} onChange={(e) => change({ runEverySeconds: Number(e.target.value) as AgentLoad["runEverySeconds"] })} disabled={aiq || portalCounter}><option value="10">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 10 s / inferir a cada 10 s" : "10 s window / infer every 10 s") : (lang === "pt" ? "1 frame a cada 10 s" : "1 frame every 10 s")}</option><option value="60">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 60 s / inferir a cada 60 s" : "60 s window / infer every 60 s") : (lang === "pt" ? "1 frame a cada 60 s" : "1 frame every 60 s")}</option></select></Field>
        </div>
        {aiq && <div className="normalization">{lang === "pt" ? "Regra efetiva verificada no código atual: AiQ/Qwen Core recebe 1 FPS de inferência e executa em ciclos de 60 segundos. O RTSP continua sendo recebido e decodificado no FPS configurado da câmera." : "Effective rule verified in the current code: AiQ/Qwen Core receives 1 inference FPS and runs in 60-second cycles. RTSP is still received and decoded at the camera FPS."}</div>}
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

const policyLabels: Record<RecommendationPolicy, { pt: string; en: string }> = { minimum: { pt: "Mínimo técnico", en: "Technical minimum" }, recommended: { pt: "Recomendado", en: "Recommended" }, n_plus_one: { pt: "N+1 resiliente", en: "Resilient N+1" } };

function confidenceText(prediction: CapacityPrediction | undefined, lang: Language): string {
  if (!prediction) return lang === "pt" ? "Somente referência" : "Reference only";
  const labels = {
    validated_local: { pt: "Validado localmente", en: "Locally validated" },
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
      : (lang === "pt" ? "COMPRA BLOQUEADA" : "PURCHASE BLOCKED");
  return <div className="design-detail"><div className={`procurement-banner ${design.procurementEligibility}`}><b>{eligibilityLabel}</b><span>{eligible ? (lang === "pt" ? "Todos os estágios críticos possuem evidência comparável e margem conservadora." : "Every critical stage has comparable evidence and conservative reserve.") : (lang === "pt" ? "Esta configuração não possui prova completa para todos os estágios. Use-a somente para planejar testes; não compre com base neste resultado." : "This configuration lacks complete evidence across every stage. Use it only to plan tests; do not purchase from this result.")}</span></div><div className="spec-hero"><div><span>{lang === "pt" ? "Nós" : "Nodes"}</span><strong>{design.nodeCount}</strong><small>{design.activeNodeCount} {lang === "pt" ? "ativos" : "active"}</small></div><div><span>{lang === "pt" ? "Folga" : "Headroom"}</span><strong>{design.headroomPercent}%</strong><small>target</small></div><div><span>{eligible ? (lang === "pt" ? "Capacidade segura" : "Safe capacity") : (lang === "pt" ? "Capacidade comprovada" : "Proven capacity")}</span><strong>{eligible ? estimatedCapacity : "—"}</strong><small>{eligible ? (lang === "pt" ? `câmeras neste perfil (+${design.maximumAdditionalCameras})` : `cameras in this profile (+${design.maximumAdditionalCameras})`) : (lang === "pt" ? "indisponível até completar evidências" : "unavailable until evidence is complete")}</small></div></div>
    <div className="hardware-title"><div><span>{design.hardware.kind} · {hardwareOperatingSystem(design.hardware)} · {design.hardware.generation}</span><h3>{design.hardware.name}</h3></div><div className="price-summary"><b>{design.price.median === null ? text[lang].quote : money(design.price.median, design.price.currency)}</b><small>{design.price.basis === "reference_estimate" ? (lang === "pt" ? "estimativa do projeto · cotação de compra necessária" : "project estimate · purchase quote required") : design.price.basis === "market_quotes" ? (lang === "pt" ? "preço de mercado do projeto" : "market project price") : text[lang].quote}</small></div></div>
    <div className="spec-grid"><div><span>CPU</span><b>{design.hardware.cpuModel}</b><small>{design.hardware.physicalCores} cores · {Math.round((design.hardware.sustainedComputeFactor ?? 1) * 100)}% {lang === "pt" ? "fator sustentado" : "sustained factor"}</small></div><div><span>RAM</span><b>{design.hardware.ramGb} GB {design.hardware.ecc ? "ECC" : ""}</b><small>{design.hardware.memoryArchitecture === "unified" ? (lang === "pt" ? "unificada CPU/GPU" : "unified CPU/GPU") : (lang === "pt" ? "por nó" : "per node")}</small></div><div><span>GPU</span><b>{design.hardware.gpuCount}× {design.hardware.gpuModel}</b><small>{gpuMemoryLabel(design.hardware, lang)}</small></div><div><span>{lang === "pt" ? "NVMe operacional" : "Operational NVMe"}</span><b>{design.hardware.storageModel}</b><small>{lang === "pt" ? "clipes + leitura + retenção dimensionam nós" : "clips + reads + retention constrain nodes"}</small></div><div><span>Network</span><b>{design.hardware.nicGbps} GbE</b><small>{design.hardware.chassis}</small></div><div><span>{lang === "pt" ? "Gargalo" : "Bottleneck"}</span><b>{design.bottleneck}</b><small>{design.hardware.windowsEdition}</small></div></div>
    <div className={`calibration-evidence ${design.calibration?.status ?? "reference_only"}`}><div><span>{lang === "pt" ? "Evidência" : "Evidence"}</span><b>{confidenceText(design.calibration, lang)}</b></div><div><span>{lang === "pt" ? "Confiança" : "Confidence"}</span><b>{design.calibration?.confidenceClass ?? "—"}</b></div><div><span>{lang === "pt" ? "Faixa segura" : "Safe range"}</span><b>{eligible ? `${design.calibration?.safeCameraMinimum ?? "—"}–${design.calibration?.safeCameraMaximum ?? "—"}` : "—"} {lang === "pt" ? "câmeras" : "cameras"}</b></div><div><span>{lang === "pt" ? "Margem" : "Reserve"}</span><b>{design.calibration?.reservePercent ?? 40}%</b></div><small>{design.calibration?.reasons.join(" ") ?? (lang === "pt" ? "Importe calibrações físicas e a base pública assinada para habilitar extrapolação." : "Import physical calibrations and the signed public evidence catalog to enable extrapolation.")}</small></div>
    {design.bom && <><h4>{lang === "pt" ? "BOM auditável e cobertura" : "Auditable BOM and coverage"}</h4><div className="evidence-summary"><div><span>{lang === "pt" ? "Componentes" : "Components"}</span><b>{design.bom.items.length}</b><small>{design.bom.kind}</small></div><div><span>{lang === "pt" ? "Estágios cobertos" : "Covered stages"}</span><b>{design.bom.coverage.coveredStageCount}/{design.bom.coverage.requiredStageCount}</b><small>{design.bom.coverage.percent}%</small></div><div><span>{lang === "pt" ? "Âncoras físicas" : "Physical anchors"}</span><b>{design.bom.coverage.physicalAnchorCount}/3</b><small>{design.bom.procurementGate.status}</small></div></div><details className="bom-audit"><summary>{lang === "pt" ? "Ver componentes, benchmarks e bloqueios" : "View components, benchmarks and gates"}</summary><div className="bom-component-list">{design.bom.items.map((item) => <div key={`${item.role}:${item.componentId}`}><b>{item.role}</b><span>{item.quantity}× {item.componentId}</span><small>{item.kind}</small></div>)}</div><div className="stage-coverage-list">{design.bom.coverage.stages.map((stage) => <div className={stage.covered ? "covered" : "blocked"} key={stage.stage}><b>{stage.stage}</b><span>{stage.covered ? (lang === "pt" ? "coberto" : "covered") : (lang === "pt" ? "bloqueado" : "blocked")}</span><small>{stage.eligibleObservationIds.length} benchmarks · {stage.physicalAnchorRunIds.length} {lang === "pt" ? "âncoras" : "anchors"}{stage.reasons.length ? ` · ${stage.reasons.join(" ")}` : ""}</small></div>)}</div></details></>}
    {design.procurementNeutralSpecification && <><h4>{lang === "pt" ? "Especificação técnica não comercial" : "Brand-neutral technical specification"}</h4><div className={`neutral-specification ${design.procurementNeutralSpecification.status}`}><div className="neutral-status"><b>{design.procurementNeutralSpecification.status === "apt" ? (lang === "pt" ? "APTA PARA REVISÃO DO TR" : "READY FOR TR REVIEW") : design.procurementNeutralSpecification.status === "review_required" ? (lang === "pt" ? "REVISÃO OBRIGATÓRIA" : "REVIEW REQUIRED") : (lang === "pt" ? "NÃO UTILIZAR PARA AQUISIÇÃO" : "DO NOT USE FOR PROCUREMENT")}</b><span>{lang === "pt" ? `Concorrência: ${design.procurementNeutralSpecification.marketCompetitionAssessment.status} · ${design.procurementNeutralSpecification.marketCompetitionAssessment.matchingProductCount} produtos · ${design.procurementNeutralSpecification.marketCompetitionAssessment.distinctManufacturerCount} fabricantes` : `Competition: ${design.procurementNeutralSpecification.marketCompetitionAssessment.status} · ${design.procurementNeutralSpecification.marketCompetitionAssessment.matchingProductCount} products · ${design.procurementNeutralSpecification.marketCompetitionAssessment.distinctManufacturerCount} manufacturers`}</span></div><details><summary>{lang === "pt" ? `Ver ${design.procurementNeutralSpecification.requirements.length} requisitos funcionais` : `View ${design.procurementNeutralSpecification.requirements.length} functional requirements`}</summary><div className="neutral-requirements">{design.procurementNeutralSpecification.requirements.map((item) => <article key={item.id}><div><b>{item.componentRole}</b><span>{item.characteristic}</span></div><strong>{item.comparator} {String(item.value)} {item.unit ?? ""}</strong><small>{item.rationale}</small><small>{lang === "pt" ? "Aceite" : "Acceptance"}: {item.acceptanceCriterion}</small></article>)}</div></details>{design.procurementNeutralSpecification.disclaimers.map((item) => <small key={item}>{item}</small>)}</div></>}
    {(design.price.componentEstimates?.length ?? 0) > 0 && <><h4>{lang === "pt" ? "Custo estimado por componente" : "Estimated component cost"}</h4><div className="cost-list">{design.price.componentEstimates.map((component) => <div key={component.componentId}><span>{component.component}</span><small>{lang === "pt" ? "por nó" : "per node"}: {money(component.perNodeAmount, design.price.currency)}</small><b>{money(component.projectAmount, design.price.currency)}</b></div>)}<div className="cost-total"><span>{lang === "pt" ? `TOTAL · ${design.nodeCount} nó(s)` : `TOTAL · ${design.nodeCount} node(s)`}</span><small>{lang === "pt" ? "estimativa do projeto" : "project estimate"}</small><b>{money(design.price.median, design.price.currency)}</b></div></div></>}
    <h4>{lang === "pt" ? "Distribuição e utilização" : "Distribution & utilization"}</h4><div className="node-list">{design.allocations.map((node) => <div className="node-row" key={node.nodeIndex}><div><b>Node {node.nodeIndex}</b><span>{node.role}</span></div><div className="node-cameras">{node.cameraGroups.map((group) => `${group.groupName}: ${group.cameras}`).join(" · ") || "Standby"}</div><div className="meters"><span>CPU {percent(node.utilization.cpuCores)}</span><span>RAM {percent(node.utilization.ramGb)}</span><span>VRAM {percent(node.utilization.gpuVramGb)}</span><span>NVDEC {percent(node.utilization.gpuDecode1080p30Streams)}</span><span>LAN {percent(node.utilization.lanGbps)}</span></div></div>)}</div>
    <div className="sources">{design.hardware.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">↗ {source.title}</a>)}</div>{design.warnings.length > 0 && <div className="warning-list">{design.warnings.map((warning) => <span key={warning}>{warning.replaceAll("_", " ")}</span>)}</div>}
  </div>;
}

function ResultsStep({ scenario, recommendations, lang, onCalibration, onDownload }: { scenario: CapacityScenario; recommendations: CapacityRecommendation[]; lang: Language; onCalibration: (recommendation: CapacityRecommendation) => void; onDownload: (recommendation: CapacityRecommendation, format: ExportFormat) => Promise<void> }): ReactElement {
  const [selectedPolicy, setSelectedPolicy] = useState<RecommendationPolicy>("recommended"); const [variant, setVariant] = useState(0);
  const rec = recommendations.find((item) => item.policy === selectedPolicy) ?? recommendations[0];
  if (!rec) return <section className="panel empty-result"><h2>{lang === "pt" ? "Pronto para calcular" : "Ready to calculate"}</h2><p>{lang === "pt" ? "Revise o cenário e selecione Dimensionar infraestrutura." : "Review the scenario and select Size infrastructure."}</p></section>;
  const designs = [rec.primary, ...rec.alternatives]; const design = designs[Math.min(variant, designs.length - 1)]!;
  return <section className="panel result-panel"><div className="result-heading"><div><span className={`confidence ${rec.confidence}`}>{confidenceText(rec.primary.calibration, lang)}</span><h2>{lang === "pt" ? "Projeto de infraestrutura" : "Infrastructure design"}</h2><p>{lang === "pt" ? "As opções não testadas são extrapoladas por estágio e nunca aparecem como fisicamente validadas." : "Untested options are extrapolated per stage and never shown as physically validated."}</p></div><button className="secondary" onClick={() => onCalibration(rec)}>Calibração de capacidade</button></div>
    <div className="policy-tabs">{recommendations.map((item) => <button key={item.policy} className={selectedPolicy === item.policy ? "active" : ""} onClick={() => { setSelectedPolicy(item.policy); setVariant(0); }}><span>{policyLabels[item.policy][lang]}</span><b>{item.primary.nodeCount} nodes</b></button>)}</div>
    <div className="variant-tabs">{designs.map((item, index) => <button key={item.id} className={variant === index ? "active" : ""} onClick={() => setVariant(index)}>{index + 1}. {item.hardware.name} · {item.procurementEligibility === "eligible" ? (lang === "pt" ? "apta" : "eligible") : (lang === "pt" ? "referência" : "reference")}</button>)}</div>
    <div className="workload-summary"><h4>{lang === "pt" ? "Carga usada neste cálculo" : "Workload used for this calculation"}</h4>{scenario.cameraGroups.map((group) => <div className="workload-group" key={group.id}><b>{group.count}× {group.name}</b><span>{group.source.codec.toUpperCase()} · {group.source.width}×{group.source.height} · {group.source.sourceFps} FPS RTSP · {group.source.bitrateMbps} Mbps · decode {group.decodeMode.toUpperCase()}</span>{group.agents.map((agent) => <small key={agent.id}>{readingTypeLabel(agent, lang)} · {agent.model} · {agent.inputType === "video" ? `${agent.modelFps} FPS · ` : ""}{agent.runEverySeconds <= 10 ? 10 : 60} s</small>)}</div>)}</div>
    <DesignDetail design={design} lang={lang} scenarioCameras={scenario.totalCameras} /><div className="export-row"><span>{lang === "pt" ? "Relatório comercial + neutro" : "Commercial + neutral report"}</span>{(["pdf", "xlsx", "json"] as const).map((format) => <button key={format} type="button" className="secondary small" onClick={() => onDownload(rec, format)}>{format.toUpperCase()}</button>)}<span>{lang === "pt" ? "Anexo neutro para revisão do TR" : "Neutral annex for TR review"}</span>{(["tr-docx", "tr-pdf", "tr-json"] as const).map((format) => <button key={format} type="button" className="secondary small" onClick={() => onDownload(rec, format)}>{format.replace("tr-", "").toUpperCase()}</button>)}</div>
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
      <details className="catalog-recovery"><summary>{lang === "pt" ? `Inventário por componente (${components.length})` : `Component inventory (${components.length})`}</summary><p>{lang === "pt" ? "Itens descobertos não viram recomendação até terem especificação, compatibilidade, benchmark do estágio e calibrações físicas suficientes." : "Discovered items are not recommended until specifications, compatibility, stage evidence and enough physical calibrations exist."}</p><div className="component-kind-summary">{[...new Set(components.map((item) => item.kind))].sort().map((kind) => <span key={kind}><b>{components.filter((item) => item.kind === kind).length}</b> {kind}</span>)}</div><div className="catalog-hardware-list component-list">{components.slice(0, 250).map((item) => <article key={item.id}><div><b>{item.manufacturer} {item.sku}</b><span>{item.kind} · {item.inventoryState ?? "discovered_inventory"}</span></div><small>{item.architecture} · {item.marketState ?? "reference_only"} · {item.technicalSpecification?.completeness.percent ?? 0}% {lang === "pt" ? "de especificação oficial" : "official specification coverage"}</small>{item.technicalSpecification && <details className="component-spec-details"><summary>{lang === "pt" ? "Ver especificações e lacunas" : "View specifications and gaps"}</summary>{item.technicalSpecification.fields.filter((field) => field.status === "published").map((field) => <span key={field.code}><b>{field.labelPt}</b>: {String(field.value)} {field.unit ?? ""}</span>)}{item.technicalSpecification.completeness.missingRequiredFieldCodes.length > 0 && <small>{lang === "pt" ? "Campos oficiais ausentes" : "Missing official fields"}: {item.technicalSpecification.completeness.missingRequiredFieldCodes.join(", ")}</small>}</details>}</article>)}</div></details>
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
  const [targetHardwareTemplateId, setTargetHardwareTemplateId] = useState(initialHardwareTemplateId ?? "");
  const [advancedTelemetry, setAdvancedTelemetry] = useState(false);
  const [session, setSession] = useState<CalibrationSession | null>(null);
  const [result, setResult] = useState<LocalCalibrationRun | null>(null);
  const [history, setHistory] = useState<LocalCalibrationRun[]>([]);
  const [directory, setDirectory] = useState("");
  const refreshStatus = (): void => {
    void api<CalibrationStatusSummary>("/api/calibrations/status").then(setStatus).catch(() => setStatus(null));
    void api<LocalCalibrationRun[]>("/api/calibrations").then((runs) => { setHistory(runs); if (!result && runs[0]) setResult(runs[0]); }).catch(() => setHistory([]));
    void api<{ directory: string }>("/api/calibration-sessions/directory").then((value) => setDirectory(value.directory)).catch(() => setDirectory(""));
  };
  useEffect(refreshStatus, []);
  useEffect(() => {
    if (!session || ["completed", "cancelled", "failed", "expired"].includes(session.state)) return;
    const timer = window.setInterval(() => {
      void api<CalibrationSession>(`/api/calibration-sessions/${session.id}`).then((next) => {
        setSession(next);
        if (next.result) { setResult(next.result); refreshStatus(); }
        if (next.state === "cancelled") setDetail(lang === "pt" ? "Teste interrompido. O diagnóstico parcial foi preservado em Documentos e não será usado para recomendar uma compra." : "Test stopped. Partial diagnostics were preserved in Documents and will not be used for purchasing recommendations.");
        if (next.state === "failed" || next.state === "expired") setDetail(next.error ?? next.state);
      }).catch((error: unknown) => setDetail(error instanceof Error ? error.message : "calibration_status_failed"));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.state]);

  const startCalibration = async (mode: "quick" | "full"): Promise<void> => {
    if (!recommendation) {
      setDetail(lang === "pt" ? "Dimensione primeiro um projeto para que a carga de câmeras seja enviada ao Perceptrum." : "Size a project first so its camera workload can be sent to Perceptrum.");
      return;
    }
    setWorking(true); setDetail(lang === "pt" ? "Criando uma sessão protegida e abrindo o Perceptrum…" : "Creating a protected session and opening Perceptrum…");
    try {
      const started = await api<{ session: CalibrationSession; delivery: string }>("/api/calibration-sessions", {
        method: "POST",
        body: JSON.stringify({ recommendationId: recommendation.id, mode, targetHardwareTemplateId: targetHardwareTemplateId || null, advancedTelemetry }),
      });
      setSession(started.session);
      setResult(null);
      setDetail(lang === "pt"
        ? `Perceptrum aberto. O ${mode === "quick" ? "teste rápido de 10 minutos" : "teste completo de 60 minutos"} usa RTSP, FFmpeg e AiQ/Qwen locais; o resultado será salvo e importado automaticamente.`
        : "Perceptrum opened. The local result will be saved and imported automatically.");
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_launch_failed"); }
    finally { setWorking(false); }
  };

  const createPlan = async (mode: "quick" | "full"): Promise<void> => {
    if (!recommendation) { setDetail(lang === "pt" ? "Dimensione primeiro um projeto." : "Size a project first."); return; }
    setWorking(true); setDetail("");
    try {
      const plan = await api<CalibrationPlan>("/api/calibrations/plans", {
        method: "POST",
        body: JSON.stringify({ recommendationId: recommendation.id, mode, targetHardwareTemplateId: targetHardwareTemplateId || null }),
      });
      downloadJson(`qual-hardware-${mode}-${plan.id}.qhplan.json`, plan);
      setDetail(lang === "pt"
        ? `Plano ${mode === "quick" ? "rápido de 10 minutos" : "completo de 60 minutos"} gerado. Abra-o no Perceptrum em Calibração local.`
        : `${mode} local plan generated. Open it in Perceptrum Local calibration.`);
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_plan_failed"); }
    finally { setWorking(false); }
  };

  const cancelCalibration = async (): Promise<void> => {
    if (!session || !window.confirm(lang === "pt" ? "Interromper agora? As medições parciais serão preservadas apenas para diagnóstico." : "Stop now? Partial measurements will be preserved for diagnostics only.")) return;
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

  const importCalibration = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setWorking(true); setDetail("");
    try {
      const run = JSON.parse(await file.text()) as LocalCalibrationRun;
      const imported = await api<{ run: LocalCalibrationRun; predictions: CapacityPrediction[] }>("/api/calibrations/import", {
        method: "POST",
        body: JSON.stringify(run),
      });
      setResult(imported.run); refreshStatus();
      const eligible = imported.run.qualityGate?.eligibleForCapacityExtrapolation === true;
      const message = lang === "pt"
        ? `${eligible ? "Calibração integral aprovada" : "Resultado importado somente como diagnóstico"}. ${eligible ? "Ela pode participar das extrapolações conservadoras." : "Ela não será usada para justificar uma compra."} Recalcule as máquinas sugeridas.`
        : `${eligible ? "Full calibration approved" : "Result imported as diagnostic only"}. Recalculate suggested machines.`;
      setDetail(message); onChanged(message);
    } catch (error) { setDetail(error instanceof Error ? error.message : "calibration_import_failed"); }
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="catalog-modal calibration-modal" role="dialog" aria-modal="true" aria-labelledby="calibration-title">
      <div className="modal-heading"><div><span>PERCEPTRUM / LOCAL ONLY</span><h2 id="calibration-title">{lang === "pt" ? "Calibração de capacidade" : "Capacity calibration"}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div>
      <div className="offline-banner"><b>{lang === "pt" ? "Servidor RTSP local + AiQ/Qwen local" : "Local RTSP server + local AiQ/Qwen"}</b><span>{lang === "pt" ? "Nenhuma chamada OpenAI ou API externa é permitida durante o teste." : "No OpenAI or external API call is allowed during the test."}</span></div>
      <div className="catalog-summary"><div><span>{lang === "pt" ? "Máquinas testadas" : "Tested machines"}</span><b>{status?.calibrationRuns ?? 0}</b><small>.qhcal.json</small></div><div><span>{lang === "pt" ? "Métricas públicas" : "Public metrics"}</span><b>{status?.publicObservations ?? 0}</b><small>{catalogStatus?.verificationKeyConfigured ? "ED25519" : (lang === "pt" ? "chave pendente" : "key pending")}</small></div><div><span>{lang === "pt" ? "Previsões" : "Predictions"}</span><b>{status?.predictions ?? 0}</b><small>{lang === "pt" ? "por gargalo" : "per bottleneck"}</small></div></div>
      <div className="calibration-flow"><article><b>1. {lang === "pt" ? "Calibrar este computador" : "Calibrate this computer"}</b><span>{lang === "pt" ? "Escolha o perfil exato somente se este computador realmente tiver essa configuração. Sem vínculo exato, o resultado é preservado como referência." : "Choose an exact profile only when this computer truly matches it. Otherwise the result remains reference evidence."}</span><Field label={lang === "pt" ? "Computador físico em teste" : "Physical computer under test"}><select value={targetHardwareTemplateId} onChange={(event) => setTargetHardwareTemplateId(event.target.value)}><option value="">{lang === "pt" ? "Detectar hardware — sem perfil exato" : "Detect hardware — no exact profile"}</option>{[...hardwareCatalog].sort((left, right) => left.name.localeCompare(right.name)).map((hardware) => <option key={hardware.id} value={hardware.id}>{hardware.name} · {hardware.cpuModel} · {hardware.gpuModel}</option>)}</select></Field><label className="advanced-telemetry"><input type="checkbox" checked={advancedTelemetry} onChange={(event) => setAdvancedTelemetry(event.target.checked)} /><span><b>{lang === "pt" ? "Medição avançada de CPU/GPU" : "Advanced CPU/GPU measurement"}</b><small>{lang === "pt" ? "No macOS, pode pedir autorização administrativa temporária para potência e GPU. Sem autorização, o teste continua e identifica os sensores indisponíveis." : "On macOS this may request temporary administrator authorization. The test continues transparently if declined."}</small></span></label><div className="catalog-actions"><button className="primary" disabled={working || !recommendation} onClick={() => void startCalibration("quick")}>{lang === "pt" ? "Teste rápido local — 10 minutos" : "Quick local test — 10 minutes"}</button><button className="primary" disabled={working || !recommendation} onClick={() => void startCalibration("full")}>{lang === "pt" ? "Calibração completa local — 60 minutos" : "Full local calibration — 60 minutes"}</button></div>{!recommendation && <small>{lang === "pt" ? "Dimensione um projeto para habilitar os testes com a carga real de câmeras selecionada." : "Size a project to enable tests with its selected camera workload."}</small>}</article>
        {session && <article className="calibration-live"><b>2. {lang === "pt" ? "Progresso em tempo real" : "Live progress"}</b><div className="calibration-progress"><div><i style={{ width: `${session.progress?.percent ?? 0}%` }} /></div><b>{Math.round(session.progress?.percent ?? 0)}%</b></div><span>{session.progress?.message ?? detail}</span><small>{session.state} · {session.mode === "full" ? "60 min" : "10 min"} · {session.advancedTelemetry ? (lang === "pt" ? "telemetria avançada" : "advanced telemetry") : (lang === "pt" ? "telemetria padrão" : "standard telemetry")}</small>{["launching", "running", "cancelling"].includes(session.state) && <div className="catalog-actions"><button type="button" className="secondary" disabled={working || session.state === "cancelling"} onClick={() => void cancelCalibration()}>{session.state === "cancelling" ? (lang === "pt" ? "Salvando diagnóstico parcial…" : "Saving partial diagnostics…") : (lang === "pt" ? "Interromper e guardar parcial" : "Stop and keep partial data")}</button></div>}</article>}
        <article><b>{session ? "3" : "2"}. {lang === "pt" ? "Recuperação e dados anteriores" : "Recovery and previous data"}</b><span>{lang === "pt" ? "O fluxo normal é automático. Use estes controles somente para um resultado vindo de outro computador ou se a abertura direta não estiver disponível." : "The normal flow is automatic. Use these controls only for another computer or when direct launch is unavailable."}</span><div className="catalog-actions"><label className={`secondary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar calibração anterior" : "Import previous calibration"}<input hidden type="file" accept=".json,.qhcal" disabled={working} onChange={importCalibration} /></label><button className="secondary" disabled={working || !recommendation} onClick={() => void createPlan("quick")}>{lang === "pt" ? "Salvar plano manual" : "Save manual plan"}</button><label className={`secondary file-action ${working ? "disabled" : ""}`}>{lang === "pt" ? "Importar base pública assinada" : "Import signed public evidence"}<input hidden type="file" accept=".json" disabled={working} onChange={importEvidence} /></label></div></article></div>
      {detail && <div className="catalog-message">{detail}</div>}
      {result && <CalibrationResultPanel result={result} directory={directory} lang={lang} onOpenDirectory={() => void openDirectory()} onRecalculate={() => void recalculate()} />}
      {history.length > 0 && <section className="calibration-history"><div><span>HISTORY</span><h3>{lang === "pt" ? "Calibrações anteriores" : "Previous calibrations"}</h3></div>{history.map((run) => <button type="button" key={run.id} className={result?.id === run.id ? "active" : ""} onClick={() => setResult(run)}><b>{new Date(run.completedAt).toLocaleString()}</b><span>{run.fingerprint.cpuModel} · {run.fingerprint.gpuModel}</span><small>{run.overallSafeCameraCapacity === null ? (lang === "pt" ? "capacidade não validada" : "capacity not validated") : `${Math.floor(run.overallSafeCameraCapacity)} ${lang === "pt" ? "câmeras" : "cameras"}`} · {run.qualityGate?.validationStatus ?? (run.qualityGate?.eligibleForCapacityExtrapolation ? "anchor_approved" : "diagnostic")}</small></button>)}</section>}
      <p className="catalog-privacy">{lang === "pt" ? "Os resultados contêm somente métricas agregadas e hashes. Mídia, RTSP, credenciais, nome do computador e dados pessoais são recusados." : "Results contain aggregate metrics and hashes only. Media, RTSP credentials, computer name and personal data are rejected."}</p>
    </section>
  </div>;
}

function CalibrationEntryCard({ lang, enabled, onOpen }: { lang: Language; enabled: boolean; onOpen: () => void }): ReactElement {
  return <section className="calibration-entry-card"><div><span>PERCEPTRUM / CPU + GPU + PIPELINE</span><h2>{lang === "pt" ? "Calibração de capacidade" : "Capacity calibration"}</h2><p>{lang === "pt" ? "Teste este computador com RTSP, FFmpeg e AiQ/Qwen locais. A tela acompanha CPU, GPU, disco, rede, FPS e todas as etapas reais do Perceptrum." : "Test this computer with local RTSP, FFmpeg and AiQ/Qwen while tracking CPU, GPU, storage, network, FPS and every real Perceptrum stage."}</p></div><div><button type="button" className="primary" onClick={onOpen}>{enabled ? (lang === "pt" ? "Calibrar este computador" : "Calibrate this computer") : (lang === "pt" ? "Ver calibrações e instruções" : "View calibrations and instructions")}</button><small>{enabled ? (lang === "pt" ? "Teste rápido 10 min ou completo 60 min" : "Quick 10 min or full 60 min") : (lang === "pt" ? "Os botões de teste serão habilitados após dimensionar um projeto." : "Test buttons are enabled after sizing a project.")}</small></div></section>;
}

export function App(): ReactElement {
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem("qual-hardware-language") as Language | null) ?? "pt");
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
  useEffect(() => {
    void api<CatalogStatus>("/api/catalog/status").then(setCatalogStatus).catch(() => setCatalogStatus(null));
    void api<HardwareNodeTemplate[]>("/api/catalog/hardware").then(setHardwareCatalog).catch(() => setHardwareCatalog([]));
  }, []);
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
      const filenames: Record<ExportFormat, string> = {
        pdf: "qual-hardware-relatorio-comercial-e-neutro.pdf",
        xlsx: "qual-hardware-relatorio-comercial-e-neutro.xlsx",
        json: "qual-hardware-relatorio-comercial-e-neutro.json",
        "tr-pdf": "qual-hardware-anexo-tecnico-neutro.pdf",
        "tr-docx": "qual-hardware-anexo-tecnico-neutro.docx",
        "tr-json": "qual-hardware-anexo-tecnico-neutro.json",
      };
      saveBlob(filenames[format], blob);
      setMessage(lang === "pt" ? `${format.toUpperCase()} com políticas e alternativas foi verificado e baixado.` : `${format.toUpperCase()} with policies and alternatives was verified and downloaded.`);
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
      {message && <div className="toast" onClick={() => setMessage("")}>{message}<span>×</span></div>}<CalibrationEntryCard lang={lang} enabled={recommendations.length > 0} onOpen={() => { setCalibrationRecommendation(recommendations[0] ?? null); setCalibrationOpen(true); }} />{body}
      <div className="actions">{stepIndex > 0 && <button className="secondary" onClick={() => setStep(steps[stepIndex - 1]!)}>{text[lang].back}</button>}<div />{step !== "result" && step !== "storage" && <button className="primary" disabled={step === "project" && !cameraCountConfirmed} onClick={() => setStep(steps[stepIndex + 1]!)}>{text[lang].next} →</button>}{step === "storage" && <button className="primary" disabled={busy || groupTotal !== scenario.totalCameras} onClick={calculate}>{busy ? "…" : text[lang].calculate} →</button>}{step === "result" && <button className="primary" disabled={busy} onClick={calculate}>{lang === "pt" ? "Recalcular" : "Recalculate"}</button>}</div>
    </main><footer><span>{WORKLOAD_CONTRACT_VERSION}</span><div className="catalog-state"><span>{catalogStatus ? `${lang === "pt" ? "Catálogo" : "Catalog"}: ${catalogStatus.catalogVersion} · ${catalogStatus.source}${catalogStatus.stalePriceCount ? ` · ${catalogStatus.stalePriceCount} ${lang === "pt" ? "preços defasados" : "stale prices"}` : ""}` : (lang === "pt" ? "Catálogo: verificando" : "Catalog: checking")}</span><button type="button" disabled={busy} onClick={() => setCatalogManagerOpen(true)}>{lang === "pt" ? "Atualizar hardware" : "Update hardware"}</button></div><span>{lang === "pt" ? "SQLite local · calibração offline · zero OpenAI" : "Local SQLite · offline calibration · zero OpenAI"}</span></footer>{catalogManagerOpen && <CatalogManager status={catalogStatus} lang={lang} onClose={() => setCatalogManagerOpen(false)} onStatus={setCatalogStatus} onCatalogApplied={(status, detail) => { setCatalogStatus(status); void api<HardwareNodeTemplate[]>("/api/catalog/hardware").then(setHardwareCatalog); setRecommendations([]); setRecord(null); setMessage(`${detail} ${lang === "pt" ? "Recalcule os projetos existentes." : "Recalculate existing projects."}`); setCatalogManagerOpen(false); }} />}{calibrationOpen && <CalibrationCenter recommendation={calibrationRecommendation} catalogStatus={catalogStatus} hardwareCatalog={hardwareCatalog} initialHardwareTemplateId={scenario.constraints.requiredHardwareTemplateId ?? null} lang={lang} onClose={() => setCalibrationOpen(false)} onChanged={(detail) => { setMessage(detail); }} />}{busy && <div className="loading"><div /></div>}</div>;
}
