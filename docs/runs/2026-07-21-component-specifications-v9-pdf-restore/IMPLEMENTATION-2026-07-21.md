# Implementação — especificações por campo e restauração do PDF

## Execução T4

O fluxo `archon-plan-to-pr` foi selecionado conforme as instruções globais, porém o runtime Archon não pôde ser iniciado porque `CLAUDE_BIN_PATH` não está configurado e a credencial GitHub disponível no ambiente é inválida. Conforme autorização do usuário, o mesmo rito foi executado manualmente em worktree isolado, sem consumir créditos.

- Base: `f43c4bc`.
- Branch: `archon/component-specifications-v9-pdf-restore`.
- Worktree: `component-specifications-v9-pdf-restore`.
- Risco: T4.
- Exclusões: nenhum código ou banco do Perceptrum foi alterado; nenhum push, Release ou cron foi ativado.

## Banco e contratos

O schema v9 preserva todas as estruturas v1–v8 e acrescenta observações imutáveis por campo, resoluções, conflitos, heranças, mapeamentos de fonte, versões de parser e seções numeradas de relatório. Antes de migrar um banco persistente mais antigo, o desktop cria uma cópia consistente com `VACUUM INTO` em `schema-backups`.

Os contratos novos distinguem claramente:

- valor oficial de SKU exato;
- valor oficial de família, matriz ou plataforma;
- valor secundário;
- valor legado sem proveniência de campo.

Conflitos de mesma autoridade são preservados e bloqueiam completude; nenhuma escolha é feita silenciosamente.

## Fontes e fotografia embarcada

Foram implementados mapeamentos exatos e parsers determinísticos para páginas oficiais de SKU. A primeira fotografia revisada contém 37 observações oficiais:

- Intel Core Ultra 9 285K: 24 campos oficiais e 100% dos campos críticos do perfil CPU atual.
- NVIDIA GeForce RTX 5090: 13 campos oficiais e 46,15% dos campos críticos do perfil GPU atual.

A tentativa de coleta da página oficial do AMD Ryzen 9 9950X foi registrada como indisponível por timeout. Nenhum valor AMD foi inventado nem copiado de fonte secundária para preencher a ausência.

## Relatórios

O PDF combinado volta a começar com o resumo comercial do modelo anterior. Para cada uma das três configurações principais, adiciona capítulos numerados no formato:

- `1.` máquina;
- `1.1` componente;
- `1.1.1` especificação detalhada;
- `1.1.1.1` grupo técnico.

O texto usa português do Brasil, acentuação, quebra por largura real da fonte e justificação de parágrafos. Cada campo oficial apresenta valor normalizado, valor original, unidade, fonte, data, localização da evidência e estado de resolução. Campos ausentes são declarados, nunca preenchidos com zero.

O JSON evoluiu para `capacity-recommendation-export/6.0.0` e inclui `componentTechnicalSpecifications`. O XLSX acrescentou a aba **Especificações detalhadas**. O anexo neutro permanece separado e remove identificadores comerciais inclusive das listas internas de equivalência.

## Segurança comercial

Especificação oficial e benchmark de desempenho continuam gates independentes. Esta implementação melhora a descrição técnica e a rastreabilidade, mas não torna apta uma configuração que não tenha benchmarks elegíveis e calibrações físicas suficientes. O relatório marca explicitamente as opções bloqueadas.
