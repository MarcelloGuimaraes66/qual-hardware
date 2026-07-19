# Pesquisa — fontes, licenças e limites de inferência

## Fontes primárias aprovadas

- SPEC CPU 2017: resultados públicos de sistemas e regras de divulgação; ferramentas licenciadas não serão redistribuídas.
- MLCommons Inference v6: resultados, descrições de sistemas e workloads comparáveis, incluindo Qwen3-VL quando modelo, precisão, backend e cenário coincidirem.
- NVIDIA Video Codec SDK: matriz funcional de codecs, gerações e limites de sessões; não substitui throughput sustentado.
- Intel oneVPL, AMD AMF e Apple VideoToolbox: suporte funcional de decode/encode.
- STREAM: largura de banda de memória com regras explícitas de execução.
- fio: throughput, IOPS, latência e fila do armazenamento.
- OpenBenchmarking: perfis reproduzíveis para STREAM, fio, FFmpeg e OpenCV com configuração completa.
- Blender Open Data: indicador secundário de compute; nunca evidência de AiQ/Qwen.

## Limites comprovados

- Especificação oficial prova compatibilidade, não desempenho sustentado no chassi real.
- Nenhuma suite pública substitui Jobs, Steps, Agents, Intelligence, SQLite, dashboard ou a térmica integral do Perceptrum.
- Resultados públicos relacionam hardwares; somente calibrações físicas convertem essa relação em câmeras.
- Resultados pagos ou cuja licença não autorize redistribuição integral não serão copiados. PassMark completo permanece fora da base sem licença comercial.
- Um componente de suporte não recebe score artificial. Fonte, chassi e refrigeração exigem capacidade oficial e validação do sistema completo.

## Critério de elegibilidade

Uma observação numérica somente entra no cálculo quando possui SKU exato, suite e versão, perfil, unidade, direção, agregação, configuração do sistema, OS/driver, potência/refrigeração quando aplicável, localização da evidência e SHA-256 do artefato bruto.

Marketing, overclock não equivalente, resultado anônimo, unidade ambígua, configuração incompleta ou workload incompatível ficam preservados como `reference_only`.

## Estratégia de coleta

- Conectores baixam apenas hosts cadastrados e artefatos autorizados.
- O artefato bruto é identificado por hash antes da transformação.
- Parsers determinísticos geram observações normalizadas e relatórios de rejeição.
- Qwen pode sugerir a correspondência de nomes com trecho literal, mas não cria nem confirma valores.
- Fixtures derivadas das estruturas públicas exercitam cada parser sem tornar a suíte dependente da disponibilidade externa.
