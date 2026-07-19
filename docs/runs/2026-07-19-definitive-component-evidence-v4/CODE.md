# Desenho técnico — implementação v7

## Banco

O schema v7 adiciona tabelas para identidades/aliases/especificações de componentes, compatibilidade, BOMs, itens de BOM, decisões, artefatos de benchmark, vínculos por componente/estágio, relatórios de cobertura e validação cruzada. Todas usam `CREATE TABLE IF NOT EXISTS`; nenhuma tabela anterior é alterada destrutivamente.

## Módulos

- Catálogo normalizado: converte sistemas históricos e componentes novos em entidades canônicas.
- Compatibilidade: funções puras retornam decisões explicáveis e códigos de rejeição.
- Configurador: gera candidatos OEM/customizados e persiste BOMs auditáveis.
- Evidências: normaliza observações, calcula cobertura e impede substituição entre estágios.
- Publisher: valida integridade, cobertura e elegibilidade antes de produzir bundle append-only.
- API/UI/report: apresenta componente, benchmark, fórmula, gargalo e motivo do gate.

Implementação concreta:

- `src/engine/componentCatalog.ts`: normalização dos 21 sistemas históricos em BOMs auditáveis, identidades canônicas e decisões de compatibilidade.
- `src/engine/evidence.ts`: quinze estágios, vínculo componente/observação, critérios físicos e gate de aquisição.
- `src/server/catalogSourceFetcher.ts`: parsers determinísticos para os resultados públicos SPEC CPU e MLCommons.
- `scripts/catalog-publisher.ts`: integridade, ausência de órfãos, regressão de cobertura, unidade estável e bloqueio de qualificação sem evidência.
- `src/server/store.ts`: persistência aditiva de componentes, builds, decisões, artefatos e cobertura.
- `src/server/app.ts`, `src/web/App.tsx` e `src/server/reports.ts`: APIs, tela e PDF/XLSX/JSON v4.

## Cálculo

`bruta = capacidade_âncora × índice_alvo ÷ índice_âncora`

`segura = floor(min(previsões) × correção_empírica × reserva)`

O tipo de cada índice inclui suite, versão, perfil, unidade, direção e estágio. A aplicação rejeita diferenças em vez de tentar conversão implícita.

## Plataforma

Nenhum módulo usa caminho fixo ou comando de shell por sistema. SQLite, filesystem e abertura de pastas continuam atrás dos limites existentes do desktop Electron. O catálogo e os bundles são iguais nos três sistemas.
