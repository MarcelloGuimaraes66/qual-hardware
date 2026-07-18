# Qual Hardware

Aplicativo desktop independente da Aiquimist para calcular a especificação de workstations Windows e servidores rack Ubuntu planejados para executar cargas do Perceptrum. Qual Hardware não é um componente do Perceptrum e não deve ser incluído no EXE, MSIX, backend, instalador ou distribuição do Perceptrum.

## Safety boundary

- The service is intended for a private network or VPN. It has no end-user login.
- Media and RTSP credentials are never accepted by the Qual Hardware API.
- Benchmark uploads contain aggregate metrics and hardware/build identifiers only.
- Storage is represented only by a baseline NVMe workspace for Windows and temporary inference files; it does not affect node count or hardware selection.
- Catalog collectors run only for explicitly allowlisted sources and honor `robots.txt`.
- This project has no deployment command and must never target retired Drakon infrastructure.

## Independent database

Qual Hardware uses its own local SQLite file named `qual-hardware.sqlite`. The filename is enforced before the application opens the database, preventing accidental use of a Perceptrum or generic shared database. Projects, recommendations, benchmark metadata, the hardware catalog and price history persist locally.

See `database/README.md` for locations, backup and migration rules.

## Local development

Use Node.js 24 LTS on Windows 11 x64, macOS 26 Apple Silicon or Ubuntu 24.04 x64. The repository has one npm lockfile and the same commands on every system:

```sh
npm ci
npm run dev
npm run dev:web
```

The API development port is `4178` by default; Vite proxies `/api` to the same private local port.

The development server creates `data/qual-hardware.sqlite` automatically. Set `QUAL_HARDWARE_SQLITE_PATH` only when a different local directory is required; the filename must remain `qual-hardware.sqlite`.

## Aplicativo desktop multiplataforma

Para abrir a versão desktop em desenvolvimento:

```sh
npm run desktop:run
```

Para gerar o pacote nativo do sistema atual:

```sh
npm ci
npm run desktop:package
```

Cada artefato é compilado no sistema operacional de destino. A versão `0.1.0` produz:

- Windows: `release/Qual-Hardware-0.1.0-windows-x64-portable.exe`.
- macOS: `release/Qual-Hardware-0.1.0-macos-arm64.dmg`.
- Ubuntu: `release/Qual-Hardware-0.1.0-linux-x64.AppImage` e `release/qual-hardware_0.1.0_amd64.deb`.

Os pacotes contêm o runtime necessário, abrem uma janela própria e iniciam a API somente em uma porta aleatória de `127.0.0.1`. O usuário final não precisa instalar Node.js. Os pacotes internos não são assinados e podem exibir SmartScreen ou Gatekeeper; a publicação de cada GitHub Release é manual.

O modo desktop grava automaticamente projetos e catálogo no diretório `userData` nativo do Electron, sempre no arquivo `qual-hardware.sqlite`. Os dados continuam disponíveis depois de fechar ou reiniciar o computador. Consulte `database/README.md` para os caminhos e a regra de preservação.

O botão **Atualizar hardware** permanece visível no rodapé. Ele abre o gerenciador onde a equipe pode configurar a URL/chave pública ou importar manualmente um catálogo assinado. Consulte `docs/CATALOG_UPDATES.md`; sem configuração, o desktop continua usando o catálogo incluído no executável.

Os botões PDF, XLSX e JSON geram um único relatório consolidado com as três propostas da revisão: mínimo técnico, recomendado e N+1. O PDF possui comparação e seções técnicas separadas; o XLSX inclui resumo, BOM detalhada, nós, carga, cálculos, preços e premissas para as três políticas.

Pré-requisitos, instalação, smoke tests, limitações dos pacotes sem assinatura e diagnóstico estão em `docs/CROSS_PLATFORM_DESKTOP.md`.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run desktop:package:dir
npm run desktop:smoke
npm run audit:source
```

See `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, and `contracts/perceptrum-workload-v1.json`.

The isolated benchmark runner remains Windows-only and is documented in `runtime/README.md`. Manifest generation remains available in all three desktop applications. A loopback-only SQLite service and TLS/VPN proxy example are in `deploy/`; they are provisioning inputs, not deployment commands for retired infrastructure.
