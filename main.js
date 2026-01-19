const { Client } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');
const config = require('./config');

const client = new Client({
  host: 'db.puzzleinteract.com',
  port: 5432,
  database: 'puzzle_db',
  user: 'puzzle_user',
  password: 'puzzle_password',
  ssl: {
    require: true,
    rejectUnauthorized: false // Set to false if using self-signed certificates
  }
});

const LAST_ID_FILE = path.join(__dirname, 'lastId.txt');

const logger = new Logger(null);

// Sanitize string by removing null bytes (0x00) which PostgreSQL doesn't allow in text fields
function sanitizeString(str) {
  if (str === null || str === undefined) {
    return str;
  }
  // Convert to string if it's not already a string
  if (typeof str !== 'string') {
    str = String(str);
  }
  // Remove null bytes from the string
  return str.replace(/\0/g, '');
}

async function loadLastId() {
  try {
    const data = await fs.readFile(LAST_ID_FILE, 'utf8');
    const lastId = data.trim();
    return lastId || null;
  } catch (error) {
    // File doesn't exist or can't be read, start from null
    return null;
  }
}

async function saveLastId(lastId) {
  try {
    await fs.writeFile(LAST_ID_FILE, lastId, 'utf8');
  } catch (error) {
    logger.error(`Warning: Could not save lastId to file`, error);
  }
}

async function batchUpdate() {
  let lastId = null; // Declare outside try block so it's accessible in catch block

  try {
    logger.initialize();
    await client.connect();
    logger.log('Connected to database');

    // Load lastId from file or start from null
    lastId = await loadLastId();
    if (lastId) {
      logger.log(`Resuming from lastId: ${lastId}`);
    }

    if (config.language && config.language.toLowerCase() !== 'all') {
      logger.log(`Language filter active: only processing rows with language = '${config.language}'`);
    } else {
      logger.log('Processing all rows regardless of language');
    }

    let totalUpdated = 0;
    let batchNumber = 1;
    const batchSize = 1000;

    while (true) {
      // Select rows from source table with cursor-based paging
      // Build WHERE clause based on lastId and language filter
      let whereClause = '';
      let queryParams = [];

      if (config.language && config.language.toLowerCase() !== 'all') {
        // Language filter is active (not 'all')
        if (lastId) {
          whereClause = 'WHERE id > $1::uuid AND language = $2';
          queryParams = [lastId, config.language];
        } else {
          whereClause = 'WHERE language = $1';
          queryParams = [config.language];
        }
      } else {
        // No language filter or language is 'all' - process all rows
        if (lastId) {
          whereClause = 'WHERE id > $1::uuid';
          queryParams = [lastId];
        }
      }

      const selectQuery = `
        SELECT id, word, meaning, created_at, source, language, word_norm, relations, is_proper, word_case
        FROM ${config.sourceTable}
        ${whereClause}
        ORDER BY id
        LIMIT $${queryParams.length + 1}
      `;

      queryParams.push(batchSize);
      const result = await client.query(selectQuery, queryParams);

      if (result.rows.length === 0) {
        logger.log('No more rows to process. Process complete!');
        break;
      }

      logger.log(`Batch ${batchNumber}: Processing ${result.rows.length} rows...`);

      let batchInserted = 0;
      let batchUpdated = 0;

      // Process each row: insert or update in dictionary table
      for (const row of result.rows) {
        // Sanitize text fields to remove null bytes (meaning and relations are JSON, so skip sanitization)
        const sanitizedWord = sanitizeString(row.word);
        const sanitizedSource = sanitizeString(row.source);
        const sanitizedLanguage = sanitizeString(row.language);
        const sanitizedWordNorm = sanitizeString(row.word_norm);
        const sanitizedWordCase = sanitizeString(row.word_case);
        // meaning and relations are JSON, pass them through as-is
        const meaning = row.meaning;
        const relations = row.relations;
        const isProper = row.is_proper;

        // Check if record exists by word and language
        const checkQuery = `SELECT id FROM ${config.targetTable} WHERE word = $1 AND language = $2`;
        const checkResult = await client.query(checkQuery, [sanitizedWord, sanitizedLanguage]);

        if (checkResult.rows.length > 0) {
          // Record exists - update it
          const updateQuery = `
            UPDATE ${config.targetTable}
            SET word = $1,
                meaning = $2,
                source = $3,
                language = $4,
                word_norm = $5,
                relations = $6,
                is_proper = $7,
                word_case = $8,
                updated_at = NOW()
            WHERE word = $9 AND language = $10
          `;
          await client.query(updateQuery, [
            sanitizedWord,
            meaning,
            sanitizedSource,
            sanitizedLanguage,
            sanitizedWordNorm,
            relations,
            isProper,
            sanitizedWordCase,
            sanitizedWord,
            sanitizedLanguage
          ]);
          batchUpdated++;
        } else {
          // Record doesn't exist - insert it
          const insertQuery = `
            INSERT INTO ${config.targetTable} (id, word, meaning, created_at, source, language, word_norm, relations, is_proper, word_case)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;
          await client.query(insertQuery, [
            row.id,
            sanitizedWord,
            meaning,
            row.created_at,
            sanitizedSource,
            sanitizedLanguage,
            sanitizedWordNorm,
            relations,
            isProper,
            sanitizedWordCase
          ]);
          batchInserted++;
        }
      }

      const batchTotal = batchInserted + batchUpdated;
      totalUpdated += batchTotal;

      logger.log(`  Inserted ${batchInserted} rows, Updated ${batchUpdated} rows in this batch`);
      logger.log(`  Total processed so far: ${totalUpdated}`);

      // Update lastId for next iteration - use the last ID from source table
      if (result.rows.length > 0) {
        lastId = result.rows[result.rows.length - 1].id;
        await saveLastId(lastId);
        logger.log(`  LastId saved: ${lastId}`);
      } else {
        break;
      }
      batchNumber++;

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.log('=== Final Summary ===');
    logger.log(`Total rows copied (inserted/updated): ${totalUpdated}`);
    logger.log(`Total batches processed: ${batchNumber - 1}`);

    // Clear lastId file when complete
    try {
      await fs.unlink(LAST_ID_FILE);
      logger.log('LastId file cleared (process complete)');
    } catch (error) {
      // File might not exist, ignore
    }

  } catch (error) {
    logger.error('Error occurred', error);
    logger.log(`Progress saved. Resume from lastId: ${lastId}`);
  } finally {
    await client.end();
    logger.log('Database connection closed');
    logger.close();
  }
}

batchUpdate();

