# Implementação e validação

## Resultado

- O mesmo GGUF Qwen3-VL pode ser usado nos três sistemas declarados.
- Backends continuam específicos: CUDA no Windows/NVIDIA, Metal no macOS e
  Vulkan/ROCm conforme a edição Linux do llama.cpp.
- A seleção automática considera modelo, projetor, overhead, RAM, VRAM e limite
  conservador de CPU sem acelerador.
- Um Qwen3 textual sem `VL` não entra no inventário.

## Evidência executada

- `npm run typecheck`: PASS.
- Testes direcionados: 31 PASS.
- `npm run build`: PASS, incluindo benchmark nativo e bundle web/servidor.
- Suíte completa: 282 PASS, 2 ignorados.
- Detecção física no Windows atual: Intel Core Ultra 9 275HX, 31 GB RAM, RTX
  5090 Laptop 24 GB; orçamento seguro calculado em 19,1 GB.
- A máquina possui dois Qwen3-VL 2B compatíveis e nenhum 4B visual; o 4B textual
  foi corretamente recusado e o modo automático atribuiu 2B aos dois papéis
  com aviso explícito.

## Limites

- Não houve execução física em macOS ou Ubuntu; esses alvos foram validados por
  tipos e testes de política.
- Nenhum ensaio de calibração de 10/60 minutos foi iniciado.
