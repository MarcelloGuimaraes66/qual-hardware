# Implementacao - especificacoes oficiais e anexo neutro v8

## Execucao

O workflow Archon T4 foi roteado para `archon-plan-to-pr`, mas o ambiente nao possuia o runtime configurado para executar o harness. A implementacao seguiu manualmente o mesmo rito em worktree isolado, branch `archon/procurement-specifications-v8`, partindo do commit `c2f005c`.

## Entregas tecnicas

- Contratos tipados e schemas JSON para catalogo de componentes v2, especificacao tecnica, especificacao neutra, anexo de TR e exportacao v5.
- Perfis de campos oficiais por categoria, com valor original, valor normalizado, unidade, estado, evidencia, confianca e papel no dimensionamento.
- Migracao SQLite v8 exclusivamente aditiva, com historico append-only de artefatos, versoes, campos, completude, requisitos e equivalencias.
- Derivacao de requisitos neutros pelo workload e pela margem operacional, sem copiar mecanicamente o produto comercial.
- Analise de competitividade pela intersecao dos requisitos: adequada, limitada, restrita ou sem cobertura.
- Verificador de identificadores comerciais e bloqueio de configuracoes sem evidencia, completude ou concorrencia.
- Referencia comercial e especificacao neutra para todas as alternativas unicas, em ordem crescente de custo.
- Exportacao combinada PDF/XLSX/JSON e anexo tecnico neutro separado em PDF/DOCX/JSON.
- APIs de especificacao, historico, cobertura, competitividade e exportacao.
- Interface com completude por componente, fontes, lacunas, comparacao comercial/neutra e alertas de direcionamento.
- Publicador quinzenal ampliado com fontes oficiais, extracao deterministica, preservacao do valor original e gate de regressao de cobertura.

## Decisoes de seguranca

- Fatos legados sem evidencia oficial no nivel do campo permanecem `ambiguous` e nao aumentam a completude.
- Pagina generica de fabricante sem SKU e campo comprovavel nao qualifica componente.
- Especificacao oficial comprova caracteristica, mas nunca substitui benchmark nem calibracao fisica.
- Valor ausente permanece ausente; zero nao e usado como preenchimento.
- O anexo neutro nao e produzido como apto quando a configuracao esta bloqueada. A opcao aparece apenas como planejamento, marcada `NAO UTILIZAR COMO ESPECIFICACAO DE AQUISICAO`.
- A coleta e os ensaios usaram diretorios temporarios exclusivos, removidos ao termino. Banco, fontes e evidencias persistidas nao foram apagados.

## Coleta real em modo seco

Uma execucao real, sem assinatura nem publicacao, consultou 65 fontes registradas:

- 21 fontes coletadas.
- 39 fontes ignoradas porque seus conectores ainda estao deliberadamente indisponiveis.
- 5 falhas: quatro perfis OpenBenchmarking exigiram acesso interativo e a matriz AMD de video expirou por timeout.
- 44 observacoes coletadas.
- 230 componentes descobertos no bundle temporario.
- 23 observacoes publicas de benchmark, das quais 2 elegiveis.
- 0 componentes qualificados e 0 componentes completos para contratacao.

O resultado e conservador por projeto: o bundle pode ser auditado, mas nenhuma lacuna vira qualificacao. O diretorio temporario da coleta foi removido depois do registro destes totais.

## Compatibilidade

A implementacao usa TypeScript unico e o mesmo lockfile. Caminhos, downloads, arquivos temporarios e abertura de pastas continuam resolvidos pelas APIs de Node/Electron. O macOS arm64 foi empacotado e executado. Windows 11 x64 e Ubuntu 24.04 x64 permanecem cobertos pela matriz nativa e pelo smoke comum, com homologacao fisica posterior.
