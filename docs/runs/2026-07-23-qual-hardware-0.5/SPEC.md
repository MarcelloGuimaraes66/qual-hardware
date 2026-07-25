# Especificação executável

## Resultado de probe

`pass`, `capacity_fail`, `infrastructure_error` ou `cancelled`. Infraestrutura recebe uma repetição automática e nunca atualiza H/F.

## Carga

- Escala por maior resto, preservando grupos não vazios quando o nível comporta a mistura.
- VÍDEO paga stream, decode, processamento, clipe/encode e inferência.
- FRAME paga stream, decode compartilhado, snapshot pontual e inferência na cadência.
- Gravação contínua adiciona encode/armazenamento independentemente do tipo de análise.
- Backends: `local_aiq`, `remote_vision` e `native_cv`.

## Capacidade

- A carga informada é semente.
- Passou: expansão exponencial.
- Falhou por capacidade: contração e busca binária.
- Exato somente com H e H+1 repetidos.
- Gerador esgotado: `at_least`.
- Infraestrutura persistente: `inconclusive`.
- Não monotônico: `interval`.
- Seguro: `floor(H × 0,8)`, incluindo zero.

## Relatório

Um `CalibrationDiagnosticReportModel` alimenta tela, PDF, TXT e XLSX. Falha inconclusiva não autoriza compra. Os detalhes técnicos ficam recolhidos.

## Persistência

SQLite v11 aditivo, relatório e tentativas tipadas armazenados sem remover o JSON histórico. `.qhcal` v3 lê pacotes v1/v2.
