export const OFFICIAL_CATALOG_CHANNEL = Object.freeze({
  owner: "MarcelloGuimaraes66",
  repository: "qual-hardware",
  releasePrefix: "catalog-",
  channel: "stable" as const,
  keyRing: Object.freeze({
    "catalog-2026-01": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAKg4eH/fwYB/31k4hGoIdIqw9sNjuPBiN1AlA4dYRCHU=
-----END PUBLIC KEY-----`,
  }),
});

export const QWEN_CATALOG_MODEL = "Qwen/Qwen3-1.7B-GGUF:Q8_0" as const;
export const QWEN_CATALOG_MODEL_SHA256 = "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a";
export const QWEN_CATALOG_PROMPT_VERSION = "qual-hardware-catalog-normalizer/1.0.0";
