# Revisão

- A calibração é local e não acessa Perceptrum, suas câmeras, credenciais, APIs, arquivos ou banco.
- Nenhum caminho normal chama `sudo`, AppleScript administrativo ou `powermetrics`.
- A falha deliberadamente alcançada no nível superior é preservada como limite do hardware.
- A recomendação técnica não é apresentada como qualificação comercial de compra.
- O progresso só chega a 100% depois da persistência, exportação e limpeza.
- O diretório informado pela interface agora é o diretório no qual os três artefatos realmente existem.
- Os 4,3 GB de runtime/modelos locais estão ignorados pelo Git e continuam disponíveis para o aplicativo empacotado.
- O modo source-only do CI não reduz as exigências do pacote distribuível: ele só prova que a aplicação bloqueia a validação física quando os ativos locais não existem.
- O workflow de PR continua cobrindo Windows 11 x64, macOS arm64 e Ubuntu 24.04 x64 sem duplicar a mesma revisão por evento de `push`.
- Nenhum dado ou evidência anterior foi apagado.
