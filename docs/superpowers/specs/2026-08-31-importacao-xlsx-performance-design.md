# Otimização da importação XLSX

## Objetivo

Reduzir o tempo da etapa 1 de importação sem alterar a ordem, os tipos, os valores,
as linhas de origem ou os limites de segurança do dataset.

## Diagnóstico

Em `Planilha_modelo.xlsx` (11,2 MB, `A1:AI65429`, 2.290.015 células), a execução
medida apresentou:

- listagem de abas com parse completo: aproximadamente 8,1 s;
- varredura/materialização e tipos: aproximadamente 1,2 s;
- segundo parse na importação: aproximadamente 9,5 s;
- custo combinado atual: aproximadamente 18,8 s.

`bookSheets:true` reduz a listagem de abas para aproximadamente 1,25 s. Reter o
workbook completo para reutilização, entretanto, aumentou a memória medida em cerca
de 437 MB de heap e 803 MB de RSS, portanto não será usado para arquivos grandes.

## Arquitetura aprovada

### Fluxo

1. `LIST_SOURCE_SHEETS` lerá somente os metadados de abas com `bookSheets:true`.
2. Após a seleção da aba, `IMPORT_SOURCE` fará um único parse completo.
3. A leitura da aba combinará em uma passagem:
   - leitura dos valores;
   - identificação de linhas preenchidas;
   - preservação dos números de origem;
   - atualização da detecção de tipos por coluna;
   - criação do dataset canônico.
4. O workbook completo não será mantido em cache entre operações.

Os formatos de request/response do worker permanecerão compatíveis. CSV continuará
usando o processamento chunked existente.

### Divisão de carga

O parse `XLSX.read` permanecerá indivisível, pois o parser atual é síncrono. O
pós-parse será dividido em lotes de linhas usando o `batchSize` existente:

- cada lote executará a leitura, filtragem e tipagem em conjunto;
- o worker cederá ao event loop entre lotes;
- o progresso será reportado com base nas linhas da aba;
- o cancelamento será verificado entre lotes.

Um pool de workers não será introduzido nesta etapa: ele não reduz o parse principal
e exigiria copiar milhões de células, elevando a memória e o risco de divergência.

## Compatibilidade e tratamento de erros

- Manter `ReadSourceOptions`, `SourceReadError` e seus códigos existentes.
- Aplicar `maxCells` antes de materializar linhas.
- Preservar o erro de aba ausente e o tratamento de workbook inválido.
- Manter a regra atual de linha vazia (`null` e texto vazio); espaços continuam
  sendo valores preenchidos na importação.
- Preservar a regra de datas baseada no formato da célula.
- Não alterar `rowId`, `sourceRowNumber`, ordem, valores ou tipos detectados.

## Validação

Serão executados:

- testes unitários de listagem de abas, tipos, datas, valores vazios e números de linha;
- teste de importação da planilha grande sem truncamento;
- testes do worker para progresso por lotes e cancelamento;
- regressão de importação CSV;
- typecheck, suíte completa, build, verificação de dependências circulares e `git diff --check`;
- nova medição real com `Planilha_modelo.xlsx` para comparar listagem e importação.

## Escopo

Não haverá troca de parser, alteração de formato de dados, fragmentação permanente
do workbook, cache completo ou mudanças nas etapas de transformação, validação e
exportação.
