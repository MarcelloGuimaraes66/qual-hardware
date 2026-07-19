# Banco local exclusivo do Qual Hardware

Qual Hardware usa SQLite e cria sozinho um arquivo chamado obrigatoriamente `qual-hardware.sqlite`. Não há servidor de banco, usuário, senha ou instalação adicional.

- Desktop Windows: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite` (expected from the preserved package name; the existing portable must confirm this exact path before merge)
- Desktop macOS: `~/Library/Application Support/@aiquimist/qual-hardware/qual-hardware.sqlite` (confirmed with the final packaged app)
- Desktop Ubuntu: `~/.config/@aiquimist/qual-hardware/qual-hardware.sqlite` (expected from the same package name; confirm on the native package)
- Desenvolvimento desktop: o mesmo diretório `userData` nativo da plataforma, substituível apenas por `--user-data-dir` em testes isolados.

The desktop derives these locations from `app.getPath("userData")`; it does not hard-code, move or copy a database. Existing data must never be cleaned to make a validation pass. If the Windows comparison returns a different directory, the release is blocked until compatibility is restored.

O aplicativo rejeita qualquer outro nome de arquivo. Essa barreira impede que um banco do Perceptrum, Drakon ou outro produto seja aberto por engano.

O arquivo guarda apenas projetos, recomendações, catálogos, preços, calibrações agregadas, observações públicas e previsões do Qual Hardware. Nunca guarda vídeo, imagens, URLs ou credenciais RTSP e não contém registros operacionais do Perceptrum.

## Confiabilidade e migração

O esquema aditivo v6 está em `sqlite-schema.sql`, usa tabelas `STRICT`, integridade referencial, transações e `PRAGMA user_version`. A abertura cria apenas objetos ausentes e faz upsert de snapshots embarcados; não apaga catálogos, calibrações nem previsões anteriores. As tabelas v4 guardam registro de fontes, execuções/observações de coleta, publicações imutáveis, preços por componente e o ponteiro do bundle ativo. A v5 acrescenta sessões autenticadas de calibração. A v6 normaliza suítes, perfis, sistemas, execuções, métricas numéricas, vínculos de componentes, avaliações de qualidade, modelos de capacidade, resultados por estágio e validações cruzadas. Todos os dados v1-v5 são preservados. Uma ativação atualiza todos esses dados ou nenhum deles. A aplicação recusa uma versão de banco mais nova do que o executável entende.

SQLite não deve ser colocado em um compartilhamento SMB/NFS. Para backup manual, feche o Qual Hardware e copie `qual-hardware.sqlite`. Os arquivos auxiliares `-wal` e `-shm` desaparecem após o fechamento normal e não devem ser copiados isoladamente.
