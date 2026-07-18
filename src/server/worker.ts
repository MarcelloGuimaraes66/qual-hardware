import { setTimeout as delay } from "node:timers/promises";
import { collectConfiguredPriceSources } from "./pricing.js";
import { createStore } from "./store.js";

const store = createStore();
const once = process.argv.includes("--once");

async function processOne(): Promise<boolean> {
  const job = await store.claimJob();
  if (!job) return false;
  let error: string | null = null;
  try {
    if (job.jobType !== "collect_prices") throw new Error(`Unsupported job type: ${job.jobType}`);
    const result = await collectConfiguredPriceSources();
    await store.upsertQuotes(result.quotes);
    console.log(JSON.stringify({ jobId: job.id, quotes: result.quotes.length, messages: result.messages }));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown worker error";
  }
  await store.finishJob(job.id, error);
  if (error) console.error(error);
  return true;
}

try {
  if (once) {
    const result = await collectConfiguredPriceSources();
    await store.upsertQuotes(result.quotes);
    console.log(JSON.stringify(result));
  } else {
    while (true) {
      const worked = await processOne();
      if (!worked) await delay(2_000);
    }
  }
} finally {
  await store.close();
}
