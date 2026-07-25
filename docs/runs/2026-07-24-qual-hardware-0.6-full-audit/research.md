# Pesquisa e diagnóstico

## Problemas confirmados

- O benchmark nativo podia exceder o limite de espera porque o processo controlador usava um prazo incompatível com a duração real da fase.
- A calibração podia apresentar tempo restante igual a zero ou muito menor que as fases ainda pendentes.
- A interface não deixava suficientemente claro que o dimensionamento pode ser executado antes da calibração.
- A composição VÍDEO FULL/FRAME não aparecia de forma inequívoca na capacidade extrapolada.
- O relatório reutilizava nomes como `8 câmeras — FRAME` na capacidade segura, gerando frases contraditórias como `8 câmeras — FRAME: 99`.
- Um ensaio de engenharia podia receber, em uma orientação secundária, o rótulo textual de diagnóstico.
- Planilhas com textos longos podiam ter linhas baixas demais.
- Fluxos antigos de instalação de runtime ainda apareciam em contratos e rotas de transição, embora não devam fazer parte da operação atual.

## Evidência da máquina

- Sistema: Windows 10.0.26200.
- CPU: Intel Core Ultra 9 275HX.
- Topologia: 1 processador físico, 24 núcleos e 24 threads.
- Memória: 31,4 GB utilizáveis.
- GPU de processamento: NVIDIA GeForce RTX 5090 Laptop.
- GPU integrada: Intel Graphics, classificada somente para exibição nesta execução.
- Rede detectada: Wi‑Fi com 866,7 Mbps; duplex físico não comprovado.

## Decisões técnicas

- Manter o helper de topologia e o benchmark C++ como componentes internos compilados com o projeto.
- Usar os programas encontrados na máquina apenas depois de autoteste e registrar caminho, versão, hash e origem.
- Recorrer ao benchmark nativo interno quando o pipeline local completo não estiver disponível.
- Preservar a proporção entre os grupos de câmera em cada nível da busca dinâmica.
- Aplicar margem operacional de 20% ao maior valor sustentável.
- Mostrar `pelo menos N` quando o gerador ou o ensaio não encontrar uma primeira reprovação.
- Bloquear afirmações comerciais quando faltarem telemetria térmica, enlace físico validado ou evidência exata do pipeline.
