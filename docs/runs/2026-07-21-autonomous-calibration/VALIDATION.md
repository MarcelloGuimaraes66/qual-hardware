# Validação — calibração autônoma

Data: 2026-07-21

## Resultado automatizado

- Baseline antes das alterações: 14 arquivos e 103 testes passaram; typecheck e build passaram.
- Resultado atual: 21 arquivos e 154 testes passaram.
- `npm run typecheck`: passou.
- `npm run build`: passou.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas.
- `npm run desktop:package:dir`: passou e gerou o aplicativo macOS arm64 desempacotado para inspeção.
- `npm run desktop:package`: passou e gerou `release/Qual-Hardware-0.1.0-macos-arm64.dmg`.
- `npm run desktop:smoke`: passou no aplicativo empacotado em macOS arm64.
- `electron-builder --linux AppImage --x64`: passou e gerou `release/Qual-Hardware-0.1.0-linux-x86_64.AppImage`.
- `electron-builder --win portable --x64`: passou e gerou `release/Qual-Hardware-0.1.0-windows-x64-portable.exe`.
- Os pacotes Linux e Windows foram inspecionados, mas não executados: arquitetura, ASAR, manifesto v2 e hashes dos contratos estão corretos.

Hashes dos pacotes finais:

- macOS arm64 DMG: `548bf4c102251fd2d791e448213f1834aed4d7641b2603fdf113b977b26c5274`.
- Linux x64 AppImage: `1cbe7d3eabaa6daf574a7bbe258adabf852065d957313eb1b27cf577985eef25`.
- Windows x64 portátil: `b5cba47617b68f45ecf06ca847d196a4170559594fc4efc60675dfbac0034334`.

## Evidências do smoke empacotado

- O ASAR contém kernel, worker, pipeline, detector de hardware, telemetria e gerenciador de temporários.
- O manifesto e os dois contratos externos foram encontrados, e os hashes dos contratos coincidiram com o manifesto.
- O modo completo retornou 503, conforme esperado, porque ativos e manifesto ainda não estão aprovados.
- O teste rápido foi entregue como `internal`, executou no worker e permaneceu diagnóstico.
- O resultado executou Jobs, Steps, Agents, Intelligence, dashboard e os estágios locais disponíveis; gravou capacidade nula, inferência/RTSP/térmico indisponíveis quando os ativos faltaram e elegibilidade de compra falsa.
- O SQLite confirmou uma execução persistida antes de a sessão chegar a 100%.
- A sessão de sucesso removeu exatamente todos os bytes temporários registrados.
- Uma segunda sessão foi cancelada, preservou diagnóstico compacto permanente, não criou run de capacidade e terminou sem temporários.
- Uma terceira sessão estava ativa durante o encerramento do aplicativo; preservou diagnóstico compacto e, após reinício, estava cancelada/interrompida com limpeza concluída.
- O diretório controlado geral permaneceu existente e vazio; nenhum filho de sessão ficou para trás.
- O encerramento durante uma sessão respeitou o prazo do desktop, preservou diagnóstico, removeu os temporários e permitiu reinício limpo.
- Os diretórios `qual-hardware-desktop-smoke-*` criados pelo teste foram removidos no bloco de finalização.
- A auditoria final encontrou um perfil de smoke antigo sem processo ou arquivo aberto; o caminho exato foi validado como filho direto da pasta temporária e removido. Nenhum outro diretório ou dado foi tocado.

## Banco e recuperação

- `PRAGMA user_version` permaneceu em 9.
- A instalação da extensão ocorre em transação.
- O backup v9 recebe nome único, passa por `PRAGMA integrity_check` e preserva dados preexistentes.
- Falha deliberada do SQL aditivo foi revertida; o aplicativo legado permaneceu utilizável e apenas a calibração foi marcada indisponível.
- Sessões usam base imutável e eventos append-only.
- Runs usam `INSERT`, digest único e transação conjunta com previsões e avaliações.

## Segurança da limpeza

Foram validados: UUID inválido, `..`, caminho absoluto, link simbólico de arquivo, diretório de sessão por link simbólico, entrada estrangeira, manifesto ausente, marcador adulterado, hash alterado, recuperação de arquivo mutável predeclarado, remoção exata, bytes removidos e preservação de arquivo alheio.

O manifesto v2 também foi validado com artefatos distintos por plataforma, rejeição de travessia, inventário duplicado, alvo não suportado e executável Unix sem permissão de execução. A seleção de hardware foi testada com nomes de inventário contendo marcas registradas e com divergências de memória, CPU, GPU e formato físico.

Licença e SBOM empacotados são agora conferidos por SHA-256; alteração do SBOM reprova o ativo. O provisionador foi validado em dry-run, aplicação atômica, backup, cópia verificada, permissão Unix, ausência de staging residual e recusa de sobrescrita do alvo.

## Gate comercial e recomendador

- Um conjunto sintético completo das 12 fases finais aprova o gate puro; ausência de CPU/RAM/disco, GPU/VRAM, térmico, rede, concorrência ou isolamento externo reprova.
- Uma descoberta superior reprovada não contamina três repetições válidas no nível inferior.
- Variação física acima de 10% reprova a elegibilidade.
- Uma troca de kernel ou hash do manifesto impede reutilização da run.
- Projetos com vários nós permanecem `planning_only`, mesmo quando cada nó respeita um limite medido.

## Prova de não regressão

- A `main` original continua em `f0c4c00ed914d567bb2678e429b0e373d0ae11a7`.
- `.DS_Store`, `CMakeFiles/` e `logos/` do repositório original continuam presentes e sem alteração deste trabalho.
- Typecheck, suíte completa, build, pacote e smoke do desktop estão verdes.

## Pendências impeditivas para 100% comercial

1. Fornecer FFmpeg, ffprobe, MediaMTX, llama-server e Qwen Core/Core Max redistribuíveis por plataforma.
2. Fornecer e validar o `telemetry-probe` para GPU, temperatura e throttling nas três plataformas.
3. Registrar versões, licenças, SBOM, tamanhos, SHA-256 e aprovar o hash de cada manifesto por plataforma.
4. Revisar e aprovar formalmente o hash final do manifesto v2 depois de inserir os ativos licenciados.
5. Executar três repetições físicas completas em macOS arm64, Windows 11 x64 e Ubuntu 24.04 x64.
6. Medir/confirmar links físicos de rede, GPU/VRAM, temperatura e throttling nas três plataformas.
7. Executar os instaladores e comprovar zero bytes temporários em Windows e Ubuntu reais.

Classificação final: infraestrutura interna, persistência, recomendador, proteção comercial e limpeza estão implementados e validados no macOS. A qualificação real de capacidade do Perceptrum continua bloqueada e não foi declarada concluída.
