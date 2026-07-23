# Validação final

## Execução física no macOS arm64

- Sessão: `ae9dbd9c-7245-4441-a0c7-b4d88a7717d4`
- Resultado: `bf20a333-8667-4815-b2fc-2385301cd5bf`
- Duração: 3.843,162 segundos (01:04:03), acima do mínimo de 60 minutos.
- Estado/progresso: `completed`, 100%.
- Saúde: `completed`; erros de infraestrutura: nenhum.
- Capacidade segura conservadora: 4 câmeras.
- Maior nível exercitado: 8 câmeras.
- Gargalo: `local_inference`.
- CPU: medida; 4 câmeras seguras.
- GPU Metal (`MTL0`) e VideoToolbox: medidas; 4 câmeras seguras.
- CPU + GPU: concorrência comprovada; 4 câmeras seguras.
- Inferência: 252 planejadas, 252 tentadas e 252 concluídas no conjunto técnico validado; 1.008 quadros empacotados.
- Pipeline: todas as fases concluídas; concorrência exata de câmeras comprovada.
- Limpeza: 590.584.272 bytes removidos; zero bytes remanescentes; diretório temporário da sessão removido.

O timeout no patamar superior de 8 câmeras permaneceu como evidência do limite físico da inferência CPU. Ele não é classificado como falha da aplicação nem como erro de infraestrutura do patamar seguro de 4 câmeras.

## Artefatos

- `bf20a333-8667-4815-b2fc-2385301cd5bf.qhcal`: SHA-256 `2ed3a6771338ae5040e8949f516f67037aa9dbe7e6272bbfd9a02743c7cb71c8`
- `bf20a333-8667-4815-b2fc-2385301cd5bf.qhcal.json.gz`: SHA-256 `294e26259e724a6bb9d4b19f6b878ddafaaa146b28635110951707917b046487`
- `bf20a333-8667-4815-b2fc-2385301cd5bf-resumo.txt`: SHA-256 `ac2767b8e802485ecda7b176aeae008b96fa6f589c3016452d36353ffc2a2968`
- Assinatura Ed25519 verificada.
- Reimportação pela própria API: pacote confiável, duplicado conhecido, zero conflito, zero inválido.

## Banco e confiança

- `PRAGMA user_version`: 9.
- `PRAGMA quick_check`: `ok`.
- Runtime: candidato, não promovido artificialmente a aprovação comercial.
- Sensores opcionais indisponíveis no macOS foram declarados, não inventados.

## Bateria final após a correção de interface

- TypeScript: sem erros nos projetos web, servidor e ferramentas de calibração.
- Vitest: 26 arquivos e 208 testes aprovados.
- Go: testes do probe aprovados.
- Cross-build do probe: macOS arm64, Windows x64 e Linux x64 reproduzíveis e com formato executável conferido.
- Auditoria npm de produção: zero vulnerabilidades.
- Smoke do aplicativo macOS empacotado: aprovado, incluindo calibração curta, exportação, cancelamento, reinício, reconciliação, SQLite 9 e limpeza.
- Aplicativo recompilado: `/Users/marcellogmf66/Documents/qual-hardware-0.3-validation-fix/release/mac-arm64/Qual Hardware.app`.
- API do pacote recompilado devolveu a sessão final como `completed`, 100%, e o diretório real de evidências.

## Outros sistemas

Contratos e builds do probe são validados para Windows x64 e Ubuntu x64. A capacidade física desses computadores só pode ser determinada executando o pacote em cada máquina e reunindo o `.qhcal` independente.

## Correção dos checks do PR

- TypeScript: aprovado.
- Vitest: 26 arquivos e 208 testes aprovados.
- Go telemetry probe: aprovado.
- Auditoria de isolamento da fonte: aprovada, sem acesso externo.
- Build web/servidor: aprovado.
- Smoke macOS com o runtime real: aprovado; o fluxo completo acelerado permaneceu funcional.
- Smoke macOS source-only, com o runtime temporariamente indisponível: aprovado; qualificação recusada com HTTP 503, zero calibrações persistidas e SQLite 9 preservado.
- O runtime real foi restaurado no pacote macOS após o teste source-only.
