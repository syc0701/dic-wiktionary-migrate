# Dictionary Migration Script

Batch update and insert script for migrating dictionary data from `dictionary_v2` to `dictionary` table.

## Description

This script processes words from `dictionary_v2` and:
- **Updates** the `meaning` column in `dictionary` table if the word already exists
- **Inserts** a new row in `dictionary` table if the word doesn't exist, with the following columns:
  - `id`: Generated UUID
  - `word`: The word from `dictionary_v2`
  - `meaning`: The meaning from `dictionary_v2`
  - `created_at`: Current timestamp (NOW())
  - `source`: 'wiktionary'
  - `language`: 'english'
  - `relations`: Relations from `dictionary_v2` (if available)

The script uses cursor-based pagination to handle large datasets efficiently and supports resumable execution.

## Features

- Batch processing with configurable batch size (default: 1000 rows)
- Cursor-based pagination for efficient large dataset handling
- Resumable execution - saves progress and can resume from last processed ID
- Progress tracking and logging (separate counts for updates and inserts)

## Prerequisites

- Node.js (v12 or higher)
- PostgreSQL database
- `pg` npm package

## Installation

```bash
npm install
```

## Configuration

Update the database connection settings in `main.js`:

```javascript
const client = new Client({
  host: 'localhost',
  port: 5433,
  database: 'puzzle_db',
  user: 'puzzle_user',
  password: 'puzzle_password',
});
```

**Note:** For production use, consider using environment variables for sensitive credentials.

## Usage

```bash
npm start
```

or

```bash
node main.js
```

## How It Works

1. Connects to the PostgreSQL database
2. Loads the last processed ID from `lastId.txt` (if exists) to resume from previous run
3. Processes rows from `dictionary_v2` in batches of 1000
4. For each word:
   - If the word exists in `dictionary`: Updates the `meaning` column
   - If the word doesn't exist: Inserts a new row with all required columns (id, word, meaning, created_at, source, language, relations)
5. Saves progress after each batch
6. Clears the progress file when complete
7. Displays summary with total rows updated and inserted

## License

[Add your license here]


```bash
ps aux | grep '[n]ode main.js'
```