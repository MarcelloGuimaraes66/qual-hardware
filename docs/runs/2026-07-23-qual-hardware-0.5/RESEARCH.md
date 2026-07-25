# Pesquisa verificada

- A versão 0.4 usa busca exponencial/binária, mas o probe retorna apenas booleano.
- O worker exige CPU-only e GPU em todos os níveis; isso faz a contingência limitar a produção normal.
- FFmpeg declara NVENC pela lista de codecs, sem provar o comando completo.
- O pipeline executa o mesmo transcode/segmentação para câmeras VÍDEO e FRAME.
- O planejador de inferência local já exclui modelos remotos, mas o perfil não registra backend ou escopo.
- A interface limita AiQ a 1–5 FPS; o Perceptrum desta máquina aceita 1–10 FPS.
- O resumo TXT atual expõe códigos internos e não há relatório específico da calibração em PDF/XLSX.
- O baseline de tipagem passa.
- A verificação de telemetria falha porque espera `0.1.0`, enquanto o helper atual informa `0.2.0`.

## Autoridade Perceptrum

O snapshot comportamental informado no planejamento foi confirmado como autoridade congelada. A aplicação usará o contrato embarcado e não dependerá do checkout do Perceptrum durante a execução.
