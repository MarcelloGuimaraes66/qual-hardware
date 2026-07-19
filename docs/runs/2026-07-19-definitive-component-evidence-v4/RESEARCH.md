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

## Varredura real das fontes cadastradas

Em 19 de julho de 2026, a varredura das onze fontes de benchmark ativas produziu 22 observações: 16 MLPerf, quatro Blender e duas SPEC. As quatro páginas OpenBenchmarking retornaram exigência de acesso interativo; a página AMD excedeu o timeout; NVIDIA, Intel e Apple responderam, mas não expuseram uma série numérica determinística utilizável pelos parsers atuais. O gate de saúde bloqueou corretamente a construção do snapshot, pois mais de 20% das fontes ativas falharam. Os arquivos estão em `public-benchmark-source-scan/`.

Consequência: STREAM, fio, FFmpeg, OpenCV e throughput sustentado de codecs continuam dependendo de conectores oficiais estruturados ou das medições físicas padronizadas. Nenhum zero, score genérico ou número inferido foi criado para preencher essas lacunas.
