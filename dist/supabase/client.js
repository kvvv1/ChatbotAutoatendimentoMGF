import mysql from 'mysql2/promise';
let _pool = null;
export function getDb(config) {
    if (!_pool) {
        _pool = mysql.createPool({
            host: config.dbHost,
            port: config.dbPort,
            user: config.dbUser,
            password: config.dbPassword,
            database: config.dbDatabase,
            waitForConnections: true,
            connectionLimit: 10,
            enableKeepAlive: true,
            timezone: '-03:00', // MySQL server em horário de Brasília (UTC-3)
            multipleStatements: true
        });
    }
    return _pool;
}
export async function closeDb() {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
}
