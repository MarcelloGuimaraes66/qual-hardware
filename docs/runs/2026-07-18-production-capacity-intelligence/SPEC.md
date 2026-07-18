# Especificação — base de evidência e recomendação segura

Data: 2026-07-18

## Modelo aditivo

Novas entidades lógicas:

- `HardwareComponent`: CPU, GPU, memória, armazenamento, rede ou sistema completo; fabricante, SKU, arquitetura e especificações.
- `PublicBenchmarkObservation`: componente, estágio, perfil, score, unidade/direção, configuração reproduzível, fonte e qualidade.
- `EvidenceSnapshot`: envelope assinado, versão, hash, chave, componentes e observações.
- `CalibrationReplicate`: execução física e qualidade do pipeline.
- `EmpiricalCorrection`: estrato, estágio, erro de superestimação, variabilidade e reserva.
- `CatalogUpdateRun`: tipo, estado, progresso, contagens, diff, avisos e erro.

Persistência é aditiva e mantém JSON original para compatibilidade/auditoria.

## Classificação

- `validated_local`: hardware exato, calibração integral completa e gate válido.
- `extrapolated_high`: três âncoras comparáveis, três repetições sustentadas, cobertura obrigatória e zero superestimação pós-margem.
- `extrapolated_medium`: duas âncoras comparáveis; recomendação condicional com reserva mínima de 30%.
- `reference_only`: uma âncora, mudança arquitetural, cobertura incompleta ou reserva >= 40%.
- `incompatible`: sistema/backend/requisito incompatível.

Alta confiança usa reserva mínima de 20%. Nenhuma cobertura produz intervalo `null`, nunca zero artificial.

## Cobertura obrigatória

RTSP/network ingest, decode, BGR/processamento, encode, disk write, local inference e thermal sustain. Disk read e memória complementam o diagnóstico, mas não substituem estágios obrigatórios.

## Atualizações

Inventário, preço e evidência são snapshots separados. A UI oferece:

- estado atual e idade;
- “Verificar” sem ativar;
- resumo do que será alterado;
- confirmação de importação local;
- progresso por etapa;
- conclusão com adicionados/atualizados/inalterados/rejeitados;
- avisos persistentes para base ausente, vencida ou inválida.

Atualização automática, quando configurada, verifica no início e a cada 24 horas, mas sempre registra execução e notifica o operador. Nunca rebaixa versão silenciosamente.

## Preços

Somente membros do snapshot ativo e não vencidos entram no mínimo/mediana/máximo. Sem cotação válida, `quotationRequired=true`. Conversão exige taxa, origem e data. Componentes e total reconciliam exatamente.

## Relatórios

`capacity-recommendation-export/2.3.0` contém `executiveNarrative` estruturado. O PDF começa com texto natural, depois mantém todas as seções técnicas. Todas as alternativas qualificadas (até seis ou mais, conforme política) aparecem em custo crescente e com selo de evidência.

## Manual

Entregas: guia completo Markdown/PDF, guia rápido, solução de problemas, guia de coordenação/importação e convite modelo. O aplicativo abre o guia e conduz o teste sem câmeras, com Qwen local, sem OpenAI e sem upload automático.

## Compatibilidade

Um único lockfile, Node 24, Electron 43.1.1. O código usa caminhos e processos portáveis. Artefatos: EXE portátil x64, DMG arm64, AppImage x64 e DEB amd64. macOS tem prova física atual; Windows/Ubuntu recebem build/smoke nativos e aguardam checklist físico.
