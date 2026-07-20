# Implementação — seleção local do Qwen textual

## Diário

- Branch isolada criada a partir de `c112f83`.
- Escopo corrigido por orientação do usuário: nenhuma alteração no Perceptrum.
- Inventário e execução local confirmaram o Qwen3-32B textual como melhor modelo aplicável ao Qual Hardware.
- A leitura integral de um GGUF foi substituída por SHA-256 em streaming, evitando alocar 19,76 GB para verificação.
- O `llama-cli` atual mostrou comportamento conversacional incompatível com automação. A execução passou a usar `llama-server` temporário em `127.0.0.1`, carregado uma única vez por lote.
- O bundle ganhou metadados opcionais para modelo, parâmetros, quantização, tamanho, perfil e origem da seleção, preservando bundles antigos.
- O GitHub Actions mantém o Qwen3-1.7B fixado e agora declara também sua identidade e checksum no ambiente.
- A execução real classificou corretamente um Intel Core Ultra 9 285H e o servidor foi encerrado sem processo residual.
