# PLANNING — atualização automática quinzenal

## Classificação e objetivo

- Risco: T4.
- Base: `0846ff7`.
- Branch/worktree: criado pelo Archon, isolado da refatoração anterior.
- Objetivo: publicar snapshots públicos, assinados e append-only a cada 15 dias e fazer o desktop consumi-los automaticamente, sem configuração do operador.

## Fatos verificados

- O desktop atual usa Electron 43.1.1, Node 24, SQLite v3 e API aleatória em `127.0.0.1`.
- A atualização existente exige URL e chave configuradas e aceita um snapshot assinado de catálogo.
- O repositório público ainda não possui Releases, segredo de assinatura ou workflows no branch padrão.
- O commit-base contém 45 testes e matriz de pacote nativa para Windows, macOS e Ubuntu.

## Invariantes

- Não mover, recriar, limpar ou excluir bancos, projetos, snapshots, evidências ou Releases.
- Preservar cálculos, calibrações, seis alternativas, relatórios, loopback, sandbox, `appId`, `productName` e nome do SQLite.
- Nenhuma chamada OpenAI e nenhum dado do operador enviado ao GitHub ou ao Qwen.
- Em qualquer erro, manter o último bundle válido ou o catálogo embarcado.
- Um único TypeScript, lockfile e comportamento para Windows 11 x64, macOS arm64 e Ubuntu x64.

## Raio de impacto e orçamento

- Contratos compartilhados e schemas.
- Cinco tabelas aditivas e `user_version=4`.
- Serviço de atualização e persistência atômica.
- APIs e painel informativo.
- Registro de fontes, coletor, classificador Qwen opcional e publicador.
- Um workflow de catálogo e extensão dos smokes/testes.
- Documentação e artefatos desta execução.

Não haverá mudança no motor de dimensionamento, salvo a janela de validade das cotações prevista no contrato.

## Fases

1. Contratos, schema v4 e registro de fontes.
2. Fetch seguro, observações, validação, Qwen limitado e montagem do bundle.
3. Assinatura, cadeia, checksum e ativação atômica.
4. Canal GitHub oficial, ETag, inicialização e atualização a cada 24 horas.
5. APIs e interface sem configuração operacional.
6. Workflow diário com gate de 15 dias, retry, issue de saúde e publicação append-only.
7. Testes unitários, integração, pacote/smoke macOS e matriz GitHub.
8. Chave, primeira publicação, revisão e memória.

## Rollback e bloqueios

- Reverter integralmente o PR/commit; o schema é apenas aditivo e dados antigos continuam legíveis.
- Bloquear publicação por assinatura inválida, rollback, cadeia quebrada, perda de cobertura, câmbio vencido, reconciliação incorreta ou testes vermelhos.
- Bloquear ativação se a matriz nativa não estiver verde.
