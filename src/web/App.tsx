import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { createDefaultAgent, createDefaultScenario } from "../shared/schemas.js";
import type {
  AgentLoad, CameraGroup, CapacityRecommendation, CapacityScenario, CatalogStatus, Currency, InfrastructureKind,
  Market, RecommendationAlternative, RecommendationPolicy, ScenarioRecord,
} from "../shared/types.js";
import { WORKLOAD_CONTRACT_VERSION } from "../shared/types.js";

type Language = "pt" | "en";
const steps = ["project", "cameras", "agents", "additional", "storage", "result"] as const;
type Step = typeof steps[number];
type ExportFormat = "pdf" | "xlsx" | "json";
const presets = [4, 8, 16, 32, 65, 128, 256];

const text = {
  pt: {
    project: "Projeto e mercado", cameras: "Câmeras", agents: "Perfis de operação", additional: "Cargas adicionais",
    storage: "Rede e arquivos temporários", result: "Resultado", next: "Continuar", back: "Voltar", calculate: "Dimensionar infraestrutura",
    title: "Qual Hardware", subtitle: "Calculadora de infraestrutura on-premises para executar o Perceptrum",
    estimated: "Estimada", validated: "Validada", quote: "Cotação necessária", save: "Salvar projeto",
  },
  en: {
    project: "Project & market", cameras: "Cameras", agents: "Operating profiles", additional: "Additional loads",
    storage: "Network & temporary files", result: "Results", next: "Continue", back: "Back", calculate: "Size infrastructure",
    title: "Qual Hardware", subtitle: "On-premises infrastructure specification calculator for Perceptrum",
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
  };
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(expectedContentType[format])) throw new Error(`invalid_${format}_content_type`);
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (format === "pdf" && String.fromCharCode(...signature) !== "%PDF-") throw new Error("invalid_pdf_file");
  if (format === "xlsx" && !(signature[0] === 0x50 && signature[1] === 0x4b)) throw new Error("invalid_xlsx_file");
  if (format === "json") JSON.parse(await blob.text());
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

function ProjectStep({ scenario, update, lang, cameraCountConfirmed, onCameraCount }: { scenario: CapacityScenario; update: (next: CapacityScenario) => void; lang: Language; cameraCountConfirmed: boolean; onCameraCount: (value: number) => void }): ReactElement {
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
      <Field label={lang === "pt" ? "Formato" : "Form factor"}><select value={scenario.constraints.infrastructureKind} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, infrastructureKind: e.target.value as InfrastructureKind } })}><option value="either">{lang === "pt" ? "Melhor opção" : "Best fit"}</option><option value="workstation">Workstation</option><option value="rack">Rack server</option></select></Field>
      <Field label={lang === "pt" ? "Orçamento opcional" : "Optional budget"}><input type="number" min="0" placeholder={scenario.currency} value={scenario.constraints.budget ?? ""} onChange={(e) => update({ ...scenario, constraints: { ...scenario.constraints, budget: e.target.value ? Number(e.target.value) : null } })} /></Field>
      <Field label="Perceptrum build hash" hint={lang === "pt" ? "O selo de validação é vinculado a este build." : "Validation is bound to this build."}><input value={scenario.perceptrumBuildHash} onChange={(e) => update({ ...scenario, perceptrumBuildHash: e.target.value })} /></Field>
      <div className="field toggles"><span>{lang === "pt" ? "Requisitos" : "Requirements"}</span><Toggle checked={scenario.constraints.requireEcc} onChange={(requireEcc) => update({ ...scenario, constraints: { ...scenario.constraints, requireEcc } })} label="ECC" /></div>
    </div>
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
        <Field label="FPS"><input type="number" min="1" max="120" value={group.source.sourceFps} onChange={(e) => changeGroup(group.id, { source: { ...group.source, sourceFps: Number(e.target.value) } })} /></Field>
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
    <div className="agent-load-guide"><b>{lang === "pt" ? "Esta etapa define o peso real" : "This step defines the real load"}</b><span>{lang === "pt" ? "VÍDEO FULL considera a janela de vídeo, 1–10 FPS, preparação dos frames e inferência. FRAME considera uma imagem por execução. RTSP continua sendo decodificado continuamente nos dois casos." : "FULL VIDEO includes the video window, 1–10 FPS, frame preparation, and inference. FRAME uses one image per run. RTSP is still decoded continuously in both cases."}</span></div>
    <div className={`total-check ${assignedCameras === scenario.totalCameras ? "ok" : "error"}`}>{assignedCameras} / {scenario.totalCameras} {lang === "pt" ? "câmeras distribuídas entre os perfis" : "cameras allocated among profiles"}</div>
    {scenario.cameraGroups.map((group) => <div className="agent-group" key={group.id}><div className="profile-camera-count"><h3>{group.name}</h3><Field label={lang === "pt" ? "Quantas câmeras usarão este perfil?" : "How many cameras will use this profile?"}><input type="number" min="1" max="4096" value={group.count} onChange={(e) => changeGroupCount(group.id, Number(e.target.value))} /></Field></div>{group.agents.map((agent, index) => {
      const change = (patch: Partial<AgentLoad>): void => changeGroupAgents(group.id, group.agents.map((item) => item.id === agent.id ? { ...item, ...patch } : item));
      const aiq = agent.model === "aiq-3.7" || agent.model === "aiq-3.7-max";
      const portalCounter = agent.model === "opencv-portal-counter";
      const adjustableFps = agent.model !== "gpt-5-mini" && !portalCounter;
      return <article className="agent-card" key={agent.id}><div className="group-title"><div><b>Agent {index + 1}</b><span className="reading-badge">{readingTypeLabel(agent, lang)}</span></div>{group.agents.length > 1 && <button className="icon-button" onClick={() => changeGroupAgents(group.id, group.agents.filter((item) => item.id !== agent.id))}>×</button>}</div>
        <div className="compact-grid"><Field label={lang === "pt" ? "Nome" : "Name"}><input value={agent.name} onChange={(e) => change({ name: e.target.value })} /></Field>
          <Field label={lang === "pt" ? "Modelo de inferência (Agents)" : "Inference model (Agents)"}><select value={agent.model} onChange={(e) => change({ model: e.target.value as AgentLoad["model"] })}><option value="gpt-5.4">GPT-5.4 / Ultra Plus</option><option value="gpt-5">GPT-5 / Ultra</option><option value="gpt-5.4-mini">GPT-5.4 mini / Light</option><option value="gpt-5-mini">GPT-5 mini / Legacy</option><option value="aiq-3.7">AiQ-3.7 / Core local</option><option value="aiq-3.7-max">AiQ-3.7-Max / Core Max local</option><option value="opencv-portal-counter">Portal Counter OpenCV</option></select></Field>
          <Field label={lang === "pt" ? "Tipo de leitura da câmera (Agents)" : "Camera reading type (Agents)"} hint={lang === "pt" ? "VÍDEO FULL usa uma sequência; FRAME usa uma imagem." : "FULL VIDEO uses a sequence; FRAME uses one image."}><select value={agent.inputType} onChange={(e) => change({ inputType: e.target.value as "video" | "image" })} disabled={portalCounter}><option value="video">{lang === "pt" ? "VÍDEO FULL — sequência de frames" : "FULL VIDEO — frame sequence"}</option><option value="image">{lang === "pt" ? "FRAME — uma imagem por execução" : "FRAME — one image per run"}</option></select></Field>
          {agent.inputType === "video" && <Field label={lang === "pt" ? "Qualidade do vídeo (Agents)" : "Video quality (Agents)"}><select value={agent.packaging} onChange={(e) => change({ packaging: e.target.value as AgentLoad["packaging"] })} disabled={portalCounter}><option value="frame_sequence">{lang === "pt" ? "Alta resolução — sequência de frames" : "High resolution — frame sequence"}</option><option value="mosaic_2x2">{lang === "pt" ? "Resolução padrão — mosaico 2×2" : "Standard resolution — 2×2 mosaic"}</option></select></Field>}
          {agent.inputType === "video" && adjustableFps && <Field label={lang === "pt" ? "FPS enviados à inferência (Agents)" : "FPS sent to inference (Agents)"} hint={lang === "pt" ? "De 1 a 10 FPS, como na janela Agents." : "From 1 to 10 FPS, matching the Agents window."}><select value={agent.modelFps} onChange={(e) => change({ modelFps: Number(e.target.value) })}>{[1,2,3,4,5,6,7,8,9,10].map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}</select></Field>}
          <Field label={lang === "pt" ? "Janela / executar a cada (Agents)" : "Window / run every (Agents)"}><select value={agent.runEverySeconds <= 10 ? 10 : 60} onChange={(e) => change({ runEverySeconds: Number(e.target.value) as AgentLoad["runEverySeconds"] })} disabled={aiq || portalCounter}><option value="10">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 10 s / inferir a cada 10 s" : "10 s window / infer every 10 s") : (lang === "pt" ? "1 frame a cada 10 s" : "1 frame every 10 s")}</option><option value="60">{agent.inputType === "video" ? (lang === "pt" ? "Janela de 60 s / inferir a cada 60 s" : "60 s window / infer every 60 s") : (lang === "pt" ? "1 frame a cada 60 s" : "1 frame every 60 s")}</option></select></Field>
        </div>
        {aiq && <div className="normalization">{lang === "pt" ? "Regra efetiva do backend: AiQ executa a cada 10 segundos. O cálculo usa essa regra, mesmo se uma configuração antiga trouxer outro valor." : "Effective backend rule: AiQ runs every 10 seconds. Sizing uses this rule even if a legacy configuration contains another value."}</div>}
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
  return <section className="panel step-panel"><div className="section-heading"><p>05</p><div><h2>{text[lang].storage}</h2><span>{lang === "pt" ? "Rede RTSP e espaço operacional, sem retenção de longo prazo." : "RTSP network and operational workspace, without long-term retention."}</span></div></div>
    <div className="temporary-grid"><article className="temporary-card"><span>{lang === "pt" ? "Entrada RTSP estimada" : "Estimated RTSP ingress"}</span><strong>{Math.ceil(rtspMbps)} Mbps</strong><small>{lang === "pt" ? "Inclui 20% de margem de protocolo." : "Includes 20% protocol allowance."}</small></article><article className="temporary-card"><span>{lang === "pt" ? "Arquivos de inferência" : "Inference files"}</span><strong>{lang === "pt" ? "Temporários" : "Temporary"}</strong><small>{lang === "pt" ? "Normalmente removidos em até um dia." : "Normally removed within one day."}</small></article><article className="temporary-card"><span>{lang === "pt" ? "Arquivos de alerta" : "Alert files"}</span><strong>{lang === "pt" ? "Eventuais" : "Event-driven"}</strong><small>{lang === "pt" ? "Gerados somente quando há alerta." : "Created only when an alert occurs."}</small></article></div>
    <div className="info-box">{lang === "pt" ? "Armazenamento não altera a quantidade nem o modelo dos nós. O Qual Hardware inclui apenas um NVMe operacional para o sistema e arquivos temporários. A exclusão de alertas continua sendo definida no cadastro da câmera no Perceptrum." : "Storage does not change node count or model. Qual Hardware includes only an operational NVMe for the operating system and temporary files. Alert deletion remains configured when the camera is registered in Perceptrum."}</div></section>;
}

const policyLabels: Record<RecommendationPolicy, { pt: string; en: string }> = { minimum: { pt: "Mínimo técnico", en: "Technical minimum" }, recommended: { pt: "Recomendado", en: "Recommended" }, n_plus_one: { pt: "N+1 resiliente", en: "Resilient N+1" } };

function DesignDetail({ design, lang }: { design: RecommendationAlternative; lang: Language }): ReactElement {
  return <div className="design-detail"><div className="spec-hero"><div><span>{lang === "pt" ? "Nós" : "Nodes"}</span><strong>{design.nodeCount}</strong><small>{design.activeNodeCount} {lang === "pt" ? "ativos" : "active"}</small></div><div><span>{lang === "pt" ? "Folga" : "Headroom"}</span><strong>{design.headroomPercent}%</strong><small>target</small></div><div><span>{lang === "pt" ? "Expansão" : "Expansion"}</span><strong>+{design.maximumAdditionalCameras}</strong><small>cameras</small></div></div>
    <div className="hardware-title"><div><span>{design.hardware.kind} · {design.hardware.generation}</span><h3>{design.hardware.name}</h3></div><b>{design.price.quotationRequired ? text[lang].quote : money(design.price.median, design.price.currency)}</b></div>
    <div className="spec-grid"><div><span>CPU</span><b>{design.hardware.cpuModel}</b><small>{design.hardware.physicalCores} cores/node</small></div><div><span>RAM</span><b>{design.hardware.ramGb} GB {design.hardware.ecc ? "ECC" : ""}</b><small>per node</small></div><div><span>GPU</span><b>{design.hardware.gpuCount}× {design.hardware.gpuModel}</b><small>{design.hardware.gpuVramGbTotal} GB VRAM/node</small></div><div><span>{lang === "pt" ? "NVMe operacional" : "Operational NVMe"}</span><b>{design.hardware.storageModel}</b><small>{lang === "pt" ? "SO + temporários; não dimensiona nós" : "OS + temporary files; not a sizing constraint"}</small></div><div><span>Network</span><b>{design.hardware.nicGbps} GbE</b><small>{design.hardware.chassis}</small></div><div><span>{lang === "pt" ? "Gargalo" : "Bottleneck"}</span><b>{design.bottleneck}</b><small>{design.hardware.windowsEdition}</small></div></div>
    <h4>{lang === "pt" ? "Distribuição e utilização" : "Distribution & utilization"}</h4><div className="node-list">{design.allocations.map((node) => <div className="node-row" key={node.nodeIndex}><div><b>Node {node.nodeIndex}</b><span>{node.role}</span></div><div className="node-cameras">{node.cameraGroups.map((group) => `${group.groupName}: ${group.cameras}`).join(" · ") || "Standby"}</div><div className="meters"><span>CPU {percent(node.utilization.cpuCores)}</span><span>RAM {percent(node.utilization.ramGb)}</span><span>VRAM {percent(node.utilization.gpuVramGb)}</span><span>NVDEC {percent(node.utilization.gpuDecode1080p30Streams)}</span><span>LAN {percent(node.utilization.lanGbps)}</span></div></div>)}</div>
    <div className="sources">{design.hardware.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">↗ {source.title}</a>)}</div>{design.warnings.length > 0 && <div className="warning-list">{design.warnings.map((warning) => <span key={warning}>{warning.replaceAll("_", " ")}</span>)}</div>}
  </div>;
}

function ResultsStep({ scenario, recommendations, lang, onManifest, onDownload }: { scenario: CapacityScenario; recommendations: CapacityRecommendation[]; lang: Language; onManifest: (recommendation: CapacityRecommendation) => Promise<void>; onDownload: (recommendation: CapacityRecommendation, format: ExportFormat) => Promise<void> }): ReactElement {
  const [selectedPolicy, setSelectedPolicy] = useState<RecommendationPolicy>("recommended"); const [variant, setVariant] = useState(0);
  const rec = recommendations.find((item) => item.policy === selectedPolicy) ?? recommendations[0];
  if (!rec) return <section className="panel empty-result"><h2>{lang === "pt" ? "Pronto para calcular" : "Ready to calculate"}</h2><p>{lang === "pt" ? "Revise o cenário e selecione Dimensionar infraestrutura." : "Review the scenario and select Size infrastructure."}</p></section>;
  const designs = [rec.primary, ...rec.alternatives]; const design = designs[Math.min(variant, designs.length - 1)]!;
  return <section className="panel result-panel"><div className="result-heading"><div><span className={`confidence ${rec.confidence}`}>{rec.confidence === "validated" ? text[lang].validated : text[lang].estimated}</span><h2>{lang === "pt" ? "Projeto de infraestrutura" : "Infrastructure design"}</h2><p>{rec.confidence === "estimated" ? (lang === "pt" ? "Interpolado pelo modelo; execute o benchmark para validar." : "Model-estimated; run the benchmark to validate.") : (lang === "pt" ? "Benchmark compatível aprovado." : "Matching benchmark passed.")}</p></div><button className="secondary" onClick={() => onManifest(rec)}>↓ Benchmark manifest</button></div>
    <div className="policy-tabs">{recommendations.map((item) => <button key={item.policy} className={selectedPolicy === item.policy ? "active" : ""} onClick={() => { setSelectedPolicy(item.policy); setVariant(0); }}><span>{policyLabels[item.policy][lang]}</span><b>{item.primary.nodeCount} nodes</b></button>)}</div>
    <div className="variant-tabs">{designs.map((item, index) => <button key={item.id} className={variant === index ? "active" : ""} onClick={() => setVariant(index)}>{item.variant === "balanced" ? (lang === "pt" ? "Balanceada" : "Balanced") : item.variant === "lower_capex" ? (lang === "pt" ? "Menor CAPEX" : "Lower CAPEX") : (lang === "pt" ? "Maior expansão" : "More expansion")}</button>)}</div>
    <div className="workload-summary"><h4>{lang === "pt" ? "Carga usada neste cálculo" : "Workload used for this calculation"}</h4>{scenario.cameraGroups.map((group) => <div className="workload-group" key={group.id}><b>{group.count}× {group.name}</b><span>{group.source.codec.toUpperCase()} · {group.source.width}×{group.source.height} · {group.source.sourceFps} FPS RTSP · {group.source.bitrateMbps} Mbps · decode {group.decodeMode.toUpperCase()}</span>{group.agents.map((agent) => <small key={agent.id}>{readingTypeLabel(agent, lang)} · {agent.model} · {agent.inputType === "video" ? `${agent.modelFps} FPS · ` : ""}{agent.runEverySeconds <= 10 ? 10 : 60} s</small>)}</div>)}</div>
    <DesignDetail design={design} lang={lang} /><div className="export-row"><span>{lang === "pt" ? "Exportar proposta" : "Export proposal"}</span>{(["pdf", "xlsx", "json"] as const).map((format) => <button key={format} type="button" className="secondary small" onClick={() => onDownload(rec, format)}>{format.toUpperCase()}</button>)}</div>
  </section>;
}

export function App(): ReactElement {
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem("qual-hardware-language") as Language | null) ?? "pt");
  const [step, setStep] = useState<Step>("project"); const [scenario, setScenario] = useState<CapacityScenario>(createInitialScenario);
  const [cameraCountConfirmed, setCameraCountConfirmed] = useState(false);
  const [record, setRecord] = useState<ScenarioRecord | null>(null); const [recommendations, setRecommendations] = useState<CapacityRecommendation[]>([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const stepIndex = steps.indexOf(step); const groupTotal = useMemo(() => scenario.cameraGroups.reduce((sum, group) => sum + group.count, 0), [scenario.cameraGroups]);
  useEffect(() => {
    void api<CatalogStatus>("/api/catalog/status").then(setCatalogStatus).catch(() => setCatalogStatus(null));
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
      saveBlob(`qual-hardware-${recommendation.policy}.${format}`, blob);
      setMessage(lang === "pt" ? `${format.toUpperCase()} verificado e baixado com sucesso.` : `${format.toUpperCase()} verified and downloaded successfully.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown_error";
      setMessage(lang === "pt" ? `Não foi possível gerar um ${format.toUpperCase()} válido (${detail}). Recalcule o projeto e tente novamente.` : `A valid ${format.toUpperCase()} could not be generated (${detail}). Recalculate the project and try again.`);
    } finally { setBusy(false); }
  };
  const manifest = async (recommendation: CapacityRecommendation): Promise<void> => { const gpuDriver = window.prompt(lang === "pt" ? "Informe a versão exata do driver GPU que será validada:" : "Enter the exact GPU driver version to validate:"); if (!gpuDriver?.trim()) return; setBusy(true); try { const result = await api<unknown>("/api/benchmarks/manifests", { method: "POST", body: JSON.stringify({ recommendationId: recommendation.id, gpuDriver: gpuDriver.trim(), slaInferenceLatencyMs: 10000 }) }); downloadJson(`qual-hardware-benchmark-${recommendation.policy}.json`, result); setMessage(lang === "pt" ? "Manifesto de benchmark gerado. O nonce expira em 24 horas." : "Benchmark manifest generated. Its nonce expires in 24 hours."); } catch (error) { setMessage(error instanceof Error ? error.message : "Error"); } finally { setBusy(false); } };
  const refreshCatalog = async (): Promise<void> => {
    setBusy(true); setMessage("");
    try {
      const status = await api<CatalogStatus>("/api/catalog/refresh", { method: "POST" });
      setCatalogStatus(status); setRecommendations([]); setRecord(null);
      setMessage(lang === "pt" ? `Catálogo ${status.catalogVersion} atualizado. Recalcule os projetos existentes.` : `Catalog ${status.catalogVersion} updated. Recalculate existing projects.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "catalog_update_failed");
    } finally { setBusy(false); }
  };
  const body = step === "project" ? <ProjectStep scenario={scenario} update={setScenario} lang={lang} cameraCountConfirmed={cameraCountConfirmed} onCameraCount={(value) => { setScenario(withCameraTotal(scenario, value)); setCameraCountConfirmed(true); }} /> : step === "cameras" ? <CameraStep scenario={scenario} update={setScenario} lang={lang} /> : step === "agents" ? <AgentsStep scenario={scenario} update={setScenario} lang={lang} /> : step === "additional" ? <AdditionalStep scenario={scenario} update={setScenario} lang={lang} /> : step === "storage" ? <NetworkStep scenario={scenario} lang={lang} /> : <ResultsStep scenario={scenario} recommendations={recommendations} lang={lang} onManifest={manifest} onDownload={downloadReport} />;
  return <div className="app-shell"><header><div className="brand"><div className="brand-mark">A<span>Q</span></div><div><b>AIQUIMIST</b><small>QUAL HARDWARE</small></div></div><div className="header-meta"><span className="private-badge">● PRIVATE NETWORK</span><button onClick={() => { const next = lang === "pt" ? "en" : "pt"; setLang(next); localStorage.setItem("qual-hardware-language", next); }}>{lang === "pt" ? "EN" : "PT"}</button></div></header>
    <main><div className="intro"><div><p>HARDWARE / {String(stepIndex + 1).padStart(2, "0")}</p><h1>{text[lang].title}</h1><span>{text[lang].subtitle}</span></div><div className="camera-counter"><strong>{cameraCountConfirmed ? scenario.totalCameras : "—"}</strong><span>CAMERAS</span></div></div>
      <div className="step-progress">{lang === "pt" ? "Etapa" : "Step"} {stepIndex + 1} {lang === "pt" ? "de" : "of"} {steps.length} · {text[lang][step]}</div>
      <nav className="stepper">{steps.map((item, index) => <button key={item} className={`${item === step ? "active" : ""} ${index < stepIndex ? "done" : ""}`} onClick={() => index <= stepIndex || recommendations.length ? setStep(item) : undefined}><i>{index < stepIndex ? "✓" : index + 1}</i><span>{text[lang][item]}</span></button>)}</nav>
      {message && <div className="toast" onClick={() => setMessage("")}>{message}<span>×</span></div>}{body}
      <div className="actions">{stepIndex > 0 && <button className="secondary" onClick={() => setStep(steps[stepIndex - 1]!)}>{text[lang].back}</button>}<div />{step !== "result" && step !== "storage" && <button className="primary" disabled={step === "project" && !cameraCountConfirmed} onClick={() => setStep(steps[stepIndex + 1]!)}>{text[lang].next} →</button>}{step === "storage" && <button className="primary" disabled={busy || groupTotal !== scenario.totalCameras} onClick={calculate}>{busy ? "…" : text[lang].calculate} →</button>}{step === "result" && <button className="primary" disabled={busy} onClick={calculate}>{lang === "pt" ? "Recalcular" : "Recalculate"}</button>}</div>
    </main><footer><span>{WORKLOAD_CONTRACT_VERSION}</span><div className="catalog-state"><span>{catalogStatus ? `${lang === "pt" ? "Catálogo" : "Catalog"}: ${catalogStatus.catalogVersion} · ${catalogStatus.source}${catalogStatus.stalePriceCount ? ` · ${catalogStatus.stalePriceCount} ${lang === "pt" ? "preços defasados" : "stale prices"}` : ""}` : (lang === "pt" ? "Catálogo: verificando" : "Catalog: checking")}</span>{catalogStatus?.remoteUpdateConfigured ? <button type="button" disabled={busy} onClick={refreshCatalog}>{lang === "pt" ? "Atualizar agora" : "Update now"}</button> : <small>{lang === "pt" ? "Atualização privada ainda não configurada" : "Private update not configured yet"}</small>}</div><span>{lang === "pt" ? "Sem mídia · Sem credenciais RTSP" : "No media · No RTSP credentials"}</span></footer>{busy && <div className="loading"><div /></div>}</div>;
}
