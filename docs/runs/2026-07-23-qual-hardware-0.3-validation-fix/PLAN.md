# Plano executado — calibração autônoma 0.3

## Objetivo

Corrigir e validar a calibração local completa sem Perceptrum, rede externa, senha ou elevação administrativa, preservando o schema SQLite 9 e os alvos macOS arm64, Windows x64 e Ubuntu x64.

## Base e isolamento

- Worktree: `/Users/marcellogmf66/Documents/qual-hardware-0.3-validation-fix`
- Branch: `codex/qual-hardware-0.3-validation-fix`
- Base: `b124d1b01efece7fe503b131ae36617af00ce465`
- Sequência: explorar, planejar, implementar, validar, revisar, concluir e registrar memória.
- Runtimes locais e modelos grandes ficam fora do Git convencional.

## Critérios de conclusão

- Teste físico de validação com duração mínima de 3.600 segundos.
- Progresso terminal persistido e exibido como 100% somente após resultado e limpeza.
- CPU e Metal medidos funcionalmente.
- Nenhum erro de infraestrutura, processo órfão ou temporário remanescente.
- Capacidade técnica calculada por nível e gargalo.
- `.qhcal` Ed25519, `.qhcal.json.gz` e resumo legível exportados e verificáveis.
- Banco permanece em `user_version = 9`.

