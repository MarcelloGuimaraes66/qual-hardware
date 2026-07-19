# Planejamento — identidade Aiquimist.ai no Qual Hardware

## Tarefa e pedido original

Aplicar proporcionalmente a logo oficial fornecida pelo usuário nas janelas do Qual Hardware e tornar a marca um link para `https://aiquimist.ai/`.

## Estado verificado

- O worktree refatorado está limpo no commit `f62ba7a`.
- O renderer React possui um cabeçalho global, compartilhado por todas as etapas e modais.
- A marca atual é provisória, formada por texto e CSS.
- O Electron já bloqueia navegação fora da origem loopback e abre links HTTP/HTTPS no navegador externo.
- O arquivo original é PNG RGBA de 1080 × 1080 e será preservado sem edição.

## Objetivos

- Exibir a logo oficial sem deformação, com recorte responsivo apenas do espaço excedente da imagem.
- Manter o nome do produto “Qual Hardware” legível ao lado da marca.
- Abrir o site institucional no navegador padrão sem substituir a interface local.
- Empacotar o mesmo asset e comportamento em macOS, Windows e Ubuntu.

## Riscos e áreas impactadas

Risco T2. Áreas: cabeçalho React, CSS responsivo, asset estático, teste de segurança do runtime e smoke empacotado.

## Invariantes

- Nenhuma alteração em SQLite, catálogo, preços, cálculos, relatórios ou calibrações.
- CSP, sandbox, isolamento de contexto, permissões negadas e listener em `127.0.0.1` permanecem intactos.
- A imagem original fornecida pelo usuário não será modificada.

## Orçamento de mudança

- Um novo asset estático.
- `App.tsx` e `styles.css`.
- Teste do runtime e smoke do pacote.
- Artefatos compactos desta execução.

## Aceitação e validação

- Logo visível no cabeçalho com proporção intrínseca preservada em telas grandes e estreitas.
- Link canônico igual a `https://aiquimist.ai/`, aberto externamente pelo Electron.
- Asset presente no build e no ASAR.
- Typecheck, suíte automatizada, build, pacote descompactado e smoke macOS aprovados.
- Windows e Ubuntu cobertos pelo mesmo código e por validação estática; execução física futura permanece fora deste host.

## Rollback

Reverter somente o commit desta identidade visual. Nenhum dado persistido é afetado.
