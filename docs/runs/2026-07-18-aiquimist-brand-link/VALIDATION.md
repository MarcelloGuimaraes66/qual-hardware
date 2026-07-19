# Validação — identidade Aiquimist.ai

## Prova da mudança

- O cabeçalho empacotado contém uma âncora acessível para `https://aiquimist.ai/`.
- O destino usa `target="_blank"` e `rel="noreferrer"`.
- O Electron valida HTTP/HTTPS, impede a substituição da origem loopback e abre o link no navegador externo.
- O asset empacotado mantém 1080 × 1080 e a mesma SHA-256 do arquivo fornecido.
- O smoke mede o viewport renderizado em razão 8,84 e confirma que largura e altura naturais permanecem iguais.

## Testes executados

- `npm test -- --run tests/desktop-runtime.test.ts`: 8 aprovados.
- `npm run typecheck`: aprovado.
- `npm test`: 76 aprovados em 9 arquivos.
- `npm run desktop:package:dir`: aprovado em macOS arm64.
- `npm run desktop:smoke`: aprovado duas vezes no pacote real.
- `npm run desktop:package`: DMG arm64 gerado.
- `hdiutil verify release/Qual-Hardware-0.1.0-macos-arm64.dmg`: válido.

## Pacote final

- DMG: `release/Qual-Hardware-0.1.0-macos-arm64.dmg`
- SHA-256: `7a1958a852150de7bc4a1e44f245660a83b741654e97dde135056e5ea52b8c53`

## Prova de não regressão

O smoke comprovou inicialização empacotada, interface, API loopback, catálogo, SQLite, recomendações, PDF/XLSX/JSON, cenário macOS, segunda instância, persistência e bloqueio de navegação externa dentro da janela.

## Matriz

| Plataforma | Implementado | Validação |
|---|---:|---|
| macOS arm64 | sim | real: build, pacote, smoke e DMG |
| Windows 11 x64 | sim | estática: mesmo React/CSS/asset e runtime |
| Ubuntu 24.04 x64 | sim | estática: mesmo React/CSS/asset e runtime |

A homologação física em Windows e Ubuntu permanece para os respectivos computadores; não há código específico de macOS nesta mudança.

## Limpeza

Os dois perfis temporários desta execução, de 3,0 MB cada, foram removidos após os smokes. Nenhum perfil `qual-hardware-desktop-smoke-*` permaneceu no diretório temporário. Fontes, bancos e artefatos permanentes foram preservados.
