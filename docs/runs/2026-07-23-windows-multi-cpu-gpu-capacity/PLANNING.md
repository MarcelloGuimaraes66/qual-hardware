# Planejamento de implementação — Qual Hardware 0.4

Data: 2026-07-23

## Ordem de trabalho

1. Criar os tipos e schemas aditivos de topologia, dispositivos, fronteira de
   capacidade e frota.
2. Evoluir o detector e o probe para inventário/telemetria por dispositivo.
3. Substituir a seleção de GPU única por um plano automático e execução
   data-parallel ponderada.
4. Introduzir expansão, busca binária e confirmação da fronteira.
5. Separar capacidade de nó de quantidade total do projeto.
6. Gerar plano de frota, migração SQLite v10 e exports v7.
7. Atualizar interface sem controles manuais de hardware.
8. Validar regressão, pacote Windows, smoke e teste rápido físico.

## Gates

- Typecheck web/servidor/ferramentas.
- Vitest completo com timeout Windows de 15 segundos.
- Testes e builds determinísticos do probe Go.
- Build e pacote desempacotado.
- Smoke source-only e, quando os ativos estiverem disponíveis, smoke físico.
- Teste rápido preserva banco, tráfego zero e zero temporários.
- Nenhuma alegação multi-CPU/multi-GPU é comercial sem hardware físico
  correspondente.
