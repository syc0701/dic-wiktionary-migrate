const { Client } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

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
const LOG_FILE = path.join(__dirname, 'migration.log');

const logger = new Logger(LOG_FILE);

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

    let totalUpdated = 0;
    let batchNumber = 1;
    const batchSize = 1000;

    while (true) {
      // Select rows from dictionary_v5_english with cursor-based paging
      // We'll process all rows from dictionary_v5_english
      const selectQuery = lastId
        ? `
          SELECT id, word, meaning, created_at, source, language, word_norm, relations
          FROM dictionary_v5_english
          WHERE id > $1::uuid
          ORDER BY id
          LIMIT $2
        `
        : `
          SELECT id, word, meaning, created_at, source, language, word_norm, relations
          FROM dictionary_v5_english
          ORDER BY id
          LIMIT $1
        `;

      const result = lastId
        ? await client.query(selectQuery, [lastId, batchSize])
        : await client.query(selectQuery, [batchSize]);

      if (result.rows.length === 0) {
        logger.log('No more rows to process. Process complete!');
        break;
      }

      logger.log(`Batch ${batchNumber}: Processing ${result.rows.length} rows...`);

      let batchInserted = 0;
      let batchUpdated = 0;

      // Process each row: insert or update in dictionary table
      for (const row of result.rows) {
        // Sanitize all text fields to remove null bytes
        const sanitizedWord = sanitizeString(row.word);
        const sanitizedMeaning = sanitizeString(row.meaning);
        const sanitizedSource = sanitizeString(row.source);
        const sanitizedLanguage = sanitizeString(row.language);
        const sanitizedWordNorm = sanitizeString(row.word_norm);
        const sanitizedRelations = sanitizeString(row.relations);
        
        // Check if record exists by word
        const checkQuery = `SELECT id FROM dictionary WHERE word = $1`;
        const checkResult = await client.query(checkQuery, [sanitizedWord]);
        
        if (checkResult.rows.length > 0) {
          // Record exists - update it
          const updateQuery = `
            UPDATE dictionary
            SET word = $1,
                meaning = $2,
                created_at = $3,
                source = $4,
                language = $5,
                word_norm = $6,
                relations = $7,
                updated_at = NOW()
            WHERE word = $8
          `;
          await client.query(updateQuery, [
            sanitizedWord,
            sanitizedMeaning,
            row.created_at,
            sanitizedSource,
            sanitizedLanguage,
            sanitizedWordNorm,
            sanitizedRelations,
            sanitizedWord
          ]);
          batchUpdated++;
        } else {
          // Record doesn't exist - insert it
          const insertQuery = `
            INSERT INTO dictionary (id, word, meaning, created_at, source, language, word_norm, relations)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
          await client.query(insertQuery, [
            row.id,
            sanitizedWord,
            sanitizedMeaning,
            row.created_at,
            sanitizedSource,
            sanitizedLanguage,
            sanitizedWordNorm,
            sanitizedRelations
          ]);
          batchInserted++;
        }
      }

      const batchTotal = batchInserted + batchUpdated;
      totalUpdated += batchTotal;

      logger.log(`  Inserted ${batchInserted} rows, Updated ${batchUpdated} rows in this batch`);
      logger.log(`  Total processed so far: ${totalUpdated}`);

      // Update lastId for next iteration - use the last ID from dictionary_v5_english
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

