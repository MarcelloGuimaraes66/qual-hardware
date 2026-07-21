import { describe, expect, it } from "vitest";
import { buildRecommendations } from "../src/engine/capacity.js";
import { HARDWARE_CATALOG } from "../src/engine/catalog.js";
import { REFERENCE_FX_FROM_USD } from "../src/engine/referenceCosts.js";
import { defaultCurrencyForSelection, marketSelectionForScenario, marketsForSelection, scenarioMarkets } from "../src/shared/markets.js";
import { createDefaultScenario } from "../src/shared/schemas.js";
import type { PriceQuote } from "../src/shared/types.js";

describe("multi-market hardware search", () => {
  it("maps every user-facing market combination to stable catalog markets", () => {
    expect(marketsForSelection("BR_US")).toEqual(["BR", "US"]);
    expect(marketsForSelection("BR_DE")).toEqual(["BR", "DE"]);
    expect(marketsForSelection("ALL")).toEqual(["BR", "US", "DE"]);
    expect(defaultCurrencyForSelection("ALL")).toBe("BRL");
    expect(marketSelectionForScenario({ market: "BR", markets: ["BR", "US", "DE"] })).toBe("ALL");
  });

  it("keeps scenarios saved before multi-market search on their original market", () => {
    expect(scenarioMarkets({ market: "US" })).toEqual(["US"]);
  });

  it("compares BRL and USD quotations in the selected report currency", () => {
    const scenario = createDefaultScenario(8);
    scenario.market = "BR";
    scenario.markets = ["BR", "US"];
    scenario.currency = "BRL";
    const now = new Date().toISOString();
    const quote = (id: string, market: "BR" | "US", currency: "BRL" | "USD", amount: number): PriceQuote => ({
      id,
      hardwareTemplateId: "ws-rtx4070tis-7950x",
      mpn: "EXACT-MPN",
      seller: `${market}-seller`,
      market,
      currency,
      condition: "new",
      inStock: true,
      taxIncluded: null,
      amount,
      originalAmount: amount,
      originalCurrency: currency,
      exchangeRate: 1,
      exchangeRateSource: null,
      url: `https://${market.toLowerCase()}.example/product`,
      observedAt: now,
      sourceKind: "curated",
    });
    const quotes = [
      quote("00000000-0000-4000-8000-000000000071", "BR", "BRL", 1000),
      quote("00000000-0000-4000-8000-000000000072", "US", "USD", 200),
    ];
    const recommendation = buildRecommendations("00000000-0000-4000-8000-000000000070", 1, scenario, HARDWARE_CATALOG, quotes)[0]!;
    expect(recommendation.primary.price.basis).toBe("market_quotes");
    expect(recommendation.primary.price.quoteCount).toBe(2);
    expect(recommendation.primary.price.currency).toBe("BRL");
    expect(recommendation.primary.price.maximum).toBeCloseTo(200 * REFERENCE_FX_FROM_USD.BRL.rate * recommendation.primary.nodeCount, 2);
  });
});
