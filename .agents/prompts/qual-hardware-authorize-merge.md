# Autorizar merge do Qual Hardware

Use `$qual-hardware-system` e `$qual-hardware-finalize-large-implementation` exclusivamente no repositório:

`/Users/marcellogmf66/Documents/qual-hardware`

Substitua `<SHA_TESTADO>` e `<NUMERO_PR>` pelos valores reais apresentados após o primeiro prompt. Não execute este prompt enquanto algum placeholder permanecer.

Os testes técnicos apresentados e os testes manuais necessários referentes exatamente ao SHA `<SHA_TESTADO>` foram concluídos e aprovados.

Autorizo explicitamente o merge do PR `#<NUMERO_PR>` na branch `main` do repositório:

`https://github.com/MarcelloGuimaraes66/qual-hardware.git`

Antes do merge:

1. Confirme novamente que o diretório atual é o checkout canônico informado acima ou um worktree Git registrado dele com o mesmo diretório comum `.git`; confirme também o remoto oficial, o número do PR, a branch de origem e a branch-base `main`.
2. Confirme que o PR está aberto, não precisa permanecer como draft e contém exatamente o SHA `<SHA_TESTADO>` que foi validado.
3. Confirme que todos os checks obrigatórios desse mesmo SHA passaram e que os testes apresentados não pertencem a um commit anterior.
4. Confirme que não existem conflitos, revisões obrigatórias pendentes, conversas bloqueantes ou gaps críticos não aceitos.
5. Confirme que nenhum commit foi acrescentado depois dos testes ou desta autorização.
6. Se qualquer condição falhar ou o SHA tiver mudado, não faça o merge. Informe o bloqueio, execute novamente as validações afetadas e solicite uma nova autorização com o novo SHA.
7. Use somente a estratégia de merge configurada pelo repositório. Se não houver uma estratégia definida, pare e pergunte antes de escolher entre merge commit, squash ou rebase.
8. Não use bypass administrativo, force push ou qualquer mecanismo para contornar proteções.
9. Não apague a branch, o worktree, arquivos, dados ou artefatos depois do merge.
10. Não inicie release, deploy, atualização de dependências ou limpeza da árvore automaticamente.

Depois do merge, confirme no GitHub que o PR está com estado `MERGED` e informe:

- o SHA testado da branch;
- a estratégia de merge usada;
- o SHA resultante na `main` remota;
- o estado final dos checks;
- que a branch foi preservada;
- qualquer ação ainda pendente.
