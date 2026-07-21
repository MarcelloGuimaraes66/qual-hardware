# Implementação - caderno técnico PDF/DOCX e mercados combinados

## Entregas

- Nova rota `technical-docx` e arquivo `qual-hardware-caderno-tecnico-detalhado.docx`.
- Dois botões na interface: caderno técnico PDF e DOCX.
- DOCX editável em A4, com oito BOMs únicas no cenário de validação, hierarquia numerada, tabelas, cabeçalho, rodapé, paginação, fontes e glossário.
- Campo aditivo `markets` em cenários; `market` permanece como mercado principal para compatibilidade.
- Opções Brasil, Estados Unidos, União Europeia, Brasil + EUA, Brasil + UE e todos os mercados.
- Conversão de BRL, USD e EUR para a moeda escolhida antes da comparação de preços.
- Capitalização técnica de fabricantes e tradução dos estados de evidência no caderno.

## Preservação

- Relatório principal, XLSX, JSON e anexos neutros mantêm nomes e semântica.
- SQLite v9 não sofreu migração.
- Projetos antigos sem `markets` continuam pesquisando somente seu `market` original.
- Nenhum dado persistido, componente, benchmark ou evidência foi removido.
