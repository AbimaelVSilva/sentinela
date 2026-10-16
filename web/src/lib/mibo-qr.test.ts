import { describe, expect, it } from 'vitest';
import { normalizeMiboModel, parseMiboQr } from './mibo-qr';

describe('parseMiboQr', () => {
  it('retorna vazio para string vazia', () => {
    expect(parseMiboQr('')).toEqual({});
    expect(parseMiboQr('   ')).toEqual({});
  });

  it('lê JSON plano', () => {
    expect(parseMiboQr('{"sn":"ABC123456789","model":"iM5 SC"}')).toEqual({
      serial: 'ABC123456789',
      model: 'iM5 SC',
    });
  });

  it('lê JSON aninhado com chaves variadas', () => {
    expect(parseMiboQr('{"device":{"SerialNumber":"XYZ987654","DeviceModel":"IM7S"}}')).toEqual({
      serial: 'XYZ987654',
      model: 'iM7 S',
    });
  });

  it('lê URL com parâmetros', () => {
    expect(parseMiboQr('https://mibo.intelbras.com/add?sn=QW12ER34TY&model=iM3%20C')).toEqual({
      serial: 'QW12ER34TY',
      model: 'iM3 C',
    });
  });

  it('lê querystring solta', () => {
    expect(parseMiboQr('devid=7F3A9B2C1D&type=IM4C')).toEqual({
      serial: '7F3A9B2C1D',
      model: 'iM4 C',
    });
  });

  it('lê pares chave:valor separados por ; , e quebra de linha', () => {
    expect(parseMiboQr('SN:5K8H2J9L4M;Model:iM5 S')).toEqual({
      serial: '5K8H2J9L4M',
      model: 'iM5 S',
    });
    expect(parseMiboQr('serial=AA11BB22CC, modelo=iME 360')).toEqual({
      serial: 'AA11BB22CC',
      model: 'iME 360',
    });
    expect(parseMiboQr('Modelo: iM9+\nS/N: 9988776655')).toMatchObject({ model: 'iM9+' });
  });

  it('cai para token alfanumérico longo como serial', () => {
    expect(parseMiboQr('MIBO 2F4D6H8J0K')).toEqual({ serial: '2F4D6H8J0K' });
  });

  it('extrai modelo do texto livre junto com o token', () => {
    expect(parseMiboQr('Intelbras iM5 SC - 3C9X7V1B5N')).toEqual({
      serial: '3C9X7V1B5N',
      model: 'iM5 SC',
    });
  });

  it('não inventa dados quando não há nada reconhecível', () => {
    expect(parseMiboQr('olá mundo')).toEqual({});
    expect(parseMiboQr('https://intelbras.com')).toEqual({});
  });

  it('não confunde o modelo com serial', () => {
    expect(parseMiboQr('iME500')).toEqual({ model: 'iME 500' });
  });
});

describe('normalizeMiboModel', () => {
  it('mapeia variações para o nome canônico', () => {
    expect(normalizeMiboModel('im5sc')).toBe('iM5 SC');
    expect(normalizeMiboModel('IM-3-C')).toBe('iM3 C');
    expect(normalizeMiboModel('iM9+')).toBe('iM9+');
  });
  it('mantém modelos desconhecidos', () => {
    expect(normalizeMiboModel('  XYZ-1 ')).toBe('XYZ-1');
  });
});
