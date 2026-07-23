# Validação — Windows multi-CPU/multi-GPU e capacidade

Data: 2026-07-23

## Ferramentas fixadas

- Node.js 24.18.0
- npm 11.16.0
- Go 1.26.5

## Resultado automatizado

- Typecheck web, servidor e ferramentas: aprovado.
- Vitest: 27 arquivos, 226 testes aprovados, 2 testes físicos condicionais
  ignorados.
- Probe Go: aprovado.
- Build Vite/TypeScript: aprovado.
- Pacote desempacotado Windows x64: aprovado em `release/win-unpacked`.
- Smoke do pacote source-only: aprovado; API loopback, SQLite v10, relatórios,
  persistência, reinício e limpeza foram exercitados.
- Auditoria de fontes: inventário válido e fail-closed.

## Máquina detectada

- ASUS ROG Strix SCAR 18 G835LX
- 1 socket, Intel Core Ultra 9 275HX, 24C/24T
- 33.673.297.920 bytes de RAM
- NVIDIA RTX 5090 Laptop, UUID
  `GPU-353994d5-79e9-1c86-1caf-aabc269db632`, 25.651.314.688 bytes de VRAM,
  driver 592.00
- Intel Graphics classificada como `display_only`, fora da inferência e mídia
  até medição individual provar benefício
- 1 grupo de processadores, 1 nó NUMA
- enlace físico ativo observado no instante da validação: Wi-Fi 780 Mbps,
  duplex não aplicável/desconhecido; adaptador virtual foi excluído

## Probe Windows candidato

- Versão: 0.2.0
- Tamanho: 2.708.480 bytes
- SHA-256:
  `1C5B9154641F506AAD4ADA212AEEFC91BE62027384642DA7D60AE3D2C44A048E`
- Detectou a RTX por UUID/PCI e produziu utilização, VRAM, temperatura, potência
  e throttling por dispositivo.

## Runtime Windows candidato instalado

- Versão: `1.0.0-candidate.1`
- Classificação e chave: `candidate` /
  `qual-hardware-candidate-2026`
- Pacote: `release/Qual-Hardware-runtime-1.0.0-candidate.1-win32-x64.qhruntime`
- Tamanho do pacote: 5.558.565.043 bytes
- SHA-256 externo do pacote:
  `5DE87DE8E284D0671C36B6FB44DC229EDD64168E202A2CF2CB0EE50CB265D543`
- Hash do manifesto assinado do pacote:
  `ca40bc10e0a6ace19f0e15115479d500da312a8a11d0927f8cf9021abbafaa14`
- Instalação atômica: aprovada no perfil
  `release/unified-test-user-data`
- Ativos verificados pela app: 9/9
- Contratos de autoridade, pipeline e fontes: 3/3 verificados
- `runtimeAssetsVerified`: `true`
- `readyForQuickTest`: `true`
- `readyForFullQualification`: `true`
- `manifestApproved`: `false`
- `qualificationAllowed`: `false`

A classificação candidata é intencional. Ela permite que o proprietário execute
o diagnóstico físico local, mas não transforma o resultado em homologação
comercial e não autoriza distribuição externa ou assinatura de produção.

## Diagnóstico físico sob controle do usuário

O agente não iniciou teste de esforço nem calibração. Após a instalação, a
aplicação unificada foi aberta e confirmou zero sessões ativas. Conforme
orientação explícita do proprietário, somente ele iniciará o botão
`Diagnóstico — 10 minutos` dentro da interface.

Os modos `Validação — 60 minutos` e qualificação comercial de 24 horas não foram
executados e permanecem fora da autorização atual.

## Gates ainda físicos

- Windows Server 2022/2025 com 2 sockets, mais de 64 processadores lógicos e ao
  menos 2 GPUs.
- Ubuntu 24.04 equivalente.
- Regressão Apple Silicon.
- Piloto de cluster para qualquer recomendação com mais de um servidor.
