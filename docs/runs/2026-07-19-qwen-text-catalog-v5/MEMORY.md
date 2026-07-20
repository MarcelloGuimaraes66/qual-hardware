# Memória — seleção local do Qwen textual

- O Qual Hardware usa IA somente como auxiliar de classificação de evidências.
- O Perceptrum é o responsável por gerar calibrações reais; não deve ser alterado por esta tarefa.
- Melhor modelo textual atualmente instalado: Qwen3-32B Q4_K_M, hash `efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689`.
- Bundles públicos precisam registrar o modelo realmente usado e continuar reproduzíveis.
- A estação local descobre o modelo automaticamente; o desktop do operador continua consumindo somente o bundle assinado e não carrega o modelo.
- O runner usa um `llama-server` efêmero em loopback e uma única carga do modelo por lote.
- O Qwen textual nunca é evidência de capacidade de câmeras e nunca substitui a calibração física do Perceptrum.
