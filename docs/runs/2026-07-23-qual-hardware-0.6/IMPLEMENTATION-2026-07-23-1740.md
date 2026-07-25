# Registro de implementação e validação

## Baseline

- TypeScript typecheck: PASS.
- Vitest: 28 arquivos, 232 aprovados, 2 ignorados.
- Go telemetry-probe: PASS.
- `git diff --check`: PASS, com avisos de normalização de linha existentes.

## Resultado 0.6

- TypeScript typecheck: PASS.
- Vitest: 30 arquivos aprovados; 238 testes aprovados e 2 ignorados.
- Go `telemetry-probe`: PASS.
- Build web, servidor e benchmark C++20 Windows x64: PASS.
- Pacote Windows desempacotado: PASS.
- Smoke funcional desempacotado: PASS, em benchmark nativo reduzido e sem
  executar o diagnóstico físico de 10 minutos.
- Executável portátil Windows x64: PASS.
- Smoke de extração, abertura, interface, APIs, relatórios e encerramento do
  portátil: PASS, sem repetir carga de capacidade.
- SHA-256 do portátil:
  `4B43181BC1778AE8ABAB60EA67A5A010BD758FFC8AEF5D8C039B038BB2D63792`.

Nenhum arquivo `.qhruntime`, modelo, FFmpeg ou programa de terceiro foi
incorporado ao pacote. A validação física de 10/60 minutos e a homologação
comercial permanecem reservadas ao operador.
