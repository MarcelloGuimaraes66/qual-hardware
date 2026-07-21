# Relatório de validação

## Evidências executadas

- Typecheck dos projetos web e servidor: aprovado.
- Suíte integral: 12 arquivos e 97 testes aprovados.
- Testes de especificações e neutralidade.
- Testes de migração SQLite v7 para v9.
- Testes do publicador, assinatura e segurança das fontes.
- Testes das APIs e formatos PDF, XLSX, JSON, DOCX.
- Coleta real das fontes AMD e NVIDIA.
- Build de produção: aprovado.
- Pacote macOS arm64 e DMG: gerados.
- Smoke do aplicativo empacotado: aprovado, sem Node externo.
- Geração e renderização do PDF combinado: 60 páginas A4.
- Inspeção visual do relatório principal e do caderno técnico: aprovada.
- Dados temporários do smoke: removidos automaticamente pelo próprio teste.

## Critérios visuais

- A4, rodapé e numeração presentes.
- Cabeçalhos das três propostas preservados.
- Resumo, alternativas, workload, custos, utilização, demanda, fontes e premissas presentes.
- Caderno técnico iniciado somente depois das três propostas.
- Numeração hierárquica por máquina e componente presente.
- Texto explicativo justificado.
- URLs sem ultrapassar as margens.
- Campos AMD e NVIDIA exibidos com acentos e unidades.

## Resultado comercial

Três componentes possuem agora completude oficial crítica: Intel Core Ultra 9 285K, AMD Ryzen 9 9950X e NVIDIA GeForce RTX 5090. Isso não altera o resultado comercial: faltam calibrações físicas completas e benchmarks comparáveis para todos os estágios, portanto as máquinas permanecem bloqueadas para aquisição.
