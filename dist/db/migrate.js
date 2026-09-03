// Cada migration é um array de statements (MariaDB não aceita múltiplos statements de DDL em uma única string com multipleStatements às vezes)
const MIGRATIONS = [
    {
        name: '0001_init',
        statements: [
            `CREATE TABLE IF NOT EXISTS customers (
        id CHAR(36) NOT NULL,
        cpf VARCHAR(14) NOT NULL,
        email TEXT,
        name TEXT,
        whatsapp_phone TEXT NOT NULL,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        UNIQUE KEY customers_whatsapp_phone_ux (whatsapp_phone(191)),
        KEY customers_cpf_idx (cpf(14))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS ligacoes (
        id CHAR(36) NOT NULL,
        external_id TEXT,
        customer_id CHAR(36),
        numero_ligacao TEXT NOT NULL,
        categoria TEXT,
        servicos JSON,
        situacao_abastecimento TEXT,
        endereco_imovel TEXT,
        endereco_correspondencia TEXT,
        titular TEXT,
        numero_hidrometro TEXT,
        data_ativacao DATE,
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY ligacoes_customer_id_idx (customer_id),
        KEY ligacoes_numero_ligacao_idx (numero_ligacao(64)),
        CONSTRAINT ligacoes_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS faturas (
        id CHAR(36) NOT NULL,
        ligacao_id CHAR(36),
        identificador TEXT,
        referencia TEXT,
        vencimento DATE,
        valor DECIMAL(14,2),
        debito_automatico TINYINT(1) DEFAULT 0,
        linha_digitavel TEXT,
        status TEXT,
        url_pdf TEXT,
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY faturas_ligacao_id_idx (ligacao_id),
        KEY faturas_status_idx (status(32)),
        CONSTRAINT faturas_ligacao_fk FOREIGN KEY (ligacao_id) REFERENCES ligacoes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS solicitacoes (
        id CHAR(36) NOT NULL,
        ligacao_id CHAR(36),
        tipo TEXT,
        protocolo TEXT,
        status TEXT,
        detalhes JSON,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY solicitacoes_ligacao_id_idx (ligacao_id),
        KEY solicitacoes_protocolo_idx (protocolo(64)),
        CONSTRAINT solicitacoes_ligacao_fk FOREIGN KEY (ligacao_id) REFERENCES ligacoes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS leituras (
        id CHAR(36) NOT NULL,
        ligacao_id CHAR(36),
        data_leitura DATE,
        consumo_real DECIMAL(14,3),
        consumo_faturado DECIMAL(14,3),
        media_consumo DECIMAL(14,3),
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY leituras_ligacao_id_idx (ligacao_id),
        CONSTRAINT leituras_ligacao_fk FOREIGN KEY (ligacao_id) REFERENCES ligacoes (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS audit_logs (
        id CHAR(36) NOT NULL,
        whatsapp_phone TEXT NOT NULL,
        cpf VARCHAR(14),
        ligacao_id CHAR(36),
        action TEXT NOT NULL,
        payload JSON,
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY audit_logs_phone_idx (whatsapp_phone(64)),
        KEY audit_logs_action_idx (action(64))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS sessions (
        phone VARCHAR(32) NOT NULL,
        state JSON NOT NULL,
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    },
    {
        name: '0002_messages_human_tickets',
        statements: [
            `CREATE TABLE IF NOT EXISTS messages (
        id CHAR(36) NOT NULL,
        phone TEXT NOT NULL,
        direction ENUM('in','out') NOT NULL,
        content LONGTEXT NOT NULL,
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY messages_phone_created_idx (phone(64), created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
            `CREATE TABLE IF NOT EXISTS human_tickets (
        id CHAR(36) NOT NULL,
        phone TEXT NOT NULL,
        status ENUM('pendente','em_atendimento','finalizado','cancelado') NOT NULL,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY human_tickets_phone_status_idx (phone(64), status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    },
    {
        name: '0003_human_tickets_assignee_notes',
        statements: [
            `ALTER TABLE human_tickets ADD COLUMN IF NOT EXISTS assigned_attendant TEXT`,
            `CREATE TABLE IF NOT EXISTS human_ticket_notes (
        id CHAR(36) NOT NULL,
        ticket_id CHAR(36) NOT NULL,
        author TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY human_ticket_notes_ticket_created_idx (ticket_id, created_at),
        CONSTRAINT human_ticket_notes_ticket_fk FOREIGN KEY (ticket_id) REFERENCES human_tickets (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    },
    {
        name: '0005_quick_replies',
        statements: [
            `CREATE TABLE IF NOT EXISTS quick_replies (
        id CHAR(36) NOT NULL,
        titulo VARCHAR(100) NOT NULL,
        conteudo TEXT NOT NULL,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY quick_replies_titulo_idx (titulo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    },
    {
        name: '0006_human_tickets_customer_name',
        statements: [
            `ALTER TABLE human_tickets ADD COLUMN IF NOT EXISTS customer_name TEXT`
        ]
    },
    {
        name: '0004_otp_codes',
        statements: [
            `CREATE TABLE IF NOT EXISTS otp_codes (
        id CHAR(36) NOT NULL,
        phone TEXT,
        cpf VARCHAR(14) NOT NULL,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at DATETIME(6) NOT NULL,
        used_at DATETIME(6),
        attempts INT NOT NULL DEFAULT 0,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        KEY otp_codes_cpf_email_idx (cpf, email(191)),
        KEY otp_codes_expires_idx (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    },
    {
        name: '0007_human_attendants',
        statements: [
            `CREATE TABLE IF NOT EXISTS human_attendants (
        id CHAR(36) NOT NULL,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL,
        password_hash TEXT NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(6) DEFAULT NOW(6),
        updated_at DATETIME(6) DEFAULT NOW(6),
        PRIMARY KEY (id),
        UNIQUE KEY human_attendants_email_ux (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        ]
    }
];
export async function runMigrations(pool) {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME(6) DEFAULT NOW(6),
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
    for (const migration of MIGRATIONS) {
        const [existing] = await pool.query('SELECT name FROM schema_migrations WHERE name = ?', [migration.name]);
        if (existing.length > 0)
            continue;
        for (const stmt of migration.statements) {
            await pool.query(stmt);
        }
        await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [migration.name]);
        console.log(`[migrate] ✓ ${migration.name}`);
    }
}
