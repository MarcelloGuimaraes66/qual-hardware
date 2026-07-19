# Fontes e licenças da evidência de componentes

## Regra central

O Qual Hardware armazena metadados numéricos publicamente redistribuíveis, proveniência, configuração e hash. Ele não copia ferramentas, bases pagas ou material cuja licença não permita redistribuição. Um resultado público relaciona hardwares; somente a calibração física do Perceptrum converte essa relação em câmeras.

## Fontes

| Fonte | Uso permitido no produto | Limite aplicado |
| --- | --- | --- |
| SPEC CPU 2017 | Divulgações públicas de resultados e configuração | Ferramentas e dumps licenciados não são redistribuídos; versão/perfil devem coincidir |
| MLCommons/MLPerf Inference | Resultados e descrições de sistemas publicados no repositório oficial | Só mede AiQ se modelo, precisão, backend e cenário forem comparáveis |
| NVIDIA Video Codec SDK | Compatibilidade funcional NVDEC/NVENC | Não substitui throughput sustentado por codec/resolução |
| Intel oneVPL, AMD AMF, Apple VideoToolbox | Compatibilidade funcional de vídeo | Driver, sistema e medição local continuam obrigatórios |
| STREAM | Largura de banda de memória | Resultado só é comparado com o mesmo perfil e regras de execução |
| fio/OpenBenchmarking | SSD: throughput, IOPS, latência e fila | SKU, filesystem, tamanho e perfil precisam coincidir |
| OpenBenchmarking/Phoronix | FFmpeg, OpenCV, STREAM e fio reproduzíveis | Configuração incompleta ou resultado anônimo é referência apenas |
| Blender Open Data | Indicador secundário de compute de GPU | É proibido usá-lo como inferência AiQ/Qwen |

PassMark completo e outras bases comerciais não são incluídos sem licença específica. Páginas com login, CAPTCHA, bloqueio por `robots.txt` ou proibição de coleta são rejeitadas; nenhuma proteção é contornada.

## Conferência do coordenador

1. Abra **Cobertura de evidências** e confirme que o componente tem SKU/MPN exato.
2. Confira suíte, versão, perfil, unidade, direção e estágio.
3. Abra a fonte e compare sistema, OS, driver, potência, memória e refrigeração.
4. Confirme o SHA-256 do artefato registrado.
5. Verifique que o benchmark não está substituindo outro estágio.
6. Confirme três âncoras físicas comparáveis e leave-one-out sem superestimação.
7. Somente então aceite `validated_local` ou `extrapolated_high` como potencialmente apto.

Ausência de qualquer item mantém o componente em planejamento ou referência.
