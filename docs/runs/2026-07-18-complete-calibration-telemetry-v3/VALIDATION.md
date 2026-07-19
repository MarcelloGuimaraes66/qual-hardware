# Validação — calibração completa CPU/GPU e pipeline

## Automatizada

- Node 24: typecheck completo aprovado.
- Vitest: 9 arquivos e 75 testes aprovados.
- Build React/servidor aprovado.
- Pacote Electron macOS arm64 e DMG gerados.
- Smoke do pacote aprovado, incluindo arquitetura Mach-O arm64, React renderizado, cartão permanente, abertura do painel, botões rápido/completo, telemetria avançada, API/SQLite, persistência, segunda instância, navegação bloqueada e relatórios.
- DMG final verificado pelo macOS; SHA-256 `c202318ff912eceb020e4b948d471a8e6f3a358a258cbd4c6ee0c1b861d2b026`.
- ASAR contém contratos, schema e `dist/server/server/calibrationSessions.js`; não contém servidor/worker standalone obsoleto.

## Integração física macOS

- Binários empacotados Qual Hardware e Perceptrum foram abertos juntos.
- Entrega direta em `127.0.0.1:4000` comprovada; plano, progresso por segundo e callbacks usam token descartável.
- Duas execuções rápidas reais de 10 minutos exercitaram MediaMTX, FFmpeg, RTSP sintético e Qwen local e preservaram seus JSONs antes do callback.
- A primeira revelou divergência `utilizationEvidence`; a segunda revelou checksum dependente da ordem das chaves. Ambas foram corrigidas e cobertas por regressão; nenhum arquivo foi perdido.
- O pacote final importou com sucesso o JSON legado de checksum ordenado e recalculou as previsões.
- Processos e conexões inspecionados durante carga: MediaMTX, FFmpeg e Qwen comunicaram somente por loopback; os resultados registraram zero OpenAI e zero requisições externas.
- Hardware real detectado: MacBook Pro, Apple M4 Max, 14 núcleos, 36 GB de memória unificada. O vínculo exato adotado é `apple-macbook-pro-m4max-14c-32gpu-36gb`; não foi usado o perfil M4 Pro incorreto.
- Sessão completa física `e0f02631-7651-49e1-855f-4e9d50c9dbec` iniciada com 10/40/10 minutos e scheduler real previsto no encerramento.
- Por solicitação do operador, a sessão foi interrompida aos 54%, durante carga sustentada. Antes do encerramento foram preservados 222 clipes, 3.331.613.940 bytes produzidos, estado da sessão, processos, estado térmico e checksum em `perceptrum-20260719T031221Z-Marcellos-MacBook-Pro.local-e0f02631-interrompido.partial.json`.
- O resultado parcial é explicitamente `partial_diagnostic_only`, `validForPurchaseRecommendation: false` e não participa das extrapolações.
- A interrupção expôs uma espera indevida até o final da fase. Foi implementado cancelamento nativo nos dois aplicativos, parada imediata de FFmpeg/MediaMTX/Qwen, persistência atômica do parcial e callback autenticado de estado `cancelled`.
- Uma prova real curta interrompeu uma fase em 2,53 s, preservou cinco amostras de telemetria, gerou `-interrompido.partial.json` e removeu seus próprios temporários.
- Ao final, 62 alvos estritamente temporários (mídia sintética, perfis de smoke e renderizações de inspeção) foram removidos, liberando aproximadamente 7,3 GiB. Fontes, pacotes, bancos, manuais e os três resultados permanentes foram preservados.

## Portabilidade

- Resolução de Documentos, protocolo e adaptadores Windows/macOS/Linux cobertos por testes compartilhados.
- Código e lockfile são únicos; os pacotes Windows e Ubuntu serão construídos nos runners nativos.
- Homologação física de sensores e drivers Windows/Ubuntu continua sendo gate futuro e não é apresentada como já executada neste Mac.

## Resultado da sessão completa

- Interrompida pelo operador; não é apresentada como calibração completa nem como âncora física.
- Diagnóstico preservado em `/Users/marcellogmfreire/Documents/Qual Hardware/Calibracoes/perceptrum-20260719T031221Z-Marcellos-MacBook-Pro.local-e0f02631-interrompido.partial.json`.
- Uma nova execução integral de 60 minutos continua necessária para promover este computador a `validated_local`.
