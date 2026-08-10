const abbreviations: Readonly<Record<string, string>> = {
  cod: 'codigo',
  desc: 'descricao',
  dt: 'data',
  end: 'endereco',
  nasc: 'nascimento',
  no: 'numero',
  nro: 'numero',
  num: 'numero',
  obs: 'observacao',
  qtd: 'quantidade',
  ref: 'referencia',
  tel: 'telefone',
  vlr: 'valor',
};

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => abbreviations[token] ?? token)
    .join(' ');
}
