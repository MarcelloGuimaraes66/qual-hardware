# Atualização de especificações e preços

O executável do Qual Hardware e o catálogo têm ciclos de atualização independentes. O aplicativo inclui um catálogo de referência para funcionar offline; preços sem evidência continuam aparecendo como `cotação necessária`.

## Como funciona sem ação do operador

O publicador central está em `.github/workflows/catalog-publisher.yml`. O GitHub o chama todos os dias às 07:17 UTC, correspondentes a 03:17 em Manaus. O primeiro job consulta a última Release pública `catalog-*`:

1. antes de 15 dias, encerra sem publicar nem alterar arquivos;
2. no 15º dia, coleta e valida as fontes;
3. se falhar, preserva o catálogo anterior, registra uma issue de saúde e tenta novamente no disparo do dia seguinte;
4. se concluir, publica uma nova Release imutável e um novo diretório no branch `catalog-data`;
5. mesmo sem novidades, publica um relatório assinado que prova quais fontes foram verificadas.

A coleta, a chave privada e o Qwen existem apenas nos runners. O operador não informa URL, chave, modelo, agenda ou credencial. O aplicativo não contém scraper e nunca envia projeto, câmera, credencial ou calibração para o GitHub.

## Fontes cadastradas

O contrato `qual-hardware-source-registry/1.0.0` registra as fontes iniciais e é espelhado no SQLite. Abrange:

- especificações oficiais Intel, AMD, NVIDIA e Apple;
- componentes de memória e armazenamento Samsung, Micron/Crucial, Kingston, Kioxia, Solidigm, Western Digital e Seagate;
- plataformas ASUS, ASRock Rack, Gigabyte, MSI e Supermicro; NICs Intel, Broadcom e NVIDIA; fontes, refrigeração e chassis usados nas BOMs qualificadas;
- OEMs ASUS/ROG, Dell/Alienware/Precision/PowerEdge, HP/HPE, Lenovo/Legion/ThinkStation/ThinkSystem, Acer/Predator, MSI, Gigabyte/Aorus e Supermicro;
- benchmarks MLCommons, SPEC CPU, OpenBenchmarking/Phoronix para FFmpeg, OpenCV, STREAM e fio, Blender Open Data como indicador secundário e matrizes oficiais de codec NVIDIA, Intel, AMD e Apple;
- preços públicos no Brasil, Estados Unidos e Alemanha;
- câmbio oficial BCB, BCE e Federal Reserve.

Cada entrada define hosts/redirecionamentos permitidos, mercados, moedas, parser, tier, limite, frequência e política de `robots.txt`. Login, CAPTCHA, bloqueio explícito, host não cadastrado, redirecionamento externo, HTTP sem TLS, conteúdo excessivo ou tipo inesperado fazem a fonte/candidato ser rejeitado. Nenhuma proteção é contornada. Novas URLs só podem ser descobertas dentro dos domínios já aprovados.

## Papel limitado do Qwen

Quando um documento público não puder ser relacionado deterministicamente a um SKU, o runner executa um Qwen textual local por llama.cpp. No GitHub Actions, `Qwen/Qwen3-1.7B-GGUF:Q8_0` continua fixado por versão e checksum para que toda publicação seja reproduzível. Em uma estação de desenvolvimento, o comando escolhe automaticamente o maior Qwen textual GGUF que caiba em até 68% da memória física, preservando reserva para o sistema. `QWEN_MODEL_PATH` permite selecionar explicitamente um arquivo e `QWEN_MODEL_SEARCH_PATHS` acrescenta diretórios de busca usando o separador nativo do sistema. Modelo, checksum, tamanho, quantização, prompt, parâmetros e origem da seleção ficam no relatório; caminhos absolutos locais nunca entram no bundle.

`npm run catalog:qwen:detect` mostra qual modelo e qual `llama-server` seriam usados, sem iniciar uma coleta. No Mac de desenvolvimento atual, a seleção comprovada é `Qwen3-32B-Q4_K_M`, com 32 bilhões de parâmetros e SHA-256 `efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689`. O servidor temporário escuta somente em `127.0.0.1`, carrega o modelo uma vez para todo o lote e é encerrado mesmo quando uma classificação falha.

O Qwen pode classificar página, fabricante, SKU e arquitetura. Ele não pode definir preço, moeda, capacidade do Perceptrum, compatibilidade de compra, assinatura ou publicação. Uma alucinação, prompt injection, timeout ou modelo indisponível rejeita somente o candidato ambíguo; os parsers determinísticos continuam. Não existe chamada OpenAI nem IA paga.

O executável desktop do operador não inicia esse modelo nem precisa reservá-lo em memória. Ele apenas baixa bundles assinados. O Perceptrum permanece responsável pelas calibrações de câmera e não é modificado por essa seleção textual.

## Publicação e confiança

Cada Release `catalog-AAAA-MM-DD.N` contém:

- `catalog-bundle.json` no contrato `qual-hardware-catalog-bundle/1.0.0`;
- `source-registry.json`;
- `publication-report.json` assinado;
- `SHA256SUMS`;
- sequências, diferenças, rejeições, proveniência, versão do coletor e metadados Qwen.

A chave privada Ed25519 fica somente em `CATALOG_SIGNING_PRIVATE_KEY`; o desktop contém apenas o chaveiro público identificado por `keyId`. Cada bundle carrega sequência monotônica e hash SHA-256 do bundle anterior. Releases, snapshots, preços, fontes e evidências anteriores não são apagados nem sobrescritos.

A publicação é bloqueada quando mais de 20% das fontes ativas falham, a cobertura de equipamentos ou do registro cai mais de 10%, o schema muda de forma incompatível ou preços falham nas regras determinísticas. Equipamentos incompletos entram apenas como `reference_only`. Um hardware novo nunca ganha capacidade de câmeras por existir em uma página: capacidade continua dependendo das calibrações físicas e dos benchmarks específicos por estágio.

## Regras de preço

- preços precisam de MPN/SKU/GTIN exato, disponibilidade e evidência estruturada;
- duas fontes independentes dão confiança de mercado; uma fonte mantém baixa confiança e pedido de cotação;
- diferença acima de 40% da mediana exige confirmação independente, senão é rejeitada;
- a cotação vale como atual por 18 dias; até 30 dias permanece apenas como referência; depois exige nova cotação;
- componentes, total por nó e total do projeto continuam conciliando exatamente;
- conversões só podem usar câmbio oficial observado há no máximo dois dias; uma cotação na moeda original não precisa de conversão.

Cada recomendação registra a versão do catálogo. Projetos e relatórios antigos mantêm a versão originalmente usada; novos cálculos usam o snapshot ativo.

## O que acontece no desktop

Ao abrir e a cada 24 horas, Windows, macOS e Ubuntu consultam o mesmo repositório público, usam ETag e localizam a maior sequência. Antes da ativação, o aplicativo valida HTTPS/host, tamanho, SHA-256, schema, `keyId`, assinatura Ed25519, data, anti-rollback e toda a cadeia desde a primeira publicação. Hardware, componentes, benchmarks, preços, fontes, publicação e ponteiro ativo entram em uma transação única; SQLite v7 preserva integralmente as tabelas v1-v6 e acrescenta identidades canônicas, compatibilidade, BOMs e cobertura por estágio.

Qualquer falha preserva o snapshot ativo. Um computador offline continua com o último bundle válido ou com o catálogo embarcado. O botão **Atualizar hardware** mostra versão, inventário, preços, mercados, última/ próxima coleta, fontes saudáveis/degradadas/indisponíveis, diferenças e eventual erro. **Verificar agora** apenas antecipa a consulta segura; não é necessário para manter o sistema atualizado. A importação manual de bundle oficial permanece escondida em **Recuperação avançada**.

No SQLite v8, cada especificação autoritativa é armazenada por campo: rótulo e valor originais, valor tipado normalizado, unidade, estado, confiança, URL, data, localização da evidência e SHA-256 do artefato. Campos não publicados não viram zero nem estimativa. Uma atualização com queda de completude, alteração silenciosa de unidade ou novo conflito não pode ativar o catálogo. Lojas continuam autorizadas somente para preço e disponibilidade; apenas fonte oficial define característica técnica.

Observações públicas de capacidade continuam específicas por estágio, SKU, perfil, versão, unidade, sistema e configuração. Um score de CPU ou Blender nunca substitui inferência AiQ, decode, disco, rede ou sustentação térmica.
