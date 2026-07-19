# Implementação — identidade Aiquimist.ai

## Checklist executado

- [x] Confirmar worktree limpo e proteções de navegação existentes.
- [x] Importar a logo fornecida sem alterar seus bytes.
- [x] Substituir a marca provisória do cabeçalho global.
- [x] Preservar a proporção intrínseca com enquadramento CSS responsivo.
- [x] Vincular a marca a `https://aiquimist.ai/`.
- [x] Validar o asset, a interface, o link externo e o pacote macOS.
- [x] Remover somente os perfis temporários gerados pelos smokes.

## Arquivos alterados

- `src/web/App.tsx`: link institucional acessível no cabeçalho global.
- `src/web/styles.css`: enquadramento proporcional, estados de foco/hover e adaptação móvel.
- `tests/desktop-runtime.test.ts`: integridade, dimensões, destino e segurança do asset.
- `scripts/smoke-desktop.ts`: presença no ASAR e geometria no renderer empacotado.

## Arquivo criado

- `public/brand/aiquimist-logo-white.png`: cópia exata do original fornecido, SHA-256 `87ca1cdc20b181864aff25a220fa2a9058fee1d5e5501181a89c3e84322d8e60`.

## Decisão visual

O PNG quadrado contém a marca horizontal na região central. Para não modificar o ativo nem deformá-lo, o `img` permanece quadrado com `height:auto`; um viewport horizontal de razão 8,84 recorta somente o espaço superior, inferior e lateral excedente. A apresentação móvel reduz o viewport e oculta apenas o rótulo auxiliar “Qual Hardware”.

## Desvios e problemas

Nenhum desvio funcional. A primeira tentativa de limpeza do perfil de smoke foi bloqueada pela proteção da ferramenta; após conferência do alvo exato, a remoção autorizada foi feita com `find -depth -delete`.

## Resultado

Mudança concluída sem tocar em banco, catálogo, cálculos, relatórios, calibrações ou dados do usuário.
