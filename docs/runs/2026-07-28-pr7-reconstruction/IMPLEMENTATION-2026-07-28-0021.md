# Implementação — resultado da reconstrução

O PR foi reconstruído sobre `f7dee23`, sem merge ou rebase do histórico antigo.

O head original `3b0b442` permanece recuperável em
`codex/archive-pr7-windows-qual-hardware-20260728`.

A branch reconstruída contém apenas as proteções de regressão ainda ausentes na
`main`. Isso preserva integralmente a arquitetura 0.6.0 e elimina os conflitos
causados pela tentativa de reaplicar 36 arquivos da versão 0.2.0.

O rollback consiste em apontar novamente a branch do PR para o head arquivado.
