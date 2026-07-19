# Implementação — diário

## 2026-07-18

- Worktree isolado criado a partir de `46e0849`.
- Estado atual e contratos 1.0 verificados.
- Invariantes, orçamento, segurança, validação e rollback registrados antes da edição de código.
- Contratos 1.0/1.1, handoff, telemetria e sessões foram adicionados sem remover dados anteriores.
- O SQLite evoluiu aditivamente para v5 com `calibration_sessions`; o banco e o diretório de dados existentes permanecem intactos.
- O servidor passou a criar tokens descartáveis de 256 bits, entregar o plano diretamente em loopback, receber progresso/resultado autenticado e conciliar arquivos salvos quando necessário.
- O Electron valida exclusivamente `perceptrum://calibration/run`, mantém CSP/sandbox e abre a pasta de resultados pela ponte desktop restrita.
- A interface ganhou centro permanente, modos de 10/60 minutos, telemetria avançada, progresso ao vivo, histórico e painel completo com FPS RTSP/AiQ separados.
- A primeira execução física de 10 minutos preservou o JSON, mas revelou incompatibilidade real em `utilizationEvidence` (texto no produtor e lista no consumidor). O contrato do Perceptrum foi alinhado para lista e a integração foi repetida com os pacotes finais.
- Métricas térmicas ou de fornecedor ausentes passaram a aceitar `null` e motivo explícito; capacidade não comprovada nunca é exibida como zero medido.
- O pacote macOS arm64, o DMG e o smoke empacotado foram gerados com sucesso. Evidências finais estão em `VALIDATION.md`.
