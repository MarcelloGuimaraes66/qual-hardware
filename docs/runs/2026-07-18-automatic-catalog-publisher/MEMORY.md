# MEMORY — atualização automática quinzenal

Estado inicial: commit `0846ff7`, branch isolado criado pelo Archon, nenhuma Release ou chave configurada no GitHub.

Estado após implementação:

- canal público oficial, chaveiro Ed25519 e SQLite v4 aditivo concluídos;
- segredo privado configurado diretamente no GitHub, sem gravação local;
- 39 fontes registradas, 19 coletáveis e 20 indisponíveis preservadas sem contorno;
- última coleta real: 26 observações, 21 equipamentos, 49 componentes, 5 benchmarks e 12 preços BRL/USD/EUR;
- Qwen permaneceu opcional e não foi chamado quando o parser determinístico resolveu todos os candidatos;
- 64 testes, auditoria sem vulnerabilidades, pacote/smoke macOS e matriz Windows/macOS/Ubuntu aprovados;
- primeira publicação assinada concluída como `catalog-2026-07-19.1`, sequência `1`, em <https://github.com/MarcelloGuimaraes66/qual-hardware/releases/tag/catalog-2026-07-19.1>;
- Release e espelho append-only no branch `catalog-data` verificados por download, SHA-256 e assinatura Ed25519;
- desktop macOS empacotado comprovadamente consumiu e ativou a publicação oficial sem configuração do operador;
- segunda execução imediata comprovou o gate quinzenal e não criou publicação duplicada;
- nenhuma base, projeto, snapshot, Release ou evidência anterior foi removida.

Não há pendência de software para ativar o canal quinzenal: o cron está no branch padrão, a chave privada está no segredo do GitHub e a chave pública correspondente está compilada no desktop. O próximo ciclo é decidido automaticamente a partir da última Release válida e, se falhar, o agendamento diário tenta novamente sem substituir o catálogo ativo.

Limite de evidência preservado: a homologação física Windows 11 e Ubuntu GNOME/Wayland continua um gate humano separado; CI não deve ser descrito como prova física.
