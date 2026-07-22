# Implementação — resultado automático da calibração

## Alterações realizadas

- A conclusão autônoma prepara e verifica o pacote `<runId>.qhcal` antes de persistir o estado final da sessão.
- O arquivo é assinado com Ed25519, relido do disco e validado após a gravação.
- O resultado, previsões, identidade local e evento de exportação são registrados no SQLite antes da limpeza e do estado de 100%.
- A pasta publicada e aberta pela API passou a usar exatamente `calibrationEvidenceDirectory`, o mesmo destino do kernel e do serviço de intercâmbio.
- Execuções autônomas já existentes no banco e sem `.qhcal` são recuperadas automaticamente sem sobrescrever conflitos.
- Resultados importados continuam podendo ser reexportados com a identidade e assinatura originais.
- A tela apresenta o `.qhcal` automático como arquivo principal; a exportação manual agora é descrita como download de outra cópia.
- Falhas de recuperação de arquivos antigos são mostradas sem esconder ou sobrescrever a evidência conflitante.
- O contrato portátil aceita explicitamente `formFactor: "unknown"`, valor real produzido quando o sistema operacional não permite classificar fisicamente a máquina.

## Segurança e preservação

- Nenhum arquivo preexistente é sobrescrito: a criação usa modo exclusivo.
- Um arquivo existente só é reutilizado após validar schema, assinatura, run ID e digest.
- Conflitos são preservados e reportados.
- Nenhum arquivo do Perceptrum foi acessado ou alterado.
- Nenhum banco remoto ou chamada externa foi adicionado.
