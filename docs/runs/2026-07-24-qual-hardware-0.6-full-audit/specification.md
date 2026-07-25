# Especificação implementada

## Inicialização

O aplicativo inspeciona sistema, arquitetura, GPU, drivers, programas e modelos antes da tela principal. A janela de ambiente distingue:

- pronto para teste completo;
- pronto somente para diagnóstico;
- plataforma não suportada.

Componentes ausentes recebem explicação e link oficial. O usuário pode continuar em modo diagnóstico quando a ausência não torna a plataforma incompatível.

## Dimensionamento

O dimensionamento não depende de uma calibração já concluída. Ele pode usar inventário, referências e calibrações disponíveis, sempre exibindo:

- natureza da evidência;
- bloqueio ou liberação de compra;
- três alternativas de configuração;
- processadores físicos, núcleos, GPUs, RAM e rede por servidor;
- servidores ativos e de reserva;
- capacidade segura por servidor e gargalo;
- limitações que ainda precisam de validação.

## Calibração

- A quantidade informada é testada primeiro.
- Se falhar por capacidade, a busca reduz a carga.
- Se passar, a busca aumenta a carga até encontrar reprovação ou atingir o limite do gerador.
- VÍDEO FULL e FRAME mantêm proporções constantes durante toda a busca.
- Falhas de infraestrutura são repetidas e classificadas como inconclusivas.
- O modo rápido fornece diagnóstico preliminar.
- O modo de engenharia executa 5 minutos de aquecimento, 10 de rampa, 35 sustentados e 10 de surto.
- A homologação comercial permanece separada e não foi executada neste trabalho.

## Relatórios

PDF, TXT, XLSX e JSON compartilham o mesmo modelo de resultado. O início responde:

- as câmeras solicitadas funcionam;
- capacidade operacional segura;
- maior carga aprovada;
- primeira carga reprovada;
- interpretação correta do limite;
- se a busca avançou acima da carga informada;
- gargalo;
- validade da evidência.

PDF e XLSX mostram separadamente a composição informada e a composição da capacidade segura.
