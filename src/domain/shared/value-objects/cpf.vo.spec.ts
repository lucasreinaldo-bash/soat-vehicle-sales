import { Cpf, InvalidCpfError } from './cpf.vo';

describe('Cpf (Value Object)', () => {
  it('aceita um CPF válido sem máscara', () => {
    const cpf = Cpf.create('52998224725');
    expect(cpf.value()).toBe('52998224725');
  });

  it('aceita um CPF válido com máscara e normaliza para dígitos', () => {
    const cpf = Cpf.create('529.982.247-25');
    expect(cpf.value()).toBe('52998224725');
  });

  it('formata o CPF para exibição', () => {
    expect(Cpf.create('52998224725').format()).toBe('529.982.247-25');
  });

  it('rejeita CPF com dígito verificador inválido', () => {
    expect(() => Cpf.create('52998224726')).toThrow(InvalidCpfError);
  });

  it('rejeita CPF com quantidade errada de dígitos', () => {
    expect(() => Cpf.create('1234567890')).toThrow(InvalidCpfError);
  });

  it('rejeita sequências repetidas', () => {
    expect(() => Cpf.create('11111111111')).toThrow(InvalidCpfError);
    expect(() => Cpf.create('00000000000')).toThrow(InvalidCpfError);
  });

  it('compara CPFs por valor', () => {
    expect(Cpf.create('529.982.247-25').equals(Cpf.create('52998224725'))).toBe(true);
  });
});
