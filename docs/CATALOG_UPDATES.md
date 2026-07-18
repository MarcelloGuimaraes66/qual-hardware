# Atualização de especificações e preços

O executável do Qual Hardware e o catálogo têm ciclos de atualização independentes. O aplicativo inclui um catálogo de referência para funcionar offline; preços sem evidência continuam aparecendo como `cotação necessária`.

## Fluxo privado diário

1. O worker do banco separado `qual_hardware` executa `npm run catalog:collect` com fontes/API em allowlist.
2. Itens são identificados por MPN exato. Correspondências aproximadas não entram automaticamente.
3. Um revisor aprova alterações de especificação, compatibilidade ou produto antes da publicação.
4. O publicador executa `npm run catalog:sign`. A chave privada Ed25519 fica somente nesse worker.
5. O arquivo JSON assinado é publicado em uma URL HTTPS privada/VPN.
6. O desktop verifica a assinatura com a chave pública, aplica o catálogo e guarda a última cópia válida no perfil local do Windows.

Configure o desktop com `QUAL_HARDWARE_CATALOG_URL` e `QUAL_HARDWARE_CATALOG_PUBLIC_KEY`. Ao iniciar, ele tenta atualizar; a interface também oferece **Atualizar agora**. Se a rede estiver indisponível ou a assinatura for inválida, o catálogo anterior permanece ativo.

Cada recomendação grava `catalog-version:<versão>` nas evidências. Cotações com mais de 72 horas aparecem como defasadas; ausência de preço confiável nunca é substituída por zero ou por valor inventado.

## Fontes e frequência

- Especificações: fontes oficiais de Intel, AMD, NVIDIA e fabricantes OEM, revisadas quando houver lançamento ou alteração.
- Preços: diariamente para Brasil, Estados Unidos e Alemanha; apenas fontes permitidas e produtos novos/disponíveis.
- Câmbio: PTAX/BCE no serviço privado de catálogo.
- Falha de coletor: mantém a última observação, aumenta sua idade e não apaga a rastreabilidade.

O agendamento é responsabilidade da infraestrutura privada (por exemplo, tarefa diária no worker). O executável não faz scraping direto das lojas.
