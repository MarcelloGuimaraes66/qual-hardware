# Planejamento — inteligência de capacidade por evidência

Data: 2026-07-18
Risco: T4
Branch: `archon/task-archon-perceptrum-capacity-calibration-v2`

## Objetivo

Entregar um produto desktop que combine até cinco calibrações físicas do Perceptrum com benchmarks públicos sérios por componente e por estágio, produzindo recomendações conservadoras, preços auditáveis e relatórios didáticos. O mesmo commit deve compilar em macOS arm64, Windows 11 x64 e Ubuntu x64.

## Fatos verificados

- O catálogo contém sistemas completos e já gera seis alternativas quando há capacidade qualificada suficiente.
- A extrapolação atual relaciona observações ao sistema completo e usa reservas fixas A/B/C de 20/30/40%.
- O leave-one-out atual conta superestimações globalmente, mas ainda não calcula uma correção empírica por estágio/estrato.
- O importador assinado já verifica Ed25519, porém inventário, preços e evidência não têm ciclos operacionais completamente separados.
- Cotações antigas permanecem consultáveis e preços vencidos ainda podem influenciar a mediana.
- A atualização automática ocorre somente quando URL e chave foram configuradas; o operador não acompanha cada fase na UI.
- O PDF tem relatório técnico, mas não inicia com uma recomendação conversacional completa.

## Invariantes

- Nenhum banco existente será movido, limpo, recriado ou reduzido.
- Evolução de dados somente aditiva e compatível com cenários/resultados antigos.
- Benchmarks públicos nunca substituem uma etapa diferente do pipeline.
- `validated_local` exige teste físico integral; extrapolação nunca recebe esse selo.
- Preço vencido ou fora do snapshot ativo não pode sustentar valor de compra.
- Snapshots são curados, versionados, assinados e importados; não há scraping ao vivo no desktop.
- Seis opções somente quando seis máquinas realmente qualificadas existirem; sem preenchimento inseguro.
- Preferência Intel/NVIDIA e diversidade não anulam capacidade, compatibilidade, custo crescente ou evidência.

## Blast radius e orçamento

Orçamento: tipos/schemas aditivos; schema SQLite aditivo; engine de calibração; importação assinada; preços/FX; UI de catálogo/calibração; relatórios PDF/XLSX/JSON; scripts curadores/assinadores; testes, CI e documentação. Cálculos-base do workload só mudam mediante prova do código real do Perceptrum.

## Fases

1. Normalizar componentes e observações públicas com proveniência/configuração.
2. Persistir snapshots e seus membros ativos sem apagar histórico.
3. Calcular razão por etapa, correção empírica e reserva dinâmica.
4. Impedir classificação alta sem cobertura/repetição/leave-one-out seguro.
5. Separar atualização de inventário, preços e evidência, com progresso e diffs.
6. Corrigir validade, FX e reconciliação de preços.
7. Criar narrativa determinística em linguagem natural e incluir as seis opções.
8. Entregar manual completo para testadores e coordenador.
9. Validar dados, APIs, relatórios, desktop e pacotes.

## Aceitação

- Máximo de cinco âncoras físicas, com validação cruzada por estrato.
- Zero superestimação pós-margem nas âncoras retiradas.
- Meta de erro absoluto mediano <= 15% dentro de estratos cobertos.
- Alta confiança: ao menos três âncoras comparáveis e três execuções sustentadas válidas.
- Importações rejeitam unidade, direção, versão, SKU ou configuração incompatível.
- Relatório e UI mostram fontes, âncoras, gargalo, intervalo e margem.
- O usuário vê o que a atualização fará, está fazendo e alterou.
- Typecheck, testes, build e smoke macOS; matriz Windows/Ubuntu compilável.

## Rollback

Reverter o commit. Tabelas/colunas aditivas podem permanecer sem serem lidas; nenhum dado histórico será apagado. Bloquear a entrega se uma recomendação sem cobertura for promovida, se preço vencido sustentar compra, se relatório divergir dos números, se houver regressão de banco ou se o pacote depender de Node externo.

## Limitação do orquestrador

O Archon foi acionado para o fluxo T4, porém falhou antes de editar o repositório por um caminho local obsoleto do binário Codex. Este worktree continua sendo a superfície isolada e os gates do fluxo serão executados manualmente e registrados nesta pasta.
