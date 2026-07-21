import type { CapacityScenario, Currency, Market } from "./types.js";

export type MarketSelection = "BR" | "US" | "DE" | "BR_US" | "BR_DE" | "ALL";

const SELECTION_MARKETS: Record<MarketSelection, readonly Market[]> = {
  BR: ["BR"],
  US: ["US"],
  DE: ["DE"],
  BR_US: ["BR", "US"],
  BR_DE: ["BR", "DE"],
  ALL: ["BR", "US", "DE"],
};

export function marketsForSelection(selection: MarketSelection): Market[] {
  return [...SELECTION_MARKETS[selection]];
}

export function marketSelectionForScenario(scenario: Pick<CapacityScenario, "market" | "markets">): MarketSelection {
  const markets = scenarioMarkets(scenario);
  if (markets.length === 3) return "ALL";
  if (markets.includes("BR") && markets.includes("US")) return "BR_US";
  if (markets.includes("BR") && markets.includes("DE")) return "BR_DE";
  return markets[0] ?? scenario.market;
}

export function scenarioMarkets(scenario: Pick<CapacityScenario, "market" | "markets">): Market[] {
  const selected = scenario.markets?.filter((market, index, values) => values.indexOf(market) === index) ?? [];
  return selected.length ? selected : [scenario.market];
}

export function primaryMarketForSelection(selection: MarketSelection): Market {
  return SELECTION_MARKETS[selection][0]!;
}

export function defaultCurrencyForSelection(selection: MarketSelection): Currency {
  if (selection === "US") return "USD";
  if (selection === "DE") return "EUR";
  return "BRL";
}

export function marketLabelPt(markets: readonly Market[]): string {
  return markets.map((market) => market === "BR" ? "Brasil" : market === "US" ? "Estados Unidos" : "União Europeia").join(" + ");
}

export function marketLabelEn(markets: readonly Market[]): string {
  return markets.map((market) => market === "BR" ? "Brazil" : market === "US" ? "United States" : "European Union").join(" + ");
}
