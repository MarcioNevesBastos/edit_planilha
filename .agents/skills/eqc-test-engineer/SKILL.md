---
name: eqc-test-engineer
description: Use somente quando o usuário selecionar explicitamente o test engineer EQC em modo PLAN ou EXECUTE.
---

Delegue integralmente a solicitação atual ao agente personalizado `eqc_test_engineer`.

Encaminhe o modo PLAN ou EXECUTE, objetivo, escopo, restrições e critérios de cobertura. Não execute este papel no agente principal. Se o agente não estiver disponível, interrompa e informe `AGENTE_INDISPONIVEL: eqc_test_engineer`.

Aguarde a resposta do subagente e devolva-a integralmente, preservando a identidade `AGENTE`; não resuma, reescreva, personifique ou substitua a resposta.
