# Planejamento — recuperação do PDF e evidências oficiais

## Classificação

- Risco: T4.
- Branch isolada: `codex/restore-complete-pdf-and-evidence`.
- Base preservada: `b38637a`.
- Fluxo Archon: indisponível neste ambiente porque `CLAUDE_BIN_PATH` não está configurado e o token GitHub local não é válido; o mesmo protocolo foi executado manualmente, sem consumir créditos.

## Fatos verificados antes da edição

- O PDF de referência possui 9 páginas A4 e conserva resumo executivo, alternativas, carga e três propostas completas.
- O PDF corrente possuía 27 páginas e misturava a apresentação comercial com IDs de BOM, quinze estágios e avisos internos repetidos.
- O Ryzen 9 9950X tinha URL oficial registrada, mas a coleta terminava por timeout ou falso positivo de CAPTCHA.
- A GeForce RTX 5090 tinha 46,15% dos campos críticos oficiais.
- Não existem calibrações físicas completas importadas; portanto nenhuma recomendação pode ser liberada para aquisição.

## Invariantes

- Preservar cenários, cálculos, preços, bancos, contratos e relatórios existentes.
- Não reduzir o gate de aquisição nem transformar especificação oficial em benchmark.
- Não apagar evidências nem arquivos do usuário.
- Manter um único TypeScript e lockfile para macOS, Windows e Ubuntu.
- Manter o anexo técnico neutro separado e sem identificadores comerciais.

## Orçamento de mudança

- Um gerador de PDF.
- Parser, registro e mapeamento das fontes oficiais AMD/NVIDIA.
- Snapshot embarcado de campos oficiais revisados.
- Definições técnicas aditivas de GPU.
- Testes diretamente afetados e documentação desta execução.

## Validação planejada

1. Typecheck.
2. Testes de especificações, migração, publicação e relatórios.
3. Coleta real das URLs AMD e NVIDIA.
4. Geração do conjunto completo de relatórios.
5. Renderização do PDF em imagens e inspeção visual.
6. Suíte integral, build, pacote nativo e smoke do desktop.

## Rollback

Reversão integral do commit desta branch. A mudança não inclui migração destrutiva nem remoção de dados.
