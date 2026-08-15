# Remoção de proteções antes da exportação

## Resumo

Na etapa 10, o risco `protected-workbook` é criado quando `xl/workbook.xml` contém `<workbookProtection>`. A proteção de planilha é detectada separadamente por `<sheetProtection>`. A exportação atualmente bloqueia ambos os casos antes de gravar dados.

O fluxo passará a preparar uma cópia do pacote OOXML, removendo as proteções de pasta de trabalho e de todas as abas antes da análise de riscos e da exportação. O arquivo original carregado pelo usuário não será alterado.

## Desenho técnico

- Criar um sanitizador de pacote OOXML que:
  - clone o pacote por emissão e reabertura;
  - indexe o workbook para localizar `xl/workbook.xml` e todas as worksheets;
  - remova apenas os elementos `<workbookProtection>` e `<sheetProtection>`, aceitando formas autocontidas e com fechamento explícito;
  - preserve todos os demais XML e partes do pacote byte a byte sempre que não forem alterados.
- Usar a cópia sanitizada no worker durante `SCAN_EXPORT_RISKS`, evitando que a etapa 10 exiba o bloqueio de proteção.
- Fazer `exportWorkbook` sanitizar sua própria cópia antes de calcular riscos, garantindo o mesmo comportamento para chamadas diretas e para o worker.
- Manter `scanExportRisks` capaz de diagnosticar um pacote bruto protegido em testes e ferramentas internas; o fluxo de exportação sempre fornecerá o pacote preparado.
- Continuar bloqueando criptografia, macros, estruturas incompatíveis, conflitos de escrita e demais riscos não relacionados à proteção.

## Interfaces e fluxo

- Adicionar uma função interna/exportável de preparação de pacote, recebendo `OoxmlPackage` e retornando uma nova instância preparada.
- Não alterar `WorkbookIndex`: `workbookProtected` e `WorksheetIndex.protected` continuarão representando fielmente o pacote recebido.
- Fluxo de análise: buffer do template → abrir pacote → remover proteções → `scanExportRisks` → riscos exibidos na etapa 10.
- Fluxo de exportação: buffer do template → abrir pacote → remover proteções → validar riscos → gravar workbook → emitir `.xlsx`.
- Falhas de leitura, XML inválido ou ausência de partes obrigatórias continuarão sendo erros de exportação; nenhuma alteração parcial será emitida.

## Testes e critérios de aceite

- Sanitizador remove proteção do workbook e de todas as worksheets, mantendo XML não relacionado.
- Sanitizador não altera o pacote original recebido.
- `scanExportRisks` do pacote bruto continua identificando proteções para diagnóstico.
- Exportação de pacote protegido produz arquivo sem `<workbookProtection>` e `<sheetProtection>` e permite a gravação.
- A etapa 10 não exibe “A pasta de trabalho de destino está protegida” nem “A aba de destino está protegida” após a preparação.
- Riscos de criptografia, macros e incompatibilidades existentes continuam bloqueando a exportação.
- Executar testes unitários/integrados de OOXML, worker e fluxo da aplicação, além de typecheck e build.

## Premissas

- A remoção autorizada abrange proteção estrutural do workbook e proteção de todas as abas, não apenas a aba escolhida.
- A proteção por senha não será solicitada nem preservada no arquivo exportado.
- Partes de criptografia continuam sem suporte e não serão “desbloqueadas” por remoção de tags XML.
