/**
 * Dados fictícios para modo demonstração (DEMO_MODE=true)
 * Usados em lugar das chamadas reais à API Link durante gravação de vídeo.
 */
export const MOCK_LOGIN = {
    Cliente: 'CARLOS EDUARDO DEMO',
    Imoveis: [
        {
            ImovelID: 10001,
            DV: 1,
            IdEletronico: '1234567@01',
            Endereco: 'Rua das Flores, 123 - Centro, Cidade Demo - SP'
        }
    ],
    ImovelSelecionado: 10001
};
export const MOCK_DEBITOS = [
    {
        BoletoID: 'DEMO-2025-001',
        DataRef: '2025-02-01T00:00:00',
        DataVencimento: '2025-02-15T00:00:00',
        ValorBoleto: 87.50,
        CodigoBarras: '00190.00009 00100.100702 00430.030177 5 00000000008750',
        LinhaDigitavel: '00190000090010010070200430030177500000000008750',
        PayloadPix: '00020126330014br.gov.bcb.pix0111999999999990212DEMO EMPRESA5204000053039865406087.505802BR5915Empresa Demo SA6011Cidade Demo62070503***6304DEMO',
        DebitoAutomatico: 0
    },
    {
        BoletoID: 'DEMO-2025-002',
        DataRef: '2025-03-01T00:00:00',
        DataVencimento: '2025-03-15T00:00:00',
        ValorBoleto: 92.30,
        CodigoBarras: '00190.00009 00100.100702 00430.030177 5 00000000009230',
        LinhaDigitavel: '00190000090010010070200430030177500000000009230',
        PayloadPix: '00020126330014br.gov.bcb.pix0111999999999990212DEMO EMPRESA5204000053039865406092.305802BR5915Empresa Demo SA6011Cidade Demo62070503***6304DEMO',
        DebitoAutomatico: 0
    }
];
export const MOCK_DADOS_CADASTRAIS = {
    Nome: 'CARLOS EDUARDO DEMO',
    Endereco: 'Rua das Flores, 123 - Centro, Cidade Demo - SP',
    MapaCadastral: '',
    Categorias: [{ Categoria: 'Residencial', Economias: 1 }],
    DataLigacao: '2018-05-10T00:00:00',
    DataInstalacao: '2018-05-10T00:00:00',
    Hidrometro: 'HM-000123456',
    Servico: 1,
    DescricaoServico: 'Água e Esgoto',
    Situacao: 1,
    DescricaoSituacao: 'Ligado',
    IDEletronico: '1234567@01',
    EnderecoCorrespondencia: 'Rua das Flores, 123 - Centro, Cidade Demo - SP',
    DCO: 0
};
export const MOCK_LEITURAS = [
    { DataLeitura: '2025-03-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '03/2025', Hidrometro: 'HM-000123456', Leitura: 1250, ConsumoFaturado: 18, ConsumoReal: 18, ConsumoMedio: 17 },
    { DataLeitura: '2025-02-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '02/2025', Hidrometro: 'HM-000123456', Leitura: 1232, ConsumoFaturado: 15, ConsumoReal: 15, ConsumoMedio: 17 },
    { DataLeitura: '2025-01-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '01/2025', Hidrometro: 'HM-000123456', Leitura: 1217, ConsumoFaturado: 20, ConsumoReal: 20, ConsumoMedio: 17 },
    { DataLeitura: '2024-12-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '12/2024', Hidrometro: 'HM-000123456', Leitura: 1197, ConsumoFaturado: 16, ConsumoReal: 16, ConsumoMedio: 17 },
    { DataLeitura: '2024-11-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '11/2024', Hidrometro: 'HM-000123456', Leitura: 1181, ConsumoFaturado: 14, ConsumoReal: 14, ConsumoMedio: 17 },
    { DataLeitura: '2024-10-10', OcorrenciaID: 0, Ocorrencia: 'Normal', DataRef: '10/2024', Hidrometro: 'HM-000123456', Leitura: 1167, ConsumoFaturado: 19, ConsumoReal: 19, ConsumoMedio: 17 }
];
// PDF fictício de fatura (A4, Helvetica, conteúdo demo)
export const MOCK_PDF_FATURA_BASE64 = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8' +
    'PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdl' +
    'L1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2Vz' +
    'PDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDc0Nz4+CnN0cmVh' +
    'bQpCVAovRjEgMTYgVGYKNTAgNzkwIFRkCihFTVBSRVNBIERFTU8pIFRqCjAgLTI1IFRkCi9GMSAxMSBU' +
    'ZgooQ05QSjogMDAuMDAwLjAwMC8wMDAxLTAwKSBUagowIC0yMCBUZAooQXYuIEJyYXNpbCwgMTAwMCAt' +
    'IENlbnRybywgQ2lkYWRlIERlbW8gLSBTUCAgQ0VQOiAwMTAwMC0wMDApIFRqCjAgLTM1IFRkCi9GMSAx' +
    'MyBUZgooRkFUVVJBIERFIEFHVUEgRSBFU0dPVE8pIFRqCjAgLTMwIFRkCi9GMSAxMSBUZgooQ2xpZW50' +
    'ZTogQ0FSTE9TIEVEVUFSRE8gREVNTykgVGoKMCAtMjAgVGQKKEltb3ZlbDogUnVhIGRhcyBGbG9yZXMs' +
    'IDEyMyAtIENlbnRybywgQ2lkYWRlIERlbW8gLSBTUCkgVGoKMCAtMjAgVGQKKElEIEVsZXRyb25pY286' +
    'IDEyMzQ1NjdAQSkgVGoKMCAtMzUgVGQKL0YxIDEyIFRmCihSZWZlcmVuY2lhOiAwMi8yMDI1KSBUagow' +
    'IC0yMCBUZAooVmVuY2ltZW50bzogMTUvMDIvMjAyNSkgVGoKMCAtMjAgVGQKKFZhbG9yOiBSJCA4Nyw1' +
    'MCkgVGoKMCAtMzUgVGQKL0YxIDEwIFRmCihDb25zdW1vIGRvIG1lczogMTUgbTMpIFRqCjAgLTIwIFRk' +
    'CihNZWRpYSBkZSBjb25zdW1vOiAxNyBtMykgVGoKMCAtNDUgVGQKL0YxIDkgVGYKKExpbmhhIERpZ2l0' +
    'YXZlbDopIFRqCjAgLTE1IFRkCigwMDE5MDAwMDA5MDAxMDAxMDA3MDIwMDQzMDAzMDE3NzUwMDAwMDAwMDAw' +
    'ODc1MCkgVGoKMCAtNTUgVGQKL0YxIDggVGYKKCoqKiBET0NVTUVOVE8gRklDVElDSU8gR0VSQURPIFBBUkEg' +
    'REVNT05TVFJBQ0FPICoqKikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8L1R5cGUvRm9udC9T' +
    'dWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1' +
    'NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAw' +
    'IG4gCjAwMDAwMDAyMTEgMDAwMDAgbiAKMDAwMDAwMTAwNyAwMDAwMCBuIAp0cmFpbGVyPDwvU2l6ZSA2L1Jv' +
    'b3QgMSAwIFI+PgpzdGFydHhyZWYKMTA3MAolJUVPRg==';
export const MOCK_AUTARQUIA = {
    nome: 'Empresa Demo',
    nomeCompleto: 'Empresa Demo',
    cnpj: '00.000.000/0001-00',
    telefone: '1140040000',
    cep: '01000-000',
    endereco: 'Av. Brasil, 1000 - Centro, Cidade Demo - SP'
};
