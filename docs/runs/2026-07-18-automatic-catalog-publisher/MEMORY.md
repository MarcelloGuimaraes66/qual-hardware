# MEMORY — atualização automática quinzenal

Estado inicial: commit `0846ff7`, branch isolado criado pelo Archon, nenhuma Release ou chave configurada no GitHub.

Estado após implementação:

- canal público oficial, chaveiro Ed25519 e SQLite v4 aditivo concluídos;
- segredo privado configurado diretamente no GitHub, sem gravação local;
- 39 fontes registradas, 19 coletáveis e 20 indisponíveis preservadas sem contorno;
- última coleta real: 26 observações, 21 equipamentos, 49 componentes, 5 benchmarks e 12 preços BRL/USD/EUR;
- Qwen permaneceu opcional e não foi chamado quando o parser determinístico resolveu todos os candidatos;
- 64 testes, auditoria sem vulnerabilidades, pacote/smoke macOS e matriz Windows/macOS/Ubuntu aprovados;
- nenhuma base, projeto, snapshot, Release ou evidência anterior foi removida.

Pendência operacional única: publicar/verificar a primeira Release assinada e comprovar o desktop consumindo-a. O branch padrão e o dry-run já foram aprovados. A homologação física Windows 11 e Ubuntu GNOME/Wayland continua um gate humano separado; CI não deve ser descrito como prova física.
