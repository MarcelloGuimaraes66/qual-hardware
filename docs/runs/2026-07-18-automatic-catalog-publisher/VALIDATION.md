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

- Matriz nativa Windows/macOS/Ubuntu no GitHub.
- Dry-run do workflow, primeira Release assinada e smoke consumindo a Release.

Primeira execução remota: macOS aprovado; Windows compilou/empacotou e revelou que a saída do utilitário ASAR usa `\\` naquele sistema. O smoke foi corrigido para normalizar separadores antes de inspecionar o conteúdo e precisa ser reexecutado. A falha não ocorreu dentro do aplicativo.

Este arquivo será finalizado com links/hashes concretos após os gates externos. A homologação física Windows 11 e Ubuntu GNOME/Wayland continua separada da prova de compilação/CI.
