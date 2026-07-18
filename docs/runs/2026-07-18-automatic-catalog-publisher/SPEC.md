# SPEC — canal público de catálogo

## Contratos

- `qual-hardware-source-registry/1.0.0`: fontes, hosts, parsers, mercados, limites e saúde.
- `qual-hardware-catalog-bundle/1.0.0`: sequência, validade, hash anterior, catálogo, componentes, benchmarks, preços, fontes e proveniência.
- Envelope: `{ payload, keyId, signature }`, Ed25519 sobre o JSON canônico do payload.

## Segurança

- Somente HTTPS; loopback HTTP apenas em teste.
- Releases futuras, downgrade de sequência, cadeia quebrada, chave desconhecida e conteúdo acima do limite são recusados.
- O bundle é persistido e ativado em uma transação SQLite; uma falha não produz estado parcial.
- Descoberta não sai dos hosts e redirects cadastrados.

## Preços

- Atual por 18 dias; entre 18 e 30 dias apenas referência; acima de 30 dias exige cotação.
- Duas fontes independentes geram confiança de mercado; uma gera confiança baixa.
- Outlier acima de 40% da mediana exige confirmação independente.
- Câmbio oficial deve ter no máximo dois dias na publicação.

## Interface

- Atualização automática na abertura e a cada 24 horas.
- Painel informa última publicação, próxima coleta, contagens, mercados, saúde, atraso, novidades e rejeições.
- Importação manual permanece recuperação avançada; URL/chave somente em desenvolvimento/admin.

## Aceitação

- Migração v3→v4 sem perda.
- Assinatura, checksum, cadeia, anti-rollback e ETag testados.
- Falha externa preserva o catálogo ativo.
- Nenhuma chamada OpenAI.
- Mesma base e mesmo bundle aceitos nos três sistemas.
