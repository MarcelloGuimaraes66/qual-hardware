# Qual Hardware 0.5 — planejamento de execução

## Identidade e risco

- Repositório: `qual-hardware`.
- Produto: aplicativo desktop Qual Hardware.
- Risco: T4, por alterar contratos, migração SQLite, runtime, calibração, relatórios e interface.
- Memória: goal e contexto do Codex; não há `.archon` local neste repositório.
- Orçamento de mudança: redesenho direcionado apenas ao fluxo de calibração 0.5.

## Objetivo

Entregar uma versão unificada que modele corretamente VÍDEO FULL e FRAME, trate falha de infraestrutura como inconclusiva, descubra capacidade para baixo e para cima da carga informada, gere diagnóstico legível em tela/PDF/TXT/XLSX e preserve Windows, Ubuntu e macOS.

## Invariantes

- Zero mídia, credenciais, OpenAI ou tráfego externo.
- SQLite dedicado e histórico legível.
- `.qhcal` antigo importável.
- CPU/GPU detectadas automaticamente.
- Nenhum ensaio físico iniciado pelo Codex.
- `logos/` e mudanças do usuário preservados.

## Matriz de plataforma

| Plataforma | Implementação | Validação local |
|---|---|---|
| Windows 11 x64 | obrigatória | typecheck, testes, pacote, smoke e abertura |
| Ubuntu 24.04 x64 | obrigatória | testes contratuais e CI |
| macOS Apple Silicon | obrigatória | testes contratuais e CI |
