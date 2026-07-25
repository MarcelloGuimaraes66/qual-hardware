# Implementação — decisões e resultado

## Comportamento final

Existem dois estados independentes:

- `rtspAvailable`: algum caminho RTSP foi exercitado;
- `rtspQualified`: o caminho é o simulador funcional autenticado ou o worker
  de produção.

O loop interno continua produzindo diagnóstico e capacidade de planejamento,
mas nunca torna o resultado elegível para compra. Isso evita perder todas as
demais medições quando o simulador está fechado, sem transformar um gerador
sintético em prova de DVR.

## Compatibilidade

O simulador publica uma fonte por porta e aceita vários leitores. O Qual
Hardware distribui as câmeras de cada grupo entre endpoints compatíveis por
round-robin. Um endpoint só atende um grupo quando:

- codec e resolução são exatos;
- FPS não fica mais de 0,5 abaixo do cenário;
- payload medido alcança pelo menos 90% do bitrate solicitado;
- três frames foram decodificados.

O payload é contado na janela explícita de mídia, sem incluir o tempo de
autenticação e abertura. A latência de abertura é registrada separadamente.

## Medição

Cada processo FFmpeg concluído conta como uma sessão aberta e concluída.
O payload da fase usa a taxa elementar medida no preflight fresco multiplicada
pela duração e pelo número de sessões efetivamente concluídas. O sampler de
RAM captura a linha de base antes de iniciar mídia, banco, memória e inferência
e registra o maior `pico - linha de base`.

Essa evidência descreve o receptor no loopback. Ela não mede placa de rede,
cabo, switch, perdas UDP ou tráfego de outro computador.

## Rollback

O rollback de comportamento é remover o simulador da seleção e manter
`internal_loopback`. Contratos e leitores antigos permanecem aditivos; nenhuma
migração SQLite ou remoção de dado foi necessária.
