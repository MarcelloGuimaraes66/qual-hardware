# Especificação — Qual Hardware 0.4

Data: 2026-07-23

Risco: T4

## Resultado obrigatório

O Qual Hardware detecta automaticamente a topologia completa do nó, mede
todos os dispositivos elegíveis e devolve:

- capacidade operacional segura;
- maior carga aprovada;
- primeira carga reprovada;
- tipo do limite (`exact`, `at_least` ou `uncertain`);
- capacidade degradada;
- alocação por CPU/NUMA/GPU;
- plano de servidores para até 1.000.000 de câmeras.

Nenhuma API ou tela aceita quantidade manual de CPU ou GPU.

## Contratos

- Hardware: `qual-hardware-calibration-hardware/2.0.0`.
- Evidência compute: `qual-hardware-calibration-compute-evidence/2.0.0`.
- Resultado local: `qual-hardware-local-calibration/4.0.0`.
- Runtime: `qual-hardware-calibration-runtime-manifest/3.0.0`.
- Frota: `qual-hardware-fleet-plan/1.0.0`.
- Exportação: `capacity-recommendation-export/7.0.0`.
- SQLite: versão 10, somente migração aditiva.

Contratos anteriores permanecem legíveis. Somente v4 pode homologar uma nova
execução multi-dispositivo.

## Regras de capacidade

1. A quantidade informada define o perfil e a semente; nunca o teto.
2. A descoberta expande a carga até formar um intervalo aprovado/reprovado.
3. A busca refina o intervalo até valores adjacentes.
4. `exact` exige aprovação de `N` e reprovação repetida de `N+1`.
5. Se o gerador alcançar seu limite, o resultado é `at_least`.
6. Inconsistência na fronteira produz `uncertain`.
7. A capacidade operacional candidata é `floor(maiorAprovada × 0,80)`.
8. O valor final é o mínimo entre todos os limites de estágio.
9. Quick e validation nunca liberam compra.
10. Qualification exige três blocos de oito horas, telemetria completa,
    zero throttling, zero crescimento de fila e entrega/inferência >= 99,5%.

## Regras de frota

- Até nove nós ativos: um nó reserva.
- Dez ou mais: 10% de reserva, com mínimo de dois nós.
- Cada nó conserva 20% de margem.
- Multi-nó é `planning_only` até validação física de cluster.
- A recomendação informa recursos por nó e totais do projeto.

## Segurança

Permanecem obrigatórios: loopback, zero OpenAI, zero mídia/credencial de
usuário, execução isolada, persistência antes de 100%, arquivos append-only e
limpeza confinada ao diretório da sessão.
