# Especificações neutras e controle de competitividade

## Finalidade e limite jurídico

O Qual Hardware produz memória técnica de apoio a contratações regidas pela Lei 14.133/2021. O resultado não substitui ETP, pesquisa de mercado, mapa de riscos, minuta de edital, parecer jurídico ou aprovação da autoridade competente. A equipe de contratação deve revisar o documento conforme o modelo vigente da AGU e a regulamentação do órgão.

Referências estruturais: orientações do TCU sobre [requisitos da contratação](https://licitacoesecontratos.tcu.gov.br/4-1-3-requisitos-da-contratacao/), [Termo de Referência](https://licitacoesecontratos.tcu.gov.br/4-3-termo-de-referencia-tr/) e [modelos da AGU para a Lei 14.133](https://www.gov.br/agu/pt-br/composicao/cgu/cgu/modelos/licitacoesecontratos/14133/pregao-e-concorrencia).

## Como o requisito é formado

O motor parte do workload: câmeras, codecs, resolução, FPS RTSP, FPS AiQ, retenção, Jobs, Steps, Agents, Intelligence, banco e dashboard. Em seguida calcula demanda por estágio, margens, quantidade de nós e N+1. A configuração comercial serve somente como referência interna. O requisito neutro usa o mínimo funcional necessário e inclui justificativa, prova e aceite.

Exemplos:

- CPU: núcleos mínimos e desempenho sustentado elegível, não família comercial;
- GPU: VRAM utilizável, codecs, backend e inferência comprovada, não marca;
- SSD: capacidade, escrita sustentada, IOPS, latência e endurance calculadas, não o máximo de uma ficha escolhida;
- NIC: velocidade necessária com reserva e drivers suportados, não modelo;
- refrigeração: sustentação térmica demonstrada, não uma denominação de linha.

Se uma tecnologia proprietária for indispensável, o sistema marca a restrição. A equipe deve justificar tecnicamente e obter revisão jurídica; o aplicativo não esconde a dependência sob a expressão “equivalente ou superior”.

## Gates independentes

Uma opção somente pode chegar a `apt` quando:

1. a recomendação é `validated_local` ou `extrapolated_high`;
2. cada componente crítico tem especificação oficial completa;
3. cada estágio de desempenho tem benchmark/calibração elegível;
4. a BOM é compatível;
5. não há identificador comercial na seção neutra;
6. a pesquisa encontra ao menos três produtos e dois fabricantes para todos os requisitos obrigatórios.

Dois produtos de fabricantes diferentes resultam em `review_required`. Um produto/fabricante ou nenhuma cobertura resulta em `blocked`.

## Verificador de direcionamento

O anexo separado remove fabricante, marca, modelo, MPN, SKU, vendedor, preço, URL e IDs de correspondência. O motor também verifica tokens comerciais nos textos. O relatório combinado mantém a referência comercial em uma seção claramente interna para comparação, seguida da seção neutra.

## APIs e auditoria

- `GET /api/catalog/components/:id/specifications`: especificação atual por campo;
- `GET /api/catalog/components/:id/specifications/history`: histórico append-only;
- `GET /api/catalog/specifications/coverage`: completude agregada;
- `GET /api/recommendations/:id/procurement-competition`: gate de mercado por opção;
- `GET /api/recommendations/:id/export/tr-docx|tr-pdf|tr-json`: anexo separado.

O banco v9 preserva v1–v8 e armazena definições, observações oficiais por campo, resoluções, conflitos, artefatos, versões de parser, valores, completude, requisitos e correspondências de mercado.
