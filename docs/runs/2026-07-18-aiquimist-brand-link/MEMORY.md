# Memória — identidade Aiquimist.ai

## Data e resumo

2026-07-18 23:52 America/Manaus. A marca provisória do Qual Hardware foi substituída pela logo oficial fornecida pelo usuário, com link externo seguro para o site institucional.

## Contexto e motivação

O produto precisava apresentar a identidade visual oficial em toda a navegação da janela desktop e oferecer acesso claro ao site `aiquimist.ai`.

## Decisões

- O cabeçalho global é o único ponto necessário para cobrir etapas, resultados e modais.
- O PNG original é armazenado sem edição.
- O recorte é puramente visual por CSS e preserva a razão da imagem.
- O link usa a proteção existente do Electron, que abre HTTP/HTTPS no navegador padrão sem navegar o renderer.
- Um único código atende macOS, Windows e Ubuntu.

## Arquivos e solução

- Asset: `public/brand/aiquimist-logo-white.png`.
- UI: `src/web/App.tsx` e `src/web/styles.css`.
- Regressão: `tests/desktop-runtime.test.ts` e `scripts/smoke-desktop.ts`.

## Validação e estado final

Typecheck, 76 testes, build, pacote descompactado, dois smokes, DMG e verificação do instalador passaram. Nenhum dado persistido foi alterado. Windows e Ubuntu estão implementados pelo código comum e aguardam homologação física nos hosts nativos.

## Próximo passo

Publicar o branch somente quando o usuário solicitar; nenhuma publicação remota foi feita nesta execução.
