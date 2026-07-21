# Implementação - parágrafos justificados

## Alterações realizadas

- O escritor do relatório passou a medir cada palavra com a largura real da fonte Helvetica incorporada ao PDF.
- As linhas internas de um parágrafo distribuem somente o espaço necessário entre palavras.
- A última linha permanece alinhada à esquerda.
- Linhas que exigiriam lacunas maiores que 2,2 vezes o espaço natural voltam automaticamente ao alinhamento à esquerda.
- Palavras maiores que a largura útil são divididas com segurança, evitando cortes fora da página.
- O relatório evita iniciar um parágrafo de várias linhas quando só resta espaço para uma linha.
- A justificação foi aplicada somente à narrativa executiva, aos alertas em linguagem natural e às premissas.
- A seção de outras máquinas qualificadas passou a iniciar em página própria para não deixar o título órfão.

## Superfície preservada

- Conteúdo e ordem do relatório comparativo.
- Títulos, listas, métricas, custos, especificações e URLs.
- Endpoint e nome de download do relatório.
- Anexo técnico neutro e demais exportações.
- Banco de dados, cálculos e contratos.
