# Implementação - restauração exata do relatório PDF

## Execução

- Criado worktree isolado no branch `codex/restore-pdf-exactly`, partindo de `ffe88c9`.
- Comparados texto, metadados e imagens das nove páginas da referência com as sessenta páginas da versão regressiva.
- A Parte I foi restaurada como relatório independente.
- A lista de alternativas voltou para a segunda página e recuperou o título original.
- Os seis blocos de cada proposta foram centralizados em uma estrutura testável.
- A cobertura resumida que havia invadido a especificação por nó foi retirada desse local.
- A auditoria de BOM, quinze estágios e requisitos neutros deixou de ser repetida no PDF principal.
- A Parte II passou a conter somente resumo comercial, especificações oficiais por componente, fontes e situação concisa das evidências.
- Rodapés da Parte I e da Parte II passaram a ter paginação independente.
- O nome baixado voltou a ser `qual-hardware-recomendacoes.pdf`.
- Corrigidos acentos de componentes, nomes do grupo de câmeras e nome do Agent padrão.

## Arquivos alterados

- `src/server/reports.ts`
- `src/server/app.ts`
- `tests/api-and-reports.test.ts`
- `scripts/generate-report-samples.ts`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/VALIDATION.md`

## Desvios

- O relatório de amostra atual possui 24 câmeras e contrato 3.1; a referência possui 25 câmeras e contrato 2.0. Por isso a Parte I atual ocupa 8 páginas, enquanto a referência ocupava 9. A hierarquia e a ordem foram restauradas, mas não foi criada uma página vazia artificial apenas para igualar a contagem.
- Archon não foi consumido. O fluxo equivalente foi executado manualmente no worktree isolado, preservando os artefatos exigidos.

## Resultado

O relatório principal recuperou o formato reconhecível do PDF fornecido. Os dados novos continuam disponíveis sem substituir a apresentação antiga.
