import { createServer } from "node:http";

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const port = Number(valueAfter("--port"));
if (!Number.isInteger(port) || port <= 0) process.exit(2);
if (process.env.FAKE_LLAMA_CRASH === "1") setTimeout(() => process.exit(17), 100);

let activeRequests = 0;
const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(process.env.FAKE_LLAMA_HEALTH_HANG === "1" ? 503 : 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ status: process.env.FAKE_LLAMA_HEALTH_HANG === "1" ? "loading" : "ok" }));
    return;
  }
  if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }
  activeRequests += 1;
  const concurrent = activeRequests > 1;
  let rawBody = "";
  for await (const chunk of request) rawBody += chunk;
  const body = JSON.parse(rawBody);
  const expectedByProbeModel = {
    "qual-hardware-qwen-probe-logo-letters": "AQ",
    "qual-hardware-qwen-probe-red-panel": "RED",
    "qual-hardware-qwen-probe-blue-panel": "BLUE",
    "qual-hardware-qwen-probe-parallel-1": "AQ",
    "qual-hardware-qwen-probe-parallel-2": "RED",
  };
  await new Promise((resolve) => setTimeout(resolve, 40));
  if (process.env.FAKE_LLAMA_FAIL_CONCURRENT === "1" && concurrent) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "parallel failure" }));
    activeRequests -= 1;
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(process.env.FAKE_LLAMA_INVALID_RESPONSE === "1"
    ? JSON.stringify({ choices: [{ message: { content: "ZZ" } }] })
    : JSON.stringify({ choices: [{ message: { content: expectedByProbeModel[body.model] ?? "unexpected-model" } }] }));
  activeRequests -= 1;
});

server.listen(port, "127.0.0.1");
const close = () => server.close(() => process.exit(0));
process.on("SIGTERM", close);
process.on("SIGINT", close);
