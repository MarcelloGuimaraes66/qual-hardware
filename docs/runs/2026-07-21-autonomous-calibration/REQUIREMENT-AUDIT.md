# Auditoria de requisitos — calibração autônoma

Data: 2026-07-21

## Autoridade verificada

O contrato comportamental foi extraído em modo somente leitura do commit imutável
`d918faa0ecd6a9906b711039e5d89f78e0536c44` do Perceptrum. O Qual Hardware não
importa, não executa e não escreve nesse repositório.

- `runJobSchedulerTick` seleciona Jobs agendados, persiste `job_runs` e enfileira
  comandos `job_start`/`job_stop` inicialmente pendentes.
- O runtime persiste `job_step_runs`, `camera_runtime_sessions`,
  `camera_agent_runs` e `camera_agent_run_results`.
- `runIntelligenceSchedulerTick` reivindica o Job de Intelligence mais antigo em
  estado `queued`, move-o para `running` e termina em `completed`, `failed`,
  `cancelled` ou `paused`.
- O dashboard consulta câmeras, Agents, eventos de runtime, métricas de captura,
  progresso de Jobs/Steps, resultados de Agents, Intelligence e comandos pendentes.

O contrato dourado executável está em `contracts/calibration-pipeline-contract-v1.json`.

## Matriz do plano

| Requisito | Estado | Evidência ou bloqueio |
|---|---|---|
| Branch e worktree isolados | implementado | branch `codex/calibracao-autonoma-qual-hardware`, base imutável confirmada |
| Botão sem abrir Perceptrum | implementado | entrega `internal` para o worker |
| Banco append-only v9 | implementado | extensão aditiva, backup e transações atômicas |
| Limpeza exata de temporários | implementado | manifesto de propriedade, hashes, rejeição de links e travessia |
| Perfil/build/kernel/manifest exatos | implementado | assinatura canônica, contexto do runtime atual e testes que rejeitam outro manifesto |
| Fingerprint físico sem dados emprestados | implementado | arquitetura vem do detector; energia e refrigeração não medidas ficam `unverified`; seleção incompatível é rejeitada |
| Manifesto multiplataforma | implementado, ativos pendentes | schema v2 possui artefatos independentes para `darwin-arm64`, `win32-x64` e `linux-x64` e valida inventário/caminhos/permissões |
| Pipeline de mídia sintética real | implementado | FFmpeg/ffprobe sem shell, grupos canônicos, decode/BGR/encode/escrita/leitura/frame; estágio indisponível sem ativo |
| Jobs, Steps, Agents e dashboard isolados | implementado | esquema, concorrência configurada, transições e consultas equivalentes no SQLite temporário |
| RTSP local real | implementado com gate de ativo | MediaMTX em porta dinâmica de `127.0.0.1`; fica indisponível sem binário verificado |
| Rede física e reserva de 20% | implementado | loopback medido separadamente; capacidade externa vem somente de velocidade/duplex negociados |
| Telemetria CPU/RAM/disco/memória | implementado | amostras do sistema e disco real por fase |
| GPU/temperatura/throttling | parcial e fail-closed | NVIDIA/sistema podem enriquecer diagnóstico; somente probe aprovado satisfaz qualificação |
| Evidência terminal antes da limpeza | implementado | sucesso, falha, cancelamento e encerramento preservam pacote compacto de até 10 MB |
| Recuo sem contaminação da evidência | implementado | tentativas altas reprovadas ficam no histórico; somente as 12 fases finais aprovadas alimentam capacidade |
| Variação máxima de 10% | implementado | variação de capacidade e métricas repetidas reprova o gate comercial |
| Clusters somente para planejamento | implementado | limite medido restringe cada nó; mais de uma máquina força `planning_only` |
| Zero egress durante calibração | implementado | kernel loopback-only, refresh externo e abertura de URL bloqueados enquanto a sessão está ativa |
| Qwen Core/Core Max local real | bloqueado externamente | modelos GGUF/mmproj aprovados e redistribuíveis ainda não foram fornecidos |
| Estrutura do runtime nos instaladores | implementado | DMG macOS, AppImage Linux x64 e portátil Windows x64 construídos; manifesto e contratos inspecionados nos três pacotes |
| Ativos aprovados nos instaladores | bloqueado externamente | binários/modelos ainda ausentes; provisionador exige licença e SBOM reais por hash e não aprova o manifesto automaticamente |
| Três repetições físicas em três plataformas | bloqueado externamente | requer Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64 de referência |

## Invariante de honestidade

Uma etapa só recebe `evidenceStatus: measured` quando o kernel realmente a executa
e mede naquela sessão. Stub determinístico pode testar filas e orquestração, mas
nunca satisfaz inferência local, pipeline completo ou elegibilidade de compra.
Capacidade derivada de CPU/RAM não é resultado de calibração.
