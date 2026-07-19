# Implementação — diário

## Checklist

- [x] Confirmar base Git e criar worktree isolado.
- [x] Registrar fatos, invariantes, blast radius, orçamento e validação.
- [x] Implementar contratos e SQLite v6.
- [x] Implementar evidência e cálculo conservador.
- [x] Atualizar APIs, UI e relatórios.
- [x] Estender publicador e CI.
- [x] Criar/atualizar manual de testadores.
- [x] Executar a validação disponível no macOS.

## Execução

- 2026-07-19 08:33: Archon indisponível; iniciado fluxo manual equivalente.
- Base escolhida: `07150a5`, pois contém o publicador `46e0849` e as duas alterações locais subsequentes sem divergência.
- SQLite evoluído de v5 para v6 apenas com novas tabelas normalizadas de suites, perfis, sistemas, execuções, métricas, qualidade, previsões por estágio e validação comercial.
- Workload, calibração, evidência, previsão e exportação evoluídos para as versões 3.0/2.0 previstas, mantendo leitura das versões anteriores.
- O gate comercial agora exige os quinze estágios, pipeline integral, qualidade ≥99,5%, fila estável, p99 dentro do ciclo e zero rede externa/OpenAI.
- `reference_only` deixa de publicar capacidade comercial e aparece como `blocked`; confiança média permanece `planning_only`.
- Recomendação de 64 ou mais câmeras recebe reserva N+1 também na política recomendada.
- PDF, XLSX e JSON separam opções qualificadas de opções apenas para planejamento e iniciam com narrativa didática.
- Registro e coletor foram ampliados para SPEC, MLCommons, STREAM, fio, FFmpeg, OpenCV e matrizes oficiais de codec; números só entram por parser determinístico e evidência localizável.
- A identidade Aiquimist usa a logomarca fornecida proporcionalmente e abre `https://aiquimist.ai/` no navegador externo.

## Desvios e limites preservados

- Não foram fabricadas observações numéricas nem calibrações físicas. Sem 3–5 âncoras completas e dados comparáveis em todos os estágios, as máquinas atuais continuam corretamente bloqueadas para aquisição.
- A publicação agendada e os runners nativos só poderão ser executados depois que o branch for integrado e enviado ao GitHub; nenhum push, Release ou segredo foi criado nesta execução.
- Windows e Ubuntu receberam o mesmo código, contratos, paths nativos e matriz CI. A homologação física continua pendente e não é apresentada como já realizada.
- O usuário solicitou preservar tudo localmente: nenhum commit, push, PR ou Release foi criado.
