# Qual Hardware

Aplicativo **exclusivamente desktop** e independente da Aiquimist para calcular a especificação de notebooks, mini PCs, Macs, workstations Windows/Ubuntu e servidores rack planejados para executar cargas do Perceptrum. Qual Hardware não é um componente do Perceptrum e não deve ser incluído no EXE, MSIX, backend, instalador ou distribuição do Perceptrum.

## Safety boundary

- O executável inicia uma API interna em uma porta aleatória de `127.0.0.1`; ela não é um site, não aceita conexões da rede e termina quando o aplicativo é encerrado. No macOS, fechar somente a janela mantém o aplicativo ativo conforme o ciclo de vida nativo.
- Media and RTSP credentials are never accepted by the internal Qual Hardware API.
- Calibration files contain aggregate metrics and hashed hardware/build identifiers only; media, credentials and external/OpenAI requests are rejected.
- Rolling source clips, encode/decode, frame extraction, Jobs, Steps, Agents, Intelligence, database/dashboard activity, disk read/write, network and thermal limits participate in workload v3 sizing.
- Catalog collectors run centrally in GitHub Actions, only for explicitly allowlisted public sources, and honor `robots.txt`; operators' computers never scrape stores.
- This project has no deployment command and must never target retired Drakon infrastructure.

## Independent database

Qual Hardware uses its own local SQLite file named `qual-hardware.sqlite`. The filename is enforced before the application opens the database, preventing accidental use of a Perceptrum or generic shared database. Projects, recommendations, benchmark metadata, the hardware catalog and price history persist locally.

See `database/README.md` for locations, backup and migration rules.

## Desenvolvimento do aplicativo desktop

Use Node.js `24.18.0`, npm `11.16.0` and Go `1.26.5` on Windows 11 x64, macOS 26 Apple Silicon or Ubuntu 24.04 x64. On Windows, the project-local launcher provisions the exact toolchain without replacing the machine's global Node.js:

### Clonar e compilar sem configuração manual do projeto

O repositório contém o lock completo das dependências, os contratos, o banco,
o benchmark nativo e os scripts de compilação. Não copie arquivos de outra
máquina e não instale modelos Qwen para compilar o aplicativo.

No Windows 11 x64, instale uma única vez o **Visual Studio 2022 Build Tools**
com **Desktop development with C++**, CMake/Ninja e Windows SDK. Depois execute:

```powershell
git clone https://github.com/MarcelloGuimaraes66/qual-hardware.git
cd qual-hardware
.\scripts\qual-hardware.ps1 build
```

O comando baixa e verifica as versões exatas de Node.js e Go, executa `npm ci`
e produz `dist/`. Para gerar o executável portátil use:

```powershell
.\scripts\qual-hardware.ps1 package
```

No macOS ARM64, instale Xcode Command Line Tools e CMake. No Ubuntu 24.04 x64,
instale `build-essential` e `cmake`. Com Node.js, npm e Go nas versões acima:

```sh
git clone https://github.com/MarcelloGuimaraes66/qual-hardware.git
cd qual-hardware
npm ci
npm run build
```

Não são necessários `.env`, serviços externos, banco remoto, OpenAI, Archon,
FFmpeg, llama.cpp ou modelos Qwen para compilar e abrir o modo diagnóstico.

### Launcher local no Windows

```powershell
.\scripts\qual-hardware.ps1 setup
.\scripts\qual-hardware.ps1 run
```

The launcher resolves portable tools from `QUAL_HARDWARE_NODE_HOME`, `.tools` or `C:\dev\tools` and changes `PATH` only for its child process. The equivalent direct commands are:

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

Cada artefato é compilado no sistema operacional de destino. A versão `0.6.0` produz:

- Windows: `release/Qual-Hardware-0.6.0-windows-x64-portable.exe`.
- macOS: `release/Qual-Hardware-0.6.0-macos-arm64.dmg`.
- Ubuntu: `release/Qual-Hardware-0.6.0-linux-x64.AppImage` e `release/qual-hardware_0.6.0_amd64.deb`.

Os pacotes desktop contêm Electron, fontes, dependências dos relatórios, helper de topologia e benchmark nativo. Não existe arquivo auxiliar de runtime: basta copiar o aplicativo correspondente ao sistema e abri-lo. Antes da tela principal, **Verificação do ambiente** identifica drivers, FFmpeg/FFprobe, llama.cpp e todos os pares Qwen3-VL + `mmproj` compatíveis. A aplicação calcula um orçamento conservador com RAM, VRAM, memória unificada e CPU, recomenda automaticamente os modelos para Core/Core Max e permite substituição manual nas listas. O mesmo GGUF é usado em Windows, macOS e Ubuntu; somente o backend do llama.cpp muda. O usuário final não precisa instalar Node.js. Componentes ausentes recebem orientação e link oficial; nenhum download ou instalador é executado automaticamente. Os pacotes desktop internos não são assinados e podem exibir SmartScreen ou Gatekeeper; a publicação de cada GitHub Release é manual.

O sistema onde o Qual Hardware é executado não limita o alvo da recomendação: qualquer um dos três desktops pode planejar equipamentos Windows, Ubuntu ou macOS. A plataforma selecionada descreve onde o Perceptrum será executado, não onde o cálculo está sendo feito.

O modo desktop grava automaticamente projetos e catálogo no diretório `userData` nativo do Electron, sempre no arquivo `qual-hardware.sqlite`. Os dados continuam disponíveis depois de fechar ou reiniciar o computador. Consulte `database/README.md` para os caminhos e a regra de preservação.

O botão **Atualizar hardware** permanece visível no rodapé como painel informativo. O aplicativo consulta sozinho o canal público oficial ao abrir e a cada 24 horas, valida SHA-256, assinatura Ed25519, sequência e cadeia e ativa a publicação inteira em uma única transação. O operador não informa URL, chave ou agendamento. Se a rede ou qualquer validação falhar, o catálogo anterior continua ativo; sem nenhuma publicação baixada, vale o catálogo incluído no executável. A importação manual permanece somente como recuperação avançada. Consulte `docs/CATALOG_UPDATES.md`.

O publicador verifica diariamente se já passaram 15 dias desde a última Release `catalog-*`. No dia devido, pesquisa fontes públicas aprovadas no Brasil, Estados Unidos e Alemanha e publica um histórico append-only mesmo quando não existem novidades. O Qwen local gratuito só auxilia a classificação de páginas ambíguas; nunca decide preço, capacidade ou publicação e nenhuma chamada OpenAI é realizada.

O catálogo ativo aparece nessa mesma janela e inclui faixas econômicas. A versão embarcada `hardware-reference/2026-07-22.1` contém 22 perfis, incluindo a configuração exata ASUS G835LX / Core Ultra 9 275HX / RTX 5090 Laptop usada na qualificação do Windows. Na primeira etapa, **Avaliar equipamento existente** força o cálculo a usar uma máquina específica; o resultado mostra a capacidade estimada máxima de câmeras para o perfil de Agents escolhido.

Apple Silicon é uma opção explícita de plataforma. Os Macs usam memória unificada e não são tratados como se possuíssem VRAM NVIDIA dedicada. O Perceptrum macOS e o AiQ/Qwen local participam com CPU decode até uma calibração comprovar aceleração diferente. O catálogo inclui o MacBook Pro M4 Max de 36 GB deste laboratório como perfil de âncora, sem atribuir seus resultados a outro Mac.

O botão destacado **BAIXAR RELATÓRIO PDF** gera `qual-hardware-recomendacoes.pdf` com a estrutura do relatório comparativo original: narrativa, três configurações, outras máquinas, carga e três propostas completas. O PDF principal não contém o anexo neutro nem uma Parte II. A auditoria extensa e as especificações detalhadas permanecem no XLSX/JSON; os requisitos sem marca ficam no anexo neutro separado. O XLSX inclui a aba **Especificações detalhadas** e o JSON usa `capacity-recommendation-export/7.0.0` com `componentTechnicalSpecifications`.

Os botões **ANEXO DOCX/PDF/JSON** ficam recolhidos na área **Documentos para licitação - anexo neutro separado**. Eles geram outro documento, sem preço, vendedor, fabricante, modelo, SKU, MPN ou URL comercial. Esse anexo não é o relatório de recomendações. Ele informa método de comprovação, aceite, quantidade por nó, quantidade do projeto e risco de direcionamento. Enquanto benchmarks, calibrações físicas, especificações oficiais ou concorrência forem insuficientes, recebe a marca **NÃO UTILIZAR COMO ESPECIFICAÇÃO DE AQUISIÇÃO**. Consulte `docs/PROCUREMENT_NEUTRAL_SPECIFICATIONS.md` e `docs/TR_TECHNICAL_ANNEX_GUIDE.md`.

O SQLite v12 preserva integralmente v1–v11 e registra ambiente, componentes, autotestes e avisos, além das tentativas de capacidade e relatórios vinculados por SHA-256. A topologia multi-dispositivo, a evidência por CPU/GPU, as fronteiras de capacidade e os planos de frota continuam preservados. Antes da primeira migração persistente, o aplicativo cria uma cópia SQLite consistente no subdiretório `schema-backups`. Dados sem evidência suficiente continuam visíveis como diagnóstico e não liberam contratação.

A primeira fotografia oficial revisada contém dados determinísticos dos SKUs exatos **Intel Core Ultra 9 285K** e **NVIDIA GeForce RTX 5090**. Ela não é apresentada como cobertura de todo o mercado: o processador Intel já satisfaz o perfil de completude técnica atual; a GPU NVIDIA permanece incompleta nos campos oficiais ainda não publicados/coletados. AMD e os demais componentes continuam visíveis e bloqueados até seus conectores e evidências por campo serem concluídos. Especificação de fabricante e benchmark de desempenho são gates independentes.

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

See `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `docs/PUBLIC_EVIDENCE_CURATION.md`, and `contracts/perceptrum-workload-v4.json`.

A área permanente **Calibração de capacidade** é o único executor de calibração suportado. Ela oferece diagnóstico de 10 minutos, validação de engenharia de 60 minutos e qualificação comercial em três blocos de oito horas, com dois intervalos de 30 minutos. O próprio aplicativo cria a sessão, inicia o worker isolado, conduz seu gerador RTSP/RTP loopback, FFmpeg, telemetria e Qwen local quando disponíveis, mostra o progresso, persiste o resultado atômico e encerra todos os processos e temporários pertencentes à sessão.

O número de câmeras informado é a semente, nunca o teto. A busca reduz a carga quando a semente falha, amplia exponencialmente quando passa e refina a fronteira. O resumo responde se a carga solicitada funcionou, qual é a capacidade operacional segura, o maior valor aprovado, o primeiro valor reprovado, o gargalo e se houve teste acima da carga solicitada. Falha de FFmpeg, Qwen, worker compatível, telemetria ou outro componente de infraestrutura produz **INCONCLUSIVO**, sem fabricar um limite.

`VÍDEO FULL` e `FRAME` são cargas diferentes. As duas mantêm a sessão RTSP e a decodificação de base; VÍDEO cria o clipe e empacota vários frames, enquanto FRAME captura uma imagem somente na cadência configurada e não cria clipe quando não existe gravação ou Agent de vídeo. A proporção entre os grupos é preservada em cada tentativa da busca.

Depois da persistência, a aplicação gera automaticamente um diagnóstico em tela e arquivos PDF, TXT, XLSX e JSON com a mesma fonte de dados. O relatório começa pelo método utilizado e informa claramente se o resultado é medição real ou estimativa genérica. Também inclui capacidade, composição VÍDEO/FRAME, topologia CPU/GPU, gargalos, histórico da busca e um plano de servidores. Um plano com vários nós permanece `planning_only` até um piloto de cluster.

O Qual Hardware não anexa ao Perceptrum em execução, não usa banco, credenciais, mídia real, protocolo `perceptrum://`, porta fixa ou callback externo e bloqueia OpenAI e comunicação externa durante a calibração. Se uma instalação compatível estiver presente, somente o worker `--hardware-benchmark-worker` é iniciado em workspace temporário; versões antigas continuam no modo genérico. Novos resultados usam `qual-hardware-local-calibration/6.0.0`, kernel `4.0.0` e intercâmbio `.qhcal`/`.qhcalset` v4; leitores anteriores permanecem para histórico diagnóstico.
