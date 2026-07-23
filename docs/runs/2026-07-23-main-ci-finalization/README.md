# Finalização do CI da `main`

## Contexto

- O PR #8 foi aprovado pelo run `30001226964`: builds, pacotes e smokes nativos em Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64, seguidos da consolidação cruzada dos três `.qhcal`.
- O merge `9eac8e145ea341c6856f06f2610c39ed7192549b` levou exatamente a árvore validada `8fd1de5b63452187277c09bfa974e4ba12ca11c6` para a `main`.
- No run pós-merge `30001624360`, um teste de retomada de checkpoint encerrou em 15.015 ms no Windows e excedeu por 15 ms seu timeout explícito.

## Causa raiz

O teste de unidade usava `detectCalibrationHardware()` diretamente e o endpoint de retomada chamava o mesmo inventário mais duas vezes. Isso fazia um teste de `MemoryPlannerStore` depender de CIM/PowerShell e da velocidade do runner físico Windows, embora seu objetivo fosse validar apenas a compatibilidade e a linhagem de um checkpoint.

## Correção

- `ApplicationOptions` aceita um `calibrationHardwareDetector` injetável.
- A aplicação real continua usando `detectCalibrationHardware` por padrão.
- O teste fornece uma medição determinística e verifica que o detector injetado é usado nas duas avaliações de compatibilidade.
- A exceção de timeout de 15 segundos foi removida; o teste voltou ao limite padrão de 5 segundos.

## Validação local

- Instalação limpa: 479 pacotes, zero vulnerabilidades.
- Arquivo `calibration-sessions.test.ts`: 12/12 aprovados; 368 ms de execução.
- TypeScript: aprovado.
- Suíte completa com `--testTimeout=5000`: 26 arquivos, 208 testes aprovados.

Não houve alteração no detector nativo, na calibração física, no schema SQLite 9, nos adaptadores de plataforma ou nos arquivos de evidência.
