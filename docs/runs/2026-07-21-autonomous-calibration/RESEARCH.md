# Pesquisa — calibração autônoma

Data: 2026-07-21

## Baseline verificado

- A execução começou no worktree isolado atualmente reutilizado, originado do commit `f0c4c00ed914d567bb2678e429b0e373d0ae11a7`; o caminho histórico contém o nome Archon, mas nenhum workflow Archon é usado ou retomado.
- O baseline limpo passou em typecheck, build e 103 testes distribuídos em 14 arquivos.
- O fluxo anterior entregava a calibração a uma porta fixa do Perceptrum e possuía fallback por `perceptrum://`.
- Resultados legados admitiam atualização por conflito e as previsões não exigiam correspondência simultânea de perfil e build.
- O repositório não contém os binários, modelos, licenças, SBOM, tamanhos e hashes aprovados necessários para uma medição Perceptrum-equivalente offline.

## Autoridade comportamental

- Commit imutável do Perceptrum: `d918faa0ecd6a9906b711039e5d89f78e0536c44`.
- O Perceptrum foi consultado apenas em leitura; nenhum arquivo, banco ou processo foi alterado ou executado.
- Os blobs e SHA-256 dos arquivos de autoridade estão registrados em `contracts/calibration-kernel-authority-v1.json`.

## Conclusões de segurança

- Uma execução rápida pode medir somente os estágios que realmente estiverem disponíveis: o kernel executa mídia, Jobs, Steps, Agents, Intelligence e dashboard localmente, mas não converte ausência de MediaMTX/Qwen/probe térmico em sucesso.
- Qualificação de compra deve permanecer fechada enquanto pipeline, ativos, manifesto aprovado e três repetições físicas não estiverem presentes.
- Resultados somente podem ser reutilizados com hardware, sistema operacional, perfil canônico, build, kernel e manifesto compatíveis.
- A limpeza deve operar em um UUID filho direto da raiz controlada, rejeitar links simbólicos e entradas não registradas e nunca remover recursivamente a raiz geral.

## Limitações do ambiente

- A máquina disponível é macOS arm64.
- Não há payload redistribuível aprovado de FFmpeg, MediaMTX, llama-server e Qwen Core/Core Max no repositório.
- Não há probe térmico redistribuível e aprovado para Windows, macOS e Ubuntu no repositório.
- Não há máquinas Windows 11 x64 e Ubuntu 24.04 x64 disponíveis para a matriz física.
- Portanto, o objetivo comercial de 100% permanece pendente; o software falha de forma fechada em vez de produzir uma certeza falsa.
