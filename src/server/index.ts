import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { CatalogUpdateService } from "./catalogUpdates.js";
import { createStore } from "./store.js";

const store = createStore();
const catalogUpdates = new CatalogUpdateService(store, {
  remoteUrl: process.env.QUAL_HARDWARE_CATALOG_URL,
  publicKeyPem: process.env.QUAL_HARDWARE_CATALOG_PUBLIC_KEY?.replaceAll("\\n", "\n"),
  cacheFile: process.env.QUAL_HARDWARE_CATALOG_CACHE,
});
await catalogUpdates.initialize();
const port = Number(process.env.PORT ?? 4178);
const server = serve({ fetch: createApp(store, catalogUpdates).fetch, port }, (info) => {
  console.log(`Qual Hardware listening on private endpoint port ${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await store.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
