# Implementação concluída

## Capacidade dinâmica

A quantidade informada passou a ser a semente. Se falhar por capacidade, a busca reduz; se passar, amplia; quando encontra aprovação e reprovação, refina a fronteira. Falha de infraestrutura é repetida uma vez e, se persistir, produz resultado inconclusivo sem publicar H, F ou capacidade segura falsa.

## VÍDEO FULL e FRAME

As duas cargas mantêm RTSP e decodificação de base. VÍDEO FULL cria clipes e empacota vários frames. FRAME captura uma imagem na cadência do Agent e não codifica/grava vídeo sem política de retenção ou outro Agent de vídeo. A proporção dos grupos é preservada em todas as tentativas.

## CPU e GPU automáticas

O preflight detecta topologia e dispositivos. O plano seleciona automaticamente CPU, GPU, mídia e inferência, distribui carga entre GPUs elegíveis, registra uso e telemetria por dispositivo e mede contingência/degradação sem pedir quantidades na interface.

## Relatório para o operador

Tela, PDF, TXT e XLSX respondem:

- a carga solicitada funciona;
- capacidade operacional segura;
- maior carga aprovada;
- primeira carga reprovada;
- maior carga tentada;
- teste acima da semente;
- gargalo e ações;
- composição VÍDEO/FRAME;
- CPU, GPUs e telemetria;
- servidores ativos e reservas.

## Segurança

O executor permanece local, em loopback, sem mídia, credenciais ou OpenAI fora da máquina. O resultado é persistido antes de 100%, os relatórios são append-only e a limpeza pertence à sessão.
