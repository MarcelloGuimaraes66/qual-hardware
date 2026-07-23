# Implementação — Qual Hardware 0.4

Data: 2026-07-23

## Entregue

- O total informado pelo usuário virou a semente da descoberta. O motor expande
  exponencialmente, localiza a primeira reprovação, faz busca binária e confirma
  a fronteira adjacente.
- O resultado diferencia capacidade operacional segura, maior carga aprovada,
  primeira carga reprovada e limites `exact`, `at_least` e `uncertain`.
- O gerador declara seu próprio limite seguro. Se esse limite for alcançado
  antes da máquina falhar, o resultado é `at_least`, nunca um máximo inventado.
- O inventário registra sockets, núcleos, threads, grupos de processadores,
  NUMA, memória, GPUs por UUID/PCI, VRAM, drivers, backends e enlaces físicos.
- O Windows usa as APIs nativas de grupos e NUMA por P/Invoke; a base Linux e
  macOS continua isolada nos adaptadores de plataforma.
- O executor cria lanes CPU e GPU, divide threads automaticamente, habilita
  distribuição NUMA no llama.cpp e fixa FFmpeg/llama.cpp na GPU selecionada.
- Em hosts multi-GPU são medidos cada dispositivo isolado, todos em data
  parallel ponderado e um cenário degradado após perda de GPU. Falta de carga ou
  telemetria individual invalida a evidência v2.
- O planejador aceita até 1.000.000 de câmeras e produz frota compacta com
  capacidade segura por servidor, ativos, reservas, sockets, núcleos, RAM,
  GPUs, VRAM, rede, armazenamento, gargalo e capacidade degradada.
- A redundância é N+1 até nove servidores ativos e 10%, mínimo dois, a partir
  de dez. Projetos multi-servidor permanecem `planning_only` até piloto.
- SQLite v10 preserva v9, cria backup verificado e adiciona topologia,
  resultados por dispositivo, fronteiras e planos de frota.
- UI, JSON v7, XLSX e PDF mostram a capacidade segura como número principal e
  mantêm o limite bruto como evidência diagnóstica.
- A telemetria passou a ser automática e obrigatória, sem controle manual de
  quantidade de CPU, GPU ou sensor.

## Compatibilidade

Os contratos v1–v3 continuam legíveis como histórico. Somente resultados
`qual-hardware-local-calibration/4.0.0` com evidência compute v2 podem sustentar
alegações multi-dispositivo.
