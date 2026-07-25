# Implementação e validação

## Resultado

- Divergência observada de 12 câmeras no projeto contra 11 nos perfis:
  corrigida.
- Dimensionamento sem calibração: aprovado.
- Capacidade estimada total e por servidor: visível.
- Calibração reposicionada como ação opcional.
- Motivo de bloqueio do teste rápido: visível.
- Referência externa legada nas janelas: removida.

## Validação automatizada

- TypeScript typecheck: PASS.
- Vitest: 33 arquivos; 244 testes aprovados e 2 ignorados.
- `git diff --check`: PASS; somente avisos preexistentes de normalização de
  final de linha.
- Build Vite, servidor, benchmark C++20 e pacote Windows desempacotado: PASS.
- Helper Go isolado: não executado, pois o compilador Go não está instalado
  nesta máquina.

## Validação do executável, sem carga física

- Ambiente: `Pronto para diagnóstico e dimensionamento`.
- Cenário: 12 câmeras, 4 VÍDEO FULL e 8 FRAME.
- Soma automática: `12 / 12`.
- Botão de dimensionamento: habilitado.
- Resultado sem calibração: 22 câmeras estimadas no perfil selecionado,
  11 por servidor, 2 servidores ativos e 1 reserva na opção observada.
- CPU, GPU, RAM e rede por servidor e totais: exibidos.
- Botão `Diagnóstico — 10 minutos`: habilitado após o dimensionamento.
- Teste de 10 minutos: não iniciado.

O smoke extenso sem calibração excedeu o limite de 10 minutos durante sua
própria rotina de encerramento. A abertura, o DOM, o preflight, o
dimensionamento e a disponibilidade do botão foram validados diretamente no
executável reconstruído.
