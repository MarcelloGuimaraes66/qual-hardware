# Especificação — Qual Hardware Calibration Kernel

Data: 2026-07-21

## Invariantes

1. O botão inicia somente um worker interno do Qual Hardware.
2. O aplicativo ativo não oferece ponte para abrir o Perceptrum no fluxo de calibração.
3. Nenhum banco, arquivo, mídia, câmera ou credencial do Perceptrum participa.
4. Chamadas externas e chamadas à OpenAI devem permanecer em zero.
5. Perfil, build, kernel e manifesto devem coincidir exatamente antes de uma previsão medida ser utilizada.
6. Três repetições completas, variação máxima de 10% e todos os guardrails são obrigatórios para elegibilidade de compra.
7. A execução e seus eventos são append-only; duplicatas de resultado são rejeitadas.
8. O resultado é persistido antes da limpeza e a interface só chega a 100% depois de `cleanup_completed`.
9. Tentativas reprovadas são preservadas, mas nunca participam dos agregados comerciais da tentativa final aprovada.
10. Uma calibração por máquina não autoriza multiplicação automática para cluster.
11. Uma qualificação completa exige vínculo explícito a um perfil do catálogo e interrompe no preflight se o hardware medido divergir.

## Contratos

- Kernel: `qual-hardware-calibration-kernel/1.0.0`.
- Plano: `qual-hardware-calibration-plan/2.0.0`.
- Resultado: `qual-hardware-local-calibration/3.0.0`.
- Manifesto de runtime: `qual-hardware-calibration-runtime-manifest/2.0.0`.
- Autoridade: `d918faa0ecd6a9906b711039e5d89f78e0536c44`.
- Níveis: 1, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048 e 4096.
- Descoberta: 30 segundos de estabilização e 90 segundos de amostra.
- Qualificação: warmup, ramp, sustained e surge, três repetições e descanso de dez minutos.

## Perfil canônico

O perfil inclui build, contrato, sistema operacional, proporção de cada grupo de câmeras, codec, resolução, FPS, bitrate, decode, movimento, armazenamento, configuração semântica dos Agents e cargas concorrentes. IDs e nomes de interface são excluídos; grupos e Agents são ordenados canonicamente.

## Limpeza

- Raiz: diretório temporário do sistema mais `qual-hardware-calibration`.
- Sessão: UUID filho direto da raiz.
- Arquivos mutáveis são predeclarados antes de serem escritos.
- Recuperação pode recalcular hash somente de nomes previamente registrados.
- Entrada estrangeira, link simbólico, UUID inválido, manifesto ausente/adulterado ou caminho externo bloqueia a remoção.
- Evidência compacta permanente fica fora da raiz temporária e é limitada a 10 MB.
- Falhas, cancelamentos e interrupções preservam apenas agregados diagnósticos; nunca mídia sintética ou telemetria bruta.

## Rede e telemetria

- RTSP e concorrência de streams são medidos somente em loopback.
- O enlace externo é avaliado separadamente por velocidade negociada e duplex; a capacidade utilizável aplica reserva de 20%.
- GPU e temperatura podem ser exibidas como diagnóstico por ferramentas do sistema, mas apenas um `telemetry-probe` empacotado, assinado pelo manifesto e verificado por hash satisfaz o gate térmico.
- Sensor indisponível permanece `unavailable` e bloqueia a elegibilidade comercial.

## Gate comercial

O modo completo depende cumulativamente de feature flag `full`, manifesto aprovado no código, pipeline `perceptrum-equivalent-v1`, metadados de versão/licença/SBOM/tamanho, hashes aprovados e todos os ativos empacotados. A execução ainda exige três repetições aprovadas e variação de no máximo 10%; concorrência exata; todas as fases e estágios; CPU/RAM/disco/memória; GPU/VRAM; temperatura e throttling por probe aprovado; enlace físico suficiente com reserva de 20%; e zero requisição externa. O recomendador volta a conferir kernel e manifesto do runtime atual. O estado atual é propositalmente diagnóstico e não produz capacidade do Perceptrum.

Cada ativo do manifesto possui caminhos, tamanhos e hashes próprios para macOS arm64, Windows x64 e Linux x64. O preflight exige o inventário exato dos nove ativos, contratos dourados íntegros, caminhos relativos confinados, executáveis realmente executáveis no Unix e plataforma/arquitetura suportadas.
