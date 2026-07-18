# Implementação — inteligência de capacidade e evidências

## Dados e cálculos

- SQLite evoluiu de forma aditiva para a versão 3, preservando cenários, catálogos, cotações, evidências e histórico anteriores.
- Snapshots de catálogo, preços e benchmarks possuem associação própria; somente o snapshot ativo participa do cálculo, sem apagar versões antigas.
- A extrapolação é feita por estágio do Perceptrum. CPU não substitui GPU, disco, rede, memória ou térmica.
- Classe A exige três hardwares físicos distintos e fortemente comparáveis; classe B exige dois; os demais permanecem `reference_only`.
- A margem efetiva usa o maior valor entre o piso da classe, pior superestimação leave-one-out e variabilidade das repetições.
- Calibrações legadas, rápidas, representativas ou sem prova integral do pipeline não podem justificar compra.

## Atualizações e preços

- O importador valida schema, Ed25519, HTTPS, tamanho, data e rollback. Falha mantém o snapshot anterior ativo.
- Cada tentativa registra início, resultado, diferenças, erro e explicação para o operador.
- Cotações com mais de 72 horas, data inválida ou futura são excluídas da faixa de mercado; referências componentizadas continuam explicitamente marcadas como estimativas.
- O coletor valida allowlist em cada redirecionamento, aplica timeout, respeita `robots.txt`, exige MPN exato e registra fonte/data da conversão BCB ou ECB.
- A ferramenta `evidence:sign` assina arquivo novo e recusa sobrescrita.

## Interface e relatórios

- A área de calibração explica o fluxo local, importa resultados e bases assinadas e mostra o histórico das atualizações.
- PDF, XLSX e JSON 2.3 incluem narrativa executiva, distinção dos FPS, evidência, margem, gargalo, custo, seis ou mais opções qualificadas e as três políticas.
- O PDF começa com texto conversacional em português e mantém acentuação antes das seções técnicas.
- O guia do coordenador e o protocolo de curadoria documentam a coleta com usuários e a base pública.
