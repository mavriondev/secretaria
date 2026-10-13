// Rótulos e significados de códigos das tabelas do pacote Sankhya, do dicionário de dados do produto (nomes e rótulos de campo; nenhum dado de cliente).
export const ROTULOS_SANKHYA: Record<string, { rotulo: string; colunas: Record<string, { rotulo: string; opcoes?: Record<string, string> }> }> = {
 "TGFCAB": {
  "rotulo": "Entrada e Saída de Produto",
  "colunas": {
   "NUNOTA": {
    "rotulo": "Nro. Único"
   },
   "NUMNOTA": {
    "rotulo": "Nro. Nota"
   },
   "CODEMP": {
    "rotulo": "Empresa"
   },
   "CODPARC": {
    "rotulo": "Parceiro"
   },
   "CODVEND": {
    "rotulo": "Vendedor"
   },
   "CODTIPOPER": {
    "rotulo": "Tipo Operação"
   },
   "DHTIPOPER": {
    "rotulo": "Dt./Hr. Operação"
   },
   "TIPMOV": {
    "rotulo": "Tipo de Movimento",
    "opcoes": {
     "1": "1-NF Depósito",
     "2": "2-PD Devol. / Procuração / Warrant",
     "3": "3-Saídas",
     "4": "4-Faturamento",
     "8": "8-RD8",
     "B": "B-Movimento bancário",
     "C": "C-Compra",
     "D": "D-Devolução de venda",
     "E": "E-Devolução de compra",
     "F": "F-Produção",
     "G": "G-Pagamento",
     "I": "I-Financeiro",
     "J": "J-Pedido de Requisição",
     "K": "K-Pedido de Transferência",
     "L": "L-Devolução de Requisição",
     "M": "M-Devolução de Transf.",
     "N": "N-Entradas",
     "O": "O-Pedido de compra",
     "P": "P-Pedido de venda",
     "Q": "Q-Requisição",
     "R": "R-Recebimento",
     "T": "T-Transferência",
     "V": "V-Venda"
    }
   },
   "STATUSNOTA": {
    "rotulo": "Status da Nota",
    "opcoes": {
     "A": "Atendimento",
     "L": "Liberada",
     "P": "Pendente"
    }
   },
   "STATUSNFE": {
    "rotulo": "Status NF-e",
    "opcoes": {
     "A": "Aprovada",
     "D": "DENEGADA",
     "E": "Aguardando Autorização",
     "I": "Enviada",
     "M": "Não é NF-e",
     "P": "Pendente de Retorno",
     "R": "Aguardando Correção",
     "S": "Enviada EPEC",
     "T": "NF-e Terceiro",
     "V": "Com erro de Validação",
     "null": "Não enviada"
    }
   },
   "DTNEG": {
    "rotulo": "Dt. Neg."
   },
   "DTFATUR": {
    "rotulo": "Dt. do Faturamento"
   },
   "DTENTSAI": {
    "rotulo": "Dt. Entrada/Saída"
   },
   "DTALTER": {
    "rotulo": "Dt. de Alteração"
   },
   "VLRNOTA": {
    "rotulo": "Vlr. Nota"
   },
   "VLRDESCTOT": {
    "rotulo": "Desconto no total"
   },
   "VLRDESCTOTITEM": {
    "rotulo": "Desconto total por item"
   },
   "CODTIPVENDA": {
    "rotulo": "Tipo Negociação"
   },
   "CODNAT": {
    "rotulo": "Natureza"
   },
   "CODCENCUS": {
    "rotulo": "Centro Resultado"
   },
   "PENDENTE": {
    "rotulo": "Pendente",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "APROVADO": {
    "rotulo": "Aprovado",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   }
  }
 },
 "TGFITE": {
  "rotulo": "Itens de Entrada e Saída de Produto",
  "colunas": {
   "NUNOTA": {
    "rotulo": "Nro único"
   },
   "SEQUENCIA": {
    "rotulo": "Sequência"
   },
   "CODPROD": {
    "rotulo": "Produto"
   },
   "CODEMP": {
    "rotulo": "Cód.Empresa"
   },
   "CODVEND": {
    "rotulo": "Vendedor"
   },
   "QTDNEG": {
    "rotulo": "Quantidade"
   },
   "VLRUNIT": {
    "rotulo": "Vlr. unitário"
   },
   "VLRTOT": {
    "rotulo": "Vlr. total"
   },
   "VLRDESC": {
    "rotulo": "Vlr. desconto"
   },
   "VLRREPRED": {
    "rotulo": "Vlr. redução"
   },
   "VLRSUBST": {
    "rotulo": "Vlr. substituição"
   },
   "VLRIPI": {
    "rotulo": "Vlr. IPI"
   },
   "ATUALESTOQUE": {
    "rotulo": "Atualiza estoque"
   },
   "PENDENTE": {
    "rotulo": "Pendente",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "CODVOL": {
    "rotulo": "Unidade"
   },
   "USOPROD": {
    "rotulo": "Uso do Produto",
    "opcoes": {
     "1": "Subproduto",
     "2": "Prod.Intermediário",
     "4": "Demonstração",
     "B": "Brinde",
     "C": "Consumo",
     "D": "Revenda (por fórmula)",
     "E": "Embalagem",
     "F": "Brinde (NF)",
     "I": "Imobilizado",
     "M": "Matéria prima",
     "O": "Outros insumos",
     "P": "Em Processo",
     "R": "Revenda",
     "S": "Serviço",
     "T": "Terceiros",
     "V": "Venda (fabricação própria)"
    }
   },
   "STATUSNOTA": {
    "rotulo": "Status da Nota"
   },
   "DTALTER": {
    "rotulo": "Dt. Alteração"
   }
  }
 },
 "TGFTOP": {
  "rotulo": "Tipos de Operação",
  "colunas": {
   "CODTIPOPER": {
    "rotulo": "Cód.Tipo Operação"
   },
   "DHALTER": {
    "rotulo": "Data e hora alteração"
   },
   "DESCROPER": {
    "rotulo": "Descrição"
   },
   "TIPMOV": {
    "rotulo": "Tipo de movimento",
    "opcoes": {
     "1": "1-NF Depósito",
     "2": "2-Pedido de Devolução",
     "3": "3-Saídas",
     "4": "4-Faturamento",
     "8": "8-Pedido de Armazenagem",
     "B": "B-Movimento bancário",
     "C": "C-Compra",
     "D": "D-Devolução de venda",
     "E": "E-Devolução de compra",
     "F": "F-Produção",
     "G": "G-Pagamento",
     "I": "I-Financeiro",
     "J": "J-Pedido de Requisição",
     "K": "K-Pedido de Transferência",
     "L": "L-Devolução de Requisição",
     "M": "M-Devolução de Transf.",
     "N": "N-Entradas",
     "O": "O-Pedido de Compra",
     "P": "P-Pedido de Venda",
     "Q": "Q-Requisição",
     "R": "R-Recebimento",
     "T": "T-Transferência",
     "V": "V-Venda"
    }
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "ATUALEST": {
    "rotulo": "Atualização do Estoque",
    "opcoes": {
     "B": "Baixar",
     "E": "Entrar",
     "N": "Nenhuma",
     "R": "Reservar"
    }
   },
   "ATUALFIN": {
    "rotulo": "Financeiro",
    "opcoes": {
     "0": "Não atualizar",
     "1": "Receitas",
     "-1": "Despesas"
    }
   },
   "TIPATUALFIN": {
    "rotulo": "Atualização do financeiro",
    "opcoes": {
     "I": "Incluir",
     "P": "Provisionar"
    }
   },
   "NFE": {
    "rotulo": "NF-e",
    "opcoes": {
     "N": "Normal",
     "C": "Complementar",
     "A": "Ajuste",
     "D": "Devolução",
     "B": "Nota de Crédito",
     "F": "Nota de Débito",
     "E": "Import. Doc. (Emissão Própria)",
     "M": "Convencional (Não Usa NF-e)",
     "T": "Terceiros",
     "G": "Import. Doc. Débito (Emissão Própria)",
     "H": "Import. Doc. Crédito (Emissão Própria)"
    }
   },
   "GOLSINAL": {
    "rotulo": "Tipo para análise",
    "opcoes": {
     "0": "Nada",
     "1": "Compra",
     "-1": "Venda"
    }
   },
   "BONIFICACAO": {
    "rotulo": "Bonificação",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   }
  }
 },
 "TGFTPV": {
  "rotulo": "Tipos de Negociação",
  "colunas": {
   "CODTIPVENDA": {
    "rotulo": "Tipo de Negociação"
   },
   "DESCRTIPVENDA": {
    "rotulo": "Descrição"
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   }
  }
 },
 "TGFVEN": {
  "rotulo": "Vendedores Representantes",
  "colunas": {
   "CODVEND": {
    "rotulo": "Código"
   },
   "APELIDO": {
    "rotulo": "Apelido"
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "TIPVEND": {
    "rotulo": "Tipo",
    "opcoes": {
     "C": "Comprador",
     "E": "Executante",
     "G": "Gerente",
     "R": "Representante",
     "S": "Supervisor",
     "T": "Técnico",
     "V": "Vendedor"
    }
   },
   "CODPARC": {
    "rotulo": "Parceiro"
   },
   "CODGER": {
    "rotulo": "Gerente"
   },
   "CODEMP": {
    "rotulo": "Empresa"
   }
  }
 },
 "TGFPAR": {
  "rotulo": "Parceiros",
  "colunas": {
   "CODPARC": {
    "rotulo": "Cód. Parceiro"
   },
   "NOMEPARC": {
    "rotulo": "Nome Parceiro"
   },
   "RAZAOSOCIAL": {
    "rotulo": "Razão social"
   },
   "CGC_CPF": {
    "rotulo": "CNPJ / CPF"
   },
   "TIPPESSOA": {
    "rotulo": "Tipo de pessoa",
    "opcoes": {
     "F": "Física",
     "J": "Jurídica"
    }
   },
   "CLIENTE": {
    "rotulo": "Cliente",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "FORNECEDOR": {
    "rotulo": "Fornecedor",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "VENDEDOR": {
    "rotulo": "Vendedor",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "CODVEND": {
    "rotulo": "Vend. Preferencial"
   },
   "CODCID": {
    "rotulo": "Cód. Cidade"
   }
  }
 },
 "TGFPRO": {
  "rotulo": "Produtos",
  "colunas": {
   "CODPROD": {
    "rotulo": "Código"
   },
   "DESCRPROD": {
    "rotulo": "Descrição"
   },
   "CODGRUPOPROD": {
    "rotulo": "Grupo"
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "CODVOL": {
    "rotulo": "Unidade padrão"
   },
   "MARCA": {
    "rotulo": "Marca"
   },
   "USOPROD": {
    "rotulo": "Usado como",
    "opcoes": {
     "1": "Subproduto",
     "2": "Prod.Intermediário",
     "4": "Demonstração",
     "B": "Brinde",
     "C": "Consumo",
     "D": "Revenda (por fórmula)",
     "E": "Embalagem",
     "F": "Brinde (NF)",
     "I": "Imobilizado",
     "M": "Matéria prima",
     "O": "Outros insumos",
     "P": "Em Processo",
     "R": "Revenda",
     "T": "Terceiros",
     "V": "Venda (fabricação própria)"
    }
   },
   "REFERENCIA": {
    "rotulo": "Referência"
   }
  }
 },
 "TGFGRU": {
  "rotulo": "Grupos de Produtos",
  "colunas": {
   "CODGRUPOPROD": {
    "rotulo": "Cód. do Grupo Produto"
   },
   "DESCRGRUPOPROD": {
    "rotulo": "Descrição"
   },
   "ANALITICO": {
    "rotulo": "Analítico",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "CODGRUPAI": {
    "rotulo": "Grupo pai"
   }
  }
 },
 "TSIEMP": {
  "rotulo": "Empresas",
  "colunas": {
   "CODEMP": {
    "rotulo": "Cód. Empresa"
   },
   "NOMEFANTASIA": {
    "rotulo": "Nome Fantasia"
   },
   "RAZAOSOCIAL": {
    "rotulo": "Razão Social"
   }
  }
 },
 "TSICUS": {
  "rotulo": "Centros de Resultado",
  "colunas": {
   "CODCENCUS": {
    "rotulo": "Código"
   },
   "DESCRCENCUS": {
    "rotulo": "Descrição"
   },
   "ATIVO": {
    "rotulo": "Ativo",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "ANALITICO": {
    "rotulo": "Analítico",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   }
  }
 },
 "TGFFIN": {
  "rotulo": "Financeiro",
  "colunas": {
   "NUFIN": {
    "rotulo": "Nro Único"
   },
   "NUNOTA": {
    "rotulo": "Nro Único Nota"
   },
   "CODEMP": {
    "rotulo": "Empresa"
   },
   "CODPARC": {
    "rotulo": "Parceiro"
   },
   "CODVEND": {
    "rotulo": "Vendedor"
   },
   "CODNAT": {
    "rotulo": "Natureza"
   },
   "CODCENCUS": {
    "rotulo": "Centro Resultado"
   },
   "CODTIPTIT": {
    "rotulo": "Tipo de Título"
   },
   "CODBCO": {
    "rotulo": "Banco"
   },
   "CODTIPOPER": {
    "rotulo": "Tipo Operação"
   },
   "DTNEG": {
    "rotulo": "Dt. Negociação"
   },
   "DTVENC": {
    "rotulo": "Dt. Vencimento"
   },
   "DTVENCINIC": {
    "rotulo": "Dt. Venc. Inicial"
   },
   "DHBAIXA": {
    "rotulo": "Data Baixa"
   },
   "DTALTER": {
    "rotulo": "Últ. Alteração"
   },
   "VLRDESDOB": {
    "rotulo": "Vlr do Desdobramento"
   },
   "VLRBAIXA": {
    "rotulo": "Vlr Baixa"
   },
   "VLRJURO": {
    "rotulo": "Vlr Juros"
   },
   "VLRMULTA": {
    "rotulo": "Vlr Multa"
   },
   "VLRDESC": {
    "rotulo": "Vlr Desconto"
   },
   "RECDESP": {
    "rotulo": "Receita/Despesa",
    "opcoes": {
     "1": "Receita",
     "-1": "Despesa"
    }
   },
   "PROVISAO": {
    "rotulo": "Provisão",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "ORIGEM": {
    "rotulo": "Origem",
    "opcoes": {
     "E": "Estoque",
     "F": "Financeiro",
     "P": "Pessoal"
    }
   },
   "NUMNOTA": {
    "rotulo": "Nro Nota"
   },
   "NUMDUPL": {
    "rotulo": "Nro Duplicata"
   },
   "HISTORICO": {
    "rotulo": "Histórico"
   },
   "DHMOV": {
    "rotulo": "Dt/Hr Movimentação"
   }
  }
 },
 "TGFNAT": {
  "rotulo": "Natureza de Receitas e Despesas",
  "colunas": {
   "CODNAT": {
    "rotulo": "Cód. Natureza"
   },
   "DESCRNAT": {
    "rotulo": "Descrição"
   },
   "ANALITICA": {
    "rotulo": "Analítica",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   },
   "ATIVA": {
    "rotulo": "Ativa",
    "opcoes": {
     "N": "Não",
     "S": "Sim"
    }
   }
  }
 }
};
