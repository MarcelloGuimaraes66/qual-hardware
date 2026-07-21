# Validação — especificações v9 e relatório técnico

## Resultado automatizado

- Typecheck aprovado.
- 95 testes automatizados aprovados em 12 arquivos.
- Build Vite/TypeScript de produção aprovado.
- Auditoria npm de produção e completa: zero vulnerabilidades.
- Pacote Electron descompactado arm64 aprovado.
- Smoke do aplicativo empacotado aprovado em `darwin/arm64`; o teste comprovou API em loopback, banco SQLite v9, catálogo, relatórios, navegação bloqueada, instância única e persistência.
- O diretório temporário exclusivo do smoke foi removido pelo próprio runner depois da execução.
- O ASAR não contém o servidor standalone nem o worker contínuo obsoletos.
- PDF combinado gerado em A4 com 27 páginas.
- Texto pesquisável extraído com acentuação em português do Brasil.
- Revisão visual das páginas iniciais e do capítulo técnico detalhado.
- JSON 6.0 com 86 componentes únicos usados pelas opções do relatório e 37 campos oficiais publicados.
- Uma CPU com completude técnica oficial; demais componentes continuam incompletos/bloqueados.
- Migração v8→v9 testada com preservação de registro sentinela e criação de backup.
- DMG arm64 de 62 MiB criado e validado pelo `hdiutil`.
- SHA-256 do DMG: `6807aa19ab2b8f98849b8dc2af8424d4e24e9f6ee987a5ba2589c26cecf68011`.

## Prova do relatório

O PDF preserva o resumo comercial das três políticas e acrescenta capítulos numerados para as três máquinas principais. A revisão visual comprovou ausência de cortes nas páginas verificadas, hierarquia legível e separação clara entre referência comercial e requisitos. A extração textual comprovou acentos em `Memória de vídeo`, `Potência gráfica`, `Codecs de decodificação` e a marca de bloqueio `NÃO UTILIZAR COMO ESPECIFICAÇÃO DE AQUISIÇÃO`.

O JSON, XLSX, PDF, DOCX e anexo neutro são gerados da mesma recomendação. Testes impedem o vazamento de fabricante, modelo, SKU, MPN, vendedor, preço, URL comercial ou identificadores internos na seção neutra.

## Limites verificados

- AMD Ryzen 9 9950X permanece sem observações oficiais por campo porque o endpoint consultado expirou; não houve preenchimento secundário ou inventado.
- Somente Intel Core Ultra 9 285K está tecnicamente completo no perfil atual.
- NVIDIA GeForce RTX 5090 possui 46,15% dos campos críticos oficiais e permanece incompleta.
- Nenhuma opção foi promovida a apta para aquisição sem benchmarks e calibrações físicas.
- Windows 11 e Ubuntu usam o mesmo TypeScript, schema, relatórios e scripts de pacote, porém a homologação física continua pendente para execução nos respectivos computadores. A matriz nativa existente é o gate de integração futura.

## Veredito

A implementação está aprovada para planejamento técnico, auditoria de fontes e geração dos novos relatórios no macOS. Não está aprovada como prova comercial de capacidade do Perceptrum até a cobertura de benchmarks e as calibrações físicas mínimas serem concluídas.
