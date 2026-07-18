# Guia do coordenador - Calibrações físicas e extrapolação

## Objetivo

Coletar até cinco computadores físicos bem documentados, validar cada resultado e ativar extrapolações somente dentro de estratos cobertos.

## Preparação

1. Fixe versões do Perceptrum, workload, Qwen, quantização e backend.
2. Crie cenários representativos no Qual Hardware.
3. Gere plano completo para cada hardware exato do catálogo.
4. Distribua o manual, o guia rápido e o convite.
5. Solicite três repetições sustentadas quando o objetivo for confiança A.

## Importação

1. Confira extensão e tamanho do `.qhcal.json`.
2. Importe em **Calibração de capacidade**.
3. Rejeite arquivos com rede externa, OpenAI, fingerprint incompleto ou pipeline incompleto.
4. Confirme que o hardware identificado corresponde ao template exato.
5. Registre observações de energia, temperatura e ambiente.

## Snapshot público

Use apenas snapshot curado e assinado. Cada observação precisa identificar componente, SKU, estágio, perfil, versão, unidade/direção, configuração, potência, driver, refrigeração, amostra e fonte HTTPS. Não use um score de CPU para representar GPU, disco, rede ou térmica.

## Gate de extrapolação

- Classe A: três âncoras comparáveis e distintas, três confirmações sustentadas, cobertura obrigatória, reserva mínima de 20% e zero superestimação pós-margem no leave-one-out.
- Classe B: duas âncoras comparáveis, reserva mínima de 30%, uso condicional.
- Classe C: uma âncora, mudança de arquitetura/backend/chassi ou cobertura parcial; reserva mínima de 40% e somente referência.
- Sem cobertura: não publicar capacidade numérica de compra.

A reserva efetiva é o maior valor entre piso da classe, superestimação empírica, variação das repetições e distância arquitetural.

## Recomendação

Ordene pelo custo válido crescente. Priorize Intel e NVIDIA somente depois de comprovar capacidade. Procure quatro Intel, pelo menos uma AMD e diversidade de OEM, mas nunca preencha seis vagas com máquina sem evidência. Apple Silicon exige macOS explícito.

## Auditoria

Preserve calibrações, snapshots, assinaturas e relatórios. Não apague histórico. Registre versão ativa e diff de cada atualização. Preços vencidos ou fora do snapshot ativo não entram em cálculo de compra.
