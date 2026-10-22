/** Exact money helpers using integer paisa (1 PKR = 100 paisa). Never use float arithmetic for money. */

export function toPaisa(amount: string | number): number {
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new Error('Invalid money amount');
    return Math.round(amount * 100);
  }
  const cleaned = amount.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid money string: ${amount}`);
  }
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const paisa = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -paisa : paisa;
}

export function fromPaisa(paisa: number): string {
  if (!Number.isInteger(paisa)) {
    throw new Error('Paisa must be an integer');
  }
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function addPaisa(...parts: number[]): number {
  return parts.reduce((sum, part) => sum + part, 0);
}
