import { ValidationError } from '../../common/errors';

export class InvalidCpfError extends ValidationError {
  constructor(raw: string) {
    super(`CPF inválido: "${raw}"`);
  }
}

/**
 * Value Object para CPF. Garante, por construção, que nenhum CPF inválido
 * circule pelas camadas de aplicação/domínio (fail fast na fronteira).
 * Armazena apenas os 11 dígitos, sem máscara.
 */
export class Cpf {
  private constructor(private readonly digits: string) {}

  static create(raw: string): Cpf {
    const digits = (raw ?? '').replace(/\D/g, '');

    if (!Cpf.isValid(digits)) {
      throw new InvalidCpfError(raw);
    }

    return new Cpf(digits);
  }

  private static isValid(cpf: string): boolean {
    if (cpf.length !== 11) return false;
    // Rejeita sequências repetidas (000.000.000-00, 111.111.111-11, etc.), que
    // passariam no cálculo do dígito verificador mas não são CPFs válidos.
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const digits = cpf.split('').map(Number);

    const checkDigit = (length: number): number => {
      let sum = 0;
      for (let i = 0; i < length; i++) {
        sum += digits[i] * (length + 1 - i);
      }
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };

    return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
  }

  /** Formatado como 000.000.000-00, para exibição. */
  format(): string {
    return this.digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  /** Apenas os 11 dígitos, para persistência/comparação. */
  value(): string {
    return this.digits;
  }

  equals(other: Cpf): boolean {
    return this.digits === other.digits;
  }
}
