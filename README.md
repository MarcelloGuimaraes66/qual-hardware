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

O botão **Atualizar hardware** permanece visível no rodapé como painel informativo. O aplicativo consulta sozinho o canal público oficial ao abrir e a cada 24 horas, valida SHA-256, assinatura Ed25519, sequência e cadeia e ativa a publicação inteira em uma única transação. O operador não informa URL, chave ou agendamento. Se a rede ou qualquer validação falhar, o catálogo anterior continua ativo; sem nenhuma publicação baixada, vale o catálogo incluído no executável. A importação manual permanece somente como recuperação avançada. Consulte `docs/CATALOG_UPDATES.md`.

O publicador verifica diariamente se já passaram 15 dias desde a última Release `catalog-*`. No dia devido, pesquisa fontes públicas aprovadas no Brasil, Estados Unidos e Alemanha e publica um histórico append-only mesmo quando não existem novidades. O Qwen local gratuito só auxilia a classificação de páginas ambíguas; nunca decide preço, capacidade ou publicação e nenhuma chamada OpenAI é realizada.

O catálogo ativo aparece nessa mesma janela e inclui faixas econômicas. A versão embarcada `hardware-reference/2026-07-18.5` contém 21 perfis completos: ASUS, Apple, Dell, HP e Lenovo; CPUs Intel, AMD e Apple; GPUs NVIDIA, AMD, Intel e Apple; notebooks, mini PCs, workstations e racks. Na primeira etapa, **Avaliar equipamento existente** força o cálculo a usar uma máquina específica; o resultado mostra a capacidade estimada máxima de câmeras para o perfil de Agents escolhido.

Apple Silicon é uma opção explícita de plataforma. Os Macs usam memória unificada e não são tratados como se possuíssem VRAM NVIDIA dedicada. O Perceptrum macOS e o AiQ/Qwen local participam com CPU decode até uma calibração comprovar aceleração diferente. O catálogo inclui o MacBook Pro M4 Max de 36 GB deste laboratório como perfil de âncora, sem atribuir seus resultados a outro Mac.

Os botões PDF, XLSX e JSON geram um relatório combinado com as três políticas: mínimo técnico, recomendado e N+1. O PDF preserva o quadro resumido do relatório original e, para cada configuração principal, acrescenta uma seção comercial numerada por máquina, componente, especificação e grupo técnico. Os parágrafos são justificados, têm acentuação em português do Brasil e informam valor original, valor normalizado, unidade, fonte oficial, data e localização da evidência. Depois da referência comercial vêm os requisitos mínimos funcionais sem marca. O XLSX inclui a aba **Especificações detalhadas** e o JSON usa `capacity-recommendation-export/6.0.0` com `componentTechnicalSpecifications`.

Os botões **Anexo neutro DOCX/PDF/JSON** geram um documento separado, sem preço, vendedor, fabricante, modelo, SKU, MPN ou URL comercial. Ele informa método de comprovação, aceite, quantidade por nó, quantidade do projeto e risco de direcionamento. Enquanto benchmarks, calibrações físicas, especificações oficiais ou concorrência forem insuficientes, o documento recebe a marca **NÃO UTILIZAR COMO ESPECIFICAÇÃO DE AQUISIÇÃO**. O material é apoio técnico para revisão; não substitui ETP, pesquisa de mercado, parecer jurídico, edital ou aprovação do órgão. Consulte `docs/PROCUREMENT_NEUTRAL_SPECIFICATIONS.md` e `docs/TR_TECHNICAL_ANNEX_GUIDE.md`.

O SQLite v9 preserva integralmente v1–v8 e registra observações imutáveis no nível de cada campo oficial. A resolução mantém autoridade, parser, SKU/MPN, valor original e normalizado, unidade, URL, data, localização da evidência, hash e conflitos, sem promover um valor legado só porque o componente possui um link genérico. Antes da primeira migração persistente para v9, o aplicativo cria uma cópia SQLite consistente no subdiretório `schema-backups`. Dados sem evidência de campo continuam visíveis como legados/ambíguos e não liberam contratação. Somente `validated_local` e `extrapolated_high` aparecem como aptos para aquisição; as demais opções ficam separadas como planejamento ou referência.

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

See `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`, `docs/PUBLIC_EVIDENCE_CURATION.md`, and `contracts/perceptrum-workload-v3.json`.

A área permanente **Calibração de capacidade** inicia testes locais de 10 ou 60 minutos no Perceptrum desktop em macOS, Windows ou Ubuntu. O fluxo de um clique usa uma sessão descartável autenticada em `127.0.0.1`, abre `perceptrum://calibration/run`, acompanha o progresso, importa o resultado e recalcula as previsões. O Perceptrum salva antes o `.qhcal.json` em **Documentos/Qual Hardware/Calibracoes**, de forma append-only. A tela separa FPS de leitura RTSP de FPS de inferência AiQ e mostra CPU, GPU, RAM, SSD, rede, quatro fases, quinze etapas, Jobs, Steps, Agents, Intelligence, banco/dashboard, gargalo, sensores indisponíveis, caminho, checksum e JSON completo. O teste usa MediaMTX, FFmpeg, sondas nativas de memória/SSD e AiQ/Qwen locais, sem câmeras físicas, OpenAI ou APIs externas. `.qhplan.json` e importação manual permanecem como recuperação.
