# Pesquisa — estado atual e integração

## Qual Hardware

- `src/shared/types.ts` e `src/shared/schemas.ts` aceitam somente resultado de calibração 1.0.
- `src/server/app.ts` oferece criação de plano e importação manual, sem sessão de handoff.
- `src/server/store.ts` persiste execuções concluídas em `calibration_runs`.
- `src/web/App.tsx` abre o centro de calibração a partir de uma recomendação, baixa `.qhplan.json` e pede abertura manual do Perceptrum.
- `src/desktop/main.ts` já contém validação de URL externa, mas não aceita o protocolo restrito do Perceptrum.

## Perceptrum isolado

- O executor passou a produzir `qual-hardware-local-calibration/1.1.0`, mantendo 1.0 suportado.
- O resultado inclui capacidades de telemetria, resumos por recurso e processo, evidência por etapa, estado do teste e artefato/checksum.
- O arquivo é gravado de forma atômica e append-only em `Documentos/Qual Hardware/Calibracoes`.
- O servidor local expõe handoff, progresso, histórico e abertura da pasta, sempre em loopback.
- Os hosts macOS, Windows e Linux registram `perceptrum://calibration/run`.

## Decisão de integração

- O servidor local do Qual Hardware tenta entregar a URI diretamente ao Perceptrum em `127.0.0.1:4000`.
- Se o Perceptrum estiver fechado, uma ponte injetada pelo Electron abre exclusivamente a URI validada do protocolo.
- O Perceptrum busca o plano e devolve progresso/resultado ao endereço aleatório do Qual Hardware usando token descartável.
- O token é validado por hash, em tempo constante, e nunca aparece nas respostas públicas.
- Se o callback falhar, o Qual Hardware procura apenas resultados que correspondam a sessões pendentes conhecidas no diretório Documentos.

## Limitação de ambiente

- Sensores e drivers Windows/Ubuntu só podem ser homologados fisicamente nesses sistemas. O macOS disponível comprova o fluxo real agora; builds e testes nativos em CI comprovam portabilidade do código, não desempenho físico futuro.
