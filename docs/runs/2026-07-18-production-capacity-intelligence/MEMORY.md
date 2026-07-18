# Memória — inteligência de capacidade e evidências

- Branch: `archon/task-archon-perceptrum-capacity-calibration-v2`.
- Schema SQLite atual: 3, somente aditivo; nunca mover ou recriar `qual-hardware.sqlite`.
- Somente calibração completa do pipeline de produção pode alimentar extrapolação.
- Classe A requer três perfis físicos distintos e comparáveis; a recomendação usa a previsão conservadora e o maior erro observado.
- Public benchmarks são proporções por estágio, não substitutos de medição física.
- Snapshots assinados são imutáveis no histórico; rollback de catálogo/evidência é rejeitado.
- Cotações vencidas não entram no preço, e referência não é oferta comercial.
- O PDF deve conservar a narrativa humana como primeira seção.
- Guias permanentes: `docs/CAPACITY_CALIBRATION_COORDINATOR_GUIDE.md` e `docs/PUBLIC_EVIDENCE_CURATION.md`.
- O Archon T4 foi roteado, mas o executor local falhou antes das alterações por caminho obsoleto do Codex. O protocolo foi continuado manualmente no worktree isolado, com todos os gates registrados.
- Não declarar Windows/Ubuntu fisicamente homologados antes dos respectivos testes nativos.
