# Dicionário de especificações técnicas

## Regra geral

Cada campo tem código semântico estável, rótulo em português, tipo, unidade canônica, valor original, valor normalizado, estado, papel, fonte e evidência. Somente `published` com confiança `official` conta para completude. `not_published`, `ambiguous`, `conflicting` e `rejected` nunca são convertidos em zero.

Papéis:

- `compatibility`: impede combinações elétrica, mecânica ou logicamente inválidas;
- `dimensioning`: participa da capacidade ou da escolha do requisito mínimo;
- `procurement`: pode aparecer na especificação neutra;
- `informational`: ajuda auditoria, suporte ou ciclo de vida.

## Campos críticos por categoria

### CPU

Arquitetura, núcleos físicos, threads, potência base, soquete, tipo e canais de memória, ECC e geração PCIe são críticos. Clocks, cache, potência turbo, processo, temperatura máxima, memória máxima, lanes, GPU e NPU são preservados quando publicados.

### GPU

Arquitetura, VRAM, tipo e largura de banda da memória, PCIe, potência, conectores, dimensões, espessura, codecs de encode/decode, backend e sistemas suportados são críticos. Unidades de processamento e restrições multi-GPU são extensões oficiais.

### Placa-mãe

Soquete, chipset, formato, memória, slots, capacidade, ECC, PCIe, M.2 e rede integrada são críticos. BIOS mínima, bifurcação, SATA, TPM e gerenciamento permanecem auditáveis.

### Memória

Capacidade, quantidade de módulos, tecnologia, velocidade, ECC e formato do módulo são críticos. Ranks, latência e tensão são preservados.

### SSD de sistema e retenção

Capacidade, interface, protocolo, formato, leitura/escrita sequencial, IOPS aleatório e TBW são críticos. Latência, DWPD, proteção contra perda de energia e criptografia são preservados quando publicados. Desempenho oficial continua separado do benchmark fio sustentado.

### NIC

Velocidade, portas, mídia, interface de host e sistemas suportados são críticos. RSS, offloads, MTU e RDMA são preservados.

### Fonte

Potência contínua, eficiência, conectores e proteções são críticos. Entrada, transientes e versão ATX são preservados.

### Refrigeração

Tipo, soquetes, capacidade térmica e dimensões são críticos. Fluxo e ruído são preservados. A capacidade declarada não substitui o ensaio térmico do sistema completo.

### Chassi

Formato, placas suportadas, comprimento/espessura de GPU, baias, slots, ventiladores e dimensões são críticos. Radiadores e unidades de rack são preservados.

### OEM e rack

BOM exata, expansão, potência, dimensões e suporte são críticos; redundância, gerenciamento, hot-swap e certificações completam a auditoria. Configuração OEM não pode ser tratada como peças livremente substituíveis quando o fabricante a bloqueia.

## Completude

`completeness.percent` é a proporção de campos críticos publicados oficialmente e resolvidos no nível do campo. `procurementReady` somente é verdadeiro com 100% dos campos críticos, ausência de conflito e SKU/MPN exato. Um link oficial anexado genericamente ao componente não promove valores legados. Esse gate não aprova desempenho: os benchmarks e as calibrações físicas continuam sendo um gate independente.

## Proveniência v9

Cada campo publicado aponta para uma ou mais `ManufacturerSpecificationObservation`. A observação informa escopo (`sku`, família, arquitetura ou plataforma), autoridade, rótulo e valor originais, normalização, parser, fonte, data, localização e hash. A resolução registra todas as observações consideradas e a justificativa. Herança de família ou plataforma precisa ser explícita e nunca tem a mesma precedência do SKU exato.
