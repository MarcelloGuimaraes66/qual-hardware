# Finalizar implementação grande do Qual Hardware

Use `$qual-hardware-system` e `$qual-hardware-finalize-large-implementation` exclusivamente no repositório:

`/Users/marcellogmf66/Documents/qual-hardware`

Considere a implementação grande atual concluída e candidata à publicação, sujeita aos gates abaixo.

Autorizo expressamente, para esta operação, o uso do remoto oficial para commit, push e abertura ou atualização do pull request:

`https://github.com/MarcelloGuimaraes66/qual-hardware.git`

A branch-base do pull request deve ser `main`.

Execute nesta ordem:

1. Leia `AGENTS.md`, `$qual-hardware-system`, `$qual-hardware-finalize-large-implementation` e os registros relevantes em `docs/runs/`.
2. Confirme que o repositório atual é o checkout canônico `/Users/marcellogmf66/Documents/qual-hardware` ou um worktree registrado dele. Em worktree, use `git worktree list` e `git rev-parse --git-common-dir` para provar que o diretório comum é exatamente o `.git` do checkout canônico. Confirme também que `origin` aponta exatamente para `https://github.com/MarcelloGuimaraes66/qual-hardware.git`. Pare diante de qualquer diferença.
3. Atualize somente as referências remotas necessárias com `git fetch origin` e confirme que a branch padrão remota continua sendo `main`.
4. Confirme worktree, branch e SHA. Use uma branch e worktree explícitos `codex/*`; não faça commit diretamente na `main`.
5. Compare `HEAD` com `origin/main` e verifique PRs abertos ou fechados da mesma branch. Se a branch estiver atrasada, divergente, conflitada ou associada a PR fechado sem merge, apresente o diagnóstico e a estratégia segura antes de rebase, merge, cherry-pick, novo PR ou reabertura. Não reescreva histórico nem reaplique commits sem autorização.
6. Inspecione `git status`, todos os diffs, arquivos não rastreados e commits da branch.
7. Identifique somente as alterações pertencentes à implementação atual.
8. Não inclua alterações alheias, credenciais, bancos SQLite, calibrações `.qhcal`, mídia, arquivos locais, temporários, caches, pacotes, zips ou artefatos indevidos.
9. Preserve a independência do Perceptrum, o SQLite `user_version = 9`, o histórico append-only e os alvos Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64.
10. Execute `git diff --check` e as validações proporcionais à superfície alterada. Para código, use typecheck, testes e build; para desktop ou release, use também pacote e smoke nativos; para skill ou documentação, valide Markdown, YAML, referências e diff.
11. Registre honestamente resultados, falhas, plataformas e testes manuais pendentes. Não chame build de teste manual e não reutilize checks de um SHA anterior.
12. Faça commit somente dos caminhos revisados. Não use `git add .` ou `git add -A` indiscriminadamente.
13. Faça push da mesma branch e do mesmo SHA para `origin`. Não use force push.
14. Abra ou atualize um único pull request dessa branch para `main`; reutilize somente PR aberto compatível e mantenha o PR como draft se houver validação obrigatória pendente.
15. Apresente branch, SHA, URL do PR, checks, testes executados, resultados e gaps.
16. Pare depois de abrir o PR e pergunte explicitamente se os testes foram aprovados e se autorizo o merge na `main`.

Não faça merge antes da minha confirmação posterior ao PR. Não apague branches, worktrees, arquivos, dados ou artefatos.

Depois que o PR e os testes forem apresentados, use o modelo `.agents/prompts/qual-hardware-authorize-merge.md` para conceder a autorização final com o SHA e o número reais.
