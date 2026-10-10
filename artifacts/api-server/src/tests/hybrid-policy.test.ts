import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssistantResponse } from "@workspace/api-zod";
import { allowNativeSpeech, protectedSpeech } from "../lib/hybrid-policy";

const general = { responseKind:"general",answer:"Bom dia! Como posso ajudar?",metricResult:null,metricResults:[],sources:[],document:null } as unknown as AssistantResponse;
test("native greetings are allowed only after backend classification and transcript checks", () => {
  assert.equal(allowNativeSpeech("Bom dia",general,"Bom dia! Tudo bem?"),true);
  assert.equal(allowNativeSpeech("Bom dia",general,""),false);
  assert.equal(allowNativeSpeech("Bom dia",{...general,responseKind:"clarification"},"Bom dia!"),false);
});
test("financial words, numbers and researched answers remain on validated TTS", () => {
  for(const text of ["R$ 50","cinquenta reais","seu faturamento cresceu","qual o lucro","cotação do dólar","vendas da empresa","dez por cento","exporte o relatório","oito milhões"]) {
    assert.equal(protectedSpeech(text),true,text);
    assert.equal(allowNativeSpeech(text,general,"Certo."),false,text);
    assert.equal(allowNativeSpeech("Oi",general,text),false,text);
  }
  assert.equal(allowNativeSpeech("Oi",{...general,responseKind:"erp"},"Certo"),false);
  assert.equal(allowNativeSpeech("Oi",{...general,answer:"O valor é mil reais"},"Certo"),false);
});
