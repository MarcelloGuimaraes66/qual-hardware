# Memória — calibração completa CPU/GPU e pipeline

## Estado entregue

- Qual Hardware inicia Perceptrum em um clique, acompanha progresso, importa o resultado e recalcula previsões.
- O resultado 1.1 é aditivo e o formato 1.0 permanece aceito.
- SQLite v5 adiciona apenas sessões; bancos e projetos existentes permanecem intactos.
- JSONs ficam em `Documentos/Qual Hardware/Calibracoes`, são append-only e possuem checksum canônico; checksums legados continuam importáveis.
- A interface mostra veredito, FPS RTSP/AiQ separados, fases, CPU/GPU/RAM/SSD/rede, etapas, sensores, motivos de indisponibilidade, caminho, checksum e JSON completo.

## Decisões que devem ser preservadas

- Ausência de sensor é `null`/`unavailable`, nunca zero inventado.
- Teste rápido é somente diagnóstico.
- Âncora local exige teste completo, hardware exato, pipeline de produção, scheduler, fila/frames/inferência aprovados e zero rede externa/OpenAI.
- Callback nunca precede a gravação do arquivo.
- Handoff é somente loopback, expira, usa token de uso único e não persiste o segredo.
- Resultados e evidências nunca são removidos automaticamente.
- O operador pode usar **Interromper e guardar parcial**. O arquivo `.partial.json` é append-only, aparece como diagnóstico inválido e nunca entra em recomendação de compra.

## Continuidade

- Windows 11 e Ubuntu usam o mesmo contrato e código; validar fisicamente drivers e sensores quando as máquinas estiverem disponíveis.
- Distribuir aos testadores o manual PDF v1.4 do pacote Perceptrum.
- A sessão física completa de 18/19 de julho foi interrompida aos 54% por decisão do operador; o parcial foi preservado e não é âncora.
- Calibrações extrapoladas continuam `reference_only` até existirem âncoras físicas e benchmarks públicos suficientes.
