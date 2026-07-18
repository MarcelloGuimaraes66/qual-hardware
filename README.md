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

Persistent installations use the dedicated PostgreSQL database, role and schema named `qual_hardware`, with the separate `qual_hardware_database` volume. The server refuses a `DATABASE_URL` whose database name is anything other than `qual_hardware`; pointing it at a Perceptrum or shared database fails before any query or schema change.

See `database/README.md` for Compose and externally managed PostgreSQL provisioning.

## Local development

```powershell
npm install
npm run dev
npm run dev:web
```

The API development port is `4178` by default; Vite proxies `/api` to the same private local port.

Without `DATABASE_URL`, the API uses an in-memory store for local evaluation. PostgreSQL is mandatory for shared or persistent environments.

## Aplicativo desktop Windows

Para abrir a versão desktop em desenvolvimento:

```powershell
npm run desktop:run
```

Para gerar o executável portátil de 64 bits:

```powershell
npm run desktop:package
```

O arquivo pronto fica em `release/Qual-Hardware-0.1.0-portable.exe`. Ele contém o runtime necessário, abre uma janela própria e inicia a API somente em uma porta aleatória de `127.0.0.1`. Não é necessário instalar Node.js no computador que executará o arquivo.

O modo desktop é local e usa armazenamento em memória durante a sessão. Exporte o resultado em PDF, XLSX ou JSON antes de fechar. Uma instalação compartilhada e persistente continua usando exclusivamente o banco PostgreSQL separado `qual_hardware`.

O catálogo possui atualização independente e assinada. Consulte `docs/CATALOG_UPDATES.md`; sem URL/chave pública configuradas, o desktop informa que está usando o catálogo incluído no executável.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run audit:source
```

See `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, and `contracts/perceptrum-workload-v1.json`.

The isolated Windows runner is documented in `runtime/README.md`. A loopback-only PostgreSQL deployment reference and TLS/VPN proxy example are in `deploy/`; they are provisioning inputs, not deployment commands for retired infrastructure.
