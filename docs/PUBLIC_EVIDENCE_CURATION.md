# Curadoria da base pública de componentes e benchmarks

## O que a base representa

O inventário público é uma biblioteca ampla e atualizável de CPUs, GPUs, OEMs, memória, armazenamento e rede. Estar no inventário não transforma um componente em recomendação. O Qual Hardware só calcula capacidade de compra quando o componente possui evidência compatível com uma etapa real do Perceptrum e quando há calibrações físicas elegíveis para corrigir o benchmark público.

O aplicativo não faz scraping ao vivo. O publicador central produz um snapshot `qual-hardware-evidence-catalog/4.0.0`, valida cada registro por regras determinísticas e o assina com Ed25519. A importação preserva todos os snapshots anteriores, ativa o novo conjunto apenas depois de validar schema, assinatura e ordem cronológica e registra um histórico compreensível para o operador.

## Fontes aceitas por prioridade

1. Especificações oficiais do SKU em Intel ARK, AMD Product Specifications, NVIDIA Product Specifications e Apple Technical Specifications.
2. Resultados reproduzíveis de MLCommons, OpenBenchmarking/Phoronix Test Suite, Blender Open Data e SPEC CPU, respeitando versão, unidade e regras de uso de cada fonte.
3. Laboratórios independentes somente quando publicarem SKU exato, sistema, potência, driver, refrigeração, memória, versão do teste, número de repetições e resultado sustentado.

Marketing isolado, score anônimo, overclock não equivalente, resultado sem driver/potência ou comparação entre versões incompatíveis é rejeitado. A preferência comercial Intel, depois AMD, e a preferência técnica NVIDIA são critérios de ordenação e diversidade; nunca substituem capacidade comprovada por etapa.

## Mapeamento obrigatório para o pipeline

Cada observação identifica um único estágio entre os quinze do workload 3.1: ingestão RTSP, decode, BGR/movimento, encode, escrita, leitura, extração de quadros, inferência Qwen local, largura de memória, rede, Jobs, Intelligence, persistência do banco, consultas de dashboard e sustentação térmica. O registro inclui componente, benchmark, versão, perfil, unidade, direção do score, sistema, configuração, data, URL, localização da evidência, checksum do artefato e sinalizadores de reprodutibilidade.

## Estado auditado em 19 de julho de 2026

O dry-run público desta refatoração registrou 218 componentes derivados dos 21 sistemas históricos e importou 18 observações numéricas: duas divulgações SPEC CPU 2017 elegíveis para o estágio de CPU e 16 resultados MLPerf Inference v6 preservados como referência. Os resultados MLPerf usam Qwen3-VL 235B, não o Qwen visual 2B/4B do Perceptrum; por isso o sistema os rejeita para `local_inference`. Foram encontrados zero benchmarks órfãos e zero componentes qualificados para aquisição, situação correta enquanto não existirem as três calibrações físicas completas mínimas.

Os artefatos auditáveis ficam em `docs/runs/2026-07-19-definitive-component-evidence-v4/public-evidence-dry-run/`. O coletor armazena hash, fonte e configuração; não redistribui as ferramentas licenciadas do SPEC. MLCommons é lido a partir do repositório público de resultados, e Qwen não extrai nem decide valores numéricos.

Não é permitido usar um score de CPU para preencher GPU, disco ou rede. Para NVIDIA, NVDEC/NVENC oficial complementa — mas não substitui — a medição sustentada do Perceptrum. Para inferência, o benchmark precisa usar o modelo e backend comparáveis ao AiQ/Qwen local. FPS RTSP e FPS de inferência permanecem métricas diferentes.

## Processo de publicação

1. Montar o JSON novo sem modificar snapshots históricos. O coletor quinzenal faz isso automaticamente para fontes públicas aprovadas; a ferramenta manual existe apenas para homologação e recuperação.
2. Validar SKU, versão, unidade, configuração e licença/uso da fonte.
3. Executar `npm run evidence:sign -- --input entrada.json --output evidencia-assinada.json --private-key chave.pem`.
4. Importar primeiro em ambiente de homologação e conferir o resumo de componentes, observações, fontes e diferenças.
5. Recalcular previsões e executar validação cruzada retirando uma âncora por vez.
6. Publicar o snapshot como ativo somente se nenhuma previsão de classe A superestimar a máquina retirada após a margem.

A ferramenta de assinatura recusa sobrescrever o arquivo de entrada ou um destino existente. A chave privada fica fora do repositório e do aplicativo.

## Confiança e margem

- Classe A exige três execuções físicas elegíveis de três hardwares distintos e fortemente comparáveis. A reserva é o maior valor entre 20%, pior superestimação observada e variabilidade das repetições.
- Classe B exige dois hardwares distintos fortemente comparáveis. A reserva usa o maior valor entre 30% e o erro empírico.
- Classe C usa no mínimo 40% e permanece `reference_only`.
- Sem cobertura por estágio, o sistema não publica número de compra.

Uma máquina nunca testada pode ser `extrapolated_high`; ela nunca recebe o rótulo `validated_local`. Todas as recomendações apresentam intervalo, âncoras, fontes, gargalo e margem para que a decisão permaneça auditável.
