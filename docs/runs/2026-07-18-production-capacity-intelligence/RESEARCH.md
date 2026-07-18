# Pesquisa — benchmarks, preços, relatórios e dados

Data: 2026-07-18

## Evidência pública

Prioridade adotada:

1. especificações oficiais Intel ARK, AMD, NVIDIA e Apple;
2. MLPerf Inference para inferência reproduzível;
3. SPEC CPU2017 para CPU sustentada;
4. OpenBenchmarking para FFmpeg, armazenamento e memória com perfil/versionamento;
5. Blender Open Data somente como proxy de GPU quando explicitamente marcado, nunca como prova de Qwen;
6. matriz oficial NVIDIA Video Codec SDK para NVDEC/NVENC.

Uma observação deve identificar componente exato, etapa, perfil, versão, unidade, direção, sistema, potência, driver, refrigeração e URL. Falta de configuração reduz confiança ou rejeita a observação. Um score genérico não pode provar decode, inferência, disco, rede ou térmica ao mesmo tempo.

## Extrapolação

A regra de três é aplicada por estágio:

`capacidade alvo = capacidade física da âncora × índice alvo ÷ índice âncora`

Quando menor é melhor, a razão é invertida. Entre âncoras válidas usa-se a previsão conservadora. O erro leave-one-out é medido por estágio e estrato, dando peso maior à superestimação. A reserva efetiva é o máximo entre o piso da classe, a superestimação empírica, a variabilidade das repetições e a penalidade de distância arquitetural.

Com até cinco computadores não existe cobertura honesta para todos os fabricantes e arquiteturas. O inventário pode ser amplo; recomendação de compra numérica é restrita a estratos cobertos.

## Preços

O desktop não deve raspar sites. Um processo curador explícito coleta páginas permitidas por MPN, normaliza moeda com taxa datada, produz snapshot e o assina. O desktop verifica assinatura e mostra diff antes de ativar.

Problemas identificados na implementação atual:

- redirecionamentos precisam ser revalidados contra a allowlist;
- IDs aleatórios prejudicam idempotência;
- conversão cambial existe separadamente, mas não é aplicada pelo coletor;
- cotações históricas não possuem associação ao snapshot ativo;
- cotações vencidas ainda influenciam mediana e podem ocultar a necessidade de cotação.

## Relatórios

A opinião executiva será calculada localmente, sem LLM: resume cenário, dois FPS, gargalo, evidência, margem e decisão entre menor custo, recomendada e expansão. O mesmo objeto narrativo alimenta PDF, primeira planilha do XLSX e JSON para impedir divergência.

## Segurança de dependências

O Qual Hardware não apresenta vulnerabilidades npm na base atual. O Perceptrum possui dívida separada; não se usará `audit fix --force`. A compatibilidade de formatos e o comportamento do produto são gates obrigatórios para qualquer atualização.
