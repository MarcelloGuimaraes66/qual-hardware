# Pesquisa e evidências

## PDF de referência

Arquivo auditado: `/Users/marcellogmfreire/Downloads/exemplo qual-hardware-recomendacoes.pdf`.

Estrutura recuperada:

1. Leitura e recomendação em linguagem direta.
2. Três configurações resumidas.
3. Outras máquinas em custo crescente.
4. Carga de câmeras e Agents.
5. Três propostas com capacidade, especificação, custos, distribuição, demanda, fontes e premissas.

Os dados técnicos novos passam a um caderno técnico posterior, evitando substituir ou desorganizar o relatório original.

## Fontes oficiais consultadas

- AMD Ryzen 9 9950X: <https://www.amd.com/en/products/processors/desktops/ryzen/9000-series/amd-ryzen-9-9950x.html>.
- NVIDIA GeForce RTX 5090: <https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/>.
- Arquitetura NVIDIA Blackwell: <https://images.nvidia.com/aem-dam/Solutions/geforce/blackwell/nvidia-rtx-blackwell-gpu-architecture.pdf>.
- NVIDIA Video Codec SDK: <https://developer.nvidia.com/video-codec-sdk>.
- MLPerf Inference v6.0: <https://github.com/mlcommons/inference_results_v6.0>.
- SPEC CPU 2017: <https://www.spec.org/cpu2017/results/>.
- Blender Open Data: <https://opendata.blender.org/>.
- Phoronix Test Suite: <https://github.com/phoronix-test-suite/phoronix-test-suite>.

## Resultado da coleta real

- AMD 9950X: 19 campos determinísticos obtidos da página do SKU exato.
- NVIDIA RTX 5090: 22 campos determinísticos obtidos das páginas de produto e codec, mais largura de banda de memória confirmada no documento oficial Blackwell.
- MLPerf v6.0: 16 observações Qwen3-VL coletadas, todas preservadas como não comparáveis ao modelo AiQ instalado.
- SPEC CPU 2017: 2 observações reproduzíveis e elegíveis para EPYC 9335/9355.
- Blender: 4 referências secundárias, inelegíveis como substitutas de AiQ/Qwen.
- OpenBenchmarking: as páginas retornaram proteção interativa; nenhuma proteção foi contornada e nenhum número foi extraído de snippet de busca.

## Diagnóstico da falha AMD

A página oficial carregava normalmente com identificação HTTP convencional e contato explícito, mas o CDN não concluía a resposta para o identificador antigo do coletor. Além disso, a página contém a biblioteca opcional reCAPTCHA, embora o conteúdo do produto não seja uma página de desafio. O detector tratava qualquer menção à palavra `captcha` como bloqueio.

A correção mantém TLS, `robots.txt`, limites de tamanho, allowlist de hosts e rejeição de desafios reais. A presença isolada da biblioteca não é mais classificada como desafio.
