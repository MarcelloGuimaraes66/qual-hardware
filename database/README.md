# Banco local exclusivo do Qual Hardware

Qual Hardware usa SQLite e cria sozinho um arquivo chamado obrigatoriamente `qual-hardware.sqlite`. Não há servidor de banco, usuário, senha ou instalação adicional.

- Desktop Windows: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite`
- Desenvolvimento desktop: `%APPDATA%\@aiquimist\qual-hardware\qual-hardware.sqlite`

O aplicativo rejeita qualquer outro nome de arquivo. Essa barreira impede que um banco do Perceptrum, Drakon ou outro produto seja aberto por engano.

O arquivo guarda apenas projetos do Qual Hardware, recomendações, metadados/resultados de benchmark, catálogo de equipamentos, preços e fila interna. Nunca guarda vídeo, imagens, URLs ou credenciais RTSP e não contém registros operacionais do Perceptrum.

## Confiabilidade e migração

O esquema está em `sqlite-schema.sql`, usa tabelas `STRICT`, integridade referencial, transações e `PRAGMA user_version`. A aplicação aplica atualizações compatíveis ao abrir e recusa uma versão de banco mais nova do que o executável entende. O modo WAL atende às operações internas da janela desktop.

SQLite não deve ser colocado em um compartilhamento SMB/NFS. Para backup manual, feche o Qual Hardware e copie `qual-hardware.sqlite`. Os arquivos auxiliares `-wal` e `-shm` desaparecem após o fechamento normal e não devem ser copiados isoladamente.
