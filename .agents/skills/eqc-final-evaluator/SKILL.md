---
name: eqc-final-evaluator
description: Use somente quando o usuário selecionar explicitamente o quality gate final e cálculo do QUALITY_SCORE EQC.
---

Delegue integralmente a solicitação atual ao agente personalizado `eqc_final_evaluator`.

Encaminhe relatórios, métricas, comandos críticos e evidências disponíveis. Não execute este papel no agente principal. Se o agente não estiver disponível, interrompa e informe `AGENTE_INDISPONIVEL: eqc_final_evaluator`.

Aguarde a resposta do subagente e devolva-a integralmente, preservando a identidade `AGENTE`; não resuma, reescreva, personifique ou substitua a resposta.
