# VALIDATION — atualização automática quinzenal

## Evidência local concluída

- `npm ci`: concluído com Node 24 e lockfile único.
- Auditoria npm: zero vulnerabilidades no momento da execução.
- Typecheck renderer/server: aprovado.
- Testes: 8 arquivos, 64 testes aprovados.
- Workflow YAML: parse válido.
- Coleta real: 39 fontes verificadas, 19 coletáveis, 20 indisponíveis sem contorno, 26 observações.
- Bundle de ensaio: 21 equipamentos, 49 componentes, 5 observações de benchmark e 12 preços em BRL/USD/EUR.
- O Qwen não foi chamado nessa coleta porque todos os candidatos aceitos foram resolvidos deterministicamente; o relatório registra `used: false`.
- Build de produção: aprovado.
- Pacote descompactado Electron 43.1.1 macOS arm64: aprovado.
- Smoke empacotado: aprovado em `darwin/arm64`, incluindo UI, loopback, SQLite v4, catálogo, cálculos, relatórios, segunda instância e persistência após reinício.
- DMG: `Qual-Hardware-0.1.0-macos-arm64.dmg`, Mach-O arm64, `hdiutil verify` aprovado, SHA-256 `284910d819f73affa76b492358c038ddb446b89da137c8ab62c0c8b9fc07225d`.

## Cobertura dos testes

- Gate de primeira publicação, antes de 15 dias, no 15º dia e retry posterior.
- Robots, CAPTCHA/login, redirect hostil, timeout/tamanho e JSON-LD.
- Qwen válido, sem evidência, campo de preço proibido, prompt injection e indisponibilidade.
- BRL/USD/EUR, MPN, outlier, validade de 18/30 dias e reconciliação.
- SHA-256, Ed25519, adulteração, sequência/cadeia, rollback e ativação atômica.
- Abertura de banco v3 e migração v4 sem perda de linha existente.

## Gates restantes antes da publicação

- Dry-run do workflow, primeira Release assinada e smoke consumindo a Release.

Primeira execução remota: macOS aprovado; Windows compilou/empacotou e revelou que a saída do utilitário ASAR usa `\\` naquele sistema. O smoke foi corrigido para normalizar separadores antes de inspecionar o conteúdo e precisa ser reexecutado. A falha não ocorreu dentro do aplicativo.

Ubuntu também compilou/empacotou, mas o Xvfb atingiu o limite de 30 segundos antes de expor o renderer após a consulta segura ao canal. O limite exclusivo do smoke foi elevado para 90 segundos e uma nova falha passará a incluir os logs do Electron. Nenhum timeout do aplicativo foi relaxado.

Segunda execução Ubuntu: os novos logs provaram que o Chromium abortou porque o `chrome-sandbox` do pacote descompactado não tinha proprietário root/modo `4755` no runner. Os workflows de CI e release agora configuram essas permissões antes do smoke Linux. Nenhum `--no-sandbox` foi introduzido; a proteção permanece obrigatória.

Matriz final da PR: Windows 11 x64 aprovado em 1m21s, macOS 26 arm64 aprovado em 58s e Ubuntu 24.04 x64/Xvfb aprovado em 49s. Execução: <https://github.com/MarcelloGuimaraes66/qual-hardware/actions/runs/29666313133>.

Primeiro dispatch de homologação após o merge foi rejeitado antes de criar uma execução porque o parser de expressões do GitHub Actions não suporta `+ 1` dentro de `${{ }}`. A sequência seguinte passou a ser calculada no shell do gate inicial e exposta como output; nenhuma coleta, assinatura ou Release ocorreu nessa tentativa.

Dry-run corrigido aprovado no `main`: gate, coleta real, validação determinística, Qwen dispensado com zero candidatos, build do bundle, validação final e health concluíram; assinatura/publicação permaneceu intencionalmente pulada. Execução: <https://github.com/MarcelloGuimaraes66/qual-hardware/actions/runs/29666520447>. As Actions auxiliares foram elevadas às versões Node 24 já usadas pelos workflows desktop para remover avisos de depreciação antes da publicação real.

Primeira tentativa assinada: assinatura do bundle, validação Ed25519 contra a chave pública compilada e assinatura/validação do relatório foram aprovadas. O upload ao branch `catalog-data` foi interrompido antes da Release porque o Base64 do bundle excedeu o limite de argumentos do shell. O workflow agora gera um JSON de requisição em arquivo e o fornece ao `gh api --input`, sem colocar o conteúdo na linha de comando. Execução: <https://github.com/MarcelloGuimaraes66/qual-hardware/actions/runs/29666684682>. Nenhuma Release foi criada nessa tentativa.

Este arquivo será finalizado com links/hashes concretos após os gates externos. A homologação física Windows 11 e Ubuntu GNOME/Wayland continua separada da prova de compilação/CI.
