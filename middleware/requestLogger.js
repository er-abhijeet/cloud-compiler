const { Pool } = require('pg');
const geoip = require('geoip-lite');

class SimpleRequestLogger {
    constructor(databaseUri) {
        this.pool = new Pool({
            connectionString: databaseUri,
            ssl: {
                rejectUnauthorized: false
            }
        });
        
        this.initDatabase();
    }

    async initDatabase() {
        try {
            // Test connection
            const client = await this.pool.connect();
            console.log('✅ Database connected successfully');
            client.release();
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            console.log('📝 Make sure to:');
            console.log('   1. Create your .env file from env.example');
            console.log('   2. Update DATABASE_URI with your Neon PostgreSQL URI');
            console.log('   3. Run the SQL schema from database_schema.sql');
        }
    }

    getClientIP(req) {
        // Get real client IP, handling various proxy headers
        const xForwardedFor = req.headers['x-forwarded-for'];
        const xRealIP = req.headers['x-real-ip'];
        const cfConnectingIP = req.headers['cf-connecting-ip'];
        
        let clientIP = req.connection?.remoteAddress || 
                      req.socket?.remoteAddress || 
                      req.ip ||
                      '127.0.0.1';

        // Handle X-Forwarded-For header (can contain multiple IPs)
        if (xForwardedFor) {
            clientIP = xForwardedFor.split(',')[0].trim();
        } else if (xRealIP) {
            clientIP = xRealIP;
        } else if (cfConnectingIP) {
            clientIP = cfConnectingIP;
        }

        // Remove IPv6 prefix if present
        if (clientIP.startsWith('::ffff:')) {
            clientIP = clientIP.substring(7);
        }

        return clientIP;
    }

    getCountry(ip) {
        try {
            const geo = geoip.lookup(ip);
            return geo ? geo.country : null;
        } catch (error) {
            console.error('Geolocation lookup failed:', error);
            return null;
        }
    }

    getFileSize(files) {
        let totalSize = 0;
        if (files) {
            if (files.code && files.code[0]) {
                totalSize += files.code[0].size || 0;
            }
            if (files.input && files.input[0]) {
                totalSize += files.input[0].size || 0;
            }
        }
        return totalSize > 0 ? totalSize : null;
    }

    middleware() {
        return async (req, res, next) => {
            // Log the request after it's processed
            const logRequest = async () => {
                try {
                    const clientIP = this.getClientIP(req);
                    const country = this.getCountry(clientIP);
                    const requestType = req.method;
                    const language = req.body?.lang || null;
                    const fileSize = this.getFileSize(req.files);

                    // Insert into database
                    const query = `
                        INSERT INTO request_logs (ip_address, country, request_type, language, file_size_bytes)
                        VALUES ($1, $2, $3, $4, $5)
                    `;

                    const values = [clientIP, country, requestType, language, fileSize];

                    await this.pool.query(query, values);
                    console.log(`📊 Request logged: ${requestType} - ${clientIP} (${country || 'Unknown'}) - ${language || 'No lang'} - ${fileSize || 0} bytes`);
                } catch (error) {
                    console.error('Error logging request:', error.message);
                }
            };

            // Log request when response finishes
            res.on('finish', logRequest);
            
            next();
        };
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}

module.exports = SimpleRequestLogger;