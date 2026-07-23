# Implementação — calibração autônoma

Data: 2026-07-21

## Implementado

- Worker thread interno, serviço de ciclo de vida, cancelamento e encerramento gracioso.
- Fingerprint conservador de CPU, GPU, memória, sistema operacional e formato físico.
- Preflight de hardware na interface, incluindo CPU, núcleos, RAM, GPU/VRAM, sistema e links físicos de rede disponíveis.
- Perfil canônico sem IDs de interface e com proporções de grupos de câmeras.
- Controladores de descoberta adaptativa, recuo, fases e três repetições.
- Manifesto offline v2 com inventário separado para `darwin-arm64`, `win32-x64` e `linux-x64`, hash em streaming, tamanho, versão, licença, SBOM e aprovação explícita.
- Feature modes `disabled`, `diagnostic` e `full` para rollback e promoção controlada.
- Extensão SQLite v9 aditiva e transacional, backup único verificado e fallback que desabilita somente a calibração se a extensão falhar.
- Sessões/eventos/runs/tiers/avaliações append-only, commit atômico e rejeição de duplicatas.
- APIs internas de sessão, cancelamento, status, retry de limpeza e avaliações de capacidade.
- Integração exata por hardware, sistema, perfil, build, kernel e manifesto no recomendador.
- Interface com disponibilidade, nível, repetição, métricas, bytes removidos e retry.
- Empacotamento do contrato de autoridade e do manifesto do runtime.
- Pipeline real de mídia sintética com FFmpeg/ffprobe, composição canônica dos grupos, decode, BGR, encode, escrita, leitura e extração de frame.
- MediaMTX em porta dinâmica de `127.0.0.1`, um publisher por grupo e uma entrada RTSP real por câmera lógica quando o ativo está disponível.
- Runtime SQLite isolado com transições e persistência equivalentes de Jobs, Steps, Agents, Intelligence, comandos, métricas e consultas do dashboard.
- Inferência local Core/Core Max por `llama-server`, GGUF e `mmproj` verificados, recebendo somente o frame sintético por loopback.
- Medição real de CPU, RAM, largura de banda de memória, espaço de disco e, quando exposta, GPU/VRAM/temperatura; somente o probe empacotado aprovado satisfaz o guardrail térmico comercial.
- Avaliação da rede física por velocidade negociada e duplex com reserva de 20%, sem apresentar tráfego loopback como medição do enlace externo.
- Rastreamento dos PIDs filhos e encerramento controlado antes da limpeza em sucesso, erro, cancelamento e fechamento do aplicativo.
- Evidência compacta de sucesso e diagnóstico compacto de falha/cancelamento/interrupção, ambos append-only, fora da raiz temporária e limitados a 10 MB.
- Fluxo legado mantido apenas como código de recuperação; removido da ponte ativa do desktop e do caminho do botão.
- Gate comercial calculado e testável: considera somente as 12 medições da tentativa final aprovada, sem misturar descoberta ou tentativas reprovadas de níveis superiores.
- Variação entre repetições calculada sobre capacidade e métricas físicas repetidas (latências, CPU, GPU, memória, entrega e inferência), com reprovação acima de 10%.
- Qualificação comercial exige simultaneamente CPU, RAM, disco, largura de banda de memória, GPU, VRAM, temperatura, throttling, rede física e todos os estágios do pipeline em cada fase final.
- O recomendador reutiliza uma calibração somente quando kernel e hash do manifesto atual também coincidem; troca de runtime invalida o uso da evidência anterior.
- Capacidade medida restringe cada máquina, mas qualquer solução com mais de um nó permanece `planning_only` até validação física de cluster.
- Atualizações externas do catálogo e abertura de URLs ficam suspensas durante uma sessão, e o kernel mede backlog de inferência além das filas do banco.
- O fingerprint nunca copia arquitetura, perfil de energia ou refrigeração do catálogo: esses campos são detectados ou permanecem `unverified`.
- Uma máquina selecionada na interface só é vinculada à run quando CPU, GPU, núcleos, memória, quantidade de GPUs, sistema e formato físico coincidem; divergência rejeita a sessão antes da persistência comercial.
- A qualificação completa exige um perfil de máquina selecionado; o worker repete a conferência física no preflight e aborta antes da carga se houver divergência.
- Executáveis empacotados precisam de permissão de execução no macOS/Linux; caminhos absolutos, travessia, IDs duplicados, alvo não suportado e inventário incompleto são recusados no preflight.
- Licença e SBOM deixaram de ser apenas textos declarativos: cada artefato precisa incluir evidências empacotadas, confinadas e verificadas por SHA-256.
- Um provisionador offline em modo dry-run por padrão prepara os nove ativos, cria backup do manifesto e só grava com `--apply`, sem downloads ou aprovação automática.

## Diagnóstico honesto

O kernel executa hoje o pipeline local equivalente por contrato, mas o repositório ainda não contém os binários/modelos redistribuíveis aprovados. No pacote atual, FFmpeg do sistema pode produzir evidência diagnóstica, enquanto MediaMTX, Qwen e o probe térmico aprovado permanecem indisponíveis. Cada estágio só recebe `measured` quando de fato rodou. O resultado atual mantém capacidade nula, pipeline incompleto e elegibilidade de compra falsa. O gate não é um bloqueio fixo: ele está implementado e coberto por testes positivos e adversariais, mas permanece legitimamente falso com os ativos atuais.

O modo `full` permanece fechado por gates cumulativos: mapa de hashes de manifestos aprovados vazio, ativos sem metadados/hashes redistribuíveis e ausência do probe e dos modelos autorizados. O manifesto já identifica o pipeline implementado como `perceptrum-equivalent-v1`, mas essa identidade isoladamente não promove o runtime. Não existe caminho de promoção acidental pela interface.

## Rollback

- A `main` original permanece no commit de origem e sem alterações do trabalho.
- A mudança está isolada em `codex/calibracao-autonoma-qual-hardware`.
- `QUAL_HARDWARE_CALIBRATION_FEATURE=disabled` bloqueia todos os lançamentos.
- O modo padrão permite somente diagnóstico; o modo completo ainda não pode passar os gates de ativos e manifesto.
- Tabelas e imports legados permanecem preservados.
