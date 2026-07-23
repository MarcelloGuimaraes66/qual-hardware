# Memória Archon — Qual Hardware 0.4

- Branch: `codex/windows-multi-cpu-gpu-capacity`.
- Base sincronizada: `f6199c3898c5f44402b4d27d3bcee4c065a31a45`.
- `logos/` permaneceu não versionada e seus checksums foram preservados.
- Contrato principal: X câmeras é semente, não teto.
- Número comercial principal: capacidade operacional segura com 20% de margem.
- Limite bruto, primeira falha e bound aparecem separadamente.
- Sem fronteira adjacente repetida não existe resultado `exact`.
- Limite do gerador produz `at_least`.
- Telemetria completa é automática; não há quantidade manual de CPU/GPU.
- Multi-GPU exige carga e telemetria por dispositivo, prova isolada, prova
  combinada e cenário degradado.
- Planejamento de frota vai até 1.000.000 de câmeras e permanece
  `planning_only` sem piloto de cluster.
- SQLite suportado: v10, migração aditiva com backup verificado.
- Exportação: `capacity-recommendation-export/7.0.0`.
- O runtime Windows `1.0.0-candidate.1` foi revisado com licença, SBOM, tamanho
  e hashes, assinado pela chave interna `qual-hardware-candidate-2026`,
  instalado e aceito pela app com 9/9 ativos e 3/3 contratos verificados.
- A confiança candidata não autoriza distribuição, assinatura de produção nem
  homologação comercial.
- Por decisão explícita do proprietário, o agente não inicia testes de esforço:
  o diagnóstico rápido será iniciado exclusivamente pelo usuário na interface.
