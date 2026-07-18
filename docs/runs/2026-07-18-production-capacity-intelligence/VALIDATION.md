# Validação — inteligência de capacidade e evidências

Data: 2026-07-18
Host executado: macOS 26 arm64, Apple Silicon

## Evidência executada

- `npm ci`: aprovado com Node 24 e lockfile único.
- `npm audit --audit-level=low`: zero vulnerabilidades.
- Typecheck cliente/servidor e build Vite/TypeScript: aprovados.
- Vitest: 45 testes aprovados em sete arquivos.
- Regressões novas aprovadas: três âncoras para classe A, rejeição de evidência representativa, erro/margem por estágio, cotação vencida excluída, snapshot público antigo recusado, histórico de sucesso/falha e preservação da base ativa.
- Relatórios PDF/XLSX/JSON 2.3 gerados. PDF A4 com oito páginas foi extraído e inspecionado visualmente; a narrativa aparece antes dos dados técnicos, diferencia os dois FPS e contém acentos legíveis.
- `desktop:package:dir` e smoke do Electron aprovados em darwin/arm64, incluindo API loopback, UI, catálogo, cálculos, relatórios, SQLite, persistência e instância única.
- DMG `Qual-Hardware-0.1.0-macos-arm64.dmg` gerado; binário Mach-O arm64. SHA-256: `e773d0cf547645bfc25f66c4b8a6ccb00749edfcb02143e0925b8f5909564f81`.
- ASAR contém entrypoint desktop, schema SQLite e contratos v1/v2; não contém servidor standalone nem worker contínuo.
- Inventário atual do Perceptrum: 575 arquivos, 25.577.579 bytes, hash `bbf94e2bae63f146734ae4e635e1078bd7631d2ec1855e322cb4061c6e5539a0`.

## Limites honestos

- O snapshot público real precisa ser curado e assinado pela organização; o aplicativo não inventa scores nem faz scraping ao vivo. Sem cobertura, a máquina permanece `reference_only`.
- As primeiras três a cinco calibrações físicas ainda precisam ser coletadas pelos usuários com o manual. Até lá não existe classe A baseada em evidência real.
- Windows 11 e Ubuntu têm código, empacotamento e matriz nativa preparados, mas a homologação física permanece futura e não é substituída por testes executados no Mac.
