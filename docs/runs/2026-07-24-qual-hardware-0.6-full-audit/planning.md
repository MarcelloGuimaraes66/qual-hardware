# Planejamento — auditoria integral do Qual Hardware 0.6

## Objetivo

Entregar uma única versão do Qual Hardware para Windows que abra sem pacote de runtime externo, permita dimensionar infraestrutura sem calibração obrigatória, execute calibrações dinâmicas com cargas VÍDEO FULL e FRAME e produza relatórios compreensíveis em PDF, TXT, XLSX e JSON.

## Classificação e alcance

- Risco: T4, pois o trabalho atravessa inicialização, descoberta de ambiente, pipeline de carga, persistência, interface, relatórios e empacotamento.
- Plataforma fisicamente validada nesta execução: Windows x64.
- Plataformas preservadas pelo desenho e pelos adaptadores: Ubuntu x64 e macOS Apple Silicon.
- Ubuntu e macOS ainda exigem compilação e validação nativas; esta máquina Windows não pode fornecer evidência física dessas plataformas.
- Hardware fisicamente disponível: um processador físico e uma GPU NVIDIA elegível para processamento. O caminho multi-CPU/multi-GPU tem cobertura automatizada, mas sua comprovação física exige outro equipamento.

## Invariantes

- Nenhum arquivo `.qhruntime` é necessário para abrir ou executar o diagnóstico genérico.
- Nenhum download ou instalador é executado automaticamente.
- A calibração usa somente endereços locais e não envia dados para a internet.
- Falha de infraestrutura nunca se transforma em limite de câmeras.
- O número de câmeras informado é a semente da busca, não o teto.
- O resultado principal é a capacidade operacional segura; o maior valor aprovado e a primeira reprovação permanecem separados.
- Um benchmark genérico não libera compra nem homologação comercial.
- O projeto de dimensionamento pode ser usado sem calibração, mas permanece identificado como planejamento quando a evidência física é insuficiente.

## Estratégia de validação

1. Verificação de tipos e testes automatizados.
2. Compilação do benchmark nativo e do aplicativo.
3. Empacotamento Windows e teste de abertura do pacote.
4. Calibração rápida com 12 câmeras.
5. Dimensionamento com a mesma assinatura de carga.
6. Calibração de engenharia com 60 minutos de carga.
7. Auditoria textual, numérica e visual de todos os relatórios.
8. Limpeza de arquivos transitórios e execução da suíte completa.
