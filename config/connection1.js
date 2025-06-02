
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'doors_for_all',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL');
    connection.release(); // Always release!
  } catch (err) {
    console.error('Database connection failed:', err);
    throw err;
  }
})();

module.exports = pool;
