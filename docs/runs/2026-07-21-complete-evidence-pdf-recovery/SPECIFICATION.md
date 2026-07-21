# Especificação funcional

## Relatório principal

O PDF combinado deve manter, nesta ordem:

1. Cabeçalho do projeto.
2. Resumo em linguagem natural.
3. Três configurações sugeridas.
4. Opções avaliadas em ordem crescente de custo.
5. Workload de câmeras, FPS RTSP e FPS AiQ separados.
6. Proposta mínima.
7. Proposta recomendada.
8. Proposta N+1.

Cada proposta deve conter todos os blocos do PDF de referência. Parágrafos explicativos devem ser justificados; listas, métricas, URLs e identificadores devem permanecer alinhados à esquerda para não criar espaçamento artificial.

## Caderno técnico

Após o relatório principal, todas as máquinas únicas avaliadas devem aparecer em custo crescente. Para a máquina `N`:

- `N`: referência comercial.
- `N.1`, `N.2`...: componentes.
- `N.1.1`: especificação detalhada do componente.
- `N.1.1.1`: grupo técnico.
- `N.1.1.1.1`: campo oficial.
- `N.A`: compatibilidade, benchmarks, calibrações e avisos.
- Seção final da máquina: especificação técnica não comercial e competitividade.

Campo não publicado deve ser apresentado como ausente, nunca como zero ou inferência.

## Gate comercial

- Especificação oficial completa não equivale a benchmark.
- Benchmark público não equivale a calibração do Perceptrum.
- Sem três calibrações físicas comparáveis e cobertura dos quinze estágios, a opção permanece `reference_only` e bloqueada.
