# Implementação e validação — certificação Qwen3-VL

## Resultado funcional

- Descoberta física escolheu `C:\Program Files (x86)\Drakon\llm\bin\cuda\llama-server.exe`, build 9736 (`796f41bed`), em vez do executável CPU da raiz.
- Dispositivo confirmado: `CUDA0`, NVIDIA GeForce RTX 5090 Laptop GPU, driver 592.00.
- Revisão aprovada: `qwen3-vl-2b-instruct-q4_k_m-f16`.
- Modelo SHA-256: `089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae`.
- Projetor SHA-256: `c3d5afbef5287953acd57b4043d2269456e5761a4eaccb3b71b062996970aea5`.
- O protocolo final usa três imagens distintas: logotipo `AQ`, painel `RED` e painel `BLUE`; as duas requisições concorrentes repetem `AQ` e `RED`.
- Paralelismo validado: 2.
- O ambiente mudou para `ready_full` / `compatible_local_stack`, com Core e Core Max vinculados ao mesmo par 2B disponível.
- VRAM por processo não foi exposta pelo WDDM; incremento permaneceu no fallback conservador de 5,12 GiB.

## Testes automatizados

- Servidor falso Node multiplataforma: sucesso, resposta visual incorreta, falha concorrente, timeout de `/health`, crash, cancelamento e backend divergente.
- Seleção: Qwen textual recusado, memória insuficiente, cache vencido, seleção manual, macOS unificado e Ubuntu.
- Banco: persistência de ensaio/perfil e migração v12→v13 com preservação de cenário, três recomendações e calibração.
- Capacidade: perfil medido substitui a constante; piso acima de 75% elimina hardware.
- Compatibilidade: calibrações v1–v6 continuam legíveis e v7 exige certificação Qwen.
- Recuperação abrupta: arquivos auxiliares `journal`, `wal` e `shm` só são adotados quando pertencem ao `pipeline-probe.sqlite` previamente registrado; arquivos estranhos continuam preservados e bloqueiam a limpeza.
- Processo filho: a calibração agora cancela ao perder o coordenador e não continua órfã após queda do aplicativo.
- Multiplataforma: o inventário normaliza nomes com separadores Windows/POSIX e o servidor falso usa o backend real da plataforma (`CUDA`/`Metal`) nos ensaios de CI.
- Suíte final: 37 arquivos, 300 testes aprovados, 2 testes explicitamente ignorados e nenhuma falha.
- Auditoria npm: zero vulnerabilidades após fixar as versões transitivas corrigidas de `brace-expansion` e `tar`.

## Aceitação física e empacotada

- Portátil Windows x64 executado com perfil de dados novo e 8 câmeras.
- O diagnóstico físico longo usou o probe `94bc7fa3-9365-46c6-9b04-8ef22ede621c`, backend CUDA, antes do endurecimento das imagens.
- O protocolo final endurecido foi revalidado fisicamente no portátil: `AQ`, `red`, `blue`, `AQ` e `red` passaram, com paralelismo 2. O hash final do contrato, que invalida automaticamente caches do protocolo anterior, é `df793716677397f21b269629d889b6e2d4ff7e06cb5ca39488677916fcc0856b`.
- Diagnóstico nominal de 10 minutos executado sem aceleração (`timeScale=1`): run `7adf7c5b-8651-4ae7-871f-c2673568e0cc`, 6 min 14 s de parede devido à busca adaptativa de limite, estado `completed`, evidência `compatible_local_stack` e conclusão operacional `approved`.
- Resultado v7 vinculou a mesma assinatura Qwen Core/Core Max, manteve zero requisições externas/OpenAI e registrou base medida de 3.078.936.032 bytes, incremento conservador de 5.497.558.139 bytes e paralelismo máximo 2.
- O diagnóstico rápido mediu capacidade física preliminar de 148 câmeras, mas continuou `developmentOnly` e inelegível para extrapolação/aquisição. A etapa RTSP permaneceu `unavailable` neste diagnóstico; portanto esse número não é uma qualificação física completa nem libera compra.
- Persistência confirmada no SQLite v13; sessão terminou com progresso 100%, 37.020.034 bytes temporários removidos e zero bytes remanescentes.
- Smoke do portátil passou tanto no caminho fail-closed sem certificação quanto no caminho certificado com calibração, cancelamento, exportações, reinício e reconciliação.

## Comandos de validação

- `npm run typecheck`
- `npm test`
- `npm audit --audit-level=high`
- `npm run build`
- `npm run desktop:package`
- `npm run desktop:smoke`

## Artefato final

- Caminho: `C:\dev\perceptrum_desktop_aspp\qual-hardware\release\Qual-Hardware-0.6.0-windows-x64-portable.exe`
- Tamanho: 115.738.421 bytes (110,38 MiB).
- SHA-256: `66d26a21a2dd505362a839a194bce17b0475ad89a092fd3a603b5cb015fd4055`.
- Smoke empacotado: aprovado em Windows x64.

## Rollback

- Reverter os commits desta execução restaura o seletor v1, ambiente v1 e SQLite v12.
- A reversão não apaga as tabelas v13; um executável antigo recusará corretamente um banco mais novo em vez de interpretar dados desconhecidos.
- Para rollback operacional, usar a cópia criada em `schema-backups` antes da primeira abertura v13.
