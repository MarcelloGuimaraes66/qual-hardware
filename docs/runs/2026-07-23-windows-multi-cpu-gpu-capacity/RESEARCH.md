# Pesquisa — Windows, multi-CPU/multi-GPU e capacidade máxima

Data: 2026-07-23

Autoridade de processo: Archon global

Risco: T4

## Base confirmada

- A árvore de trabalho foi atualizada por fast-forward para
  `f6199c3898c5f44402b4d27d3bcee4c065a31a45`.
- A pasta local `logos/` permaneceu não versionada e os dois SHA-256 foram
  preservados antes e depois da atualização.
- A branch de implementação é
  `codex/windows-multi-cpu-gpu-capacity`.
- O baseline passou com Node 24.18.0, npm 11.16.0 e Go 1.26.5:
  typecheck; 26 arquivos/208 testes Vitest; testes Go do probe.
- Um primeiro Vitest com quatro workers perdeu um processo depois de 196
  aprovações. A repetição com dois workers concluiu integralmente; o evento
  fica registrado como variabilidade local de execução.

## Máquina Windows de referência

- ASUS ROG Strix SCAR 18 G835LX.
- Intel Core Ultra 9 275HX, um socket, 24 núcleos e 24 processadores lógicos.
- 32 GiB de RAM.
- NVIDIA GeForce RTX 5090 Laptop GPU, 24 GiB, driver 592.00.
- Intel Graphics integrada, que não deve ser promovida automaticamente a
  segunda GPU de inferência.
- Wi-Fi ativo a 650 Mbps; Ethernet 2,5 GbE desconectada.

## Lacunas comprovadas na versão 0.3

1. O inventário agrega CPUs e GPUs em campos escalares.
2. O pipeline escolhe um único `gpuInferenceDevice`.
3. A telemetria retorna máximos/somas do conjunto, sem identidade por GPU.
4. O modo rápido testa somente o patamar solicitado.
5. Os patamares fixos podem chamar de `exact` um valor sem testar o inteiro
   imediatamente superior.
6. O limite de 4.096 câmeras mistura capacidade de nó com tamanho da frota.
7. O manifesto Windows ainda não contém todos os artefatos físicos aprovados.

## Decisões

- Manter uma base TypeScript comum e concentrar topologia nativa no probe Go
  e nos adaptadores de plataforma.
- Usar execução data-parallel por GPU como padrão; divisão de modelo somente
  quando necessária ou empiricamente superior.
- A capacidade oficial será conservadora e separada do limite de saturação.
- Resultados físicos multi-dispositivo exigem telemetria e carga por
  dispositivo; fixtures não substituem o gate físico.
