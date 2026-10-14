/**
 * Gate of the tests that reach a paid provider for real (model, voice, transcription): they only run with TESTES_PAGOS=1.
 * Every other test uses fakes and never spends. Usage: test("...", testePago(), async () => { ... }).
 */
export const TESTES_PAGOS = process.env.TESTES_PAGOS === "1";
export const testePago = (): { skip: string | false } => ({ skip: TESTES_PAGOS ? false : "teste pago: defina TESTES_PAGOS=1 para chamar o provedor de verdade (gera custo)" });
