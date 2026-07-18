# Qual Hardware

Aplicativo **exclusivamente desktop** e independente da Aiquimist para calcular a especificação de notebooks, mini PCs, Macs, workstations Windows/Ubuntu e servidores rack planejados para executar cargas do Perceptrum. Qual Hardware não é um componente do Perceptrum e não deve ser incluído no EXE, MSIX, backend, instalador ou distribuição do Perceptrum.

## Safety boundary

- O executável inicia uma API interna em uma porta aleatória de `127.0.0.1`; ela não é um site, não aceita conexões da rede e termina junto com a janela.
- Media and RTSP credentials are never accepted by the internal Qual Hardware API.
- Benchmark uploads contain aggregate metrics and hardware/build identifiers only.
- Storage is represented only by a baseline NVMe workspace for Windows and temporary inference files; it does not affect node count or hardware selection.
- Catalog collectors run only for explicitly allowlisted sources and honor `robots.txt`.
- This project has no deployment command and must never target retired Drakon infrastructure.

## Independent database

Qual Hardware uses its own local SQLite file named `qual-hardware.sqlite`. The filename is enforced before the application opens the database, preventing accidental use of a Perceptrum or generic shared database. Projects, recommendations, benchmark metadata, the hardware catalog and price history persist locally.

See `database/README.md` for locations, backup and migration rules.

## Desenvolvimento do aplicativo desktop

```powershell
npm install
npm run dev
```

`npm run dev`, `npm start` e `npm run desktop:run` compilam e abrem a janela desktop. Não há comando de hospedagem web, imagem Docker ou configuração de proxy/reverse proxy.

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

O modo desktop grava automaticamente os projetos e o catálogo em `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite`. Os dados continuam disponíveis depois de fechar ou reiniciar o computador. Cada membro da equipe pode copiar somente o executável para sua máquina; o arquivo local é criado no primeiro uso.

O botão **Atualizar hardware** permanece visível no rodapé. Ele abre o gerenciador onde a equipe pode configurar a URL/chave pública ou importar manualmente um catálogo assinado. Consulte `docs/CATALOG_UPDATES.md`; sem configuração, o desktop continua usando o catálogo incluído no executável.

O catálogo ativo aparece nessa mesma janela e inclui faixas econômicas. A versão embarcada contém o ASUS Vivobook S 16 OLED S5606CA informado pela Aiquimist, um Vivobook de entrada, um notebook CUDA, Mac mini M4/M4 Pro, Mac Studio M4 Max/M3 Ultra, workstations e servidores. Na primeira etapa, **Avaliar equipamento existente** força o cálculo a usar uma máquina específica; o resultado mostra a capacidade estimada máxima de câmeras para o perfil de Agents escolhido.

Apple Silicon é uma opção explícita de plataforma. Os Macs usam memória unificada e não são tratados como se possuíssem VRAM NVIDIA dedicada. No contrato atual eles só participam de cenários com CPU decode e modelos remotos; AiQ local e NVIDIA/NVDEC exigem outro equipamento. Toda recomendação macOS permanece estimada até existir um build Perceptrum Apple Silicon e benchmark correspondente.

Os botões PDF, XLSX e JSON geram um único relatório consolidado com as três propostas da revisão: mínimo técnico, recomendado e N+1. O PDF possui comparação e seções técnicas separadas; o XLSX inclui resumo, BOM detalhada, nós, carga, cálculos, preços e premissas para as três políticas. As propostas usam máquinas diferentes quando o catálogo possui alternativas compatíveis sem redução de capacidade. Os relatórios mostram custo por componente, custo por nó, quantidade de nós, total do projeto e faixa de preço. Na ausência de ofertas atuais, o valor é uma estimativa de referência datada e identificada; a cotação de compra continua obrigatória.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run audit:source
```

See `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, and `contracts/perceptrum-workload-v1.json`.

The isolated benchmark runner is documented in `runtime/README.md`. Qual Hardware has no web deployment artifacts and never targets retired infrastructure.
