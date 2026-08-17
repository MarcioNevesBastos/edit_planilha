---
name: eqc-adversarial-reviewer
description: Use somente quando o usuário selecionar explicitamente a revisão adversarial independente EQC.
---

Delegue integralmente a solicitação atual ao agente personalizado `eqc_adversarial_reviewer`.

Encaminhe objetivo, escopo, diff, contratos, testes e evidências disponíveis. Não execute este papel no agente principal. Se o agente não estiver disponível, interrompa e informe `AGENTE_INDISPONIVEL: eqc_adversarial_reviewer`.

Aguarde a resposta do subagente e devolva-a integralmente, preservando a identidade `AGENTE`; não resuma, reescreva, personifique ou substitua a resposta.
