# RESEARCH — fontes e limites operacionais

## Referências primárias

- GitHub Actions `schedule`: executa a partir do branch padrão, pode sofrer atraso e pode ser desabilitado em repositório público inativo: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>.
- GitHub Releases REST: enumeração pública e assets versionados: <https://docs.github.com/en/rest/releases/releases>.
- Qwen GGUF oficial: <https://huggingface.co/Qwen/Qwen3-1.7B-GGUF>.
- Execução local Qwen com llama.cpp: <https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html>.
- Assinatura Ed25519: API `node:crypto`, sem dependência nativa adicional.

## Decisões

- Cron em `17 7 * * *`, equivalente a 03:17 em Manaus, que não adota horário de verão.
- O cron roda diariamente; a função determinística `isPublicationDue` decide se passaram 15 dias.
- Releases `catalog-AAAA-MM-DD.N` e diretórios de mesmo nome em `catalog-data` são imutáveis.
- A IA somente classifica e normaliza candidatos com evidência textual; todos os números, moedas, gates e publicação são determinísticos.
- Coleta respeita TLS, allowlist, redirects, tamanho, tipo, robots, limites e indisponibilidade por CAPTCHA/login.
- O desktop usa apenas a API pública do GitHub, chave compilada e ETag; nenhuma credencial é necessária.

## Limitações de ambiente

- O macOS pode ser homologado fisicamente neste computador.
- Windows e Ubuntu serão comprovados por runners nativos; homologação física final permanece um gate de release do produto.
- Fontes que proíbem automação ou exigem proteção interativa permanecem registradas como indisponíveis, sem contorno.
