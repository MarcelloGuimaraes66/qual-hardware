# Provisionamento auditável dos ativos offline

Data: 2026-07-21

## Finalidade

O comando `npm run calibration:runtime:prepare` prepara um alvo completo do runtime sem baixar arquivos e sem inferir licença, versão ou origem. Os binários, modelos, textos de licença e SBOMs devem ser fornecidos previamente por uma fonte autorizada.

O modo padrão é somente leitura: valida a entrada, calcula hashes e apresenta o hash do manifesto proposto. A opção `--apply` é obrigatória para gravar qualquer coisa.

```text
npm run calibration:runtime:prepare -- --intake /caminho/absoluto/intake.json
npm run calibration:runtime:prepare -- --intake /caminho/absoluto/intake.json --apply
```

## Contrato de entrada

- `schemaVersion`: `qual-hardware-calibration-asset-intake/1.0.0`.
- `target`: `darwin-arm64`, `win32-x64` ou `linux-x64`.
- `assets`: exatamente os nove IDs exigidos pelo manifesto.
- Cada item informa `id`, `sourcePath`, `version`, `licenseSpdx`, `licenseEvidencePath` e `sbomEvidencePath`.
- Todos os caminhos de origem são absolutos, regulares, não vazios e não podem ser links simbólicos.
- O SBOM deve ser JSON CycloneDX com `bomFormat` e `specVersion`.

IDs obrigatórios:

`ffmpeg`, `ffprobe`, `mediamtx`, `llama-server`, `telemetry-probe`, `qwen-core-gguf`, `qwen-core-mmproj`, `qwen-core-max-gguf` e `qwen-core-max-mmproj`.

## Aplicação segura

Ao aplicar, a ferramenta:

1. Revalida todo o inventário e todos os hashes.
2. Recusa versões ou licenças conflitantes com outro alvo já preparado.
3. Recusa aplicar sobre um diretório de alvo existente.
4. Monta os arquivos em um diretório de staging com UUID dentro da raiz controlada.
5. Confere o hash de cada cópia.
6. Define permissão de execução para binários Unix.
7. Preserva uma cópia única do manifesto anterior em `manifest-backups/`.
8. Promove o diretório completo e o manifesto de forma atômica.
9. Remove somente os arquivos transitórios de staging criados pela própria execução.

A ferramenta não adiciona automaticamente o hash ao mapa de manifestos comercialmente aprovados. Essa promoção continua dependendo de revisão de licenças, validação do pacote e execução física na plataforma correspondente.
