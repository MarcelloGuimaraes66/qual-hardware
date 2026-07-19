# Código — superfícies previstas

## Qual Hardware

- `src/shared/types.ts`: versões, handoff, telemetria e sessão.
- `src/shared/schemas.ts`: validação compatível 1.0/1.1 e handoff.
- `database/sqlite-schema.sql`: tabela aditiva de sessões.
- `src/server/store.ts`: persistência e transições de sessão.
- `src/server/calibrationSessions.ts`: token, URI, documentos e conciliação.
- `src/server/app.ts`: criação, plano, progresso, resultado e consulta.
- `src/desktop/main.ts`: ponte restrita para o protocolo Perceptrum.
- `src/web/App.tsx`, `src/web/CalibrationResultPanel.tsx` e CSS: centro permanente, progresso e resultado.
- testes: contratos, segurança, persistência, reconciliação e interface.

## Perceptrum

- Contrato 1.1, telemetria, armazenamento, handoff e hosts nativos já estão no worktree isolado correspondente.
- A validação final verificará os dois lados do mesmo contrato antes de empacotar.

## Restrições

- Não alterar cálculo de capacidade fora do consumo das novas evidências.
- Não introduzir dependência nativa obrigatória.
- Não executar shell com entrada do operador.
- Não persistir token em claro nem expor origem que não seja loopback.
