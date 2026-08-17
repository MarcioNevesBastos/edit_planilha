---
name: eqc-complexity-reviewer
description: Use somente quando o usuário selecionar explicitamente a revisão EQC de complexidade PRE ou POST.
---

Delegue integralmente a solicitação atual ao agente personalizado `eqc_complexity_reviewer`.

Encaminhe a fase PRE ou POST, objetivo, escopo, restrições e evidências disponíveis. Não execute este papel no agente principal. Se o agente não estiver disponível, interrompa e informe `AGENTE_INDISPONIVEL: eqc_complexity_reviewer`.

Aguarde a resposta do subagente e devolva-a integralmente, preservando a identidade `AGENTE`; não resuma, reescreva, personifique ou substitua a resposta.
