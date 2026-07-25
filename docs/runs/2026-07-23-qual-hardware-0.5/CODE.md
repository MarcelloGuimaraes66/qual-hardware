# Registro de código

## Contratos e modelos

- `perceptrum-workload/4.0.0`: separa VÍDEO FULL e FRAME, backend e escopo.
- `qual-hardware-calibration-kernel-authority/2.0.0`: congela o comportamento do Perceptrum usado como autoridade.
- `qual-hardware-calibration-pipeline-contract/2.0.0`: descreve o pipeline equivalente local.
- `qual-hardware-local-calibration/5.0.0`: registra conclusão, tentativas, composição e evidência multi-dispositivo.
- `qual-hardware-calibration-plan/4.0.0` e kernel `3.0.0`.
- intercâmbio `.qhcal`/`.qhcalset` `3.0.0`.
- diagnóstico `qual-hardware-calibration-diagnostic-report/1.0.0`.

## Núcleo

- `src/engine/calibrationProfile.ts`: perfil normalizado, proporções determinísticas e assinatura estável.
- `src/engine/capacityDiscovery.ts`: expansão/redução, busca binária, repetição de infraestrutura e fronteira tipada.
- `src/server/calibrationOutcome.ts`: classificação entre falha de capacidade e falha de infraestrutura.
- `src/server/calibrationPipeline.ts`: preflight funcional, VÍDEO/FRAME, execução CPU/GPU e telemetria.
- `src/server/calibrationKernelWorker.ts`: orquestração automática, evidência por dispositivo e resultado v5.

## Diagnóstico

- `src/engine/calibrationDiagnostic.ts`: modelo canônico usado por todos os formatos.
- `src/server/calibrationDiagnosticReport.ts`: TXT em português, PDF com fonte Unicode e XLSX com oito planilhas.
- `src/web/CalibrationResultPanel.tsx`: resposta direta, fronteira, gargalo, busca, frota e ações.

## Persistência

- SQLite v11 adiciona `calibration_probe_results` e `calibration_diagnostic_reports`.
- Os arquivos de diagnóstico são associados à execução por SHA-256.
- Migração aditiva; dados anteriores e pacotes históricos continuam legíveis.
