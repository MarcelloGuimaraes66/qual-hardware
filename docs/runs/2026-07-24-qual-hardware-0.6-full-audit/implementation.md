# Implementação

## Ambiente e aplicativo autossuficiente

- Descoberta de componentes e autotestes em `src/server/executionEnvironment.ts`.
- Benchmark nativo em `tools/native-bench/`, compilado por `scripts/build-native-benchmark.ts`.
- Gerador local de mídia em `src/server/internalRtspLoopback.ts`.
- Rotas de ambiente, dimensionamento e relatórios consolidadas em `src/server/app.ts`.
- Empacotamento multiplataforma preservado em `electron-builder.yml` e nos adaptadores de plataforma.

## Capacidade e confiabilidade

- Busca dinâmica e classificação de fronteira em `src/engine/capacityDiscovery.ts`.
- Execução isolada e evidência por fase em `src/server/calibrationKernelWorker.ts` e `src/server/calibrationPipeline.ts`.
- Prazo do benchmark alinhado à duração real da fase.
- Checkpoints e remoção exata de temporários ao término de cada fase.
- Progresso monotônico, 100% somente após limpeza e cálculo de tempo restante que inclui todas as fases futuras.

## Interface

- Dimensionamento acessível sem calibração obrigatória.
- Verificação de ambiente com orientação de instalação.
- Importação de calibração com ação explícita de confiança, confirmação visual e alerta de sucesso.
- Remoção de textos que não orientavam a operação.
- Exibição da carga VÍDEO FULL e FRAME e dos formatos de relatório.

## Relatórios

- Modelo unificado em `src/engine/calibrationDiagnostic.ts`.
- PDF, TXT, XLSX e JSON em `src/server/calibrationDiagnosticReport.ts`.
- PDF com parágrafos justificados, tabelas, paginação e cabeçalhos estáveis.
- XLSX com alturas calculadas pelas larguras reais das colunas, quebra de texto, abas em português e verificação de fórmulas.
- Relatório de dimensionamento com resumo inicial em português e exportação TXT adicional.
