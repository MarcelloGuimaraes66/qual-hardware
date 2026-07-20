# Validação — seleção local do Qwen textual

## Resultado

- `npm ci`: 462 dependências instaladas, auditoria com zero vulnerabilidades.
- `npm run typecheck`: aprovado.
- `npm test`: 11 arquivos e 88 testes aprovados.
- `npm run build`: aprovado.
- `npm run desktop:package:dir`: pacote macOS arm64 gerado.
- `npm run desktop:smoke`: aprovado; dados temporários removidos pelo próprio smoke.
- `npm run catalog:qwen:detect`: selecionou Qwen3-32B Q4_K_M e `llama-server` 9820.

## Prova real do modelo

- Arquivo: `Qwen3-32B-Q4_K_M.gguf`.
- Tamanho: 19.762.149.024 bytes.
- SHA-256: `efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689`.
- Papel: classificação textual e normalização de nomes.
- Inferência real: classificou `Intel Core Ultra 9 285H` como CPU Intel/Arrow Lake e citou o trecho literal fornecido.
- Transporte: exclusivamente `127.0.0.1`.
- Estado final: nenhum `llama-cli` ou `llama-server` residual.

## Não regressão

- O Perceptrum não foi alterado.
- Nenhum banco, modelo ou evidência foi movido, substituído ou apagado.
- O workflow público continua com modelo e hash fixos.
- Windows e Ubuntu usam a mesma descoberta por `PATH`, extensão nativa e separador de diretórios; a execução nativa continuará sendo comprovada pela matriz CI quando esta branch for integrada ao branch padrão.
