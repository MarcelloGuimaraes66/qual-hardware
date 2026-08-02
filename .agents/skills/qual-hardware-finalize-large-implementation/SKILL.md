---
name: qual-hardware-finalize-large-implementation
description: Finalizar implementações grandes exclusivamente do Qual Hardware em uma sequência controlada de validação, commit, push da mesma branch, pull request para main, apresentação dos testes e autorização explícita antes do merge. Usar no checkout canônico /Users/marcellogmf66/Documents/qual-hardware ou em um worktree Git registrado desse checkout quando o usuário declarar uma entrega ampla pronta para publicação ou integração, pedir commit, push, PR ou merge de uma grande mudança, ou quando uma alteração de alto impacto em calibração, capacidade, SQLite, catálogo, relatórios, interface, runtime ou empacotamento chegar ao gate final. Nunca usar para outro projeto, para merge silencioso ou para publicar uma correção pequena sem solicitação.
---

# Finalizar implementação grande do Qual Hardware

Encerrar uma entrega ampla na ordem obrigatória `validar -> commit -> push -> PR -> apresentar testes -> pedir autorização -> merge`. Tratar a decisão de iniciar esta finalização como autorização para publicar a branch e abrir ou atualizar o PR, nunca como autorização antecipada para fazer merge.

## Fixar o projeto correto

- Tratar `/Users/marcellogmf66/Documents/qual-hardware` como checkout canônico e trabalhar somente nele ou em worktree Git registrado que compartilhe exatamente o mesmo diretório comum `.git`.
- Confirmar worktrees com `git worktree list` e `git rev-parse --git-common-dir`; nome ou caminho semelhante não prova a identidade do repositório.
- Usar somente o repositório `https://github.com/MarcelloGuimaraes66/qual-hardware.git` como `origin` desta operação.
- Usar `main` como branch-base, confirmando-a no remoto antes de publicar.
- Ler e seguir `AGENTS.md` e `$qual-hardware-system` antes de agir.
- Não carregar workflows, memórias, skills, prompts, bancos, evidências ou regras de qualquer outro projeto.
- Não invocar Archon. Seguir `EXPLORE -> PLAN -> IMPLEMENT -> VALIDATE -> REVIEW -> COMPLETE -> MEMORY`.
- Manter trabalho não trivial em branch e worktree explícitos `codex/*`.
- Registrar decisões e resultados duráveis aplicáveis em `docs/runs/`.

## Preservar as invariantes

- Manter Qual Hardware e `qual-hardware.sqlite` independentes do Perceptrum.
- Não permitir que calibração execute Perceptrum ou acesse suas câmeras, credenciais, arquivos, APIs ou bancos.
- Não publicar calibrações `.qhcal`, mídia, bancos SQLite, credenciais, chaves, dados locais ou artefatos de usuário.
- Preservar `PRAGMA user_version = 9`; fazer extensões de calibração aditivas e append-only.
- Preservar dados existentes, evidências, arquivos, branches e worktrees.
- Manter Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64 como alvos obrigatórios.
- Não promover capacidade para aquisição sem evidência física e gates exatos de compatibilidade.
- Não fazer `push --force`, reescrever histórico, usar `--no-verify` ou contornar proteção de branch.
- Não fazer commit diretamente na `main` e não apagar branches automaticamente.
- Não misturar alterações do usuário ou de outros agentes com a entrega.

## Reconhecer uma implementação grande

Aplicar este fluxo quando pelo menos uma condição existir:

- alterar vários módulos, camadas, contratos, plataformas ou superfícies do produto;
- introduzir feature, arquitetura, dependência, runtime, integração, catálogo ou fluxo relevante;
- modificar calibração, medição, telemetria, capacidade, evidência ou elegibilidade de aquisição;
- alterar SQLite, migrações, persistência, backup, segurança ou cadeia append-only;
- modificar relatórios, anexos de licitação, preços, especificações técnicas ou fontes oficiais;
- alterar interface, lifecycle desktop, empacotamento ou distribuição com impacto amplo;
- exigir vários critérios de aceite ou apresentar risco que justifique revisão formal.

Na dúvida, tratar como grande. Usar também em mudança menor quando o usuário invocar esta skill explicitamente.

## Separar publicação de integração

- **Publicar:** executar `commit -> push -> PR` quando o escopo estiver concluído, as invariantes preservadas e a validação obrigatória tiver passado ou estiver honestamente registrada como pendente em um draft.
- **Integrar:** fazer merge somente quando o PR contiver exatamente o SHA testado, os checks e revisões exigidos tiverem passado, não houver conflito ou gap crítico, os testes manuais necessários estiverem aprovados e o usuário autorizar depois de ver o estado real do PR.

## Preparar o gate de publicação

1. Confirmar a raiz do repositório, `origin`, worktree, branch atual, branch-base e SHA inicial.
2. Parar se estiver em detached HEAD, na `main` ou fora de uma branch `codex/*` para trabalho não trivial.
3. Inspecionar `git status`, diff completo, arquivos não rastreados e commits da branch.
4. Identificar somente os caminhos da implementação atual. Separar alterações alheias.
5. Bloquear arquivos inesperados, segredos, bancos, mídia, calibrações, resultados, caches, pacotes e artefatos gerados indevidos.
6. Confirmar critérios de aceite e revisar regressões nas invariantes do produto.
7. Executar `git diff --check` e as validações proporcionais à superfície alterada.

Usar conforme aplicável:

```sh
npm run typecheck
npm test
npm run build
npm run desktop:package:dir
npm run desktop:smoke
npm run desktop:package
```

- Para mudança somente em skill ou documentação, validar Markdown, YAML, links, referências e diff; não executar build sem relação com o risco.
- Para código compartilhado, executar typecheck, testes e build.
- Para UI ou lifecycle desktop, compilar e testar a aplicação na plataforma afetada.
- Para SQLite, migração, calibração, catálogo, relatório ou gate de compra, executar os testes específicos e provar preservação de dados e evidência.
- Para release, executar pacote nativo e checklist manual da plataforma atual; usar a matriz GitHub e checklists nativos para Windows, macOS e Ubuntu.
- Diferenciar teste automatizado, build, empacotamento, inspeção e teste manual.
- Abrir como draft quando faltar plataforma nativa, teste manual, check obrigatório ou revisão.
- Parar antes do commit diante de falha obrigatória, regressão conhecida, segredo, arquivo inesperado ou risco crítico não tratado.

## Executar a sequência obrigatória

### 1. Commit

1. Adicionar apenas caminhos exatos com `git add -- <caminhos-exatos>`.
2. Não usar `git add .` ou `git add -A` indiscriminadamente.
3. Revisar `git diff --cached --stat`, `git diff --cached --name-status` e o diff staged.
4. Seguir a convenção de mensagem e hooks do repositório.
5. Criar o commit e guardar o SHA.
6. Não avançar se o commit, hook ou conteúdo staged falhar.

### 2. Push

1. Enviar a mesma branch e o mesmo SHA imediatamente após o commit bem-sucedido:

   ```sh
   git push -u origin <branch>
   ```

2. Usar `git push origin <branch>` nos envios seguintes.
3. Confirmar remoto, branch e SHA publicados. Parar diante de rejeição ou divergência; nunca forçar.

### 3. Pull request

1. Abrir ou atualizar um único PR da branch publicada para `main`.
2. Reutilizar PR aberto da mesma branch em vez de criar duplicata.
3. Manter draft quando existir validação obrigatória pendente; caso contrário, marcar pronto para revisão.
4. Incluir no corpo:
   - problema e objetivo;
   - escopo implementado;
   - riscos e invariantes preservadas;
   - impacto em Windows, macOS e Ubuntu;
   - comandos de teste/build e resultados reais;
   - testes manuais e plataformas pendentes;
   - migração, backup e rollback quando aplicáveis;
   - itens explicitamente não validados.
5. Não incluir dados locais, calibrações, bancos, mídia, credenciais ou logs extensos.
6. Guardar número, URL, destino, estado e SHA do PR.

### 4. Pergunta obrigatória

Depois que o PR existir, apresentar branch, SHA, URL, estado dos checks e lista exata de validações. Perguntar:

> Os testes técnicos listados acima e os testes manuais necessários foram concluídos e aprovados? Se sim, você autoriza agora o merge do PR #<numero> na `main`?

Esperar a resposta. Considerar autorizado somente um “sim” inequívoco para os testes e o merge. Se a resposta confirmar apenas uma parte, esclarecer o restante. Se os testes faltarem ou falharem, manter o PR aberto como draft e não fazer merge.

Mesmo que a solicitação inicial mencione merge, repetir a pergunta depois de apresentar o PR e as evidências reais.

## Fazer merge somente após autorização

1. Reconfirmar repositório, PR, `main`, branch de origem e SHA testado.
2. Verificar checks, aprovações, conflitos, conversas bloqueantes e proteção de branch.
3. Revalidar e repetir a pergunta obrigatória se o SHA mudar após os testes ou a autorização.
4. Impedir merge enquanto houver falha, conflito, draft obrigatório, revisão pendente ou gap crítico não aceito.
5. Usar a estratégia configurada no repositório; perguntar se não houver padrão definido.
6. Fazer merge sem bypass administrativo e confirmar o SHA resultante na `main`.
7. Não apagar a branch, limpar a árvore, alterar dependências ou iniciar release/deploy automaticamente.

## Relatar o resultado

Antes da autorização, informar branch, commit, SHA, push, PR, destino, estado, testes e gaps. Depois do merge, informar a autorização recebida, estratégia, estado final e SHA na `main`, mantendo a branch preservada.

Nunca afirmar commit, push, PR, teste, pacote ou merge sem evidência observada.
