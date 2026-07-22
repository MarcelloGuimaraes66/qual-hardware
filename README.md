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

Use Node.js `24.18.0` and npm `11.16.0` on Windows 11 x64, macOS 26 Apple Silicon or Ubuntu 24.04 x64. The repository has one npm lockfile and the same commands on every system:

```sh
npm ci
npm run dev
```

`npm run dev`, `npm start` e `npm run desktop:run` compilam e abrem a janela desktop. Não há comando de hospedagem web, imagem Docker ou configuração de proxy/reverse proxy.

No Windows, use o launcher do projeto. Ele respeita `QUAL_HARDWARE_NODE_HOME` e, quando a variável não existe, provisiona o runtime portátil exato em `.tools` ou `C:\dev\tools`, sem alterar o Node global da máquina:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 setup
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 check
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 test
powershell -ExecutionPolicy Bypass -File .\scripts\qual-hardware.ps1 package
```

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

Cada artefato é compilado no sistema operacional de destino. A versão `0.2.0` produz:

- Windows: `release/Qual-Hardware-0.2.0-windows-x64-portable.exe`.
- macOS: `release/Qual-Hardware-0.2.0-macos-arm64.dmg`.
- Ubuntu: `release/Qual-Hardware-0.2.0-linux-x64.AppImage` e `release/qual-hardware_0.2.0_amd64.deb`.

Os pacotes contêm o runtime necessário, abrem uma janela própria e iniciam a API somente em uma porta aleatória de `127.0.0.1`. O usuário final não precisa instalar Node.js. Os pacotes internos não são assinados e podem exibir SmartScreen ou Gatekeeper; a publicação de cada GitHub Release é manual.

O sistema onde o Qual Hardware é executado não limita o alvo da recomendação: qualquer um dos três desktops pode planejar equipamentos Windows, Ubuntu ou macOS. A plataforma selecionada descreve onde o Perceptrum será executado, não onde o cálculo está sendo feito.

O modo desktop grava automaticamente projetos e catálogo no diretório `userData` nativo do Electron, sempre no arquivo `qual-hardware.sqlite`. Os dados continuam disponíveis depois de fechar ou reiniciar o computador. Consulte `database/README.md` para os caminhos e a regra de preservação.

O botão **Atualizar hardware** permanece visível no rodapé como painel informativo. O aplicativo consulta sozinho o canal público oficial ao abrir e a cada 24 horas, valida SHA-256, assinatura Ed25519, sequência e cadeia e ativa a publicação inteira em uma única transação. O operador não informa URL, chave ou agendamento. Se a rede ou qualquer validação falhar, o catálogo anterior continua ativo; sem nenhuma publicação baixada, vale o catálogo incluído no executável. A importação manual permanece somente como recuperação avançada. Consulte `docs/CATALOG_UPDATES.md`.

O publicador verifica diariamente se já passaram 15 dias desde a última Release `catalog-*`. No dia devido, pesquisa fontes públicas aprovadas no Brasil, Estados Unidos e Alemanha e publica um histórico append-only mesmo quando não existem novidades. O Qwen local gratuito só auxilia a classificação de páginas ambíguas; nunca decide preço, capacidade ou publicação e nenhuma chamada OpenAI é realizada.

O catálogo ativo aparece nessa mesma janela e inclui faixas econômicas. A versão embarcada `hardware-reference/2026-07-18.5` contém 21 perfis completos: ASUS, Apple, Dell, HP e Lenovo; CPUs Intel, AMD e Apple; GPUs NVIDIA, AMD, Intel e Apple; notebooks, mini PCs, workstations e racks. Na primeira etapa, **Avaliar equipamento existente** força o cálculo a usar uma máquina específica; o resultado mostra a capacidade estimada máxima de câmeras para o perfil de Agents escolhido.

Apple Silicon é uma opção explícita de plataforma. Os Macs usam memória unificada e não são tratados como se possuíssem VRAM NVIDIA dedicada. O Perceptrum macOS e o AiQ/Qwen local participam com CPU decode até uma calibração comprovar aceleração diferente. O catálogo inclui o MacBook Pro M4 Max de 36 GB deste laboratório como perfil de âncora, sem atribuir seus resultados a outro Mac.

O botão destacado **BAIXAR RELATÓRIO PDF** gera `qual-hardware-recomendacoes.pdf` com a estrutura do relatório comparativo original: narrativa, três configurações, outras máquinas, carga e três propostas completas. O PDF principal não contém o anexo neutro nem uma Parte II. A auditoria extensa e as especificações detalhadas permanecem no XLSX/JSON; os requisitos sem marca ficam no anexo neutro separado. O XLSX inclui a aba **Especificações detalhadas** e o JSON usa `capacity-recommendation-export/6.0.0` com `componentTechnicalSpecifications`.

Os botões **ANEXO DOCX/PDF/JSON** ficam recolhidos na área **Documentos para licitação - anexo neutro separado**. Eles geram outro documento, sem preço, vendedor, fabricante, modelo, SKU, MPN ou URL comercial. Esse anexo não é o relatório de recomendações. Ele informa método de comprovação, aceite, quantidade por nó, quantidade do projeto e risco de direcionamento. Enquanto benchmarks, calibrações físicas, especificações oficiais ou concorrência forem insuficientes, recebe a marca **NÃO UTILIZAR COMO ESPECIFICAÇÃO DE AQUISIÇÃO**. Consulte `docs/PROCUREMENT_NEUTRAL_SPECIFICATIONS.md` e `docs/TR_TECHNICAL_ANNEX_GUIDE.md`.

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

A área permanente **Calibração de capacidade** prepara testes locais de 10 ou 60 minutos no Perceptrum desktop. No Windows, o fluxo de um clique já abre `perceptrum://calibration/run` sem expor o bearer token na URI: ela carrega apenas versão, origem loopback do Qual Hardware, UUID da sessão e um nonce de uso único. O Perceptrum reivindica a sessão protegida, acompanha cancelamento/progresso e salva diagnósticos append-only em **Documentos/Qual Hardware/Calibracoes**. O adaptador Windows atual é deliberadamente `diagnosticOnly`: localizar executáveis não conta como medição, seus resultados `developmentOnly` não são importáveis e nenhuma capacidade de compra é produzida. A homologação de 10/60 minutos permanece bloqueada até MediaMTX, ffprobe, FFmpeg e AiQ/Qwen serem fixados por versão/SHA/licença e o pipeline real emitir medições validadas. `.qhplan.json` e importação manual permanecem como recuperação, mas arquivos parciais ou diagnósticos são rejeitados como evidência.
