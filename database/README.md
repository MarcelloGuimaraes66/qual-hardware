# Banco local exclusivo do Qual Hardware

Qual Hardware usa SQLite e cria sozinho um arquivo chamado obrigatoriamente `qual-hardware.sqlite`. Não há servidor de banco, usuário, senha ou instalação adicional.

- Desktop Windows: `%APPDATA%\Qual Hardware\qual-hardware.sqlite` (expected Electron default; the existing portable must confirm this exact path before merge)
- Desktop macOS: `~/Library/Application Support/Qual Hardware/qual-hardware.sqlite`
- Desktop Ubuntu: `~/.config/Qual Hardware/qual-hardware.sqlite`
- Desenvolvimento: `data/qual-hardware.sqlite`
- Docker em um único host: `/data/qual-hardware.sqlite`, no volume `qual_hardware_data`

The desktop derives these locations from `app.getPath("userData")`; it does not hard-code, move or copy a database. Existing data must never be cleaned to make a validation pass. If the Windows comparison returns a different directory, the release is blocked until compatibility is restored.

O aplicativo rejeita qualquer outro nome de arquivo. Essa barreira impede que um banco do Perceptrum, Drakon ou outro produto seja aberto por engano.

O arquivo guarda apenas projetos do Qual Hardware, recomendações, metadados/resultados de benchmark, catálogo de equipamentos, preços e fila interna. Nunca guarda vídeo, imagens, URLs ou credenciais RTSP e não contém registros operacionais do Perceptrum.

## Confiabilidade e migração

O esquema está em `sqlite-schema.sql`, usa tabelas `STRICT`, integridade referencial, transações e `PRAGMA user_version`. A aplicação aplica atualizações compatíveis ao abrir e recusa uma versão de banco mais nova do que o executável entende. O modo WAL permite que a API e o worker compartilhem o arquivo no mesmo computador.

SQLite não deve ser colocado em um compartilhamento SMB/NFS nem usado por contêineres em hosts diferentes. Para backup manual, feche o Qual Hardware e copie `qual-hardware.sqlite`. Os arquivos auxiliares `-wal` e `-shm` desaparecem após o fechamento normal e não devem ser copiados isoladamente.
