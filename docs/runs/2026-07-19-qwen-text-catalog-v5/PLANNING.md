# Planejamento — seleção local do Qwen textual

## Classificação e objetivo

- Risco T4, porque a classificação auxilia a formação do catálogo usado pelo dimensionamento comercial.
- Ajustar somente o Qual Hardware para usar o melhor Qwen textual GGUF disponível no computador.
- Não alterar o Perceptrum, seus modelos, seu banco, sua configuração ou seus processos.

## Fatos verificados

- O Mac é um MacBook Pro Apple M4 Max, com 36 GB de memória unificada.
- Existe um `Qwen3-32B-Q4_K_M.gguf` de 19.762.149.024 bytes, executável pelo llama.cpp local.
- O modelo declarou modalidade textual e tem SHA-256 `efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689`.
- O publicador estava limitado ao `Qwen3-1.7B-Q8_0`, inclusive no schema.
- O Qwen do Qual Hardware apenas classifica e normaliza evidências; números de preço, capacidade e recomendação são proibidos.

## Invariantes

- Nenhum valor numérico de benchmark, preço ou capacidade será criado pela IA.
- O pipeline determinístico continuará validando schema e trecho literal de evidência.
- O GitHub Actions continuará usando o modelo pequeno fixado e seu checksum até que outro artefato seja deliberadamente fixado no runner.
- Bundles registrarão o modelo realmente usado; nunca registrarão caminho absoluto local.
- Windows, macOS e Ubuntu usarão a mesma implementação TypeScript.

## Raio de impacto e orçamento

- Um módulo de descoberta/seleção de modelo.
- Runner llama.cpp e comando do publicador.
- Metadados e schema aditivos do bundle.
- Um comando de diagnóstico, testes e documentação.
- Sem mudanças no motor de capacidade, SQLite, Perceptrum ou interface de calibração.

## Validação

- Testes unitários da seleção, reserva de memória e rejeição de projetores.
- Typecheck, testes completos e build.
- Diagnóstico real deve selecionar o Qwen3-32B neste Mac.
- Inferência curta real deve terminar sem modo interativo e produzir JSON válido.

## Rollback

- Reversão integral dos commits desta branch.
- Nenhum dado persistido ou modelo será removido.
