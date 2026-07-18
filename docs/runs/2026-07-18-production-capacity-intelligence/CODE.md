# Desenho de código — inteligência de capacidade

Data: 2026-07-18

## Superfície prevista

- `src/shared/types.ts` e `schemas.ts`: contratos aditivos.
- `database/sqlite-schema.sql` e `src/server/store.ts`: histórico, snapshots ativos, componentes, correções e execuções de atualização.
- `src/engine/calibration.ts`: comparação por componente, direção do score, leave-one-out por estágio e reserva dinâmica.
- `src/server/catalogUpdates.ts`: envelopes separados, anti-rollback, diff e execução auditável.
- `src/server/pricing.ts` e `fx.ts`: identidade determinística, allowlist após redirect, validade e conversão.
- `src/server/reports.ts`: narrativa compartilhada e todas as opções.
- `src/web/App.tsx`: explicação, progresso, alertas e manual.
- scripts de curadoria/assinatura e testes.

## Estratégia de compatibilidade

Campos novos são opcionais ao ler dados v1. Normalizadores produzem a forma corrente antes do cálculo. Tabelas novas usam `CREATE TABLE IF NOT EXISTS`; colunas não são removidas. Snapshots antigos de catálogo continuam verificáveis pelo importador legado, mas não são tratados como evidência pública nova.

## Funções centrais

- `benchmarkRatio(target, anchor)` valida estágio, perfil, versão, unidade, direção e componente.
- `computeEmpiricalCorrection(...)` executa leave-one-out por estrato/estágio.
- `effectiveReserve(...)` escolhe o maior risco observável.
- `qualifyPrediction(...)` aplica cobertura, repetições e segurança.
- `buildExecutiveNarrative(...)` gera texto determinístico a partir do mesmo objeto exportado.
- `summarizePrice(...)` usa somente cotações ativas/válidas.

## Proibições

- Sem scraping no aplicativo.
- Sem score composto opaco.
- Sem preço vencido em cálculo de compra.
- Sem “alta confiança” por preferência de marca.
- Sem prometer homologação física não executada.
- Sem apagar histórico para ativar snapshot novo.
