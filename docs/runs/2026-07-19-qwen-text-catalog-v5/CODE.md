# Código — seleção local do Qwen textual

## Criados

- `src/server/qwenModelSelection.ts`: descoberta, orçamento de memória, escolha, hash em streaming e localização portável do llama.cpp.
- `scripts/detect-qwen-model.ts`: diagnóstico explícito do modelo local.
- `tests/qwen-model-selection.test.ts`: regressão da escolha e dos limites.

## Alterados

- `src/server/qwenCatalog.ts`: servidor local em loopback, lote com uma carga do modelo e encerramento idempotente.
- `scripts/catalog-publisher.ts`: seleção automática e metadados reais.
- `src/server/catalogPublication.ts`, `src/shared/types.ts` e `src/shared/catalogSchemas.ts`: metadados aditivos e auditáveis.
- `.github/workflows/catalog-publisher.yml`: checksum e identidade explícitos do modelo reproduzível do runner.
- `package.json` e `docs/CATALOG_UPDATES.md`: comando e operação documentados.

Nenhum arquivo do Perceptrum foi lido ou modificado durante a implementação após a correção de escopo do usuário.
