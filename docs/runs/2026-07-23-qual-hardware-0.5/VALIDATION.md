# Validação da versão 0.5

Data: 23 de julho de 2026
Plataforma: Windows x64
Node.js: 24.18.0
npm: 11.16.0
Go: 1.26.5

## Resultado

| Verificação | Resultado |
| --- | --- |
| Typecheck TypeScript | aprovado |
| Suíte Vitest | 28 arquivos; 232 aprovados; 2 ignorados por gate físico |
| Auditoria dos contratos | aprovada; zero acesso externo |
| Testes do helper Go | aprovados |
| Build reproduzível do helper | Windows, Ubuntu e macOS aprovados |
| Build web/servidor | aprovado |
| Pacote Windows desempacotado | aprovado |
| Smoke do pacote sem runtime externo | aprovado |
| Limpeza do smoke | zero temporários remanescentes |
| Executável portátil 0.5.0 | gerado |
| Runtime candidato Windows kernel 3.0 | gerado; instalação aguarda ação explícita do usuário na app |

Executável:

`release/Qual-Hardware-0.5.0-windows-x64-portable.exe`

SHA-256:

`FC7CC7F93EBA7ED94D42B64513852857E4150F0122DDC52570D20E910AC26B42`

Runtime candidato separado:

`release/Qual-Hardware-runtime-1.1.0-candidate.1-win32-x64.qhruntime`

SHA-256:

`7806B10E13477A013FA5B1AE4C5D4B9EBDEC015FF65B870F80AEBF701509EBCA`

## Limite desta validação

O Codex não iniciou diagnóstico de dez minutos, teste de engenharia, qualificação comercial nem outra carga física. O runtime candidato de terceiros permanece separado do executável e do repositório. Sua instalação e todo teste físico devem ser iniciados explicitamente pelo usuário na aplicação.
