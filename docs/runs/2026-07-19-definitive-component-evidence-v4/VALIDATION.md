# Relatório de validação

## Gates planejados

- [x] Migração v6→v7 aditiva e idempotente exercitada pelos testes de abertura/schema.
- [x] Catálogo canônico e aliases sem duplicidade.
- [x] Compatibilidade de plataforma/BOM explicável.
- [x] Benchmarks órfãos e unidades incompatíveis rejeitados.
- [x] Blender impedido de representar AiQ.
- [x] Qwen impedido de criar números.
- [x] Fórmulas conservadoras; capacidade segura nunca maior que a bruta.
- [x] Quinze estágios obrigatórios cobertos ou aquisição bloqueada.
- [x] Cenários e políticas N+1 preservados, inclusive 64–256 câmeras.
- [x] API, React, PDF, XLSX e JSON v4.
- [x] Publisher dry-run real, checksum, integridade e regressão de cobertura.
- [x] Typecheck, 83 testes e build.
- [x] Pacote descompactado/smoke macOS arm64.
- [x] Definições CI Windows 11 e Ubuntu 24.04 preservadas no mesmo TypeScript/lockfile.

## Resultado

## Evidência executada

- `npm run typecheck`: aprovado.
- `npm test`: 83/83 testes aprovados em 10 arquivos.
- `npm run build`: aprovado.
- `npm run desktop:package:dir`: aplicativo macOS arm64 empacotado sem assinatura.
- `npm run desktop:smoke`: aprovado após alinhar o gate ao contrato de exportação 4.0; o smoke removeu seu diretório temporário.
- Dry-run público: 21 sistemas, 218 componentes, 18 benchmarks, zero órfãos, duas observações SPEC elegíveis para CPU e zero componentes qualificados.
- Varredura de onze fontes: 22 observações coletadas; construção recusada pelo gate de saúde porque cinco fontes falharam. Nenhum snapshot incompleto foi ativado.

## Limites que permanecem visíveis

- Windows e Ubuntu têm código, CI e adaptadores comuns, mas a homologação física futura não foi simulada neste Mac.
- Não há três calibrações físicas completas comparáveis. Logo, nenhuma configuração foi liberada para aquisição.
- As 16 observações MLPerf coletadas usam outro tamanho de Qwen e permanecem corretamente `reference_only`.
- STREAM, fio, FFmpeg e OpenCV públicos ainda não possuem observações importadas: as páginas cadastradas exigiram acesso interativo e nenhuma proteção foi contornada.
- O bundle desta execução é um dry-run não assinado e não foi publicado.

Resultado: implementação técnica aprovada no macOS, com gate comercial deliberadamente bloqueado até a coleta física mínima.
