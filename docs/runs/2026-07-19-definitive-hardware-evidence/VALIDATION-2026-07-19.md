# Validação — evidência definitiva de hardware

Data: 2026-07-19, macOS arm64.

## Provas executadas

- `npm ci`: 462 pacotes instalados a partir do lockfile; auditoria com zero vulnerabilidades.
- Typecheck do renderer e servidor: aprovado.
- Vitest: 9 arquivos e 77 testes aprovados.
- Build Vite + TypeScript servidor: aprovado.
- Pacote Electron 43.1.1 arm64 descompactado: aprovado.
- Smoke do desktop empacotado: aprovado, incluindo inicialização, API loopback, banco isolado, catálogo, cálculos, relatórios, persistência e encerramento.
- O smoke confirmou e removeu o diretório temporário que ele próprio criou.
- DMG `Qual-Hardware-0.1.0-macos-arm64.dmg`: checksum interno validado pelo macOS.
- Executável: Mach-O arm64.
- `git diff --check`: aprovado.

## Regressões protegidas pelos testes

- Migração aditiva v5→v6 preserva tabela/registro legado.
- Cenários legados continuam legíveis.
- Cobertura de disco, memória, schedulers, banco, dashboard e térmica é obrigatória.
- `reference_only` não expõe número comercial e fica bloqueado para compra.
- N+1 é aplicado a partir de 64 câmeras.
- Relatórios usam `capacity-recommendation-export/3.0.0` e separam opções comerciais das opções de planejamento.
- Parsers numéricos não delegam valores ao Qwen.

## Limites da evidência

- O macOS foi compilado e executado fisicamente nesta máquina.
- Windows 11 e Ubuntu 24.04 têm código comum e workflows nativos, porém não foram executados fisicamente nesta sessão macOS.
- O primeiro snapshot público assinado e o cron quinzenal dependem de integração no branch padrão e configuração do segredo Ed25519.
- Ainda não existem 3–5 calibrações completas válidas. Portanto, o sistema continua bloqueando corretamente recomendações de compra sem cobertura.
- O lint global do Perceptrum não é um gate do Qual Hardware; no Qual Hardware, typecheck/build/testes/pacote/smoke estão verdes.

## Resultado

Implementação local validada no macOS. O software está seguro para coleta de novas evidências e planejamento, mas a liberação comercial de capacidades extrapoladas permanece condicionada às âncoras físicas e ao snapshot público comparável exigidos pelo próprio gate.

## Toolchain persistente do macOS

- Node.js `24.18.0` foi definido como padrão em shells zsh novos; o Node Homebrew secundário permanece acessível fora do caminho padrão.
- Go `1.26.5`, CMake `4.2.3`, pkg-config `3.0.3`, FFmpeg/ffprobe `8.1.2`, MediaMTX `1.19.1`, PowerShell `7.6.3` e .NET `10.0.302` foram encontrados pelo `PATH`.
- OpenCV `4.14.0`, OpenVINO `2026.2.1` e nlohmann-json `3.12.0` foram encontrados por `pkg-config` e CMake.
- As entradas preexistentes de Homebrew, PostgreSQL, Archon, Bun, binários locais e sistema continuaram presentes.
- `npm run typecheck` passou sob Node.js 24 depois da alteração.
- O diretório temporário criado para validar a descoberta CMake foi removido após o teste; nenhum dado do aplicativo foi tocado.
