# Planejamento T4 — base definitiva de componentes e benchmarks

- Data: 2026-07-19
- Branch: `archon/definitive-component-evidence-v4`
- Base imutável: `7bcc103`
- Workflow: equivalente manual a `archon-piv-loop`, porque o Archon está sem créditos.

## Fatos verificados

- O banco v6 preserva 21 sistemas, 49 componentes e cinco observações Blender secundárias.
- As tabelas normalizadas de suites, perfis, execuções e métricas ainda não possuem dados no banco operacional auditado.
- Não existe calibração física importada; por isso a aquisição permanece corretamente bloqueada.
- O motor atual extrapola quinze estágios, mas parte de sistemas predefinidos e ainda não monta BOMs arbitrárias.
- O publicador quinzenal, o canal assinado e o desktop multiplataforma já existem e devem ser adaptados, não substituídos.

## Invariantes

- Nenhum arquivo, banco, tabela, linha, evidência ou relatório existente será apagado, recriado ou sobrescrito.
- O schema v7 será estritamente aditivo e abrirá bancos v1–v6.
- Somente `validated_local` e `extrapolated_high` poderão receber `eligible`.
- Três calibrações completas comparáveis são o mínimo para extrapolação comercial; cinco são o alvo inicial.
- Qwen não extrairá nem decidirá números.
- O mesmo TypeScript, lockfile e contratos atenderão macOS, Windows 11 e Ubuntu 24.04.
- Não haverá push, ativação de cron ou Release nesta execução.

## Blast radius e orçamento de mudança

- Qual Hardware: contratos, SQLite v7, catálogo normalizado, configurador/BOM, ingestão de evidências, publisher, API, React, relatórios e testes.
- Perceptrum: contrato workload 3.1 e coordenação concorrente da calibração produtiva.
- Fora do orçamento: autenticação, dados do usuário, diretório do banco, auto-update do executável e promessa de homologação física não executada.
- Preferência: módulos novos e extensão aditiva; alterações no motor legado apenas nos pontos de integração.

## Sequência

1. Fixar contratos, requisitos e política de evidências.
2. Implementar schema v7 e migração idempotente.
3. Normalizar catálogo de componentes e regras de compatibilidade.
4. Montar e auditar BOMs OEM e customizadas.
5. Importar benchmarks por conectores determinísticos e gerar cobertura/rejeições.
6. Extrapolar por estágio, com gate comercial e N+1.
7. Expor API, interface e relatórios v4.
8. Corrigir a calibração concorrente no Perceptrum.
9. Validar banco, matemática, contratos, UI, builds e pacotes.

## Validação

- Migração v6→v7 em cópia temporária criada pelo teste, sem tocar o banco operacional.
- Unitários de compatibilidade, cobertura, fórmulas, monotonicidade, órfãos e anti-regressão.
- Fixtures versionadas para conectores públicos, sem depender da internet na suíte normal.
- Dry-run do publisher sem assinatura privada e sem publicação.
- Typecheck, testes, build e pacote macOS; CI define os mesmos passos para Windows e Ubuntu.

## Rollback

- Reverter somente os commits desta branch. As tabelas v1–v6 e todos os registros anteriores permanecem válidos.
- Bloquear conclusão em perda de dados, regressão de cobertura elegível, capacidade segura maior que a bruta, listener fora de loopback ou quebra de build.
