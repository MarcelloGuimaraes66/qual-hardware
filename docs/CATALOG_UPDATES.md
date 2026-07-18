# Atualização de especificações e preços

O executável do Qual Hardware e o catálogo têm ciclos de atualização independentes. O aplicativo inclui um catálogo de referência para funcionar offline; preços sem evidência continuam aparecendo como `cotação necessária`.

## Fluxo administrativo explícito

1. Em uma máquina administrativa, um publicador executa explicitamente `npm run catalog:collect` com fontes/API em allowlist e registra resultados no SQLite próprio do Qual Hardware.
2. Itens são identificados por MPN exato. Correspondências aproximadas não entram automaticamente.
3. Um revisor aprova alterações de especificação, compatibilidade ou produto antes da publicação.
4. O publicador executa explicitamente `npm run catalog:sign`. A chave privada Ed25519 fica somente no ambiente administrativo de publicação.
5. O arquivo JSON assinado é publicado em uma URL HTTPS privada/VPN.
6. O desktop verifica a assinatura com a chave pública, substitui equipamentos e preços em uma única transação SQLite e guarda a última cópia assinada válida no perfil local nativo do Windows, macOS ou Ubuntu.

O repositório não contém worker contínuo, servidor hospedado nem agendador desse fluxo. Se a organização desejar execução periódica, o agendamento pertence à infraestrutura administrativa externa e deve apenas invocar os dois utilitários explícitos acima.

O botão **Atualizar hardware** fica sempre visível no rodapé. No desktop, ele abre uma janela com duas opções:

- configurar a URL HTTPS privada e a chave pública Ed25519 para consulta automática;
- configurar apenas a chave pública e importar manualmente um `catalog-snapshot.json` assinado.

A configuração local fica em `catalog-update-config.json`, no mesmo perfil privado do banco SQLite. Ao iniciar, o desktop carrega essa configuração e tenta atualizar quando houver URL. Se a rede estiver indisponível, o arquivo estiver adulterado ou a assinatura for inválida, o catálogo anterior permanece ativo.

Cada recomendação grava `catalog-version:<versão>` nas evidências. Cotações com mais de 72 horas aparecem como defasadas. Quando não existe cotação assinada atual, o desktop usa uma estimativa de referência datada, mostra a fonte e continua exigindo cotação de compra; nunca mostra zero nem apresenta a estimativa como oferta de vendedor.

## Fontes e frequência

- Especificações: fontes oficiais de Intel, AMD, NVIDIA, Apple, ASUS e fabricantes OEM, revisadas quando houver lançamento ou alteração.
- Preços: diariamente para Brasil, Estados Unidos e Alemanha; apenas fontes permitidas e produtos novos/disponíveis.
- Câmbio: cada estimativa ou snapshot registra a fonte e a data da conversão; o modelo embarcado usa referências oficiais de BCB, BCE e Federal Reserve.
- Falha de coletor: mantém a última observação, aumenta sua idade e não apaga a rastreabilidade.

O agendamento do publicador de catálogos é responsabilidade de uma rotina administrativa separada e externa a este aplicativo. O executável desktop apenas baixa/importa e verifica o snapshot assinado; ele não faz scraping direto das lojas.

## O que precisa ser provisionado

O mecanismo já está no aplicativo, mas a atualização automática só fica ativa depois que a Aiquimist publicar a URL HTTPS/VPN do catálogo. A chave privada fica exclusivamente no publicador; somente a chave pública é distribuída aos desktops. Antes da URL existir, a mesma assinatura permite distribuir snapshots manualmente pelo botão de importação. Sem configuração, o aplicativo permanece funcional com o catálogo incluído no executável; ele não inventa atualizações nem preços.
