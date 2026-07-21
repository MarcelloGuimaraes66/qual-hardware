# Manutenção das fontes oficiais

## Política

Somente fabricantes e organizações oficiais definem especificações técnicas. Vendedores e lojas definem apenas preço, disponibilidade e identificação comercial. Números nunca são criados ou corrigidos pelo Qwen.

## Inclusão de uma fonte

1. Cadastre domínio, redirecionamentos, categoria, mercados, parser, limite e política de `robots.txt` no registro.
2. Mantenha a fonte como `unavailable` até existir parser determinístico e fixture revisada.
3. Identifique SKU/MPN exato e preserve o artefato ou sua referência permitida.
4. Calcule SHA-256 antes da transformação.
5. Guarde rótulo/valor originais e normalize para o código semântico.
6. Marque ausências como `not_published`; conflito como `conflicting`.
7. Teste mudança de layout, unidade, duplicata, redirecionamento, CAPTCHA e fonte não oficial.
8. Só então mude a fonte para coleta ativa.

## Publicação quinzenal

O publicador agrega especificações, benchmarks, preços e fontes em bundle assinado append-only. A ativação é bloqueada por redução de cobertura, órfão, conflito novo, unidade alterada, assinatura inválida ou tentativa de rollback. Em falha, o desktop mantém o último snapshot válido.

## Licenças

Quando a licença não permitir redistribuir o documento, armazene apenas fatos técnicos, URL, data, localização da evidência e hash. O relatório de publicação deve registrar a política usada. Não copie tabelas comerciais ou bases pagas sem licença.

## Revisão periódica

Para cada categoria, acompanhe cobertura total, cobertura dos campos críticos, conflitos e idade da última observação. Uma nova geração não entra no universo qualificado até cumprir especificação, compatibilidade, benchmark e calibração; ela pode permanecer no inventário como `reference_only`.
