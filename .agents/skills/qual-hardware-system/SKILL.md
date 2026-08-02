---
name: qual-hardware-system
description: Desenvolver, refatorar, validar, empacotar e publicar o aplicativo desktop Qual Hardware no repositório MarcelloGuimaraes66/qual-hardware, incluindo dimensionamento de hardware para cargas do Perceptrum, calibração local, evidência para aquisição, SQLite, Qwen, interface moderna, portabilidade Windows/macOS/Ubuntu e o gate commit-push-PR-merge. Usar para qualquer trabalho no checkout canônico /Users/marcellogmf66/Documents/qual-hardware, em um worktree Git registrado desse checkout, ou sempre que uma solicitação mencionar Qual Hardware, sua calibração, recomendações, relatórios, catálogo, banco, interface, build, pacote, release ou integração GitHub.
---

# Qual Hardware System

Trabalhar no Qual Hardware como produto desktop independente, orientado por evidência e compartilhado pela equipe internacional da AiQuimist Corp (Estados Unidos) e AiQuimist Ltda (Brasil). Preservar a execução nativa com mínimo esforço em cada sistema operacional e nunca confundir este repositório com o Perceptrum.

## Autoridade e localização

- Tratar `/Users/marcellogmf66/Documents/qual-hardware` como checkout canônico neste Mac. Trabalhar nele ou em um worktree Git registrado que compartilhe exatamente o mesmo diretório comum `.git`.
- Em worktree, confirmar a associação com `git worktree list` e `git rev-parse --git-common-dir`; não confiar apenas no nome ou na localização da pasta.
- Usar como remoto oficial `https://github.com/MarcelloGuimaraes66/qual-hardware.git`.
- Ler primeiro `AGENTS.md` e as instruções aplicáveis do repositório. Fazer essas regras prevalecerem sobre esta skill quando houver diferença.
- Não invocar nem restaurar Archon. Seguir diretamente `EXPLORE -> PLAN -> IMPLEMENT -> VALIDATE -> REVIEW -> COMPLETE -> MEMORY`.
- Tratar referências históricas a branches, worktrees, protocolos ou integrações desativadas apenas como auditoria, nunca como autorização atual.
- Preservar alterações preexistentes do usuário e de outros agentes. Não incluir trabalho alheio em commits.

## Finalidade do produto

Dimensionar, com a maior precisão defensável, quais computadores ou servidores e quantas unidades um cliente precisa para executar o Perceptrum. Produzir opções comparáveis de compra e especificações técnicas sem transformar estimativas, catálogos ou inferências em capacidade fisicamente comprovada.

Modelar todos os gargalos relevantes do Perceptrum, incluindo:

- recepção RTSP, decode, processamento de frames, encode e vídeo completo;
- Jobs, Steps, Agents, AiQ/Qwen e emissão de alertas;
- Forensic, nome atual pretendido para a capacidade historicamente chamada Intelligence;
- indexação de vídeos ao vivo e de arquivos de dias, semanas, meses ou anos;
- busca forense em linguagem natural, associação visual, pessoas, veículos, placas, objetos e trajetórias;
- CPU, GPU, aceleradores, RAM, VRAM ou memória unificada, armazenamento e I/O;
- banco, dashboard, concorrência, filas, rede, energia, resfriamento, temperatura e throttling sustentado.

Preservar nomes versionados antigos, como `Intelligence`, quando contratos e arquivos existentes dependerem deles. Fazer renomeações por migração explícita e compatível, nunca por substituição silenciosa.

## Limites não negociáveis

- Manter Qual Hardware e `qual-hardware.sqlite` independentes do Perceptrum.
- Não executar, instalar, abrir ou alterar o Perceptrum durante a calibração.
- Não acessar câmeras, streams, credenciais, arquivos, APIs, bancos ou dados do Perceptrum durante a calibração.
- Executar cargas sintéticas ou kernels internos aprovados para medir o computador sem depender do ambiente real do cliente.
- Manter resultados, mídias e dados de calibração no computador. Não transmitir automaticamente esses conteúdos para GitHub, nuvem, telemetria, LLM ou serviço externo.
- Vincular a API interna somente a uma porta aleatória de `127.0.0.1`. Não transformar o produto em site, serviço de rede, contêiner ou backend hospedado.
- Não incluir Qual Hardware em executáveis, instaladores, APIs, bancos ou distribuições do Perceptrum.
- Não direcionar deploy para infraestrutura Drakon aposentada.
- Não inventar preço, benchmark, compatibilidade, sensor, capacidade, especificação de fabricante ou disponibilidade comercial.
- Não declarar capacidade apta para aquisição sem evidência física exigida e todos os gates exatos de hardware, build, modelo, workload e plataforma.
- Não tratar dado ausente como zero. Registrar `unavailable` e o motivo observável.

## Evidência e recomendação de compra

- Separar especificação oficial do fabricante, benchmark independente, calibração física e preço comercial como classes diferentes de evidência.
- Preservar fonte, URL, horário, moeda, condição, SKU/MPN, valor observado, normalização, hash, parser, escopo, conflito e resolução quando aplicável.
- Tratar `validated_local` somente como resultado do computador exato, com fingerprint, build, modelo e carga compatíveis.
- Manter extrapolações, referências e diagnósticos claramente rotulados e sujeitos às margens de segurança vigentes.
- Nunca recomendar mais câmeras do que a carga sustentada pela evidência física aplicável.
- Exigir compatibilidade exata entre CPU, GPU, arquitetura, memória, sistema, drivers, aceleradores, build e perfil de carga antes de promover capacidade.
- Bloquear aquisição quando faltar benchmark sustentado, evidência técnica por campo, concorrência suficiente ou qualquer gate obrigatório.
- Tratar estimativas de custo como referência datada; exigir cotação para compra quando as fontes comerciais forem insuficientes.
- Manter o anexo neutro de licitação separado de marcas, modelos, vendedores, preços, URLs ou identificadores comerciais.

## Plataformas obrigatórias

Preservar uma única base compartilhada no mesmo GitHub e suportar nativamente:

| Plataforma | Alvo mínimo do Qual Hardware | Arquitetura atual |
| --- | --- | --- |
| Windows | Windows 11 ou superior | x64 |
| macOS | Apple Silicon M3, M4, M5 ou superior | arm64 |
| Ubuntu | Ubuntu 22.04 ou superior; validar oficialmente o alvo definido pelo repositório | x64 |

Usar os alvos oficiais atuais do repositório — Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64 — para CI, empacotamento e afirmações de suporte. Tratar versões adicionais desejadas como compatibilidade a validar, não como suporte já comprovado.

Compilar e validar cada pacote no sistema operacional nativo. Não presumir que passar no macOS prova Windows ou Ubuntu. Usar a matriz do GitHub como validação complementar e exigir os testes manuais definidos para cada release.

## Organização do código por plataforma

- Manter lógica verdadeiramente portável em módulos compartilhados.
- Colocar novo código, telas, temas, adaptadores, scripts e integrações exclusivos de uma plataforma em um subdiretório do subsistema proprietário chamado `windows/`, `mac/` ou `ubuntu/`.
- Usar, por exemplo, `src/<subsistema>/windows/`, `src/<subsistema>/mac/` e `src/<subsistema>/ubuntu/`. Quando não houver subsistema proprietário claro, usar `src/platform/windows/`, `src/platform/mac/` e `src/platform/ubuntu/`.
- Não duplicar telas completas quando tokens visuais, adaptadores ou componentes pequenos resolverem a diferença.
- Não espalhar condicionais de plataforma pela base compartilhada quando uma interface comum e três implementações isoladas forem mais claras.
- Não mover mecanicamente código estável apenas para satisfazer a árvore. Fazer a separação durante mudanças relacionadas, com testes e sem quebrar imports ou persistência.
- Preservar os diretórios de artefatos já contratados pelo runtime: `resources/calibration/win32-x64/`, `resources/calibration/darwin-arm64/` e `resources/calibration/linux-x64/`. Esses nomes alimentam manifestos e empacotamento e não devem ser renomeados para `windows/mac/ubuntu` sem migração versionada.
- Manter nomes de caminhos, resolução de diretórios, separadores, permissões, executáveis e lifecycle nativos atrás de adaptadores testáveis.
- Não gravar caminhos absolutos de uma máquina no código distribuído.

## Tecnologias e portabilidade

- Preservar a arquitetura atual: Electron, React, TypeScript, Node.js, Hono, Vite, Vitest e os probes/runtime nativos registrados no repositório.
- Usar Node.js 24 LTS e o lockfile único enquanto forem os contratos atuais.
- Preferir C ou C++ no padrão estável mais recente suportado pelos toolchains dos três alvos para novos componentes nativos, de alto desempenho ou baixo nível quando houver benefício medido.
- Não reescrever componentes TypeScript, Electron ou Go em C/C++ sem objetivo, plano de migração, orçamento de risco e evidência de benefício.
- Preferir bibliotecas, formatos, APIs e abstrações equivalentes entre plataformas para reduzir retrabalho ao clonar, compilar e executar em outro computador.
- Encapsular APIs exclusivas do sistema atrás de contratos portáveis. Disponibilizar fallback explícito ou bloquear com diagnóstico claro quando não existir equivalência segura.
- Fixar versões por lockfile, manifestos e hashes quando a reprodução ou a cadeia de evidência exigir.
- Fazer `npm ci` funcionar a partir de um clone limpo sem ajustes manuais permanentes no PATH. Documentar pré-requisitos nativos inevitáveis.
- Não modificar PATH global, instalar ferramentas no sistema ou alterar configuração permanente sem necessidade comprovada e autorização compatível com a solicitação.
- Tratar iOS e Android como ambientes usados pela equipe, não como alvos atuais deste aplicativo exclusivamente desktop. Só ampliar o produto para mobile mediante escopo explícito.

## Dependências, ferramentas e PATH

- Declarar bibliotecas necessárias ao build ou ao runtime no manifesto e no lockfile próprios do projeto. Não depender silenciosamente de uma instalação global presente em apenas um computador.
- Instalar ferramentas de desenvolvimento fora do projeto somente quando necessárias e no menor escopo seguro: ambiente isolado ou gerenciador da plataforma por padrão; escopo do usuário quando a ferramenta precisar ser compartilhada por vários checkouts.
- Distinguir biblioteca de executável. Bibliotecas Python, por exemplo, devem ser instaladas no ambiente ou `site-packages` que o interpretador realmente usa; não adicionar diretórios de módulos ao `PATH`.
- Quando uma ferramenta instalar um executável em diretório ainda ausente do `PATH`, acrescentar esse diretório uma única vez ao `PATH` existente. Nunca substituir o valor completo, remover entradas, duplicá-las ou reordenar ferramentas já funcionais.
- Antes e depois de alterar o `PATH`, preservar o valor anterior, confirmar a resolução da nova ferramenta com `command -v` ou equivalente e verificar que os comandos essenciais anteriores continuam resolvendo para os mesmos executáveis.
- Não desabilitar permanentemente proteções do gerenciador de pacotes. Se uma exceção pontual for necessária e autorizada, combiná-la com isolamento ou escopo de usuário, documentar o motivo e verificar a integridade das dependências depois da instalação.
- Não gravar caminhos absolutos de ferramentas de um computador no código distribuído. Centralizar pré-requisitos e diferenças de descoberta nos scripts ou adaptadores de bootstrap apropriados para Windows, macOS e Ubuntu.

## Interface gráfica moderna

- Manter a experiência profissional, clara, acessível e atual nos três desktops.
- Usar componentes compartilhados para o fluxo e adaptar apresentação e comportamento nativo por plataforma.
- No Windows 11, alinhar com Fluent, tipografia, transparência, cantos, navegação, estados e convenções modernas quando suportados e legíveis.
- No macOS, respeitar Human Interface Guidelines, lifecycle de janelas, menu, Dock, atalhos, materiais e densidade adequados ao sistema.
- No Ubuntu, respeitar GNOME/Wayland, integração de desktop, escala, teclado, temas e empacotamento AppImage/DEB.
- Preservar contraste, foco visível, navegação por teclado, redução de movimento, escala de texto e mensagens compreensíveis.
- Não usar efeitos visuais que prejudiquem desempenho, estabilidade, legibilidade ou equivalência funcional.

## Idiomas

- Usar inglês como idioma padrão e fallback.
- Projetar todos os textos para `en`, `pt-BR`, `es`, `fr`, `it`, `de`, `zh-CN`, `ru`, `ko` e `ja`.
- Centralizar mensagens e formatação; não espalhar literais de interface nos componentes.
- Usar Unicode, pluralização, datas, números, unidades e moedas conforme locale.
- Não alegar suporte completo a um idioma enquanto telas, relatórios, erros, atalhos e fallback não tiverem sido verificados.
- Migrar progressivamente os textos existentes em português e inglês sem quebrar o produto atual.

## Banco de dados e dados locais

- Usar exclusivamente o SQLite local `qual-hardware.sqlite` para o estado persistente atual do produto.
- Preservar `PRAGMA user_version = 9`. Não incrementar nem reinterpretar essa versão enquanto a própria regra do repositório não for formalmente alterada.
- Fazer extensões de calibração aditivas e append-only. Não reescrever nem remover evidência histórica.
- Preservar integralmente dados e migrações v1-v8 e criar backup consistente conforme o fluxo existente antes de uma migração persistente permitida.
- Rejeitar qualquer arquivo de banco com nome inesperado antes de abrir.
- Não copiar, mover, substituir ou apagar bancos automaticamente durante build, instalação, calibração ou inicialização.
- Considerar PostgreSQL em nuvem um padrão possível para outros produtos AiQuimist, não a arquitetura atual do Qual Hardware. Não adicionar banco remoto, sincronização ou upload sem decisão explícita, modelo de segurança e consentimento do usuário.

## LLM local

- Preferir Qwen compatível com CPU, GPU, memória, sistema e aceleração disponíveis quando uma LLM for necessária.
- Selecionar variante e quantização com base na máquina real e manter fallback local seguro.
- Não usar OpenAI ou outra LLM externa automaticamente.
- Não permitir que uma LLM determine sozinha preço, capacidade, compatibilidade, aprovação de aquisição ou publicação de catálogo.
- Tratar saída de LLM como assistência classificatória ou analítica sujeita a esquema, regras determinísticas, evidência e validação.
- Não enviar mídia, calibração, credenciais, inventário privado ou dados do cliente a uma LLM externa.

## Proteção contra exclusão e vazamento

- Nunca apagar dados, evidências, bancos, fontes, branches, worktrees ou arquivos do usuário sem autorização prévia para o alvo exato.
- Limpar somente temporários pertencentes à sessão, registrados em manifesto válido sob a raiz controlada de calibração.
- Nunca remover recursivamente a raiz controlada.
- Não publicar bancos, resultados `.qhcal`, mídia, credenciais, chaves, arquivos locais, logs sensíveis, instaladores gerados ou caches.
- Antes de qualquer commit, revisar arquivos rastreados, não rastreados e staged para impedir vazamento ou mistura de escopo.

## Fluxo de engenharia

1. **EXPLORE:** ler `AGENTS.md`, documentação relevante, estado Git, código, contratos, testes e registros aplicáveis. Resolver contradições pela autoridade atual do repositório.
2. **PLAN:** definir escopo, risco, invariantes, plataformas afetadas, critérios de aceite, migração e rollback quando necessários.
3. **IMPLEMENT:** trabalhar de forma focada e preferencialmente aditiva; usar obrigatoriamente branch e worktree explícitos `codex/*` para mudanças não triviais.
4. **VALIDATE:** executar verificações proporcionais ao risco na plataforma atual e registrar honestamente o que não pôde ser validado nos outros sistemas.
5. **REVIEW:** inspecionar o diff completo, regressões, segurança, persistência, compatibilidade, UX e evidência de capacidade.
6. **COMPLETE:** entregar código, build ou documento solicitado sem ampliar silenciosamente o escopo.
7. **MEMORY:** registrar decisões e resultados duráveis em `docs/runs/` quando o trabalho for não trivial.

Não criar cerimônia ou validadores sem valor. Ao mesmo tempo, não reduzir gates de banco, calibração, segurança, empacotamento ou aquisição quando a mudança atingir essas superfícies.

## Validação

Selecionar os comandos compatíveis com o risco e a superfície alterada:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run desktop:package:dir
npm run desktop:smoke
npm run desktop:package
```

- Executar `git diff --check` antes de publicar.
- Para mudanças de documentação ou skill, validar estrutura, Markdown/YAML e diff; não executar builds caros sem relação com o risco.
- Para UI ou comportamento desktop, compilar e executar o alvo afetado; não chamar build de teste manual.
- Para persistência, migração, calibração, catálogo, relatórios ou gates de compra, executar testes específicos e revisar compatibilidade com dados existentes.
- Para release, completar a matriz e os checklists manuais de Windows, macOS e Ubuntu definidos no repositório.
- Informar separadamente testes automatizados, build, empacotamento, inspeção e teste manual.
- Nunca afirmar PASS, suporte, homologação ou capacidade sem evidência observada.

## Finalizar uma implementação grande

- Invocar `$qual-hardware-finalize-large-implementation` junto com esta skill quando a entrega estiver pronta para commit, push, PR ou merge.
- Manter o conhecimento do produto nesta skill e o gate detalhado de publicação na skill de finalização, evitando cópias divergentes.
- Nunca usar uma skill de finalização genérica ou pertencente a outro projeto para publicar o Qual Hardware.
- Tratar a abertura do PR e o merge como decisões separadas; exigir autorização explícita depois de apresentar o PR e os testes reais.

## Relato final

- Informar arquivos e comportamento alterados.
- Informar validações executadas, resultados e limites.
- Diferenciar suporte pretendido de suporte comprovado.
- Depois de publicação, informar branch, SHA, push, PR, destino e estado.
- Depois de merge autorizado, informar autorização, estratégia e SHA resultante na `main`.
- Nunca afirmar commit, push, PR, teste, pacote, release ou merge sem evidência observada.
