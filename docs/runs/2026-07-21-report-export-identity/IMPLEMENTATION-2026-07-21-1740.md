# Implementação - exportação sem ambiguidade

## Alterações

- O relatório principal ganhou um bloco destacado e um único botão `BAIXAR RELATÓRIO PDF`.
- O nome local foi corrigido para `qual-hardware-recomendacoes.pdf`.
- XLSX e JSON permanecem no mesmo bloco como auditoria complementar.
- O anexo neutro foi movido para uma área recolhida e recebe aviso explícito de que não é o relatório de recomendações.
- Botões neutros agora se chamam `ANEXO DOCX`, `ANEXO PDF` e `ANEXO JSON`.
- Mensagens posteriores ao download identificam o tipo real do documento.
- README, arquitetura e validação deixaram de afirmar que o PDF principal contém Parte II.

## Preservação

Os dois geradores e todas as rotas foram preservados. Banco, recomendações, preços, contratos e dados não foram alterados.

## Orquestração

Fluxo T2 executado manualmente em worktree isolado, sem consumo de créditos Archon.
