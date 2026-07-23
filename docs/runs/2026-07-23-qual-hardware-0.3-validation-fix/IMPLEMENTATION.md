# Implementação

## Correções principais

- Removida qualquer dependência de execução do Perceptrum na calibração.
- Reconhecimento de Metal/`MTL0`, CUDA, Vulkan e ROCm.
- `runEverySeconds` passou a controlar a cadência; `modelFps`, os quadros por pacote.
- Requisições usam JPEG reais e a concorrência representa câmeras em processamento.
- Preflight local de CPU/GPU, slots do llama-server e fila limitada por prazo e memória.
- Uma pipeline FFmpeg e um ring buffer por câmera, com encerramento da árvore de processos.
- Telemetria macOS sem `sudo` ou `powermetrics`; sensores opcionais ausentes são `unavailable`.
- Erro de infraestrutura, limite do hardware, cobertura de sensores e confiança comercial foram separados.
- O nível superior esperado que falha durante descoberta adaptativa continua registrado em `tierResults`, mas não contamina a saúde do último nível estável.
- Progresso normalizado impede o campo legado `overallPercent=98` de rebaixar um estado concluído em 100%.
- Exportação automática assinada e resumo técnico com caminho absoluto.
- Diretório exibido, aberto e pesquisado para recuperação usa o mesmo diretório real de evidências do empacotador.

## Isolamento de plataforma

- Contrato comum: `src/platform/shared`.
- Adaptadores: `src/platform/macos`, `src/platform/windows` e `src/platform/ubuntu`.
- Runtimes empacotáveis continuam separados por sistema e arquitetura.

## Integração

A branch-base remota permaneceu em `b124d1b`. As correções úteis da linha divergente de calibração foram integradas semanticamente, evitando um merge destrutivo que removeria componentes da implementação multiplataforma mais nova.

## Correção do CI antes da integração na `main`

- O smoke empacotado diferencia o pacote físico completo do pacote source-only criado pelo GitHub Actions.
- Fora do CI, a ausência do runtime nativo continua sendo erro fatal do empacotamento.
- No CI, onde os 4,3 GB de runtimes e modelos não são versionados, o smoke exige comportamento fail-closed: runtime não verificado, qualificação completa recusada com HTTP 503 e nenhuma calibração inventada.
- Quando o runtime está presente, todas as verificações anteriores de arquitetura, tamanho, SHA-256, telemetria, inferência, exportação, cancelamento e recuperação continuam obrigatórias.
- O workflow deixou de executar simultaneamente por `push` da branch `codex/*` e por `pull_request`; branches com PR agora geram um único conjunto de checks.
- A matriz de CI mantém 5 segundos por teste no macOS/Ubuntu e usa 15 segundos no Windows, cuja camada de I/O do runner mostrou latência variável em operações SQLite reais.
- Recursos comuns do empacotamento são copiados uma única vez pela seção global do electron-builder; cada seção de sistema contém somente o runtime do seu próprio alvo.
