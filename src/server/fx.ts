import type { Currency } from "../shared/types.js";

export interface FxRate {
  from: Currency;
  to: Currency;
  rate: number;
  observedAt: string;
  sourceUrl: string;
}

const BCB_ENDPOINT = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";
const ECB_ENDPOINT = "https://data-api.ecb.europa.eu/service/data/EXR";

function utcDate(offsetDays: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

function bcbDate(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

async function bcbRate(currency: "USD" | "EUR"): Promise<FxRate> {
  const start = bcbDate(utcDate(-7));
  const end = bcbDate(utcDate(0));
  const query = `CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${currency}'&@dataInicial='${start}'&@dataFinalCotacao='${end}'&$orderby=dataHoraCotacao desc&$top=1&$format=json`;
  const url = `${BCB_ENDPOINT}/${query}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`BCB PTAX failed with HTTP ${response.status}`);
  const payload = await response.json() as { value?: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }> };
  const row = payload.value?.[0];
  if (!row?.cotacaoVenda || !row.dataHoraCotacao) throw new Error("BCB PTAX returned no recent rate");
  return { from: currency, to: "BRL", rate: row.cotacaoVenda, observedAt: new Date(row.dataHoraCotacao).toISOString(), sourceUrl: url };
}

async function ecbUsdPerEur(): Promise<FxRate> {
  const start = utcDate(-7).toISOString().slice(0, 10);
  const url = `${ECB_ENDPOINT}/D.USD.EUR.SP00.A?startPeriod=${start}&format=csvdata`;
  const response = await fetch(url, { headers: { accept: "text/csv" } });
  if (!response.ok) throw new Error(`ECB rate failed with HTTP ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const headers = lines[0]?.split(",") ?? [];
  const valueIndex = headers.indexOf("OBS_VALUE");
  const timeIndex = headers.indexOf("TIME_PERIOD");
  const values = lines.slice(1).map((line) => line.split(",")).filter((row) => Number(row[valueIndex]) > 0);
  const row = values.at(-1);
  if (!row || valueIndex < 0 || timeIndex < 0) throw new Error("ECB returned no recent rate");
  return { from: "EUR", to: "USD", rate: Number(row[valueIndex]), observedAt: `${row[timeIndex]}T00:00:00.000Z`, sourceUrl: url };
}

export async function getFxRate(from: Currency, to: Currency): Promise<FxRate> {
  if (from === to) return { from, to, rate: 1, observedAt: new Date().toISOString(), sourceUrl: "same-currency" };
  if (to === "BRL" && (from === "USD" || from === "EUR")) return bcbRate(from);
  if (from === "BRL" && (to === "USD" || to === "EUR")) {
    const inverse = await bcbRate(to);
    return { from, to, rate: 1 / inverse.rate, observedAt: inverse.observedAt, sourceUrl: inverse.sourceUrl };
  }
  const ecb = await ecbUsdPerEur();
  if (from === "EUR" && to === "USD") return ecb;
  return { from, to, rate: 1 / ecb.rate, observedAt: ecb.observedAt, sourceUrl: ecb.sourceUrl };
}
