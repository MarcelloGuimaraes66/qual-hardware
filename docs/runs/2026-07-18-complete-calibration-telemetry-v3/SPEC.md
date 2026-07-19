# Especificação — sessão e resultado de calibração

## Contratos

- Handoff: `qual-hardware-calibration-handoff/1.0.0`.
- Resultado atual: `qual-hardware-local-calibration/1.1.0`.
- Resultado legado aceito: `qual-hardware-local-calibration/1.0.0`.

## Sessão

Uma sessão contém UUID, plano, modo, telemetria avançada, vínculo opcional com recomendação/cenário, hash SHA-256 do token, expiração, estado, progresso, resultado e timestamps. Estados: `pending`, `launching`, `running`, `completed`, `failed`, `expired`.

O segredo é base64url de 256 bits. A origem de callback é a origem HTTP loopback real da requisição. Plano, progresso e resultado exigem Bearer token e sessão válida. Um resultado concluído não pode ser substituído.

## Resultado 1.1

Além dos campos 1.0, inclui:

- capacidades de telemetria com `measured`, `unavailable`, `failed` ou `not_applicable`;
- resumos de CPU, GPU, decode, encode, memória, disco, rede e temperatura;
- resumos de processos Perceptrum, FFmpeg, MediaMTX e AiQ;
- evidência por etapa e fase, inclusive entrega real de quadros;
- status `diagnostic`, `anchor_approved` ou `invalid`;
- metadados e checksum do arquivo `.qhcal.json`.

## Interface

O centro de calibração é permanente na tela inicial e disponível nos resultados. Exibe modos rápido/completo, opção avançada, progresso, histórico e resultado completo. O resultado mostra veredito, hardware, capacidade, gargalo, FPS RTSP versus FPS AiQ, recursos, etapas, sensores indisponíveis, caminho/checksum e JSON expansível.

## Persistência e conciliação

- SQLite recebe apenas tabela aditiva `calibration_sessions`.
- O resultado é salvo em `calibration_runs` e previsões são recalculadas pela lógica existente.
- Na inicialização e consulta de sessão, arquivos `.qhcal.json` são considerados somente se `planId` corresponder a uma sessão pendente e o schema/checksum forem válidos.
- Nenhum arquivo existente é removido ou sobrescrito.

## Critérios de aceitação

- Compatibilidade 1.0/1.1 comprovada.
- Token inválido, expirado, repetido ou callback externo rejeitado.
- Resultado salvo/importado e visível, inclusive após reinício.
- FPS de leitura e inferência sempre separados.
- Ausência de métrica representada semanticamente, nunca como zero.
- Build e smoke desktop macOS passam; mesmo código compila nos runners Windows/Ubuntu.
