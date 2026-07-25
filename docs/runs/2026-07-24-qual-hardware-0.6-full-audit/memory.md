# Memória técnica para continuação

## Estado entregue

- Versão: Qual Hardware 0.6.0.
- Aplicativo Windows desempacotado: `release/win-unpacked/Qual Hardware.exe`.
- Branch local: `codex/windows-multi-cpu-gpu-capacity`.
- A árvore de trabalho contém a refatoração ampla desta versão; não descartar alterações não relacionadas.
- O diretório `logos/` pertence ao projeto e deve ser preservado.

## Resultados de referência

- Cenário: `d44824bc-f5d8-4806-9bb3-c7065f1e759f`.
- Recomendação: `2f006a1d-5d48-4aac-a79f-c0ff9fc98592`.
- Calibração rápida: `276ec286-765b-44bd-8446-b782df03f81a`.
- Calibração de engenharia: `4ff5f4b5-28aa-45d2-9b50-50b06645e458`.
- Capacidade segura de referência: 148 câmeras na composição 99 FRAME + 49 VÍDEO FULL.
- Maior valor aprovado: 186 câmeras.
- O valor 186 não é máximo exato, porque nenhuma primeira reprovação foi observada.

## Próximas validações físicas

1. Ubuntu 24.04 x64.
2. macOS Apple Silicon.
3. Windows Server com mais de um processador físico, mais de 64 processadores lógicos e pelo menos duas GPUs.
4. Ubuntu equivalente com múltiplos nós NUMA e GPUs.
5. Enlace cabeado de produção e telemetria térmica.
6. Piloto de cluster antes de tratar um plano de vários servidores como elegível para compra.
