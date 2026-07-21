# Projeto técnico

## Escritor de PDF

- `line`: títulos, listas, métricas e URLs, sem justificação forçada.
- `paragraph`: texto corrido com justificação somente nas linhas intermediárias.
- Tokens longos são quebrados de forma segura para impedir URLs fora da página.
- O núcleo histórico do relatório não recebe IDs de banco nem a lista completa dos quinze estágios.
- A auditoria completa é preservada no caderno técnico.

## Fontes oficiais

- O registro liga a URL exata ao componente canônico; não existe associação aproximada.
- AMD utiliza a lista de definição do produto.
- NVIDIA utiliza a tabela do produto, o documento Blackwell e o Video Codec SDK.
- Cada valor conserva URL, localização, hash SHA-256, data, rótulo e valor originais.
- O parser de codec somente produz campos quando os codecs e plataformas aparecem literalmente no documento.

## Segurança da coleta

- HTTPS obrigatório.
- Hosts e redirecionamentos em allowlist.
- `robots.txt` obrigatório para HTML.
- Limite de tamanho e tempo.
- CAPTCHA, login e bloqueio interativo reais são rejeitados.
- O cabeçalho `From` identifica o repositório do coletor.
- Qwen não extrai nem decide números.

## Compatibilidade

As alterações são TypeScript puro e usam `fetch`/Electron/Node já suportados. Não há caminhos, comandos ou binários específicos de macOS adicionados ao runtime, portanto o mesmo código permanece compilável em Windows e Ubuntu.
