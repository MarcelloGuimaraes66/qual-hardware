# Validação

## Cenário

- 12 câmeras no total.
- 4 câmeras VÍDEO FULL, sem mosaico, modelo AiQ Max.
- 8 câmeras FRAME, modelo AiQ Core.
- 5 FPS na origem.
- 12 Jobs ativos.

## Calibração rápida

- Sessão: `4c3dda6b-651f-4c79-b9c9-b0163cb6c64e`.
- Resultado: `276ec286-765b-44bd-8446-b782df03f81a`.
- Carga informada: aprovada.
- Busca aprovada em 12, 24, 48, 96 e 186 câmeras.
- Capacidade operacional segura: 148 câmeras.
- Composição segura: 99 FRAME e 49 VÍDEO FULL.
- Primeira reprovação: não encontrada.
- Interpretação: pelo menos 186 câmeras passaram; o máximo absoluto da máquina não foi encontrado.

## Calibração de engenharia

- Sessão: `a6f0f85c-b28a-409d-9f0e-5326157b69bf`.
- Resultado: `4ff5f4b5-28aa-45d2-9b50-50b06645e458`.
- Duração total observada: 66,47 minutos, incluindo descoberta e consolidação.
- Fases de carga: 300, 600, 2.100 e 600 segundos.
- Inferência bem-sucedida: 100% em todas as fases.
- Crescimento de fila: zero.
- Falhas de memória: zero.
- Capacidade segura: 148 câmeras, sendo 99 FRAME e 49 VÍDEO FULL.
- Maior carga aprovada: 186 câmeras.
- Primeira reprovação: não encontrada.
- Limite: `at_least`.
- Gargalo com menor margem: inferência local.
- Tráfego externo: zero.
- Temporários criados: 1.107.430.172 bytes.
- Temporários removidos: 1.107.430.172 bytes.
- Temporários remanescentes: zero.

## Validade

O resultado é uma capacidade estimada por benchmark nativo com validade de engenharia para planejamento. Ele não homologa compra. Permanecem necessários:

- telemetria térmica compatível;
- enlace físico cabeado com velocidade e duplex comprovados;
- validação física da configuração que será adquirida;
- ensaio em hardware multi-CPU/multi-GPU para comprovar esse caminho;
- validação nativa separada em Ubuntu e macOS.

## Relatórios auditados

- PDF de engenharia: 3 páginas A4, sem sobreposição ou corte, com parágrafos justificados.
- XLSX de engenharia: 8 abas, zero erro de fórmula, composição informada e segura separadas.
- TXT: português brasileiro, sem nomes internos indevidos e com interpretação explícita do limite.
- JSON: modelo estruturado equivalente aos demais formatos.
- PDF de dimensionamento: 11 páginas, três alternativas, servidores ativos/reserva e especificações por servidor.

## Verificações automatizadas

- Testes direcionados de relatórios e progresso: 18 aprovados.
- Verificação de tipos: aprovada.
- Benchmark nativo: compilado e autoteste aprovado.
- Pacote Windows: compilado.
- Smoke test do pacote Windows: aprovado.
- Suíte completa: 35 arquivos aprovados; 274 testes aprovados e 2 ignorados de forma intencional.
- Integridade SQLite após reinício: `ok`; sessão, resultado e limpeza recarregados pela API local.
