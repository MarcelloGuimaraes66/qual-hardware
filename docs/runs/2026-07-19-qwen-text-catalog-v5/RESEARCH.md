# Pesquisa — modelos Qwen locais

## Inventário relevante

| Modelo | Tamanho | Modalidade | Papel adequado |
|---|---:|---|---|
| Qwen3-32B Q4_K_M | 19,76 GB | texto | classificação e normalização do catálogo |
| Qwen3-4B Q4_K_M | 2,50 GB | texto | fallback textual |
| Qwen3-VL-2B Q4_K_M + mmproj | 1,93 GB | visão e texto | Perceptrum; fora do escopo desta mudança |

O llama.cpp local é a versão 9820, compilada para Darwin arm64. O Qwen3-32B foi carregado com sucesso no Apple M4 Max e declarou `modalities = text`.

## Decisão

O Qual Hardware não precisa de visão. Ele consumirá as calibrações criadas pelo Perceptrum e usará IA local somente para classificar páginas e conciliar nomes. Portanto, o Qwen3-32B é o melhor modelo instalado para esta responsabilidade.

O modelo maior não será usado como benchmark do AiQ nem como substituto da calibração do Perceptrum. Sua escolha não altera diretamente nenhuma quantidade de câmeras.

## Limitação operacional

O workflow público continuará fixado no Qwen3-1.7B porque o runner baixa esse artefato reproduzível. A execução local pode selecionar o 32B automaticamente e registra o hash exato. Trocar o modelo do runner público é uma decisão separada de custo de download, tempo de job e reprodutibilidade.
