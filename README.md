# Qual Hardware

Aplicativo **exclusivamente desktop** e independente da Aiquimist para calcular a especificação de notebooks, mini PCs, Macs, workstations Windows/Ubuntu e servidores rack planejados para executar cargas do Perceptrum. Qual Hardware não é um componente do Perceptrum e não deve ser incluído no EXE, MSIX, backend, instalador ou distribuição do Perceptrum.

## Safety boundary

- O executável inicia uma API interna em uma porta aleatória de `127.0.0.1`; ela não é um site, não aceita conexões da rede e termina quando o aplicativo é encerrado. No macOS, fechar somente a janela mantém o aplicativo ativo conforme o ciclo de vida nativo.
- Media and RTSP credentials are never accepted by the internal Qual Hardware API.
- Benchmark uploads contain aggregate metrics and hardware/build identifiers only.
- Storage is represented only by a baseline NVMe workspace for Windows and temporary inference files; it does not affect node count or hardware selection.
- Catalog collectors run only for explicitly allowlisted sources and honor `robots.txt`.
- This project has no deployment command and must never target retired Drakon infrastructure.

## Independent database

Qual Hardware uses its own local SQLite file named `qual-hardware.sqlite`. The filename is enforced before the application opens the database, preventing accidental use of a Perceptrum or generic shared database. Projects, recommendations, benchmark metadata, the hardware catalog and price history persist locally.

See `database/README.md` for locations, backup and migration rules.

## Desenvolvimento do aplicativo desktop

Use Node.js 24 LTS on Windows 11 x64, macOS 26 Apple Silicon or Ubuntu 24.04 x64. The repository has one npm lockfile and the same commands on every system:

```sh
npm ci
npm run dev
```

`npm run dev`, `npm start` e `npm run desktop:run` compilam e abrem a janela desktop. Não há comando de hospedagem web, imagem Docker ou configuração de proxy/reverse proxy.

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

O sistema onde o Qual Hardware é executado não limita o alvo da recomendação: qualquer um dos três desktops pode planejar equipamentos Windows, Ubuntu ou macOS. A plataforma selecionada descreve onde o Perceptrum será executado, não onde o cálculo está sendo feito.

O modo desktop grava automaticamente projetos e catálogo no diretório `userData` nativo do Electron, sempre no arquivo `qual-hardware.sqlite`. Os dados continuam disponíveis depois de fechar ou reiniciar o computador. Consulte `database/README.md` para os caminhos e a regra de preservação.

O botão **Atualizar hardware** permanece visível no rodapé. Ele abre o gerenciador onde a equipe pode configurar a URL/chave pública ou importar manualmente um catálogo assinado. Consulte `docs/CATALOG_UPDATES.md`; sem configuração, o desktop continua usando o catálogo incluído no executável.

O catálogo ativo aparece nessa mesma janela e inclui faixas econômicas. A versão embarcada contém o ASUS Vivobook S 16 OLED S5606CA informado pela Aiquimist, um Vivobook de entrada, um notebook CUDA, Mac mini M4/M4 Pro, Mac Studio M4 Max/M3 Ultra, workstations e servidores. Na primeira etapa, **Avaliar equipamento existente** força o cálculo a usar uma máquina específica; o resultado mostra a capacidade estimada máxima de câmeras para o perfil de Agents escolhido.

Apple Silicon é uma opção explícita de plataforma. Os Macs usam memória unificada e não são tratados como se possuíssem VRAM NVIDIA dedicada. No contrato atual eles só participam de cenários com CPU decode e modelos remotos; AiQ local e NVIDIA/NVDEC exigem outro equipamento. Toda recomendação macOS permanece estimada até existir um build Perceptrum Apple Silicon e benchmark correspondente.

Os botões PDF, XLSX e JSON geram um único relatório consolidado com as três propostas da revisão: mínimo técnico, recomendado e N+1. O PDF possui comparação e seções técnicas separadas; o XLSX inclui resumo, BOM detalhada, nós, carga, cálculos, preços e premissas para as três políticas. As propostas usam máquinas diferentes quando o catálogo possui alternativas compatíveis sem redução de capacidade. Os relatórios mostram custo por componente, custo por nó, quantidade de nós, total do projeto e faixa de preço. Na ausência de ofertas atuais, o valor é uma estimativa de referência datada e identificada; a cotação de compra continua obrigatória.

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

The isolated benchmark runner remains Windows-only and is documented in `runtime/README.md`. Manifest generation remains available in all three desktop applications. Qual Hardware has no web deployment artifacts and never targets retired infrastructure.
