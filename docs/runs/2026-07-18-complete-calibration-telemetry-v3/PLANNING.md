# Planejamento — calibração completa CPU/GPU e pipeline

## Classificação e objetivo

- Risco: T4, pois a mudança atravessa dois aplicativos desktop, dados persistidos, protocolo local, telemetria e critérios de compra.
- Objetivo: tornar a calibração um fluxo visível e de um clique no Qual Hardware, executado pelo pipeline real do Perceptrum, com resultado persistido antes da transmissão, importação automática e apresentação detalhada em ambos os aplicativos.
- Plataformas: um código TypeScript e contratos idênticos para macOS, Windows 11 e Ubuntu; homologação física imediata apenas no macOS disponível.

## Fatos verificados

- O Qual Hardware já cria planos `qual-hardware-calibration-plan/1.0.0` e importa resultados `qual-hardware-local-calibration/1.0.0` manualmente.
- O Perceptrum isolado já possui o executor de produção, MediaMTX local, AiQ local, persistência append-only e a extensão aditiva 1.1 do resultado.
- O SQLite do Qual Hardware possui `calibration_runs`, mas não possui sessões de entrega segura.
- O Electron do Qual Hardware executa a API em `127.0.0.1` com porta aleatória e já restringe navegação e links externos.
- O checkout ativo do usuário no Perceptrum contém mudanças próprias e não será tocado.

## Invariantes

- Nenhum banco, arquivo, calibração, relatório ou evidência existente será apagado, recriado ou sobrescrito.
- O banco permanece em `app.getPath("userData")`; `appId`, `productName`, API loopback, sandbox e isolamento do renderer permanecem.
- Resultados 1.0 continuam importáveis; 1.1 é evolução aditiva.
- O token original de sessão nunca é persistido; comunicação usa somente `127.0.0.1`, expiração e comparação segura.
- O JSON é salvo pelo Perceptrum em Documentos antes de callback ou importação.
- Métrica ausente nunca vira zero; recebe estado e motivo explícitos.
- OpenAI e conexões externas permanecem proibidos durante o ensaio.

## Raio de impacto e orçamento de mudança

- Contratos e schemas compartilhados de calibração.
- Uma tabela SQLite aditiva de sessões.
- Rotas de sessão, callback, conciliação e importação no servidor local.
- Ponte restrita do Electron para abrir `perceptrum://calibration/run`.
- Centro de calibração e painel de resultados no React.
- Testes, documentação e manual de testadores.
- Sem mudanças em fórmulas de recomendação, contratos HTTP não relacionados, catálogo ou schema preexistente.

## Sequência

1. Adicionar contratos 1.1 e compatibilidade 1.0.
2. Persistir sessões aditivamente e implementar autenticação/expiração.
3. Entregar o plano ao Perceptrum por loopback; usar protocolo nativo apenas para inicialização.
4. Receber progresso/resultado, salvar calibração e recalcular previsões.
5. Conciliar JSON salvo quando o Qual Hardware estava fechado.
6. Exibir progresso, histórico, métricas e JSON completo.
7. Validar unitariamente, compilar, empacotar e executar integração real no macOS.

## Rollback

- Reverter os commits dos dois worktrees.
- Como a migração é aditiva e os resultados são append-only, registros existentes continuam legíveis.
- Bloquear entrega se houver perda de dados, listener fora do loopback, token persistido em claro, regressão 1.0, chamada externa durante calibração ou pacote dependente de Node externo.
