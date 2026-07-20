# Especificação — Qwen textual local

## Seleção

1. Respeitar `QWEN_MODEL_PATH` quando fornecido explicitamente.
2. Caso contrário, procurar arquivos Qwen GGUF em diretórios de modelos conhecidos e em `QWEN_MODEL_SEARCH_PATHS`.
3. Ignorar `mmproj` e arquivos que não sejam GGUF Qwen.
4. Rejeitar modelos que excedam 68% da memória física, preservando espaço para runtime, contexto e sistema.
5. Ordenar primeiro pela quantidade de parâmetros e depois pela qualidade de quantização e tamanho.
6. Calcular SHA-256 por streaming somente para o modelo selecionado.

## Execução

- Detectar `llama-cli` pelo ambiente ou pelo `PATH`.
- Executar em turno único, sem shell e com limite de tempo e saída.
- Temperatura zero, `/no_think` e JSON Schema.
- Registrar modelo, hash, tamanho, parâmetros, quantização, origem da seleção e versão do prompt.

## Segurança da publicação

- Se `QWEN_MODEL_SHA256` estiver definido, o arquivo deve ter exatamente esse hash.
- O workflow oficial definirá o checksum do modelo fixado.
- Caminhos locais nunca entram no bundle.
- Campos numéricos de decisão continuam proibidos na resposta da IA.

## Compatibilidade

- Descoberta usa APIs Node portáveis e separador de caminhos nativo.
- Caminhos padrão são condicionais por sistema; nenhum caminho de usuário é compilado no aplicativo.
- Bundles antigos com os quatro campos atuais continuam válidos; os novos metadados são opcionais.
