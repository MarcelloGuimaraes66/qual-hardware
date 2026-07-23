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

