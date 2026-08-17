---
name: eqc-implementer
description: Use somente quando o usuário selecionar explicitamente o implementador EQC com um TASK_PACKET aprovado.
---

Delegue integralmente a solicitação atual ao agente personalizado `eqc_implementer`.

Encaminhe o TASK_PACKET aprovado, escopo, restrições e testes esperados. Não execute este papel no agente principal. Se o agente não estiver disponível, interrompa e informe `AGENTE_INDISPONIVEL: eqc_implementer`.

Aguarde a resposta do subagente e devolva-a integralmente, preservando a identidade `AGENTE`; não resuma, reescreva, personifique ou substitua a resposta.
