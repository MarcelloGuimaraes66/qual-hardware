# Especificação — catálogo de componentes e recomendação v4

## Contratos

- `qual-hardware-component-catalog/1.0.0`
- `qual-hardware-benchmark-observation/2.0.0`
- `qual-hardware-component-build/1.0.0`
- `qual-hardware-evidence-catalog/4.0.0`
- `qual-hardware-capacity-prediction/3.0.0`
- `capacity-recommendation-export/4.0.0`
- `perceptrum-workload/3.1.0`

Versões antigas continuam legíveis, mas ausência de campos críticos bloqueia aquisição.

## Domínio

O inventário distingue CPU, GPU, placa-mãe/plataforma, memória, SSD operacional, SSD de retenção, NIC, fonte, refrigeração, chassi, sistema OEM e rack. Cada item possui identidade canônica, aliases, especificações versionadas, estado de mercado, fontes e cobertura.

Existem dois universos explícitos:

- `discovered_inventory`: SKU descoberto e preservado para auditoria.
- `qualified_recommendation_universe`: item com compatibilidade e evidência suficientes para participar do configurador.

## Configurador

1. Converte o cenário no workload 3.1.
2. Calcula demanda por quinze estágios.
3. Valida socket, chipset, BIOS, RAM, PCIe, GPU, codecs, potência, térmica, SSD, NIC, OS e backend.
4. Monta BOM OEM exata ou BOM customizada compatível.
5. Calcula previsões por estágio usando somente observações comparáveis.
6. Aplica erro empírico, variação e reserva.
7. Usa o menor estágio como gargalo.
8. Aplica N+1 para 64–256 câmeras.
9. Bloqueia qualquer configuração sem cobertura integral.
10. Ordena as aprovadas por custo; preferência Intel/NVIDIA e diversidade só atuam após o gate técnico.

## APIs

- `GET /api/catalog/components`
- `GET /api/evidence/coverage`
- `GET /api/evidence/components/:id`
- `GET /api/catalog/builds/:id`

As recomendações atuais recebem campos opcionais `bom`, `stagePredictions`, `coverage` e `procurementGate`, preservando clientes existentes.

## Gate comercial

- `validated_local` ou `extrapolated_high`: potencialmente `eligible`, desde que todos os estágios e a compatibilidade estejam aprovados.
- `extrapolated_medium`: planejamento.
- `reference_only` ou `incompatible`: bloqueado.
- Menos de três âncoras comparáveis: bloqueado independentemente do inventário público.
