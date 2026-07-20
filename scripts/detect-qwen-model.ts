import { discoverBestQwenTextModel, discoverLlamaCppServer, QWEN_MEMORY_BUDGET_FRACTION } from "../src/server/qwenModelSelection.js";

const model = await discoverBestQwenTextModel({ explicitPath: process.env.QWEN_MODEL_PATH });
const runtime = await discoverLlamaCppServer();

if (!model) {
  process.stderr.write("Nenhum modelo Qwen textual compatível foi encontrado dentro da reserva de memória.\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    status: runtime ? "ready" : "model_found_runtime_missing",
    model: model.modelId,
    fileName: model.fileName,
    path: model.path,
    sha256: model.modelSha256,
    sizeBytes: model.sizeBytes,
    parameterBillions: model.parameterBillions,
    quantization: model.quantization,
    selection: model.source,
    memoryBudgetFraction: QWEN_MEMORY_BUDGET_FRACTION,
    llamaCpp: runtime,
    role: "catalog_classification_and_name_normalization_only",
    numericDecisionsAllowed: false,
  }, null, 2)}\n`);
}
